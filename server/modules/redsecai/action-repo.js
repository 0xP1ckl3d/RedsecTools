"use strict";

const { db } = require("../../database");

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

function upsertAction(action) {
  stmts.upsertAction.run(action);
}

function getAction(id) {
  return stmts.getAction.get(id);
}

function deleteAction(id) {
  return stmts.deleteAction.run(id);
}

function deleteExpiredActions(nowMs) {
  return stmts.deleteExpiredActions.run(nowMs);
}

function listActionsForUser(userId, nowMs) {
  return stmts.listActionsForUser.all(userId, nowMs);
}

function listPendingActions(nowMs) {
  return stmts.listPendingActions.all(nowMs);
}

module.exports = {
  deleteAction,
  deleteExpiredActions,
  getAction,
  listActionsForUser,
  listPendingActions,
  upsertAction,
};
