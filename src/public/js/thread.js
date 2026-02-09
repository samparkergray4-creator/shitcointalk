// Thread view script

const urlParams = new URLSearchParams(window.location.search);
const mint = window.location.pathname.split('/').pop();

console.log('Loading thread for mint:', mint);

// Load coin data and comments
async function loadThread() {
  try {
    // Fetch coin data from pump.fun API
    const response = await fetch(`/api/coin/${mint}`);
    if (!response.ok) {
      throw new Error('Coin not found');
    }

    const coin = await response.json();
    console.log('Coin data:', coin);

    // Update page with coin data
    document.getElementById('threadTitle').textContent = `${coin.name} (${coin.symbol})`;
    document.getElementById('breadcrumbTitle').textContent = coin.name;
    document.getElementById('coinName').textContent = coin.name;
    document.getElementById('coinSymbol').textContent = coin.symbol;
    document.getElementById('coinDescription').textContent = coin.description || 'No description provided.';
    document.getElementById('coinMint').textContent = coin.mint;
    document.getElementById('coinImage').src = coin.image || '/placeholder.png';
    document.getElementById('pumpLink').href = `https://pump.fun/${coin.mint}`;

    // Update stats
    document.getElementById('statMC').textContent = coin.marketCap
      ? `$${formatNumber(coin.marketCap)}`
      : '-';
    document.getElementById('statVolume').textContent = coin.volume24h
      ? `$${formatNumber(coin.volume24h)}`
      : '-';
    document.getElementById('statHolders').textContent = coin.holders || '0';

    // Format created date
    const createdDate = new Date(coin.createdAt * 1000);
    document.getElementById('coinMeta').textContent = `Posted: ${createdDate.toLocaleString()}`;

    // Load comments from Firebase
    await loadComments();

  } catch (error) {
    console.error('Error loading thread:', error);
    document.getElementById('threadTitle').textContent = 'Error loading thread';
    document.getElementById('firstPost').innerHTML = `
      <div class="post-content" style="padding: 20px; text-align: center;">
        <p style="color: #d00;">Thread not found or failed to load.</p>
        <a href="/">← Back to home</a>
      </div>
    `;
  }
}

// Load comments
async function loadComments() {
  try {
    const response = await fetch(`/api/thread/${mint}/comments`);
    const data = await response.json();

    const commentsList = document.getElementById('commentsList');

    if (!data.success || !data.comments || data.comments.length === 0) {
      commentsList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #666; font-size: 9pt;">
          No comments yet. Be the first to comment!
        </div>
      `;
      document.getElementById('statComments').textContent = '0';
      return;
    }

    // Render comments
    commentsList.innerHTML = data.comments.map((comment, idx) => `
      <div class="post">
        <div class="post-author">
          <div class="post-author-name">${escapeHtml(comment.username)}</div>
          <div class="post-author-info">
            Member
          </div>
        </div>
        <div class="post-content">
          <div class="post-meta">
            Reply #${idx + 1} - ${formatDate(comment.createdAt)}
          </div>
          <div class="post-body">
            ${escapeHtml(comment.text)}
          </div>
        </div>
      </div>
    `).join('');

    document.getElementById('statComments').textContent = data.comments.length;

  } catch (error) {
    console.error('Error loading comments:', error);
  }
}

// Handle reply form
document.getElementById('replyForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const comment = document.getElementById('comment').value.trim();

  if (!username || !comment) {
    showStatus('replyStatus', 'Please fill in all fields', 'error');
    return;
  }

  try {
    showStatus('replyStatus', 'Posting comment...', 'info');

    const response = await fetch(`/api/thread/${mint}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, text: comment })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to post comment');
    }

    showStatus('replyStatus', 'Comment posted successfully!', 'success');

    // Clear form
    document.getElementById('replyForm').reset();

    // Reload comments
    setTimeout(() => {
      clearStatus('replyStatus');
      loadComments();
    }, 1000);

  } catch (error) {
    console.error('Error posting comment:', error);
    showStatus('replyStatus', `Error: ${error.message}`, 'error');
  }
});

// Helper: Format large numbers
function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Helper: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper: Format date
function formatDate(timestamp) {
  if (!timestamp) return 'Just now';
  // Firebase timestamps come as objects with seconds/nanoseconds
  const date = timestamp.seconds
    ? new Date(timestamp.seconds * 1000)
    : new Date(timestamp);
  return date.toLocaleString();
}

// Status message helper
function showStatus(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.innerHTML = `<div class="status-msg ${type}">${message}</div>`;
}

function clearStatus(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = '';
}

// Auto-refresh stats every 10 seconds
setInterval(async () => {
  try {
    const response = await fetch(`/api/coin/${mint}`);
    if (response.ok) {
      const coin = await response.json();
      document.getElementById('statMC').textContent = coin.marketCap
        ? `$${formatNumber(coin.marketCap)}`
        : '-';
      document.getElementById('statVolume').textContent = coin.volume24h
        ? `$${formatNumber(coin.volume24h)}`
        : '-';
      document.getElementById('statHolders').textContent = coin.holders || '0';
    }
  } catch (error) {
    console.error('Error refreshing stats:', error);
  }
}, 10000);

// Load thread on page load
loadThread();
