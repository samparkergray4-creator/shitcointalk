import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { initWebSockets } from './websocket.js';
import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';
import { initializeFirebase, createThreadForCoin, getComments, addComment, getThread, uploadImage, getAllThreads } from './firebase.js';

dotenv.config();

// Initialize Firebase
initializeFirebase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const TOTAL_LAUNCH_COST = 0.05; // Total SOL cost to user
const PUMP_FUN_FEE = 0.02; // Approximate pump.fun creation fee
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || '9Y3vdkR8fyauAQkxgJenpqKu9qK2mXuxzyXp8DaK4jJu'; // Platform fee recipient
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

console.log('🔧 MOCK_MODE:', MOCK_MODE);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// Solana connection
const connection = new Connection(RPC_URL, 'confirmed');

// In-memory cache for pump.fun data
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// Convert IPFS URLs to HTTP gateway URLs
function convertIpfsUrl(url) {
  if (!url) return url;

  // Extract IPFS hash from various URL formats
  let ipfsHash = null;

  if (url.startsWith('ipfs://')) {
    ipfsHash = url.replace('ipfs://', '');
  } else if (url.startsWith('https://ipfs.io/ipfs/')) {
    ipfsHash = url.replace('https://ipfs.io/ipfs/', '');
  } else if (url.startsWith('https://cloudflare-ipfs.com/ipfs/')) {
    ipfsHash = url.replace('https://cloudflare-ipfs.com/ipfs/', '');
  } else if (url.startsWith('mock://ipfs/')) {
    const mint = url.replace('mock://ipfs/', '');
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (projectId && projectId !== 'your-project-id') {
      return `https://storage.googleapis.com/${projectId}.firebasestorage.app/tokens/${mint}.png`;
    }
  }

  // If we found an IPFS hash, use our image proxy
  if (ipfsHash) {
    return `/api/image/${ipfsHash}`;
  }

  return url;
}

// Fetch coin data from pump.fun
async function fetchPumpFunData(mint) {
  const key = `pumpfun:${mint}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const response = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
    if (response.ok) {
      const data = await response.json();
      cacheSet(key, data, 5000); // 5s cache
      return data;
    }
  } catch (err) {
    console.error('Error fetching pump.fun data:', err);
  }
  return null;
}

// ===== LAUNCH ENDPOINTS =====

// Step 1: Prepare token (upload to IPFS, generate keypairs)
app.post('/api/launch/prepare', async (req, res) => {
  try {
    const { wallet, name, symbol, description, image, creatorUsername, twitter, devBuy } = req.body;
    const devBuyAmount = parseFloat(devBuy) || 0;

    if (!wallet || !name || !symbol || !image || !creatorUsername) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Convert base64 image to blob
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    let imageType = 'image/png';
    if (image.startsWith('data:image/jpeg')) imageType = 'image/jpeg';
    else if (image.startsWith('data:image/gif')) imageType = 'image/gif';
    else if (image.startsWith('data:image/webp')) imageType = 'image/webp';

    // Generate keypairs
    const mintKeypair = Keypair.generate();
    const creatorKeypair = Keypair.generate();
    const tokenMint = mintKeypair.publicKey.toString();

    let metadataUri;
    let imageUrl;

    if (MOCK_MODE) {
      // Mock mode: Upload to Firebase Storage for testing
      console.log('🔧 MOCK MODE: Uploading to Firebase Storage');
      imageUrl = await uploadImage(imageBuffer, tokenMint, imageType);
      // In mock mode, use the real Firebase Storage URL if available
      metadataUri = imageUrl || `mock://ipfs/${tokenMint}`;
      console.log('Image uploaded:', imageUrl);
    } else {
      // Upload to pump.fun IPFS using multipart/form-data
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const formParts = [];

      // Add file
      formParts.push(`--${boundary}\r\n`);
      formParts.push(`Content-Disposition: form-data; name="file"; filename="token.png"\r\n`);
      formParts.push(`Content-Type: ${imageType}\r\n\r\n`);
      formParts.push(imageBuffer);
      formParts.push('\r\n');

      // Add other fields
      const fields = {
        name,
        symbol,
        description: description || '',
        twitter: twitter || '',
        telegram: '',
        website: '',
        showName: 'true'
      };

      for (const [key, value] of Object.entries(fields)) {
        formParts.push(`--${boundary}\r\n`);
        formParts.push(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
        formParts.push(`${value}\r\n`);
      }

      formParts.push(`--${boundary}--\r\n`);

      // Combine all parts
      const bodyParts = formParts.map(part =>
        typeof part === 'string' ? Buffer.from(part) : part
      );
      const body = Buffer.concat(bodyParts);

      console.log('Uploading to IPFS...');
      const ipfsResponse = await fetch('https://pump.fun/api/ipfs', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        body: body
      });

      if (!ipfsResponse.ok) {
        const errorText = await ipfsResponse.text();
        console.error('IPFS upload failed:', errorText);
        return res.status(500).json({ success: false, error: 'IPFS upload failed' });
      }

      const ipfsData = await ipfsResponse.json();
      metadataUri = ipfsData.metadataUri;
      console.log('IPFS metadata uploaded:', metadataUri);

      // Fetch the metadata to get the actual image URL
      // Try multiple gateways since content might not have propagated yet
      let ipfsHash = metadataUri;
      // Strip any gateway prefix to get just the hash
      ipfsHash = ipfsHash.replace('ipfs://', '');
      ipfsHash = ipfsHash.replace('https://ipfs.io/ipfs/', '');
      ipfsHash = ipfsHash.replace('https://cloudflare-ipfs.com/ipfs/', '');
      ipfsHash = ipfsHash.replace('https://gateway.pinata.cloud/ipfs/', '');
      const metadataGateways = [
        `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
        `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`,
        `https://ipfs.io/ipfs/${ipfsHash}`
      ];

      let metadataFetched = false;
      for (const gateway of metadataGateways) {
        try {
          console.log(`Attempting to fetch metadata from ${gateway}...`);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000); // 10 sec timeout

          const metadataResponse = await fetch(gateway, { signal: controller.signal });
          clearTimeout(timeout);

          if (metadataResponse.ok) {
            const metadata = await metadataResponse.json();
            imageUrl = metadata.image; // Extract actual image URL from metadata
            console.log('✅ Image URL extracted from metadata:', imageUrl);
            metadataFetched = true;
            break;
          }
        } catch (error) {
          console.log(`   Gateway failed: ${error.message}`);
        }
      }

      if (!metadataFetched) {
        imageUrl = metadataUri; // Fallback to metadata URI
        console.log('⚠️  All gateways failed, using metadata URI as fallback');
      }
    }

    // Store in temporary cache (will be replaced by Firebase later)
    cacheSet(`pending:${tokenMint}`, {
      mint: tokenMint,
      name,
      symbol,
      description,
      image: imageUrl, // Actual image URL extracted from IPFS metadata
      imageDataUrl: MOCK_MODE && !imageUrl ? image : (MOCK_MODE ? imageUrl : null), // Store base64/URL for mock mode display
      creatorWallet: creatorKeypair.publicKey.toString(), // Fixed: use creator keypair, not user wallet
      userWallet: wallet, // Store user wallet separately for reference
      creatorUsername,
      twitter: twitter || '',
      creatorPrivateKey: bs58.encode(creatorKeypair.secretKey),
      mintPrivateKey: bs58.encode(mintKeypair.secretKey),
      metadataUri,
      devBuyAmount
    }, 600000); // 10 min expiry

    const totalCost = MOCK_MODE ? 0 : (TOTAL_LAUNCH_COST + devBuyAmount);

    res.json({
      success: true,
      tokenMint,
      creatorWallet: creatorKeypair.publicKey.toString(),
      totalCost,
      metadataUri,
      devBuyAmount,
      mockMode: MOCK_MODE
    });

  } catch (error) {
    console.error('Prepare error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Step 2: Create funding transaction
app.post('/api/launch/create', async (req, res) => {
  try {
    const { wallet, tokenMint } = req.body;

    if (!wallet || !tokenMint) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const tokenData = cacheGet(`pending:${tokenMint}`);
    if (!tokenData) {
      return res.status(404).json({ success: false, error: 'Token not found or expired' });
    }

    if (MOCK_MODE) {
      // Mock mode: skip transaction
      console.log('🔧 MOCK MODE: Skipping transaction creation');
      return res.json({
        success: true,
        transaction: 'MOCK_TRANSACTION',
        tokenMint,
        creatorWallet: tokenData.creatorWallet,
        message: 'Mock transaction (no wallet approval needed)',
        mockMode: true
      });
    }

    const userPubkey = new PublicKey(wallet);
    const creatorPubkey = new PublicKey(tokenData.creatorWallet);

    // Build transaction: user sends SOL to creator wallet
    const transaction = new Transaction();

    const devBuyAmount = tokenData.devBuyAmount || 0;
    const totalCost = TOTAL_LAUNCH_COST + devBuyAmount;
    const fundingAmount = Math.ceil(totalCost * LAMPORTS_PER_SOL);

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: creatorPubkey,
        lamports: fundingAmount
      })
    );

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    // Send transfer parameters instead of raw instruction data
    const txData = {
      recentBlockhash: blockhash,
      feePayer: userPubkey.toString(),
      transfer: {
        fromPubkey: userPubkey.toString(),
        toPubkey: creatorPubkey.toString(),
        lamports: fundingAmount
      }
    };

    console.log('Sending transaction data:');
    console.log('  User wallet (FROM):', userPubkey.toString());
    console.log('  Creator wallet (TO):', creatorPubkey.toString());
    console.log('  Platform fee: 0.05 SOL, Dev buy:', devBuyAmount, 'SOL');
    console.log('  Total amount:', fundingAmount / LAMPORTS_PER_SOL, 'SOL');

    res.json({
      success: true,
      transactionData: txData,
      tokenMint,
      creatorWallet: tokenData.creatorWallet,
      message: 'Approve the transaction in your wallet'
    });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Step 3: Confirm payment and deploy token
app.post('/api/launch/confirm', async (req, res) => {
  try {
    const { tokenMint, signature } = req.body;

    if (!tokenMint || !signature) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const tokenData = cacheGet(`pending:${tokenMint}`);
    if (!tokenData) {
      return res.status(404).json({ success: false, error: 'Token not found or expired' });
    }

    let createSignature;

    if (MOCK_MODE) {
      // Mock mode: skip blockchain operations
      console.log('🔧 MOCK MODE: Skipping payment verification and token deployment');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
      createSignature = 'MOCK_' + Math.random().toString(36).substr(2, 9);
    } else {
      // Wait for transaction confirmation
      console.log(`Waiting for payment confirmation: ${signature}`);

      try {
        // Wait for transaction to be confirmed on-chain
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        if (confirmation.value.err) {
          console.error('Transaction failed:', confirmation.value.err);
          return res.status(400).json({ success: false, error: 'Payment transaction failed' });
        }
        console.log('✅ Payment transaction confirmed');
      } catch (error) {
        console.error('Error confirming payment:', error);
        return res.status(400).json({ success: false, error: 'Payment confirmation failed' });
      }

      // Verify creator wallet has funds
      const creatorKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.creatorPrivateKey));
      const balance = await connection.getBalance(creatorKeypair.publicKey);

      console.log(`Creator wallet: ${creatorKeypair.publicKey.toString()}`);
      console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
      console.log(`Required: 0.01 SOL`);
      console.log(`Transaction signature: ${signature}`);

      if (balance < 0.01 * LAMPORTS_PER_SOL) {
        return res.status(400).json({
          success: false,
          error: `Payment not received. Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL. Check transaction: https://solscan.io/tx/${signature}`
        });
      }

      // Create token via PumpPortal
      const mintKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.mintPrivateKey));

      const devBuyAmount = tokenData.devBuyAmount || 0;
      console.log(`Creating token on pump.fun... (dev buy: ${devBuyAmount} SOL)`);
      const createResponse = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: creatorKeypair.publicKey.toString(),
          action: 'create',
          tokenMetadata: {
            name: tokenData.name,
            symbol: tokenData.symbol,
            uri: tokenData.metadataUri
          },
          mint: mintKeypair.publicKey.toString(),
          denominatedInSol: 'true',
          amount: devBuyAmount,
          slippage: 15,
          priorityFee: 0.0005,
          pool: 'pump'
        })
      });

      if (createResponse.status !== 200) {
        const errorText = await createResponse.text();
        console.error('PumpPortal error:', errorText);
        return res.status(500).json({ success: false, error: 'Token creation failed' });
      }

      const txData = await createResponse.arrayBuffer();
      const createTx = VersionedTransaction.deserialize(new Uint8Array(txData));
      createTx.sign([creatorKeypair, mintKeypair]);

      createSignature = await connection.sendTransaction(createTx, {
        skipPreflight: false,
        maxRetries: 3
      });
    }

    // Confirm transaction (skip in mock mode)
    if (!MOCK_MODE) {
      const confirmation = await connection.confirmTransaction(createSignature, 'confirmed');
      if (confirmation.value.err) {
        console.error('Transaction failed:', confirmation.value.err);
        return res.status(500).json({ success: false, error: 'Transaction failed on-chain' });
      }
    }

    console.log(`Token created! TX: ${createSignature}`);

    // Transfer dev buy tokens from creator wallet to user's wallet
    if (!MOCK_MODE && tokenData.devBuyAmount > 0 && tokenData.userWallet) {
      try {
        // Wait for token creation to fully settle on-chain
        console.log('Waiting for token accounts to settle...');
        await new Promise(resolve => setTimeout(resolve, 15000));

        const creatorKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.creatorPrivateKey));
        const mintKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.mintPrivateKey));
        const userPubkey = new PublicKey(tokenData.userWallet);
        const mintPubkey = mintKeypair.publicKey;

        // Detect which token program the mint uses (SPL Token vs Token2022)
        const mintAccountInfo = await connection.getAccountInfo(mintPubkey);
        const tokenProgramId = mintAccountInfo.owner;
        console.log(`Token program: ${tokenProgramId.toString()}`);

        // Get creator's token account
        const creatorTokenAccount = await getAssociatedTokenAddress(mintPubkey, creatorKeypair.publicKey, false, tokenProgramId);

        // Get/create user's token account
        const userTokenAccount = await getAssociatedTokenAddress(mintPubkey, userPubkey, false, tokenProgramId);

        // Retry getting token balance (account may take time to appear)
        let tokenBalance;
        for (let i = 0; i < 5; i++) {
          try {
            tokenBalance = await connection.getTokenAccountBalance(creatorTokenAccount);
            break;
          } catch (e) {
            console.log(`Token account not ready yet, retry ${i + 1}/5...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
        if (!tokenBalance) throw new Error('Token account never appeared');
        const amount = BigInt(tokenBalance.value.amount);

        if (amount > 0n) {
          const transferTx = new Transaction();

          // Create user's associated token account if it doesn't exist
          try {
            await connection.getTokenAccountBalance(userTokenAccount);
          } catch {
            // Account doesn't exist, create it
            transferTx.add(
              createAssociatedTokenAccountInstruction(
                creatorKeypair.publicKey, // payer
                userTokenAccount,         // associated token account
                userPubkey,               // owner
                mintPubkey,               // mint
                tokenProgramId            // token program
              )
            );
          }

          // Transfer all tokens to user
          transferTx.add(
            createTransferInstruction(
              creatorTokenAccount,       // from
              userTokenAccount,          // to
              creatorKeypair.publicKey,  // authority
              amount,                    // amount
              [],                        // multiSigners
              tokenProgramId             // token program
            )
          );

          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          transferTx.recentBlockhash = blockhash;
          transferTx.feePayer = creatorKeypair.publicKey;

          const transferSig = await connection.sendTransaction(transferTx, [creatorKeypair]);
          console.log(`✅ Dev buy tokens transferred to user wallet: ${transferSig}`);
          console.log(`   Amount: ${tokenBalance.value.uiAmountString} tokens → ${tokenData.userWallet}`);
        }
      } catch (error) {
        console.error('Error transferring dev buy tokens:', error.message);
        // Don't fail the launch if token transfer fails
      }
    }

    // Send leftover funds to platform wallet (skip in mock mode)
    if (!MOCK_MODE) {
      try {
        const creatorKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.creatorPrivateKey));
        const platformPubkey = new PublicKey(PLATFORM_WALLET);

        // Get remaining balance
        const balance = await connection.getBalance(creatorKeypair.publicKey);
        console.log(`Creator wallet balance after token creation: ${balance / LAMPORTS_PER_SOL} SOL`);

        // Reserve 0.001 SOL (1000000 lamports) for rent + transaction fee
        const reserveAmount = 1000000;
        const amountToSend = balance - reserveAmount;

        // Only send if there's a meaningful amount left (at least 0.001 SOL)
        if (amountToSend > 1000000) {
          const withdrawTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: creatorKeypair.publicKey,
              toPubkey: platformPubkey,
              lamports: amountToSend
            })
          );

          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          withdrawTx.recentBlockhash = blockhash;
          withdrawTx.feePayer = creatorKeypair.publicKey;

          const withdrawSig = await connection.sendTransaction(withdrawTx, [creatorKeypair]);
          console.log(`✅ Platform fee collected: ${amountToSend / LAMPORTS_PER_SOL} SOL (TX: ${withdrawSig})`);
        } else {
          console.log(`⚠️  Insufficient balance for platform fee collection. Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
        }
      } catch (error) {
        console.error('Error collecting platform fee:', error.message);
        // Don't fail the entire operation if fee collection fails
      }
    }

    // Create Firebase thread
    await createThreadForCoin(tokenMint, tokenData);

    res.json({
      success: true,
      tokenMint,
      signature: createSignature,
      threadUrl: `/thread/${tokenMint}`
    });

  } catch (error) {
    console.error('Confirm error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== COIN DATA ENDPOINTS =====

// ===== THREADS LIST ENDPOINT =====

// Get all threads (for coin list)
app.get('/api/threads', async (req, res) => {
  try {
    const threads = await getAllThreads(100);

    // Enrich with cached data (for recent launches with imageDataUrl)
    const enrichedThreads = threads.map(thread => {
      const cachedData = cacheGet(`pending:${thread.mint}`);
      // Priority: cached base64 > stored imageDataUrl > converted IPFS/Firebase Storage URL
      const imageUrl = cachedData?.imageDataUrl || thread.imageDataUrl || convertIpfsUrl(thread.image);
      return {
        ...thread,
        image: imageUrl,
        // Get stats from pump.fun if available (we'll do this client-side for performance)
      };
    });

    res.json({ success: true, threads: enrichedThreads });
  } catch (error) {
    console.error('Error getting threads:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Image proxy to avoid CORS issues with IPFS
app.get('/api/image/:hash', async (req, res) => {
  try {
    const { hash } = req.params;

    // Try multiple IPFS gateways with longer timeout
    const gateways = [
      `https://ipfs.io/ipfs/${hash}`,
      `https://gateway.pinata.cloud/ipfs/${hash}`,
      `https://cloudflare-ipfs.com/ipfs/${hash}`,
      `https://dweb.link/ipfs/${hash}`,
      `https://nftstorage.link/ipfs/${hash}`
    ];

    for (const url of gateways) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });
        clearTimeout(timeout);

        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const contentType = response.headers.get('content-type') || 'image/png';

          console.log(`✅ Image ${hash} loaded from ${url}`);
          console.log(`   Content-Type: ${contentType}, Size: ${buffer.byteLength} bytes`);

          if (buffer.byteLength === 0) {
            console.error(`❌ Empty buffer received for ${hash}`);
            continue; // Try next gateway
          }

          res.set('Content-Type', contentType);
          res.set('Cache-Control', 'public, max-age=31536000');
          res.set('Content-Length', buffer.byteLength);
          return res.send(Buffer.from(buffer));
        }
      } catch (err) {
        console.log(`Gateway ${url} failed: ${err.message}`);
      }
    }

    console.error(`❌ All gateways failed for image ${hash}`);
    // Return a placeholder image instead of 404
    res.redirect('https://via.placeholder.com/200x200/d3dce3/476C8E?text=💎');
  } catch (error) {
    console.error('Image proxy error:', error.message);
    res.status(500).send('Failed to fetch image');
  }
});

// Fetch coin market data from pump.fun APIs
async function fetchPumpMarketData(mintAddress) {
  try {
    // Fetch from both pump.fun APIs in parallel
    const [v3Res, advRes] = await Promise.allSettled([
      fetch(`https://frontend-api-v3.pump.fun/coins/${mintAddress}`),
      fetch(`https://advanced-api-v2.pump.fun/coins/metadata/${mintAddress}`)
    ]);

    let marketCap = 0;
    let volume = 0;
    let holders = 0;
    let priceUsd = 0;
    let graduated = false;

    // v3 API: best source for USD market cap
    let solPriceUsd = 0;
    if (v3Res.status === 'fulfilled' && v3Res.value.ok) {
      const v3Data = await v3Res.value.json();
      marketCap = parseFloat(v3Data.usd_market_cap || 0);
      graduated = v3Data.complete || false;
      // Derive SOL price from v3 data to convert volume
      const mcSol = parseFloat(v3Data.market_cap || 0);
      if (mcSol > 0) solPriceUsd = marketCap / mcSol;
    }

    // Advanced API: volume, holders, trades
    if (advRes.status === 'fulfilled' && advRes.value.ok) {
      const advData = await advRes.value.json();
      const volumeSol = parseFloat(advData.volume || 0);
      volume = solPriceUsd > 0 ? volumeSol * solPriceUsd : volumeSol;
      holders = parseInt(advData.num_holders_v2 || advData.num_holders || 0);
      // If v3 didn't give us market cap, use advanced API
      if (!marketCap) {
        marketCap = parseFloat(advData.marketcap || 0);
      }
    }

    console.log(`Pump.fun data for ${mintAddress}: MC=$${marketCap.toFixed(2)}, Vol=${volume}, Holders=${holders}`);

    return { marketCap, volume, holders, priceUsd, graduated };
  } catch (error) {
    console.error('Error fetching pump.fun data:', error.message);
    return null;
  }
}

// Get coin data from pump.fun APIs
app.get('/api/coin/:mint', async (req, res) => {
  try {
    const { mint } = req.params;

    // Fetch market data from pump.fun
    const marketData = await fetchPumpMarketData(mint);

    // Get token metadata from Firebase
    const thread = await getThread(mint);

    if (!thread) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    res.json({
      success: true,
      mint: thread.mint,
      name: thread.name,
      symbol: thread.symbol,
      description: thread.description,
      image: convertIpfsUrl(thread.image),
      creatorUsername: thread.creatorUsername,
      twitter: thread.twitter,
      marketCap: marketData?.marketCap || 0,
      volume24h: marketData?.volume || 0,
      priceUsd: marketData?.priceUsd || 0,
      holders: marketData?.holders || 0,
      graduated: marketData?.graduated || false,
      createdAt: thread.createdAt?._seconds || thread.createdAt
    });
  } catch (error) {
    console.error('Error fetching coin data:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch coin data' });
  }
});

// ===== COMMENT ENDPOINTS =====

// Get comments for a thread
app.get('/api/thread/:mint/comments', async (req, res) => {
  try {
    const { mint } = req.params;
    const comments = await getComments(mint);
    res.json({ success: true, comments });
  } catch (error) {
    console.error('Error getting comments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Post a comment
app.post('/api/thread/:mint/comment', async (req, res) => {
  try {
    const { mint } = req.params;
    const { username, text } = req.body;

    if (!username || !text) {
      return res.status(400).json({ success: false, error: 'Missing username or text' });
    }

    const commentId = await addComment(mint, username, text);
    res.json({ success: true, commentId });
  } catch (error) {
    console.error('Error posting comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== ADMIN ENDPOINTS =====

// Add a token thread manually (for tokens launched outside the site)
app.post('/api/admin/add-thread', async (req, res) => {
  try {
    // Verify admin secret
    const secret = req.headers['x-admin-secret'];
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { mint, name, symbol, description, image, creatorUsername, twitter } = req.body;

    if (!mint || !name || !symbol) {
      return res.status(400).json({ success: false, error: 'Missing required fields: mint, name, symbol' });
    }

    // Check if thread already exists
    const existing = await getThread(mint);
    if (existing) {
      return res.status(409).json({ success: false, error: 'Thread already exists for this mint' });
    }

    // Create thread in Firebase
    await createThreadForCoin(mint, {
      name,
      symbol,
      description: description || '',
      image: image || '',
      creatorUsername: creatorUsername || 'Admin',
      twitter: twitter || ''
    });

    console.log(`[Admin] Thread created for ${name} (${symbol}) - ${mint}`);

    res.json({
      success: true,
      threadUrl: `/thread/${mint}`,
      message: `Thread created for ${name} (${symbol})`
    });
  } catch (error) {
    console.error('Admin add-thread error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== ROUTES =====

// Landing page
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Thread page
app.get('/thread/:mint', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'thread.html'));
});

// Start server
const httpServer = createServer(app);
initWebSockets(httpServer, fetchPumpMarketData);
httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║  Bitcointalk Launchpad Server             ║
║  http://localhost:${PORT}                   ║
╚═══════════════════════════════════════════╝
  `);
});
