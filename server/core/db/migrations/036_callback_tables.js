"use strict";

module.exports = {
  id: "036_callback_tables",
  description: "Callback mini-tool tables for out-of-band request capture",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS callback_urls (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        deleted_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_callback_urls_user_id ON callback_urls(user_id);
      CREATE INDEX IF NOT EXISTS idx_callback_urls_expires_at ON callback_urls(expires_at);

      CREATE TABLE IF NOT EXISTS callback_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        callback_id TEXT NOT NULL,
        received_at INTEGER NOT NULL DEFAULT (unixepoch()),
        method TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        query TEXT NOT NULL DEFAULT '',
        source_ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT,
        headers TEXT,
        body TEXT,
        content_type TEXT,
        content_length INTEGER DEFAULT 0,
        referer TEXT,
        origin TEXT,
        cookies TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_callback_requests_callback_id ON callback_requests(callback_id);
    `);
  },
};
