"use strict";

const crypto = require("crypto");
const { executeRedSecAiTool, TOOL_ALLOWLIST } = require("./context");

const ACTION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_PER_USER = 20;
const pendingActions = new Map();
const recentEvents = [];

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
  return `Run ${toolName}`;
}

function cleanExpiredActions() {
  const cutoff = now();
  for (const [id, action] of pendingActions) {
    if (action.expiresAt <= cutoff || action.executedAt) pendingActions.delete(id);
  }
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
  const userId = user?.id || user?.userId;
  const existing = [...pendingActions.values()].filter((action) => action.userId === userId);
  for (const action of existing.slice(MAX_PENDING_PER_USER - 1)) {
    pendingActions.delete(action.id);
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const definition = TOOL_ALLOWLIST[call.tool] || {};
  const action = {
    id,
    userId,
    username: user?.username || null,
    tool: call.tool,
    capability: definition.capability || "unknown",
    method: definition.method || "POST",
    path: definition.path || "",
    args: call.args || {},
    summary: summarizeAction(call.tool, call.args || {}),
    source,
    createdAt: now(),
    expiresAt: now() + ACTION_TTL_MS,
    executedAt: null,
  };
  pendingActions.set(id, action);
  rememberEvent({
    type: "action_created",
    userId,
    username: action.username,
    tool: action.tool,
    summary: action.summary,
  });
  return serializeAction(action);
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
  const action = pendingActions.get(actionId);
  if (!action || action.userId !== req.user?.id) {
    const error = new Error("RedSecAI action not found or expired");
    error.status = 404;
    throw error;
  }
  const result = await executeRedSecAiTool(req, action.tool, action.args, { confirmed: true });
  action.executedAt = now();
  pendingActions.delete(action.id);
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

function listPendingActionsForUser(userId) {
  cleanExpiredActions();
  return [...pendingActions.values()]
    .filter((action) => action.userId === userId)
    .map(serializeAction);
}

function getRedSecAiActionStats() {
  cleanExpiredActions();
  const pending = [...pendingActions.values()];
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
  confirmPendingAction,
  createPendingAction,
  getRedSecAiActionStats,
  listPendingActionsForUser,
  summarizeAction,
};
