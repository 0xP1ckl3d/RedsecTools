module.exports = {
  id: "032_platform_webhooks",
  description: "Add platform webhook subscriptions and delivery history.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS platform_webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret_encrypted TEXT NOT NULL,
        events_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_platform_webhooks_enabled ON platform_webhooks(enabled);

      CREATE TABLE IF NOT EXISTS platform_webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_attempt_at INTEGER,
        response_status INTEGER,
        response_body TEXT,
        error TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_platform_webhook_deliveries_webhook ON platform_webhook_deliveries(webhook_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_platform_webhook_deliveries_pending ON platform_webhook_deliveries(status, next_attempt_at);
    `);
  },
};
