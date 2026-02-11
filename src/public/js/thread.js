// Thread view script

const mint = window.location.pathname.split('/').pop();

console.log('Loading thread for mint:', mint);

// ===== CHART =====
var priceChart = null;
var areaSeries = null;
var candleSeries = null;
var chartPoints = [];
var candlePoints = [];
var currentMode = 'line'; // 'line' | '1m' | '5m' | '15m' | '1h'

var chartPriceFormat = {
  type: 'custom',
  formatter: function(price) { return '$' + formatNumber(price); }
};

function initChart() {
  var container = document.getElementById('priceChart');
  if (!container || priceChart) return;

  priceChart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: '#ffffff' },
      textColor: '#888',
      fontFamily: 'Verdana, sans-serif',
      fontSize: 9
    },
    grid: {
      vertLines: { color: '#e8ecf0' },
      horzLines: { color: '#e8ecf0' }
    },
    crosshair: {
      vertLine: { color: '#2e4453', labelBackgroundColor: '#2e4453' },
      horzLine: { color: '#2e4453', labelBackgroundColor: '#2e4453' }
    },
    rightPriceScale: {
      borderColor: '#e8ecf0'
    },
    timeScale: {
      borderColor: '#e8ecf0',
      timeVisible: true,
      secondsVisible: false
    },
    handleScale: false,
    handleScroll: false
  });
}

function showAreaSeries() {
  if (!priceChart) initChart();
  if (candleSeries) {
    priceChart.removeSeries(candleSeries);
    candleSeries = null;
  }
  if (!areaSeries) {
    areaSeries = priceChart.addAreaSeries({
      lineColor: '#476C8E',
      lineWidth: 2,
      topColor: 'rgba(71,108,142,0.15)',
      bottomColor: 'rgba(71,108,142,0.02)',
      priceFormat: chartPriceFormat
    });
  }

  var seriesData = chartPoints.map(function(p) {
    return { time: Math.floor(p.t / 1000), value: p.mc };
  });
  areaSeries.setData(seriesData);
  priceChart.timeScale().fitContent();
}

function showCandleSeries() {
  if (!priceChart) initChart();
  if (areaSeries) {
    priceChart.removeSeries(areaSeries);
    areaSeries = null;
  }
  if (!candleSeries) {
    candleSeries = priceChart.addCandlestickSeries({
      upColor: '#476C8E',
      borderUpColor: '#3A5A75',
      wickUpColor: '#3A5A75',
      downColor: '#B75050',
      borderDownColor: '#994040',
      wickDownColor: '#994040',
      priceFormat: chartPriceFormat
    });
  }
}

function renderCandles() {
  if (!candleSeries) return;
  var data = candlePoints.map(function(c) {
    return { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c };
  });
  candleSeries.setData(data);
  priceChart.timeScale().fitContent();
}

async function loadCandles(tf) {
  try {
    var res = await fetch('/api/coin/' + mint + '/chart?tf=' + tf);
    var data = await res.json();
    if (data.success && data.candles && data.candles.length > 0) {
      candlePoints = data.candles;
    } else {
      candlePoints = [];
    }
    showCandleSeries();
    renderCandles();

    var placeholder = document.getElementById('chartPlaceholder');
    if (placeholder) placeholder.style.display = candlePoints.length > 0 ? 'none' : '';
  } catch (e) {
    console.error('Error loading candles:', e);
  }
}

function switchChartMode(mode) {
  currentMode = mode;

  // Update button styling
  var btns = document.querySelectorAll('#tfBar .tf-btn');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute('data-tf') === mode) {
      btns[i].classList.add('tf-btn-active');
    } else {
      btns[i].classList.remove('tf-btn-active');
    }
  }

  if (mode === 'line') {
    if (!priceChart) initChart();
    showAreaSeries();
    var placeholder = document.getElementById('chartPlaceholder');
    if (placeholder) placeholder.style.display = chartPoints.length > 0 ? 'none' : '';
  } else {
    loadCandles(mode);
  }
}

async function loadChart() {
  try {
    const res = await fetch(`/api/coin/${mint}/chart`);
    const data = await res.json();
    if (data.success && data.points.length > 0) {
      chartPoints = data.points;
      renderChart();
    }
  } catch (e) {
    console.error('Error loading chart:', e);
  }
}

function renderChart() {
  var placeholder = document.getElementById('chartPlaceholder');
  if (chartPoints.length === 0) {
    if (placeholder) placeholder.style.display = '';
    return;
  }
  if (placeholder) placeholder.style.display = 'none';

  if (!priceChart) initChart();

  // Only render area series in line mode
  if (currentMode === 'line') {
    showAreaSeries();
  }
}

function addChartPoint(marketCap, wsCandles) {
  if (!marketCap || marketCap <= 0) return;
  chartPoints.push({ t: Date.now(), mc: marketCap });
  if (chartPoints.length > 500) chartPoints.shift();

  var placeholder = document.getElementById('chartPlaceholder');
  if (placeholder) placeholder.style.display = 'none';

  if (!priceChart) initChart();

  if (currentMode === 'line') {
    // Area series update
    if (!areaSeries) showAreaSeries();
    var point = { time: Math.floor(Date.now() / 1000), value: marketCap };
    areaSeries.update(point);
  } else if (wsCandles && wsCandles[currentMode] && candleSeries) {
    // Candlestick real-time update from WS payload
    var c = wsCandles[currentMode];
    var candleData = { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c };
    candleSeries.update(candleData);
  }
}

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

    // Load chart history, seed with current MC if empty
    await loadChart();
    if (chartPoints.length === 0 && coin.marketCap) {
      addChartPoint(coin.marketCap);
    }

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

// Fetch live stats via our server proxy
async function refreshStats() {
  try {
    const response = await fetch(`/api/coin/${mint}`);
    if (!response.ok) return;

    const coin = await response.json();

    document.getElementById('statMC').textContent = coin.marketCap
      ? `$${formatNumber(coin.marketCap)}`
      : '—';
    document.getElementById('statVolume').textContent = coin.volume24h
      ? `$${formatNumber(coin.volume24h)}`
      : '—';
    document.getElementById('statHolders').textContent = coin.holders || '0';
  } catch (error) {
    console.error('Error refreshing stats:', error);
  }
}

// WebSocket real-time updates
if (typeof WsClient !== 'undefined') {
  WsClient.init(function(data) {
    if (data.mint !== mint) return;
    document.getElementById('statMC').textContent = data.marketCap
      ? '$' + formatNumber(data.marketCap)
      : '—';
    document.getElementById('statVolume').textContent = data.volume24h
      ? '$' + formatNumber(data.volume24h)
      : '—';
    document.getElementById('statHolders').textContent = data.holders || '0';
    addChartPoint(data.marketCap, data.candles);
  });
  WsClient.subscribe([mint]);
}

// Fallback polling every 60 seconds (reduced from 10s since WS handles real-time)
setInterval(refreshStats, 60000);
// Also fetch immediately
refreshStats();

loadThread();
