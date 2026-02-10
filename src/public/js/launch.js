// Launch form handler

document.getElementById('launchForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.getElementById('launchBtn');
  const originalText = btn.textContent;
  btn.disabled = true;

  try {
    // Step 0: Connect Phantom wallet
    showStatus('statusMsg', 'Connecting to Phantom wallet...', 'info');
    const wallet = await connectWallet();
    console.log('Connected wallet address:', wallet);
    showStatus('statusMsg', `✅ Connected: ${wallet.substring(0, 4)}...${wallet.substring(wallet.length - 4)}`, 'success');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 1: Collect form data
    const creatorUsername = document.getElementById('creatorUsername').value.trim();
    const name = document.getElementById('name').value.trim();
    const symbol = document.getElementById('symbol').value.trim().toUpperCase();
    const description = document.getElementById('description').value.trim();
    const twitter = document.getElementById('twitter').value.trim();
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
      body: JSON.stringify({ wallet, name, symbol, description, image: imageBase64, creatorUsername, twitter })
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

    // Step 4: Sign and send transaction with Phantom
    showStatus('statusMsg', '💰 Please approve the transaction in Phantom (0.05 SOL)...', 'info');
    btn.innerHTML = 'Waiting for Phantom... <span class="spinner"></span>';

    const signature = await signTransaction(createData.transactionData);
    showStatus('statusMsg', '✅ Transaction confirmed!', 'success');
    console.log('Payment signature:', signature);
    await new Promise(resolve => setTimeout(resolve, 1000));

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

// Sorting and filtering state
let currentThreads = [];
let filteredThreads = [];
let sortColumn = 'date'; // Default sort by most recent
let sortDirection = 'desc';
let searchQuery = '';

// Load recent coins from Firebase
async function loadRecentCoins() {
  const tbody = document.getElementById('coinsList');

  try {
    const response = await fetch('/api/threads');
    const data = await response.json();

    if (!data.success || !data.threads || data.threads.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td class="windowbg" colspan="7" style="text-align: center; padding: 20px; color: #666;">
            No coins launched yet. Be the first!
          </td>
        </tr>
      `;
      return;
    }

    // Store threads for sorting
    currentThreads = data.threads;

    // Apply search filter if active
    applySearch();

    // Sort and render
    sortThreadsData();
    renderThreads();

  } catch (error) {
    console.error('Error loading coins:', error);
    tbody.innerHTML = `
      <tr>
        <td class="windowbg" colspan="7" style="text-align: center; padding: 20px; color: #999;">
          Error loading coins. Please refresh.
        </td>
      </tr>
    `;
  }
}

// Apply search filter
function applySearch() {
  if (!searchQuery) {
    filteredThreads = [...currentThreads];
    return;
  }

  const query = searchQuery.toLowerCase();
  filteredThreads = currentThreads.filter(thread => {
    return (
      thread.name?.toLowerCase().includes(query) ||
      thread.symbol?.toLowerCase().includes(query) ||
      thread.mint?.toLowerCase().includes(query) ||
      thread.creatorUsername?.toLowerCase().includes(query)
    );
  });
}

// Sort threads based on current sort column and direction
function sortThreadsData() {
  const threadsToSort = filteredThreads.length > 0 || searchQuery ? filteredThreads : currentThreads;

  threadsToSort.sort((a, b) => {
    let aVal, bVal;

    switch (sortColumn) {
      case 'mc':
        aVal = a.marketCap || 0;
        bVal = b.marketCap || 0;
        break;
      case 'volume':
        aVal = a.volume24h || 0;
        bVal = b.volume24h || 0;
        break;
      case 'replies':
        aVal = a.commentCount || 0;
        bVal = b.commentCount || 0;
        break;
      case 'date':
        aVal = a.createdAt?._seconds || 0;
        bVal = b.createdAt?._seconds || 0;
        break;
      default:
        return 0;
    }

    if (sortDirection === 'asc') {
      return aVal - bVal;
    } else {
      return bVal - aVal;
    }
  });

  // Update sort indicators
  ['mc', 'volume', 'replies', 'date'].forEach(col => {
    const indicator = document.getElementById(`sort-${col}`);
    if (indicator) {
      if (col === sortColumn) {
        indicator.textContent = sortDirection === 'asc' ? '▲' : '▼';
        indicator.style.color = '#476C8E';
      } else {
        indicator.textContent = '';
      }
    }
  });
}

// Fetch and update coin stats from pump.fun
async function updateCoinStats(mint) {
  try {
    const response = await fetch(`/api/coin/${mint}`);
    if (!response.ok) return;

    const coin = await response.json();

    // Update market cap
    const mcEl = document.getElementById(`mc-${mint}`);
    if (mcEl && coin.marketCap) {
      mcEl.textContent = '$' + formatNumber(coin.marketCap);
    }

    // Update volume
    const volEl = document.getElementById(`vol-${mint}`);
    if (volEl && coin.volume24h) {
      volEl.textContent = '$' + formatNumber(coin.volume24h);
    }
  } catch (error) {
    console.error('Error fetching stats for', mint, error);
  }
}

// Format large numbers (e.g., 1234567 -> "1.23M")
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  }
  return num.toFixed(2);
}

// Render threads to table
function renderThreads() {
  const tbody = document.getElementById('coinsList');
  const threadsToRender = filteredThreads.length > 0 || searchQuery ? filteredThreads : currentThreads;

  if (threadsToRender.length === 0 && searchQuery) {
    tbody.innerHTML = `
      <tr>
        <td class="windowbg" colspan="7" style="text-align: center; padding: 20px; color: #666;">
          No coins found matching "${escapeHtml(searchQuery)}"
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = threadsToRender.map((thread, idx) => {
      const bgClass = idx % 2 === 0 ? 'windowbg' : 'windowbg2';

      // Format timestamp
      let lastActivity = 'Just now';
      if (thread.createdAt?._seconds) {
        const date = new Date(thread.createdAt._seconds * 1000);
        lastActivity = formatDate(date);
      }

      // Format image - convert IPFS URLs and show if it's a real URL or data URL (not mock://)
      let imageUrl = thread.image;
      if (imageUrl && imageUrl.startsWith('ipfs://')) {
        const ipfsHash = imageUrl.replace('ipfs://', '');
        imageUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
      }
      const hasImage = imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:'));
      const imageHtml = hasImage
        ? `<img src="${imageUrl}" alt="${escapeHtml(thread.name)}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;" onerror="this.style.display='none';this.parentElement.innerHTML='<div style=\\'width: 40px; height: 40px; background: #d3dce3; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 20px;\\'>💎</div>';">`
        : `<div style="width: 40px; height: 40px; background: #d3dce3; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 20px;">💎</div>`;

      // Shorten address for display
      const shortAddress = thread.mint.substring(0, 4) + '...' + thread.mint.substring(thread.mint.length - 4);

      return `
        <tr class="${bgClass}">
          <td align="center" style="padding: 8px;">
            ${imageHtml}
          </td>
          <td style="padding: 8px;">
            <div style="font-weight: bold; font-size: 13px; margin-bottom: 2px;">
              <a href="/thread/${thread.mint}" style="color: #476C8E;">${escapeHtml(thread.name)} (${escapeHtml(thread.symbol)})</a>
            </div>
            <div style="font-size: 10px; color: #666;">
              by <b>${escapeHtml(thread.creatorUsername || 'Anonymous')}</b>
              ${thread.twitter ? ` • <a href="${normalizeTwitterUrl(thread.twitter)}" target="_blank" style="color: #1DA1F2;">🐦</a>` : ''}
            </div>
          </td>
          <td style="padding: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <code style="font-size: 10px; color: #555;" title="${thread.mint}">${shortAddress}</code>
              <button onclick="copyAddress('${thread.mint}', this)" style="padding: 2px 6px; font-size: 9px; cursor: pointer; background: #d3dce3; border: 1px solid #999; border-radius: 3px; white-space: nowrap;">📋</button>
            </div>
          </td>
          <td align="right" style="padding: 8px; font-size: 11px; color: #555;">
            <span id="mc-${thread.mint}">—</span>
          </td>
          <td align="right" style="padding: 8px; font-size: 11px; color: #555;">
            <span id="vol-${thread.mint}">—</span>
          </td>
          <td align="center" style="padding: 8px; font-size: 12px;">
            ${thread.commentCount || 0}
          </td>
          <td style="padding: 8px; font-size: 11px; color: #666;">
            ${lastActivity}
          </td>
        </tr>
      `;
    }).join('');

  // Fetch stats for each coin
  threadsToRender.forEach(thread => {
    updateCoinStats(thread.mint);
  });
}

// Helper functions
function formatDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function normalizeTwitterUrl(twitter) {
  if (!twitter) return '';
  if (twitter.startsWith('http')) return twitter;
  const username = twitter.replace('@', '');
  return `https://twitter.com/${username}`;
}

// Search coins function (global scope for onclick)
window.searchCoins = function() {
  const input = document.getElementById('searchInput');
  searchQuery = input.value.trim();

  applySearch();
  sortThreadsData();
  renderThreads();
};

// Allow Enter key to trigger search
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchCoins();
      }
    });

    // Real-time search as user types
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      applySearch();
      sortThreadsData();
      renderThreads();
    });
  }
});

// Sort table function (global scope for onclick)
window.sortTable = function(column) {
  if (sortColumn === column) {
    // Toggle direction if clicking same column
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // New column, default to descending
    sortColumn = column;
    sortDirection = 'desc';
  }

  sortThreadsData();
  renderThreads();
};

// Copy address function (global scope for onclick)
window.copyAddress = function(address, button) {
  navigator.clipboard.writeText(address).then(() => {
    const originalText = button.textContent;
    button.textContent = '✓';
    button.style.background = '#90EE90';
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = '#d3dce3';
    }, 1500);
  }).catch(err => {
    console.error('Failed to copy:', err);
    button.textContent = '✗';
    setTimeout(() => {
      button.textContent = '📋';
    }, 1500);
  });
};

// Check URL for search parameter on load
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const searchParam = urlParams.get('search');

  if (searchParam) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = searchParam;
      searchQuery = searchParam;
    }
    // Scroll to coins section
    setTimeout(() => {
      document.getElementById('coins')?.scrollIntoView({ behavior: 'smooth' });
    }, 500);
  }
});

// Load coins on page load
loadRecentCoins();

// Reload coins every 30 seconds
setInterval(loadRecentCoins, 30000);

// Image preview handler
document.getElementById('image').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('previewImg').src = e.target.result;
      document.getElementById('imagePreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    document.getElementById('imagePreview').style.display = 'none';
  }
});
