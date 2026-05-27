function initializeBaseSchema(db) {
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
    full_name TEXT,
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
    expires_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER
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

  -- Threat Intel tables
  CREATE TABLE IF NOT EXISTS threat_feeds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    feed_type TEXT NOT NULL CHECK(feed_type IN ('rss','website','api','onion')),
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    fetch_interval INTEGER NOT NULL DEFAULT 3600,
    last_fetched_at INTEGER,
    last_content_hash TEXT,
    feed_metadata TEXT DEFAULT '{}',
    last_error TEXT,
    last_error_at INTEGER,
    consecutive_failures INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_threat_feeds_type ON threat_feeds(feed_type);
  CREATE INDEX IF NOT EXISTS idx_threat_feeds_enabled ON threat_feeds(enabled);

  CREATE TABLE IF NOT EXISTS threat_keywords (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    is_regex INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    criticality TEXT NOT NULL DEFAULT 'medium' CHECK(criticality IN ('low','medium','high','critical')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_threat_keywords_enabled ON threat_keywords(enabled);

  CREATE TABLE IF NOT EXISTS threat_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#E53935',
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS threat_alerts (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    matched_content TEXT NOT NULL,
    context TEXT,
    context_hash TEXT,
    article_hash TEXT,
    matched_keywords TEXT DEFAULT '[]',
    api_metadata TEXT DEFAULT '{}',
    criticality TEXT NOT NULL DEFAULT 'medium' CHECK(criticality IN ('low','medium','high','critical')),
    is_read INTEGER NOT NULL DEFAULT 0,
    triggered_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_threat_alerts_feed ON threat_alerts(feed_id);
  CREATE INDEX IF NOT EXISTS idx_threat_alerts_criticality ON threat_alerts(criticality);
  CREATE INDEX IF NOT EXISTS idx_threat_alerts_created ON threat_alerts(triggered_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threat_alerts_read ON threat_alerts(is_read);

  CREATE TABLE IF NOT EXISTS threat_articles (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL,
    article_hash TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    article_url TEXT,
    image_url TEXT,
    api_metadata TEXT DEFAULT '{}',
    published_at INTEGER,
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(feed_id, article_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_threat_articles_feed ON threat_articles(feed_id);
  CREATE INDEX IF NOT EXISTS idx_threat_articles_published ON threat_articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threat_articles_last_seen ON threat_articles(last_seen_at DESC);

  CREATE TABLE IF NOT EXISTS threat_api_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    configuration TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS threat_notification_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK(channel_type IN ('webhook','email','discord')),
    destination TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS threat_user_notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel_type TEXT NOT NULL CHECK(channel_type IN ('webhook','email','discord')),
    destination TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, channel_type)
  );
  CREATE INDEX IF NOT EXISTS idx_threat_user_notif_user ON threat_user_notifications(user_id);

  CREATE TABLE IF NOT EXISTS threat_suppressed_alerts (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL,
    article_hash TEXT,
    context_hash TEXT,
    keyword_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_threat_suppressed_feed ON threat_suppressed_alerts(feed_id);
  CREATE INDEX IF NOT EXISTS idx_threat_suppressed_hash ON threat_suppressed_alerts(article_hash);

  CREATE TABLE IF NOT EXISTS threat_feed_keywords (
    feed_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    PRIMARY KEY (feed_id, keyword_id)
  );
  CREATE TABLE IF NOT EXISTS threat_feed_tags (
    feed_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (feed_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS threat_keyword_tags (
    keyword_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (keyword_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS threat_alert_tags (
    alert_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (alert_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS threat_user_keyword_tags (
    user_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, keyword_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS threat_user_alert_keywords (
    user_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    matched_text TEXT,
    criticality TEXT NOT NULL DEFAULT 'medium' CHECK(criticality IN ('low','medium','high','critical')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, alert_id, keyword_id)
  );
  CREATE INDEX IF NOT EXISTS idx_threat_user_alert_keywords_user_alert ON threat_user_alert_keywords(user_id, alert_id);
  CREATE INDEX IF NOT EXISTS idx_threat_user_alert_keywords_alert ON threat_user_alert_keywords(alert_id);

  CREATE TABLE IF NOT EXISTS threat_user_alert_state (
    user_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, alert_id)
  );
  CREATE INDEX IF NOT EXISTS idx_threat_user_alert_state_user_read ON threat_user_alert_state(user_id, is_read);

  CREATE TABLE IF NOT EXISTS threat_user_alert_tags (
    user_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, alert_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS threat_user_hidden_alerts (
    user_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, alert_id)
  );
`);
}

module.exports = {
  initializeBaseSchema,
};
