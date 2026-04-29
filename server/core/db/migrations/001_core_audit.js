module.exports = {
  id: "001_core_audit",
  description: "Add schema migration tracking and redacted audit event storage.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT,
        actor_username TEXT,
        actor_type TEXT NOT NULL DEFAULT 'system',
        ip_address TEXT,
        user_agent TEXT,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        outcome TEXT NOT NULL DEFAULT 'success',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(category, action, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_type, target_id, created_at DESC);
    `);
  },
};
