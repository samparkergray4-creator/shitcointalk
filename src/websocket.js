import WebSocket, { WebSocketServer } from 'ws';

// Track browser clients and their subscriptions
const clients = new Map(); // ws -> Set<mint>
const mintSubscribers = new Map(); // mint -> Set<ws>

// Price history: mint -> array of {t, mc} points (ring buffer, max 500)
const priceHistory = new Map();
const MAX_HISTORY_POINTS = 500;

// Throttle: track last fetch time per mint
const lastFetch = new Map(); // mint -> timestamp
const THROTTLE_MS = 5000;

// PumpPortal connection state
let ppWs = null;
let ppSubscribedMints = new Set();
let reconnectTimer = null;

// Reference to fetchPumpMarketData from server
let fetchMarketData = null;

export function initWebSockets(httpServer, fetchPumpMarketDataFn) {
  fetchMarketData = fetchPumpMarketDataFn;

  // Browser-facing WebSocket server (shares HTTP server)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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
          if (subs.size === 0) mintSubscribers.delete(mint);
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
  if (reconnectTimer) return;
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

    // Store price history point
    if (mc > 0) {
      if (!priceHistory.has(mint)) priceHistory.set(mint, []);
      const history = priceHistory.get(mint);
      history.push({ t: Date.now(), mc });
      if (history.length > MAX_HISTORY_POINTS) history.shift();
    }

    const payload = JSON.stringify({
      type: 'coinUpdate',
      mint,
      marketCap: mc,
      volume24h: marketData.volume || 0,
      holders: marketData.holders || 0,
      graduated: marketData.graduated || false
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

export function getPriceHistory(mint) {
  return priceHistory.get(mint) || [];
}
