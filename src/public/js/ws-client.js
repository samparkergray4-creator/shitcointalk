// WebSocket client for real-time coin updates
var WsClient = (function() {
  var ws = null;
  var updateCallback = null;
  var pendingMints = [];
  var reconnectTimer = null;

  function getWsUrl() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(getWsUrl());

      ws.onopen = function() {
        console.log('WS connected');
        if (pendingMints.length > 0) {
          ws.send(JSON.stringify({ type: 'subscribe', mints: pendingMints }));
        }
      };

      ws.onmessage = function(event) {
        try {
          var data = JSON.parse(event.data);
          if (data.type === 'coinUpdate' && updateCallback) {
            updateCallback(data);
          }
        } catch (e) {}
      };

      ws.onclose = function() {
        console.log('WS disconnected, reconnecting in 3s...');
        scheduleReconnect();
      };

      ws.onerror = function() {
        // onclose will fire after this
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connect();
    }, 3000);
  }

  return {
    init: function(callback) {
      updateCallback = callback;
      connect();
    },

    subscribe: function(mints) {
      if (!Array.isArray(mints)) mints = [mints];
      // Deduplicate
      for (var i = 0; i < mints.length; i++) {
        if (pendingMints.indexOf(mints[i]) === -1) {
          pendingMints.push(mints[i]);
        }
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', mints: mints }));
      }
    }
  };
})();
