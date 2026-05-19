module.exports = {
  id: "031_service_accounts",
  description: "Add scoped service accounts and hashed API tokens.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS service_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_service_accounts_enabled ON service_accounts(enabled);

      CREATE TABLE IF NOT EXISTS service_account_tokens (
        id TEXT PRIMARY KEY,
        service_account_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        prefix TEXT NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_service_account_tokens_account ON service_account_tokens(service_account_id);
      CREATE INDEX IF NOT EXISTS idx_service_account_tokens_hash ON service_account_tokens(token_hash);
    `);
  },
};
