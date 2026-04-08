/**
 * ChatWS — WebSocket client with automatic reconnection and event emitter.
 * Connects to /ws on the current host. Pure vanilla JS, no dependencies.
 */
window.ChatWS = (function () {
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000; // 1s, doubles each attempt
  const listeners = new Map(); // event type -> Set of callbacks
  let heartbeatInterval = null;

  // --- Internal helpers ---

  function emit(eventType, data) {
    if (listeners.has(eventType)) {
      for (const cb of listeners.get(eventType)) {
        try {
          cb(data);
        } catch {}
      }
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      emit("reconnect_failed", {});
      return;
    }
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(function () {
      send({ type: "presence", status: "online" });
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // --- Public API ---

  function connect() {
    if (
      ws &&
      (ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onopen = function () {
      reconnectAttempts = 0;
      emit("connected", {});
      startHeartbeat();
    };

    ws.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data);
        emit(data.type, data);
      } catch {}
    };

    ws.onclose = function () {
      stopHeartbeat();
      emit("disconnected", {});
      scheduleReconnect();
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent reconnect
    stopHeartbeat();
    if (ws) {
      ws.onclose = null; // Don't trigger reconnect
      ws.close(1000, "Manual disconnect");
      ws = null;
    }
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function on(eventType, callback) {
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType).add(callback);
  }

  function off(eventType, callback) {
    if (listeners.has(eventType)) {
      listeners.get(eventType).delete(callback);
    }
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  return {
    connect: connect,
    disconnect: disconnect,
    send: send,
    on: on,
    off: off,
    isConnected: isConnected,
  };
})();
