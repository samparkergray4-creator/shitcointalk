import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { initializeFirebase, createThreadForCoin, getComments, addComment } from './firebase.js';

dotenv.config();

// Initialize Firebase
initializeFirebase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const PLATFORM_FEE = 0.05; // SOL fee for launching

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
    const { wallet, name, symbol, description, image } = req.body;

    if (!wallet || !name || !symbol || !image) {
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

    // Upload to pump.fun IPFS
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: imageType }), 'token.png');
    formData.append('name', name);
    formData.append('symbol', symbol);
    formData.append('description', description || '');
    formData.append('twitter', '');
    formData.append('telegram', '');
    formData.append('website', `${req.protocol}://${req.get('host')}/thread/${tokenMint}`);
    formData.append('showName', 'true');

    console.log('Uploading to IPFS...');
    const ipfsResponse = await fetch('https://pump.fun/api/ipfs', {
      method: 'POST',
      body: formData
    });

    if (!ipfsResponse.ok) {
      const errorText = await ipfsResponse.text();
      console.error('IPFS upload failed:', errorText);
      return res.status(500).json({ success: false, error: 'IPFS upload failed' });
    }

    const ipfsData = await ipfsResponse.json();
    console.log('IPFS upload successful:', ipfsData.metadataUri);

    // Store in temporary cache (will be replaced by Firebase later)
    cacheSet(`pending:${tokenMint}`, {
      mint: tokenMint,
      name,
      symbol,
      description,
      image: ipfsData.metadataUri,
      creatorWallet: wallet,
      creatorPrivateKey: bs58.encode(creatorKeypair.secretKey),
      mintPrivateKey: bs58.encode(mintKeypair.secretKey),
      metadataUri: ipfsData.metadataUri
    }, 600000); // 10 min expiry

    const totalCost = 0.02 + PLATFORM_FEE; // ~0.02 for creation + platform fee

    res.json({
      success: true,
      tokenMint,
      creatorWallet: creatorKeypair.publicKey.toString(),
      totalCost,
      metadataUri: ipfsData.metadataUri
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

    const userPubkey = new PublicKey(wallet);
    const creatorPubkey = new PublicKey(tokenData.creatorWallet);

    // Build transaction: user sends SOL to creator wallet
    const transaction = new Transaction();

    const fundingAmount = Math.ceil((0.02 + PLATFORM_FEE) * LAMPORTS_PER_SOL);

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

    const serializedTx = Buffer.from(
      transaction.serialize({ requireAllSignatures: false })
    ).toString('base64');

    res.json({
      success: true,
      transaction: serializedTx,
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

    // Wait for confirmation
    console.log(`Waiting for payment confirmation: ${signature}`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify creator wallet has funds
    const creatorKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.creatorPrivateKey));
    const balance = await connection.getBalance(creatorKeypair.publicKey);

    if (balance < 0.01 * LAMPORTS_PER_SOL) {
      return res.status(400).json({ success: false, error: 'Payment not confirmed yet' });
    }

    // Create token via PumpPortal
    const mintKeypair = Keypair.fromSecretKey(bs58.decode(tokenData.mintPrivateKey));

    console.log('Creating token on pump.fun...');
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
        amount: 0, // No initial buy
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

    const createSignature = await connection.sendTransaction(createTx, {
      skipPreflight: false,
      maxRetries: 3
    });

    const confirmation = await connection.confirmTransaction(createSignature, 'confirmed');
    if (confirmation.value.err) {
      console.error('Transaction failed:', confirmation.value.err);
      return res.status(500).json({ success: false, error: 'Transaction failed on-chain' });
    }

    console.log(`Token created! TX: ${createSignature}`);

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

// Get coin data
app.get('/api/coin/:mint', async (req, res) => {
  const { mint } = req.params;

  const coinData = await fetchPumpFunData(mint);
  if (!coinData) {
    return res.status(404).json({ error: 'Coin not found' });
  }

  res.json({
    mint,
    name: coinData.name,
    symbol: coinData.symbol,
    description: coinData.description,
    image: coinData.image_uri,
    marketCap: coinData.usd_market_cap,
    volume24h: coinData.volume_24h,
    priceUsd: coinData.price_usd,
    holders: coinData.holder_count || 0,
    createdAt: coinData.created_timestamp
  });
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
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║  Bitcointalk Launchpad Server             ║
║  http://localhost:${PORT}                   ║
╚═══════════════════════════════════════════╝
  `);
});
