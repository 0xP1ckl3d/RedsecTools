const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { SYSTEM_ROLE_DEFINITIONS, normalizePermissionList } = require("./access");

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
const BULLETIN_ASSETS_DIR = path.join(__dirname, "..", "data", "bulletin-assets");
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
if (!fs.existsSync(BULLETIN_ASSETS_DIR)) fs.mkdirSync(BULLETIN_ASSETS_DIR, { recursive: true });

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
    role_id TEXT,
    suspended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

  CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    role_key TEXT UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL,
    permission TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (role_id, permission)
  );
  CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

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

  CREATE TABLE IF NOT EXISTS extension_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_extension_sessions_user_id ON extension_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_extension_sessions_expires_at ON extension_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    linked_session_id TEXT,
    expires_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_linked_session_id ON admin_sessions(linked_session_id);
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    role_id TEXT,
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
    can_write INTEGER NOT NULL DEFAULT 1,
    can_manage_members INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS mfa_login_state (
    user_id TEXT NOT NULL PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    first_failed_at INTEGER,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_mfa_login_state_blocked_until ON mfa_login_state(blocked_until);

  CREATE TABLE IF NOT EXISTS auth_login_state (
    email TEXT NOT NULL PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    first_failed_at INTEGER,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_auth_login_state_blocked_until ON auth_login_state(blocked_until);

  CREATE TABLE IF NOT EXISTS email_send_state (
    email TEXT NOT NULL PRIMARY KEY,
    sent_count INTEGER NOT NULL DEFAULT 0,
    window_started_at INTEGER,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_email_send_state_blocked_until ON email_send_state(blocked_until);

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

  CREATE TABLE IF NOT EXISTS bulletins (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_source TEXT NOT NULL,
    author_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at INTEGER,
    ends_at INTEGER,
    pin_starts_at INTEGER,
    pin_ends_at INTEGER,
    recurrence_type TEXT NOT NULL DEFAULT 'none',
    recurrence_config TEXT,
    style_preset TEXT NOT NULL DEFAULT 'default',
    animation_preset TEXT NOT NULL DEFAULT 'none',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_bulletins_status ON bulletins(status, starts_at, created_at);

  CREATE TABLE IF NOT EXISTS bulletin_assets (
    id TEXT PRIMARY KEY,
    bulletin_id TEXT,
    author_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/webp',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_bulletin_assets_bulletin ON bulletin_assets(bulletin_id);

  CREATE TABLE IF NOT EXISTS calendar_projects (
    id TEXT PRIMARY KEY,
    code TEXT,
    name TEXT NOT NULL,
    client_name TEXT,
    project_type TEXT,
    description TEXT,
    color TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    starts_at INTEGER,
    ends_at INTEGER,
    estimated_mode TEXT NOT NULL DEFAULT 'hours',
    estimated_value REAL NOT NULL DEFAULT 0,
    estimated_hours INTEGER NOT NULL DEFAULT 0,
    billable_rate REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS calendar_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    assignee_user_id TEXT,
    project_id TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    scheduled_hours REAL NOT NULL DEFAULT 0,
    utilization_percent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_calendar_entries_time ON calendar_entries(starts_at, ends_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_entries_assignee ON calendar_entries(assignee_user_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_entries_project ON calendar_entries(project_id);

  CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    response_mode TEXT NOT NULL DEFAULT 'anonymous_public',
    status TEXT NOT NULL DEFAULT 'draft',
    public_token TEXT UNIQUE,
    starts_at INTEGER,
    ends_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_surveys_token ON surveys(public_token);

  CREATE TABLE IF NOT EXISTS survey_questions (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id, sort_order);

  CREATE TABLE IF NOT EXISTS survey_question_options (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    option_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_survey_options_question ON survey_question_options(question_id, sort_order);

  CREATE TABLE IF NOT EXISTS survey_responses (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL,
    responder_user_id TEXT,
    responder_name TEXT,
    submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
    source_ip TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id, submitted_at);

  CREATE TABLE IF NOT EXISTS survey_answers (
    id TEXT PRIMARY KEY,
    response_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    answer_text TEXT,
    answer_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers(response_id);

  CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    body_html TEXT NOT NULL,
    excerpt TEXT,
    scope TEXT NOT NULL DEFAULT 'team',
    owner_id TEXT,
    parent_page_id TEXT,
    author_id TEXT NOT NULL,
    last_editor_id TEXT,
    published_at INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages(parent_page_id);

  CREATE TABLE IF NOT EXISTS wiki_page_revisions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    body_html TEXT NOT NULL,
    excerpt TEXT,
    author_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_revisions_page ON wiki_page_revisions(page_id, created_at);
`);

// Add avatar column to users table (safe migration)
try { db.exec("ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role_id TEXT"); } catch {}
try { db.exec("ALTER TABLE invites ADD COLUMN role_id TEXT"); } catch {}

// Add needs_rekey column to vault_members (safe migration)
try { db.exec("ALTER TABLE vault_members ADD COLUMN needs_rekey INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE vault_members ADD COLUMN can_write INTEGER NOT NULL DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE vault_members ADD COLUMN can_manage_members INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("UPDATE vault_members SET can_write = 1 WHERE can_write IS NULL"); } catch {}
try { db.exec("UPDATE vault_members SET can_manage_members = CASE WHEN role = 'admin' THEN 1 ELSE 0 END WHERE can_manage_members IS NULL OR can_manage_members NOT IN (0, 1)"); } catch {}
try { db.exec("ALTER TABLE mfa_pending_logins ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN description TEXT"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN icon_url TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN code TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN client_name TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN project_type TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN starts_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN ends_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_mode TEXT NOT NULL DEFAULT 'hours'"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_value REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_hours INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN billable_rate REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN notes TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_entries ADD COLUMN scheduled_hours REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("UPDATE calendar_entries SET scheduled_hours = ROUND((ends_at - starts_at) / 3600.0, 2) WHERE project_id IS NOT NULL AND (scheduled_hours IS NULL OR scheduled_hours = 0) AND ends_at > starts_at"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN excerpt TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN scope TEXT NOT NULL DEFAULT 'team'"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN owner_id TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN last_editor_id TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN published_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE wiki_page_revisions ADD COLUMN excerpt TEXT"); } catch {}
try { db.exec("UPDATE wiki_pages SET excerpt = substr(replace(replace(body_markdown, char(13), ' '), char(10), ' '), 1, 220) WHERE excerpt IS NULL OR excerpt = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET scope = 'team' WHERE scope IS NULL OR scope = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET last_editor_id = author_id WHERE last_editor_id IS NULL OR last_editor_id = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET published_at = coalesce(updated_at, created_at) WHERE published_at IS NULL OR published_at = 0"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_wiki_pages_scope_owner ON wiki_pages(scope, owner_id, updated_at)"); } catch {}

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
const SHARE_MAX_FILE_SIZE_OPTIONS_MB = [10, 25, 50, 100, 250];
const SHARE_MAX_FILE_COUNT_OPTIONS = [1, 2, 3, 5, 8];

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
    INSERT INTO users (id, email, username, password_hash, role_id)
    VALUES (@id, @email, @username, @passwordHash, @roleId)
  `),
  getUserById: db.prepare(`
    SELECT u.*, r.role_key, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.id = ?
  `),
  getUserByEmail: db.prepare(`
    SELECT u.*, r.role_key, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.email = ?
  `),
  getUserByUsername: db.prepare(`
    SELECT u.*, r.role_key, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.username = ?
  `),
  updateUserPassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?"),
  updateUser: db.prepare("UPDATE users SET email = @email, username = @username, role_id = COALESCE(@roleId, role_id), updated_at = unixepoch() WHERE id = @id"),
  updateUsername: db.prepare("UPDATE users SET username = ?, updated_at = unixepoch() WHERE id = ?"),
  updateUserRole: db.prepare("UPDATE users SET role_id = ?, updated_at = unixepoch() WHERE id = ?"),
  suspendUser: db.prepare("UPDATE users SET suspended = 1, updated_at = unixepoch() WHERE id = ?"),
  unsuspendUser: db.prepare("UPDATE users SET suspended = 0, updated_at = unixepoch() WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  listUsers: db.prepare(`
    SELECT u.id, u.email, u.username, u.suspended, u.created_at, u.updated_at, u.role_id, r.role_key, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `),
  countUsers: db.prepare("SELECT COUNT(*) as total FROM users"),

  // --- Role statements ---
  createRole: db.prepare(`
    INSERT INTO roles (id, role_key, name, description, is_system)
    VALUES (@id, @roleKey, @name, @description, @isSystem)
  `),
  getRoleById: db.prepare("SELECT * FROM roles WHERE id = ?"),
  getRoleByKey: db.prepare("SELECT * FROM roles WHERE role_key = ?"),
  getRoleByName: db.prepare("SELECT * FROM roles WHERE name = ?"),
  listRoles: db.prepare("SELECT * FROM roles ORDER BY is_system DESC, name ASC"),
  updateRole: db.prepare(`
    UPDATE roles
    SET name = @name, description = @description, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteRole: db.prepare("DELETE FROM roles WHERE id = ? AND is_system = 0"),
  replaceRolePermissionsDelete: db.prepare("DELETE FROM role_permissions WHERE role_id = ?"),
  addRolePermission: db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)"),
  getRolePermissions: db.prepare("SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission"),
  getPermissionsByUserId: db.prepare(`
    SELECT rp.permission
    FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE u.id = ?
    ORDER BY rp.permission
  `),
  countUsersByRoleId: db.prepare("SELECT COUNT(*) as total FROM users WHERE role_id = ?"),

  // --- Session statements ---
  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @expiresAt, @ipAddress, @userAgent)
  `),
  getSessionById: db.prepare(`
    SELECT s.*, u.username, u.suspended, u.avatar_updated_at, u.role_id, r.role_key, r.name as role_name
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE s.id = ?
  `),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < unixepoch()"),
  deleteSessionsByUserId: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?"),

  createExtensionSession: db.prepare(`
    INSERT INTO extension_sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @expiresAt, @ipAddress, @userAgent)
  `),
  getExtensionSessionById: db.prepare(`
    SELECT s.*, u.username, u.suspended, u.avatar_updated_at, u.role_id, r.role_key, r.name as role_name
    FROM extension_sessions s
    JOIN users u ON s.user_id = u.id
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE s.id = ?
  `),
  deleteExtensionSession: db.prepare("DELETE FROM extension_sessions WHERE id = ?"),
  deleteExpiredExtensionSessions: db.prepare("DELETE FROM extension_sessions WHERE expires_at < unixepoch()"),
  deleteExtensionSessionsByUserId: db.prepare("DELETE FROM extension_sessions WHERE user_id = ?"),

  createAdminSession: db.prepare(`
    INSERT INTO admin_sessions (id, user_id, linked_session_id, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @linkedSessionId, @expiresAt, @ipAddress, @userAgent)
  `),
  getAdminSessionById: db.prepare("SELECT * FROM admin_sessions WHERE id = ?"),
  deleteAdminSession: db.prepare("DELETE FROM admin_sessions WHERE id = ?"),
  deleteExpiredAdminSessions: db.prepare("DELETE FROM admin_sessions WHERE expires_at < unixepoch()"),
  deleteAdminSessionsByUserId: db.prepare("DELETE FROM admin_sessions WHERE user_id = ?"),

  // --- Invite statements ---
  createInvite: db.prepare(`
    INSERT INTO invites (id, email, token, created_by, role_id, expires_at)
    VALUES (@id, @email, @token, @createdBy, @roleId, @expiresAt)
  `),
  getInviteByToken: db.prepare(`
    SELECT i.*, r.name as role_name
    FROM invites i
    LEFT JOIN roles r ON r.id = i.role_id
    WHERE i.token = ?
  `),
  getInviteByEmail: db.prepare("SELECT * FROM invites WHERE email = ? AND used = 0 AND expires_at > unixepoch() ORDER BY created_at DESC LIMIT 1"),
  markInviteUsed: db.prepare("UPDATE invites SET used = 1 WHERE id = ?"),
  deleteExpiredInvites: db.prepare("DELETE FROM invites WHERE expires_at < unixepoch() AND used = 0"),
  revokeInvite: db.prepare("DELETE FROM invites WHERE id = ? AND used = 0"),
  listInvites: db.prepare(`
    SELECT i.id, i.email, i.token, i.created_by, i.role_id, r.name as role_name, i.used, i.expires_at, i.created_at
    FROM invites i
    LEFT JOIN roles r ON r.id = i.role_id
    ORDER BY i.created_at DESC LIMIT ? OFFSET ?
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
  setConversationKeyVersion: db.prepare("UPDATE conversations SET key_version = ?, updated_at = unixepoch() WHERE id = ?"),
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
    INSERT INTO vault_members (id, vault_id, user_id, role, can_write, can_manage_members, encrypted_master_key)
    VALUES (@id, @vaultId, @userId, @role, @canWrite, @canManageMembers, @encryptedMasterKey)
  `),
  getVaultMembers: db.prepare("SELECT vm.*, u.username, u.avatar_updated_at FROM vault_members vm JOIN users u ON vm.user_id = u.id WHERE vm.vault_id = ?"),
  getVaultMember: db.prepare("SELECT * FROM vault_members WHERE vault_id = ? AND user_id = ?"),
  updateVaultMemberPermissions: db.prepare(`
    UPDATE vault_members
    SET role = @role, can_write = @canWrite, can_manage_members = @canManageMembers
    WHERE vault_id = @vaultId AND user_id = @userId
  `),
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
  deleteVaultShareById: db.prepare("DELETE FROM vault_entry_shares WHERE id = ?"),
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
      (
        SELECT COUNT(*) FROM (
          SELECT v.owner_id AS user_id
          UNION
          SELECT vm.user_id FROM vault_members vm WHERE vm.vault_id = v.id
        )
      ) as member_count,
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
  getMfaLoginState: db.prepare("SELECT * FROM mfa_login_state WHERE user_id = ?"),
  upsertMfaLoginState: db.prepare(`
    INSERT INTO mfa_login_state (user_id, failed_attempts, first_failed_at, blocked_until, updated_at)
    VALUES (@userId, @failedAttempts, @firstFailedAt, @blockedUntil, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      failed_attempts = excluded.failed_attempts,
      first_failed_at = excluded.first_failed_at,
      blocked_until = excluded.blocked_until,
      updated_at = unixepoch()
  `),
  clearMfaLoginState: db.prepare("DELETE FROM mfa_login_state WHERE user_id = ?"),
  getAuthLoginState: db.prepare("SELECT * FROM auth_login_state WHERE email = ?"),
  upsertAuthLoginState: db.prepare(`
    INSERT INTO auth_login_state (email, failed_attempts, first_failed_at, blocked_until, updated_at)
    VALUES (@email, @failedAttempts, @firstFailedAt, @blockedUntil, unixepoch())
    ON CONFLICT(email) DO UPDATE SET
      failed_attempts = excluded.failed_attempts,
      first_failed_at = excluded.first_failed_at,
      blocked_until = excluded.blocked_until,
      updated_at = unixepoch()
  `),
  clearAuthLoginState: db.prepare("DELETE FROM auth_login_state WHERE email = ?"),
  getEmailSendState: db.prepare("SELECT * FROM email_send_state WHERE email = ?"),
  upsertEmailSendState: db.prepare(`
    INSERT INTO email_send_state (email, sent_count, window_started_at, blocked_until, updated_at)
    VALUES (@email, @sentCount, @windowStartedAt, @blockedUntil, unixepoch())
    ON CONFLICT(email) DO UPDATE SET
      sent_count = excluded.sent_count,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = unixepoch()
  `),
  clearEmailSendState: db.prepare("DELETE FROM email_send_state WHERE email = ?"),

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

  // --- Bulletins ---
  createBulletin: db.prepare(`
    INSERT INTO bulletins (
      id, title, body_html, body_source, author_id, status, starts_at, ends_at,
      pin_starts_at, pin_ends_at, recurrence_type, recurrence_config, style_preset, animation_preset
    ) VALUES (
      @id, @title, @bodyHtml, @bodySource, @authorId, @status, @startsAt, @endsAt,
      @pinStartsAt, @pinEndsAt, @recurrenceType, @recurrenceConfig, @stylePreset, @animationPreset
    )
  `),
  updateBulletin: db.prepare(`
    UPDATE bulletins SET
      title = @title,
      body_html = @bodyHtml,
      body_source = @bodySource,
      status = @status,
      starts_at = @startsAt,
      ends_at = @endsAt,
      pin_starts_at = @pinStartsAt,
      pin_ends_at = @pinEndsAt,
      recurrence_type = @recurrenceType,
      recurrence_config = @recurrenceConfig,
      style_preset = @stylePreset,
      animation_preset = @animationPreset,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  getBulletinById: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    WHERE b.id = ?
  `),
  listAllBulletins: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    ORDER BY b.created_at DESC
  `),
  listBulletinsByAuthor: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    WHERE b.author_id = ?
    ORDER BY b.updated_at DESC, b.created_at DESC
    LIMIT ? OFFSET ?
  `),
  listBulletins: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    ORDER BY
      CASE WHEN b.pin_starts_at IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(b.pin_starts_at, b.starts_at, b.created_at) DESC,
      b.created_at DESC
    LIMIT ? OFFSET ?
  `),
  listActiveBulletins: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    WHERE b.status = 'published'
      AND (b.starts_at IS NULL OR b.starts_at <= unixepoch())
      AND (b.ends_at IS NULL OR b.ends_at >= unixepoch())
    ORDER BY
      CASE
        WHEN b.pin_starts_at IS NOT NULL
         AND (b.pin_starts_at <= unixepoch())
         AND (b.pin_ends_at IS NULL OR b.pin_ends_at >= unixepoch())
        THEN 0 ELSE 1 END,
      COALESCE(b.pin_starts_at, b.starts_at, b.created_at) DESC,
      b.created_at DESC
    LIMIT ? OFFSET ?
  `),
  listPinnedBulletins: db.prepare(`
    SELECT b.*, u.username as author_username
    FROM bulletins b
    JOIN users u ON u.id = b.author_id
    WHERE b.status = 'published'
      AND b.pin_starts_at IS NOT NULL
      AND b.pin_starts_at <= unixepoch()
      AND (b.pin_ends_at IS NULL OR b.pin_ends_at >= unixepoch())
      AND (b.starts_at IS NULL OR b.starts_at <= unixepoch())
      AND (b.ends_at IS NULL OR b.ends_at >= unixepoch())
    ORDER BY COALESCE(b.pin_starts_at, b.created_at) DESC, b.created_at DESC
    LIMIT ? OFFSET ?
  `),
  countBulletins: db.prepare("SELECT COUNT(*) as total FROM bulletins"),
  countActiveBulletins: db.prepare(`
    SELECT COUNT(*) as total
    FROM bulletins
    WHERE status = 'published'
      AND (starts_at IS NULL OR starts_at <= unixepoch())
      AND (ends_at IS NULL OR ends_at >= unixepoch())
  `),
  deleteBulletin: db.prepare("DELETE FROM bulletins WHERE id = ?"),
  createBulletinAsset: db.prepare(`
    INSERT INTO bulletin_assets (id, bulletin_id, author_id, filename, mime_type, size_bytes)
    VALUES (@id, @bulletinId, @authorId, @filename, @mimeType, @sizeBytes)
  `),
  attachBulletinAsset: db.prepare("UPDATE bulletin_assets SET bulletin_id = ? WHERE id = ? AND author_id = ?"),
  getBulletinAssetById: db.prepare("SELECT * FROM bulletin_assets WHERE id = ?"),
  listBulletinAssetsByBulletinId: db.prepare("SELECT * FROM bulletin_assets WHERE bulletin_id = ? ORDER BY created_at DESC"),
  listOrphanedBulletinAssetsOlderThan: db.prepare(`
    SELECT *
    FROM bulletin_assets
    WHERE bulletin_id IS NULL
      AND created_at <= ?
    ORDER BY created_at ASC
  `),
  deleteBulletinAssetById: db.prepare("DELETE FROM bulletin_assets WHERE id = ?"),

  // --- Calendar ---
  createCalendarProject: db.prepare(`
    INSERT INTO calendar_projects (
      id, code, name, client_name, project_type, description, color, status,
      starts_at, ends_at, estimated_mode, estimated_value, estimated_hours, billable_rate, notes, created_by
    )
    VALUES (
      @id, @code, @name, @clientName, @projectType, @description, @color, @status,
      @startsAt, @endsAt, @estimatedMode, @estimatedValue, @estimatedHours, @billableRate, @notes, @createdBy
    )
  `),
  updateCalendarProject: db.prepare(`
    UPDATE calendar_projects
    SET
      code = @code,
      name = @name,
      client_name = @clientName,
      project_type = @projectType,
      description = @description,
      color = @color,
      status = @status,
      starts_at = @startsAt,
      ends_at = @endsAt,
      estimated_mode = @estimatedMode,
      estimated_value = @estimatedValue,
      estimated_hours = @estimatedHours,
      billable_rate = @billableRate,
      notes = @notes,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  listCalendarProjects: db.prepare(`
    SELECT cp.*, u.username as created_by_username
    FROM calendar_projects cp
    LEFT JOIN users u ON u.id = cp.created_by
    ORDER BY
      CASE cp.status
        WHEN 'active' THEN 0
        WHEN 'proposed' THEN 1
        WHEN 'on_hold' THEN 2
        WHEN 'complete' THEN 3
        ELSE 4
      END,
      COALESCE(cp.client_name, '') ASC,
      cp.name ASC
  `),
  getCalendarProjectById: db.prepare(`
    SELECT cp.*, u.username as created_by_username
    FROM calendar_projects cp
    LEFT JOIN users u ON u.id = cp.created_by
    WHERE cp.id = ?
  `),
  detachCalendarEntriesFromProject: db.prepare("UPDATE calendar_entries SET project_id = NULL, updated_at = unixepoch() WHERE project_id = ?"),
  deleteCalendarProject: db.prepare("DELETE FROM calendar_projects WHERE id = ?"),
  listCalendarUsersBasic: db.prepare(`
    SELECT u.id, u.username, u.role_id, r.role_key, r.name as role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.suspended = 0
    ORDER BY u.username COLLATE NOCASE ASC
  `),
  createCalendarEntry: db.prepare(`
    INSERT INTO calendar_entries (
      id, type, title, description, owner_id, assignee_user_id, project_id,
      starts_at, ends_at, all_day, scheduled_hours, utilization_percent, status
    ) VALUES (
      @id, @type, @title, @description, @ownerId, @assigneeUserId, @projectId,
      @startsAt, @endsAt, @allDay, @scheduledHours, @utilizationPercent, @status
    )
  `),
  updateCalendarEntry: db.prepare(`
    UPDATE calendar_entries SET
      type = @type,
      title = @title,
      description = @description,
      assignee_user_id = @assigneeUserId,
      project_id = @projectId,
      starts_at = @startsAt,
      ends_at = @endsAt,
      all_day = @allDay,
      scheduled_hours = @scheduledHours,
      utilization_percent = @utilizationPercent,
      status = @status,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteCalendarEntry: db.prepare("DELETE FROM calendar_entries WHERE id = ?"),
  getCalendarEntryById: db.prepare("SELECT * FROM calendar_entries WHERE id = ?"),
  listCalendarEntries: db.prepare(`
    SELECT
      ce.*,
      au.username as assignee_username,
      ou.username as owner_username,
      p.name as project_name,
      p.client_name as project_client_name,
      p.code as project_code,
      p.color as project_color,
      p.project_type as project_type
    FROM calendar_entries ce
    LEFT JOIN users au ON au.id = ce.assignee_user_id
    LEFT JOIN users ou ON ou.id = ce.owner_id
    LEFT JOIN calendar_projects p ON p.id = ce.project_id
    WHERE (@assigneeUserId IS NULL OR ce.assignee_user_id = @assigneeUserId)
      AND (@ownerId IS NULL OR ce.owner_id = @ownerId)
      AND (@projectId IS NULL OR ce.project_id = @projectId)
      AND ce.starts_at <= @endsBefore
      AND ce.ends_at >= @startsAfter
    ORDER BY ce.starts_at ASC, ce.created_at ASC
  `),

  // --- Surveys ---
  createSurvey: db.prepare(`
    INSERT INTO surveys (id, title, description, owner_id, response_mode, status, public_token, starts_at, ends_at)
    VALUES (@id, @title, @description, @ownerId, @responseMode, @status, @publicToken, @startsAt, @endsAt)
  `),
  updateSurvey: db.prepare(`
    UPDATE surveys SET
      title = @title,
      description = @description,
      response_mode = @responseMode,
      status = @status,
      public_token = @publicToken,
      starts_at = @startsAt,
      ends_at = @endsAt,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteSurvey: db.prepare("DELETE FROM surveys WHERE id = ?"),
  getSurveyById: db.prepare("SELECT * FROM surveys WHERE id = ?"),
  getSurveyByToken: db.prepare("SELECT * FROM surveys WHERE public_token = ?"),
  listSurveysByOwner: db.prepare("SELECT * FROM surveys WHERE owner_id = ? ORDER BY updated_at DESC"),
  listAllSurveys: db.prepare("SELECT * FROM surveys ORDER BY updated_at DESC"),
  deleteSurveyQuestionsBySurvey: db.prepare("DELETE FROM survey_questions WHERE survey_id = ?"),
  createSurveyQuestion: db.prepare(`
    INSERT INTO survey_questions (id, survey_id, question_text, question_type, is_required, sort_order)
    VALUES (@id, @surveyId, @questionText, @questionType, @isRequired, @sortOrder)
  `),
  listSurveyQuestions: db.prepare("SELECT * FROM survey_questions WHERE survey_id = ? ORDER BY sort_order, created_at"),
  createSurveyQuestionOption: db.prepare(`
    INSERT INTO survey_question_options (id, question_id, option_text, sort_order)
    VALUES (@id, @questionId, @optionText, @sortOrder)
  `),
  deleteSurveyOptionsByQuestion: db.prepare("DELETE FROM survey_question_options WHERE question_id = ?"),
  listSurveyOptionsByQuestionIds: db.prepare(`
    SELECT *
    FROM survey_question_options
    WHERE question_id IN (
      SELECT id FROM survey_questions WHERE survey_id = ?
    )
    ORDER BY sort_order, created_at
  `),
  createSurveyResponse: db.prepare(`
    INSERT INTO survey_responses (id, survey_id, responder_user_id, responder_name, source_ip)
    VALUES (@id, @surveyId, @responderUserId, @responderName, @sourceIp)
  `),
  countSurveyResponsesByUser: db.prepare(`
    SELECT COUNT(*) as count
    FROM survey_responses
    WHERE survey_id = ? AND responder_user_id = ?
  `),
  createSurveyAnswer: db.prepare(`
    INSERT INTO survey_answers (id, response_id, question_id, answer_text, answer_json)
    VALUES (@id, @responseId, @questionId, @answerText, @answerJson)
  `),
  listSurveyResponsesBySurvey: db.prepare("SELECT * FROM survey_responses WHERE survey_id = ? ORDER BY submitted_at DESC"),
  listSurveyAnswersBySurvey: db.prepare(`
    SELECT sa.*, sr.survey_id
    FROM survey_answers sa
    JOIN survey_responses sr ON sr.id = sa.response_id
    WHERE sr.survey_id = ?
    ORDER BY sr.submitted_at DESC, sa.created_at ASC
  `),
  deleteSurveyAnswersBySurvey: db.prepare(`
    DELETE FROM survey_answers WHERE response_id IN (
      SELECT id FROM survey_responses WHERE survey_id = ?
    )
  `),
  deleteSurveyResponsesBySurvey: db.prepare("DELETE FROM survey_responses WHERE survey_id = ?"),
  countSurveyResponses: db.prepare("SELECT COUNT(*) as count FROM survey_responses WHERE survey_id = ?"),
  countSurveyQuestions: db.prepare("SELECT COUNT(*) as count FROM survey_questions WHERE survey_id = ?"),
  updateSurveyQuestionSort: db.prepare("UPDATE survey_questions SET sort_order = @sortOrder WHERE id = @id"),
  getSurveyResponseById: db.prepare("SELECT * FROM survey_responses WHERE id = ?"),
  listSurveyAnswersByResponse: db.prepare("SELECT * FROM survey_answers WHERE response_id = ? ORDER BY created_at"),
  closeExpiredSurveys: db.prepare(`
    UPDATE surveys SET status = 'ended', updated_at = unixepoch()
    WHERE status = 'published' AND ends_at IS NOT NULL AND ends_at < unixepoch()
  `),

  // --- Wiki ---
  createWikiPage: db.prepare(`
    INSERT INTO wiki_pages (
      id, slug, title, body_markdown, body_html, excerpt, scope, owner_id, parent_page_id,
      author_id, last_editor_id, published_at, sort_order
    )
    VALUES (
      @id, @slug, @title, @bodyMarkdown, @bodyHtml, @excerpt, @scope, @ownerId, @parentPageId,
      @authorId, @lastEditorId, @publishedAt, @sortOrder
    )
  `),
  updateWikiPage: db.prepare(`
    UPDATE wiki_pages SET
      slug = @slug,
      title = @title,
      body_markdown = @bodyMarkdown,
      body_html = @bodyHtml,
      excerpt = @excerpt,
      scope = @scope,
      owner_id = @ownerId,
      parent_page_id = @parentPageId,
      last_editor_id = @lastEditorId,
      published_at = @publishedAt,
      sort_order = @sortOrder,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteWikiPage: db.prepare("DELETE FROM wiki_pages WHERE id = ?"),
  deleteWikiRevisionByPageId: db.prepare("DELETE FROM wiki_page_revisions WHERE page_id = ?"),
  getWikiPageById: db.prepare(`
    SELECT wp.*,
      author.username AS author_username,
      owner.username AS owner_username,
      editor.username AS last_editor_username
    FROM wiki_pages wp
    LEFT JOIN users author ON author.id = wp.author_id
    LEFT JOIN users owner ON owner.id = wp.owner_id
    LEFT JOIN users editor ON editor.id = wp.last_editor_id
    WHERE wp.id = ?
  `),
  getWikiPageBySlug: db.prepare(`
    SELECT wp.*,
      author.username AS author_username,
      owner.username AS owner_username,
      editor.username AS last_editor_username
    FROM wiki_pages wp
    LEFT JOIN users author ON author.id = wp.author_id
    LEFT JOIN users owner ON owner.id = wp.owner_id
    LEFT JOIN users editor ON editor.id = wp.last_editor_id
    WHERE wp.slug = ?
  `),
  listWikiPages: db.prepare(`
    SELECT wp.*,
      author.username AS author_username,
      owner.username AS owner_username,
      editor.username AS last_editor_username
    FROM wiki_pages wp
    LEFT JOIN users author ON author.id = wp.author_id
    LEFT JOIN users owner ON owner.id = wp.owner_id
    LEFT JOIN users editor ON editor.id = wp.last_editor_id
    WHERE (@scope = '' OR wp.scope = @scope)
      AND (@ownerId = '' OR ifnull(wp.owner_id, '') = @ownerId)
    ORDER BY wp.scope ASC, COALESCE(wp.parent_page_id, ''), wp.sort_order ASC, wp.title COLLATE NOCASE ASC
  `),
  searchWikiPages: db.prepare(`
    SELECT wp.*,
      author.username AS author_username,
      owner.username AS owner_username,
      editor.username AS last_editor_username
    FROM wiki_pages wp
    LEFT JOIN users author ON author.id = wp.author_id
    LEFT JOIN users owner ON owner.id = wp.owner_id
    LEFT JOIN users editor ON editor.id = wp.last_editor_id
    WHERE (@scope = '' OR wp.scope = @scope)
      AND (@ownerId = '' OR ifnull(wp.owner_id, '') = @ownerId)
      AND (wp.title LIKE @term OR wp.body_markdown LIKE @term OR ifnull(wp.excerpt, '') LIKE @term)
    ORDER BY wp.updated_at DESC
    LIMIT @limit
  `),
  createWikiRevision: db.prepare(`
    INSERT INTO wiki_page_revisions (id, page_id, title, body_markdown, body_html, excerpt, author_id)
    VALUES (@id, @pageId, @title, @bodyMarkdown, @bodyHtml, @excerpt, @authorId)
  `),
  listWikiRevisions: db.prepare(`
    SELECT wr.*, users.username AS author_username
    FROM wiki_page_revisions wr
    LEFT JOIN users ON users.id = wr.author_id
    WHERE wr.page_id = ?
    ORDER BY wr.created_at DESC
  `),
  getWikiRevisionById: db.prepare(`
    SELECT wr.*, users.username AS author_username
    FROM wiki_page_revisions wr
    LEFT JOIN users ON users.id = wr.author_id
    WHERE wr.id = ?
  `),
  countWikiPagesByScope: db.prepare(`
    SELECT
      SUM(CASE WHEN scope = 'team' THEN 1 ELSE 0 END) AS team_total,
      SUM(CASE WHEN scope = 'personal' THEN 1 ELSE 0 END) AS personal_total,
      COUNT(*) AS total
    FROM wiki_pages
  `),
  countWikiRevisions: db.prepare("SELECT COUNT(*) AS total FROM wiki_page_revisions"),

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
  bulletin_auto_purge_enabled: "false",
  bulletin_auto_purge_days: "90",
  bulletin_asset_auto_purge_days: "30",
  calendar_daily_hours: "7.6",
  calendar_workday_start: "08:30",
  calendar_workday_end: "17:30",
  calendar_workdays: "1,2,3,4,5",
  wiki_personal_spaces_enabled: "true",
  wiki_search_result_limit: "20",
  wiki_team_home_page_id: "",
};
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!getSetting(key)) setSetting(key, value);
}

db.prepare("UPDATE role_permissions SET permission = 'calendar.view_team' WHERE permission = 'calendar.edit_any'").run();
db.prepare("UPDATE role_permissions SET permission = 'wiki.create_team' WHERE permission = 'wiki.create'").run();
db.prepare("UPDATE role_permissions SET permission = 'wiki.edit_team' WHERE permission = 'wiki.edit_any'").run();
db.prepare("DELETE FROM role_permissions WHERE permission = 'roles.manage'").run();

for (const definition of SYSTEM_ROLE_DEFINITIONS) {
  const existingRole = stmts.getRoleByKey.get(definition.key);
  let roleId = existingRole ? existingRole.id : null;
  if (!existingRole) {
    roleId = crypto.randomBytes(16).toString("base64url");
    stmts.createRole.run({
      id: roleId,
      roleKey: definition.key,
      name: definition.name,
      description: definition.description,
      isSystem: 1,
    });
  }
  stmts.replaceRolePermissionsDelete.run(roleId);
  for (const permission of normalizePermissionList(definition.permissions)) {
    stmts.addRolePermission.run(roleId, permission);
  }
}

const defaultMemberRole = stmts.getRoleByKey.get("member");
if (defaultMemberRole) {
  db.prepare("UPDATE users SET role_id = ? WHERE role_id IS NULL OR role_id = ''").run(defaultMemberRole.id);
}

db.prepare("UPDATE bulletins SET status = 'published' WHERE status IS NULL OR status = 'draft'").run();

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

function getDefaultRoleId() {
  const role = stmts.getRoleByKey.get("member");
  return role ? role.id : null;
}

function createUser({ id, email, username, passwordHash, roleId }) {
  stmts.createUser.run({ id, email, username, passwordHash, roleId: roleId || getDefaultRoleId() });
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

function updateUserDetails({ id, email, username, roleId = null }) {
  stmts.updateUser.run({ id, email, username, roleId });
}

function setUserRole(id, roleId) {
  stmts.updateUserRole.run(roleId, id);
}

function suspendUserById(id) {
  stmts.suspendUser.run(id);
  stmts.deleteUserSessions.run(id);
  stmts.deleteAdminSessionsByUserId.run(id);
}

function unsuspendUserById(id) {
  stmts.unsuspendUser.run(id);
}

function deleteUserById(id) {
  stmts.deleteUserSessions.run(id);
  stmts.deleteAdminSessionsByUserId.run(id);
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
      roleId: r.role_id || null,
      roleKey: r.role_key || null,
      roleName: r.role_name || null,
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

function listRoles() {
  return stmts.listRoles.all().map((role) => ({
    id: role.id,
    key: role.role_key || null,
    name: role.name,
    description: role.description || "",
    isSystem: !!role.is_system,
    permissions: normalizePermissionList(stmts.getRolePermissions.all(role.id).map((row) => row.permission)),
  }));
}

function getRoleById(roleId) {
  const role = stmts.getRoleById.get(roleId);
  if (!role) return null;
  return {
    id: role.id,
    key: role.role_key || null,
    name: role.name,
    description: role.description || "",
    isSystem: !!role.is_system,
    permissions: normalizePermissionList(stmts.getRolePermissions.all(role.id).map((row) => row.permission)),
  };
}

function getRolePermissions(roleId) {
  return normalizePermissionList(stmts.getRolePermissions.all(roleId).map((row) => row.permission));
}

function getRolePermissionsByUserId(userId) {
  return normalizePermissionList(stmts.getPermissionsByUserId.all(userId).map((row) => row.permission));
}

function createRole({ id, roleKey = null, name, description, permissions, isSystem = false }) {
  stmts.createRole.run({
    id,
    roleKey,
    name,
    description: description || "",
    isSystem: isSystem ? 1 : 0,
  });
  replaceRolePermissions(id, permissions);
  return { id };
}

function replaceRolePermissions(roleId, permissions) {
  stmts.replaceRolePermissionsDelete.run(roleId);
  for (const permission of normalizePermissionList(permissions)) {
    stmts.addRolePermission.run(roleId, permission);
  }
}

function updateRole({ id, name, description, permissions }) {
  stmts.updateRole.run({ id, name, description: description || "" });
  replaceRolePermissions(id, permissions);
}

function deleteRoleById(roleId) {
  const role = stmts.getRoleById.get(roleId);
  if (!role || role.is_system) return false;
  if (stmts.countUsersByRoleId.get(roleId).total > 0) return false;
  stmts.replaceRolePermissionsDelete.run(roleId);
  return stmts.deleteRole.run(roleId).changes > 0;
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

function createExtensionSession({ id, userId, expiresIn, ipAddress, userAgent }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createExtensionSession.run({ id, userId, expiresAt, ipAddress, userAgent });
  return { id, expiresAt };
}

function getExtensionSession(id) {
  return stmts.getExtensionSessionById.get(id) || null;
}

function deleteExtensionSessionById(id) {
  stmts.deleteExtensionSession.run(id);
}

function deleteExpiredExtensionSessions() {
  const result = stmts.deleteExpiredExtensionSessions.run();
  return result.changes;
}

function deleteExtensionSessionsByUserId(userId) {
  stmts.deleteExtensionSessionsByUserId.run(userId);
}

function createAdminSession({ id, userId = null, linkedSessionId = null, expiresIn, ipAddress, userAgent }) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  stmts.createAdminSession.run({ id, userId, linkedSessionId, expiresAt, ipAddress, userAgent });
  return { id, expiresAt };
}

function getAdminSession(id) {
  return stmts.getAdminSessionById.get(id) || null;
}

function deleteAdminSessionById(id) {
  stmts.deleteAdminSession.run(id);
}

function deleteExpiredAdminSessions() {
  const result = stmts.deleteExpiredAdminSessions.run();
  return result.changes;
}

function deleteAdminSessionsByUserId(userId) {
  stmts.deleteAdminSessionsByUserId.run(userId);
}

// ============================================================
// Invite functions
// ============================================================

function createInvite({ id, email, token, createdBy, roleId = null, expiresAt }) {
  stmts.createInvite.run({ id, email, token, createdBy, roleId, expiresAt });
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
      roleId: r.role_id || null,
      roleName: r.role_name || null,
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

function getShareConfig() {
  const maxFileSizeMbRaw = parseInt(getSetting("share_max_file_size_mb"), 10);
  const maxFilesPerShareRaw = parseInt(getSetting("share_max_files_per_share"), 10);
  const maxFileSizeMb = SHARE_MAX_FILE_SIZE_OPTIONS_MB.includes(maxFileSizeMbRaw) ? maxFileSizeMbRaw : 250;
  const maxFilesPerShare = SHARE_MAX_FILE_COUNT_OPTIONS.includes(maxFilesPerShareRaw) ? maxFilesPerShareRaw : 8;
  return {
    maxFileSizeMb,
    maxFileSizeBytes: maxFileSizeMb * 1024 * 1024,
    maxFilesPerShare,
  };
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
    stmts.setConversationKeyVersion.run(newKeyVersion, conversationId);
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

function addVaultMember({ id, vaultId, userId, role, canWrite, canManageMembers, encryptedMasterKey }) {
  stmts.addVaultMember.run({
    id,
    vaultId,
    userId,
    role,
    canWrite: canWrite ? 1 : 0,
    canManageMembers: canManageMembers ? 1 : 0,
    encryptedMasterKey,
  });
}

function getVaultMembersList(vaultId) {
  return stmts.getVaultMembers.all(vaultId);
}

function getVaultMemberShip(vaultId, userId) {
  return stmts.getVaultMember.get(vaultId, userId) || null;
}

function updateVaultMemberPermission({ vaultId, userId, role, canWrite, canManageMembers }) {
  const result = stmts.updateVaultMemberPermissions.run({
    vaultId,
    userId,
    role,
    canWrite: canWrite ? 1 : 0,
    canManageMembers: canManageMembers ? 1 : 0,
  });
  return result.changes > 0;
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
  return stmts.deleteVaultShareById.run(id).changes > 0;
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

function getMfaLoginState(userId) {
  return stmts.getMfaLoginState.get(userId) || null;
}

function setMfaLoginState(userId, { failedAttempts, firstFailedAt, blockedUntil }) {
  stmts.upsertMfaLoginState.run({
    userId,
    failedAttempts,
    firstFailedAt: firstFailedAt || null,
    blockedUntil: blockedUntil || 0,
  });
}

function clearMfaLoginState(userId) {
  stmts.clearMfaLoginState.run(userId);
}

function getAuthLoginState(email) {
  return stmts.getAuthLoginState.get(email) || null;
}

function setAuthLoginState(email, { failedAttempts, firstFailedAt, blockedUntil }) {
  stmts.upsertAuthLoginState.run({
    email,
    failedAttempts,
    firstFailedAt: firstFailedAt || null,
    blockedUntil: blockedUntil || 0,
  });
}

function clearAuthLoginState(email) {
  stmts.clearAuthLoginState.run(email);
}

function getEmailSendState(email) {
  return stmts.getEmailSendState.get(email) || null;
}

function setEmailSendState(email, { sentCount, windowStartedAt, blockedUntil }) {
  stmts.upsertEmailSendState.run({
    email,
    sentCount,
    windowStartedAt: windowStartedAt || null,
    blockedUntil: blockedUntil || 0,
  });
}

function clearEmailSendState(email) {
  stmts.clearEmailSendState.run(email);
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

function mapBulletinRow(row) {
  return {
    id: row.id,
    title: row.title,
    bodyHtml: row.body_html,
    bodySource: row.body_source,
    authorId: row.author_id,
    authorUsername: row.author_username || null,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    pinStartsAt: row.pin_starts_at,
    pinEndsAt: row.pin_ends_at,
    recurrenceType: row.recurrence_type,
    recurrenceConfig: row.recurrence_config ? JSON.parse(row.recurrence_config) : null,
    stylePreset: row.style_preset,
    animationPreset: row.animation_preset,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createBulletin(payload) {
  stmts.createBulletin.run({
    id: payload.id,
    title: payload.title,
    bodyHtml: payload.bodyHtml,
    bodySource: payload.bodySource,
    authorId: payload.authorId,
    status: payload.status || "published",
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
    pinStartsAt: payload.pinStartsAt || null,
    pinEndsAt: payload.pinEndsAt || null,
    recurrenceType: payload.recurrenceType || "none",
    recurrenceConfig: payload.recurrenceConfig ? JSON.stringify(payload.recurrenceConfig) : null,
    stylePreset: payload.stylePreset || "default",
    animationPreset: payload.animationPreset || "none",
  });
  return { id: payload.id };
}

function updateBulletin(payload) {
  stmts.updateBulletin.run({
    id: payload.id,
    title: payload.title,
    bodyHtml: payload.bodyHtml,
    bodySource: payload.bodySource,
    status: payload.status || "published",
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
    pinStartsAt: payload.pinStartsAt || null,
    pinEndsAt: payload.pinEndsAt || null,
    recurrenceType: payload.recurrenceType || "none",
    recurrenceConfig: payload.recurrenceConfig ? JSON.stringify(payload.recurrenceConfig) : null,
    stylePreset: payload.stylePreset || "default",
    animationPreset: payload.animationPreset || "none",
  });
}

function getBulletinById(id) {
  const row = stmts.getBulletinById.get(id);
  return row ? mapBulletinRow(row) : null;
}

function listAllBulletins() {
  return stmts.listAllBulletins.all().map(mapBulletinRow);
}

function listBulletinsByAuthor(authorId, page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  return stmts.listBulletinsByAuthor.all(authorId, limit, offset).map(mapBulletinRow);
}

function listBulletins(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  return stmts.listBulletins.all(limit, offset).map(mapBulletinRow);
}

function listActiveBulletins(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  return stmts.listActiveBulletins.all(limit, offset).map(mapBulletinRow);
}

function listPinnedBulletins(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  return stmts.listPinnedBulletins.all(limit, offset).map(mapBulletinRow);
}

function getBulletinStats() {
  return {
    total: stmts.countBulletins.get().total,
    active: stmts.countActiveBulletins.get().total,
  };
}

function deleteBulletinById(id) {
  return stmts.deleteBulletin.run(id).changes > 0;
}

function createBulletinAsset(payload) {
  stmts.createBulletinAsset.run({
    id: payload.id,
    bulletinId: payload.bulletinId || null,
    authorId: payload.authorId,
    filename: payload.filename,
    mimeType: payload.mimeType || "image/webp",
    sizeBytes: payload.sizeBytes || 0,
  });
}

function attachBulletinAssetToBulletin(assetId, bulletinId, authorId) {
  stmts.attachBulletinAsset.run(bulletinId, assetId, authorId);
}

function getBulletinAssetById(id) {
  return stmts.getBulletinAssetById.get(id) || null;
}

function listBulletinAssetsByBulletinId(bulletinId) {
  return stmts.listBulletinAssetsByBulletinId.all(bulletinId);
}

function listOrphanedBulletinAssetsOlderThan(cutoffUnix) {
  return stmts.listOrphanedBulletinAssetsOlderThan.all(cutoffUnix);
}

function deleteBulletinAssetById(id) {
  return stmts.deleteBulletinAssetById.run(id).changes > 0;
}

function createCalendarProject(payload) {
  stmts.createCalendarProject.run({
    id: payload.id,
    code: payload.code || "",
    name: payload.name,
    clientName: payload.clientName || "",
    projectType: payload.projectType || "",
    description: payload.description || "",
    color: payload.color || "",
    status: payload.status || "active",
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
    estimatedMode: payload.estimatedMode || "hours",
    estimatedValue: payload.estimatedValue || 0,
    estimatedHours: payload.estimatedHours || 0,
    billableRate: payload.billableRate || 0,
    notes: payload.notes || "",
    createdBy: payload.createdBy,
  });
}

function updateCalendarProject(payload) {
  stmts.updateCalendarProject.run({
    id: payload.id,
    code: payload.code || "",
    name: payload.name,
    clientName: payload.clientName || "",
    projectType: payload.projectType || "",
    description: payload.description || "",
    color: payload.color || "",
    status: payload.status || "active",
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
    estimatedMode: payload.estimatedMode || "hours",
    estimatedValue: payload.estimatedValue || 0,
    estimatedHours: payload.estimatedHours || 0,
    billableRate: payload.billableRate || 0,
    notes: payload.notes || "",
  });
}

function listCalendarProjects() {
  return stmts.listCalendarProjects.all().map(mapCalendarProjectRow);
}

function getCalendarProjectById(id) {
  const row = stmts.getCalendarProjectById.get(id);
  return row ? mapCalendarProjectRow(row) : null;
}

function deleteCalendarProjectById(id) {
  stmts.detachCalendarEntriesFromProject.run(id);
  return stmts.deleteCalendarProject.run(id).changes > 0;
}

function listCalendarUsersBasic() {
  return stmts.listCalendarUsersBasic.all().map((row) => ({
    id: row.id,
    username: row.username,
    roleId: row.role_id || null,
    roleKey: row.role_key || null,
    roleName: row.role_name || null,
  }));
}

function createCalendarEntry(payload) {
  stmts.createCalendarEntry.run({
    id: payload.id,
    type: payload.type,
    title: payload.title,
    description: payload.description || "",
    ownerId: payload.ownerId,
    assigneeUserId: payload.assigneeUserId || null,
    projectId: payload.projectId || null,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    allDay: payload.allDay ? 1 : 0,
    scheduledHours: Number(payload.scheduledHours || 0),
    utilizationPercent: payload.utilizationPercent || 0,
    status: payload.status || "scheduled",
  });
}

function updateCalendarEntry(payload) {
  stmts.updateCalendarEntry.run({
    id: payload.id,
    type: payload.type,
    title: payload.title,
    description: payload.description || "",
    assigneeUserId: payload.assigneeUserId || null,
    projectId: payload.projectId || null,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    allDay: payload.allDay ? 1 : 0,
    scheduledHours: Number(payload.scheduledHours || 0),
    utilizationPercent: payload.utilizationPercent || 0,
    status: payload.status || "scheduled",
  });
}

function deleteCalendarEntryById(id) {
  return stmts.deleteCalendarEntry.run(id).changes > 0;
}

function getCalendarEntryById(id) {
  return stmts.getCalendarEntryById.get(id) || null;
}

function listCalendarEntries(filters = {}) {
  return stmts.listCalendarEntries.all({
    assigneeUserId: filters.assigneeUserId || null,
    ownerId: filters.ownerId || null,
    projectId: filters.projectId || null,
    startsAfter: filters.startsAfter || 0,
    endsBefore: filters.endsBefore || Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60),
  }).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    ownerId: row.owner_id,
    ownerUsername: row.owner_username || null,
    assigneeUserId: row.assignee_user_id,
    assigneeUsername: row.assignee_username || null,
    projectId: row.project_id,
    projectName: row.project_name || null,
    projectClientName: row.project_client_name || null,
    projectCode: row.project_code || null,
    projectColor: row.project_color || null,
    projectType: row.project_type || null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: !!row.all_day,
    scheduledHours: Number(row.scheduled_hours || 0),
    utilizationPercent: row.utilization_percent,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function mapCalendarProjectRow(row) {
  return {
    id: row.id,
    code: row.code || "",
    name: row.name,
    clientName: row.client_name || "",
    projectType: row.project_type || "",
    description: row.description || "",
    color: row.color || "",
    status: row.status || "active",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    estimatedMode: row.estimated_mode || "hours",
    estimatedValue: Number(row.estimated_value || 0),
    estimatedHours: Number(row.estimated_hours || 0),
    billableRate: Number(row.billable_rate || 0),
    notes: row.notes || "",
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSurvey(payload) {
  stmts.createSurvey.run({
    id: payload.id,
    title: payload.title,
    description: payload.description || "",
    ownerId: payload.ownerId,
    responseMode: payload.responseMode,
    status: payload.status || "draft",
    publicToken: payload.publicToken || null,
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
  });
}

function updateSurvey(payload) {
  stmts.updateSurvey.run({
    id: payload.id,
    title: payload.title,
    description: payload.description || "",
    responseMode: payload.responseMode,
    status: payload.status || "draft",
    publicToken: payload.publicToken || null,
    startsAt: payload.startsAt || null,
    endsAt: payload.endsAt || null,
  });
}

function getSurveyById(id) {
  closeExpiredSurveys();
  return stmts.getSurveyById.get(id) || null;
}

function getSurveyByToken(token) {
  closeExpiredSurveys();
  return stmts.getSurveyByToken.get(token) || null;
}

function listSurveysByOwner(ownerId) {
  closeExpiredSurveys();
  return stmts.listSurveysByOwner.all(ownerId);
}

function listAllSurveys() {
  closeExpiredSurveys();
  return stmts.listAllSurveys.all();
}

function replaceSurveyQuestions(surveyId, questions) {
  const tx = db.transaction(() => {
    const existingQuestions = stmts.listSurveyQuestions.all(surveyId);
    for (const question of existingQuestions) {
      stmts.deleteSurveyOptionsByQuestion.run(question.id);
    }
    stmts.deleteSurveyQuestionsBySurvey.run(surveyId);
    for (let index = 0; index < questions.length; index++) {
      const question = questions[index];
      const questionId = question.id || crypto.randomBytes(16).toString("base64url");
      stmts.createSurveyQuestion.run({
        id: questionId,
        surveyId,
        questionText: question.questionText,
        questionType: question.questionType,
        isRequired: question.isRequired ? 1 : 0,
        sortOrder: index,
      });
      const options = Array.isArray(question.options) ? question.options : [];
      for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
        stmts.createSurveyQuestionOption.run({
          id: crypto.randomBytes(16).toString("base64url"),
          questionId,
          optionText: String(options[optionIndex] || ""),
          sortOrder: optionIndex,
        });
      }
    }
  });
  tx();
}

function deleteSurveyById(id) {
  const tx = db.transaction(() => {
    stmts.deleteSurveyAnswersBySurvey.run(id);
    stmts.deleteSurveyResponsesBySurvey.run(id);
    const questions = stmts.listSurveyQuestions.all(id);
    for (const q of questions) {
      stmts.deleteSurveyOptionsByQuestion.run(q.id);
    }
    stmts.deleteSurveyQuestionsBySurvey.run(id);
    return stmts.deleteSurvey.run(id).changes > 0;
  });
  return tx();
}

function getSurveyQuestions(surveyId) {
  const questions = stmts.listSurveyQuestions.all(surveyId);
  const options = stmts.listSurveyOptionsByQuestionIds.all(surveyId);
  const byQuestionId = new Map();
  for (const option of options) {
    if (!byQuestionId.has(option.question_id)) byQuestionId.set(option.question_id, []);
    byQuestionId.get(option.question_id).push(option.option_text);
  }
  return questions.map((question) => ({
    id: question.id,
    questionText: question.question_text,
    questionType: question.question_type,
    isRequired: !!question.is_required,
    sortOrder: question.sort_order,
    options: byQuestionId.get(question.id) || [],
  }));
}

function createSurveySubmission(payload) {
  const tx = db.transaction(() => {
    stmts.createSurveyResponse.run({
      id: payload.id,
      surveyId: payload.surveyId,
      responderUserId: payload.responderUserId || null,
      responderName: payload.responderName || null,
      sourceIp: payload.sourceIp || null,
    });
    for (const answer of payload.answers) {
      stmts.createSurveyAnswer.run({
        id: crypto.randomBytes(16).toString("base64url"),
        responseId: payload.id,
        questionId: answer.questionId,
        answerText: answer.answerText || null,
        answerJson: answer.answerJson ? JSON.stringify(answer.answerJson) : null,
      });
    }
  });
  tx();
}

function hasSurveyResponseForUser(surveyId, userId) {
  if (!surveyId || !userId) return false;
  return (stmts.countSurveyResponsesByUser.get(surveyId, userId)?.count || 0) > 0;
}

function getSurveyResults(surveyId) {
  const responses = stmts.listSurveyResponsesBySurvey.all(surveyId);
  const answers = stmts.listSurveyAnswersBySurvey.all(surveyId);
  return {
    responses: responses.map((response) => ({
      id: response.id,
      responderUserId: response.responder_user_id,
      responderName: response.responder_name,
      submittedAt: response.submitted_at,
    })),
    answers: answers.map((answer) => ({
      id: answer.id,
      responseId: answer.response_id,
      questionId: answer.question_id,
      answerText: answer.answer_text,
      answerJson: answer.answer_json ? JSON.parse(answer.answer_json) : null,
    })),
  };
}

function reorderSurveyQuestions(surveyId, orderedIds) {
  const tx = db.transaction(() => {
    const existing = stmts.listSurveyQuestions.all(surveyId);
    const existingIds = new Set(existing.map((q) => q.id));
    for (const id of orderedIds) {
      if (!existingIds.has(id)) throw new Error("Question does not belong to survey");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      stmts.updateSurveyQuestionSort.run({ id: orderedIds[i], sortOrder: i });
    }
  });
  tx();
}

function getSurveyStats(surveyId) {
  const responses = stmts.countSurveyResponses.get(surveyId);
  const questions = stmts.countSurveyQuestions.get(surveyId);
  return { responseCount: responses.count, questionCount: questions.count };
}

function getSurveyResponseById(responseId) {
  const response = stmts.getSurveyResponseById.get(responseId);
  if (!response) return null;
  const answers = stmts.listSurveyAnswersByResponse.all(responseId);
  return {
    id: response.id,
    surveyId: response.survey_id,
    responderUserId: response.responder_user_id,
    responderName: response.responder_name,
    submittedAt: response.submitted_at,
    answers: answers.map((a) => ({
      id: a.id,
      questionId: a.question_id,
      answerText: a.answer_text,
      answerJson: a.answer_json ? JSON.parse(a.answer_json) : null,
    })),
  };
}

function closeExpiredSurveys() {
  return stmts.closeExpiredSurveys.run().changes;
}

function createWikiPage(payload) {
  stmts.createWikiPage.run({
    id: payload.id,
    slug: payload.slug,
    title: payload.title,
    bodyMarkdown: payload.bodyMarkdown,
    bodyHtml: payload.bodyHtml,
    excerpt: payload.excerpt || "",
    scope: payload.scope || "team",
    ownerId: payload.ownerId || null,
    parentPageId: payload.parentPageId || null,
    authorId: payload.authorId,
    lastEditorId: payload.lastEditorId || payload.authorId,
    publishedAt: payload.publishedAt || Math.floor(Date.now() / 1000),
    sortOrder: Number(payload.sortOrder || 0),
  });
}

function updateWikiPage(payload) {
  const existing = stmts.getWikiPageById.get(payload.id);
  if (existing) {
    stmts.createWikiRevision.run({
      id: crypto.randomBytes(16).toString("base64url"),
      pageId: existing.id,
      title: existing.title,
      bodyMarkdown: existing.body_markdown,
      bodyHtml: existing.body_html,
      excerpt: existing.excerpt || "",
      authorId: payload.authorId,
    });
  }
  stmts.updateWikiPage.run({
    id: payload.id,
    slug: payload.slug,
    title: payload.title,
    bodyMarkdown: payload.bodyMarkdown,
    bodyHtml: payload.bodyHtml,
    excerpt: payload.excerpt || "",
    scope: payload.scope || existing?.scope || "team",
    ownerId: payload.ownerId !== undefined ? payload.ownerId : (existing?.owner_id || null),
    parentPageId: payload.parentPageId || null,
    lastEditorId: payload.lastEditorId || payload.authorId,
    publishedAt: payload.publishedAt || existing?.published_at || Math.floor(Date.now() / 1000),
    sortOrder: Number(payload.sortOrder ?? existing?.sort_order ?? 0),
  });
}

function getWikiPageById(id) {
  const row = stmts.getWikiPageById.get(id);
  return row ? mapWikiPageRow(row) : null;
}

function getWikiPageBySlug(slug) {
  const row = stmts.getWikiPageBySlug.get(slug);
  return row ? mapWikiPageRow(row) : null;
}

function listWikiPages(filters = {}) {
  return stmts.listWikiPages.all({
    scope: filters.scope || "",
    ownerId: filters.ownerId || "",
  }).map(mapWikiPageRow);
}

function searchWikiPages(query, filters = {}) {
  const term = `%${query}%`;
  return stmts.searchWikiPages.all({
    term,
    scope: filters.scope || "",
    ownerId: filters.ownerId || "",
    limit: Number(filters.limit || 20),
  }).map(mapWikiPageRow);
}

function deleteWikiPageById(id) {
  const pages = listWikiPages();
  const target = pages.find((page) => page.id === id);
  if (!target) return false;

  const idsToDelete = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    for (const page of pages) {
      if (page.parentPageId && idsToDelete.has(page.parentPageId) && !idsToDelete.has(page.id)) {
        idsToDelete.add(page.id);
        added = true;
      }
    }
  }

  const tx = db.transaction(() => {
    for (const pageId of idsToDelete) {
      stmts.deleteWikiRevisionByPageId.run(pageId);
      stmts.deleteWikiPage.run(pageId);
    }
  });
  tx();
  return true;
}

function listWikiRevisions(pageId) {
  return stmts.listWikiRevisions.all(pageId).map((row) => ({
    id: row.id,
    pageId: row.page_id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    bodyHtml: row.body_html,
    excerpt: row.excerpt || "",
    authorId: row.author_id,
    authorUsername: row.author_username || null,
    createdAt: row.created_at,
  }));
}

function getWikiRevisionById(id) {
  const row = stmts.getWikiRevisionById.get(id);
  return row ? {
    id: row.id,
    pageId: row.page_id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    bodyHtml: row.body_html,
    excerpt: row.excerpt || "",
    authorId: row.author_id,
    authorUsername: row.author_username || null,
    createdAt: row.created_at,
  } : null;
}

function getWikiStats() {
  const counts = stmts.countWikiPagesByScope.get() || {};
  const revisions = stmts.countWikiRevisions.get() || {};
  return {
    total: Number(counts.total || 0),
    teamTotal: Number(counts.team_total || 0),
    personalTotal: Number(counts.personal_total || 0),
    revisions: Number(revisions.total || 0),
  };
}

function mapWikiPageRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    bodyHtml: row.body_html,
    excerpt: row.excerpt || "",
    scope: row.scope || "team",
    ownerId: row.owner_id || null,
    ownerUsername: row.owner_username || null,
    parentPageId: row.parent_page_id || null,
    authorId: row.author_id,
    authorUsername: row.author_username || null,
    lastEditorId: row.last_editor_id || row.author_id,
    lastEditorUsername: row.last_editor_username || row.author_username || null,
    publishedAt: row.published_at || row.updated_at || row.created_at,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  setUserRole,
  suspendUserById,
  unsuspendUserById,
  deleteUserById,
  listUsers,
  countAllUsers,
  getUsernamesMap,
  getDefaultRoleId,
  listRoles,
  getRoleById,
  getRolePermissions,
  getRolePermissionsByUserId,
  createRole,
  updateRole,
  deleteRoleById,
  // Session
  createSession,
  getSession,
  deleteSessionById,
  deleteExpiredSessions,
  deleteSessionsByUserId,
  deleteOtherSessions,
  createExtensionSession,
  getExtensionSession,
  deleteExtensionSessionById,
  deleteExpiredExtensionSessions,
  deleteExtensionSessionsByUserId,
  createAdminSession,
  getAdminSession,
  deleteAdminSessionById,
  deleteExpiredAdminSessions,
  deleteAdminSessionsByUserId,
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
  getShareConfig,
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
  updateVaultMemberPermission,
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
  getMfaLoginState,
  setMfaLoginState,
  clearMfaLoginState,
  getAuthLoginState,
  setAuthLoginState,
  clearAuthLoginState,
  getEmailSendState,
  setEmailSendState,
  clearEmailSendState,
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
  // Bulletins
  createBulletin,
  updateBulletin,
  getBulletinById,
  listAllBulletins,
  listBulletinsByAuthor,
  listBulletins,
  listActiveBulletins,
  listPinnedBulletins,
  getBulletinStats,
  deleteBulletinById,
  createBulletinAsset,
  attachBulletinAssetToBulletin,
  getBulletinAssetById,
  listBulletinAssetsByBulletinId,
  listOrphanedBulletinAssetsOlderThan,
  deleteBulletinAssetById,
  // Calendar
  createCalendarProject,
  updateCalendarProject,
  listCalendarProjects,
  getCalendarProjectById,
  deleteCalendarProjectById,
  listCalendarUsersBasic,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntryById,
  getCalendarEntryById,
  listCalendarEntries,
  // Survey
  createSurvey,
  updateSurvey,
  getSurveyById,
  getSurveyByToken,
  listSurveysByOwner,
  listAllSurveys,
  replaceSurveyQuestions,
  deleteSurveyById,
  getSurveyQuestions,
  createSurveySubmission,
  hasSurveyResponseForUser,
  getSurveyResults,
  reorderSurveyQuestions,
  getSurveyStats,
  getSurveyResponseById,
  closeExpiredSurveys,
  // Wiki
  createWikiPage,
  updateWikiPage,
  getWikiPageById,
  getWikiPageBySlug,
  listWikiPages,
  searchWikiPages,
  deleteWikiPageById,
  listWikiRevisions,
  getWikiRevisionById,
  getWikiStats,
  // Shared
  VALID_EXPIRY_OPTIONS,
  VALID_GUEST_EXPIRY,
  SHARE_MAX_FILE_SIZE_OPTIONS_MB,
  SHARE_MAX_FILE_COUNT_OPTIONS,
  VALID_SYNTAX_OPTIONS,
  FILES_DIR,
  TMP_DIR,
  BULLETIN_ASSETS_DIR,
};
