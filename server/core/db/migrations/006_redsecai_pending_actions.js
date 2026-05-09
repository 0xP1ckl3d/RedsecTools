module.exports = {
  id: "006_redsecai_pending_actions",
  description: "Create persisted RedSecAI pending action queue.",
  up(db) {
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
  },
};
