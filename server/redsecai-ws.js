"use strict";

const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { getSession, getRolePermissionsByUserId, getUserById } = require("./database");
const { guardRedSecAiFinalResponse, normalizeMessages, prepareRedSecAiTurn } = require("./modules/redsecai/orchestrator");
const provider = require("./modules/redsecai/provider");
const { filterPendingActionsForUser } = require("./modules/redsecai/actions");
const { logEvent, logWarn } = require("./core/logger");
const { isAllowedWebSocketOrigin } = require("./core/security/ws-origin");

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const HEARTBEAT_INTERVAL = 30000;
const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_BUFFER_CHARS = 24000;

const userConnections = new Map();
const jobs = new Map();
let initialized = false;

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
    if (!session || session.suspended) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000)) return null;

    const freshUser = getUserById(session.user_id);
    const permissions = getRolePermissionsByUserId(session.user_id);
    const url = new URL(req.url || "/ws/redsecai", "http://redsectools.local");
    const requestedTimeZone = String(url.searchParams.get("tz") || "").slice(0, 80);
    return {
      sessionId,
      cookie: req.headers.cookie || "",
      user: {
        id: session.user_id,
        username: session.username,
        email: freshUser?.email || null,
        roleId: freshUser?.role_id || null,
        roleKey: freshUser?.role_key || null,
        roleName: freshUser?.role_name || null,
      },
      access: {
        userId: session.user_id,
        username: session.username,
        permissions,
        permissionSet: new Set(permissions),
      },
      timeZone: requestedTimeZone || (cookies.redsec_tz ? String(cookies.redsec_tz).slice(0, 80) : ""),
    };
  } catch {
    return null;
  }
}

function buildScopedReq(auth, page) {
  return {
    user: auth.user,
    access: auth.access,
    headers: { cookie: auth.cookie },
    get(name) {
      return name && name.toLowerCase() === "referer" ? page?.path || "/" : "";
    },
  };
}

function mergePageContext(auth, page = {}) {
  return {
    ...page,
    timeZone: page.timeZone || auth.timeZone || "",
  };
}

function addConnection(userId, ws) {
  let sockets = userConnections.get(userId);
  if (!sockets) {
    sockets = new Set();
    userConnections.set(userId, sockets);
  }
  sockets.add(ws);
}

function removeConnection(userId, ws) {
  const sockets = userConnections.get(userId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) userConnections.delete(userId);
}

function send(ws, message) {
  if (ws.readyState === 1) ws.send(JSON.stringify(message));
}

function broadcastToUser(userId, message) {
  const sockets = userConnections.get(userId);
  if (!sockets) return;
  for (const ws of sockets) send(ws, message);
}

function trimBuffer(job) {
  if (job.buffer.length <= MAX_BUFFER_CHARS) return;
  job.buffer = job.buffer.slice(job.buffer.length - MAX_BUFFER_CHARS);
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [jobId, job] of jobs) {
    if (job.updatedAt < cutoff && job.done) jobs.delete(jobId);
  }
}

async function startJob(ws, auth, msg) {
  const messages = normalizeMessages(msg.messages);
  if (!messages.length) {
    send(ws, { type: "redsecai_error", jobId: msg.jobId || null, error: "Message is required" });
    return;
  }

  const jobId = typeof msg.jobId === "string" && msg.jobId.length <= 80 ? msg.jobId : crypto.randomBytes(16).toString("base64url");
  if (jobs.has(jobId)) {
    send(ws, { type: "redsecai_error", jobId, error: "A RedSecAI job with that ID already exists" });
    return;
  }

  const job = {
    id: jobId,
    userId: auth.user.id,
    buffer: "",
    statuses: [],
    done: false,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);
  const config = provider.getConfig();
  broadcastToUser(auth.user.id, {
    type: "redsecai_start",
    jobId,
    startedAt: job.createdAt,
    timeoutMs: config.timeoutMs,
    model: config.model,
    cloudModel: config.cloudModel,
  });

  try {
    const emitStatus = (status) => {
      const payload = {
        type: "redsecai_status",
        jobId,
        phase: status.phase || "working",
        label: status.label || "Working",
        tool: status.tool || null,
        at: Date.now(),
      };
      job.statuses.push(payload);
      if (job.statuses.length > 20) job.statuses.shift();
      job.updatedAt = Date.now();
      broadcastToUser(auth.user.id, payload);
    };
    const page = mergePageContext(auth, msg.page || {});
    const turn = await prepareRedSecAiTurn(buildScopedReq(auth, page), messages, page, { onStatus: emitStatus });
    logEvent("redsecai:stream_start", null, {
      actorUserId: auth.user.id,
      actorUsername: auth.user.username,
      allowedTools: turn.scopedContext.allowedTools,
      targetedTools: turn.targetedContext.calls.map((call) => call.tool),
      modelRequestedTools: turn.modelToolContext.calls.map((call) => call.tool),
      model: config.model,
    });
    if (turn.pendingActions?.length) {
      broadcastToUser(auth.user.id, {
        type: "redsecai_actions",
        jobId,
        actions: filterPendingActionsForUser(auth.user.id, turn.pendingActions),
      });
    }

    emitStatus({ phase: "final_answer", label: "Writing the response" });
    const rawResponse = await provider.chat(turn.finalMessages, { phase: "final_answer" });
    job.buffer = guardRedSecAiFinalResponse(rawResponse, turn);
    job.updatedAt = Date.now();
    trimBuffer(job);
    broadcastToUser(auth.user.id, { type: "redsecai_delta", jobId, delta: job.buffer });
    job.done = true;
    job.updatedAt = Date.now();
    if (turn.pendingActions?.length) {
      const liveActions = filterPendingActionsForUser(auth.user.id, turn.pendingActions);
      broadcastToUser(auth.user.id, {
        type: "redsecai_actions",
        jobId,
        actions: liveActions,
      });
      turn.pendingActions = liveActions;
    }
    broadcastToUser(auth.user.id, {
      type: "redsecai_done",
      jobId,
      message: job.buffer,
      actions: turn.pendingActions || [],
    });
  } catch (error) {
    job.done = true;
    job.error = error.status === 503 || error.status === 504 ? error.message : "RedSecAI is unavailable";
    job.updatedAt = Date.now();
    logWarn("redsecai:stream_failed", { message: error.message, status: error.status || 500, details: error.details || null });
    broadcastToUser(auth.user.id, { type: "redsecai_error", jobId, error: job.error, details: error.details || null });
  }
}

function resumeJob(ws, auth, jobId) {
  const job = jobs.get(jobId);
  if (!job || job.userId !== auth.user.id) return;
  const config = provider.getConfig();
  send(ws, {
    type: "redsecai_snapshot",
    jobId,
    message: job.buffer,
    done: job.done,
    error: job.error,
    statuses: job.statuses || [],
    startedAt: job.createdAt,
    timeoutMs: config.timeoutMs,
  });
}

function initRedSecAiWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  initialized = true;

  server.on("upgrade", (req, socket, head) => {
    if (!String(req.url || "").startsWith("/ws/redsecai")) return;

    if (!isAllowedRedSecAiWebSocketOrigin(req)) {
      logWarn("redsecai:ws_origin_rejected", { origin: req.headers.origin || null, host: req.headers.host || null });
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
        req._redsecAiAuth = auth;
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
    const auth = req._redsecAiAuth;
    ws.isAlive = true;
    addConnection(auth.user.id, ws);
    send(ws, { type: "redsecai_connected", userId: auth.user.id });

    ws.on("message", (raw) => {
      ws.isAlive = true;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === "redsecai_chat") {
        startJob(ws, auth, msg);
      } else if (msg.type === "redsecai_resume" && typeof msg.jobId === "string") {
        resumeJob(ws, auth, msg.jobId);
      }
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      removeConnection(auth.user.id, ws);
    });
  });

  const heartbeatTimer = setInterval(() => {
    cleanupJobs();
    for (const sockets of userConnections.values()) {
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

  wss.on("close", () => clearInterval(heartbeatTimer));
  return wss;
}

function isAllowedRedSecAiWebSocketOrigin(req) {
  return isAllowedWebSocketOrigin(req);
}

function getRedSecAiWebSocketStatus() {
  let connections = 0;
  for (const sockets of userConnections.values()) connections += sockets.size;
  return {
    name: "RedSecAI",
    initialized,
    connectedUsers: userConnections.size,
    connections,
    activeJobs: jobs.size,
  };
}

module.exports = {
  getRedSecAiWebSocketStatus,
  initRedSecAiWebSocket,
  isAllowedRedSecAiWebSocketOrigin,
};
