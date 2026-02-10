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

async function signTransaction(transactionBase64) {
  try {
    if (!window.solana || !walletAddress) {
      throw new Error('Wallet not connected');
    }

    // Decode base64 transaction using web3.js
    const transactionBuffer = Uint8Array.from(atob(transactionBase64), c => c.charCodeAt(0));
    const transaction = solanaWeb3.Transaction.from(transactionBuffer);

    console.log('Transaction feePayer:', transaction.feePayer.toString());
    console.log('Transaction instructions:', transaction.instructions.length);
    if (transaction.instructions[0]) {
      const ix = transaction.instructions[0];
      console.log('Instruction keys:', ix.keys.map(k => ({ pubkey: k.pubkey.toString(), isSigner: k.isSigner, isWritable: k.isWritable })));
    }

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

  el.innerHTML = `<div class="status-msg ${type}">${message}</div>`;
}

function clearStatus(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = '';
}
