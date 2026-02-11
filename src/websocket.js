import WebSocket, { WebSocketServer } from 'ws';

// Track browser clients and their subscriptions
const clients = new Map(); // ws -> Set<mint>
const mintSubscribers = new Map(); // mint -> Set<ws>

// Price history: mint -> array of {t, mc} points (ring buffer, max 500)
const priceHistory = new Map();
const MAX_HISTORY_POINTS = 500;
const MAX_TRACKED_MINTS = 200; // Cap total tracked mints

// OHLC candle aggregation
const TIMEFRAMES = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };
const candleHistory = new Map(); // mint -> { tf -> Array<{t, o, h, l, c}> }
const MAX_CANDLES = 500;

function floorToTimeframe(ms, interval) {
  return Math.floor(ms / interval) * interval;
}

function updateCandles(mint, mc, timestamp) {
  if (!candleHistory.has(mint)) candleHistory.set(mint, {});
  const mintCandles = candleHistory.get(mint);

  for (const [tf, interval] of Object.entries(TIMEFRAMES)) {
    if (!mintCandles[tf]) mintCandles[tf] = [];
    const candles = mintCandles[tf];
    const candleTime = floorToTimeframe(timestamp, interval);
    const last = candles.length > 0 ? candles[candles.length - 1] : null;

    if (last && last.t === candleTime) {
      // Update existing candle
      if (mc > last.h) last.h = mc;
      if (mc < last.l) last.l = mc;
      last.c = mc;
    } else {
      // New candle — open = previous close or current mc
      const openPrice = last ? last.c : mc;
      candles.push({ t: candleTime, o: openPrice, h: Math.max(openPrice, mc), l: Math.min(openPrice, mc), c: mc });
      if (candles.length > MAX_CANDLES) candles.shift();
    }
  }
}

function getCurrentCandles(mint) {
  const mintCandles = candleHistory.get(mint);
  if (!mintCandles) return null;
  const result = {};
  for (const tf of Object.keys(TIMEFRAMES)) {
    const candles = mintCandles[tf];
    if (candles && candles.length > 0) {
      result[tf] = candles[candles.length - 1];
    }
  }
  return result;
}

// Evict oldest mints when history Maps exceed max size
function evictOldestMints() {
  while (priceHistory.size > MAX_TRACKED_MINTS) {
    const oldest = priceHistory.keys().next().value;
    priceHistory.delete(oldest);
    candleHistory.delete(oldest);
  }
}

// Throttle: track last fetch time per mint
const lastFetch = new Map(); // mint -> timestamp
const THROTTLE_MS = 5000;

// PumpPortal connection state
let ppWs = null;
let ppSubscribedMints = new Set();
let reconnectTimer = null;
let shuttingDown = false;

// Reference to fetchPumpMarketData from server
let fetchMarketData = null;

// Store wss reference for shutdown
let wssRef = null;

export function initWebSockets(httpServer, fetchPumpMarketDataFn) {
  fetchMarketData = fetchPumpMarketDataFn;

  // Browser-facing WebSocket server (shares HTTP server)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  wssRef = wss;

  wss.on('connection', (ws) => {
    clients.set(ws, new Set());
    console.log(`[WS] Browser connected (${clients.size} total)`);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe' && Array.isArray(msg.mints)) {
          handleSubscribe(ws, msg.mints);
        }
      } catch (e) {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      const mints = clients.get(ws) || new Set();
      for (const mint of mints) {
        const subs = mintSubscribers.get(mint);
        if (subs) {
          subs.delete(ws);
          if (subs.size === 0) {
            mintSubscribers.delete(mint);
            // Unsubscribe from PumpPortal if no one is watching
            unsubscribePumpPortal(mint);
          }
        }
      }
      clients.delete(ws);
      console.log(`[WS] Browser disconnected (${clients.size} total)`);
    });
  });

  // Connect to PumpPortal
  connectPumpPortal();

  console.log('[WS] WebSocket server initialized on /ws');
}

function handleSubscribe(ws, mints) {
  const currentSubs = clients.get(ws) || new Set();

  for (const mint of mints) {
    if (typeof mint !== 'string' || mint.length < 30) continue;

    currentSubs.add(mint);

    if (!mintSubscribers.has(mint)) {
      mintSubscribers.set(mint, new Set());
    }
    mintSubscribers.get(mint).add(ws);

    // Subscribe upstream to PumpPortal if not already
    if (!ppSubscribedMints.has(mint)) {
      subscribePumpPortal(mint);
    }
  }

  clients.set(ws, currentSubs);
}

function connectPumpPortal() {
  if (shuttingDown) return;
  if (ppWs && ppWs.readyState === WebSocket.OPEN) return;

  try {
    ppWs = new WebSocket('wss://pumpportal.fun/api/data');

    ppWs.on('open', () => {
      console.log('[WS] Connected to PumpPortal');
      // Re-subscribe to any mints we were tracking
      for (const mint of ppSubscribedMints) {
        subscribePumpPortal(mint);
      }
    });

    ppWs.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        if (data.mint || data.token) {
          const mint = data.mint || data.token;
          onTradeEvent(mint);
        }
      } catch (e) {
        // ignore
      }
    });

    ppWs.on('close', () => {
      console.log('[WS] PumpPortal disconnected, reconnecting in 5s...');
      scheduleReconnect();
    });

    ppWs.on('error', (err) => {
      console.error('[WS] PumpPortal error:', err.message);
      scheduleReconnect();
    });
  } catch (err) {
    console.error('[WS] Failed to connect to PumpPortal:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPumpPortal();
  }, 5000);
}

function subscribePumpPortal(mint) {
  ppSubscribedMints.add(mint);

  if (ppWs && ppWs.readyState === WebSocket.OPEN) {
    ppWs.send(JSON.stringify({
      method: 'subscribeTokenTrade',
      keys: [mint]
    }));
    console.log(`[WS] Subscribed to PumpPortal trades for ${mint.slice(0, 8)}...`);
  }
}

function unsubscribePumpPortal(mint) {
  ppSubscribedMints.delete(mint);

  if (ppWs && ppWs.readyState === WebSocket.OPEN) {
    ppWs.send(JSON.stringify({
      method: 'unsubscribeTokenTrade',
      keys: [mint]
    }));
  }

  // Clean up history for mints no one watches
  lastFetch.delete(mint);
}

async function onTradeEvent(mint) {
  // Check if anyone is watching this mint
  const subs = mintSubscribers.get(mint);
  if (!subs || subs.size === 0) return;

  // Throttle: only fetch once per THROTTLE_MS per mint
  const now = Date.now();
  const last = lastFetch.get(mint) || 0;
  if (now - last < THROTTLE_MS) return;
  lastFetch.set(mint, now);

  try {
    const marketData = await fetchMarketData(mint);
    if (!marketData) return;

    const mc = marketData.marketCap || 0;

    // Store price history point and update candles
    if (mc > 0) {
      const ts = Date.now();
      if (!priceHistory.has(mint)) priceHistory.set(mint, []);
      const history = priceHistory.get(mint);
      history.push({ t: ts, mc });
      if (history.length > MAX_HISTORY_POINTS) history.shift();

      updateCandles(mint, mc, ts);
      evictOldestMints();
    }

    const payload = JSON.stringify({
      type: 'coinUpdate',
      mint,
      marketCap: mc,
      volume24h: marketData.volume || 0,
      holders: marketData.holders || 0,
      graduated: marketData.graduated || false,
      candles: getCurrentCandles(mint)
    });

    // Broadcast to all subscribers of this mint
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  } catch (err) {
    console.error(`[WS] Error fetching data for ${mint}:`, err.message);
  }
}

export function shutdown() {
  shuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ppWs) {
    ppWs.close();
    ppWs = null;
  }
  if (wssRef) {
    for (const ws of wssRef.clients) {
      ws.close();
    }
    wssRef.close();
  }
  console.log('[WS] WebSocket connections closed');
}

export function getPriceHistory(mint) {
  return priceHistory.get(mint) || [];
}

export function getCandleHistory(mint, tf) {
  const mintCandles = candleHistory.get(mint);
  if (!mintCandles || !mintCandles[tf]) return [];
  return mintCandles[tf];
}
