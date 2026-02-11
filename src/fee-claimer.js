import crypto from 'crypto';
import bs58 from 'bs58';
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { getDb } from './firebase.js';
import admin from 'firebase-admin';

// ===== ENCRYPTION (AES-256-GCM) =====

function encrypt(plaintext, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv (12) + authTag (16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(encryptedBase64, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const data = Buffer.from(encryptedBase64, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

// ===== KEY STORAGE =====

export async function storeCreatorKey(mint, creatorPrivateKeyBs58, userWallet) {
  const secret = process.env.CREATOR_KEY_SECRET;
  if (!secret) {
    console.log('CREATOR_KEY_SECRET not set, skipping creator key storage');
    return;
  }

  const db = getDb();
  if (!db) {
    console.log('Firebase not configured, skipping creator key storage');
    return;
  }

  const encryptedKey = encrypt(creatorPrivateKeyBs58, secret);

  await db.collection('creator_keys').doc(mint).set({
    encryptedKey,
    userWallet,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastClaimAt: null,
    totalClaimed: 0,
    claimCount: 0,
    active: true
  });

  console.log(`Creator key stored for mint ${mint}`);
}

// ===== AUTO-CLAIM TIMER =====

let claimTimer = null;

export function startFeeClaimTimer(connection) {
  const MOCK_MODE = process.env.MOCK_MODE === 'true';
  if (MOCK_MODE) {
    console.log('MOCK_MODE enabled, fee claim timer disabled');
    return;
  }

  const secret = process.env.CREATOR_KEY_SECRET;
  const platformKey = process.env.PLATFORM_PRIVATE_KEY;
  if (!secret || !platformKey) {
    console.log('CREATOR_KEY_SECRET or PLATFORM_PRIVATE_KEY not set, fee claim timer disabled');
    return;
  }

  // Initial claim 60s after boot
  setTimeout(() => claimAllFees(connection), 60_000);

  // Then every 30 minutes
  claimTimer = setInterval(() => claimAllFees(connection), 30 * 60 * 1000);

  console.log('Fee claim timer started (every 30 minutes)');
}

async function claimAllFees(connection) {
  const secret = process.env.CREATOR_KEY_SECRET;
  const platformKey = process.env.PLATFORM_PRIVATE_KEY;
  if (!secret || !platformKey) return;

  const db = getDb();
  if (!db) return;

  try {
    // Check platform wallet balance
    const platformKeypair = Keypair.fromSecretKey(bs58.decode(platformKey));
    const platformBalance = await connection.getBalance(platformKeypair.publicKey);

    if (platformBalance < 0.01 * LAMPORTS_PER_SOL) {
      console.log(`Platform wallet balance too low for fee claims: ${platformBalance / LAMPORTS_PER_SOL} SOL`);
      return;
    }

    // Query all active creator keys
    const snapshot = await db.collection('creator_keys')
      .where('active', '==', true)
      .get();

    if (snapshot.empty) {
      console.log('No active creator keys to claim fees for');
      return;
    }

    console.log(`Starting fee claim cycle for ${snapshot.size} tokens...`);

    for (const doc of snapshot.docs) {
      try {
        await claimSingleFee(connection, doc.id, doc.data(), secret, platformKeypair);
      } catch (err) {
        console.error(`Fee claim failed for ${doc.id}:`, err.message);
      }
      // 2s delay between claims
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('Fee claim cycle complete');
  } catch (err) {
    console.error('Fee claim cycle error:', err.message);
  }
}

async function claimSingleFee(connection, mint, data, secret, platformKeypair) {
  // 1. Decrypt creator private key
  const creatorPrivateKeyBs58 = decrypt(data.encryptedKey, secret);
  const creatorKeypair = Keypair.fromSecretKey(bs58.decode(creatorPrivateKeyBs58));

  // 2. Request collect fee tx from PumpPortal
  const response = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: creatorKeypair.publicKey.toString(),
      action: 'collectCreatorFee',
      priorityFee: 0.000001,
      pool: 'pump'
    })
  });

  if (response.status !== 200) {
    const text = await response.text();
    console.log(`No fees to claim for ${mint}: ${text}`);
    return;
  }

  const txData = await response.arrayBuffer();
  if (!txData || txData.byteLength === 0) {
    console.log(`Empty response for ${mint}, no fees to claim`);
    return;
  }

  // 4. Fund creator wallet with ~5000 lamports for tx fee
  const fundingTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: platformKeypair.publicKey,
      toPubkey: creatorKeypair.publicKey,
      lamports: 5000
    })
  );

  const { blockhash: fundBlockhash } = await connection.getLatestBlockhash('confirmed');
  fundingTx.recentBlockhash = fundBlockhash;
  fundingTx.feePayer = platformKeypair.publicKey;

  const fundingSig = await connection.sendTransaction(fundingTx, [platformKeypair]);
  await connection.confirmTransaction(fundingSig, 'confirmed');

  // 5. Deserialize, sign, and send the claim tx
  let claimTx;
  try {
    claimTx = VersionedTransaction.deserialize(new Uint8Array(txData));
    claimTx.sign([creatorKeypair]);
  } catch {
    // Fallback to legacy transaction
    claimTx = Transaction.from(Buffer.from(txData));
    claimTx.sign(creatorKeypair);
  }

  const claimSig = await connection.sendTransaction(claimTx, {
    skipPreflight: false,
    maxRetries: 3
  });
  await connection.confirmTransaction(claimSig, 'confirmed');

  // 6. Check creator wallet balance
  const creatorBalance = await connection.getBalance(creatorKeypair.publicKey);
  const transferAmount = creatorBalance - 1000; // Keep 1000 lamport reserve

  if (transferAmount <= 0) {
    console.log(`No SOL to forward for ${mint} (balance: ${creatorBalance} lamports)`);
    return;
  }

  // 7. Transfer to user wallet
  const userPubkey = new PublicKey(data.userWallet);
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: creatorKeypair.publicKey,
      toPubkey: userPubkey,
      lamports: transferAmount
    })
  );

  const { blockhash: transferBlockhash } = await connection.getLatestBlockhash('confirmed');
  transferTx.recentBlockhash = transferBlockhash;
  transferTx.feePayer = creatorKeypair.publicKey;

  const transferSig = await connection.sendTransaction(transferTx, [creatorKeypair]);
  await connection.confirmTransaction(transferSig, 'confirmed');

  const claimedSol = transferAmount / LAMPORTS_PER_SOL;
  console.log(`Claimed ${claimedSol} SOL for ${mint} → ${data.userWallet} (tx: ${transferSig})`);

  // 8. Update Firestore
  const db = getDb();
  if (db) {
    await db.collection('creator_keys').doc(mint).update({
      lastClaimAt: admin.firestore.FieldValue.serverTimestamp(),
      totalClaimed: admin.firestore.FieldValue.increment(claimedSol),
      claimCount: admin.firestore.FieldValue.increment(1)
    });
  }
}
