const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const { getSession, getConversationMembers, getConversationMember } = require("./database");

const COOKIE_SECRET = process.env.COOKIE_SECRET;

// userId -> Set<ws>
const userConnections = new Map();

// Heartbeat interval (30s)
const HEARTBEAT_INTERVAL = 30000;

/**
 * Parse signed cookies from a raw upgrade request using cookie-parser.
 * Since we don't have Express middleware, we create a fake req object
 * and invoke cookie-parser manually.
 */
function parseCookies(req) {
  return new Promise((resolve, reject) => {
    const fakeReq = { headers: { cookie: req.headers.cookie } };
    cookieParser(COOKIE_SECRET)(fakeReq, {}, (err) => {
      if (err) return reject(err);
      resolve(fakeReq.signedCookies || {});
    });
  });
}

/**
 * Authenticate a WebSocket upgrade request.
 * Returns { userId, username } on success, or null on failure.
 */
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

/**
 * Send a JSON message to all members of a conversation,
 * optionally excluding one user.
 */
function broadcastToConversation(conversationId, message, excludeUserId = null) {
  let members;
  try {
    members = getConversationMembers(conversationId);
  } catch {
    return;
  }

  for (const member of members) {
    if (member.user_id === excludeUserId) continue;
    const sockets = userConnections.get(member.user_id);
    if (sockets) {
      const data = JSON.stringify(message);
      for (const ws of sockets) {
        if (ws.readyState === 1) ws.send(data);
      }
    }
  }
}

/**
 * Send a JSON message to all open sockets belonging to a single user.
 */
function broadcastToUser(userId, message) {
  const sockets = userConnections.get(userId);
  if (sockets) {
    const data = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(data);
    }
  }
}

/**
 * Broadcast online/offline presence to all currently connected users
 * (excluding the user whose status changed).
 */
function broadcastPresence(userId, status) {
  const data = JSON.stringify({ type: "presence", userId, status });
  for (const [uid, sockets] of userConnections) {
    if (uid === userId) continue;
    for (const ws of sockets) {
      if (ws.readyState === 1) ws.send(data);
    }
  }
}

/**
 * Register a socket in the userConnections map.
 */
function addConnection(userId, ws) {
  let set = userConnections.get(userId);
  if (!set) {
    set = new Set();
    userConnections.set(userId, set);
  }
  set.add(ws);
}

/**
 * Remove a socket from the userConnections map.
 * Returns true if the user now has zero remaining connections.
 */
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

/**
 * Verify that a user is a member of the given conversation.
 */
function isMemberOf(userId, conversationId) {
  try {
    return !!getConversationMember(conversationId, userId);
  } catch {
    return false;
  }
}

/**
 * Attach a WebSocket server to an existing HTTP server.
 * Returns the WebSocketServer instance.
 */
function initWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Only handle /ws path
    if (req.url !== "/ws") {
      return;
    }

    authenticateUpgrade(req)
      .then((auth) => {
        if (!auth) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        // Attach auth info to the request so the connection handler can use it
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

    // Track the connection
    addConnection(userId, ws);

    // Confirm connection to client
    ws.send(JSON.stringify({ type: "connected", userId }));

    // Broadcast online presence to other users
    broadcastPresence(userId, "online");

    // Handle incoming messages
    ws.on("message", (raw) => {
      ws.isAlive = true;

      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        // Ignore malformed messages
        return;
      }

      switch (msg.type) {
        case "typing": {
          const { conversationId } = msg;
          if (!conversationId || !isMemberOf(userId, conversationId)) return;
          broadcastToConversation(conversationId, {
            type: "typing",
            conversationId,
            userId,
          }, userId);
          break;
        }

        case "stop_typing": {
          const { conversationId } = msg;
          if (!conversationId || !isMemberOf(userId, conversationId)) return;
          broadcastToConversation(conversationId, {
            type: "stop_typing",
            conversationId,
            userId,
          }, userId);
          break;
        }

        case "read": {
          const { conversationId, lastReadAt } = msg;
          if (!conversationId || !isMemberOf(userId, conversationId)) return;
          broadcastToConversation(conversationId, {
            type: "read",
            conversationId,
            userId,
            lastReadAt,
          }, userId);
          break;
        }

        case "presence": {
          // Heartbeat / status ping
          if (msg.status === "online") {
            broadcastToUser(userId, {
              type: "presence",
              userId,
              status: "online",
            });
            broadcastPresence(userId, "online");
          }
          break;
        }

        default:
          // Unknown message type — ignore silently
          break;
      }
    });

    // Handle pong responses for heartbeat
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    // Handle disconnect
    ws.on("close", () => {
      const nowOffline = removeConnection(userId, ws);
      if (nowOffline) {
        broadcastPresence(userId, "offline");
      }
    });
  });

  // Periodic heartbeat: ping all connections, terminate non-responsive ones
  const heartbeatTimer = setInterval(() => {
    for (const [userId, sockets] of userConnections) {
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

  // Clean up timer when the server closes
  wss.on("close", () => {
    clearInterval(heartbeatTimer);
  });

  return wss;
}

module.exports = { initWebSocket, broadcastToConversation, broadcastToUser };
