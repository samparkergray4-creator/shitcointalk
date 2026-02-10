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
    console.log('  feePayer:', transactionData.feePayer);
    console.log('  Instruction keys received:', transactionData.instructions[0].keys);

    // Rebuild transaction from JSON data (avoids serialization corruption)
    const transaction = new solanaWeb3.Transaction();
    transaction.recentBlockhash = transactionData.recentBlockhash;
    transaction.feePayer = new solanaWeb3.PublicKey(transactionData.feePayer);

    // Add the transfer instruction
    const instruction = transactionData.instructions[0];
    transaction.add(
      new solanaWeb3.TransactionInstruction({
        keys: instruction.keys.map(k => ({
          pubkey: new solanaWeb3.PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable
        })),
        programId: new solanaWeb3.PublicKey(instruction.programId),
        data: new Uint8Array(Object.values(instruction.data))
      })
    );

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
