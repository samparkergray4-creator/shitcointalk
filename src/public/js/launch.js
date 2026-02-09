// Launch form handler

document.getElementById('launchForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('launchBtn');
  const originalText = btn.textContent;
  btn.disabled = true;

  try {
    // Step 0: Connect wallet
    showStatus('statusMsg', 'Connecting wallet...', 'info');
    const wallet = await connectWallet();

    // Step 1: Collect form data
    const name = document.getElementById('name').value.trim();
    const symbol = document.getElementById('symbol').value.trim().toUpperCase();
    const description = document.getElementById('description').value.trim();
    const imageFile = document.getElementById('image').files[0];

    if (!imageFile) {
      throw new Error('Please select an image');
    }

    // Convert image to base64
    showStatus('statusMsg', 'Uploading image...', 'info');
    const imageBase64 = await fileToBase64(imageFile);

    // Step 2: Prepare token (upload to IPFS)
    showStatus('statusMsg', 'Preparing token metadata...', 'info');
    const prepareRes = await fetch('/api/launch/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, name, symbol, description, image: imageBase64 })
    });

    const prepareData = await prepareRes.json();
    if (!prepareData.success) {
      throw new Error(prepareData.error);
    }

    console.log('Token prepared:', prepareData);

    // Step 3: Create funding transaction
    showStatus('statusMsg', 'Building transaction...', 'info');
    const createRes = await fetch('/api/launch/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, tokenMint: prepareData.tokenMint })
    });

    const createData = await createRes.json();
    if (!createData.success) {
      throw new Error(createData.error);
    }

    // Step 4: Sign and send transaction
    showStatus('statusMsg', 'Please approve the transaction in your wallet...', 'info');

    // Decode and send transaction via Phantom
    const txBuffer = Uint8Array.from(atob(createData.transaction), c => c.charCodeAt(0));
    const { signature } = await window.solana.signAndSendTransaction(
      window.solana.constructor.Transaction.from(txBuffer)
    );

    console.log('Payment signature:', signature);

    // Step 5: Confirm and deploy token
    showStatus('statusMsg', 'Deploying token on pump.fun... (this may take ~15 seconds)', 'info');
    btn.innerHTML = 'Deploying... <span class="spinner"></span>';

    const confirmRes = await fetch('/api/launch/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenMint: prepareData.tokenMint, signature })
    });

    const confirmData = await confirmRes.json();
    if (!confirmData.success) {
      throw new Error(confirmData.error);
    }

    // Success!
    showStatus('statusMsg', `
      <strong>Success!</strong> Your token has been launched!<br>
      <a href="${confirmData.threadUrl}" style="font-weight: bold;">View Discussion Thread →</a>
    `, 'success');

    // Clear form
    document.getElementById('launchForm').reset();

    // Redirect after 3 seconds
    setTimeout(() => {
      window.location.href = confirmData.threadUrl;
    }, 3000);

  } catch (error) {
    console.error('Launch error:', error);
    showStatus('statusMsg', `Error: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// Helper: Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Load recent coins (placeholder - will use Firebase later)
async function loadRecentCoins() {
  // TODO: Fetch from Firebase
  // For now, show empty state
  const tbody = document.getElementById('coinsList');
  tbody.innerHTML = `
    <tr>
      <td colspan="5" style="text-align: center; padding: 20px; color: #666;">
        No coins launched yet. Be the first!
      </td>
    </tr>
  `;
}

// Load coins on page load
loadRecentCoins();
