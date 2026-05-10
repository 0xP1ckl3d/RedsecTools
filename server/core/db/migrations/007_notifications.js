module.exports = {
  id: "007_notifications",
  description: "Create notifications table for cross-tool notification system.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        link_url TEXT,
        entity_type TEXT,
        entity_id TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        read_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_expires ON notifications(expires_at) WHERE expires_at IS NOT NULL;
    `);
  },
};
