"use strict";

const crypto = require("crypto");
const { db } = require("../../database");
const { executeRedSecAiTool, normalizeRedSecAiToolCall, TOOL_ALLOWLIST } = require("./context");

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_PER_USER = 20;
const recentEvents = [];

db.exec(`
  CREATE TABLE IF NOT EXISTS redsecai_pending_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT,
    tool TEXT NOT NULL,
    capability TEXT,
    method TEXT,
    path TEXT,
    args_json TEXT NOT NULL,
    summary TEXT,
    source TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    executed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_redsecai_pending_actions_user ON redsecai_pending_actions(user_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_redsecai_pending_actions_expires ON redsecai_pending_actions(expires_at);
`);

const stmts = {
  upsertAction: db.prepare(`
    INSERT OR REPLACE INTO redsecai_pending_actions (
      id, user_id, username, tool, capability, method, path, args_json, summary, source, created_at, expires_at, executed_at
    ) VALUES (
      @id, @userId, @username, @tool, @capability, @method, @path, @argsJson, @summary, @source, @createdAt, @expiresAt, @executedAt
    )
  `),
  getAction: db.prepare("SELECT * FROM redsecai_pending_actions WHERE id = ?"),
  deleteAction: db.prepare("DELETE FROM redsecai_pending_actions WHERE id = ?"),
  deleteExpiredActions: db.prepare("DELETE FROM redsecai_pending_actions WHERE expires_at <= ? OR executed_at IS NOT NULL"),
  listActionsForUser: db.prepare(`
    SELECT * FROM redsecai_pending_actions
    WHERE user_id = ? AND expires_at > ? AND executed_at IS NULL
    ORDER BY created_at DESC
  `),
  listPendingActions: db.prepare(`
    SELECT * FROM redsecai_pending_actions
    WHERE expires_at > ? AND executed_at IS NULL
    ORDER BY created_at DESC
  `),
};

function now() {
  return Date.now();
}

function summarizeAction(toolName, args = {}) {
  if (toolName === "calendar.entry.create") {
    const body = args.body || args;
    return `Create calendar entry "${body.title || "Untitled"}"`;
  }
  if (toolName === "calendar.entry.update") {
    const body = args.body || args;
    return `Update calendar entry ${args.id || args.pathParams?.id || ""}${body.title ? ` to "${body.title}"` : ""}`.trim();
  }
  if (toolName === "calendar.project.create") {
    const body = args.body || args;
    return `Create project "${body.name || "Untitled"}"`;
  }
  if (toolName === "calendar.project.update") {
    const body = args.body || args;
    return `Update project ${args.id || args.pathParams?.id || ""}${body.name ? ` to "${body.name}"` : ""}`.trim();
  }
  if (toolName === "calendar.allocation.create") {
    const body = args.body || args;
    return `Assign user to project ${body.projectId || "unknown"}`;
  }
  if (toolName === "calendar.project.schedule") {
    const body = args.body || args;
    if (body.projectName || body.title) return `Schedule project "${body.projectName || body.title}"`;
    return `Assign calendar time to project ${body.projectId || "unknown"}`;
  }
  if (toolName === "homepage.bulletin.create") {
    const body = args.body || args;
    return `Create bulletin "${body.title || "Untitled"}"`;
  }
  if (toolName === "homepage.bulletin.update") {
    const body = args.body || args;
    return `Update bulletin ${args.id || args.pathParams?.id || ""}${body.title ? ` to "${body.title}"` : ""}`.trim();
  }
  if (toolName === "wiki.page.create") {
    const body = args.body || args;
    return `Create ${body.scope === "personal" ? "personal" : "team"} wiki page "${body.title || "Untitled"}"`;
  }
  if (toolName === "wiki.page.update") {
    const body = args.body || args;
    return `Update wiki page ${args.id || args.pathParams?.id || ""}${body.title ? ` to "${body.title}"` : ""}`.trim();
  }
  if (toolName === "reporter.note.create") {
    const body = args.body || args;
    return `Create Reporter note "${body.title || "Untitled Note"}"`;
  }
  if (toolName === "reporter.project.create") {
    const body = args.body || args;
    return `Create Reporter project "${body.title || "Untitled"}"`;
  }
  if (toolName === "reporter.project.update") {
    const body = args.body || args;
    return `Update Reporter project ${args.id || args.pathParams?.id || ""}${body.title ? ` to "${body.title}"` : ""}`.trim();
  }
  if (toolName === "survey.create") {
    const body = args.body || args;
    return `Create survey "${body.title || "Untitled"}"`;
  }
  if (toolName === "survey.update") {
    const body = args.body || args;
    return `Update survey ${args.id || args.pathParams?.id || ""}${body.title ? ` to "${body.title}"` : ""}`.trim();
  }
  return `Run ${toolName}`;
}

function cleanExpiredActions() {
  stmts.deleteExpiredActions.run(now());
}

function rememberEvent(event) {
  recentEvents.unshift({
    ts: Math.floor(now() / 1000),
    ...event,
  });
  recentEvents.splice(100);
}

function createPendingAction(user, call, source = "model") {
  cleanExpiredActions();
  const normalizedCall = normalizeRedSecAiToolCall(call);
  const userId = user?.id || user?.userId;
  const existing = listInternalActionsForUser(userId);
  for (const action of existing.slice(MAX_PENDING_PER_USER - 1)) {
    stmts.deleteAction.run(action.id);
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const definition = TOOL_ALLOWLIST[normalizedCall.tool] || {};
  const action = {
    id,
    userId,
    username: user?.username || null,
    tool: normalizedCall.tool,
    capability: definition.capability || "unknown",
    method: definition.method || "POST",
    path: definition.path || "",
    args: normalizedCall.args || {},
    summary: summarizeAction(normalizedCall.tool, normalizedCall.args || {}),
    source,
    createdAt: now(),
    expiresAt: now() + ACTION_TTL_MS,
    executedAt: null,
  };
  persistAction(action);
  rememberEvent({
    type: "action_created",
    userId,
    username: action.username,
    tool: action.tool,
    summary: action.summary,
  });
  return serializeAction(action);
}

function persistAction(action) {
  stmts.upsertAction.run({
    id: action.id,
    userId: action.userId,
    username: action.username || null,
    tool: action.tool,
    capability: action.capability || "unknown",
    method: action.method || "POST",
    path: action.path || "",
    argsJson: JSON.stringify(action.args || {}),
    summary: action.summary || `Run ${action.tool}`,
    source: action.source || "model",
    createdAt: Number(action.createdAt) || now(),
    expiresAt: Number(action.expiresAt) || (now() + ACTION_TTL_MS),
    executedAt: action.executedAt || null,
  });
}

function parseActionRow(row) {
  if (!row) return null;
  let args = {};
  try {
    args = JSON.parse(row.args_json || "{}");
  } catch (_) {
    args = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username || null,
    tool: row.tool,
    capability: row.capability || "unknown",
    method: row.method || "POST",
    path: row.path || "",
    args,
    summary: row.summary || `Run ${row.tool}`,
    source: row.source || "model",
    createdAt: Number(row.created_at) || 0,
    expiresAt: Number(row.expires_at) || 0,
    executedAt: row.executed_at ? Number(row.executed_at) : null,
  };
}

function getInternalAction(actionId) {
  return parseActionRow(stmts.getAction.get(actionId));
}

function listInternalActionsForUser(userId) {
  if (!userId) return [];
  cleanExpiredActions();
  return stmts.listActionsForUser.all(userId, now()).map(parseActionRow).filter(Boolean);
}

function serializeAction(action) {
  return {
    id: action.id,
    tool: action.tool,
    capability: action.capability,
    method: action.method,
    path: action.path,
    args: action.args,
    summary: action.summary,
    expiresAt: Math.floor(action.expiresAt / 1000),
  };
}

async function confirmPendingAction(req, actionId) {
  cleanExpiredActions();
  const action = getInternalAction(actionId);
  if (!action || action.userId !== req.user?.id) {
    const error = new Error("RedSecAI action not found or expired");
    error.status = 404;
    throw error;
  }
  const normalizedCall = normalizeRedSecAiToolCall(action);
  action.tool = normalizedCall.tool;
  action.args = normalizedCall.args;
  const result = await executeRedSecAiTool(req, action.tool, action.args, { confirmed: true });
  action.executedAt = now();
  stmts.deleteAction.run(action.id);
  rememberEvent({
    type: result.ok ? "action_executed" : "action_failed",
    userId: action.userId,
    username: action.username,
    tool: action.tool,
    summary: action.summary,
    status: result.status,
  });
  return { action: serializeAction(action), result };
}

function cancelPendingAction(req, actionId) {
  cleanExpiredActions();
  const action = getInternalAction(actionId);
  if (!action || action.userId !== req.user?.id) {
    const error = new Error("RedSecAI action not found or expired");
    error.status = 404;
    throw error;
  }
  stmts.deleteAction.run(action.id);
  rememberEvent({
    type: "action_rejected",
    userId: action.userId,
    username: action.username,
    tool: action.tool,
    summary: action.summary,
  });
  return serializeAction(action);
}

function listPendingActionsForUser(userId) {
  return listInternalActionsForUser(userId).map(serializeAction);
}

function filterPendingActionsForUser(userId, actions = []) {
  const liveActions = new Map(listPendingActionsForUser(userId).map((action) => [action.id, action]));
  return (Array.isArray(actions) ? actions : [])
    .map((action) => liveActions.get(action?.id))
    .filter(Boolean);
}

function getRedSecAiActionStats() {
  cleanExpiredActions();
  const pending = stmts.listPendingActions.all(now()).map(parseActionRow).filter(Boolean);
  return {
    pendingCount: pending.length,
    pendingByTool: pending.reduce((acc, action) => {
      acc[action.tool] = (acc[action.tool] || 0) + 1;
      return acc;
    }, {}),
    recentEvents: recentEvents.slice(0, 30),
  };
}

module.exports = {
  cancelPendingAction,
  confirmPendingAction,
  createPendingAction,
  filterPendingActionsForUser,
  getRedSecAiActionStats,
  listPendingActionsForUser,
  summarizeAction,
};
