CREATE TABLE pastes (
  id TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  has_password INTEGER NOT NULL,
  burn_after_reading INTEGER NOT NULL DEFAULT 0,
  source_ip TEXT,
  syntax TEXT DEFAULT 'plaintext',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  has_password INTEGER NOT NULL DEFAULT 0,
  burn_after_reading INTEGER NOT NULL DEFAULT 0,
  source_ip TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_size INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO pastes (id, ciphertext, iv, has_password, burn_after_reading, source_ip, syntax, expires_at, created_at)
VALUES ('legacyPaste123456789012', X'00112233445566778899', X'010203040506070809101112', 0, 0, '203.0.113.10', 'plaintext', 4102444800, 1700000000);

INSERT INTO users (id, email, username, password_hash, created_at, updated_at)
VALUES ('legacyUser1234567890123', 'legacy@example.test', 'legacy', 'bcrypt-hash-placeholder', 1700000000, 1700000000);
