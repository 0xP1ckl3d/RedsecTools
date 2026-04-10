const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "pastes.db");

// Ensure data directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ensure files directories exist
const FILES_DIR = path.join(__dirname, "..", "data", "files");
const TMP_DIR = path.join(__dirname, "..", "data", "tmp");
const AVATARS_DIR = path.join(__dirname, "..", "data", "avatars");
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    ciphertext BLOB NOT NULL,
    iv BLOB NOT NULL,
    iv_password BLOB,
    salt BLOB,
    has_password INTEGER NOT NULL,
    burn_after_reading INTEGER NOT NULL DEFAULT 0,
    source_ip TEXT,
    syntax TEXT DEFAULT 'plaintext',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    user_id TEXT,
    guest_invited_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_expires_at ON pastes(expires_at);

  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    salt BLOB,
    has_password INTEGER NOT NULL DEFAULT 0,
    burn_after_reading INTEGER NOT NULL DEFAULT 0,
    burned INTEGER NOT NULL DEFAULT 0,
    source_ip TEXT,
    file_count INTEGER NOT NULL DEFAULT 0,
    total_size INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    user_id TEXT,
    guest_invited_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at);

  CREATE TABLE IF NOT EXISTS share_files (
    id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL,
    encrypted_filename TEXT NOT NULL,
    filename_iv BLOB NOT NULL,
    file_size INTEGER NOT NULL,
    encrypted_size INTEGER NOT NULL,
    iv BLOB NOT NULL,
    iv_password BLOB,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_index INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_share_files_share_id ON share_files(share_id);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token ON invites(token);

  CREATE TABLE IF NOT EXISTS guest_links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    tool TEXT NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_links_token ON guest_links(token);

  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    used INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Chat: User RSA public keys + encrypted private key backup
  CREATE TABLE IF NOT EXISTS user_keys (
    user_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    encrypted_private_key TEXT,
    private_key_iv TEXT,
    private_key_salt TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Chat: Conversations (direct + group)
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
    key_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Chat: Conversation membership
  CREATE TABLE IF NOT EXISTS conversation_members (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_read_at INTEGER NOT NULL DEFAULT 0,
    UNIQUE(conversation_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON conversation_members(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);

  -- Chat: E2E key distribution (one row per user per key epoch)
  CREATE TABLE IF NOT EXISTS conversation_key_epochs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    encrypted_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(conversation_id, user_id, key_version)
  );
  CREATE INDEX IF NOT EXISTS idx_conv_key_epochs_conv ON conversation_key_epochs(conversation_id);

  -- Chat: Encrypted messages
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);

  -- Vault: Personal and team vaults
  CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    name_encrypted BLOB NOT NULL,
    name_iv BLOB NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('personal', 'team')),
    owner_id TEXT NOT NULL,
    encrypted_master_key BLOB,
    master_key_iv BLOB,
    master_key_salt BLOB,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_vaults_owner ON vaults(owner_id);

  -- Vault: Team vault membership
  CREATE TABLE IF NOT EXISTS vault_members (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    encrypted_master_key TEXT NOT NULL,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(vault_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_vault_members_vault ON vault_members(vault_id);
  CREATE INDEX IF NOT EXISTS idx_vault_members_user ON vault_members(user_id);

  -- Vault: Encrypted entries
  CREATE TABLE IF NOT EXISTS vault_entries (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('password', 'note', 'api_key', 'ssh_key', 'totp', 'custom')),
    title_encrypted BLOB NOT NULL,
    title_iv BLOB NOT NULL,
    data_encrypted BLOB NOT NULL,
    data_iv BLOB NOT NULL,
    folder_encrypted BLOB,
    folder_iv BLOB,
    favorite INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_vault_entries_vault ON vault_entries(vault_id);

  -- Vault: Entry version history
  CREATE TABLE IF NOT EXISTS vault_entry_history (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    data_encrypted BLOB NOT NULL,
    data_iv BLOB NOT NULL,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_vault_entry_history_entry ON vault_entry_history(entry_id);

  -- Vault: Cross-vault entry sharing
  CREATE TABLE IF NOT EXISTS vault_entry_shares (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    encrypted_entry_key TEXT NOT NULL,
    title_encrypted BLOB NOT NULL,
    title_iv BLOB NOT NULL,
    data_encrypted BLOB NOT NULL,
    data_iv BLOB NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER,
    UNIQUE(entry_id, to_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_vault_entry_shares_to ON vault_entry_shares(to_user_id);
  CREATE INDEX IF NOT EXISTS idx_vault_entry_shares_expires ON vault_entry_shares(expires_at);

  -- Vault: Audit log
  CREATE TABLE IF NOT EXISTS vault_audit_log (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    entry_id TEXT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_vault_audit_vault ON vault_audit_log(vault_id);

  -- MFA: User TOTP configuration
  CREATE TABLE IF NOT EXISTS user_mfa (
    user_id TEXT NOT NULL PRIMARY KEY,
    totp_secret_encrypted TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- MFA: Pending login tokens (password verified, TOTP pending)
  CREATE TABLE IF NOT EXISTS mfa_pending_logins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    keep_signed_in INTEGER NOT NULL DEFAULT 0,
    remember_browser INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_mfa_pending_expires ON mfa_pending_logins(expires_at);

  -- MFA: Trusted devices ("remember this browser")
  CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    device_name TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_mfa_trusted_user ON mfa_trusted_devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_mfa_trusted_expires ON mfa_trusted_devices(expires_at);

  -- Homepage: User shortcuts
  CREATE TABLE IF NOT EXISTS homepage_shortcuts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'personal',
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_shortcuts_user_cat ON homepage_shortcuts(user_id, category);

  -- Homepage: User layout preferences
  CREATE TABLE IF NOT EXISTS homepage_settings (
    user_id TEXT NOT NULL PRIMARY KEY,
    layout TEXT NOT NULL DEFAULT '{"showWeather":true,"showSearch":true,"showShortcuts":true}',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Add avatar column to users table (safe migration)
try { db.exec("ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER"); } catch {}

// Add needs_rekey column to vault_members (safe migration)
try { db.exec("ALTER TABLE vault_members ADD COLUMN needs_rekey INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE mfa_pending_logins ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN description TEXT"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN icon_url TEXT"); } catch {}

// Per-user favourite shortcuts (junction table — works for personal AND team shortcuts)
db.exec(`CREATE TABLE IF NOT EXISTS user_favourite_shortcuts (
  user_id TEXT NOT NULL,
  shortcut_id TEXT NOT NULL,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, shortcut_id)
)`);

const VALID_SYNTAX_OPTIONS = [
  "plaintext", "python", "javascript", "typescript", "bash",
  "json", "xml", "css", "sql",
  "c", "cpp", "csharp", "go", "java", "kotlin",
  "php", "ruby", "rust", "swift", "lua",
  "scala", "r", "perl", "powershell", "vim",
  "yaml", "markdown", "dockerfile", "diff", "ini",
];

// Max expiry: 3 days
const MAX_EXPIRY = 3 * 24 * 60 * 60; // 259200
const VALID_EXPIRY_OPTIONS = [3600, 43200, 86400, MAX_EXPIRY]; // 1h, 12h, 24h, 3d
const VALID_GUEST_EXPIRY = [3600, 43200, 86400]; // 1h, 12h, 24h

const stmts = {
  // --- Paste statements ---
  createPaste: db.prepare(`
    INSERT INTO pastes (id, ciphertext, iv, iv_password, salt, has_password, burn_after_reading, source_ip, syntax, expires_at, user_id, guest_invited_by)
    VALUES (@id, @ciphertext, @iv, @ivPassword, @salt, @hasPassword, @burnAfterReading, @sourceIp, @syntax, @expiresAt, @userId, @guestInvitedBy)
  `),
  getPasteById: db.prepare("SELECT * FROM pastes WHERE id = ?"),
  deletePasteById: db.prepare("DELETE FROM pastes WHERE id = ?"),
  deleteExpiredPastes: db.prepare("DELETE FROM pastes WHERE expires_at < unixepoch()"),
  countAllPastes: db.prepare("SELECT COUNT(*) as total FROM pastes"),
  countActivePastes: db.prepare("SELECT COUNT(*) as total FROM pastes WHERE expires_at >= unixepoch()"),
  countExpiredPastes: db.prepare("SELECT COUNT(*) as total FROM pastes WHERE expires_at < unixepoch()"),
  listPastes: db.prepare(`
    SELECT p.id, p.has_password, p.burn_after_reading, p.source_ip, p.syntax, length(p.ciphertext) as size,
           p.created_at, p.expires_at, p.user_id, p.guest_invited_by, u.username
    FROM pastes p LEFT JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `),
  consumePaste: db.transaction((id) => {
    const row = stmts.getPasteById.get(id);
    if (!row) return null;
    stmts.deletePasteById.run(id);
    return row;
  }),

  // --- Share statements ---
  createShare: db.prepare(`
    INSERT INTO shares (id, salt, has_password, burn_after_reading, source_ip, file_count, total_size, expires_at, user_id, guest_invited_by)
    VALUES (@id, @salt, @hasPassword, @burnAfterReading, @sourceIp, @fileCount, @totalSize, @expiresAt, @userId, @guestInvitedBy)
  `),
  getShareById: db.prepare("SELECT * FROM shares WHERE id = ?"),
  markShareBurned: db.prepare("UPDATE shares SET burned = 1 WHERE id = ? AND burned = 0"),
  deleteShareById: db.prepare("DELETE FROM shares WHERE id = ?"),
  deleteExpiredShares: db.prepare("DELETE FROM shares WHERE expires_at < unixepoch() RETURNING id"),
  countAllShares: db.prepare("SELECT COUNT(*) as total FROM shares"),
  countActiveShares: db.prepare("SELECT COUNT(*) as total FROM shares WHERE expires_at >= unixepoch()"),
  countExpiredShares: db.prepare("SELECT COUNT(*) as total FROM shares WHERE expires_at < unixepoch()"),
  shareDiskUsage: db.prepare("SELECT COALESCE(SUM(total_size), 0) as total FROM shares"),
  listShares: db.prepare(`
    SELECT s.id, s.has_password, s.burn_after_reading, s.source_ip, s.file_count, s.total_size,
           s.created_at, s.expires_at, s.user_id, s.guest_invited_by, u.username
    FROM shares s LEFT JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC LIMIT ? OFFSET ?
  `),

  // --- Share file statements ---
  createShareFile: db.prepare(`
    INSERT INTO share_files (id, share_id, encrypted_filename, filename_iv, file_size, encrypted_size, iv, iv_password, mime_type, file_index)
    VALUES (@id, @shareId, @encryptedFilename, @filenameIv, @fileSize, @encryptedSize, @iv, @ivPassword, @mimeType, @fileIndex)
  `),
  getFilesByShareId: db.prepare("SELECT * FROM share_files WHERE share_id = ? ORDER BY file_index"),
  getShareFileById: db.prepare("SELECT sf.*, s.burn_after_reading, s.burned, s.expires_at FROM share_files sf JOIN shares s ON sf.share_id = s.id WHERE sf.id = ?"),
  deleteFilesByShareId: db.prepare("DELETE FROM share_files WHERE share_id = ?"),
  deleteShareFileById: db.prepare("DELETE FROM share_files WHERE id = ?"),

  // Atomic consume: read file row + delete in one transaction (prevents race conditions)
  consumeShareFile: db.transaction((fileId) => {
    const row = stmts.getShareFileById.get(fileId);
    if (!row) return null;
    stmts.deleteShareFileById.run(fileId);
    return row;
  }),

  // --- User statements ---
  createUser: db.prepare(`
    INSERT INTO users (id, email, username, password_hash)
    VALUES (@id, @email, @username, @passwordHash)
  `),
  getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
  getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  getUserByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  updateUserPassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?"),
  updateUser: db.prepare("UPDATE users SET email = @email, username = @username, updated_at = unixepoch() WHERE id = @id"),
  updateUsername: db.prepare("UPDATE users SET username = ?, updated_at = unixepoch() WHERE id = ?"),
  suspendUser: db.prepare("UPDATE users SET suspended = 1, updated_at = unixepoch() WHERE id = ?"),
  unsuspendUser: db.prepare("UPDATE users SET suspended = 0, updated_at = unixepoch() WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  listUsers: db.prepare(`
    SELECT id, email, username, suspended, created_at, updated_at
    FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?
  `),
  countUsers: db.prepare("SELECT COUNT(*) as total FROM users"),

  // --- Session statements ---
  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @expiresAt, @ipAddress, @userAgent)
  `),
  getSessionById: db.prepare("SELECT s.*, u.username, u.suspended, u.avatar_updated_at FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < unixepoch()"),
  deleteSessionsByUserId: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?"),

  // --- Invite statements ---
  createInvite: db.prepare(`
    INSERT INTO invites (id, email, token, created_by, expires_at)
    VALUES (@id, @email, @token, @createdBy, @expiresAt)
  `),
  getInviteByToken: db.prepare("SELECT * FROM invites WHERE token = ?"),
  getInviteByEmail: db.prepare("SELECT * FROM invites WHERE email = ? AND used = 0 AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1"),
  markInviteUsed: db.prepare("UPDATE invites SET used = 1 WHERE id = ?"),
  deleteExpiredInvites: db.prepare("DELETE FROM invites WHERE expires_at < unixepoch() AND used = 0"),
  revokeInvite: db.prepare("DELETE FROM invites WHERE id = ? AND used = 0"),
  listInvites: db.prepare(`
    SELECT id, email, token, created_by, used, expires_at, created_at
    FROM invites ORDER BY created_at DESC LIMIT ? OFFSET ?
  `),
  countInvites: db.prepare("SELECT COUNT(*) as total FROM invites"),

  // --- Guest link statements ---
  createGuestLink: db.prepare(`
    INSERT INTO guest_links (id, token, created_by, tool, max_uses, expires_at)
    VALUES (@id, @token, @createdBy, @tool, @maxUses, @expiresAt)
  `),
  getGuestLinkByToken: db.prepare("SELECT * FROM guest_links WHERE token = ?"),
  redeemGuestLink: db.transaction((token) => {
    const link = stmts.getGuestLinkByToken.get(token);
    if (!link) return null;
    if (link.expires_at < Math.floor(Date.now() / 1000)) return null;
    if (link.use_count >= link.max_uses) return null;
    const result = db.prepare("UPDATE guest_links SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses").run(link.id);
    if (result.changes === 0) return null;
    return link;
  }),
  deleteExpiredGuestLinks: db.prepare("DELETE FROM guest_links WHERE expires_at < unixepoch()"),

  // --- Password reset statements ---
  createPasswordReset: db.prepare(`
    INSERT INTO password_resets (id, user_id, token, expires_at)
    VALUES (@id, @userId, @token, @expiresAt)
  `),
  getPasswordResetByToken: db.prepare("SELECT pr.*, u.email, u.username FROM password_resets pr JOIN users u ON pr.user_id = u.id WHERE pr.token = ?"),
  markPasswordResetUsed: db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?"),
  deleteExpiredPasswordResets: db.prepare("DELETE FROM password_resets WHERE expires_at < unixepoch() AND used = 0"),

  // --- Settings statements ---
  getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"),
  getAllSettings: db.prepare("SELECT key, value FROM settings"),

  // --- Chat: User keys ---
  createUserKey: db.prepare(`
    INSERT INTO user_keys (user_id, public_key, encrypted_private_key, private_key_iv, private_key_salt)
    VALUES (@userId, @publicKey, @encryptedPrivateKey, @privateKeyIv, @privateKeySalt)
  `),
  getUserKey: db.prepare("SELECT * FROM user_keys WHERE user_id = ?"),
  replaceUserKey: db.prepare(`
    UPDATE user_keys SET public_key = @publicKey, encrypted_private_key = @encryptedPrivateKey,
      private_key_iv = @privateKeyIv, private_key_salt = @privateKeySalt, created_at = unixepoch()
    WHERE user_id = @userId
  `),
  updateKeyBackup: db.prepare(`
    UPDATE user_keys SET encrypted_private_key = @encryptedPrivateKey,
      private_key_iv = @privateKeyIv, private_key_salt = @privateKeySalt
    WHERE user_id = @userId
  `),
  searchUsersWithKeys: db.prepare(`
    SELECT u.id, u.username, u.avatar_updated_at, CASE WHEN uk.user_id IS NOT NULL THEN 1 ELSE 0 END as has_public_key
    FROM users u LEFT JOIN user_keys uk ON u.id = uk.user_id
    WHERE u.username LIKE ? || '%' AND u.id != ? AND u.suspended = 0
    ORDER BY u.username LIMIT 50
  `),

  // --- Chat: Conversations ---
  createConversation: db.prepare(`
    INSERT INTO conversations (id, name, type, created_by)
    VALUES (@id, @name, @type, @createdBy)
  `),
  getConversationById: db.prepare("SELECT * FROM conversations WHERE id = ?"),
  updateConversationTimestamp: db.prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?"),
  incrementKeyVersion: db.prepare("UPDATE conversations SET key_version = key_version + 1, updated_at = unixepoch() WHERE id = ?"),
  deleteConversationById: db.prepare("DELETE FROM conversations WHERE id = ?"),
  findDirectConversation: db.prepare(`
    SELECT c.* FROM conversations c
    JOIN conversation_members cm1 ON c.id = cm1.conversation_id AND cm1.user_id = ?
    JOIN conversation_members cm2 ON c.id = cm2.conversation_id AND cm2.user_id = ?
    WHERE c.type = 'direct'
    LIMIT 1
  `),

  // --- Chat: Conversation members ---
  addConversationMember: db.prepare(`
    INSERT INTO conversation_members (id, conversation_id, user_id, role)
    VALUES (@id, @conversationId, @userId, @role)
  `),
  getConversationMembers: db.prepare("SELECT cm.*, u.username, u.avatar_updated_at FROM conversation_members cm JOIN users u ON cm.user_id = u.id WHERE cm.conversation_id = ?"),
  getConversationMember: db.prepare("SELECT * FROM conversation_members WHERE conversation_id = ? AND user_id = ?"),
  removeConversationMember: db.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?"),
  getUserConversations: db.prepare(`
    SELECT c.*, cm.role, cm.last_read_at, cm.joined_at
    FROM conversation_members cm
    JOIN conversations c ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY c.updated_at DESC
  `),
  updateLastReadAt: db.prepare("UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?"),

  // --- Chat: Key epochs ---
  createKeyEpoch: db.prepare(`
    INSERT INTO conversation_key_epochs (id, conversation_id, user_id, key_version, encrypted_key)
    VALUES (@id, @conversationId, @userId, @keyVersion, @encryptedKey)
  `),
  getKeyEpochsForUser: db.prepare("SELECT * FROM conversation_key_epochs WHERE conversation_id = ? AND user_id = ? ORDER BY key_version ASC"),
  deleteKeyEpochsForUser: db.prepare("DELETE FROM conversation_key_epochs WHERE conversation_id = ? AND user_id = ?"),

  // --- Chat: Messages ---
  createMessage: db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, ciphertext, iv, key_version, expires_at)
    VALUES (@id, @conversationId, @senderId, @ciphertext, @iv, @keyVersion, @expiresAt)
  `),
  getMessagesByConversation: db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?"),
  getMessagesBefore: db.prepare("SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?"),
  countUnreadMessages: db.prepare("SELECT COUNT(*) as total FROM messages WHERE conversation_id = ? AND created_at > ?"),
  deleteExpiredMessages: db.prepare("DELETE FROM messages WHERE expires_at < unixepoch()"),
  deleteMessagesByConversation: db.prepare("DELETE FROM messages WHERE conversation_id = ?"),

  // --- Chat: Admin ---
  countConversations: db.prepare("SELECT COUNT(*) as total FROM conversations"),
  countActiveConversations: db.prepare("SELECT COUNT(*) as total FROM conversations WHERE updated_at >= unixepoch() - 86400"),
  countAllMessages: db.prepare("SELECT COUNT(*) as total FROM messages"),
  listConversationsAdmin: db.prepare(`
    SELECT c.id, c.name, c.type, c.key_version, c.created_by, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) as member_count,
           (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
           u.username as created_by_username
    FROM conversations c LEFT JOIN users u ON c.created_by = u.id
    ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
  `),
  deleteKeyEpochsByConversation: db.prepare("DELETE FROM conversation_key_epochs WHERE conversation_id = ?"),
  deleteMembersByConversation: db.prepare("DELETE FROM conversation_members WHERE conversation_id = ?"),

  // --- Avatar ---
  updateAvatarTimestamp: db.prepare("UPDATE users SET avatar_updated_at = unixepoch() WHERE id = ?"),
  clearAvatarTimestamp: db.prepare("UPDATE users SET avatar_updated_at = NULL WHERE id = ?"),

  // --- Vault: Vaults ---
  createVault: db.prepare(`
    INSERT INTO vaults (id, name_encrypted, name_iv, type, owner_id, encrypted_master_key, master_key_iv, master_key_salt)
    VALUES (@id, @nameEncrypted, @nameIv, @type, @ownerId, @encryptedMasterKey, @masterKeyIv, @masterKeySalt)
  `),
  getVaultById: db.prepare("SELECT * FROM vaults WHERE id = ?"),
  getVaultsByOwner: db.prepare("SELECT * FROM vaults WHERE owner_id = ? ORDER BY created_at DESC"),
  getVaultsByMembership: db.prepare(`
    SELECT v.* FROM vaults v JOIN vault_members vm ON v.id = vm.vault_id
    WHERE vm.user_id = ? ORDER BY v.created_at DESC
  `),
  updateVaultName: db.prepare("UPDATE vaults SET name_encrypted = @nameEncrypted, name_iv = @nameIv, updated_at = unixepoch() WHERE id = @id"),
  deleteVaultById: db.prepare("DELETE FROM vaults WHERE id = ?"),

  // --- Vault: Members ---
  addVaultMember: db.prepare(`
    INSERT INTO vault_members (id, vault_id, user_id, role, encrypted_master_key)
    VALUES (@id, @vaultId, @userId, @role, @encryptedMasterKey)
  `),
  getVaultMembers: db.prepare("SELECT vm.*, u.username, u.avatar_updated_at FROM vault_members vm JOIN users u ON vm.user_id = u.id WHERE vm.vault_id = ?"),
  getVaultMember: db.prepare("SELECT * FROM vault_members WHERE vault_id = ? AND user_id = ?"),
  removeVaultMember: db.prepare("DELETE FROM vault_members WHERE vault_id = ? AND user_id = ?"),
  deleteMembersByVault: db.prepare("DELETE FROM vault_members WHERE vault_id = ?"),

  // --- Vault: Entries ---
  createVaultEntry: db.prepare(`
    INSERT INTO vault_entries (id, vault_id, type, title_encrypted, title_iv, data_encrypted, data_iv, folder_encrypted, folder_iv, favorite)
    VALUES (@id, @vaultId, @type, @titleEncrypted, @titleIv, @dataEncrypted, @dataIv, @folderEncrypted, @folderIv, @favorite)
  `),
  getVaultEntries: db.prepare("SELECT * FROM vault_entries WHERE vault_id = ? ORDER BY created_at DESC"),
  getVaultEntryById: db.prepare("SELECT * FROM vault_entries WHERE id = ?"),
  updateVaultEntry: db.prepare(`
    UPDATE vault_entries SET title_encrypted = @titleEncrypted, title_iv = @titleIv,
      data_encrypted = @dataEncrypted, data_iv = @dataIv, folder_encrypted = @folderEncrypted,
      folder_iv = @folderIv, favorite = @favorite, version = version + 1, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteVaultEntryById: db.prepare("DELETE FROM vault_entries WHERE id = ?"),
  deleteEntriesByVault: db.prepare("DELETE FROM vault_entries WHERE vault_id = ?"),
  countVaultEntries: db.prepare("SELECT COUNT(*) as total FROM vault_entries WHERE vault_id = ?"),

  // --- Vault: Entry history ---
  createVaultEntryHistory: db.prepare(`
    INSERT INTO vault_entry_history (id, entry_id, data_encrypted, data_iv, version)
    VALUES (@id, @entryId, @dataEncrypted, @dataIv, @version)
  `),
  getVaultEntryHistory: db.prepare("SELECT * FROM vault_entry_history WHERE entry_id = ? ORDER BY version DESC LIMIT ?"),
  deleteHistoryByEntry: db.prepare("DELETE FROM vault_entry_history WHERE entry_id = ?"),

  // --- Vault: Entry shares ---
  createVaultEntryShare: db.prepare(`
    INSERT INTO vault_entry_shares (id, entry_id, from_user_id, to_user_id, encrypted_entry_key, title_encrypted, title_iv, data_encrypted, data_iv, expires_at)
    VALUES (@id, @entryId, @fromUserId, @toUserId, @encryptedEntryKey, @titleEncrypted, @titleIv, @dataEncrypted, @dataIv, @expiresAt)
  `),
  getSharesForUser: db.prepare("SELECT ves.*, u.username as from_username, ve.type as entry_type FROM vault_entry_shares ves JOIN users u ON ves.from_user_id = u.id JOIN vault_entries ve ON ves.entry_id = ve.id WHERE ves.to_user_id = ? ORDER BY ves.created_at DESC"),
  getSharesByEntry: db.prepare("SELECT ves.*, u.username as to_username FROM vault_entry_shares ves JOIN users u ON ves.to_user_id = u.id WHERE ves.entry_id = ?"),
  getVaultShareById: db.prepare("SELECT * FROM vault_entry_shares WHERE id = ?"),
  getShareById: db.prepare("SELECT * FROM vault_entry_shares WHERE id = ?"),
  deleteShareById: db.prepare("DELETE FROM vault_entry_shares WHERE id = ?"),
  deleteSharesByEntry: db.prepare("DELETE FROM vault_entry_shares WHERE entry_id = ?"),
  deleteExpiredVaultShares: db.prepare("DELETE FROM vault_entry_shares WHERE expires_at < unixepoch()"),
  deleteSharesByUser: db.prepare("DELETE FROM vault_entry_shares WHERE to_user_id = ?"),

  // --- Vault: Audit log ---
  createVaultAudit: db.prepare(`
    INSERT INTO vault_audit_log (id, vault_id, entry_id, user_id, action)
    VALUES (@id, @vaultId, @entryId, @userId, @action)
  `),
  getVaultAuditLog: db.prepare("SELECT val.*, u.username FROM vault_audit_log val JOIN users u ON val.user_id = u.id WHERE val.vault_id = ? ORDER BY val.created_at DESC LIMIT ? OFFSET ?"),
  deleteAuditByVault: db.prepare("DELETE FROM vault_audit_log WHERE vault_id = ?"),

  // --- Vault: Admin ---
  countAllVaults: db.prepare("SELECT COUNT(*) as total FROM vaults"),
  countAllVaultEntries: db.prepare("SELECT COUNT(*) as total FROM vault_entries"),
  countAllVaultShares: db.prepare("SELECT COUNT(*) as total FROM vault_entry_shares"),
  listVaultsAdmin: db.prepare(`
    SELECT v.id, v.type, v.owner_id, v.created_at, v.updated_at, u.username as owner_username,
      (SELECT COUNT(*) FROM vault_members WHERE vault_id = v.id) + 1 as member_count,
      (SELECT COUNT(*) FROM vault_entries WHERE vault_id = v.id) as entry_count
    FROM vaults v LEFT JOIN users u ON v.owner_id = u.id
    ORDER BY v.created_at DESC LIMIT ? OFFSET ?
  `),

  // --- MFA: User TOTP config ---
  getUserMFA: db.prepare("SELECT * FROM user_mfa WHERE user_id = ?"),
  setUserMFA: db.prepare(`
    INSERT INTO user_mfa (user_id, totp_secret_encrypted, recovery_codes)
    VALUES (@userId, @totpSecretEncrypted, @recoveryCodes)
    ON CONFLICT(user_id) DO UPDATE SET totp_secret_encrypted = @totpSecretEncrypted, recovery_codes = @recoveryCodes, updated_at = unixepoch()
  `),
  enableUserMFA: db.prepare("UPDATE user_mfa SET enabled = 1, updated_at = unixepoch() WHERE user_id = ?"),
  disableUserMFA: db.prepare("DELETE FROM user_mfa WHERE user_id = ?"),
  updateRecoveryCodes: db.prepare("UPDATE user_mfa SET recovery_codes = @recoveryCodes, updated_at = unixepoch() WHERE user_id = @userId"),

  // --- MFA: Pending logins ---
  createPendingLogin: db.prepare(`
    INSERT INTO mfa_pending_logins (id, user_id, expires_at, ip_address, user_agent, keep_signed_in, remember_browser)
    VALUES (@id, @userId, @expiresAt, @ipAddress, @userAgent, @keepSignedIn, @rememberBrowser)
  `),
  getPendingLogin: db.prepare("SELECT * FROM mfa_pending_logins WHERE id = ?"),
  deletePendingLogin: db.prepare("DELETE FROM mfa_pending_logins WHERE id = ?"),
  incrementFailedAttempts: db.prepare("UPDATE mfa_pending_logins SET failed_attempts = failed_attempts + 1 WHERE id = ?"),
  deleteExpiredPendingLogins: db.prepare("DELETE FROM mfa_pending_logins WHERE expires_at < unixepoch()"),

  // --- MFA: Trusted devices ---
  createTrustedDevice: db.prepare(`
    INSERT INTO mfa_trusted_devices (id, user_id, token_hash, device_name, expires_at)
    VALUES (@id, @userId, @tokenHash, @deviceName, @expiresAt)
  `),
  getTrustedDevicesByUser: db.prepare("SELECT * FROM mfa_trusted_devices WHERE user_id = ?"),
  getTrustedDeviceByTokenHash: db.prepare("SELECT * FROM mfa_trusted_devices WHERE token_hash = ?"),
  deleteTrustedDevice: db.prepare("DELETE FROM mfa_trusted_devices WHERE id = ?"),
  deleteTrustedDevicesByUser: db.prepare("DELETE FROM mfa_trusted_devices WHERE user_id = ?"),
  deleteExpiredTrustedDevices: db.prepare("DELETE FROM mfa_trusted_devices WHERE expires_at < unixepoch()"),
  countTrustedDevicesByUser: db.prepare("SELECT COUNT(*) as total FROM mfa_trusted_devices WHERE user_id = ?"),

  // --- Vault: Re-key support ---
  updateVaultMemberKey: db.prepare("UPDATE vault_members SET encrypted_master_key = @encryptedMasterKey, needs_rekey = 0 WHERE vault_id = @vaultId AND user_id = @userId"),
  flagVaultMembersForRekey: db.prepare("UPDATE vault_members SET needs_rekey = 1 WHERE user_id = ? AND vault_id IN (SELECT id FROM vaults WHERE type = 'team')"),
  deleteUserKeyBackup: db.prepare("DELETE FROM user_keys WHERE user_id = ?"),

  // --- Homepage: Shortcuts ---
  getShortcutsByUser: db.prepare("SELECT * FROM homepage_shortcuts WHERE user_id = ? ORDER BY category, sort_order, created_at"),
  getShortcutsByCategory: db.prepare("SELECT * FROM homepage_shortcuts WHERE category = ? ORDER BY sort_order, created_at"),
  createShortcut: db.prepare(`
    INSERT INTO homepage_shortcuts (id, user_id, category, title, url, icon, icon_url, description, sort_order)
    VALUES (@id, @userId, @category, @title, @url, @icon, @iconUrl, @description, @sortOrder)
  `),
  updateShortcut: db.prepare(`
    UPDATE homepage_shortcuts SET title = @title, url = @url, icon = @icon, icon_url = @iconUrl, description = @description, category = @category, sort_order = @sortOrder
    WHERE id = @id AND user_id = @userId
  `),
  deleteShortcut: db.prepare("DELETE FROM homepage_shortcuts WHERE id = @id AND user_id = @userId"),
  deleteShortcutById: db.prepare("DELETE FROM homepage_shortcuts WHERE id = ?"),
  getShortcutById: db.prepare("SELECT * FROM homepage_shortcuts WHERE id = ? AND user_id = ?"),
  getShortcutByIdAny: db.prepare("SELECT * FROM homepage_shortcuts WHERE id = ?"),

  // Favourite shortcuts (junction table)
  addFavourite: db.prepare("INSERT OR IGNORE INTO user_favourite_shortcuts (user_id, shortcut_id) VALUES (?, ?)"),
  removeFavourite: db.prepare("DELETE FROM user_favourite_shortcuts WHERE user_id = ? AND shortcut_id = ?"),
  getUserFavouriteIds: db.prepare("SELECT shortcut_id FROM user_favourite_shortcuts WHERE user_id = ? ORDER BY added_at"),
  countFavourites: db.prepare("SELECT COUNT(*) as count FROM user_favourite_shortcuts WHERE user_id = ?"),
  isFavourite: db.prepare("SELECT 1 FROM user_favourite_shortcuts WHERE user_id = ? AND shortcut_id = ?"),
  deleteFavouritesByShortcut: db.prepare("DELETE FROM user_favourite_shortcuts WHERE shortcut_id = ?"),

  // --- Homepage: Settings ---
  getHomepageSettings: db.prepare("SELECT * FROM homepage_settings WHERE user_id = ?"),
  setHomepageSettings: db.prepare(`
    INSERT INTO homepage_settings (user_id, layout) VALUES (@userId, @layout)
    ON CONFLICT(user_id) DO UPDATE SET layout = @layout, updated_at = unixepoch()
  `),
};

// Default security settings (must be after stmts initialization)
const DEFAULTS = {
  session_ttl: "43200",
  session_ttl_extended: "604800",
  mfa_remember_days: "30",
  mfa_required: "false",
};
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!getSetting(key)) setSetting(key, value);
}

// ============================================================
// Paste functions
// ============================================================

function createPaste({ id, ciphertext, iv, ivPassword, salt, hasPassword, burnAfterReading, expiresIn, sourceIp, syntax, userId, guestInvitedBy }) {
  if (!VALID_EXPIRY_OPTIONS.includes(expiresIn)) {
    throw new Error("Invalid expiry");
  }
  const safeSyntax = VALID_SYNTAX_OPTIONS.includes(syntax) ? syntax : "plaintext";
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createPaste.run({
    id,
    ciphertext: Buffer.from(ciphertext, "base64"),
    iv: Buffer.from(iv, "base64"),
    ivPassword: ivPassword ? Buffer.from(ivPassword, "base64") : null,
    salt: salt ? Buffer.from(salt, "base64") : null,
    hasPassword: hasPassword ? 1 : 0,
    burnAfterReading: burnAfterReading ? 1 : 0,
    sourceIp: sourceIp || null,
    syntax: safeSyntax,
    expiresAt,
    userId: userId || null,
    guestInvitedBy: guestInvitedBy || null,
  });
  return { id, expiresAt };
}

function getPaste(id) {
  const row = stmts.getPasteById.get(id);
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    stmts.deletePasteById.run(id);
    return { expired: true };
  }
  if (row.burn_after_reading) {
    const consumed = stmts.consumePaste(id);
    if (!consumed) return null;
    return { ...consumed, burned: true };
  }
  return row;
}

function deleteExpired() {
  const result = stmts.deleteExpiredPastes.run();
  return result.changes;
}

function getPasteStats() {
  return {
    total: stmts.countAllPastes.get().total,
    active: stmts.countActivePastes.get().total,
    expired: stmts.countExpiredPastes.get().total,
  };
}

function listPastes(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listPastes.all(limit, offset);
  const total = stmts.countAllPastes.get().total;
  return {
    pastes: rows.map((r) => ({
      id: r.id,
      hasPassword: !!r.has_password,
      burnAfterReading: !!r.burn_after_reading,
      sourceIp: r.source_ip || "unknown",
      syntax: r.syntax || "plaintext",
      size: r.size,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      userId: r.user_id || null,
      username: r.username || null,
      guestInvitedBy: r.guest_invited_by || null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

function deletePaste(id) {
  const result = stmts.deletePasteById.run(id);
  return result.changes > 0;
}

function bulkDeletePastes(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return 0;
  const stmt = db.prepare(`DELETE FROM pastes WHERE id IN (${ids.map(() => "?").join(",")})`);
  const result = stmt.run(...ids);
  return result.changes;
}

// ============================================================
// Share functions
// ============================================================

function createShare({ id, salt, hasPassword, burnAfterReading, expiresIn, sourceIp, files, userId, guestInvitedBy }) {
  if (!VALID_EXPIRY_OPTIONS.includes(expiresIn)) {
    throw new Error("Invalid expiry");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  // Transaction: create share + all file rows
  const insertAll = db.transaction(() => {
    stmts.createShare.run({
      id,
      salt: salt ? Buffer.from(salt, "base64") : null,
      hasPassword: hasPassword ? 1 : 0,
      burnAfterReading: burnAfterReading ? 1 : 0,
      sourceIp: sourceIp || null,
      fileCount: files.length,
      totalSize,
      expiresAt,
      userId: userId || null,
      guestInvitedBy: guestInvitedBy || null,
    });

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      stmts.createShareFile.run({
        id: f.id,
        shareId: id,
        encryptedFilename: f.encryptedFilename,
        filenameIv: Buffer.from(f.filenameIv, "base64"),
        fileSize: f.fileSize,
        encryptedSize: f.encryptedSize,
        iv: Buffer.from(f.iv, "base64"),
        ivPassword: f.ivPassword ? Buffer.from(f.ivPassword, "base64") : null,
        mimeType: f.mimeType || "application/octet-stream",
        fileIndex: i,
      });
    }
  });

  insertAll();
  return { id, expiresAt, fileCount: files.length };
}

function getShare(id) {
  const share = stmts.getShareById.get(id);
  if (!share) return null;

  if (share.expires_at < Math.floor(Date.now() / 1000)) {
    cleanupShare(id);
    return { expired: true };
  }

  const files = stmts.getFilesByShareId.all(id);

  if (share.burn_after_reading) {
    if (!share.burned) {
      // Atomic consume: only first request wins
      const info = stmts.markShareBurned.run(id);
      if (info.changes > 0) {
        // We won the race — return full decryption data
        return {
          id: share.id,
          salt: share.salt,
          hasPassword: !!share.has_password,
          burnAfterReading: true,
          burned: true,
          fileCount: share.file_count,
          totalSize: share.total_size,
          files: files.map((f) => ({
            id: f.id,
            encryptedFilename: f.encrypted_filename,
            filenameIv: f.filename_iv.toString("base64"),
            iv: f.iv.toString("base64"),
            ivPassword: f.iv_password ? f.iv_password.toString("base64") : null,
            fileSize: f.file_size,
            mimeType: f.mime_type,
          })),
        };
      }
      // Lost the race — another request already burned it
    }
    // Already burned (or lost race) — return minimal info, no decryption data
    return {
      id: share.id,
      hasPassword: !!share.has_password,
      burnAfterReading: true,
      burned: true,
      fileCount: share.file_count,
      totalSize: share.total_size,
      files: files.map((f) => ({ id: f.id, fileSize: f.file_size })),
    };
  }

  return {
    id: share.id,
    salt: share.salt,
    hasPassword: !!share.has_password,
    burnAfterReading: false,
    burned: false,
    fileCount: share.file_count,
    totalSize: share.total_size,
    files: files.map((f) => ({
      id: f.id,
      encryptedFilename: f.encrypted_filename,
      filenameIv: f.filename_iv.toString("base64"),
      iv: f.iv.toString("base64"),
      ivPassword: f.iv_password ? f.iv_password.toString("base64") : null,
      fileSize: f.file_size,
      mimeType: f.mime_type,
    })),
  };
}

function getShareFile(fileId) {
  const peekRow = stmts.getShareFileById.get(fileId);
  if (!peekRow) return null;

  if (peekRow.expires_at < Math.floor(Date.now() / 1000)) {
    cleanupShare(peekRow.share_id);
    return { expired: true };
  }

  if (peekRow.burn_after_reading) {
    const row = stmts.consumeShareFile(fileId);
    if (!row) return null;

    const filePath = path.join(FILES_DIR, `${row.id}.enc`);
    return {
      ...row,
      filePath,
      burned: true,
      burnAfterReading: true,
    };
  }

  const filePath = path.join(FILES_DIR, `${peekRow.id}.enc`);
  return {
    ...peekRow,
    filePath,
    burned: !!peekRow.burned,
    burnAfterReading: false,
  };
}

function deleteShareFile(fileId) {
  const row = stmts.getShareFileById.get(fileId);
  stmts.deleteShareFileById.run(fileId);
  if (row) {
    try { fs.unlinkSync(path.join(FILES_DIR, `${fileId}.enc`)); } catch {}
  }
  return true;
}

function deleteShare(id) {
  const files = stmts.getFilesByShareId.all(id);
  for (const f of files) {
    try { fs.unlinkSync(path.join(FILES_DIR, `${f.id}.enc`)); } catch {}
  }
  stmts.deleteFilesByShareId.run(id);
  stmts.deleteShareById.run(id);
  return true;
}

function cleanupShare(id) {
  const files = stmts.getFilesByShareId.all(id);
  for (const f of files) {
    try { fs.unlinkSync(path.join(FILES_DIR, `${f.id}.enc`)); } catch {}
  }
  stmts.deleteFilesByShareId.run(id);
  stmts.deleteShareById.run(id);
}

function deleteExpiredFiles() {
  const deleted = stmts.deleteExpiredShares.all();
  for (const row of deleted) {
    cleanupShare(row.id);
  }
  return deleted.length;
}

function getFileStats() {
  return {
    total: stmts.countAllShares.get().total,
    active: stmts.countActiveShares.get().total,
    expired: stmts.countExpiredShares.get().total,
    diskUsage: stmts.shareDiskUsage.get().total,
  };
}

function listFiles(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listShares.all(limit, offset);
  const total = stmts.countAllShares.get().total;
  return {
    files: rows.map((r) => ({
      id: r.id,
      fileSize: r.total_size,
      fileCount: r.file_count,
      hasPassword: !!r.has_password,
      burnAfterReading: !!r.burn_after_reading,
      sourceIp: r.source_ip || "unknown",
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      userId: r.user_id || null,
      username: r.username || null,
      guestInvitedBy: r.guest_invited_by || null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

function bulkDeleteFiles(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return 0;
  for (const id of ids) {
    cleanupShare(id);
  }
  return ids.length;
}

// ============================================================
// User functions
// ============================================================

function createUser({ id, email, username, passwordHash }) {
  stmts.createUser.run({ id, email, username, passwordHash });
  return { id };
}

function getUserById(id) {
  return stmts.getUserById.get(id) || null;
}

function getUserByEmail(email) {
  return stmts.getUserByEmail.get(email) || null;
}

function getUserByUsername(username) {
  return stmts.getUserByUsername.get(username) || null;
}

function updateUserPassword(id, passwordHash) {
  stmts.updateUserPassword.run(passwordHash, id);
}

function updateUsername(id, username) {
  stmts.updateUsername.run(username, id);
}

function updateUserDetails({ id, email, username }) {
  stmts.updateUser.run({ id, email, username });
}

function suspendUserById(id) {
  stmts.suspendUser.run(id);
  stmts.deleteUserSessions.run(id);
}

function unsuspendUserById(id) {
  stmts.unsuspendUser.run(id);
}

function deleteUserById(id) {
  stmts.deleteUserSessions.run(id);
  stmts.deleteUser.run(id);
}

function listUsers(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listUsers.all(limit, offset);
  const total = stmts.countUsers.get().total;
  return {
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username,
      suspended: !!r.suspended,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

function countAllUsers() {
  return stmts.countUsers.get().total;
}

function getUsernamesMap(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return new Map();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...userIds);
  return new Map(rows.map((r) => [r.id, r.username]));
}

// ============================================================
// Session functions
// ============================================================

function createSession({ id, userId, expiresIn, ipAddress, userAgent }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createSession.run({ id, userId, expiresAt, ipAddress, userAgent });
  return { id, expiresAt };
}

function getSession(id) {
  return stmts.getSessionById.get(id) || null;
}

function deleteSessionById(id) {
  stmts.deleteSession.run(id);
}

function deleteExpiredSessions() {
  const result = stmts.deleteExpiredSessions.run();
  return result.changes;
}

function deleteSessionsByUserId(userId) {
  stmts.deleteSessionsByUserId.run(userId);
}

function deleteOtherSessions(userId, currentSessionId) {
  stmts.deleteOtherSessions.run(userId, currentSessionId);
}

// ============================================================
// Invite functions
// ============================================================

function createInvite({ id, email, token, createdBy, expiresAt }) {
  stmts.createInvite.run({ id, email, token, createdBy, expiresAt });
  return { id };
}

function getInviteByToken(token) {
  return stmts.getInviteByToken.get(token) || null;
}

function markInviteUsed(id) {
  stmts.markInviteUsed.run(id);
}

function deleteExpiredInvites() {
  const result = stmts.deleteExpiredInvites.run();
  return result.changes;
}

function revokeInvite(id) {
  const result = stmts.revokeInvite.run(id);
  return result.changes > 0;
}

function listInvites(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listInvites.all(limit, offset);
  const total = stmts.countInvites.get().total;
  return {
    invites: rows.map((r) => ({
      id: r.id,
      email: r.email,
      token: r.token,
      createdBy: r.created_by,
      used: !!r.used,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

// ============================================================
// Guest link functions
// ============================================================

function createGuestLink({ id, token, createdBy, tool, maxUses, expiresAt }) {
  stmts.createGuestLink.run({ id, token, createdBy, tool, maxUses, expiresAt });
  return { id };
}

function validateGuestLink(token) {
  const link = stmts.getGuestLinkByToken.get(token);
  if (!link) return null;
  if (link.expires_at < Math.floor(Date.now() / 1000)) return null;
  if (link.use_count >= link.max_uses) return null;
  return link;
}

function redeemGuestLink(token) {
  return stmts.redeemGuestLink(token);
}

function deleteExpiredGuestLinks() {
  const result = stmts.deleteExpiredGuestLinks.run();
  return result.changes;
}

// ============================================================
// Password reset functions
// ============================================================

function createPasswordReset({ id, userId, token, expiresAt }) {
  stmts.createPasswordReset.run({ id, userId, token, expiresAt });
  return { id };
}

function getPasswordResetByToken(token) {
  return stmts.getPasswordResetByToken.get(token) || null;
}

function markPasswordResetUsed(id) {
  stmts.markPasswordResetUsed.run(id);
}

function deleteExpiredPasswordResets() {
  const result = stmts.deleteExpiredPasswordResets.run();
  return result.changes;
}

// ============================================================
// Settings functions
// ============================================================

function encryptValue(plaintext) {
  const key = crypto.createHash("sha256").update(process.env.COOKIE_SECRET).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptValue(stored) {
  if (!stored || !stored.includes(":")) return stored; // plaintext fallback for migration
  try {
    const key = crypto.createHash("sha256").update(process.env.COOKIE_SECRET).digest();
    const [ivHex, encrypted] = stored.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return stored; // If decryption fails, return as-is
  }
}

function getSetting(key) {
  const row = stmts.getSetting.get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  stmts.setSetting.run(key, value);
}

function getSmtpConfig() {
  return {
    smtpHost: getSetting("smtp_host"),
    smtpPort: getSetting("smtp_port"),
    smtpUser: getSetting("smtp_user"),
    smtpPass: decryptValue(getSetting("smtp_pass")),
    smtpFrom: getSetting("smtp_from"),
    smtpSecure: getSetting("smtp_secure"),
  };
}

function setSmtpConfig({ host, port, user, pass, from, secure }) {
  setSetting("smtp_host", host || "");
  setSetting("smtp_port", port || "587");
  setSetting("smtp_user", user || "");
  setSetting("smtp_pass", pass ? encryptValue(pass) : "");
  setSetting("smtp_from", from || "");
  setSetting("smtp_secure", secure ? "true" : "false");
}

// ============================================================
// Chat: User key functions
// ============================================================

function createUserKey({ userId, publicKey, encryptedPrivateKey, privateKeyIv, privateKeySalt }) {
  stmts.createUserKey.run({ userId, publicKey, encryptedPrivateKey: encryptedPrivateKey || null, privateKeyIv: privateKeyIv || null, privateKeySalt: privateKeySalt || null });
}

function getUserKey(userId) {
  return stmts.getUserKey.get(userId) || null;
}

function replaceUserKey({ userId, publicKey, encryptedPrivateKey, privateKeyIv, privateKeySalt }) {
  stmts.replaceUserKey.run({ userId, publicKey, encryptedPrivateKey: encryptedPrivateKey || null, privateKeyIv: privateKeyIv || null, privateKeySalt: privateKeySalt || null });
}

function updateKeyBackup({ userId, encryptedPrivateKey, privateKeyIv, privateKeySalt }) {
  stmts.updateKeyBackup.run({ userId, encryptedPrivateKey, privateKeyIv, privateKeySalt });
}

function searchUsersWithKeys(query, excludeUserId) {
  return stmts.searchUsersWithKeys.all(query, excludeUserId);
}

// ============================================================
// Chat: Conversation functions
// ============================================================

const MESSAGE_TTL = 7 * 24 * 60 * 60; // 7 days

function createConversation({ id, name, type, createdBy, members, keyEpochs }) {
  const insertAll = db.transaction(() => {
    stmts.createConversation.run({ id, name, type, createdBy });
    for (const m of members) {
      stmts.addConversationMember.run({ id: m.id, conversationId: id, userId: m.userId, role: m.role });
    }
    for (const ke of keyEpochs) {
      stmts.createKeyEpoch.run({ id: ke.id, conversationId: id, userId: ke.userId, keyVersion: ke.keyVersion, encryptedKey: ke.encryptedKey });
    }
  });
  insertAll();
  return { id };
}

function getConversationById(id) {
  return stmts.getConversationById.get(id) || null;
}

function findDirectConversation(userId1, userId2) {
  return stmts.findDirectConversation.get(userId1, userId2) || null;
}

function getUserConversations(userId) {
  const rows = stmts.getUserConversations.all(userId);
  return rows;
}

function getConversationMembers(conversationId) {
  return stmts.getConversationMembers.all(conversationId);
}

function getConversationMember(conversationId, userId) {
  return stmts.getConversationMember.get(conversationId, userId) || null;
}

function addConversationMember({ id, conversationId, userId, role }) {
  stmts.addConversationMember.run({ id, conversationId, userId, role: role || "member" });
}

function removeConversationMember(conversationId, userId) {
  stmts.removeConversationMember.run(conversationId, userId);
  stmts.deleteKeyEpochsForUser.run(conversationId, userId);
}

function updateLastReadAt(conversationId, userId, timestamp) {
  stmts.updateLastReadAt.run(timestamp, conversationId, userId);
}

function deleteConversation(id) {
  const del = db.transaction(() => {
    stmts.deleteMessagesByConversation.run(id);
    stmts.deleteKeyEpochsByConversation.run(id);
    stmts.deleteMembersByConversation.run(id);
    stmts.deleteConversationById.run(id);
  });
  del();
}

function leaveConversation(conversationId, userId) {
  stmts.removeConversationMember.run(conversationId, userId);
  stmts.deleteKeyEpochsForUser.run(conversationId, userId);
  // If no members left, delete the conversation
  const remaining = stmts.getConversationMembers.all(conversationId);
  if (remaining.length === 0) {
    deleteConversation(conversationId);
  }
}

// ============================================================
// Chat: Key epoch functions
// ============================================================

function createKeyEpoch({ id, conversationId, userId, keyVersion, encryptedKey }) {
  stmts.createKeyEpoch.run({ id, conversationId, userId, keyVersion, encryptedKey });
}

function getKeyEpochsForUser(conversationId, userId) {
  return stmts.getKeyEpochsForUser.all(conversationId, userId);
}

function rekeyConversation(conversationId, newKeyVersion, encryptedKeys) {
  const doRekey = db.transaction(() => {
    stmts.incrementKeyVersion.run(conversationId);
    for (const ek of encryptedKeys) {
      const id = crypto.randomBytes(16).toString("base64url");
      stmts.createKeyEpoch.run({ id, conversationId, userId: ek.userId, keyVersion: newKeyVersion, encryptedKey: ek.encryptedKey });
    }
  });
  doRekey();
}

// ============================================================
// Chat: Message functions
// ============================================================

function createMessage({ id, conversationId, senderId, ciphertext, iv, keyVersion }) {
  const expiresAt = Math.floor(Date.now() / 1000) + MESSAGE_TTL;
  stmts.createMessage.run({ id, conversationId, senderId, ciphertext, iv, keyVersion, expiresAt });
  stmts.updateConversationTimestamp.run(conversationId);
  return { id, expiresAt };
}

function getMessages(conversationId, limit = 50, offset = 0) {
  return stmts.getMessagesByConversation.all(conversationId, limit, offset);
}

function getMessagesBefore(conversationId, before, limit = 50) {
  return stmts.getMessagesBefore.all(conversationId, before, limit);
}

function countUnreadMessages(conversationId, lastReadAt) {
  return stmts.countUnreadMessages.get(conversationId, lastReadAt).total;
}

function deleteExpiredMessages() {
  const result = stmts.deleteExpiredMessages.run();
  return result.changes;
}

// ============================================================
// Chat: Avatar functions
// ============================================================

function updateAvatarTimestamp(userId) {
  stmts.updateAvatarTimestamp.run(userId);
}

function clearAvatarTimestamp(userId) {
  stmts.clearAvatarTimestamp.run(userId);
}

// ============================================================
// Chat: Admin functions
// ============================================================

function getChatStats() {
  return {
    totalConversations: stmts.countConversations.get().total,
    activeConversations: stmts.countActiveConversations.get().total,
    totalMessages: stmts.countAllMessages.get().total,
  };
}

function listConversationsAdmin(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listConversationsAdmin.all(limit, offset);
  const total = stmts.countConversations.get().total;
  return {
    conversations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      createdBy: r.created_by,
      createdByUsername: r.created_by_username,
      memberCount: r.member_count,
      messageCount: r.message_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

// ============================================================
// Vault functions
// ============================================================

function createVault({ id, nameEncrypted, nameIv, type, ownerId, encryptedMasterKey, masterKeyIv, masterKeySalt }) {
  stmts.createVault.run({
    id, nameEncrypted: Buffer.from(nameEncrypted, "base64"), nameIv: Buffer.from(nameIv, "base64"),
    type, ownerId,
    encryptedMasterKey: encryptedMasterKey ? Buffer.from(encryptedMasterKey, "base64") : null,
    masterKeyIv: masterKeyIv ? Buffer.from(masterKeyIv, "base64") : null,
    masterKeySalt: masterKeySalt ? Buffer.from(masterKeySalt, "base64") : null,
  });
  return { id };
}

function getVault(id) {
  return stmts.getVaultById.get(id) || null;
}

function getUserVaults(userId) {
  const owned = stmts.getVaultsByOwner.all(userId);
  const memberOf = stmts.getVaultsByMembership.all(userId);
  // Deduplicate: user may own a team vault they're also a member of
  const seen = new Set(owned.map((v) => v.id));
  const all = [...owned];
  for (const v of memberOf) {
    if (!seen.has(v.id)) { all.push(v); seen.add(v.id); }
  }
  return all.sort((a, b) => b.created_at - a.created_at);
}

function updateVault({ id, nameEncrypted, nameIv }) {
  stmts.updateVaultName.run({ id, nameEncrypted: Buffer.from(nameEncrypted, "base64"), nameIv: Buffer.from(nameIv, "base64") });
}

function deleteVault(id) {
  const del = db.transaction(() => {
    const entries = stmts.getVaultEntries.all(id);
    for (const e of entries) {
      stmts.deleteHistoryByEntry.run(e.id);
      stmts.deleteSharesByEntry.run(e.id);
    }
    stmts.deleteEntriesByVault.run(id);
    stmts.deleteMembersByVault.run(id);
    stmts.deleteAuditByVault.run(id);
    stmts.deleteVaultById.run(id);
  });
  del();
}

function addVaultMember({ id, vaultId, userId, role, encryptedMasterKey }) {
  stmts.addVaultMember.run({ id, vaultId, userId, role, encryptedMasterKey });
}

function getVaultMembersList(vaultId) {
  return stmts.getVaultMembers.all(vaultId);
}

function getVaultMemberShip(vaultId, userId) {
  return stmts.getVaultMember.get(vaultId, userId) || null;
}

function removeVaultMember(vaultId, userId) {
  stmts.removeVaultMember.run(vaultId, userId);
}

function createVaultEntry({ id, vaultId, type, titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite }) {
  stmts.createVaultEntry.run({
    id, vaultId, type,
    titleEncrypted: Buffer.from(titleEncrypted, "base64"), titleIv: Buffer.from(titleIv, "base64"),
    dataEncrypted: Buffer.from(dataEncrypted, "base64"), dataIv: Buffer.from(dataIv, "base64"),
    folderEncrypted: folderEncrypted ? Buffer.from(folderEncrypted, "base64") : null,
    folderIv: folderIv ? Buffer.from(folderIv, "base64") : null,
    favorite: favorite ? 1 : 0,
  });
  return { id };
}

function getVaultEntriesList(vaultId) {
  return stmts.getVaultEntries.all(vaultId);
}

function getVaultEntry(id) {
  return stmts.getVaultEntryById.get(id) || null;
}

function updateVaultEntry({ id, titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite }) {
  const existing = stmts.getVaultEntryById.get(id);
  if (!existing) return null;
  // Save current version to history
  const histId = crypto.randomBytes(16).toString("base64url");
  stmts.createVaultEntryHistory.run({
    id: histId, entryId: id,
    dataEncrypted: existing.data_encrypted, dataIv: existing.data_iv,
    version: existing.version,
  });
  stmts.updateVaultEntry.run({
    id,
    titleEncrypted: Buffer.from(titleEncrypted, "base64"), titleIv: Buffer.from(titleIv, "base64"),
    dataEncrypted: Buffer.from(dataEncrypted, "base64"), dataIv: Buffer.from(dataIv, "base64"),
    folderEncrypted: folderEncrypted ? Buffer.from(folderEncrypted, "base64") : null,
    folderIv: folderIv ? Buffer.from(folderIv, "base64") : null,
    favorite: favorite ? 1 : 0,
  });
  return { id };
}

function deleteVaultEntry(id) {
  const del = db.transaction(() => {
    stmts.deleteHistoryByEntry.run(id);
    stmts.deleteSharesByEntry.run(id);
    stmts.deleteVaultEntryById.run(id);
  });
  del();
}

function getVaultEntryHistoryList(entryId, limit = 10) {
  return stmts.getVaultEntryHistory.all(entryId, limit);
}

function createVaultEntryShare({ id, entryId, fromUserId, toUserId, encryptedEntryKey, titleEncrypted, titleIv, dataEncrypted, dataIv, expiresAt }) {
  stmts.createVaultEntryShare.run({
    id, entryId, fromUserId, toUserId, encryptedEntryKey,
    titleEncrypted: Buffer.from(titleEncrypted, "base64"), titleIv: Buffer.from(titleIv, "base64"),
    dataEncrypted: Buffer.from(dataEncrypted, "base64"), dataIv: Buffer.from(dataIv, "base64"),
    expiresAt: expiresAt || null,
  });
  return { id };
}

function getSharesForUser(userId) {
  return stmts.getSharesForUser.all(userId);
}

function getSharesByEntryId(entryId) {
  return stmts.getSharesByEntry.all(entryId);
}

function getVaultShare(id) {
  return stmts.getVaultShareById.get(id);
}

function deleteVaultShare(id) {
  return stmts.deleteShareById.run(id).changes > 0;
}

function deleteExpiredVaultShares() {
  return stmts.deleteExpiredVaultShares.run().changes;
}

function createVaultAudit({ id, vaultId, entryId, userId, action }) {
  stmts.createVaultAudit.run({ id, vaultId, entryId: entryId || null, userId, action });
}

function getVaultAuditLog(vaultId, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.getVaultAuditLog.all(vaultId, limit, offset);
  return rows.map((r) => ({
    id: r.id, entryId: r.entry_id, userId: r.user_id,
    username: r.username, action: r.action, createdAt: r.created_at,
  }));
}

function getVaultStats() {
  return {
    totalVaults: stmts.countAllVaults.get().total,
    totalEntries: stmts.countAllVaultEntries.get().total,
    totalShares: stmts.countAllVaultShares.get().total,
  };
}

function listVaultsAdmin(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const rows = stmts.listVaultsAdmin.all(limit, offset);
  const total = stmts.countAllVaults.get().total;
  return {
    vaults: rows.map((r) => ({
      id: r.id, type: r.type, ownerId: r.owner_id, ownerUsername: r.owner_username,
      memberCount: r.member_count, entryCount: r.entry_count,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
    total, page, totalPages: Math.ceil(total / limit),
  };
}

// ============================================================
// MFA functions
// ============================================================

function getUserMFA(userId) {
  return stmts.getUserMFA.get(userId) || null;
}

function setUserMFA(userId, { totpSecretEncrypted, recoveryCodes }) {
  stmts.setUserMFA.run({ userId, totpSecretEncrypted, recoveryCodes });
}

function enableUserMFA(userId) {
  stmts.enableUserMFA.run(userId);
}

function disableUserMFA(userId) {
  stmts.disableUserMFA.run(userId);
}

function updateRecoveryCodes(userId, codes) {
  stmts.updateRecoveryCodes.run({ userId, recoveryCodes: JSON.stringify(codes) });
}

// ============================================================
// MFA: Pending login functions
// ============================================================

function createPendingLogin({ id, userId, expiresIn, ipAddress, userAgent, keepSignedIn, rememberBrowser }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createPendingLogin.run({ id, userId, expiresAt, ipAddress, userAgent, keepSignedIn: keepSignedIn ? 1 : 0, rememberBrowser: rememberBrowser ? 1 : 0 });
  return { id, expiresAt };
}

function getPendingLogin(id) {
  return stmts.getPendingLogin.get(id) || null;
}

function deletePendingLogin(id) {
  stmts.deletePendingLogin.run(id);
}

function incrementPendingLoginAttempts(id) {
  stmts.incrementFailedAttempts.run(id);
  const pending = stmts.getPendingLogin.get(id);
  return pending ? pending.failed_attempts : -1;
}

function deleteExpiredPendingLogins() {
  return stmts.deleteExpiredPendingLogins.run().changes;
}

// ============================================================
// MFA: Trusted device functions
// ============================================================

function createTrustedDevice({ id, userId, tokenHash, deviceName, expiresIn }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createTrustedDevice.run({ id, userId, tokenHash, deviceName, expiresAt });
  return { id, expiresAt };
}

function getTrustedDevicesByUser(userId) {
  return stmts.getTrustedDevicesByUser.all(userId);
}

function getTrustedDeviceByTokenHash(tokenHash) {
  return stmts.getTrustedDeviceByTokenHash.get(tokenHash) || null;
}

function deleteTrustedDevice(id) {
  stmts.deleteTrustedDevice.run(id);
}

function deleteTrustedDevicesByUser(userId) {
  stmts.deleteTrustedDevicesByUser.run(userId);
}

function deleteExpiredTrustedDevices() {
  return stmts.deleteExpiredTrustedDevices.run().changes;
}

function countTrustedDevicesByUser(userId) {
  return stmts.countTrustedDevicesByUser.get(userId).total;
}

// ============================================================
// Vault: Re-key functions
// ============================================================

function deletePersonalVaultsByUser(userId) {
  const vaults = stmts.getVaultsByOwner.all(userId);
  for (const v of vaults) {
    if (v.type === "personal") {
      deleteVault(v.id);
    }
  }
}

function deleteUserKeyBackup(userId) {
  stmts.deleteUserKeyBackup.run(userId);
}

function flagVaultMembersForRekey(userId) {
  stmts.flagVaultMembersForRekey.run(userId);
}

function updateVaultMemberKey(vaultId, userId, encryptedMasterKey) {
  stmts.updateVaultMemberKey.run({ vaultId, userId, encryptedMasterKey });
}

// ============================================================
// Homepage functions
// ============================================================

function getShortcutsByUser(userId) {
  return stmts.getShortcutsByUser.all(userId).map((r) => ({
    id: r.id, category: r.category, title: r.title, url: r.url, icon: r.icon, iconUrl: r.icon_url, description: r.description, sortOrder: r.sort_order, createdAt: r.created_at,
  }));
}

function getShortcutsByCategory(category) {
  return stmts.getShortcutsByCategory.all(category).map((r) => ({
    id: r.id, category: r.category, title: r.title, url: r.url, icon: r.icon, iconUrl: r.icon_url, description: r.description, sortOrder: r.sort_order, createdAt: r.created_at,
  }));
}

function createShortcut({ id, userId, category, title, url, icon, iconUrl, description, sortOrder }) {
  stmts.createShortcut.run({ id, userId, category: category || "personal", title, url, icon: icon || null, iconUrl: iconUrl || null, description: description || null, sortOrder: sortOrder || 0 });
  return { id };
}

function updateShortcutById({ id, userId, category, title, url, icon, iconUrl, description, sortOrder }) {
  const result = stmts.updateShortcut.run({ id, userId, category: category || "personal", title, url, icon: icon || null, iconUrl: iconUrl || null, description: description || null, sortOrder: sortOrder || 0 });
  return result.changes > 0;
}

function deleteShortcutById(id, userId) {
  const result = stmts.deleteShortcut.run({ id, userId });
  return result.changes > 0;
}

function addUserFavourite(userId, shortcutId) {
  stmts.addFavourite.run(userId, shortcutId);
}

function removeUserFavourite(userId, shortcutId) {
  stmts.removeFavourite.run(userId, shortcutId);
}

function isUserFavourite(userId, shortcutId) {
  return !!stmts.isFavourite.get(userId, shortcutId);
}

function getUserFavouriteIds(userId) {
  return stmts.getUserFavouriteIds.all(userId).map((r) => r.shortcut_id);
}

function countUserFavourites(userId) {
  const row = stmts.countFavourites.get(userId);
  return row ? row.count : 0;
}

function deleteFavouritesByShortcut(shortcutId) {
  stmts.deleteFavouritesByShortcut.run(shortcutId);
}

function deleteShortcutByIdAdmin(id) {
  const result = stmts.deleteShortcutById.run(id);
  return result.changes > 0;
}

function getShortcutById(id, userId) {
  return stmts.getShortcutById.get(id, userId) || null;
}

function getShortcutByIdAny(id) {
  return stmts.getShortcutByIdAny.get(id) || null;
}

function getHomepageSettings(userId) {
  const row = stmts.getHomepageSettings.get(userId);
  return row ? JSON.parse(row.layout) : { showWeather: true, showSearch: true, showShortcuts: true };
}

function setHomepageSettings(userId, layout) {
  stmts.setHomepageSettings.run({ userId, layout: JSON.stringify(layout) });
}

module.exports = {
  // Paste
  createPaste,
  getPaste,
  deleteExpired,
  getPasteStats,
  listPastes,
  deletePaste,
  bulkDeletePastes,
  // Share
  createShare,
  getShare,
  getShareFile,
  deleteShareFile,
  deleteShare,
  deleteExpiredFiles,
  getFileStats,
  listFiles,
  bulkDeleteFiles,
  // User
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  updateUserPassword,
  updateUsername,
  updateUserDetails,
  suspendUserById,
  unsuspendUserById,
  deleteUserById,
  listUsers,
  countAllUsers,
  getUsernamesMap,
  // Session
  createSession,
  getSession,
  deleteSessionById,
  deleteExpiredSessions,
  deleteSessionsByUserId,
  deleteOtherSessions,
  // Invite
  createInvite,
  getInviteByToken,
  markInviteUsed,
  deleteExpiredInvites,
  revokeInvite,
  listInvites,
  // Guest link
  createGuestLink,
  validateGuestLink,
  redeemGuestLink,
  deleteExpiredGuestLinks,
  // Password reset
  createPasswordReset,
  getPasswordResetByToken,
  markPasswordResetUsed,
  deleteExpiredPasswordResets,
  // Settings
  getSetting,
  setSetting,
  getSmtpConfig,
  setSmtpConfig,
  encryptValue,
  decryptValue,
  // Chat: User keys
  createUserKey,
  getUserKey,
  replaceUserKey,
  updateKeyBackup,
  searchUsersWithKeys,
  // Chat: Conversations
  createConversation,
  getConversationById,
  findDirectConversation,
  getUserConversations,
  getConversationMembers,
  getConversationMember,
  addConversationMember,
  removeConversationMember,
  updateLastReadAt,
  deleteConversation,
  leaveConversation,
  // Chat: Key epochs
  createKeyEpoch,
  getKeyEpochsForUser,
  rekeyConversation,
  // Chat: Messages
  createMessage,
  getMessages,
  getMessagesBefore,
  countUnreadMessages,
  deleteExpiredMessages,
  // Chat: Avatar
  updateAvatarTimestamp,
  clearAvatarTimestamp,
  AVATARS_DIR,
  // Chat: Admin
  getChatStats,
  listConversationsAdmin,
  // Vault
  createVault,
  getVault,
  getUserVaults,
  updateVault,
  deleteVault,
  addVaultMember,
  getVaultMembersList,
  getVaultMemberShip,
  removeVaultMember,
  createVaultEntry,
  getVaultEntriesList,
  getVaultEntry,
  updateVaultEntry,
  deleteVaultEntry,
  getVaultEntryHistoryList,
  createVaultEntryShare,
  getSharesForUser,
  getSharesByEntryId,
  getVaultShare,
  deleteVaultShare,
  deleteExpiredVaultShares,
  createVaultAudit,
  getVaultAuditLog,
  getVaultStats,
  listVaultsAdmin,
  // MFA
  getUserMFA,
  setUserMFA,
  enableUserMFA,
  disableUserMFA,
  updateRecoveryCodes,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
  incrementPendingLoginAttempts,
  deleteExpiredPendingLogins,
  createTrustedDevice,
  getTrustedDevicesByUser,
  getTrustedDeviceByTokenHash,
  deleteTrustedDevice,
  deleteTrustedDevicesByUser,
  deleteExpiredTrustedDevices,
  countTrustedDevicesByUser,
  // Vault re-key
  deletePersonalVaultsByUser,
  deleteUserKeyBackup,
  flagVaultMembersForRekey,
  updateVaultMemberKey,
  // Homepage
  getShortcutsByUser,
  getShortcutsByCategory,
  createShortcut,
  updateShortcutById,
  deleteShortcutById,
  deleteShortcutByIdAdmin,
  addUserFavourite,
  removeUserFavourite,
  isUserFavourite,
  getUserFavouriteIds,
  countUserFavourites,
  deleteFavouritesByShortcut,
  getShortcutById,
  getShortcutByIdAny,
  getHomepageSettings,
  setHomepageSettings,
  // Shared
  VALID_EXPIRY_OPTIONS,
  VALID_GUEST_EXPIRY,
  VALID_SYNTAX_OPTIONS,
  FILES_DIR,
  TMP_DIR,
};
