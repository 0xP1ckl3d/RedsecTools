const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const { getSession, getUnreadNotificationCount } = require("./database");
const { isAllowedWebSocketOrigin } = require("./core/security/ws-origin");
const { logWarn } = require("./core/logger");

const COOKIE_SECRET = process.env.COOKIE_SECRET;

const userConnections = new Map();
let initialized = false;

const HEARTBEAT_INTERVAL = 30000;

function parseCookies(req) {
  return new Promise((resolve, reject) => {
    const fakeReq = { headers: { cookie: req.headers.cookie } };
    cookieParser(COOKIE_SECRET)(fakeReq, {}, (err) => {
      if (err) return reject(err);
      resolve(fakeReq.signedCookies || {});
    });
  });
}

async function authenticateUpgrade(req) {
  try {
    const cookies = await parseCookies(req);
    const sessionId = cookies.redsec_session;
    if (!sessionId) return null;

    const session = getSession(sessionId);
    if (!session) return null;
    if (session.suspended) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) return null;

    return { userId: session.user_id, username: session.username };
  } catch {
    return null;
  }
}

function addConnection(userId, ws) {
  let set = userConnections.get(userId);
  if (!set) {
    set = new Set();
    userConnections.set(userId, set);
  }
  set.add(ws);
}

function removeConnection(userId, ws) {
  const set = userConnections.get(userId);
  if (!set) return true;
  set.delete(ws);
  if (set.size === 0) {
    userConnections.delete(userId);
    return true;
  }
  return false;
}

function pushNotificationToUser(userId, notification) {
  const sockets = userConnections.get(userId);
  if (!sockets) return;
  const data = JSON.stringify({ type: "notification", notification });
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function pushUnreadCountToUser(userId) {
  try {
    const count = getUnreadNotificationCount(userId);
    const sockets = userConnections.get(userId);
    if (!sockets) return;
    const data = JSON.stringify({ type: "unread_count", count });
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(data);
    }
  } catch {
    // Best-effort push
  }
}

function initNotificationWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  initialized = true;

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/notifications") return;

    if (!isAllowedWebSocketOrigin(req)) {
      logWarn("notification:ws_origin_rejected", { origin: req.headers.origin || null, host: req.headers.host || null });
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    authenticateUpgrade(req)
      .then((auth) => {
        if (!auth) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        req._wsAuth = auth;
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  wss.on("connection", (ws, req) => {
    const { userId, username } = req._wsAuth;
    ws.userId = userId;
    ws.username = username;
    ws.isAlive = true;

    addConnection(userId, ws);

    ws.send(JSON.stringify({ type: "connected", userId }));

    // Send current unread count on connect
    pushUnreadCountToUser(userId);

    ws.on("message", (raw) => {
      ws.isAlive = true;
      try {
        JSON.parse(raw);
      } catch {
        // Ignore malformed
      }
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      removeConnection(userId, ws);
    });
  });

  const heartbeatTimer = setInterval(() => {
    for (const [, sockets] of userConnections) {
      for (const ws of sockets) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeatTimer);
  });

  return wss;
}

function getNotificationWebSocketStatus() {
  let connections = 0;
  for (const sockets of userConnections.values()) connections += sockets.size;
  return {
    name: "Notifications",
    initialized,
    connectedUsers: userConnections.size,
    connections,
  };
}

module.exports = {
  getNotificationWebSocketStatus,
  initNotificationWebSocket,
  pushNotificationToUser,
  pushUnreadCountToUser,
};
