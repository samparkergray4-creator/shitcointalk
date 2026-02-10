// Thread view script

const mint = window.location.pathname.split('/').pop();

console.log('Loading thread for mint:', mint);

// Load coin data and comments
async function loadThread() {
  try {
    // Set loading state
    document.getElementById('threadTitle').textContent = 'Loading thread...';
    document.getElementById('breadcrumbTitle').textContent = 'Loading...';
    document.getElementById('breadcrumbTitle2').textContent = 'Loading...';

    const response = await fetch(`/api/coin/${mint}`);
    if (!response.ok) {
      throw new Error('Coin not found');
    }

    const coin = await response.json();
    console.log('Coin data:', coin);

    // Update page
    document.title = `${coin.name} (${coin.symbol}) - shitcoin forum`;
    document.getElementById('threadTitle').textContent = `${coin.name} (${coin.symbol})`;
    document.getElementById('breadcrumbTitle').textContent = coin.name;
    document.getElementById('breadcrumbTitle2').textContent = coin.name;
    document.getElementById('coinName').textContent = coin.name;
    document.getElementById('coinSymbol').textContent = coin.symbol;
    document.getElementById('coinDescription').textContent = coin.description || 'No description provided.';
    document.getElementById('coinMint').textContent = coin.mint;
    document.getElementById('creatorUsername').textContent = coin.creatorUsername || 'Anonymous';

    // Handle image
    const coinImage = document.getElementById('coinImage');
    let imageUrl = coin.image;

    if (imageUrl) {
      // Convert IPFS URLs to HTTP gateway URLs
      if (imageUrl.startsWith('ipfs://')) {
        const ipfsHash = imageUrl.replace('ipfs://', '');
        imageUrl = `https://ipfs.io/ipfs/${ipfsHash}`;
      }
      // Backend should handle mock:// conversion, but just in case display it
      if (!imageUrl.startsWith('mock://')) {
        coinImage.src = imageUrl;
        coinImage.style.display = 'block';
        coinImage.onerror = function() {
          console.error('Failed to load image:', imageUrl);
          this.style.display = 'none';
        };
      } else {
        coinImage.style.display = 'none';
      }
    } else {
      coinImage.style.display = 'none';
    }
    console.log('Image URL:', coin.image, '-> Display URL:', imageUrl);

    document.getElementById('pumpLink').href = `https://pump.fun/${coin.mint}`;

    // Twitter link (if provided)
    if (coin.twitter) {
      const twitterLink = document.getElementById('twitterLink');
      const twitterContainer = document.getElementById('twitterLinkContainer');

      // Normalize Twitter URL
      let twitterUrl = coin.twitter;
      if (!twitterUrl.startsWith('http')) {
        // Handle @username or username format
        const username = twitterUrl.replace('@', '');
        twitterUrl = `https://twitter.com/${username}`;
      }

      twitterLink.href = twitterUrl;
      twitterContainer.style.display = 'block';
    }

    // Stats
    document.getElementById('statMC').textContent = coin.marketCap
      ? `$${formatNumber(coin.marketCap)}`
      : '—';
    document.getElementById('statVolume').textContent = coin.volume24h
      ? `$${formatNumber(coin.volume24h)}`
      : '—';
    document.getElementById('statHolders').textContent = coin.holders || '0';

    // Format created date
    const createdDate = new Date(coin.createdAt * 1000);
    document.getElementById('coinPostDate').textContent = createdDate.toLocaleString();
    document.getElementById('coinMeta').textContent = createdDate.toLocaleString();

    await loadComments();

  } catch (error) {
    console.error('Error loading thread:', error);
    document.getElementById('threadTitle').textContent = 'Thread not found';
  }
}

// Load comments and render as post tables (matching bitcointalk post layout)
async function loadComments() {
  try {
    const response = await fetch(`/api/thread/${mint}/comments`);
    const data = await response.json();
    const commentsList = document.getElementById('commentsList');

    if (!data.success || !data.comments || data.comments.length === 0) {
      commentsList.innerHTML = `
        <table class="bordercolor post_table" cellspacing="1" cellpadding="4" width="100%">
          <tr>
            <td colspan="2" class="windowbg" style="text-align: center; padding: 15px; color: #666; font-size: 11px;">
              No replies yet. Be the first to comment!
            </td>
          </tr>
        </table>
      `;
      document.getElementById('statComments').textContent = '0';
      return;
    }

    // Render each comment as a post table (matching bitcointalk structure)
    commentsList.innerHTML = data.comments.map((comment, idx) => {
      const bgClass = idx % 2 === 0 ? 'windowbg' : 'windowbg2';
      return `
        <table class="bordercolor post_table" cellspacing="1" cellpadding="4" width="100%">
          <tr>
            <td class="titlebg" colspan="2">
              Reply #${idx + 1} &mdash; ${formatDate(comment.createdAt)}
            </td>
          </tr>
          <tr>
            <td class="post_author ${bgClass}" valign="top">
              <div class="poster_name"><a>${escapeHtml(comment.username)}</a></div>
              <div class="poster_rank">Member</div>
              <div class="poster_info">
                Activity: N/A<br>
                Merit: 0
              </div>
            </td>
            <td class="post_body ${bgClass}" valign="top">
              ${escapeHtml(comment.text)}
            </td>
          </tr>
        </table>
      `;
    }).join('');

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
    document.getElementById('replyForm').reset();

    setTimeout(() => {
      clearStatus('replyStatus');
      loadComments();
    }, 1000);

  } catch (error) {
    console.error('Error posting comment:', error);
    showStatus('replyStatus', `Error: ${error.message}`, 'error');
  }
});

// Helpers
function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return 'Just now';

  let date;
  if (timestamp._seconds !== undefined) {
    // Firestore Timestamp object with _seconds
    date = new Date(timestamp._seconds * 1000);
  } else if (timestamp.seconds !== undefined) {
    // Firestore Timestamp object with seconds
    date = new Date(timestamp.seconds * 1000);
  } else if (typeof timestamp === 'number') {
    // Unix timestamp
    date = new Date(timestamp * 1000);
  } else {
    // Try parsing as date string
    date = new Date(timestamp);
  }

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'Just now';
  }

  return date.toLocaleString();
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

// Auto-refresh stats every 10 seconds
setInterval(async () => {
  try {
    const response = await fetch(`/api/coin/${mint}`);
    if (response.ok) {
      const coin = await response.json();
      document.getElementById('statMC').textContent = coin.marketCap
        ? `$${formatNumber(coin.marketCap)}`
        : '—';
      document.getElementById('statVolume').textContent = coin.volume24h
        ? `$${formatNumber(coin.volume24h)}`
        : '—';
      document.getElementById('statHolders').textContent = coin.holders || '0';
    }
  } catch (error) {
    console.error('Error refreshing stats:', error);
  }
}, 10000);

loadThread();
