"use strict";

const { WebSocketServer } = require("ws");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { getSession, getRolePermissionsByUserId, getUserById } = require("./database");
const { buildScopedContext } = require("./modules/redsecai/context");
const provider = require("./modules/redsecai/provider");
const { logEvent, logWarn } = require("./core/logger");

const COOKIE_SECRET = process.env.COOKIE_SECRET;
const HEARTBEAT_INTERVAL = 30000;
const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_BUFFER_CHARS = 24000;

const userConnections = new Map();
const jobs = new Map();

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

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-12)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 4000),
    }))
    .filter((message) => message.content.trim());
}

function buildSystemMessages(scopedContext) {
  return [
    {
      role: "system",
      content: `You are RedSecAI, the built-in local assistant for RedSecTools.

Security boundaries:
- You operate only for the logged-in user and only with the scoped context provided by RedSecTools APIs.
- You have access to server-executed internal tool results in TOOL_RESULTS. These results have already been fetched through the user's own RBAC-scoped APIs.
- Do not say you have no access to internal tools when TOOL_RESULTS contains successful tool outputs. Instead, say which scoped data is available.
- Never invent platform data. If TOOL_RESULTS is empty, failed, or lacks a requested field, say the data is not available in the current scoped tool results.
- You do not have admin scope and must not claim to perform admin actions.
- You must not access, request, infer, store, or summarize decrypted content from RedSecPaste, RedSecShare, RedSecTeam chat, or RedSecVault.
- You may help draft report text, summarize permitted threat intel, and reason about permitted calendar context.
- Stage 1 is read-only for platform actions. If the user asks you to update data, draft the exact change and tell them it needs explicit confirmation in the relevant tool.
- Do not ask users to paste passwords, recovery codes, API keys, private keys, TOTP secrets, session tokens, bearer tokens, URL fragment encryption keys, or decrypted vault content.

Be concise, practical, and transparent about limitations.`,
    },
    {
      role: "system",
      content: `SERVER-EXECUTED TOOL ACCESS FOR THIS USER: ${scopedContext.allowedTools.join(", ") || "none"}\n\n${scopedContext.text}`,
    },
  ];
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
    done: false,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(jobId, job);
  broadcastToUser(auth.user.id, { type: "redsecai_start", jobId });

  try {
    const scopedContext = await buildScopedContext(buildScopedReq(auth, msg.page || {}), msg.page || {});
    logEvent("redsecai:stream_start", null, {
      actorUserId: auth.user.id,
      actorUsername: auth.user.username,
      allowedTools: scopedContext.allowedTools,
      model: provider.getConfig().model,
    });

    for await (const chunk of provider.chatStream([
      ...buildSystemMessages(scopedContext),
      ...messages,
    ])) {
      job.buffer += chunk;
      job.updatedAt = Date.now();
      trimBuffer(job);
      broadcastToUser(auth.user.id, { type: "redsecai_delta", jobId, delta: chunk });
    }
    job.done = true;
    job.updatedAt = Date.now();
    broadcastToUser(auth.user.id, { type: "redsecai_done", jobId, message: job.buffer });
  } catch (error) {
    job.done = true;
    job.error = error.status === 503 ? error.message : "RedSecAI is unavailable";
    job.updatedAt = Date.now();
    logWarn("redsecai:stream_failed", { message: error.message, status: error.status || 500 });
    broadcastToUser(auth.user.id, { type: "redsecai_error", jobId, error: job.error });
  }
}

function resumeJob(ws, auth, jobId) {
  const job = jobs.get(jobId);
  if (!job || job.userId !== auth.user.id) return;
  send(ws, {
    type: "redsecai_snapshot",
    jobId,
    message: job.buffer,
    done: job.done,
    error: job.error,
  });
}

function initRedSecAiWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/redsecai") return;

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

module.exports = {
  initRedSecAiWebSocket,
};
