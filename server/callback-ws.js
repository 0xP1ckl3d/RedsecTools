"use strict";

const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const { getSession } = require("./database");
const { isAllowedWebSocketOrigin } = require("./core/security/ws-origin");
const { logWarn } = require("./core/logger");

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const userConnections = new Map();

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
    return { userId: session.user_id };
  } catch {
    return null;
  }
}

function pushCallbackEvent(userId, event) {
  const sockets = userConnections.get(userId);
  if (!sockets) return;
  const data = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}

function initCallbackWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/callback") return;

    if (!isAllowedWebSocketOrigin(req)) {
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

        wss.handleUpgrade(req, socket, head, (ws) => {
          ws._userId = auth.userId;

          let set = userConnections.get(auth.userId);
          if (!set) { set = new Set(); userConnections.set(auth.userId, set); }
          set.add(ws);

          ws.on("close", () => {
            const s = userConnections.get(auth.userId);
            if (s) { s.delete(ws); if (s.size === 0) userConnections.delete(auth.userId); }
          });
        });
      })
      .catch(() => {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });
}

module.exports = { initCallbackWebSocket, pushCallbackEvent };
