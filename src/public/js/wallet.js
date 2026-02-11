// Simple wallet connection utility for Phantom

let walletAddress = null;

async function connectWallet() {
  try {
    if (!window.solana || !window.solana.isPhantom) {
      throw new Error('Phantom wallet not found. Please install it from phantom.app');
    }

    const resp = await window.solana.connect();
    walletAddress = resp.publicKey.toString();
    console.log('Connected wallet:', walletAddress);
    return walletAddress;
  } catch (error) {
    console.error('Wallet connection failed:', error);
    throw error;
  }
}

async function signTransaction(transactionData) {
  try {
    if (!window.solana || !walletAddress) {
      throw new Error('Wallet not connected');
    }

    console.log('Received transaction data:');
    console.log('  FROM:', transactionData.transfer.fromPubkey);
    console.log('  TO:', transactionData.transfer.toPubkey);
    console.log('  Amount:', transactionData.transfer.lamports / solanaWeb3.LAMPORTS_PER_SOL, 'SOL');

    // Build transaction with proper SystemProgram.transfer instruction
    const transaction = new solanaWeb3.Transaction();
    transaction.recentBlockhash = transactionData.recentBlockhash;
    transaction.feePayer = new solanaWeb3.PublicKey(transactionData.feePayer);

    // Add transfer instruction using SystemProgram (ensures correct encoding)
    transaction.add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: new solanaWeb3.PublicKey(transactionData.transfer.fromPubkey),
        toPubkey: new solanaWeb3.PublicKey(transactionData.transfer.toPubkey),
        lamports: transactionData.transfer.lamports
      })
    );

    console.log('Transaction built successfully');
    console.log('  feePayer:', transaction.feePayer.toString());
    console.log('  Instruction keys:', transaction.instructions[0].keys.map(k => ({
      pubkey: k.pubkey.toString(),
      isSigner: k.isSigner,
      isWritable: k.isWritable
    })));

    // Sign and send with Phantom
    const { signature } = await window.solana.signAndSendTransaction(transaction);

    console.log('Transaction sent:', signature);
    return signature;
  } catch (error) {
    console.error('Transaction failed:', error);
    throw error;
  }
}

function showStatus(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;

  const div = document.createElement('div');
  div.className = `status-msg ${type}`;
  // If message contains HTML tags (intentional markup), use innerHTML; otherwise use textContent
  if (message.includes('<a ') || message.includes('<strong>') || message.includes('<br')) {
    div.innerHTML = message;
  } else {
    div.textContent = message;
  }
  el.innerHTML = '';
  el.appendChild(div);
}

function clearStatus(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = '';
}
