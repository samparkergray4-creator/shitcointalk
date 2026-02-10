import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import { Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
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
  if (url.startsWith('ipfs://')) {
    const ipfsHash = url.replace('ipfs://', '');
    // Use cloudflare IPFS gateway (faster and more reliable)
    return `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`;
  }
  // Also convert existing ipfs.io URLs to cloudflare
  if (url.startsWith('https://ipfs.io/ipfs/')) {
    const ipfsHash = url.replace('https://ipfs.io/ipfs/', '');
    return `https://cloudflare-ipfs.com/ipfs/${ipfsHash}`;
  }
  // Convert mock URLs to Firebase Storage URLs
  if (url.startsWith('mock://ipfs/')) {
    const mint = url.replace('mock://ipfs/', '');
    // Construct Firebase Storage URL
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (projectId && projectId !== 'your-project-id') {
      return `https://storage.googleapis.com/${projectId}.firebasestorage.app/tokens/${mint}.png`;
    }
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
    const { wallet, name, symbol, description, image, creatorUsername, twitter } = req.body;

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
        twitter: '',
        telegram: '',
        website: '', // Empty for now - will add shitcointalk.fun link later
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
      imageUrl = metadataUri;
      console.log('IPFS upload successful:', metadataUri);
    }

    // Store in temporary cache (will be replaced by Firebase later)
    cacheSet(`pending:${tokenMint}`, {
      mint: tokenMint,
      name,
      symbol,
      description,
      image: metadataUri, // Use metadataUri (mock or real IPFS) - for Firestore
      imageDataUrl: MOCK_MODE && !imageUrl ? image : (MOCK_MODE ? imageUrl : null), // Store base64/URL for mock mode display
      creatorWallet: creatorKeypair.publicKey.toString(), // Fixed: use creator keypair, not user wallet
      userWallet: wallet, // Store user wallet separately for reference
      creatorUsername,
      twitter: twitter || '',
      creatorPrivateKey: bs58.encode(creatorKeypair.secretKey),
      mintPrivateKey: bs58.encode(mintKeypair.secretKey),
      metadataUri
    }, 600000); // 10 min expiry

    const totalCost = MOCK_MODE ? 0 : TOTAL_LAUNCH_COST; // Free in mock mode

    res.json({
      success: true,
      tokenMint,
      creatorWallet: creatorKeypair.publicKey.toString(),
      totalCost,
      metadataUri,
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

    const fundingAmount = Math.ceil(TOTAL_LAUNCH_COST * LAMPORTS_PER_SOL);

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
    console.log('  Amount:', fundingAmount / LAMPORTS_PER_SOL, 'SOL');

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

// Get coin data
app.get('/api/coin/:mint', async (req, res) => {
  const { mint } = req.params;

  // Check cache first (for recently created tokens with imageDataUrl)
  const cachedData = cacheGet(`pending:${mint}`);

  // Try to fetch from pump.fun first
  const coinData = await fetchPumpFunData(mint);

  if (coinData) {
    // Real pump.fun data available
    return res.json({
      mint,
      name: coinData.name,
      symbol: coinData.symbol,
      description: coinData.description,
      image: convertIpfsUrl(coinData.image_uri),
      marketCap: coinData.usd_market_cap,
      volume24h: coinData.volume_24h,
      priceUsd: coinData.price_usd,
      holders: coinData.holder_count || 0,
      createdAt: coinData.created_timestamp
    });
  }

  // Fallback to Firebase data (for MOCK_MODE or if pump.fun is unavailable)
  const threadData = await getThread(mint);
  if (threadData) {
    // Priority: cached base64 > stored imageDataUrl > converted IPFS/Firebase Storage URL
    let imageUrl = cachedData?.imageDataUrl || threadData.imageDataUrl || convertIpfsUrl(threadData.image);

    return res.json({
      mint,
      name: threadData.name,
      symbol: threadData.symbol,
      description: threadData.description,
      image: imageUrl,
      creatorUsername: threadData.creatorUsername || 'Anonymous',
      twitter: threadData.twitter || '',
      marketCap: 0,
      volume24h: 0,
      priceUsd: 0,
      holders: 0,
      createdAt: threadData.createdAt?._seconds || Math.floor(Date.now() / 1000)
    });
  }

  return res.status(404).json({ error: 'Coin not found' });
});

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

// Get coin data from pump.fun
app.get('/api/coin/:mint', async (req, res) => {
  try {
    const { mint } = req.params;

    console.log(`Fetching coin data for ${mint}...`);

    // Fetch from pump.fun API
    const response = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    console.log(`Pump.fun API response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pump.fun API error:', errorText);
      return res.status(404).json({ success: false, error: 'Coin not found on pump.fun' });
    }

    const data = await response.json();
    console.log(`Coin data received:`, {
      name: data.name,
      marketCap: data.usd_market_cap,
      hasImage: !!data.image_uri
    });

    // Return formatted data
    res.json({
      success: true,
      mint: data.mint,
      name: data.name,
      symbol: data.symbol,
      description: data.description,
      image: convertIpfsUrl(data.image_uri),
      marketCap: data.usd_market_cap || 0,
      volume24h: data.volume_24h || 0,
      priceUsd: data.price || 0,
      creatorAddress: data.creator,
      twitter: data.twitter,
      telegram: data.telegram,
      website: data.website
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
