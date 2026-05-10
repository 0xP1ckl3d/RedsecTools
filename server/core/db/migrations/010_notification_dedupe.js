module.exports = {
  id: "010_notification_dedupe",
  description: "Add dedupe_key column to notifications for deduplication support.",
  up(db) {
    db.exec(`
      ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key, read_at) WHERE dedupe_key IS NOT NULL;
    `);
  },
};
