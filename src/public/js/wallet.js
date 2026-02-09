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

    const transaction = window.solana.constructor.Transaction.from(
      Buffer.from(transactionBase64, 'base64')
    );

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
