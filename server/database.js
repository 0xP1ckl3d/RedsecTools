const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { SYSTEM_ROLE_DEFINITIONS, normalizePermissionList } = require("./access");
const { redactObject } = require("./core/logger");
const {
  openDatabase,
  DB_PATH,
  FILES_DIR,
  TMP_DIR,
  AVATARS_DIR,
  BULLETIN_ASSETS_DIR,
  BRAND_DIR,
} = require("./core/db/connection");
const { runMigrations } = require("./core/db/migrations");
const { initializeBaseSchema } = require("./core/db/schema");
const { runLegacyCompatibilityPatches } = require("./core/db/compatibility");
const { featureFlagDefaults } = require("./core/config/feature-flags");
const { createPasteRepository } = require("./modules/paste/paste.repo");

const db = openDatabase();

initializeBaseSchema(db);

runMigrations(db);

runLegacyCompatibilityPatches(db);

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
const pasteRepo = createPasteRepository(db, { validExpiryOptions: VALID_EXPIRY_OPTIONS });

const stmts = {
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
  updateUserProfile: db.prepare("UPDATE users SET full_name = @fullName, updated_at = unixepoch() WHERE id = @id"),
  updateUserRole: db.prepare("UPDATE users SET role_id = ?, updated_at = unixepoch() WHERE id = ?"),
  suspendUser: db.prepare("UPDATE users SET suspended = 1, updated_at = unixepoch() WHERE id = ?"),
  unsuspendUser: db.prepare("UPDATE users SET suspended = 0, updated_at = unixepoch() WHERE id = ?"),
  deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
  listUsers: db.prepare(`
    SELECT u.id, u.email, u.username, u.full_name, u.suspended, u.created_at, u.updated_at, u.role_id, r.role_key, r.name as role_name
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
  listUsersByPermission: db.prepare(`
    SELECT u.id, u.username FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
    WHERE rp.permission = ? AND u.suspended IS NULL
  `),

  // --- Session statements ---
  createSession: db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent)
    VALUES (@id, @userId, @expiresAt, @ipAddress, @userAgent)
  `),
  getSessionById: db.prepare(`
    SELECT s.*, u.username, u.email, u.full_name, u.suspended, u.avatar_updated_at, u.role_id, r.role_key, r.name as role_name
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
    SELECT s.*, u.username, u.email, u.full_name, u.suspended, u.avatar_updated_at, u.role_id, r.role_key, r.name as role_name
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
      starts_at, ends_at, all_day, scheduled_hours, utilization_percent, status, group_id
    ) VALUES (
      @id, @type, @title, @description, @ownerId, @assigneeUserId, @projectId,
      @startsAt, @endsAt, @allDay, @scheduledHours, @utilizationPercent, @status, @groupId
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
      group_id = @groupId,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteCalendarEntry: db.prepare("DELETE FROM calendar_entries WHERE id = ?"),
  listCalendarEntriesByGroup: db.prepare("SELECT * FROM calendar_entries WHERE group_id = ? ORDER BY starts_at ASC"),
  deleteCalendarEntriesByGroup: db.prepare("DELETE FROM calendar_entries WHERE group_id = ?"),
  countCalendarEntriesByGroup: db.prepare("SELECT COUNT(*) as total FROM calendar_entries WHERE group_id = ?"),
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
  reorderWikiPage: db.prepare("UPDATE wiki_pages SET parent_page_id = @parentPageId, sort_order = @sortOrder, updated_at = unixepoch() WHERE id = @id"),
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

  // --- Threat Intel: Feeds ---
  createThreatFeed: db.prepare(`
    INSERT INTO threat_feeds (id, name, url, feed_type, enabled, is_default, fetch_interval, feed_metadata)
    VALUES (@id, @name, @url, @feedType, @enabled, @isDefault, @fetchInterval, @feedMetadata)
  `),
  listThreatFeeds: db.prepare("SELECT * FROM threat_feeds ORDER BY name ASC"),
  listThreatFeedsEnabled: db.prepare("SELECT * FROM threat_feeds WHERE enabled = 1 ORDER BY name ASC"),
  getThreatFeedById: db.prepare("SELECT * FROM threat_feeds WHERE id = ?"),
  updateThreatFeed: db.prepare(`
    UPDATE threat_feeds SET name = @name, url = @url, feed_type = @feedType, enabled = @enabled,
      is_default = @isDefault, fetch_interval = @fetchInterval, feed_metadata = @feedMetadata,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteThreatFeedById: db.prepare("DELETE FROM threat_feeds WHERE id = ?"),
  updateThreatFeedFetchStatus: db.prepare(`
    UPDATE threat_feeds SET last_fetched_at = unixepoch(), last_content_hash = @hash,
      last_error = @error, last_error_at = @errorAt, consecutive_failures = @failures,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  countThreatFeeds: db.prepare("SELECT COUNT(*) AS total FROM threat_feeds"),
  countThreatFeedsEnabled: db.prepare("SELECT COUNT(*) AS total FROM threat_feeds WHERE enabled = 1"),
  countThreatFeedsHealthy: db.prepare("SELECT COUNT(*) AS total FROM threat_feeds WHERE enabled = 1 AND consecutive_failures = 0"),

  // --- Threat Intel: Feed-Keyword M2M ---
  setThreatFeedKeywords: db.prepare(`
    DELETE FROM threat_feed_keywords WHERE feed_id = ?
  `),
  insertThreatFeedKeyword: db.prepare(`
    INSERT OR IGNORE INTO threat_feed_keywords (feed_id, keyword_id) VALUES (?, ?)
  `),
  getThreatFeedKeywords: db.prepare(`
    SELECT k.* FROM threat_keywords k
    JOIN threat_feed_keywords fk ON k.id = fk.keyword_id
    WHERE fk.feed_id = ?
  `),
  getThreatFeedsForKeyword: db.prepare(`
    SELECT f.* FROM threat_feeds f
    JOIN threat_feed_keywords fk ON f.id = fk.feed_id
    WHERE fk.keyword_id = ?
  `),

  // --- Threat Intel: Feed-Tag M2M ---
  setThreatFeedTags: db.prepare("DELETE FROM threat_feed_tags WHERE feed_id = ?"),
  insertThreatFeedTag: db.prepare("INSERT OR IGNORE INTO threat_feed_tags (feed_id, tag_id) VALUES (?, ?)"),
  getThreatFeedTags: db.prepare(`
    SELECT t.* FROM threat_tags t
    JOIN threat_feed_tags ft ON t.id = ft.tag_id
    WHERE ft.feed_id = ?
  `),

  // --- Threat Intel: Keywords ---
  createThreatKeyword: db.prepare(`
    INSERT INTO threat_keywords (id, keyword, case_sensitive, is_regex, enabled, criticality, user_id)
    VALUES (@id, @keyword, @caseSensitive, @isRegex, @enabled, @criticality, @userId)
  `),
  listThreatKeywords: db.prepare("SELECT * FROM threat_keywords ORDER BY keyword ASC"),
  listThreatKeywordsEnabled: db.prepare("SELECT * FROM threat_keywords WHERE enabled = 1 ORDER BY keyword ASC"),
  listThreatKeywordsByUser: db.prepare("SELECT * FROM threat_keywords WHERE user_id = ? ORDER BY keyword ASC"),
  listSystemKeywords: db.prepare("SELECT * FROM threat_keywords WHERE user_id IS NULL ORDER BY keyword ASC"),
  listSystemKeywordsEnabled: db.prepare("SELECT * FROM threat_keywords WHERE user_id IS NULL AND enabled = 1 ORDER BY keyword ASC"),
  getThreatKeywordByTextSystem: db.prepare("SELECT * FROM threat_keywords WHERE user_id IS NULL AND keyword = ?"),
  getThreatKeywordByTextForUser: db.prepare("SELECT * FROM threat_keywords WHERE user_id = ? AND keyword = ?"),
  getThreatKeywordById: db.prepare("SELECT * FROM threat_keywords WHERE id = ?"),
  getThreatKeywordByText: db.prepare("SELECT * FROM threat_keywords WHERE keyword = ?"),
  updateThreatKeyword: db.prepare(`
    UPDATE threat_keywords SET keyword = @keyword, case_sensitive = @caseSensitive,
      is_regex = @isRegex, enabled = @enabled, criticality = @criticality, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteThreatKeywordById: db.prepare("DELETE FROM threat_keywords WHERE id = ?"),
  countThreatKeywords: db.prepare("SELECT COUNT(*) AS total FROM threat_keywords"),
  countThreatKeywordsEnabled: db.prepare("SELECT COUNT(*) AS total FROM threat_keywords WHERE enabled = 1"),

  // --- Threat Intel: Keyword-Tag M2M ---
  setThreatKeywordTags: db.prepare("DELETE FROM threat_keyword_tags WHERE keyword_id = ?"),
  insertThreatKeywordTag: db.prepare("INSERT OR IGNORE INTO threat_keyword_tags (keyword_id, tag_id) VALUES (?, ?)"),
  getThreatKeywordTags: db.prepare(`
    SELECT t.* FROM threat_tags t
    JOIN threat_keyword_tags kt ON t.id = kt.tag_id
    WHERE kt.keyword_id = ?
  `),

  // --- Threat Intel: Tags ---
  createThreatTag: db.prepare(`
    INSERT INTO threat_tags (id, name, color, description, user_id) VALUES (@id, @name, @color, @description, @userId)
  `),
  listThreatTags: db.prepare("SELECT * FROM threat_tags ORDER BY name ASC"),
  listThreatTagsByUser: db.prepare("SELECT * FROM threat_tags WHERE user_id = ? ORDER BY name ASC"),
  listSystemTags: db.prepare("SELECT * FROM threat_tags WHERE user_id IS NULL ORDER BY name ASC"),
  getThreatTagById: db.prepare("SELECT * FROM threat_tags WHERE id = ?"),
  getThreatTagByName: db.prepare("SELECT * FROM threat_tags WHERE name = ?"),
  getThreatTagByNameSystem: db.prepare("SELECT * FROM threat_tags WHERE user_id IS NULL AND name = ?"),
  getThreatTagByNameForUser: db.prepare("SELECT * FROM threat_tags WHERE user_id = ? AND name = ?"),
  updateThreatTag: db.prepare(`
    UPDATE threat_tags SET name = @name, color = @color, description = @description WHERE id = @id
  `),
  deleteThreatTagById: db.prepare("DELETE FROM threat_tags WHERE id = ?"),

  // --- Threat Intel: Alerts ---
  createThreatAlert: db.prepare(`
    INSERT INTO threat_alerts (id, feed_id, keyword_id, matched_content, context, context_hash,
      article_hash, article_url, user_id, matched_keywords, api_metadata, criticality, is_read, triggered_at)
    VALUES (@id, @feedId, @keywordId, @matchedContent, @context, @contextHash,
      @articleHash, @articleUrl, @userId, @matchedKeywords, @apiMetadata, @criticality, @isRead, @triggeredAt)
  `),
  listThreatAlerts: db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    WHERE 1=1
    ORDER BY a.triggered_at DESC
    LIMIT ? OFFSET ?
  `),
  listThreatAlertsByCriticality: db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    WHERE a.criticality = ?
    ORDER BY a.triggered_at DESC
    LIMIT ? OFFSET ?
  `),
  listThreatAlertsUnread: db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    WHERE a.is_read = 0
    ORDER BY a.triggered_at DESC
    LIMIT ? OFFSET ?
  `),
  getThreatAlertById: db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    WHERE a.id = ?
  `),
  updateThreatAlertRead: db.prepare("UPDATE threat_alerts SET is_read = @isRead WHERE id = @id"),
  markAllThreatAlertsRead: db.prepare("UPDATE threat_alerts SET is_read = 1 WHERE is_read = 0"),
  updateThreatAlertCriticality: db.prepare("UPDATE threat_alerts SET criticality = @criticality WHERE id = @id"),
  deleteThreatAlertById: db.prepare("DELETE FROM threat_alerts WHERE id = ?"),
  cleanupOldThreatAlerts: db.prepare(`
    DELETE FROM threat_alerts WHERE triggered_at < unixepoch() - ? * 86400
  `),
  countThreatAlerts: db.prepare("SELECT COUNT(*) AS total FROM threat_alerts"),
  countThreatAlertsUnread: db.prepare("SELECT COUNT(*) AS total FROM threat_alerts WHERE is_read = 0"),
  countThreatAlertsByCriticality: db.prepare(`
    SELECT criticality, COUNT(*) AS count FROM threat_alerts GROUP BY criticality
  `),
  countThreatAlertsLast24h: db.prepare("SELECT COUNT(*) AS total FROM threat_alerts WHERE triggered_at > unixepoch() - 86400"),
  createThreatArticle: db.prepare(`
    INSERT INTO threat_articles (
      id, feed_id, article_hash, headline, summary, content, article_url, image_url,
      api_metadata, published_at, last_seen_at
    ) VALUES (
      @id, @feedId, @articleHash, @headline, @summary, @content, @articleUrl, @imageUrl,
      @apiMetadata, @publishedAt, unixepoch()
    )
  `),
  updateThreatArticle: db.prepare(`
    UPDATE threat_articles
    SET headline = @headline,
        summary = @summary,
        content = @content,
        article_url = @articleUrl,
        image_url = @imageUrl,
        api_metadata = @apiMetadata,
        published_at = @publishedAt,
        last_seen_at = unixepoch(),
        updated_at = unixepoch()
    WHERE id = @id
  `),
  getThreatArticleByHash: db.prepare(`
    SELECT ta.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url
    FROM threat_articles ta
    LEFT JOIN threat_feeds f ON ta.feed_id = f.id
    WHERE ta.feed_id = ? AND ta.article_hash = ?
  `),
  getThreatArticleById: db.prepare(`
    SELECT ta.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url
    FROM threat_articles ta
    LEFT JOIN threat_feeds f ON ta.feed_id = f.id
    WHERE ta.id = ?
  `),
  listThreatArticles: db.prepare(`
    SELECT ta.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url
    FROM threat_articles ta
    LEFT JOIN threat_feeds f ON ta.feed_id = f.id
    WHERE (? IS NULL OR COALESCE(ta.published_at, ta.created_at) > unixepoch() - ? * 3600)
    ORDER BY COALESCE(ta.published_at, ta.created_at) DESC, ta.updated_at DESC
    LIMIT ? OFFSET ?
  `),
  cleanupOldThreatArticles: db.prepare(`
    DELETE FROM threat_articles
    WHERE COALESCE(published_at, created_at) < unixepoch() - ? * 86400
  `),
  listRecentThreatAlerts: db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    ORDER BY a.triggered_at DESC LIMIT ?
  `),
  alertExistsByArticleHash: db.prepare("SELECT id FROM threat_alerts WHERE feed_id = ? AND article_hash = ?"),
  alertExistsByContextHash: db.prepare("SELECT id FROM threat_alerts WHERE feed_id = ? AND keyword_id = ? AND context_hash = ?"),
  alertExistsByFeedKeyword: db.prepare("SELECT id FROM threat_alerts WHERE feed_id = ? AND keyword_id = ?"),

  // --- Threat Intel: Alert-Tag M2M ---
  setThreatAlertTags: db.prepare("DELETE FROM threat_alert_tags WHERE alert_id = ?"),
  insertThreatAlertTag: db.prepare("INSERT OR IGNORE INTO threat_alert_tags (alert_id, tag_id) VALUES (?, ?)"),
  getThreatAlertTags: db.prepare(`
    SELECT t.* FROM threat_tags t
    JOIN threat_alert_tags at2 ON t.id = at2.tag_id
    WHERE at2.alert_id = ?
  `),

  // --- Threat Intel: User Keyword Tags ---
  setThreatUserKeywordTags: db.prepare("DELETE FROM threat_user_keyword_tags WHERE user_id = ? AND keyword_id = ?"),
  insertThreatUserKeywordTag: db.prepare("INSERT OR IGNORE INTO threat_user_keyword_tags (user_id, keyword_id, tag_id) VALUES (?, ?, ?)"),
  getThreatUserKeywordTags: db.prepare(`
    SELECT t.* FROM threat_tags t
    JOIN threat_user_keyword_tags ukt ON t.id = ukt.tag_id
    WHERE ukt.user_id = ? AND ukt.keyword_id = ?
    ORDER BY t.name ASC
  `),

  // --- Threat Intel: User Alert Keyword Matches ---
  upsertThreatUserAlertKeyword: db.prepare(`
    INSERT INTO threat_user_alert_keywords (user_id, alert_id, keyword_id, matched_text, criticality)
    VALUES (@userId, @alertId, @keywordId, @matchedText, @criticality)
    ON CONFLICT(user_id, alert_id, keyword_id) DO UPDATE SET
      matched_text = @matchedText,
      criticality = @criticality,
      updated_at = unixepoch()
  `),
  listThreatUserAlertKeywordRows: db.prepare(`
    SELECT uak.*, k.keyword, k.case_sensitive, k.is_regex, k.user_id AS keyword_user_id
    FROM threat_user_alert_keywords uak
    JOIN threat_keywords k ON k.id = uak.keyword_id
    WHERE uak.user_id = ? AND uak.alert_id = ?
    ORDER BY k.keyword ASC
  `),
  listThreatUserAlertKeywordRowsForAlert: db.prepare(`
    SELECT * FROM threat_user_alert_keywords WHERE alert_id = ?
  `),
  deleteThreatUserAlertKeywordRowsByAlert: db.prepare("DELETE FROM threat_user_alert_keywords WHERE alert_id = ?"),

  // --- Threat Intel: User Alert State ---
  upsertThreatUserAlertState: db.prepare(`
    INSERT INTO threat_user_alert_state (user_id, alert_id, is_read)
    VALUES (@userId, @alertId, @isRead)
    ON CONFLICT(user_id, alert_id) DO UPDATE SET
      is_read = @isRead,
      updated_at = unixepoch()
  `),
  getThreatUserAlertState: db.prepare("SELECT * FROM threat_user_alert_state WHERE user_id = ? AND alert_id = ?"),
  deleteThreatUserAlertStateByAlert: db.prepare("DELETE FROM threat_user_alert_state WHERE alert_id = ?"),

  // --- Threat Intel: User Alert Tags ---
  setThreatUserAlertTags: db.prepare("DELETE FROM threat_user_alert_tags WHERE user_id = ? AND alert_id = ?"),
  insertThreatUserAlertTag: db.prepare("INSERT OR IGNORE INTO threat_user_alert_tags (user_id, alert_id, tag_id) VALUES (?, ?, ?)"),
  getThreatUserAlertTags: db.prepare(`
    SELECT t.* FROM threat_tags t
    JOIN threat_user_alert_tags uat ON t.id = uat.tag_id
    WHERE uat.user_id = ? AND uat.alert_id = ?
    ORDER BY t.name ASC
  `),
  deleteThreatUserAlertTagsByAlert: db.prepare("DELETE FROM threat_user_alert_tags WHERE alert_id = ?"),

  // --- Threat Intel: User Hidden Alerts ---
  hideThreatAlertForUser: db.prepare("INSERT OR IGNORE INTO threat_user_hidden_alerts (user_id, alert_id) VALUES (?, ?)"),
  isThreatAlertHiddenForUser: db.prepare("SELECT alert_id FROM threat_user_hidden_alerts WHERE user_id = ? AND alert_id = ?"),
  deleteThreatHiddenAlertByAlert: db.prepare("DELETE FROM threat_user_hidden_alerts WHERE alert_id = ?"),

  // --- Threat Intel: Suppressed Alerts ---
  isThreatAlertSuppressed: db.prepare(`
    SELECT id FROM threat_suppressed_alerts
    WHERE feed_id = ? AND (article_hash = ? OR context_hash = ? OR (keyword_id = ? AND article_hash IS NULL AND context_hash IS NULL))
    LIMIT 1
  `),
  createThreatSuppressedAlert: db.prepare(`
    INSERT INTO threat_suppressed_alerts (id, feed_id, article_hash, context_hash, keyword_id)
    VALUES (@id, @feedId, @articleHash, @contextHash, @keywordId)
  `),

  // --- Threat Intel: API Templates ---
  createThreatApiTemplate: db.prepare(`
    INSERT INTO threat_api_templates (id, name, description, configuration, is_system, enabled)
    VALUES (@id, @name, @description, @configuration, @isSystem, @enabled)
  `),
  listThreatApiTemplates: db.prepare("SELECT * FROM threat_api_templates ORDER BY name ASC"),
  getThreatApiTemplateById: db.prepare("SELECT * FROM threat_api_templates WHERE id = ?"),
  getThreatApiTemplateByName: db.prepare("SELECT * FROM threat_api_templates WHERE name = ?"),
  updateThreatApiTemplate: db.prepare(`
    UPDATE threat_api_templates SET name = @name, description = @description,
      configuration = @configuration, enabled = @enabled, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteThreatApiTemplateById: db.prepare("DELETE FROM threat_api_templates WHERE id = ?"),

  // --- Threat Intel: Notification Configs ---
  createThreatNotificationConfig: db.prepare(`
    INSERT INTO threat_notification_configs (id, name, channel_type, destination, enabled)
    VALUES (@id, @name, @channelType, @destination, @enabled)
  `),
  listThreatNotificationConfigs: db.prepare("SELECT * FROM threat_notification_configs ORDER BY name ASC"),
  listThreatNotificationConfigsEnabled: db.prepare("SELECT * FROM threat_notification_configs WHERE enabled = 1"),
  getThreatNotificationConfigById: db.prepare("SELECT * FROM threat_notification_configs WHERE id = ?"),
  updateThreatNotificationConfig: db.prepare(`
    UPDATE threat_notification_configs SET name = @name, destination = @destination, enabled = @enabled
    WHERE id = @id
  `),
  deleteThreatNotificationConfigById: db.prepare("DELETE FROM threat_notification_configs WHERE id = ?"),

  // --- Threat Intel: User Notifications ---
  createThreatUserNotification: db.prepare(`
    INSERT INTO threat_user_notifications (id, user_id, channel_type, destination, enabled)
    VALUES (@id, @userId, @channelType, @destination, @enabled)
    ON CONFLICT(user_id, channel_type) DO UPDATE SET
      destination = @destination, enabled = @enabled, updated_at = unixepoch()
  `),
  listThreatUserNotifications: db.prepare("SELECT * FROM threat_user_notifications WHERE user_id = ?"),
  getThreatUserNotificationById: db.prepare("SELECT * FROM threat_user_notifications WHERE id = ? AND user_id = ?"),
  deleteThreatUserNotificationById: db.prepare("DELETE FROM threat_user_notifications WHERE id = ? AND user_id = ?"),

  // --- Threat Intel: Health ---
  getThreatFeedHealth: db.prepare(`
    SELECT
      SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) AS disabled,
      SUM(CASE WHEN enabled = 1 AND consecutive_failures = 0 THEN 1 ELSE 0 END) AS healthy,
      SUM(CASE WHEN enabled = 1 AND consecutive_failures BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS warning,
      SUM(CASE WHEN enabled = 1 AND consecutive_failures >= 3 THEN 1 ELSE 0 END) AS error,
      COUNT(*) AS total
    FROM threat_feeds
  `),
  getThreatFeedErrors: db.prepare(`
    SELECT id, name, feed_type, url, enabled, consecutive_failures,
      last_fetched_at, last_error, last_error_at
    FROM threat_feeds
    ORDER BY consecutive_failures DESC, last_error_at DESC
  `),

  // --- Threat Intel: Seed ---
  getThreatFeedByUrl: db.prepare("SELECT id FROM threat_feeds WHERE url = ?"),

  // --- Threat Intel: User Keyword Overrides ---
  disableSystemKeywordForUser: db.prepare("INSERT OR IGNORE INTO threat_user_keyword_disabled (user_id, keyword_id) VALUES (?, ?)"),
  enableSystemKeywordForUser: db.prepare("DELETE FROM threat_user_keyword_disabled WHERE user_id = ? AND keyword_id = ?"),
  isSystemKeywordDisabledForUser: db.prepare("SELECT keyword_id FROM threat_user_keyword_disabled WHERE user_id = ? AND keyword_id = ?"),
  getDisabledKeywordIdsForUser: db.prepare("SELECT keyword_id FROM threat_user_keyword_disabled WHERE user_id = ?"),

  listThreatEligibleUsers: db.prepare(`
    SELECT id, email, username, suspended, role_id
    FROM users
    WHERE suspended = 0
    ORDER BY created_at ASC
  `),

  createAuditEvent: db.prepare(`
    INSERT INTO audit_events (
      id, actor_user_id, actor_username, actor_type, ip_address, user_agent,
      category, action, target_type, target_id, outcome, metadata_json
    ) VALUES (
      @id, @actorUserId, @actorUsername, @actorType, @ipAddress, @userAgent,
      @category, @action, @targetType, @targetId, @outcome, @metadataJson
    )
  `),
  listAuditEvents: db.prepare(`
    SELECT * FROM audit_events
    WHERE (@actorUserId IS NULL OR actor_user_id = @actorUserId)
      AND (@category IS NULL OR category = @category)
      AND (@action IS NULL OR action = @action)
      AND (@outcome IS NULL OR outcome = @outcome)
      AND (@targetType IS NULL OR target_type = @targetType)
      AND (@targetId IS NULL OR target_id = @targetId)
      AND (@fromTs IS NULL OR created_at >= @fromTs)
      AND (@toTs IS NULL OR created_at <= @toTs)
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `),
  countAuditEventsFiltered: db.prepare(`
    SELECT COUNT(*) AS total FROM audit_events
    WHERE (@actorUserId IS NULL OR actor_user_id = @actorUserId)
      AND (@category IS NULL OR category = @category)
      AND (@action IS NULL OR action = @action)
      AND (@outcome IS NULL OR outcome = @outcome)
      AND (@targetType IS NULL OR target_type = @targetType)
      AND (@targetId IS NULL OR target_id = @targetId)
      AND (@fromTs IS NULL OR created_at >= @fromTs)
      AND (@toTs IS NULL OR created_at <= @toTs)
  `),
  listSchemaMigrations: db.prepare("SELECT * FROM schema_migrations ORDER BY id ASC"),
  createServiceAccount: db.prepare(`
    INSERT INTO service_accounts (id, name, description, scopes_json, enabled, created_by)
    VALUES (@id, @name, @description, @scopesJson, @enabled, @createdBy)
  `),
  updateServiceAccount: db.prepare(`
    UPDATE service_accounts
    SET name = @name, description = @description, scopes_json = @scopesJson, enabled = @enabled, updated_at = unixepoch()
    WHERE id = @id
  `),
  getServiceAccountById: db.prepare("SELECT * FROM service_accounts WHERE id = ?"),
  listServiceAccounts: db.prepare("SELECT * FROM service_accounts ORDER BY created_at DESC"),
  deleteServiceAccountTokens: db.prepare("UPDATE service_account_tokens SET revoked_at = unixepoch() WHERE service_account_id = ? AND revoked_at IS NULL"),
  createServiceAccountToken: db.prepare(`
    INSERT INTO service_account_tokens (id, service_account_id, token_hash, label, prefix, expires_at, created_by)
    VALUES (@id, @serviceAccountId, @tokenHash, @label, @prefix, @expiresAt, @createdBy)
  `),
  getServiceAccountTokenByHash: db.prepare(`
    SELECT t.*, a.name, a.scopes_json, a.enabled AS account_enabled
    FROM service_account_tokens t
    JOIN service_accounts a ON a.id = t.service_account_id
    WHERE t.token_hash = ?
  `),
  listServiceAccountTokens: db.prepare(`
    SELECT id, service_account_id, label, prefix, expires_at, revoked_at, last_used_at, created_by, created_at
    FROM service_account_tokens
    WHERE service_account_id = ?
    ORDER BY created_at DESC
  `),
  revokeServiceAccountToken: db.prepare("UPDATE service_account_tokens SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL"),
  touchServiceAccountToken: db.prepare("UPDATE service_account_tokens SET last_used_at = unixepoch() WHERE id = ?"),
  createPlatformWebhook: db.prepare(`
    INSERT INTO platform_webhooks (id, name, url, secret_encrypted, events_json, enabled, created_by)
    VALUES (@id, @name, @url, @secretEncrypted, @eventsJson, @enabled, @createdBy)
  `),
  updatePlatformWebhook: db.prepare(`
    UPDATE platform_webhooks
    SET name = @name, url = @url, secret_encrypted = @secretEncrypted, events_json = @eventsJson,
        enabled = @enabled, updated_at = unixepoch()
    WHERE id = @id
  `),
  getPlatformWebhookById: db.prepare("SELECT * FROM platform_webhooks WHERE id = ?"),
  listPlatformWebhooks: db.prepare("SELECT * FROM platform_webhooks ORDER BY created_at DESC"),
  listPlatformWebhooksForEvent: db.prepare(`
    SELECT * FROM platform_webhooks
    WHERE enabled = 1
      AND (events_json = '["*"]' OR events_json LIKE ?)
  `),
  deletePlatformWebhook: db.prepare("DELETE FROM platform_webhooks WHERE id = ?"),
  createPlatformWebhookDelivery: db.prepare(`
    INSERT INTO platform_webhook_deliveries (
      id, webhook_id, event_type, payload_json, status, attempt_count, next_attempt_at
    ) VALUES (
      @id, @webhookId, @eventType, @payloadJson, @status, @attemptCount, @nextAttemptAt
    )
  `),
  listPendingPlatformWebhookDeliveries: db.prepare(`
    SELECT d.*, w.url, w.secret_encrypted, w.enabled
    FROM platform_webhook_deliveries d
    JOIN platform_webhooks w ON w.id = d.webhook_id
    WHERE d.status IN ('pending', 'retrying') AND d.next_attempt_at <= unixepoch() AND w.enabled = 1
    ORDER BY d.created_at ASC
    LIMIT ?
  `),
  listPlatformWebhookDeliveries: db.prepare(`
    SELECT * FROM platform_webhook_deliveries
    WHERE webhook_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),
  updatePlatformWebhookDelivery: db.prepare(`
    UPDATE platform_webhook_deliveries
    SET status = @status, attempt_count = @attemptCount, next_attempt_at = @nextAttemptAt,
        last_attempt_at = @lastAttemptAt, response_status = @responseStatus,
        response_body = @responseBody, error = @error, updated_at = unixepoch()
    WHERE id = @id
  `),
  upsertLeakRadarUnlockedRecord: db.prepare(`
    INSERT INTO leakradar_unlocked_records (leak_id, domains_json, payload_encrypted, unlocked_by)
    VALUES (@leakId, @domainsJson, @payloadEncrypted, @unlockedBy)
    ON CONFLICT(leak_id) DO UPDATE SET
      domains_json = @domainsJson,
      payload_encrypted = @payloadEncrypted,
      unlocked_by = COALESCE(@unlockedBy, leakradar_unlocked_records.unlocked_by),
      last_seen_at = unixepoch()
  `),
  getLeakRadarUnlockedRecordById: db.prepare("SELECT * FROM leakradar_unlocked_records WHERE leak_id = ?"),

  // --- Reporter: Designs ---
  createReporterDesign: db.prepare(`
    INSERT INTO reporter_designs (id, name, description, report_type, html_template, css_template, field_definitions, section_definitions, finding_field_definitions, finding_ordering_rule, finding_grouping_rule, sort_order, created_by)
    VALUES (@id, @name, @description, @reportType, @htmlTemplate, @cssTemplate, @fieldDefinitions, @sectionDefinitions, @findingFieldDefinitions, @findingOrderingRule, @findingGroupingRule, @sortOrder, @createdBy)
  `),
  getReporterDesignById: db.prepare("SELECT * FROM reporter_designs WHERE id = ?"),
  listReporterDesigns: db.prepare("SELECT * FROM reporter_designs ORDER BY sort_order ASC, created_at DESC"),
  updateReporterDesign: db.prepare(`
    UPDATE reporter_designs SET
      name = @name, description = @description, report_type = @reportType,
      html_template = @htmlTemplate, css_template = @cssTemplate,
      field_definitions = @fieldDefinitions, section_definitions = @sectionDefinitions,
      finding_field_definitions = @findingFieldDefinitions, finding_ordering_rule = @findingOrderingRule,
      finding_grouping_rule = @findingGroupingRule, sort_order = @sortOrder,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterDesignById: db.prepare("DELETE FROM reporter_designs WHERE id = ? AND is_builtin = 0"),

  // --- Reporter: Projects ---
  createReporterProject: db.prepare(`
    INSERT INTO reporter_projects (id, design_id, title, report_type, status, client_name, project_metadata, due_date, source_project_id, created_by, project_type, test_types)
    VALUES (@id, @designId, @title, @reportType, @status, @clientName, @projectMetadata, @dueDate, @sourceProjectId, @createdBy, @projectType, @testTypes)
  `),
  getReporterProjectById: db.prepare(`
    SELECT rp.*, d.name AS design_name, creator.username AS creator_username
    FROM reporter_projects rp
    LEFT JOIN reporter_designs d ON d.id = rp.design_id
    LEFT JOIN users creator ON creator.id = rp.created_by
    WHERE rp.id = ?
  `),
  listReporterProjects: db.prepare(`
    SELECT rp.*, d.name AS design_name, creator.username AS creator_username
    FROM reporter_projects rp
    LEFT JOIN reporter_designs d ON d.id = rp.design_id
    LEFT JOIN users creator ON creator.id = rp.created_by
    ORDER BY rp.updated_at DESC
  `),
  listReporterProjectsForUser: db.prepare(`
    SELECT rp.*, d.name AS design_name, creator.username AS creator_username
    FROM reporter_projects rp
    LEFT JOIN reporter_designs d ON d.id = rp.design_id
    LEFT JOIN users creator ON creator.id = rp.created_by
    INNER JOIN reporter_project_members rpm ON rpm.project_id = rp.id
    WHERE rpm.user_id = ?
    GROUP BY rp.id
    ORDER BY rp.updated_at DESC
  `),
  updateReporterProject: db.prepare(`
    UPDATE reporter_projects SET
      title = @title, client_name = @clientName, project_metadata = @projectMetadata,
      due_date = @dueDate, tags = @tags, override_finding_order = @overrideFindingOrder,
      test_types = @testTypes, updated_at = unixepoch()
    WHERE id = @id
  `),
  updateReporterProjectStatus: db.prepare(`
    UPDATE reporter_projects SET status = @status, version = version + 1, updated_at = unixepoch() WHERE id = @id
  `),
  archiveReporterProject: db.prepare(`
    UPDATE reporter_projects SET is_archived = @isArchived, updated_at = unixepoch() WHERE id = @id
  `),
  setReporterProjectReadonly: db.prepare(`
    UPDATE reporter_projects SET readonly = @readonly, readonly_since = @readonlySince, updated_at = unixepoch() WHERE id = @id
  `),
  deleteReporterProjectById: db.prepare("DELETE FROM reporter_projects WHERE id = ?"),

  // --- Reporter: Project Members ---
  addReporterProjectMember: db.prepare(`
    INSERT OR IGNORE INTO reporter_project_members (project_id, user_id, role) VALUES (@projectId, @userId, @role)
  `),
  listReporterProjectMembers: db.prepare(`
    SELECT rpm.*, u.username FROM reporter_project_members rpm
    LEFT JOIN users u ON u.id = rpm.user_id
    WHERE rpm.project_id = ?
    ORDER BY rpm.joined_at ASC
  `),
  updateReporterProjectMemberRole: db.prepare(`
    UPDATE reporter_project_members SET role = @role WHERE project_id = @projectId AND user_id = @userId
  `),
  removeReporterProjectMember: db.prepare("DELETE FROM reporter_project_members WHERE project_id = ? AND user_id = ?"),
  isReporterProjectMember: db.prepare("SELECT 1 FROM reporter_project_members WHERE project_id = ? AND user_id = ?"),

  // --- Reporter: Findings ---
  createReporterFinding: db.prepare(`
    INSERT INTO reporter_findings (id, project_id, template_id, title, category, severity, cvss_vector, cvss_score, status, order_index, created_by)
    VALUES (@id, @projectId, @templateId, @title, @category, @severity, @cvssVector, @cvssScore, @status, @orderIndex, @createdBy)
  `),
  getReporterFindingById: db.prepare(`
    SELECT rf.*, u.username AS creator_username, upd.username AS updater_username, a.username AS assignee_username
    FROM reporter_findings rf
    LEFT JOIN users u ON u.id = rf.created_by
    LEFT JOIN users upd ON upd.id = rf.updated_by
    LEFT JOIN users a ON a.id = rf.assignee_id
    WHERE rf.id = ?
  `),
  listReporterFindingsByProject: db.prepare(`
    SELECT rf.*, u.username AS creator_username, a.username AS assignee_username
    FROM reporter_findings rf
    LEFT JOIN users u ON u.id = rf.created_by
    LEFT JOIN users a ON a.id = rf.assignee_id
    WHERE rf.project_id = ?
    ORDER BY rf.order_index ASC, rf.created_at ASC
  `),
  updateReporterFinding: db.prepare(`
    UPDATE reporter_findings SET
      title = @title, category = @category, severity = @severity,
      cvss_vector = @cvssVector, cvss_score = @cvssScore, status = @status,
      is_included = @isIncluded, assignee_id = @assigneeId, updated_by = @updatedBy, updated_at = unixepoch()
    WHERE id = @id
  `),
  updateReporterFindingStatus: db.prepare(`
    UPDATE reporter_findings SET status = @status, updated_by = @updatedBy, updated_at = unixepoch() WHERE id = @id
  `),
  deleteReporterFindingById: db.prepare("DELETE FROM reporter_findings WHERE id = ?"),
  reorderReporterFindings: db.prepare(`
    UPDATE reporter_findings SET order_index = @orderIndex WHERE id = @id
  `),
  countReporterFindingsByProject: db.prepare("SELECT COUNT(*) AS total FROM reporter_findings WHERE project_id = ?"),
  countReporterFindingsBySeverity: db.prepare(`
    SELECT severity, COUNT(*) AS total FROM reporter_findings WHERE project_id = ? GROUP BY severity
  `),

  // --- Reporter: Finding Fields ---
  setReporterFindingField: db.prepare(`
    INSERT INTO reporter_finding_fields (id, finding_id, field_name, field_value)
    VALUES (@id, @findingId, @fieldName, @fieldValue)
    ON CONFLICT(finding_id, field_name) DO UPDATE SET field_value = @fieldValue, updated_at = unixepoch()
  `),
  getReporterFindingFields: db.prepare("SELECT * FROM reporter_finding_fields WHERE finding_id = ?"),
  deleteReporterFindingFields: db.prepare("DELETE FROM reporter_finding_fields WHERE finding_id = ?"),

  // --- Reporter: Sections ---
  createReporterSection: db.prepare(`
    INSERT INTO reporter_sections (id, project_id, title, section_type, content, order_index, created_by)
    VALUES (@id, @projectId, @title, @sectionType, @content, @orderIndex, @createdBy)
  `),
  getReporterSectionById: db.prepare(`
    SELECT rs.*, u.username AS creator_username, upd.username AS updater_username
    FROM reporter_sections rs
    LEFT JOIN users u ON u.id = rs.created_by
    LEFT JOIN users upd ON upd.id = rs.updated_by
    WHERE rs.id = ?
  `),
  listReporterSectionsByProject: db.prepare(`
    SELECT rs.*, u.username AS creator_username
    FROM reporter_sections rs
    LEFT JOIN users u ON u.id = rs.created_by
    WHERE rs.project_id = ?
    ORDER BY rs.order_index ASC, rs.created_at ASC
  `),
  updateReporterSection: db.prepare(`
    UPDATE reporter_sections SET
      title = @title, content = @content, is_included = @isIncluded,
      updated_by = @updatedBy, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterSectionById: db.prepare("DELETE FROM reporter_sections WHERE id = ?"),
  reorderReporterSections: db.prepare(`
    UPDATE reporter_sections SET order_index = @orderIndex WHERE id = @id
  `),
  countReporterSectionsByProject: db.prepare("SELECT COUNT(*) AS total FROM reporter_sections WHERE project_id = ?"),

  // --- Reporter: Finding Templates ---
  createReporterFindingTemplate: db.prepare(`
    INSERT INTO reporter_finding_templates (id, title, category, severity, cvss_vector, tags, created_by)
    VALUES (@id, @title, @category, @severity, @cvssVector, @tags, @createdBy)
  `),
  getReporterFindingTemplateById: db.prepare("SELECT * FROM reporter_finding_templates WHERE id = ?"),
  listReporterFindingTemplates: db.prepare(`
    SELECT * FROM reporter_finding_templates ORDER BY usage_count DESC, title ASC
  `),
  updateReporterFindingTemplate: db.prepare(`
    UPDATE reporter_finding_templates SET
      title = @title, category = @category, severity = @severity,
      cvss_vector = @cvssVector, tags = @tags, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterFindingTemplateById: db.prepare("DELETE FROM reporter_finding_templates WHERE id = ? AND is_builtin = 0"),
  incrementReporterTemplateUsage: db.prepare(`
    UPDATE reporter_finding_templates SET usage_count = usage_count + 1 WHERE id = ?
  `),

  // --- Reporter: Template Fields ---
  setReporterTemplateField: db.prepare(`
    INSERT INTO reporter_template_fields (id, template_id, field_name, field_value, language)
    VALUES (@id, @templateId, @fieldName, @fieldValue, @language)
    ON CONFLICT(template_id, field_name, language) DO UPDATE SET field_value = @fieldValue, updated_at = unixepoch()
  `),
  getReporterTemplateFields: db.prepare("SELECT * FROM reporter_template_fields WHERE template_id = ?"),
  deleteReporterTemplateFields: db.prepare("DELETE FROM reporter_template_fields WHERE template_id = ?"),

  // --- Reporter: Stats ---
  countReporterProjects: db.prepare("SELECT COUNT(*) AS total FROM reporter_projects WHERE is_archived = 0 AND status != 'archived'"),
  countReporterArchivedProjects: db.prepare("SELECT COUNT(*) AS total FROM reporter_projects WHERE is_archived = 1 OR status = 'archived'"),
  countReporterAllFindings: db.prepare(`
    SELECT COUNT(*) AS total
    FROM reporter_findings rf
    INNER JOIN reporter_projects rp ON rp.id = rf.project_id
    WHERE rp.is_archived = 0 AND rp.status != 'archived'
  `),
  countReporterCriticalFindings: db.prepare(`
    SELECT COUNT(*) AS total
    FROM reporter_findings rf
    INNER JOIN reporter_projects rp ON rp.id = rf.project_id
    WHERE rf.severity = 'critical' AND rp.is_archived = 0 AND rp.status != 'archived'
  `),
  countReporterHighFindings: db.prepare(`
    SELECT COUNT(*) AS total
    FROM reporter_findings rf
    INNER JOIN reporter_projects rp ON rp.id = rf.project_id
    WHERE rf.severity = 'high' AND rp.is_archived = 0 AND rp.status != 'archived'
  `),
  countReporterAllTemplates: db.prepare("SELECT COUNT(*) AS total FROM reporter_finding_templates"),
  countReporterDesigns: db.prepare("SELECT COUNT(*) AS total FROM reporter_designs"),
  createReporterPdfGeneration: db.prepare(`
    INSERT INTO reporter_pdf_generations (id, project_id, file_path, file_size, status, error_message, render_options, generated_by)
    VALUES (@id, @projectId, @filePath, @fileSize, @status, @errorMessage, @renderOptions, @generatedBy)
  `),
  updateReporterPdfGeneration: db.prepare(`
    UPDATE reporter_pdf_generations SET
      file_path = @filePath, file_size = @fileSize, status = @status,
      error_message = @errorMessage, render_options = @renderOptions
    WHERE id = @id
  `),
  getReporterPdfGenerationById: db.prepare(`
    SELECT rpg.*, rp.created_by AS project_created_by, rp.title AS project_title
    FROM reporter_pdf_generations rpg
    LEFT JOIN reporter_projects rp ON rp.id = rpg.project_id
    WHERE rpg.id = ?
  `),
  listReporterPdfGenerationsByProject: db.prepare(`
    SELECT * FROM reporter_pdf_generations
    WHERE project_id = ?
    ORDER BY created_at DESC
  `),
  deleteReporterPdfGenerationById: db.prepare("DELETE FROM reporter_pdf_generations WHERE id = ?"),
  createReporterNote: db.prepare(`
    INSERT INTO reporter_notes (id, project_id, title, content, order_index, created_by)
    VALUES (@id, @projectId, @title, @content, @orderIndex, @createdBy)
  `),
  getReporterNoteById: db.prepare("SELECT rn.*, u.username FROM reporter_notes rn LEFT JOIN users u ON u.id = rn.created_by WHERE rn.id = ?"),
  listReporterNotesByProject: db.prepare("SELECT rn.*, u.username FROM reporter_notes rn LEFT JOIN users u ON u.id = rn.created_by WHERE rn.project_id = ? ORDER BY rn.order_index ASC, rn.created_at ASC"),
  updateReporterNote: db.prepare(`
    UPDATE reporter_notes SET title = @title, content = @content, order_index = @orderIndex, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterNoteById: db.prepare("DELETE FROM reporter_notes WHERE id = ?"),
  createReporterComment: db.prepare(`
    INSERT INTO reporter_comments (id, project_id, target_type, target_id, content, created_by)
    VALUES (@id, @projectId, @targetType, @targetId, @content, @createdBy)
  `),
  getReporterCommentById: db.prepare("SELECT rc.*, u.username FROM reporter_comments rc LEFT JOIN users u ON u.id = rc.created_by WHERE rc.id = ?"),
  listReporterCommentsByProject: db.prepare("SELECT rc.*, u.username FROM reporter_comments rc LEFT JOIN users u ON u.id = rc.created_by WHERE rc.project_id = ? ORDER BY rc.created_at ASC"),
  listReporterCommentsByTarget: db.prepare("SELECT rc.*, u.username FROM reporter_comments rc LEFT JOIN users u ON u.id = rc.created_by WHERE rc.target_type = ? AND rc.target_id = ? ORDER BY rc.created_at ASC"),
  resolveReporterComment: db.prepare("UPDATE reporter_comments SET is_resolved = @isResolved, updated_at = unixepoch() WHERE id = @id"),
  deleteReporterCommentById: db.prepare("DELETE FROM reporter_comments WHERE id = ?"),
  createReporterHistory: db.prepare(`
    INSERT INTO reporter_history (id, project_id, target_type, target_id, snapshot, version_number, change_summary, created_by)
    VALUES (@id, @projectId, @targetType, @targetId, @snapshot, @versionNumber, @changeSummary, @createdBy)
  `),
  listReporterHistoryByProject: db.prepare("SELECT rh.*, u.username FROM reporter_history rh LEFT JOIN users u ON u.id = rh.created_by WHERE rh.project_id = ? ORDER BY rh.created_at DESC"),
  createReporterEvidence: db.prepare(`
    INSERT INTO reporter_evidence (id, project_id, finding_id, section_id, filename, stored_filename, mime_type, size_bytes, caption, evidence_type, redaction_status, created_by)
    VALUES (@id, @projectId, @findingId, @sectionId, @filename, @storedFilename, @mimeType, @sizeBytes, @caption, @evidenceType, @redactionStatus, @createdBy)
  `),
  getReporterEvidenceById: db.prepare("SELECT * FROM reporter_evidence WHERE id = ?"),
  listReporterEvidenceByProject: db.prepare("SELECT * FROM reporter_evidence WHERE project_id = ? ORDER BY created_at DESC"),
  updateReporterEvidence: db.prepare(`
    UPDATE reporter_evidence SET finding_id = @findingId, section_id = @sectionId, caption = @caption,
      evidence_type = @evidenceType, redaction_status = @redactionStatus, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterEvidenceById: db.prepare("DELETE FROM reporter_evidence WHERE id = ?"),
  createReporterImportJob: db.prepare(`
    INSERT INTO reporter_import_jobs (id, project_id, import_type, status, source_file, result_summary, error_message, created_by)
    VALUES (@id, @projectId, @importType, @status, @sourceFile, @resultSummary, @errorMessage, @createdBy)
  `),
  updateReporterImportJob: db.prepare(`
    UPDATE reporter_import_jobs SET status = @status, result_summary = @resultSummary, error_message = @errorMessage
    WHERE id = @id
  `),
  listReporterImportJobsByProject: db.prepare("SELECT * FROM reporter_import_jobs WHERE project_id = ? ORDER BY created_at DESC"),
  deleteReporterNotesByProject: db.prepare("DELETE FROM reporter_notes WHERE project_id = ?"),
  deleteReporterCommentsByProject: db.prepare("DELETE FROM reporter_comments WHERE project_id = ?"),
  deleteReporterHistoryByProject: db.prepare("DELETE FROM reporter_history WHERE project_id = ?"),
  deleteReporterEvidenceByProject: db.prepare("DELETE FROM reporter_evidence WHERE project_id = ?"),
  deleteReporterPdfGenerationsByProject: db.prepare("DELETE FROM reporter_pdf_generations WHERE project_id = ?"),
  deleteReporterImportJobsByProject: db.prepare("DELETE FROM reporter_import_jobs WHERE project_id = ?"),
  deleteReporterFindingsByProject: db.prepare("DELETE FROM reporter_findings WHERE project_id = ?"),
  deleteReporterSectionsByProject: db.prepare("DELETE FROM reporter_sections WHERE project_id = ?"),

  // --- Reporter: Proposals ---
  createReporterProposal: db.prepare(`
    INSERT INTO reporter_proposals (id, template_id, title, client_name, client_id, primary_contact_name, primary_contact_email,
      prepared_for_name, prepared_for_email, prepared_by_user_id, opportunity_id, engagement_id, status, proposal_type,
      test_types, proposal_metadata, valid_until, estimated_days, quoted_value, created_by)
    VALUES (@id, @templateId, @title, @clientName, @clientId, @primaryContactName, @primaryContactEmail,
      @preparedForName, @preparedForEmail, @preparedByUserId, @opportunityId, @engagementId, @status, @proposalType,
      @testTypes, @proposalMetadata, @validUntil, @estimatedDays, @quotedValue, @createdBy)
  `),
  getReporterProposalById: db.prepare(`
    SELECT rp.*, creator.username AS creator_username,
      prepared_by.username AS prepared_by_username,
      prepared_by.full_name AS prepared_by_full_name,
      prepared_by.email AS prepared_by_email
    FROM reporter_proposals rp
    LEFT JOIN users creator ON creator.id = rp.created_by
    LEFT JOIN users prepared_by ON prepared_by.id = rp.prepared_by_user_id
    WHERE rp.id = ?
  `),
  listReporterProposals: db.prepare(`
    SELECT rp.*, creator.username AS creator_username
    FROM reporter_proposals rp
    LEFT JOIN users creator ON creator.id = rp.created_by
    ORDER BY rp.updated_at DESC
  `),
  updateReporterProposal: db.prepare(`
    UPDATE reporter_proposals SET
      title = @title, client_name = @clientName, client_id = @clientId,
      primary_contact_name = @primaryContactName, primary_contact_email = @primaryContactEmail,
      prepared_for_name = @preparedForName, prepared_for_email = @preparedForEmail,
      prepared_by_user_id = @preparedByUserId, proposal_type = @proposalType,
      test_types = @testTypes, proposal_metadata = @proposalMetadata,
      valid_until = @validUntil, estimated_days = @estimatedDays, quoted_value = @quotedValue,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  updateReporterProposalStatus: db.prepare(`
    UPDATE reporter_proposals SET status = @status, updated_at = unixepoch() WHERE id = @id
  `),
  archiveReporterProposal: db.prepare(`
    UPDATE reporter_proposals SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = @id
  `),
  unarchiveReporterProposal: db.prepare(`
    UPDATE reporter_proposals SET archived_at = NULL, updated_at = unixepoch() WHERE id = @id
  `),
  countReporterProposals: db.prepare("SELECT COUNT(*) AS total FROM reporter_proposals WHERE archived_at IS NULL"),

  // --- Reporter: Proposal Sections ---
  createReporterProposalSection: db.prepare(`
    INSERT INTO reporter_proposal_sections (id, proposal_id, title, section_type, content, order_index, is_included, created_by)
    VALUES (@id, @proposalId, @title, @sectionType, @content, @orderIndex, @isIncluded, @createdBy)
  `),
  getReporterProposalSectionById: db.prepare("SELECT * FROM reporter_proposal_sections WHERE id = ?"),
  listReporterProposalSections: db.prepare(`
    SELECT * FROM reporter_proposal_sections WHERE proposal_id = ? ORDER BY order_index ASC, created_at ASC
  `),
  updateReporterProposalSection: db.prepare(`
    UPDATE reporter_proposal_sections SET
      title = @title, content = @content, is_included = @isIncluded, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteReporterProposalSection: db.prepare("DELETE FROM reporter_proposal_sections WHERE id = ?"),
  reorderReporterProposalSections: db.prepare(`
    UPDATE reporter_proposal_sections SET order_index = @orderIndex WHERE id = @id
  `),
  deleteReporterProposalSectionsByProposal: db.prepare("DELETE FROM reporter_proposal_sections WHERE proposal_id = ?"),

  // --- Reporter: Proposal Generations ---
  createReporterProposalGeneration: db.prepare(`
    INSERT INTO reporter_proposal_generations (id, proposal_id, filename, file_path, version, status, created_by)
    VALUES (@id, @proposalId, @filename, @filePath, @version, @status, @createdBy)
  `),
  updateReporterProposalGeneration: db.prepare(`
    UPDATE reporter_proposal_generations SET
      file_path = @filePath, status = @status, completed_at = @completedAt,
      error_message = @errorMessage
    WHERE id = @id
  `),
  getReporterProposalGenerationById: db.prepare("SELECT * FROM reporter_proposal_generations WHERE id = ?"),
  listReporterProposalGenerations: db.prepare(`
    SELECT * FROM reporter_proposal_generations WHERE proposal_id = ? ORDER BY created_at DESC
  `),
  deleteReporterProposalGenerationById: db.prepare("DELETE FROM reporter_proposal_generations WHERE id = ?"),

  // --- Reporter: Proposal Templates (read-only for now) ---
  listReporterProposalTemplates: db.prepare(`
    SELECT * FROM reporter_proposal_templates WHERE archived_at IS NULL ORDER BY sort_order ASC, created_at ASC
  `),
  getReporterProposalTemplateById: db.prepare("SELECT * FROM reporter_proposal_templates WHERE id = ?"),
  listReporterProposalTemplateSections: db.prepare(`
    SELECT * FROM reporter_proposal_template_sections WHERE template_id = ? ORDER BY order_index ASC
  `),

  // --- Reporter: Test Type Templates ---
  listReporterTestTypeTemplates: db.prepare(`
    SELECT * FROM reporter_test_type_templates WHERE archived_at IS NULL ORDER BY sort_order ASC
  `),
  listAllReporterTestTypeTemplates: db.prepare(`
    SELECT * FROM reporter_test_type_templates ORDER BY sort_order ASC
  `),
  getReporterTestTypeTemplateById: db.prepare("SELECT * FROM reporter_test_type_templates WHERE id = ?"),
  getReporterTestTypeTemplateByType: db.prepare("SELECT * FROM reporter_test_type_templates WHERE test_type = ?"),
  createReporterTestTypeTemplate: db.prepare(`
    INSERT INTO reporter_test_type_templates (id, test_type, name, description, methodology_writeup, scope_guidance, deliverables, client_requirements, consultant_requirements, assumptions, restrictions, is_builtin, sort_order, created_at, updated_at)
    VALUES (@id, @testType, @name, @description, @methodologyWriteup, @scopeGuidance, @deliverables, @clientRequirements, @consultantRequirements, @assumptions, @restrictions, 0, @sortOrder, unixepoch(), unixepoch())
  `),
  updateReporterTestTypeTemplate: db.prepare(`
    UPDATE reporter_test_type_templates SET name = @name, description = @description, methodology_writeup = @methodologyWriteup, scope_guidance = @scopeGuidance, deliverables = @deliverables, client_requirements = @clientRequirements, consultant_requirements = @consultantRequirements, assumptions = @assumptions, restrictions = @restrictions, updated_at = unixepoch() WHERE id = @id
  `),
  archiveReporterTestTypeTemplate: db.prepare(`
    UPDATE reporter_test_type_templates SET archived_at = unixepoch() WHERE id = ? AND is_builtin = 0
  `),

  // --- Reporter: Proposal Template CRUD ---
  createReporterProposalTemplate: db.prepare(`
    INSERT INTO reporter_proposal_templates (id, name, description, template_type, html_template, css_template, metadata_schema, is_builtin, sort_order, created_by, created_at, updated_at)
    VALUES (@id, @name, @description, @templateType, @htmlTemplate, @cssTemplate, @metadataSchema, 0, @sortOrder, @createdBy, unixepoch(), unixepoch())
  `),
  updateReporterProposalTemplate: db.prepare(`
    UPDATE reporter_proposal_templates SET name = @name, description = @description, template_type = @templateType, html_template = @htmlTemplate, css_template = @cssTemplate, metadata_schema = @metadataSchema, updated_at = unixepoch() WHERE id = @id AND is_builtin = 0
  `),
  archiveReporterProposalTemplate: db.prepare(`
    UPDATE reporter_proposal_templates SET archived_at = unixepoch() WHERE id = ? AND is_builtin = 0
  `),
  createReporterProposalTemplateSection: db.prepare(`
    INSERT INTO reporter_proposal_template_sections (id, template_id, title, section_type, content, order_index, is_required, is_builtin, created_at, updated_at)
    VALUES (@id, @templateId, @title, @sectionType, @content, @orderIndex, @isRequired, 0, unixepoch(), unixepoch())
  `),
  updateReporterProposalTemplateSection: db.prepare(`
    UPDATE reporter_proposal_template_sections SET title = @title, section_type = @sectionType, content = @content, order_index = @orderIndex, is_required = @isRequired, updated_at = unixepoch() WHERE id = @id
  `),
  deleteReporterProposalTemplateSection: db.prepare("DELETE FROM reporter_proposal_template_sections WHERE id = ?"),
  getReporterProposalTemplateSectionById: db.prepare("SELECT * FROM reporter_proposal_template_sections WHERE id = ?"),

  // --- Notification statements ---
  createNotification: db.prepare(`
    INSERT INTO notifications (id, user_id, category, action, title, body, link_url, entity_type, entity_id, severity, expires_at, dedupe_key)
    VALUES (@id, @userId, @category, @action, @title, @body, @linkUrl, @entityType, @entityId, @severity, @expiresAt, @dedupeKey)
  `),
  getNotificationsByUserId: db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND (expires_at IS NULL OR expires_at > unixepoch())
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `),
  getUnreadCountByUserId: db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE user_id = ? AND read_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch())
  `),
  markNotificationRead: db.prepare(`
    UPDATE notifications SET read_at = unixepoch() WHERE id = ? AND user_id = ?
  `),
  markAllNotificationsReadByUserId: db.prepare(`
    UPDATE notifications SET read_at = unixepoch() WHERE user_id = ? AND read_at IS NULL
  `),
  getNotificationById: db.prepare("SELECT * FROM notifications WHERE id = ?"),
  findUnreadNotificationByDedupe: db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND dedupe_key = ? AND read_at IS NULL
    LIMIT 1
  `),
  updateNotificationDedupe: db.prepare(`
    UPDATE notifications SET
      category = @category, action = @action, title = @title, body = @body,
      link_url = @linkUrl, entity_type = @entityType, entity_id = @entityId,
      severity = @severity, created_at = unixepoch()
    WHERE id = @id
  `),
  deleteExpiredNotifications: db.prepare(`
    DELETE FROM notifications WHERE expires_at IS NOT NULL AND expires_at < unixepoch()
  `),

  // --- Engage client statements ---
  createEngageClient: db.prepare(`
    INSERT INTO engage_clients (id, name, display_name, industry, website, account_owner_user_id, status, notes, created_by)
    VALUES (@id, @name, @displayName, @industry, @website, @accountOwnerUserId, @status, @notes, @createdBy)
  `),
  getEngageClientById: db.prepare("SELECT * FROM engage_clients WHERE id = ?"),
  listEngageClients: db.prepare(`
    SELECT * FROM engage_clients WHERE archived_at IS NULL ORDER BY name ASC LIMIT ? OFFSET ?
  `),
  updateEngageClient: db.prepare(`
    UPDATE engage_clients SET name = @name, display_name = @displayName, industry = @industry,
      website = @website, account_owner_user_id = @accountOwnerUserId, status = @status,
      notes = @notes, default_billing_contact_id = @defaultBillingContactId,
      default_technical_contact_id = @defaultTechnicalContactId, updated_at = unixepoch()
    WHERE id = @id
  `),
  archiveEngageClient: db.prepare("UPDATE engage_clients SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"),
  countEngageClients: db.prepare("SELECT COUNT(*) as total FROM engage_clients WHERE archived_at IS NULL"),

  // --- Engage contact statements ---
  createEngageContact: db.prepare(`
    INSERT INTO engage_client_contacts (id, client_id, name, title, email, phone, contact_type, is_primary, notes)
    VALUES (@id, @clientId, @name, @title, @email, @phone, @contactType, @isPrimary, @notes)
  `),
  getEngageContactById: db.prepare("SELECT * FROM engage_client_contacts WHERE id = ?"),
  listEngageContactsByClient: db.prepare(`
    SELECT * FROM engage_client_contacts WHERE client_id = ? AND archived_at IS NULL ORDER BY is_primary DESC, name ASC
  `),
  updateEngageContact: db.prepare(`
    UPDATE engage_client_contacts SET name = @name, title = @title, email = @email,
      phone = @phone, contact_type = @contactType, is_primary = @isPrimary,
      notes = @notes, updated_at = unixepoch()
    WHERE id = @id
  `),
  archiveEngageContact: db.prepare("UPDATE engage_client_contacts SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"),

  // --- Engage opportunity statements ---
  createEngageOpportunity: db.prepare(`
    INSERT INTO engage_opportunities (id, client_id, title, opportunity_type, stage, estimated_value, quoted_value,
      estimated_days, probability_percent, expected_start_date, expected_decision_date,
      proposal_reporter_doc_id, proposal_pdf_generation_id, owner_user_id, created_by, notes)
    VALUES (@id, @clientId, @title, @opportunityType, @stage, @estimatedValue, @quotedValue,
      @estimatedDays, @probabilityPercent, @expectedStartDate, @expectedDecisionDate,
      @proposalReporterDocId, @proposalPdfGenerationId, @ownerUserId, @createdBy, @notes)
  `),
  getEngageOpportunityById: db.prepare(`
    SELECT o.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_opportunities o
    LEFT JOIN engage_clients c ON c.id = o.client_id
    WHERE o.id = ?
  `),
  listEngageOpportunities: db.prepare(`
    SELECT o.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_opportunities o
    LEFT JOIN engage_clients c ON c.id = o.client_id
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `),
  listEngageOpportunitiesByClient: db.prepare(`
    SELECT o.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_opportunities o
    LEFT JOIN engage_clients c ON c.id = o.client_id
    WHERE o.client_id = ? ORDER BY o.created_at DESC
  `),
  listEngageOpportunitiesByOwner: db.prepare(`
    SELECT * FROM engage_opportunities WHERE owner_user_id = ? ORDER BY created_at DESC
  `),
  updateEngageOpportunity: db.prepare(`
    UPDATE engage_opportunities SET title = @title, opportunity_type = @opportunityType, stage = @stage,
      estimated_value = @estimatedValue, quoted_value = @quotedValue, estimated_days = @estimatedDays,
      probability_percent = @probabilityPercent, expected_start_date = @expectedStartDate,
      expected_decision_date = @expectedDecisionDate, proposal_reporter_doc_id = @proposalReporterDocId,
      proposal_pdf_generation_id = @proposalPdfGenerationId, owner_user_id = @ownerUserId,
      lost_reason = @lostReason, rejected_reason = @rejectedReason, notes = @notes,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  updateEngageOpportunityStage: db.prepare(`
    UPDATE engage_opportunities SET stage = @stage, closed_at = @closedAt, updated_at = unixepoch() WHERE id = @id
  `),
  linkEngageOpportunityProposal: db.prepare(`
    UPDATE engage_opportunities SET reporter_proposal_id = @reporterProposalId, updated_at = unixepoch() WHERE id = @id
  `),
  addOppProposalLink: db.prepare(`
    INSERT OR IGNORE INTO engage_opportunity_proposals (opportunity_id, reporter_proposal_id) VALUES (?, ?)
  `),
  removeOppProposalLink: db.prepare(`
    DELETE FROM engage_opportunity_proposals WHERE opportunity_id = ? AND reporter_proposal_id = ?
  `),
  listOppProposalLinks: db.prepare(`
    SELECT reporter_proposal_id FROM engage_opportunity_proposals WHERE opportunity_id = ? ORDER BY linked_at DESC
  `),

  // --- Engage engagement statements ---
  createEngageEngagement: db.prepare(`
    INSERT INTO engage_engagements (id, client_id, opportunity_id, title, engagement_type, status, priority,
      commercial_value, estimated_days, scheduled_start_date, scheduled_end_date,
      engagement_manager_user_id, technical_lead_user_id, high_level_scope_summary, notes, created_by)
    VALUES (@id, @clientId, @opportunityId, @title, @engagementType, @status, @priority,
      @commercialValue, @estimatedDays, @scheduledStartDate, @scheduledEndDate,
      @engagementManagerUserId, @technicalLeadUserId, @highLevelScopeSummary, @notes, @createdBy)
  `),
  getEngageEngagementById: db.prepare(`
    SELECT e.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_engagements e
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE e.id = ?
  `),
  getEngageEngagementByReporterProject: db.prepare(`
    SELECT e.id, e.title, e.status, c.name AS client_name
    FROM engage_engagements e
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE e.redsec_reporter_project_id = ? AND e.archived_at IS NULL
    LIMIT 1
  `),
  getEngageEngagementByCalendarProject: db.prepare(`
    SELECT e.id, e.title, e.status, c.name AS client_name
    FROM engage_engagements e
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE e.redseccal_project_id = ? AND e.archived_at IS NULL
    LIMIT 1
  `),
  listEngageEngagements: db.prepare(`
    SELECT e.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_engagements e
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE e.archived_at IS NULL ORDER BY e.created_at DESC LIMIT ? OFFSET ?
  `),
  listEngageEngagementsByUser: db.prepare(`
    SELECT e.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_engagements e
    JOIN engage_engagement_members m ON e.id = m.engagement_id
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE m.user_id = ? AND e.archived_at IS NULL
    ORDER BY e.created_at DESC
  `),
  listEngageEngagementsByClient: db.prepare(`
    SELECT e.*, c.name AS client_name, c.display_name AS client_display_name
    FROM engage_engagements e
    LEFT JOIN engage_clients c ON c.id = e.client_id
    WHERE e.client_id = ? AND e.archived_at IS NULL ORDER BY e.created_at DESC
  `),
  updateEngageEngagement: db.prepare(`
    UPDATE engage_engagements SET title = @title, engagement_type = @engagementType, status = @status,
      priority = @priority, commercial_value = @commercialValue, estimated_days = @estimatedDays,
      scheduled_start_date = @scheduledStartDate, scheduled_end_date = @scheduledEndDate,
      actual_start_date = @actualStartDate, actual_end_date = @actualEndDate,
      engagement_manager_user_id = @engagementManagerUserId, technical_lead_user_id = @technicalLeadUserId,
      redseccal_project_id = @redseccalProjectId, redsec_reporter_project_id = @redsecReporterProjectId,
      proposal_reporter_doc_id = @proposalReporterDocId, delivery_reporter_project_id = @deliveryReporterProjectId,
      high_level_scope_summary = @highLevelScopeSummary, notes = @notes,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  updateEngageEngagementStatus: db.prepare(`
    UPDATE engage_engagements SET status = @status, closed_at = @closedAt, updated_at = unixepoch() WHERE id = @id
  `),
  archiveEngageEngagement: db.prepare("UPDATE engage_engagements SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"),

  // --- Engage team member statements ---
  createEngageMember: db.prepare(`
    INSERT INTO engage_engagement_members (id, engagement_id, user_id, role, is_primary)
    VALUES (@id, @engagementId, @userId, @role, @isPrimary)
  `),
  listEngageMembersByEngagement: db.prepare(`
    SELECT m.*, u.username
    FROM engage_engagement_members m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.engagement_id = ?
    ORDER BY m.is_primary DESC, u.username ASC, m.created_at ASC
  `),
  updateEngageMember: db.prepare(`
    UPDATE engage_engagement_members SET role = @role, is_primary = @isPrimary, updated_at = unixepoch()
    WHERE id = @id
  `),
  deleteEngageMember: db.prepare("DELETE FROM engage_engagement_members WHERE id = ?"),

  // --- Engage QA review statements ---
  createEngageQaReview: db.prepare(`
    INSERT INTO engage_qa_reviews (id, engagement_id, reporter_project_id, assigned_by_user_id, assigned_to_user_id,
      status, qa_notes, report_link, share_link)
    VALUES (@id, @engagementId, @reporterProjectId, @assignedByUserId, @assignedToUserId,
      @status, @qaNotes, @reportLink, @shareLink)
  `),
  getEngageQaReviewById: db.prepare("SELECT * FROM engage_qa_reviews WHERE id = ?"),
  listEngageQaReviewsByEngagement: db.prepare(`
    SELECT * FROM engage_qa_reviews WHERE engagement_id = ? ORDER BY created_at DESC
  `),
  listEngageQaReviewsByAssignee: db.prepare(`
    SELECT * FROM engage_qa_reviews WHERE assigned_to_user_id = ? ORDER BY created_at DESC
  `),
  listEngageQaReviewsByStatus: db.prepare(`
    SELECT * FROM engage_qa_reviews WHERE status = ? ORDER BY created_at DESC
  `),
  updateEngageQaReview: db.prepare(`
    UPDATE engage_qa_reviews SET status = @status, qa_notes = @qaNotes, report_link = @reportLink,
      share_link = @shareLink, assigned_to_user_id = @assignedToUserId, completed_at = @completedAt,
      updated_at = unixepoch()
    WHERE id = @id
  `),
  listEngageQaReviewsByStatusEnriched: db.prepare(`
    SELECT q.*, e.title AS engagement_title, c.display_name AS client_display_name, c.name AS client_name,
      u.username AS assigned_to_username, a.username AS assigned_by_username
    FROM engage_qa_reviews q
    LEFT JOIN engage_engagements e ON q.engagement_id = e.id
    LEFT JOIN engage_clients c ON e.client_id = c.id
    LEFT JOIN users u ON q.assigned_to_user_id = u.id
    LEFT JOIN users a ON q.assigned_by_user_id = a.id
    WHERE q.status = ?
    ORDER BY q.created_at DESC
  `),
  listEngageQaReviewsByAssigneeEnriched: db.prepare(`
    SELECT q.*, e.title AS engagement_title, c.display_name AS client_display_name, c.name AS client_name,
      u.username AS assigned_to_username, a.username AS assigned_by_username
    FROM engage_qa_reviews q
    LEFT JOIN engage_engagements e ON q.engagement_id = e.id
    LEFT JOIN engage_clients c ON e.client_id = c.id
    LEFT JOIN users u ON q.assigned_to_user_id = u.id
    LEFT JOIN users a ON q.assigned_by_user_id = a.id
    WHERE q.assigned_to_user_id = ?
    ORDER BY q.created_at DESC
  `),
  listAllEngageQaReviewsEnriched: db.prepare(`
    SELECT q.*, e.title AS engagement_title, c.display_name AS client_display_name, c.name AS client_name,
      u.username AS assigned_to_username, a.username AS assigned_by_username
    FROM engage_qa_reviews q
    LEFT JOIN engage_engagements e ON q.engagement_id = e.id
    LEFT JOIN engage_clients c ON e.client_id = c.id
    LEFT JOIN users u ON q.assigned_to_user_id = u.id
    LEFT JOIN users a ON q.assigned_by_user_id = a.id
    ORDER BY q.created_at DESC
  `),
  listEngageQaReviewsByEngagementEnriched: db.prepare(`
    SELECT q.*, u.username AS assigned_to_username, a.username AS assigned_by_username
    FROM engage_qa_reviews q
    LEFT JOIN users u ON q.assigned_to_user_id = u.id
    LEFT JOIN users a ON q.assigned_by_user_id = a.id
    WHERE q.engagement_id = ?
    ORDER BY q.created_at DESC
  `),

  // --- Engage notes statements ---
  createEngageNote: db.prepare(`
    INSERT INTO engage_notes (id, entity_type, entity_id, user_id, content)
    VALUES (@id, @entityType, @entityId, @userId, @content)
  `),
  listEngageNotesByEntity: db.prepare(`
    SELECT n.*, u.username FROM engage_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.entity_type = ? AND n.entity_id = ? ORDER BY n.created_at DESC
  `),

  // --- Engage activity log statements ---
  createEngageActivity: db.prepare(`
    INSERT INTO engage_activity (id, entity_type, entity_id, action, user_id, username, details)
    VALUES (@id, @entityType, @entityId, @action, @userId, @username, @details)
  `),
  listEngageActivityByEntity: db.prepare(`
    SELECT * FROM engage_activity WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?
  `),

  // --- Engage dashboard stats statements ---
  engagePipelineValue: db.prepare(`
    SELECT COALESCE(SUM(estimated_value), 0) as total,
           COALESCE(SUM(CASE WHEN probability_percent > 0 THEN estimated_value * probability_percent / 100.0 ELSE estimated_value * 0.2 END), 0) as weighted
    FROM engage_opportunities WHERE stage NOT IN ('won', 'lost', 'rejected', 'archived')
  `),
  engageOppStageCounts: db.prepare(`
    SELECT stage, COUNT(*) as count FROM engage_opportunities GROUP BY stage
  `),
  engageOppThisMonth: db.prepare(`
    SELECT stage, COUNT(*) as count FROM engage_opportunities
    WHERE closed_at IS NOT NULL AND closed_at >= ? AND closed_at < ?
    GROUP BY stage
  `),
  engageEngStatusCounts: db.prepare(`
    SELECT status, COUNT(*) as count FROM engage_engagements WHERE archived_at IS NULL GROUP BY status
  `),
  engageEngActiveCount: db.prepare(`
    SELECT COUNT(*) as count FROM engage_engagements
    WHERE archived_at IS NULL AND status NOT IN ('draft', 'delivered', 'closed', 'cancelled', 'archived')
  `),
  engageEngScheduledCount: db.prepare(`
    SELECT COUNT(*) as count FROM engage_engagements
    WHERE archived_at IS NULL AND status = 'scheduled'
  `),
  engageQaQueueCounts: db.prepare(`
    SELECT status, COUNT(*) as count FROM engage_qa_reviews GROUP BY status
  `),
  engageQaAssignedToUser: db.prepare(`
    SELECT q.* FROM engage_qa_reviews q
    JOIN engage_engagements e ON q.engagement_id = e.id
    WHERE q.assigned_to_user_id = ? AND q.status IN ('assigned', 'reviewing') AND e.archived_at IS NULL
  `),
  engageBlockedEngagements: db.prepare(`
    SELECT id, title, status FROM engage_engagements
    WHERE archived_at IS NULL AND status = 'testing_blocked'
    ORDER BY updated_at DESC
  `),
  engageOverdueEngagements: db.prepare(`
    SELECT id, title, status, scheduled_end_date FROM engage_engagements
    WHERE archived_at IS NULL AND status NOT IN ('delivered', 'closed', 'cancelled', 'archived')
      AND scheduled_end_date IS NOT NULL AND date(scheduled_end_date) < date('now')
    ORDER BY scheduled_end_date ASC
  `),
  engageMyEngagements: db.prepare(`
    SELECT e.* FROM engage_engagements e
    JOIN engage_engagement_members m ON e.id = m.engagement_id
    WHERE m.user_id = ? AND e.archived_at IS NULL
      AND e.status NOT IN ('delivered', 'closed', 'cancelled', 'archived')
    ORDER BY e.updated_at DESC LIMIT 20
  `),
  engageRecentlyUpdated: db.prepare(`
    SELECT * FROM engage_engagements WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 10
  `),
  engageRecentActivity: db.prepare(`
    SELECT * FROM engage_activity ORDER BY created_at DESC LIMIT 20
  `),
  engageActivityCount: db.prepare(`SELECT COUNT(*) as total FROM engage_activity`),
  engageActivityPage: db.prepare(`SELECT * FROM engage_activity ORDER BY created_at DESC LIMIT ? OFFSET ?`),
  engageUtilisationSummary: db.prepare(`
    SELECT ce.assignee_user_id, u.username,
      SUM(ce.scheduled_hours) as booked_hours,
      COUNT(DISTINCT ce.id) as entry_count
    FROM calendar_entries ce
    LEFT JOIN users u ON ce.assignee_user_id = u.id
    WHERE ce.assignee_user_id IS NOT NULL
      AND ce.type IN ('assignment', 'project', 'project_time')
      AND ce.starts_at >= ? AND ce.ends_at <= ?
    GROUP BY ce.assignee_user_id
    ORDER BY booked_hours DESC
  `),
  engageEngagementsWithoutTesters: db.prepare(`
    SELECT e.id, e.title FROM engage_engagements e
    WHERE e.archived_at IS NULL AND e.status NOT IN ('draft', 'closed', 'cancelled', 'archived')
      AND NOT EXISTS (SELECT 1 FROM engage_engagement_members m WHERE m.engagement_id = e.id AND m.role IN ('tester', 'technical_lead'))
  `),

  // --- Engage extra dashboard stats ---
  engageDeliveredThisMonth: db.prepare(`
    SELECT COUNT(*) as count FROM engage_engagements
    WHERE archived_at IS NULL AND status = 'delivered' AND updated_at >= ? AND updated_at < ?
  `),
  engageClosedThisMonth: db.prepare(`
    SELECT COUNT(*) as count FROM engage_engagements
    WHERE archived_at IS NULL AND status IN ('closed', 'cancelled') AND closed_at >= ? AND closed_at < ?
  `),
  engageAvgDaysInQA: db.prepare(`
    SELECT AVG(COALESCE(q.completed_at, q.updated_at) - q.created_at) as avg_days
    FROM engage_qa_reviews q
    WHERE q.status = 'ready_for_delivery'
  `),
};

// Default security settings (must be after stmts initialization)
const DEFAULTS = {
  ...featureFlagDefaults(),
  session_ttl: "43200",
  session_ttl_extended: "604800",
  mfa_remember_days: "30",
  mfa_required: "false",
  admin_reauth_required: process.env.ADMIN_REAUTH_REQUIRED || "false",
  sso_provider: "none",
  sso_auto_provision: "false",
  sso_login_path: "/api/auth/sso/saml/login",
  sso_acs_path: "/api/auth/sso/saml/acs",
  sso_metadata_path: "/api/auth/sso/saml/metadata",
  sso_entity_id: "",
  sso_idp_entity_id: "",
  sso_idp_metadata_url: "",
  sso_saml_entry_point: "",
  sso_idp_cert: "",
  sso_email_attribute: "email",
  sso_username_attribute: "username",
  sso_full_name_attribute: "displayName",
  sso_default_role_id: "",
  sso_sign_requests: "false",
  sso_sp_private_key: "",
  sso_sp_public_cert: "",
  sso_force_authn: "false",
  bulletin_auto_purge_enabled: "false",
  bulletin_auto_purge_days: "90",
  bulletin_asset_auto_purge_days: "30",
  calendar_daily_hours: "7.6",
  calendar_workday_start: "08:30",
  calendar_workday_end: "17:30",
  calendar_workdays: "1,2,3,4,5",
  site_primary_theme: "red",
  wiki_personal_spaces_enabled: "true",
  wiki_search_result_limit: "20",
  wiki_team_home_page_id: "",
  threat_auto_fetch_enabled: process.env.THREAT_AUTO_FETCH_ENABLED || "true",
  threat_fetch_interval_seconds: "1800",
  threat_alert_retention_days: "14",
  threat_tor_proxy_url: "",
  threat_notify_email_enabled: "true",
  threat_notify_email_from_override: "",
  threat_notify_webhook_enabled: "true",
  threat_notify_discord_enabled: "true",
  threat_notify_discord_username: "RedSecThreat",
  threat_notify_discord_avatar_url: "",
  redsecai_enabled: process.env.REDSECAI_ENABLED || "true",
  redsecai_base_url: process.env.REDSECAI_BASE_URL || "http://127.0.0.1:11434",
  redsecai_model: process.env.REDSECAI_MODEL || "qwen3.5:4b",
  redsecai_timeout_ms: process.env.REDSECAI_TIMEOUT_MS || "300000",
  redsecai_num_ctx: process.env.REDSECAI_NUM_CTX || "4096",
  redsecai_autostart: process.env.REDSECAI_AUTOSTART || "true",
  redsecai_auto_pull: process.env.REDSECAI_AUTO_PULL || "true",
  redsecai_action_ttl_seconds: process.env.REDSECAI_ACTION_TTL_SECONDS || "7200",
  securitytrails_api_key: "",
  securitytrails_daily_limit: "50",
};
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (!getSetting(key)) setSetting(key, value);
}

// Reporter project visibility is member-based. Backfill existing projects so
// deployments created before this rule keep their creators as project leads.
db.prepare(`
  INSERT OR IGNORE INTO reporter_project_members (project_id, user_id, role)
  SELECT id, created_by, 'lead'
  FROM reporter_projects
  WHERE created_by IS NOT NULL AND created_by != ''
`).run();

const legacyThreatAutoFetch = getSetting("threat_auto_fetch");
if (legacyThreatAutoFetch && legacyThreatAutoFetch !== getSetting("threat_auto_fetch_enabled")) {
  setSetting("threat_auto_fetch_enabled", legacyThreatAutoFetch);
}
const legacyThreatFetchInterval = parseInt(getSetting("threat_fetch_interval"), 10);
if (Number.isFinite(legacyThreatFetchInterval) && legacyThreatFetchInterval > 0) {
  const legacyIntervalSeconds = legacyThreatFetchInterval * 60;
  if (String(legacyIntervalSeconds) !== String(getSetting("threat_fetch_interval_seconds"))) {
    setSetting("threat_fetch_interval_seconds", String(legacyIntervalSeconds));
  }
}

// Promote untouched legacy threat defaults to the newer baseline without
// overwriting deployments that have already been customized.
if (
  getSetting("threat_auto_fetch_enabled") === "false" &&
  getSetting("threat_fetch_interval_seconds") === "60" &&
  getSetting("threat_alert_retention_days") === "30"
) {
  setSetting("threat_auto_fetch_enabled", "true");
  setSetting("threat_fetch_interval_seconds", "1800");
  setSetting("threat_alert_retention_days", "14");
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
  const safeSyntax = VALID_SYNTAX_OPTIONS.includes(syntax) ? syntax : "plaintext";
  return pasteRepo.createPaste({
    id,
    ciphertext,
    iv,
    ivPassword,
    salt,
    hasPassword,
    burnAfterReading,
    expiresIn,
    sourceIp,
    syntax: safeSyntax,
    userId,
    guestInvitedBy,
  });
}

function getPaste(id) {
  return pasteRepo.getPaste(id);
}

function deleteExpired() {
  return pasteRepo.deleteExpiredPastes();
}

function getPasteStats() {
  return pasteRepo.getPasteStats();
}

function listPastes(page = 1, limit = 50) {
  return pasteRepo.listPastes(page, limit);
}

function deletePaste(id) {
  return pasteRepo.deletePaste(id);
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

function listShareFileRowsByShareId(id) {
  return stmts.getFilesByShareId.all(id);
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

function updateUserProfile({ id, fullName }) {
  stmts.updateUserProfile.run({ id, fullName: String(fullName || "").trim() || null });
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
      fullName: r.full_name || "",
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

function listUsersByPermission(permission) {
  return stmts.listUsersByPermission.all(permission);
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
  const id = payload.id || generateId();
  stmts.createCalendarProject.run({
    id,
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
  return stmts.getCalendarProjectById.get(id);
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
    groupId: payload.groupId || null,
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
    groupId: payload.groupId !== undefined ? payload.groupId : undefined,
  });
}

function listCalendarEntriesByGroup(groupId) {
  return stmts.listCalendarEntriesByGroup.all(groupId);
}

function deleteCalendarEntriesByGroup(groupId) {
  return stmts.deleteCalendarEntriesByGroup.run(groupId).changes;
}

function countCalendarEntriesByGroup(groupId) {
  return stmts.countCalendarEntriesByGroup.get(groupId).total;
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

function reorderWikiPages(items) {
  for (const item of items) {
    stmts.reorderWikiPage.run({
      id: item.id,
      parentPageId: item.parentPageId || null,
      sortOrder: Number(item.sortOrder ?? 0),
    });
  }
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

// ---------------------------------------------------------------------------
// Threat Intel Functions
// ---------------------------------------------------------------------------

function _tid() { return crypto.randomBytes(16).toString("base64url"); }
const THREAT_VALID_FEED_TYPES = new Set(["rss", "website", "api", "onion"]);
const THREAT_VALID_CRITICALITIES = new Set(["low", "medium", "high", "critical"]);
const THREAT_VALID_CHANNEL_TYPES = new Set(["webhook", "email", "discord"]);

// --- Feeds ---
function createThreatFeed({ name, url, feedType, enabled = true, isDefault = false, fetchInterval = 3600, feedMetadata = "{}" }) {
  const id = _tid();
  stmts.createThreatFeed.run({ id, name, url, feedType, enabled: enabled ? 1 : 0, isDefault: isDefault ? 1 : 0, fetchInterval, feedMetadata });
  return getThreatFeedById(id);
}

function listThreatFeeds(enabledOnly = false) {
  const rows = enabledOnly ? stmts.listThreatFeedsEnabled.all() : stmts.listThreatFeeds.all();
  return rows.map(_mapThreatFeed);
}

function getThreatFeedById(id) {
  const row = stmts.getThreatFeedById.get(id);
  if (!row) return null;
  const feed = _mapThreatFeed(row);
  feed.keywords = stmts.getThreatFeedKeywords.all(id).map(_mapThreatKeyword);
  feed.tags = stmts.getThreatFeedTags.all(id).map(_mapThreatTag);
  return feed;
}

function updateThreatFeed(id, { name, url, feedType, enabled, isDefault, fetchInterval, feedMetadata }) {
  const existing = stmts.getThreatFeedById.get(id);
  if (!existing) return null;
  stmts.updateThreatFeed.run({
    id, name: name ?? existing.name, url: url ?? existing.url,
    feedType: feedType ?? existing.feed_type, enabled: enabled != null ? (enabled ? 1 : 0) : existing.enabled,
    isDefault: isDefault != null ? (isDefault ? 1 : 0) : existing.is_default,
    fetchInterval: fetchInterval ?? existing.fetch_interval,
    feedMetadata: feedMetadata ?? existing.feed_metadata,
  });
  return getThreatFeedById(id);
}

function deleteThreatFeedById(id) {
  return stmts.deleteThreatFeedById.run(id).changes > 0;
}

function updateThreatFeedFetchStatus(id, { hash, error, errorAt, failures }) {
  stmts.updateThreatFeedFetchStatus.run({ id, hash: hash || null, error: error || null, errorAt: errorAt || null, failures: failures || 0 });
}

// --- Feed-Keyword M2M ---
const _setThreatFeedKeywords = db.transaction((feedId, keywordIds) => {
  stmts.setThreatFeedKeywords.run(feedId);
  for (const kid of keywordIds) stmts.insertThreatFeedKeyword.run(feedId, kid);
});
function setThreatFeedKeywords(feedId, keywordIds) { _setThreatFeedKeywords(feedId, keywordIds); }
function getThreatFeedKeywords(feedId) { return stmts.getThreatFeedKeywords.all(feedId).map(_mapThreatKeyword); }
function getThreatFeedsForKeyword(keywordId) { return stmts.getThreatFeedsForKeyword.all(keywordId).map(_mapThreatFeed); }

// --- Feed-Tag M2M ---
const _setThreatFeedTags = db.transaction((feedId, tagIds) => {
  stmts.setThreatFeedTags.run(feedId);
  for (const tid of tagIds) stmts.insertThreatFeedTag.run(feedId, tid);
});
function setThreatFeedTags(feedId, tagIds) { _setThreatFeedTags(feedId, tagIds); }
function getThreatFeedTags(feedId) { return stmts.getThreatFeedTags.all(feedId).map(_mapThreatTag); }

// --- Keywords ---
function createThreatKeyword({ keyword, caseSensitive = false, isRegex = false, enabled = true, criticality = "medium", userId = null }) {
  const existing = userId
    ? stmts.getThreatKeywordByTextForUser.get(userId, keyword)
    : stmts.getThreatKeywordByTextSystem.get(keyword);
  if (existing) {
    throw new Error(userId ? "You already have a keyword with that text" : "System keyword already exists");
  }
  const id = _tid();
  stmts.createThreatKeyword.run({ id, keyword, caseSensitive: caseSensitive ? 1 : 0, isRegex: isRegex ? 1 : 0, enabled: enabled ? 1 : 0, criticality, userId });
  return getThreatKeywordById(id);
}

function listThreatKeywords(enabledOnly = false) {
  const rows = enabledOnly ? stmts.listThreatKeywordsEnabled.all() : stmts.listThreatKeywords.all();
  return rows.map(_mapThreatKeyword);
}

function listThreatKeywordsForUser(userId) {
  const system = stmts.listSystemKeywords.all().map(_mapThreatKeyword);
  const personal = stmts.listThreatKeywordsByUser.all(userId).map(_mapThreatKeyword);
  const disabledIds = new Set(getDisabledKeywordIdsForUser(userId));
  return [
    ...system.map((kw) => {
      const disabledByUser = disabledIds.has(kw.id);
      return {
        ...kw,
        isSystem: true,
        disabledByUser,
        enabled: kw.enabled && !disabledByUser,
        baseEnabled: kw.enabled,
        tags: getThreatKeywordTagsForUser(userId, kw.id),
      };
    }),
    ...personal.map((kw) => ({
      ...kw,
      isSystem: false,
      disabledByUser: false,
      baseEnabled: kw.enabled,
      tags: getThreatKeywordTagsForUser(userId, kw.id),
    })),
  ];
}

function listSystemKeywordsForMatching() {
  return stmts.listSystemKeywordsEnabled.all().map(_mapThreatKeyword);
}

function listUserKeywordsForMatching(userId) {
  return stmts.listThreatKeywordsByUser.all(userId)
    .filter((r) => r.enabled)
    .map(_mapThreatKeyword);
}

function listEffectiveThreatKeywordsForUser(userId) {
  const disabledIds = new Set(getDisabledKeywordIdsForUser(userId));
  const system = stmts.listSystemKeywordsEnabled.all()
    .filter((row) => !disabledIds.has(row.id))
    .map(_mapThreatKeyword);
  const personal = stmts.listThreatKeywordsByUser.all(userId)
    .filter((row) => row.enabled)
    .map(_mapThreatKeyword);
  return [...system, ...personal];
}

function getThreatKeywordById(id) {
  const row = stmts.getThreatKeywordById.get(id);
  if (!row) return null;
  const kw = _mapThreatKeyword(row);
  kw.feeds = stmts.getThreatFeedsForKeyword.all(id).map(_mapThreatFeed);
  kw.tags = stmts.getThreatKeywordTags.all(id).map(_mapThreatTag);
  return kw;
}

function getThreatKeywordByIdForUser(userId, id) {
  const keyword = getThreatKeywordById(id);
  if (!keyword) return null;
  if (keyword.userId && keyword.userId !== userId) return null;
  const disabledByUser = !keyword.userId && isSystemKeywordDisabledForUser(userId, id);
  return {
    ...keyword,
    disabledByUser,
    enabled: keyword.userId ? keyword.enabled : (keyword.enabled && !disabledByUser),
    baseEnabled: keyword.enabled,
    tags: getThreatKeywordTagsForUser(userId, id),
  };
}

function updateThreatKeyword(id, { keyword, caseSensitive, isRegex, enabled, criticality }) {
  const existing = stmts.getThreatKeywordById.get(id);
  if (!existing) return null;
  const nextKeyword = keyword ?? existing.keyword;
  const conflict = existing.user_id
    ? stmts.getThreatKeywordByTextForUser.get(existing.user_id, nextKeyword)
    : stmts.getThreatKeywordByTextSystem.get(nextKeyword);
  if (conflict && conflict.id !== id) {
    throw new Error(existing.user_id ? "You already have a keyword with that text" : "System keyword already exists");
  }
  stmts.updateThreatKeyword.run({
    id, keyword: nextKeyword,
    caseSensitive: caseSensitive != null ? (caseSensitive ? 1 : 0) : existing.case_sensitive,
    isRegex: isRegex != null ? (isRegex ? 1 : 0) : existing.is_regex,
    enabled: enabled != null ? (enabled ? 1 : 0) : existing.enabled,
    criticality: criticality ?? existing.criticality,
  });
  return getThreatKeywordById(id);
}

function deleteThreatKeywordById(id) { stmts.deleteThreatKeywordById.run(id); }

// --- Keyword-Tag M2M ---
const _setThreatKeywordTags = db.transaction((keywordId, tagIds) => {
  stmts.setThreatKeywordTags.run(keywordId);
  for (const tid of tagIds) stmts.insertThreatKeywordTag.run(keywordId, tid);
});
function setThreatKeywordTags(keywordId, tagIds) { _setThreatKeywordTags(keywordId, tagIds); }
function getThreatKeywordTags(keywordId) { return stmts.getThreatKeywordTags.all(keywordId).map(_mapThreatTag); }
const _setThreatUserKeywordTags = db.transaction((userId, keywordId, tagIds) => {
  stmts.setThreatUserKeywordTags.run(userId, keywordId);
  for (const tid of tagIds) stmts.insertThreatUserKeywordTag.run(userId, keywordId, tid);
});
function setThreatKeywordTagsForUser(userId, keywordId, tagIds) { _setThreatUserKeywordTags(userId, keywordId, tagIds); }
function getThreatKeywordTagsForUser(userId, keywordId) {
  const systemTags = getThreatKeywordTags(keywordId);
  const userTags = stmts.getThreatUserKeywordTags.all(userId, keywordId).map(_mapThreatTag);
  const merged = [...systemTags];
  const seen = new Set(systemTags.map((tag) => tag.id));
  for (const tag of userTags) {
    if (!seen.has(tag.id)) {
      seen.add(tag.id);
      merged.push(tag);
    }
  }
  return merged;
}

// --- Tags ---
function createThreatTag({ name, color = "#E53935", description = null, userId = null }) {
  const existing = userId
    ? stmts.getThreatTagByNameForUser.get(userId, name)
    : stmts.getThreatTagByNameSystem.get(name);
  if (existing) {
    throw new Error(userId ? "You already have a tag with that name" : "System tag already exists");
  }
  const id = _tid();
  stmts.createThreatTag.run({ id, name, color, description, userId });
  return _mapThreatTag(stmts.getThreatTagById.get(id));
}
function listThreatTags(userId) {
  if (userId) {
    const system = stmts.listSystemTags.all().map(_mapThreatTag);
    const personal = stmts.listThreatTagsByUser.all(userId).map(_mapThreatTag);
    return [...system.map((t) => ({ ...t, isSystem: true })), ...personal.map((t) => ({ ...t, isSystem: false }))];
  }
  return stmts.listThreatTags.all().map(_mapThreatTag);
}
function updateThreatTag(id, { name, color, description }) {
  const existing = stmts.getThreatTagById.get(id);
  if (!existing) return null;
  const nextName = name ?? existing.name;
  const conflict = existing.user_id
    ? stmts.getThreatTagByNameForUser.get(existing.user_id, nextName)
    : stmts.getThreatTagByNameSystem.get(nextName);
  if (conflict && conflict.id !== id) {
    throw new Error(existing.user_id ? "You already have a tag with that name" : "System tag already exists");
  }
  stmts.updateThreatTag.run({ id, name: nextName, color: color ?? existing.color, description: description ?? existing.description });
  return _mapThreatTag(stmts.getThreatTagById.get(id));
}
function deleteThreatTagById(id) { stmts.deleteThreatTagById.run(id); }

// --- Alerts ---
function createThreatAlert({ feedId, keywordId, matchedContent, context, contextHash, articleHash, articleUrl, userId, matchedKeywords, apiMetadata, criticality, triggeredAt }) {
  const id = _tid();
  stmts.createThreatAlert.run({
    id, feedId, keywordId, matchedContent, context: context || null,
    contextHash: contextHash || null, articleHash: articleHash || null,
    articleUrl: articleUrl || null, userId: userId || null,
    matchedKeywords: JSON.stringify(matchedKeywords || []),
    apiMetadata: JSON.stringify(apiMetadata || {}),
    criticality: criticality || "medium", isRead: 0,
    triggeredAt: triggeredAt || Math.floor(Date.now() / 1000),
  });
  return getThreatAlertById(id);
}

function listThreatAlerts({ criticality, isRead, feedId, keywordId, hours, userId, limit = 50, offset = 0 } = {}) {
  if (userId) {
    return listThreatAlertsForUser({ criticality, isRead, feedId, keywordId, hours, userId, limit, offset });
  }
  let sql = `SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
    k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id WHERE 1=1`;
  const params = [];
  if (userId) {
    sql += " AND (a.user_id IS NULL OR a.user_id = ?)";
    params.push(userId);
  }
  if (criticality && THREAT_VALID_CRITICALITIES.has(criticality)) { sql += " AND a.criticality = ?"; params.push(criticality); }
  if (isRead != null) { sql += " AND a.is_read = ?"; params.push(isRead ? 1 : 0); }
  if (feedId) { sql += " AND a.feed_id = ?"; params.push(feedId); }
  if (keywordId) { sql += " AND a.keyword_id = ?"; params.push(keywordId); }
  if (hours) { sql += " AND a.triggered_at > unixepoch() - ? * 3600"; params.push(hours); }
  sql += " ORDER BY a.triggered_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => { const a = _mapThreatAlert(r); a.tags = stmts.getThreatAlertTags.all(r.id).map(_mapThreatTag); return a; });
}

function getThreatAlertById(id) {
  const row = stmts.getThreatAlertById.get(id);
  if (!row) return null;
  const a = _mapThreatAlert(row);
  a.tags = stmts.getThreatAlertTags.all(id).map(_mapThreatTag);
  return a;
}

function groupThreatAlertRowsForUser(rows, userId) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.id)) {
      const alert = _mapThreatAlert(row);
      alert.isRead = !!row.user_is_read;
      alert.tags = [];
      alert.keywords = [];
      alert.matchedKeywords = [];
      alert.keywordText = null;
      alert.criticality = row.user_criticality || alert.criticality;
      alert._keywordKeys = new Set();
      grouped.set(row.id, alert);
    }
    const alert = grouped.get(row.id);
    const keywordText = row.matched_keyword_text || row.keyword_text || null;
    const keywordId = row.matched_keyword_id || row.keyword_id || null;
    const keywordKey = `${keywordId || ""}:${keywordText || ""}`;
    if (keywordText && !alert._keywordKeys.has(keywordKey)) {
      alert._keywordKeys.add(keywordKey);
      const keywordEntry = {
        keywordId,
        keyword: keywordText,
        matchedText: row.user_matched_text || null,
        criticality: row.user_keyword_criticality || row.keyword_criticality || alert.criticality,
      };
      alert.keywords.push(keywordEntry);
      alert.matchedKeywords.push(keywordEntry);
    }
  }

  return [...grouped.values()].map((alert) => {
    const keywordIds = new Set((alert.keywords || []).map((item) => item.keywordId).filter(Boolean));
    const globalTags = getThreatAlertTags(alert.id);
    const explicitUserTags = stmts.getThreatUserAlertTags.all(userId, alert.id).map(_mapThreatTag);
    const derivedKeywordTags = [];
    for (const keywordId of keywordIds) {
      derivedKeywordTags.push(...getThreatKeywordTagsForUser(userId, keywordId));
    }
    const mergedTags = new Map();
    [...globalTags, ...derivedKeywordTags, ...explicitUserTags].forEach((tag) => {
      if (tag && !mergedTags.has(tag.id)) mergedTags.set(tag.id, tag);
    });
    alert.tags = [...mergedTags.values()];
    alert.keywordText = alert.keywords[0]?.keyword || alert.keywordText || null;
    delete alert._keywordKeys;
    return alert;
  });
}

function listThreatAlertsForUser({ criticality, isRead, feedId, keywordId, hours, userId, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT
      a.*,
      f.name AS feed_name,
      f.feed_type AS feed_feed_type,
      f.url AS feed_url,
      k.keyword AS keyword_text,
      uas.is_read AS user_is_read,
      uak.keyword_id AS matched_keyword_id,
      uak.matched_text AS user_matched_text,
      uak.criticality AS user_keyword_criticality,
      mk.keyword AS matched_keyword_text,
      (
        SELECT CASE MAX(
          CASE uak2.criticality
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        )
          WHEN 4 THEN 'critical'
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          ELSE 'low'
        END
        FROM threat_user_alert_keywords uak2
        WHERE uak2.user_id = ? AND uak2.alert_id = a.id
      ) AS user_criticality
    FROM threat_alerts a
    JOIN threat_user_alert_keywords uak
      ON uak.alert_id = a.id AND uak.user_id = ?
    LEFT JOIN threat_keywords mk ON mk.id = uak.keyword_id
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    LEFT JOIN threat_user_alert_state uas
      ON uas.alert_id = a.id AND uas.user_id = ?
    LEFT JOIN threat_user_hidden_alerts uha
      ON uha.alert_id = a.id AND uha.user_id = ?
    WHERE uha.alert_id IS NULL
  `;
  const params = [userId, userId, userId, userId];
  if (criticality && THREAT_VALID_CRITICALITIES.has(criticality)) {
    sql += " AND uak.criticality = ?";
    params.push(criticality);
  }
  if (isRead != null) {
    sql += " AND COALESCE(uas.is_read, 0) = ?";
    params.push(isRead ? 1 : 0);
  }
  if (feedId) {
    sql += " AND a.feed_id = ?";
    params.push(feedId);
  }
  if (keywordId) {
    sql += " AND uak.keyword_id = ?";
    params.push(keywordId);
  }
  if (hours) {
    sql += " AND a.triggered_at > unixepoch() - ? * 3600";
    params.push(hours);
  }
  sql += " ORDER BY a.triggered_at DESC";
  const rows = db.prepare(sql).all(...params);
  const alerts = groupThreatAlertRowsForUser(rows, userId);
  return alerts.slice(offset, offset + limit);
}

function getThreatAlertByIdForUser(userId, id) {
  const rows = db.prepare(`
    SELECT
      a.*,
      f.name AS feed_name,
      f.feed_type AS feed_feed_type,
      f.url AS feed_url,
      k.keyword AS keyword_text,
      uas.is_read AS user_is_read,
      uak.keyword_id AS matched_keyword_id,
      uak.matched_text AS user_matched_text,
      uak.criticality AS user_keyword_criticality,
      mk.keyword AS matched_keyword_text,
      (
        SELECT CASE MAX(
          CASE uak2.criticality
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        )
          WHEN 4 THEN 'critical'
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          ELSE 'low'
        END
        FROM threat_user_alert_keywords uak2
        WHERE uak2.user_id = ? AND uak2.alert_id = a.id
      ) AS user_criticality
    FROM threat_alerts a
    JOIN threat_user_alert_keywords uak
      ON uak.alert_id = a.id AND uak.user_id = ?
    LEFT JOIN threat_keywords mk ON mk.id = uak.keyword_id
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    LEFT JOIN threat_user_alert_state uas
      ON uas.alert_id = a.id AND uas.user_id = ?
    LEFT JOIN threat_user_hidden_alerts uha
      ON uha.alert_id = a.id AND uha.user_id = ?
    WHERE a.id = ? AND uha.alert_id IS NULL
    ORDER BY a.triggered_at DESC
  `).all(userId, userId, userId, userId, id);
  if (!rows.length) return null;
  return groupThreatAlertRowsForUser(rows, userId)[0] || null;
}

function updateThreatAlert(id, updates) {
  if (updates.isRead != null) stmts.updateThreatAlertRead.run({ id, isRead: updates.isRead ? 1 : 0 });
  if (updates.criticality && THREAT_VALID_CRITICALITIES.has(updates.criticality))
    stmts.updateThreatAlertCriticality.run({ id, criticality: updates.criticality });
}

function updateThreatAlertForUser(userId, id, updates) {
  if (updates.isRead != null) {
    stmts.upsertThreatUserAlertState.run({ userId, alertId: id, isRead: updates.isRead ? 1 : 0 });
  }
  return getThreatAlertByIdForUser(userId, id);
}

function markAllThreatAlertsRead() {
  const result = stmts.markAllThreatAlertsRead.run();
  return result.changes;
}

function markAllThreatAlertsReadForUser(userId) {
  const alerts = listThreatAlertsForUser({ userId, limit: 100000, offset: 0 });
  let changed = 0;
  for (const alert of alerts) {
    if (!alert.isRead) {
      stmts.upsertThreatUserAlertState.run({ userId, alertId: alert.id, isRead: 1 });
      changed += 1;
    }
  }
  return changed;
}

function deleteThreatAlertById(id) {
  const alert = stmts.getThreatAlertById.get(id);
  if (alert) {
    stmts.createThreatSuppressedAlert.run({
      id: _tid(), feedId: alert.feed_id, articleHash: alert.article_hash,
      contextHash: alert.context_hash, keywordId: alert.keyword_id,
    });
  }
  stmts.deleteThreatUserAlertKeywordRowsByAlert.run(id);
  stmts.deleteThreatUserAlertStateByAlert.run(id);
  stmts.deleteThreatUserAlertTagsByAlert.run(id);
  stmts.deleteThreatHiddenAlertByAlert.run(id);
  stmts.deleteThreatAlertById.run(id);
}

function hideThreatAlertForUser(userId, alertId) {
  stmts.hideThreatAlertForUser.run(userId, alertId);
}

function cleanupOldThreatAlerts(days) {
  const result = stmts.cleanupOldThreatAlerts.run(days);
  return result.changes;
}

function createOrUpdateThreatArticle(article) {
  if (!article?.feedId || !article?.articleHash || !article?.headline) return null;
  const existing = stmts.getThreatArticleByHash.get(article.feedId, article.articleHash);
  if (existing) {
    stmts.updateThreatArticle.run({
      id: existing.id,
      headline: article.headline,
      summary: article.summary || null,
      content: article.content || null,
      articleUrl: article.articleUrl || null,
      imageUrl: article.imageUrl || null,
      apiMetadata: JSON.stringify(article.apiMetadata || {}),
      publishedAt: article.publishedAt || null,
    });
    return getThreatArticleById(existing.id);
  }

  const id = _tid();
  stmts.createThreatArticle.run({
    id,
    feedId: article.feedId,
    articleHash: article.articleHash,
    headline: article.headline,
    summary: article.summary || null,
    content: article.content || null,
    articleUrl: article.articleUrl || null,
    imageUrl: article.imageUrl || null,
    apiMetadata: JSON.stringify(article.apiMetadata || {}),
    publishedAt: article.publishedAt || null,
  });
  return getThreatArticleById(id);
}

function listThreatArticles({ hours, limit = 24, offset = 0 } = {}) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : null;
  return stmts.listThreatArticles.all(safeHours, safeHours, limit, offset).map(_mapThreatArticle);
}

function getThreatArticleByHash(feedId, articleHash) {
  const row = stmts.getThreatArticleByHash.get(feedId, articleHash);
  return row ? _mapThreatArticle(row) : null;
}

function getThreatArticleById(id) {
  const row = stmts.getThreatArticleById.get(id);
  return row ? _mapThreatArticle(row) : null;
}

function cleanupOldThreatArticles(days) {
  const result = stmts.cleanupOldThreatArticles.run(days);
  return result.changes;
}

// --- Alert-Tag M2M ---
const _setThreatAlertTags = db.transaction((alertId, tagIds) => {
  stmts.setThreatAlertTags.run(alertId);
  for (const tid of tagIds) stmts.insertThreatAlertTag.run(alertId, tid);
});
function setThreatAlertTags(alertId, tagIds) { _setThreatAlertTags(alertId, tagIds); }
function getThreatAlertTags(alertId) { return stmts.getThreatAlertTags.all(alertId).map(_mapThreatTag); }
const _setThreatAlertTagsForUser = db.transaction((userId, alertId, tagIds) => {
  stmts.setThreatUserAlertTags.run(userId, alertId);
  for (const tid of tagIds) stmts.insertThreatUserAlertTag.run(userId, alertId, tid);
});
function setThreatAlertTagsForUser(userId, alertId, tagIds) { _setThreatAlertTagsForUser(userId, alertId, tagIds); }
function getThreatAlertTagsForUser(userId, alertId) {
  const globalTags = getThreatAlertTags(alertId);
  const userTags = stmts.getThreatUserAlertTags.all(userId, alertId).map(_mapThreatTag);
  const seen = new Set();
  return [...globalTags, ...userTags].filter((tag) => {
    if (!tag || seen.has(tag.id)) return false;
    seen.add(tag.id);
    return true;
  });
}

// --- User Keyword Overrides ---
function disableSystemKeywordForUser(userId, keywordId) {
  stmts.disableSystemKeywordForUser.run(userId, keywordId);
}
function enableSystemKeywordForUser(userId, keywordId) {
  stmts.enableSystemKeywordForUser.run(userId, keywordId);
}
function isSystemKeywordDisabledForUser(userId, keywordId) {
  return !!stmts.isSystemKeywordDisabledForUser.get(userId, keywordId);
}
function getDisabledKeywordIdsForUser(userId) {
  return stmts.getDisabledKeywordIdsForUser.all(userId).map((r) => r.keyword_id);
}

function upsertThreatUserAlertKeyword({ userId, alertId, keywordId, matchedText, criticality }) {
  stmts.upsertThreatUserAlertKeyword.run({
    userId,
    alertId,
    keywordId,
    matchedText: matchedText || null,
    criticality: criticality || "medium",
  });
}

function listThreatUsersEligibleForAlerts() {
  return stmts.listThreatEligibleUsers.all().map((row) => ({
    id: row.id,
    email: row.email,
    username: row.username,
    suspended: !!row.suspended,
    roleId: row.role_id || null,
  }));
}

// --- Suppressed Alerts ---
function isThreatAlertSuppressed(feedId, articleHash, contextHash, keywordId) {
  return !!stmts.isThreatAlertSuppressed.get(feedId, articleHash || null, contextHash || null, keywordId || null);
}
function threatAlertExistsByArticleHash(feedId, articleHash) {
  return !!stmts.alertExistsByArticleHash.get(feedId, articleHash || null);
}
function getThreatAlertByArticleHash(feedId, articleHash) {
  if (!feedId || !articleHash) return null;
  const row = db.prepare(`
    SELECT a.*, f.name AS feed_name, f.feed_type AS feed_feed_type, f.url AS feed_url,
      k.keyword AS keyword_text, k.criticality AS keyword_criticality
    FROM threat_alerts a
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    WHERE a.feed_id = ? AND a.article_hash = ?
    ORDER BY a.triggered_at DESC
    LIMIT 1
  `).get(feedId, articleHash);
  if (!row) return null;
  const alert = _mapThreatAlert(row);
  alert.tags = stmts.getThreatAlertTags.all(alert.id).map(_mapThreatTag);
  return alert;
}
function getThreatAlertByArticleHashForUser(userId, feedId, articleHash) {
  if (!userId || !feedId || !articleHash) return null;
  const rows = db.prepare(`
    SELECT
      a.*,
      f.name AS feed_name,
      f.feed_type AS feed_feed_type,
      f.url AS feed_url,
      k.keyword AS keyword_text,
      uas.is_read AS user_is_read,
      uak.keyword_id AS matched_keyword_id,
      uak.matched_text AS user_matched_text,
      uak.criticality AS user_keyword_criticality,
      mk.keyword AS matched_keyword_text,
      (
        SELECT CASE MAX(
          CASE uak2.criticality
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END
        )
          WHEN 4 THEN 'critical'
          WHEN 3 THEN 'high'
          WHEN 2 THEN 'medium'
          ELSE 'low'
        END
        FROM threat_user_alert_keywords uak2
        WHERE uak2.user_id = ? AND uak2.alert_id = a.id
      ) AS user_criticality
    FROM threat_alerts a
    JOIN threat_user_alert_keywords uak
      ON uak.alert_id = a.id AND uak.user_id = ?
    LEFT JOIN threat_keywords mk ON mk.id = uak.keyword_id
    LEFT JOIN threat_feeds f ON a.feed_id = f.id
    LEFT JOIN threat_keywords k ON a.keyword_id = k.id
    LEFT JOIN threat_user_alert_state uas
      ON uas.alert_id = a.id AND uas.user_id = ?
    LEFT JOIN threat_user_hidden_alerts uha
      ON uha.alert_id = a.id AND uha.user_id = ?
    WHERE a.feed_id = ? AND a.article_hash = ? AND uha.alert_id IS NULL
    ORDER BY a.triggered_at DESC
  `).all(userId, userId, userId, userId, feedId, articleHash);
  if (!rows.length) return null;
  return groupThreatAlertRowsForUser(rows, userId)[0] || null;
}
function threatAlertExistsByContextHash(feedId, keywordId, contextHash) {
  return !!stmts.alertExistsByContextHash.get(feedId, keywordId || null, contextHash || null);
}
function threatAlertExistsByFeedKeyword(feedId, keywordId) {
  return !!stmts.alertExistsByFeedKeyword.get(feedId, keywordId || null);
}
function listThreatAlertUserIds(alertId) {
  return db.prepare(`
    SELECT DISTINCT user_id
    FROM threat_user_alert_keywords
    WHERE alert_id = ?
  `).all(alertId).map((row) => row.user_id);
}

// --- API Templates ---
function createThreatApiTemplate({ name, description, configuration, isSystem = false, enabled = true }) {
  const id = _tid();
  stmts.createThreatApiTemplate.run({ id, name, description: description || null, configuration: JSON.stringify(configuration || {}), isSystem: isSystem ? 1 : 0, enabled: enabled ? 1 : 0 });
  return stmts.getThreatApiTemplateById.get(id);
}
function listThreatApiTemplates() { return stmts.listThreatApiTemplates.all().map(_mapThreatApiTemplate); }
function getThreatApiTemplateById(id) { const r = stmts.getThreatApiTemplateById.get(id); return r ? _mapThreatApiTemplate(r) : null; }
function updateThreatApiTemplate(id, { name, description, configuration, enabled }) {
  const existing = stmts.getThreatApiTemplateById.get(id);
  if (!existing) return null;
  stmts.updateThreatApiTemplate.run({ id, name: name ?? existing.name, description: description ?? existing.description, configuration: configuration ? JSON.stringify(configuration) : existing.configuration, enabled: enabled != null ? (enabled ? 1 : 0) : existing.enabled });
  return _mapThreatApiTemplate(stmts.getThreatApiTemplateById.get(id));
}
function deleteThreatApiTemplateById(id) { return stmts.deleteThreatApiTemplateById.run(id).changes > 0; }

// --- Notification Configs ---
function createThreatNotificationConfig({ name, channelType, destination, enabled = true }) {
  const id = _tid();
  stmts.createThreatNotificationConfig.run({ id, name, channelType, destination, enabled: enabled ? 1 : 0 });
  return stmts.getThreatNotificationConfigById.get(id);
}
function listThreatNotificationConfigs() { return stmts.listThreatNotificationConfigs.all().map(_mapThreatNotifConfig); }
function listThreatNotificationConfigsEnabled() { return stmts.listThreatNotificationConfigsEnabled.all().map(_mapThreatNotifConfig); }
function updateThreatNotificationConfig(id, { name, destination, enabled }) {
  const existing = stmts.getThreatNotificationConfigById.get(id);
  if (!existing) return null;
  stmts.updateThreatNotificationConfig.run({ id, name: name ?? existing.name, destination: destination ?? existing.destination, enabled: enabled != null ? (enabled ? 1 : 0) : existing.enabled });
  return stmts.getThreatNotificationConfigById.get(id);
}
function deleteThreatNotificationConfigById(id) { return stmts.deleteThreatNotificationConfigById.run(id).changes > 0; }

// --- User Notifications ---
function upsertThreatUserNotification({ userId, channelType, destination, enabled = true }) {
  const id = _tid();
  stmts.createThreatUserNotification.run({ id, userId, channelType, destination, enabled: enabled ? 1 : 0 });
  return stmts.listThreatUserNotifications.all(userId).map(_mapThreatUserNotif);
}
function listThreatUserNotifications(userId) { return stmts.listThreatUserNotifications.all(userId).map(_mapThreatUserNotif); }
function deleteThreatUserNotificationById(id, userId) { return stmts.deleteThreatUserNotificationById.run(id, userId).changes > 0; }

// --- Stats & Health ---
function getThreatStats() {
  const feeds = stmts.countThreatFeeds.get();
  const feedsEnabled = stmts.countThreatFeedsEnabled.get();
  const feedsHealthy = stmts.countThreatFeedsHealthy.get();
  const keywords = stmts.countThreatKeywords.get();
  const keywordsEnabled = stmts.countThreatKeywordsEnabled.get();
  const alerts = stmts.countThreatAlerts.get();
  const alertsUnread = stmts.countThreatAlertsUnread.get();
  const alertsLast24h = stmts.countThreatAlertsLast24h.get();
  const criticalityDistribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const row of stmts.countThreatAlertsByCriticality.all()) {
    if (row?.criticality && Object.prototype.hasOwnProperty.call(criticalityDistribution, row.criticality)) {
      criticalityDistribution[row.criticality] = row.count;
    }
  }
  return {
    totalFeeds: feeds.total, activeFeeds: feedsEnabled.total, healthyFeeds: feedsHealthy.total,
    totalKeywords: keywords.total, activeKeywords: keywordsEnabled.total,
    totalAlerts: alerts.total, unreadAlerts: alertsUnread.total, alertsLast24h: alertsLast24h.total,
    criticalityDistribution,
  };
}

function getThreatStatsForUser(userId) {
  const feeds = stmts.countThreatFeeds.get();
  const feedsEnabled = stmts.countThreatFeedsEnabled.get();
  const feedsHealthy = stmts.countThreatFeedsHealthy.get();
  const keywords = listThreatKeywordsForUser(userId);
  const activeKeywords = keywords.filter((keyword) => keyword.enabled);
  const alerts = listThreatAlertsForUser({ userId, limit: 100000, offset: 0 });
  const criticalityDistribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  let unreadAlerts = 0;
  let alertsLast24h = 0;
  const dayAgo = Math.floor(Date.now() / 1000) - 86400;

  for (const alert of alerts) {
    if (Object.prototype.hasOwnProperty.call(criticalityDistribution, alert.criticality)) {
      criticalityDistribution[alert.criticality] += 1;
    }
    if (!alert.isRead) unreadAlerts += 1;
    if ((alert.triggeredAt || 0) >= dayAgo) alertsLast24h += 1;
  }

  return {
    totalFeeds: feeds.total,
    activeFeeds: feedsEnabled.total,
    healthyFeeds: feedsHealthy.total,
    totalKeywords: keywords.length,
    activeKeywords: activeKeywords.length,
    totalAlerts: alerts.length,
    unreadAlerts,
    alertsLast24h,
    criticalityDistribution,
  };
}

function getThreatFeedHealth() {
  const feeds = listThreatFeeds(false).map((feed) => ({
    ...feed,
    status: feed.status || "unknown",
  }));
  const counts = {
    total: feeds.length,
    healthy: 0,
    warning: 0,
    error: 0,
    disabled: 0,
    unknown: 0,
  };

  for (const feed of feeds) {
    switch (feed.status) {
      case "disabled":
        counts.disabled += 1;
        break;
      case "error":
        counts.error += 1;
        break;
      case "warning":
        counts.warning += 1;
        break;
      case "healthy":
        counts.healthy += 1;
        break;
      default:
        counts.unknown += 1;
        break;
    }
  }

  let overall = "healthy";
  if (counts.error > 0) overall = "error";
  else if (counts.warning > 0 || counts.unknown > 0) overall = "warning";

  return {
    counts,
    feeds,
    overallStatus: overall,
  };
}

function getThreatFeedErrors() { return stmts.getThreatFeedErrors.all().map(_mapThreatFeed); }

// --- Seed ---
function seedDefaultThreatData() {
  const summary = {
    templatesCreated: 0,
    tagsCreated: 0,
    feedsCreated: 0,
    feedsUpdated: 0,
    keywordsCreated: 0,
  };
  const templates = [
    { name: "RansomFeed.it", description: "Ransomware victim data from RansomFeed.it API", configuration: { endpoint: "https://api.ransomfeed.it/", method: "GET", headers: { "User-Agent": "ThreatAlert/1.0" }, auth: { type: "none" }, field_mapping: { content_fields: ["victim", "gang", "description", "country", "work_sector"], metadata_fields: { victim_name: "victim", threat_actor: "gang", country: "country", industry: "work_sector", attack_date: "date", victim_website: "website" } } }, isSystem: true },
    { name: "RansomLook Recent", description: "Recent ransomware posts from RansomLook API", configuration: { endpoint: "https://www.ransomlook.io/api/recent", method: "GET", headers: {}, auth: { type: "none" }, field_mapping: { content_fields: ["post_title", "group_name", "discovered"], metadata_fields: { victim_name: "post_title", threat_actor: "group_name", attack_date: "discovered", victim_website: "post_url" } } }, isSystem: true },
  ];
  const templateIds = {};
  for (const t of templates) {
    const existing = stmts.getThreatApiTemplateByName.get(t.name);
    if (existing) {
      stmts.updateThreatApiTemplate.run({
        id: existing.id,
        name: t.name,
        description: t.description,
        configuration: JSON.stringify(t.configuration),
        enabled: 1,
      });
      templateIds[t.name] = existing.id;
      continue;
    }
    const id = _tid();
    stmts.createThreatApiTemplate.run({ id, name: t.name, description: t.description, configuration: JSON.stringify(t.configuration), isSystem: t.isSystem ? 1 : 0, enabled: 1 });
    summary.templatesCreated += 1;
    templateIds[t.name] = id;
  }

  const tags = [
    { name: "X (Twitter)", color: "#000000", description: "Sources pulled from X/Twitter via nitter.net" },
    { name: "Ransomware Gang", color: "#540ed8", description: "Ransomware group onion sites" },
    { name: "Default Watchlist", color: "#E53935", description: "Default RedSecThreat keyword pack for out-of-box detections" },
  ];
  const tagIds = {};
  for (const t of tags) {
    const existing = stmts.getThreatTagByName.get(t.name);
    if (existing) {
      stmts.updateThreatTag.run({ id: existing.id, name: t.name, color: t.color, description: t.description });
      tagIds[t.name] = existing.id;
      continue;
    }
    const id = _tid();
    stmts.createThreatTag.run({ id, name: t.name, color: t.color, description: t.description, userId: null });
    summary.tagsCreated += 1;
    tagIds[t.name] = id;
  }

  const defaultKeywords = [
    { keyword: "ransomware", criticality: "critical" },
    { keyword: "breach", criticality: "high" },
    { keyword: "vulnerability", criticality: "medium" },
    { keyword: "phishing", criticality: "high" },
    { keyword: "spear[ -]?phish", criticality: "high", isRegex: true },
    { keyword: "exploit", criticality: "high" },
    { keyword: "remote code execution", criticality: "critical" },
    { keyword: "\\bRCE\\b", criticality: "critical", isRegex: true },
    { keyword: "infostealer", criticality: "high" },
    { keyword: "credential[ -]?(dump|theft|harvest|stuffing)", criticality: "high", isRegex: true },
    { keyword: "valid accounts?", criticality: "high", isRegex: true },
    { keyword: "account takeover", criticality: "high" },
    { keyword: "password spray", criticality: "high" },
    { keyword: "brute force", criticality: "medium" },
    { keyword: "\\bMimikatz\\b", criticality: "high", isRegex: true },
    { keyword: "\\bLSASS\\b", criticality: "high", isRegex: true },
    { keyword: "Kerberoast", criticality: "high" },
    { keyword: "Pass[ -]?the[ -]?Hash", criticality: "high", isRegex: true },
    { keyword: "web shell", criticality: "high" },
    { keyword: "malicious attachment", criticality: "medium" },
    { keyword: "PowerShell", criticality: "medium" },
    { keyword: "scheduled task", criticality: "medium" },
    { keyword: "\\bWMI\\b", criticality: "medium", isRegex: true },
    { keyword: "privilege escalation", criticality: "high" },
    { keyword: "living off the land", criticality: "medium" },
    { keyword: "\\bLOLBAS\\b", criticality: "medium", isRegex: true },
    { keyword: "disable(d)? (EDR|antivirus|defender)", criticality: "high", isRegex: true },
    { keyword: "process injection", criticality: "medium" },
    { keyword: "obfuscat(ed|ion)", criticality: "medium", isRegex: true },
    { keyword: "clear(ed)? logs", criticality: "medium", isRegex: true },
    { keyword: "lateral movement", criticality: "high" },
    { keyword: "\\b(RDP|SMB|WinRM|PsExec)\\b", criticality: "medium", isRegex: true },
    { keyword: "network discovery", criticality: "medium" },
    { keyword: "port scan", criticality: "medium" },
    { keyword: "command and control", criticality: "high" },
    { keyword: "\\bC2\\b", criticality: "high", isRegex: true },
    { keyword: "beacon", criticality: "medium" },
    { keyword: "payload download", criticality: "medium" },
    { keyword: "data leak", criticality: "high" },
    { keyword: "data exfiltration", criticality: "high" },
    { keyword: "stolen data", criticality: "high" },
    { keyword: "\\bDDoS\\b", criticality: "medium", isRegex: true },
    { keyword: "wiper", criticality: "critical" },
    { keyword: "shadow copies", criticality: "critical" },
    { keyword: "zero[ -]?day", criticality: "critical", isRegex: true },
    { keyword: "CVE-\\d{4}-\\d{4,7}", criticality: "high", isRegex: true },
  ];
  const defaultKeywordTagId = tagIds["Default Watchlist"] || null;
  for (const keywordDef of defaultKeywords) {
    const existing = stmts.getThreatKeywordByText.get(keywordDef.keyword);
    let keywordId = existing?.id || null;
    if (!existing) {
      const created = createThreatKeyword({
        keyword: keywordDef.keyword,
        criticality: keywordDef.criticality,
        isRegex: keywordDef.isRegex === true,
        enabled: true,
      });
      keywordId = created.id;
      summary.keywordsCreated += 1;
    }
    if (defaultKeywordTagId && keywordId) {
      const existingTagIds = getThreatKeywordTags(keywordId).map((tag) => tag.id);
      setThreatKeywordTags(keywordId, [...new Set([...existingTagIds, defaultKeywordTagId])]);
    }
  }

  const feeds = [
    { name: "Bleeping Computer Security", url: "https://www.bleepingcomputer.com/feed/", type: "rss", interval: 3600 },
    { name: "CISA Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/all.xml", type: "rss", interval: 3600, legacyUrls: ["https://www.cisa.gov/news.xml"] },
    { name: "Dark Reading", url: "https://www.darkreading.com/rss.xml", type: "rss", interval: 3600 },
    { name: "Dark Web Informer (RSS)", url: "https://nitter.net/DarkWebInformer/rss", type: "rss", interval: 3600, tag: "X (Twitter)", matchNames: ["Dark Web Informer (RSS)", "Dark Web Informer"], legacyUrls: ["https://nitter.net/DWInformer/rss"] },
    { name: "Hackmanac", url: "https://nitter.net/H4ckmanac/rss", type: "rss", interval: 3600, tag: "X (Twitter)", legacyUrls: ["https://nitter.net/hackmanac/rss"] },
    { name: "HaveIBeenPwned Breach Feed", url: "https://haveibeenpwned.com/feed/breaches", type: "rss", interval: 3600, matchNames: ["HaveIBeenPwned Breach Feed", "HIBP Breach Feed"], legacyUrls: ["https://haveibeenpwned.com/feed"] },
    { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", type: "rss", interval: 7200 },
    { name: "LuemmelSec", url: "https://nitter.net/theluemmel/rss", type: "rss", interval: 3600, tag: "X (Twitter)", legacyUrls: ["https://nitter.net/luemmelSec/rss"] },
    { name: "Security Affairs", url: "https://securityaffairs.com/feed", type: "rss", interval: 7200, legacyUrls: ["https://securityaffairs.co/wordpress/feed"] },
    { name: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews", type: "rss", interval: 3600 },
    { name: "Threat Post", url: "https://threatpost.com/feed/", type: "rss", interval: 3600 },
    { name: "International Cyber Digest", url: "https://nitter.net/IntCyberDigest/rss", type: "rss", interval: 3600, tag: "X (Twitter)", legacyUrls: ["https://nitter.net/cyberdigest/rss"] },
    { name: "Dark Web Intelligence", url: "https://nitter.net/DailyDarkWeb/rss", type: "rss", interval: 3600, tag: "X (Twitter)" },
    { name: "Defused", url: "https://nitter.net/DefusedCyber/rss", type: "rss", interval: 3600, tag: "X (Twitter)", legacyUrls: ["https://nitter.net/defused/rss"] },
    { name: "Dark Web Informer", url: "https://darkwebinformer.com/", type: "website", interval: 3600 },
    { name: "Infostealers.com", url: "https://www.infostealers.com/infostealer-victims/", type: "website", interval: 3600 },
    { name: "Ransomware.live", url: "https://www.ransomware.live/", type: "website", interval: 3600 },
    { name: "RansomFeed.it", url: "https://api.ransomfeed.it/", type: "api", interval: 3600, templateId: templateIds["RansomFeed.it"], matchNames: ["RansomFeed.it", "Ransomfeed.it"] },
    { name: "RansomLook API Recent", url: "https://www.ransomlook.io/api/recent", type: "api", interval: 3600, templateId: templateIds["RansomLook Recent"] },
    { name: "Coinbasecartel", url: "http://fjg4zi4opkxkvdz7mvwp7h6goe4tcby3hhkrz43pht4j3vakhy75znyd.onion", type: "onion", interval: 3600, tag: "Ransomware Gang", disabled: true, legacyUrls: ["http://coinbasecartel4sgdkafgk3e4p6r5yrsuktrkcrlpjsojnrt7ipg5qflbid.onion"] },
    { name: "DragonForce", url: "http://z3wqggtxft7id3ibr7srivv5gjof5fwg76slewnzwwakjuf3nlhukdid.onion/blog", type: "onion", interval: 3600, tag: "Ransomware Gang", disabled: true, legacyUrls: ["http://dragonforce5ukrugcopagffebdepkzghyoqwekw3jy5hr7gkye3c3ja6id.onion"] },
    { name: "LockBit", url: "http://lockbit3753ekiocyo5epmpy6klmejchjtzddoekjlnt6mu3qh4de2id.onion/", type: "onion", interval: 3600, tag: "Ransomware Gang", disabled: true, legacyUrls: ["http://lockbit3753ekiocyo5epmxsfipsmai2olavxdqbtn5fc6qsxjggd.onion"] },
    { name: "Qilin", url: "http://ijzn3sicrcy7guixkzjkib4ukbiilwc3xhnmby4mcbccnsd7j2rekvqd.onion/", type: "onion", interval: 3600, tag: "Ransomware Gang", disabled: true, legacyUrls: ["http://kbsqoivihgciok4s4wpgesuqrtvopsohro3omksqbfk6yoxjdtf3u2id.onion"] },
    { name: "ShadowByt3$ LEAKS", url: "http://sdwbytqeb664krp2wz2qs3lxxah2rhneuotot5hy7g4jpn2pindigcad.onion/leaks.php", type: "onion", interval: 3600, tag: "Ransomware Gang", disabled: true, matchNames: ["ShadowByt3$", "ShadowByt3$ LEAKS"], legacyUrls: ["http://6s7uetnhnpcokjv4r7v3q24wtsvi2z7yox6shmnzebq2smutyzclq3ad.onion"] },
  ];

  const existingFeeds = stmts.listThreatFeeds.all().map(_mapThreatFeed);
  for (const f of feeds) {
    const metadata = f.templateId ? JSON.stringify({ template_id: f.templateId }) : "{}";
    const matchNames = new Set([f.name, ...(f.matchNames || [])]);
    const matchUrls = new Set([f.url, ...(f.legacyUrls || [])]);
    const existing = existingFeeds.find((row) =>
      row.feedType === f.type &&
      (matchNames.has(row.name) || matchUrls.has(row.url))
    );

    let feedId;
    if (existing) {
      const updated = updateThreatFeed(existing.id, {
        name: f.name,
        url: f.url,
        feedType: f.type,
        enabled: existing.enabled,
        isDefault: true,
        fetchInterval: f.interval,
        feedMetadata: metadata,
      });
      feedId = updated?.id || existing.id;
      summary.feedsUpdated += 1;
    } else {
      const created = createThreatFeed({
        name: f.name,
        url: f.url,
        feedType: f.type,
        enabled: !f.disabled,
        isDefault: true,
        fetchInterval: f.interval,
        feedMetadata: metadata,
      });
      feedId = created.id;
      summary.feedsCreated += 1;
    }

    if (f.tag && tagIds[f.tag]) {
      const existingTagIds = getThreatFeedTags(feedId).map((tag) => tag.id);
      setThreatFeedTags(feedId, [...new Set([...existingTagIds, tagIds[f.tag]])]);
    }
  }

  return summary;
}

// --- Mappers ---
function _mapThreatFeed(r) {
  const lastChecked = r.last_fetched_at || null;
  const lastErrorAt = r.last_error_at || null;
  let status = "unknown";
  if (!r.enabled) status = "disabled";
  else if ((r.consecutive_failures || 0) >= 3) status = "error";
  else if ((r.consecutive_failures || 0) >= 1) status = "warning";
  else if (lastChecked) status = "healthy";
  return {
    id: r.id, name: r.name, url: r.url, feedType: r.feed_type,
    enabled: !!r.enabled, isDefault: !!r.is_default,
    fetchInterval: r.fetch_interval, lastFetchedAt: r.last_fetched_at,
    lastContentHash: r.last_content_hash, feedMetadata: r.feed_metadata ? JSON.parse(r.feed_metadata) : {},
    lastError: r.last_error, lastErrorAt: r.last_error_at,
    consecutiveFailures: r.consecutive_failures,
    lastChecked,
    status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function _mapThreatKeyword(r) {
  return {
    id: r.id, keyword: r.keyword, caseSensitive: !!r.case_sensitive,
    isRegex: !!r.is_regex, enabled: !!r.enabled, criticality: r.criticality,
    userId: r.user_id || null, isSystem: !r.user_id,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function _mapThreatTag(r) {
  return { id: r.id, name: r.name, color: r.color, description: r.description, userId: r.user_id || null, isSystem: !r.user_id, createdAt: r.created_at };
}
function _mapThreatAlert(r) {
  const matchedKeywords = JSON.parse(r.matched_keywords || "[]");
  const apiMeta = JSON.parse(r.api_metadata || "{}");
  return {
    id: r.id, feedId: r.feed_id, keywordId: r.keyword_id,
    matchedContent: r.matched_content, context: r.context,
    contextHash: r.context_hash, articleHash: r.article_hash,
    articleUrl: r.article_url || null,
    userId: r.user_id || null, isPersonal: !!r.user_id,
    matchedKeywords,
    keywords: matchedKeywords,
    apiMetadata: apiMeta,
    iocs: apiMeta.iocs || {},
    criticality: r.criticality, isRead: !!r.is_read,
    triggeredAt: r.triggered_at, createdAt: r.created_at,
    feedName: r.feed_name || null,
    feedType: r.feed_feed_type || null,
    feedUrl: r.feed_url || null,
    keywordText: r.keyword_text || null,
    feed: r.feed_name ? { name: r.feed_name, feedType: r.feed_feed_type, url: r.feed_url } : null,
    keyword: r.keyword_text || null,
  };
}
function _mapThreatArticle(r) {
  return {
    id: r.id,
    feedId: r.feed_id,
    articleHash: r.article_hash,
    headline: r.headline,
    summary: r.summary || "",
    content: r.content || "",
    articleUrl: r.article_url || null,
    imageUrl: r.image_url || "",
    apiMetadata: JSON.parse(r.api_metadata || "{}"),
    publishedAt: r.published_at || null,
    lastSeenAt: r.last_seen_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    feedName: r.feed_name || null,
    feedType: r.feed_feed_type || null,
    feedUrl: r.feed_url || null,
  };
}
function _mapThreatApiTemplate(r) {
  return {
    id: r.id, name: r.name, description: r.description,
    configuration: JSON.parse(r.configuration || "{}"),
    isSystem: !!r.is_system, enabled: !!r.enabled,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function _mapThreatNotifConfig(r) {
  return { id: r.id, name: r.name, channelType: r.channel_type, destination: r.destination, enabled: !!r.enabled, createdAt: r.created_at };
}
function _mapThreatUserNotif(r) {
  return { id: r.id, userId: r.user_id, channelType: r.channel_type, destination: r.destination, enabled: !!r.enabled, createdAt: r.created_at, updatedAt: r.updated_at };
}

function _mapAuditEvent(r) {
  let metadata = {};
  try {
    metadata = JSON.parse(r.metadata_json || "{}");
  } catch {
    metadata = {};
  }
  return {
    id: r.id,
    actorUserId: r.actor_user_id || null,
    actorUsername: r.actor_username || null,
    actorType: r.actor_type || "system",
    ipAddress: r.ip_address || null,
    userAgent: r.user_agent || null,
    category: r.category,
    action: r.action,
    targetType: r.target_type || null,
    targetId: r.target_id || null,
    outcome: r.outcome || "success",
    metadata,
    createdAt: r.created_at,
  };
}

function createAuditEvent(event) {
  const payload = {
    id: event.id || crypto.randomBytes(16).toString("base64url"),
    actorUserId: event.actorUserId || null,
    actorUsername: event.actorUsername || null,
    actorType: event.actorType || (event.actorUserId ? "user" : "system"),
    ipAddress: event.ipAddress || null,
    userAgent: event.userAgent || null,
    category: event.category || "general",
    action: event.action || "unknown",
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    outcome: event.outcome || "success",
    metadataJson: JSON.stringify(redactObject(event.metadata || {})),
  };
  stmts.createAuditEvent.run(payload);
  return payload.id;
}

function listAuditEvents(filters = {}) {
  const limit = Math.min(500, Math.max(1, parseInt(filters.limit, 10) || 100));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
  const params = {
    actorUserId: filters.actorUserId || null,
    category: filters.category || null,
    action: filters.action || null,
    outcome: filters.outcome || null,
    targetType: filters.targetType || null,
    targetId: filters.targetId || null,
    fromTs: Number.isFinite(filters.fromTs) ? filters.fromTs : null,
    toTs: Number.isFinite(filters.toTs) ? filters.toTs : null,
    limit,
    offset,
  };
  const events = stmts.listAuditEvents.all(params).map(_mapAuditEvent);
  const total = stmts.countAuditEventsFiltered.get(params).total;
  return { events, total, limit, offset };
}

function listSchemaMigrations() {
  return stmts.listSchemaMigrations.all().map((row) => ({
    id: row.id,
    description: row.description || "",
    appliedAt: row.applied_at,
  }));
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapServiceAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    scopes: parseJsonList(row.scopes_json),
    enabled: !!row.enabled,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapServiceAccountToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    serviceAccountId: row.service_account_id,
    label: row.label,
    prefix: row.prefix,
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    lastUsedAt: row.last_used_at || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
  };
}

function createServiceAccount({ id, name, description = "", scopes = [], enabled = true, createdBy = null }) {
  const serviceAccountId = id || crypto.randomBytes(16).toString("base64url");
  stmts.createServiceAccount.run({
    id: serviceAccountId,
    name,
    description,
    scopesJson: JSON.stringify(Array.isArray(scopes) ? scopes : []),
    enabled: enabled ? 1 : 0,
    createdBy,
  });
  return getServiceAccountById(serviceAccountId);
}

function updateServiceAccount({ id, name, description = "", scopes = [], enabled = true }) {
  const result = stmts.updateServiceAccount.run({
    id,
    name,
    description,
    scopesJson: JSON.stringify(Array.isArray(scopes) ? scopes : []),
    enabled: enabled ? 1 : 0,
  });
  return result.changes > 0 ? getServiceAccountById(id) : null;
}

function getServiceAccountById(id) {
  return mapServiceAccount(stmts.getServiceAccountById.get(id));
}

function listServiceAccounts() {
  return stmts.listServiceAccounts.all().map((row) => ({
    ...mapServiceAccount(row),
    tokens: stmts.listServiceAccountTokens.all(row.id).map(mapServiceAccountToken),
  }));
}

function createServiceAccountToken({ id, serviceAccountId, tokenHash, label, prefix, expiresAt = null, createdBy = null }) {
  const tokenId = id || crypto.randomBytes(16).toString("base64url");
  stmts.createServiceAccountToken.run({
    id: tokenId,
    serviceAccountId,
    tokenHash,
    label,
    prefix,
    expiresAt,
    createdBy,
  });
  return tokenId;
}

function getServiceAccountTokenByHash(tokenHash) {
  const row = stmts.getServiceAccountTokenByHash.get(tokenHash);
  if (!row) return null;
  return {
    ...mapServiceAccountToken(row),
    serviceAccount: {
      id: row.service_account_id,
      name: row.name,
      scopes: parseJsonList(row.scopes_json),
      enabled: !!row.account_enabled,
    },
  };
}

function revokeServiceAccountToken(id) {
  return stmts.revokeServiceAccountToken.run(id).changes > 0;
}

function revokeServiceAccountTokens(serviceAccountId) {
  return stmts.deleteServiceAccountTokens.run(serviceAccountId).changes;
}

function touchServiceAccountToken(id) {
  stmts.touchServiceAccountToken.run(id);
}

function normalizeLeakRadarDomains(existingDomains, domain) {
  const domains = new Set(Array.isArray(existingDomains) ? existingDomains : []);
  const normalized = String(domain || "").trim().toLowerCase();
  if (normalized) domains.add(normalized);
  return Array.from(domains).sort();
}

function mapLeakRadarUnlockedRecord(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(decryptValue(row.payload_encrypted) || "{}");
  } catch (_) {
    payload = {};
  }
  return {
    leakId: row.leak_id,
    domains: parseJsonList(row.domains_json),
    payload,
    unlockedBy: row.unlocked_by || null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

function upsertLeakRadarUnlockedRecord({ leakId, domain = "", payload = {}, unlockedBy = null }) {
  const id = String(leakId || "").trim();
  if (!id) return null;
  const existing = mapLeakRadarUnlockedRecord(stmts.getLeakRadarUnlockedRecordById.get(id));
  const domains = normalizeLeakRadarDomains(existing?.domains || [], domain);
  const mergedPayload = { ...(existing?.payload || {}), ...(payload || {}), id };
  stmts.upsertLeakRadarUnlockedRecord.run({
    leakId: id,
    domainsJson: JSON.stringify(domains),
    payloadEncrypted: encryptValue(JSON.stringify(mergedPayload)),
    unlockedBy,
  });
  return getLeakRadarUnlockedRecordById(id);
}

function getLeakRadarUnlockedRecordById(leakId) {
  return mapLeakRadarUnlockedRecord(stmts.getLeakRadarUnlockedRecordById.get(leakId));
}

function listLeakRadarUnlockedRecordsByIds(leakIds = []) {
  const out = {};
  for (const leakId of Array.from(new Set((leakIds || []).map((id) => String(id || "").trim()).filter(Boolean)))) {
    const record = getLeakRadarUnlockedRecordById(leakId);
    if (record) out[leakId] = record.payload;
  }
  return out;
}

function mapPlatformWebhook(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    secretConfigured: !!row.secret_encrypted,
    secretEncrypted: row.secret_encrypted,
    events: parseJsonList(row.events_json),
    enabled: !!row.enabled,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPlatformWebhook({ id, name, url, secretEncrypted, events = [], enabled = true, createdBy = null }) {
  const webhookId = id || crypto.randomBytes(16).toString("base64url");
  stmts.createPlatformWebhook.run({
    id: webhookId,
    name,
    url,
    secretEncrypted,
    eventsJson: JSON.stringify(Array.isArray(events) ? events : []),
    enabled: enabled ? 1 : 0,
    createdBy,
  });
  return getPlatformWebhookById(webhookId);
}

function updatePlatformWebhook({ id, name, url, secretEncrypted, events = [], enabled = true }) {
  const result = stmts.updatePlatformWebhook.run({
    id,
    name,
    url,
    secretEncrypted,
    eventsJson: JSON.stringify(Array.isArray(events) ? events : []),
    enabled: enabled ? 1 : 0,
  });
  return result.changes > 0 ? getPlatformWebhookById(id) : null;
}

function getPlatformWebhookById(id) {
  return mapPlatformWebhook(stmts.getPlatformWebhookById.get(id));
}

function listPlatformWebhooks() {
  return stmts.listPlatformWebhooks.all().map((row) => {
    const webhook = mapPlatformWebhook(row);
    delete webhook.secretEncrypted;
    webhook.recentDeliveries = listPlatformWebhookDeliveries(webhook.id, 5);
    return webhook;
  });
}

function listPlatformWebhooksForEvent(eventType) {
  const like = `%\"${String(eventType).replace(/"/g, "")}\"%`;
  return stmts.listPlatformWebhooksForEvent.all(like).map(mapPlatformWebhook);
}

function deletePlatformWebhook(id) {
  return stmts.deletePlatformWebhook.run(id).changes > 0;
}

function createPlatformWebhookDelivery({ id, webhookId, eventType, payload, status = "pending", attemptCount = 0, nextAttemptAt = null }) {
  const deliveryId = id || crypto.randomBytes(16).toString("base64url");
  stmts.createPlatformWebhookDelivery.run({
    id: deliveryId,
    webhookId,
    eventType,
    payloadJson: JSON.stringify(payload || {}),
    status,
    attemptCount,
    nextAttemptAt: nextAttemptAt || Math.floor(Date.now() / 1000),
  });
  return deliveryId;
}

function listPendingPlatformWebhookDeliveries(limit = 25) {
  return stmts.listPendingPlatformWebhookDeliveries.all(Math.min(100, Math.max(1, parseInt(limit, 10) || 25))).map((row) => ({
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json || "{}"),
    status: row.status,
    attemptCount: row.attempt_count || 0,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at || null,
    responseStatus: row.response_status || null,
    responseBody: row.response_body || "",
    error: row.error || "",
    url: row.url,
    secretEncrypted: row.secret_encrypted,
    enabled: !!row.enabled,
  }));
}

function listPlatformWebhookDeliveries(webhookId, limit = 25) {
  return stmts.listPlatformWebhookDeliveries.all(webhookId, Math.min(100, Math.max(1, parseInt(limit, 10) || 25))).map((row) => ({
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    status: row.status,
    attemptCount: row.attempt_count || 0,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at || null,
    responseStatus: row.response_status || null,
    responseBody: row.response_body || "",
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function updatePlatformWebhookDelivery({ id, status, attemptCount, nextAttemptAt, lastAttemptAt, responseStatus = null, responseBody = "", error = "" }) {
  stmts.updatePlatformWebhookDelivery.run({
    id,
    status,
    attemptCount,
    nextAttemptAt,
    lastAttemptAt,
    responseStatus,
    responseBody,
    error,
  });
}

function tableHasColumn(tableName, columnName) {
  try {
    return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
  } catch {
    return false;
  }
}

function getCountSafe(sql, fallback = 0) {
  try {
    return db.prepare(sql).get().total || 0;
  } catch {
    return fallback;
  }
}

function getDeploymentCounts() {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const activeResetLinksSql = tableHasColumn("password_resets", "used")
    ? "SELECT COUNT(*) AS total FROM password_resets WHERE used = 0 AND expires_at > unixepoch()"
    : "SELECT COUNT(*) AS total FROM password_resets WHERE expires_at > unixepoch()";
  const activeGuestLinksSql = tableHasColumn("guest_links", "use_count") && tableHasColumn("guest_links", "max_uses")
    ? "SELECT COUNT(*) AS total FROM guest_links WHERE use_count < max_uses AND expires_at > unixepoch()"
    : "SELECT COUNT(*) AS total FROM guest_links WHERE expires_at > unixepoch()";

  return {
    users: getCountSafe("SELECT COUNT(*) AS total FROM users"),
    usersWithoutMfa: getCountSafe(`
      SELECT COUNT(*) AS total
      FROM users u
      LEFT JOIN user_mfa m ON m.user_id = u.id AND m.enabled = 1
      WHERE u.suspended = 0 AND m.user_id IS NULL
    `),
    activeAdminSessions: getCountSafe("SELECT COUNT(*) AS total FROM admin_sessions WHERE expires_at > unixepoch()"),
    activeResetLinks: getCountSafe(activeResetLinksSql),
    activeGuestLinks: getCountSafe(activeGuestLinksSql),
    recentAuditEvents: (() => {
      try {
        return db.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE created_at >= ?").get(oneHourAgo).total || 0;
      } catch {
        return 0;
      }
    })(),
  };
}

// ============================================================
// Reporter functions
// ============================================================

function generateId() {
  return crypto.randomBytes(16).toString("base64url");
}

function createReporterDesignRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterDesign.run({
    id,
    name: payload.name,
    description: payload.description || "",
    reportType: payload.reportType || "custom",
    htmlTemplate: payload.htmlTemplate || "",
    cssTemplate: payload.cssTemplate || "",
    fieldDefinitions: JSON.stringify(payload.fieldDefinitions || []),
    sectionDefinitions: JSON.stringify(payload.sectionDefinitions || []),
    findingFieldDefinitions: JSON.stringify(payload.findingFieldDefinitions || []),
    findingOrderingRule: payload.findingOrderingRule || "severity_desc",
    findingGroupingRule: payload.findingGroupingRule || null,
    sortOrder: payload.sortOrder || 0,
    createdBy: payload.createdBy || null,
  });
  return getReporterDesignById(id);
}

function getReporterDesignById(id) {
  const row = stmts.getReporterDesignById.get(id);
  if (!row) return null;
  return mapReporterDesignRow(row);
}

function listReporterDesigns() {
  return stmts.listReporterDesigns.all().map(mapReporterDesignRow);
}

function updateReporterDesignRow(id, payload) {
  stmts.updateReporterDesign.run({
    id,
    name: payload.name,
    description: payload.description || "",
    reportType: payload.reportType || "custom",
    htmlTemplate: payload.htmlTemplate || "",
    cssTemplate: payload.cssTemplate || "",
    fieldDefinitions: JSON.stringify(payload.fieldDefinitions || []),
    sectionDefinitions: JSON.stringify(payload.sectionDefinitions || []),
    findingFieldDefinitions: JSON.stringify(payload.findingFieldDefinitions || []),
    findingOrderingRule: payload.findingOrderingRule || "severity_desc",
    findingGroupingRule: payload.findingGroupingRule || null,
    sortOrder: payload.sortOrder || 0,
  });
  return getReporterDesignById(id);
}

function deleteReporterDesignById(id) {
  const result = stmts.deleteReporterDesignById.run(id);
  return result.changes > 0;
}

function createReporterProjectRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterProject.run({
    id,
    designId: payload.designId,
    title: payload.title,
    reportType: payload.reportType || "custom",
    status: payload.status || "draft",
    clientName: payload.clientName || "",
    projectMetadata: JSON.stringify(payload.projectMetadata || {}),
    dueDate: payload.dueDate || null,
    sourceProjectId: payload.sourceProjectId || null,
    createdBy: payload.createdBy,
    projectType: payload.projectType || "report",
    testTypes: JSON.stringify(payload.testTypes || []),
  });
  if (Array.isArray(payload.members)) {
    for (const m of payload.members) {
      stmts.addReporterProjectMember.run({ projectId: id, userId: m.userId, role: m.role || "pentester" });
    }
  }
  return getReporterProjectById(id);
}

function getReporterProjectById(id) {
  const row = stmts.getReporterProjectById.get(id);
  if (!row) return null;
  return mapReporterProjectRow(row);
}

function listReporterProjects(userId, canManageAll) {
  const rows = canManageAll
    ? stmts.listReporterProjects.all()
    : stmts.listReporterProjectsForUser.all(userId);
  return rows.map(mapReporterProjectRow);
}

function updateReporterProjectRow(id, payload) {
  const existing = getReporterProjectById(id);
  stmts.updateReporterProject.run({
    id,
    title: payload.title,
    clientName: payload.clientName || "",
    projectMetadata: JSON.stringify(payload.projectMetadata || {}),
    dueDate: payload.dueDate || null,
    tags: Array.isArray(payload.tags) ? payload.tags.join(",") : (existing?.tags?.join(",") || ""),
    overrideFindingOrder: payload.overrideFindingOrder !== undefined ? (payload.overrideFindingOrder ? 1 : 0) : (existing?.overrideFindingOrder ? 1 : 0),
    testTypes: JSON.stringify(payload.testTypes !== undefined ? payload.testTypes : (existing?.testTypes || [])),
  });
  return getReporterProjectById(id);
}

function updateReporterProjectStatus(id, status) {
  stmts.updateReporterProjectStatus.run({ id, status });
}

function archiveReporterProjectRow(id, isArchived) {
  stmts.archiveReporterProject.run({ id, isArchived: isArchived ? 1 : 0 });
}

function setReporterProjectReadonly(id, readonly) {
  stmts.setReporterProjectReadonly.run({ id, readonly: readonly ? 1 : 0, readonlySince: readonly ? Math.floor(Date.now() / 1000) : null });
}

function copyReporterFinding(findingId, userId) {
  const original = getReporterFindingByIdRow(findingId);
  if (!original) return null;
  const newId = generateId();
  const maxOrder = stmts.listReporterFindingsByProject.all(original.projectId);
  const nextOrder = maxOrder.length > 0 ? Math.max(...maxOrder.map((f) => f.order_index || 0)) + 1 : 0;
  stmts.createReporterFinding.run({
    id: newId,
    projectId: original.projectId,
    templateId: original.templateId || null,
    title: original.title + " (copy)",
    category: original.category,
    severity: original.severity,
    cvssVector: original.cvssVector,
    cvssScore: original.cvssScore,
    status: "draft",
    orderIndex: nextOrder,
    createdBy: userId,
  });
  if (original.fields) {
    for (const [name, value] of Object.entries(original.fields)) {
      stmts.setReporterFindingField.run({
        id: generateId(),
        findingId: newId,
        fieldName: name,
        fieldValue: value || "",
      });
    }
  }
  return getReporterFindingByIdRow(newId);
}

function deleteReporterProjectById(id) {
  const findingRows = stmts.listReporterFindingsByProject.all(id);
  for (const finding of findingRows) {
    stmts.deleteReporterFindingFields.run(finding.id);
  }
  stmts.deleteReporterFindingsByProject.run(id);
  stmts.deleteReporterSectionsByProject.run(id);
  const memberRows = stmts.listReporterProjectMembers.all(id);
  for (const m of memberRows) {
    stmts.removeReporterProjectMember.run(id, m.user_id);
  }
  stmts.deleteReporterNotesByProject.run(id);
  stmts.deleteReporterCommentsByProject.run(id);
  stmts.deleteReporterHistoryByProject.run(id);
  stmts.deleteReporterEvidenceByProject.run(id);
  stmts.deleteReporterPdfGenerationsByProject.run(id);
  stmts.deleteReporterImportJobsByProject.run(id);
  stmts.deleteReporterProjectById.run(id);
}

function duplicateReporterProject(sourceId, newTitle, userId) {
  const source = stmts.getReporterProjectById.get(sourceId);
  if (!source) return null;
  const newId = generateId();
  stmts.createReporterProject.run({
    id: newId,
    designId: source.design_id,
    title: newTitle || `${source.title} (Copy)`,
    reportType: source.report_type,
    status: "draft",
    clientName: source.client_name,
    projectMetadata: source.project_metadata,
    dueDate: null,
    sourceProjectId: sourceId,
    createdBy: userId,
  });
  stmts.addReporterProjectMember.run({ projectId: newId, userId, role: "lead" });
  const sourceMembers = stmts.listReporterProjectMembers.all(sourceId);
  for (const m of sourceMembers) {
    if (m.user_id !== userId) {
      stmts.addReporterProjectMember.run({ projectId: newId, userId: m.user_id, role: m.role });
    }
  }
  const sourceFindings = stmts.listReporterFindingsByProject.all(sourceId);
  for (const f of sourceFindings) {
    const fId = generateId();
    stmts.createReporterFinding.run({
      id: fId,
      projectId: newId,
      templateId: f.template_id,
      title: f.title,
      category: f.category,
      severity: f.severity,
      cvssVector: f.cvss_vector,
      cvssScore: f.cvss_score,
      status: "draft",
      orderIndex: f.order_index,
      createdBy: userId,
    });
    const fields = stmts.getReporterFindingFields.all(f.id);
    for (const field of fields) {
      stmts.setReporterFindingField.run({
        id: generateId(),
        findingId: fId,
        fieldName: field.field_name,
        fieldValue: field.field_value,
      });
    }
  }
  const sourceSections = stmts.listReporterSectionsByProject.all(sourceId);
  for (const s of sourceSections) {
    const sId = generateId();
    stmts.createReporterSection.run({
      id: sId,
      projectId: newId,
      title: s.title,
      sectionType: s.section_type,
      content: s.content,
      orderIndex: s.order_index,
      createdBy: userId,
    });
  }
  return getReporterProjectById(newId);
}

function addReporterProjectMember(projectId, userId, role) {
  stmts.addReporterProjectMember.run({ projectId, userId, role: role || "pentester" });
}

function listReporterProjectMembers(projectId) {
  return stmts.listReporterProjectMembers.all(projectId).map((r) => ({
    userId: r.user_id,
    username: r.username,
    role: r.role,
    joinedAt: r.joined_at,
  }));
}

function updateReporterProjectMemberRoleRow(projectId, userId, role) {
  stmts.updateReporterProjectMemberRole.run({ projectId, userId, role });
}

function removeReporterProjectMemberRow(projectId, userId) {
  stmts.removeReporterProjectMember.run(projectId, userId);
}

function isReporterProjectMemberRow(projectId, userId) {
  return !!stmts.isReporterProjectMember.get(projectId, userId);
}

function createReporterFindingRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterFinding.run({
    id,
    projectId: payload.projectId,
    templateId: payload.templateId || null,
    title: payload.title,
    category: payload.category || "",
    severity: payload.severity || "info",
    cvssVector: payload.cvssVector || "",
    cvssScore: payload.cvssScore || null,
    status: payload.status || "draft",
    orderIndex: payload.orderIndex || 0,
    createdBy: payload.createdBy,
  });
  if (payload.fields && typeof payload.fields === "object") {
    for (const [name, value] of Object.entries(payload.fields)) {
      stmts.setReporterFindingField.run({
        id: generateId(),
        findingId: id,
        fieldName: name,
        fieldValue: value || "",
      });
    }
  }
  return getReporterFindingByIdRow(id);
}

function getReporterFindingByIdRow(id) {
  const row = stmts.getReporterFindingById.get(id);
  if (!row) return null;
  const fields = stmts.getReporterFindingFields.all(id);
  const fieldMap = {};
  for (const f of fields) {
    fieldMap[f.field_name] = f.field_value;
  }
  return mapReporterFindingRow(row, fieldMap);
}

function listReporterFindingsByProject(projectId) {
  const rows = stmts.listReporterFindingsByProject.all(projectId);
  return rows.map((r) => mapReporterFindingRow(r, null));
}

function updateReporterFindingRow(id, payload) {
  const existing = stmts.getReporterFindingById.get(id);
  stmts.updateReporterFinding.run({
    id,
    title: payload.title,
    category: payload.category || "",
    severity: payload.severity || "info",
    cvssVector: payload.cvssVector || "",
    cvssScore: payload.cvssScore || null,
    status: payload.status || "draft",
    isIncluded: payload.isIncluded !== undefined ? (payload.isIncluded ? 1 : 0) : 1,
    assigneeId: payload.assigneeId !== undefined ? payload.assigneeId : (existing?.assignee_id || null),
    updatedBy: payload.updatedBy || null,
  });
}

function updateReporterFindingStatusRow(id, status, updatedBy) {
  stmts.updateReporterFindingStatus.run({ id, status, updatedBy });
}

function deleteReporterFindingById(id) {
  stmts.deleteReporterFindingFields.run(id);
  stmts.deleteReporterFindingById.run(id);
}

function reorderReporterFindingsRow(projectId, orderedIds) {
  const txn = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmts.reorderReporterFindings.run({ id: orderedIds[i], orderIndex: i });
    }
  });
  txn();
}

function setReporterFindingFieldRow(findingId, fieldName, fieldValue) {
  stmts.setReporterFindingField.run({
    id: generateId(),
    findingId,
    fieldName,
    fieldValue: fieldValue || "",
  });
}

function createReporterSectionRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterSection.run({
    id,
    projectId: payload.projectId,
    title: payload.title,
    sectionType: payload.sectionType || "custom",
    content: payload.content || "",
    orderIndex: payload.orderIndex || 0,
    createdBy: payload.createdBy,
  });
  return getReporterSectionByIdRow(id);
}

function getReporterSectionByIdRow(id) {
  const row = stmts.getReporterSectionById.get(id);
  return row ? mapReporterSectionRow(row) : null;
}

function listReporterSectionsByProject(projectId) {
  return stmts.listReporterSectionsByProject.all(projectId).map(mapReporterSectionRow);
}

function updateReporterSectionRow(id, payload) {
  stmts.updateReporterSection.run({
    id,
    title: payload.title,
    content: payload.content || "",
    isIncluded: payload.isIncluded !== undefined ? (payload.isIncluded ? 1 : 0) : 1,
    updatedBy: payload.updatedBy || null,
  });
}

function deleteReporterSectionById(id) {
  stmts.deleteReporterSectionById.run(id);
}

function reorderReporterSectionsRow(projectId, orderedIds) {
  const txn = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmts.reorderReporterSections.run({ id: orderedIds[i], orderIndex: i });
    }
  });
  txn();
}

function createReporterFindingTemplateRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterFindingTemplate.run({
    id,
    title: payload.title,
    category: payload.category || "",
    severity: payload.severity || "medium",
    cvssVector: payload.cvssVector || "",
    tags: JSON.stringify(payload.tags || []),
    createdBy: payload.createdBy || null,
  });
  if (Array.isArray(payload.fields)) {
    for (const f of payload.fields) {
      stmts.setReporterTemplateField.run({
        id: generateId(),
        templateId: id,
        fieldName: f.fieldName,
        fieldValue: f.fieldValue || "",
        language: f.language || "en",
      });
    }
  }
  return stmts.getReporterFindingTemplateById.get(id);
}

function getReporterFindingTemplateByIdRow(id) {
  const row = stmts.getReporterFindingTemplateById.get(id);
  if (!row) return null;
  const fields = stmts.getReporterTemplateFields.all(id);
  return mapReporterTemplateRow(row, fields);
}

function listReporterFindingTemplates() {
  return stmts.listReporterFindingTemplates.all().map((r) => mapReporterTemplateRow(r, null));
}

function updateReporterFindingTemplateRow(id, payload) {
  stmts.updateReporterFindingTemplate.run({
    id,
    title: payload.title,
    category: payload.category || "",
    severity: payload.severity || "medium",
    cvssVector: payload.cvssVector || "",
    tags: JSON.stringify(payload.tags || []),
  });
  if (Array.isArray(payload.fields)) {
    for (const f of payload.fields) {
      stmts.setReporterTemplateField.run({
        id: generateId(),
        templateId: id,
        fieldName: f.fieldName,
        fieldValue: f.fieldValue || "",
        language: f.language || "en",
      });
    }
  }
  return stmts.getReporterFindingTemplateById.get(id);
}

function deleteReporterFindingTemplateById(id) {
  stmts.deleteReporterTemplateFields.run(id);
  const result = stmts.deleteReporterFindingTemplateById.run(id);
  return result.changes > 0;
}

function getReporterGlobalStats() {
  return {
    totalProjects: stmts.countReporterProjects.get().total,
    archivedProjects: stmts.countReporterArchivedProjects.get().total,
    totalFindings: stmts.countReporterAllFindings.get().total,
    criticalFindings: stmts.countReporterCriticalFindings.get().total,
    highFindings: stmts.countReporterHighFindings.get().total,
    totalTemplates: stmts.countReporterAllTemplates.get().total,
    totalDesigns: stmts.countReporterDesigns.get().total,
  };
}

function createReporterPdfGenerationRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterPdfGeneration.run({
    id,
    projectId: payload.projectId,
    filePath: payload.filePath || "",
    fileSize: payload.fileSize || null,
    status: payload.status || "pending",
    errorMessage: payload.errorMessage || null,
    renderOptions: JSON.stringify(payload.renderOptions || {}),
    generatedBy: payload.generatedBy,
  });
  return getReporterPdfGenerationById(id);
}

function updateReporterPdfGenerationRow(id, payload) {
  stmts.updateReporterPdfGeneration.run({
    id,
    filePath: payload.filePath || "",
    fileSize: payload.fileSize || null,
    status: payload.status || "pending",
    errorMessage: payload.errorMessage || null,
    renderOptions: JSON.stringify(payload.renderOptions || {}),
  });
  return getReporterPdfGenerationById(id);
}

function getReporterPdfGenerationById(id) {
  const row = stmts.getReporterPdfGenerationById.get(id);
  return row ? mapReporterPdfGenerationRow(row) : null;
}

function listReporterPdfGenerationsByProject(projectId) {
  return stmts.listReporterPdfGenerationsByProject.all(projectId).map(mapReporterPdfGenerationRow);
}

function deleteReporterPdfGenerationById(id) {
  const result = stmts.deleteReporterPdfGenerationById.run(id);
  return result.changes > 0;
}

function createReporterNoteRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterNote.run({
    id,
    projectId: payload.projectId,
    title: payload.title || "Untitled Note",
    content: payload.content || "",
    orderIndex: payload.orderIndex || 0,
    createdBy: payload.createdBy,
  });
  return getReporterNoteById(id);
}

function getReporterNoteById(id) {
  const row = stmts.getReporterNoteById.get(id);
  return row ? mapReporterNoteRow(row) : null;
}

function listReporterNotesByProject(projectId) {
  return stmts.listReporterNotesByProject.all(projectId).map(mapReporterNoteRow);
}

function updateReporterNoteRow(id, payload) {
  stmts.updateReporterNote.run({
    id,
    title: payload.title || "Untitled Note",
    content: payload.content || "",
    orderIndex: payload.orderIndex || 0,
  });
  return getReporterNoteById(id);
}

function deleteReporterNoteById(id) {
  const result = stmts.deleteReporterNoteById.run(id);
  return result.changes > 0;
}

function createReporterCommentRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterComment.run({
    id,
    projectId: payload.projectId,
    targetType: payload.targetType,
    targetId: payload.targetId,
    content: payload.content || "",
    createdBy: payload.createdBy,
  });
  return id;
}

function getReporterCommentById(id) {
  const row = stmts.getReporterCommentById.get(id);
  return row ? mapReporterCommentRow(row) : null;
}

function listReporterCommentsByProject(projectId) {
  return stmts.listReporterCommentsByProject.all(projectId).map(mapReporterCommentRow);
}

function listReporterCommentsByTarget(targetType, targetId) {
  return stmts.listReporterCommentsByTarget.all(targetType, targetId).map(mapReporterCommentRow);
}

function resolveReporterCommentRow(id, isResolved) {
  stmts.resolveReporterComment.run({ id, isResolved: isResolved ? 1 : 0 });
}

function deleteReporterCommentById(id) {
  const result = stmts.deleteReporterCommentById.run(id);
  return result.changes > 0;
}

function createReporterHistoryRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterHistory.run({
    id,
    projectId: payload.projectId,
    targetType: payload.targetType,
    targetId: payload.targetId,
    snapshot: JSON.stringify(payload.snapshot || {}),
    versionNumber: payload.versionNumber || 1,
    changeSummary: payload.changeSummary || "",
    createdBy: payload.createdBy,
  });
  return id;
}

function listReporterHistoryByProject(projectId) {
  return stmts.listReporterHistoryByProject.all(projectId).map(mapReporterHistoryRow);
}

function createReporterEvidenceRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterEvidence.run({
    id,
    projectId: payload.projectId,
    findingId: payload.findingId || null,
    sectionId: payload.sectionId || null,
    filename: payload.filename,
    storedFilename: payload.storedFilename,
    mimeType: payload.mimeType || "application/octet-stream",
    sizeBytes: payload.sizeBytes || 0,
    caption: payload.caption || "",
    evidenceType: payload.evidenceType || "file",
    redactionStatus: payload.redactionStatus || "not_required",
    createdBy: payload.createdBy,
  });
  return getReporterEvidenceById(id);
}

function getReporterEvidenceById(id) {
  const row = stmts.getReporterEvidenceById.get(id);
  return row ? mapReporterEvidenceRow(row) : null;
}

function listReporterEvidenceByProject(projectId) {
  return stmts.listReporterEvidenceByProject.all(projectId).map(mapReporterEvidenceRow);
}

function updateReporterEvidenceRow(id, payload) {
  stmts.updateReporterEvidence.run({
    id,
    findingId: payload.findingId || null,
    sectionId: payload.sectionId || null,
    caption: payload.caption || "",
    evidenceType: payload.evidenceType || "file",
    redactionStatus: payload.redactionStatus || "not_required",
  });
  return getReporterEvidenceById(id);
}

function deleteReporterEvidenceById(id) {
  const result = stmts.deleteReporterEvidenceById.run(id);
  return result.changes > 0;
}

function createReporterImportJobRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterImportJob.run({
    id,
    projectId: payload.projectId,
    importType: payload.importType || "json",
    status: payload.status || "pending",
    sourceFile: payload.sourceFile || "",
    resultSummary: JSON.stringify(payload.resultSummary || {}),
    errorMessage: payload.errorMessage || null,
    createdBy: payload.createdBy,
  });
  return id;
}

function updateReporterImportJobRow(id, payload) {
  stmts.updateReporterImportJob.run({
    id,
    status: payload.status || "pending",
    resultSummary: JSON.stringify(payload.resultSummary || {}),
    errorMessage: payload.errorMessage || null,
  });
}

function listReporterImportJobsByProject(projectId) {
  return stmts.listReporterImportJobsByProject.all(projectId).map(mapReporterImportJobRow);
}

function getReporterProjectStats(projectId) {
  const findings = stmts.countReporterFindingsByProject.get(projectId).total;
  const sections = stmts.countReporterSectionsByProject.get(projectId).total;
  const severityRows = stmts.countReporterFindingsBySeverity.all(projectId);
  const bySeverity = {};
  for (const r of severityRows) {
    bySeverity[r.severity] = r.total;
  }
  return { findings, sections, bySeverity };
}

// Reporter row mappers

function mapReporterDesignRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    reportType: row.report_type,
    htmlTemplate: row.html_template,
    cssTemplate: row.css_template,
    fieldDefinitions: safeParseJSON(row.field_definitions),
    sectionDefinitions: safeParseJSON(row.section_definitions),
    findingFieldDefinitions: safeParseJSON(row.finding_field_definitions),
    findingOrderingRule: row.finding_ordering_rule,
    findingGroupingRule: row.finding_grouping_rule,
    findingOrdering: safeParseJSON(row.finding_ordering),
    findingGrouping: safeParseJSON(row.finding_grouping),
    isBuiltin: !!row.is_builtin,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectType: row.project_type || "report",
  };
}

function mapReporterProjectRow(row) {
  return {
    id: row.id,
    designId: row.design_id,
    designName: row.design_name || null,
    title: row.title,
    reportType: row.report_type,
    status: row.status,
    version: row.version,
    clientName: row.client_name,
    projectMetadata: safeParseJSON(row.project_metadata),
    isArchived: !!row.is_archived,
    readonly: !!row.readonly,
    readonlySince: row.readonly_since,
    tags: (row.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    overrideFindingOrder: !!row.override_finding_order,
    dueDate: row.due_date,
    sourceProjectId: row.source_project_id,
    createdBy: row.created_by,
    creatorUsername: row.creator_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectType: row.project_type || "report",
    testTypes: safeParseJSON(row.test_types),
  };
}

function mapReporterFindingRow(row, fields) {
  return {
    id: row.id,
    projectId: row.project_id,
    templateId: row.template_id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    cvssVector: row.cvss_vector,
    cvssScore: row.cvss_score,
    status: row.status,
    orderIndex: row.order_index,
    assigneeId: row.assignee_id || null,
    assigneeUsername: row.assignee_username || null,
    isIncluded: !!row.is_included,
    createdBy: row.created_by,
    creatorUsername: row.creator_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields: fields || null,
  };
}

function mapReporterSectionRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    sectionType: row.section_type,
    content: row.content,
    orderIndex: row.order_index,
    isIncluded: !!row.is_included,
    createdBy: row.created_by,
    creatorUsername: row.creator_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReporterTemplateRow(row, fields) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    cvssVector: row.cvss_vector,
    tags: safeParseJSON(row.tags),
    isBuiltin: !!row.is_builtin,
    usageCount: row.usage_count,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields: fields ? fields.map((f) => ({ fieldName: f.field_name, fieldValue: f.field_value, language: f.language })) : null,
  };
}

function mapReporterPdfGenerationRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title || null,
    filePath: row.file_path,
    fileSize: row.file_size,
    status: row.status,
    errorMessage: row.error_message,
    renderOptions: safeParseJSON(row.render_options),
    generatedBy: row.generated_by,
    createdAt: row.created_at,
    projectCreatedBy: row.project_created_by || null,
  };
}

function mapReporterNoteRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    orderIndex: row.order_index,
    createdBy: row.created_by,
    username: row.username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReporterCommentRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    content: row.content,
    isResolved: !!row.is_resolved,
    createdBy: row.created_by,
    username: row.username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReporterHistoryRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type,
    targetId: row.target_id,
    snapshot: safeParseJSON(row.snapshot, {}),
    versionNumber: row.version_number,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    username: row.username || null,
    createdAt: row.created_at,
  };
}

function mapReporterEvidenceRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    findingId: row.finding_id,
    sectionId: row.section_id,
    filename: row.filename,
    storedFilename: row.stored_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    caption: row.caption,
    evidenceType: row.evidence_type,
    redactionStatus: row.redaction_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReporterImportJobRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    importType: row.import_type,
    status: row.status,
    sourceFile: row.source_file,
    resultSummary: safeParseJSON(row.result_summary, {}),
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function safeParseJSON(str, fallback = []) {
  try { return JSON.parse(str || JSON.stringify(fallback)); } catch { return fallback; }
}

// ============================================================
// Reporter Proposal functions
// ============================================================

function mapReporterProposalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    title: row.title,
    clientName: row.client_name,
    clientId: row.client_id,
    primaryContactName: row.primary_contact_name,
    primaryContactEmail: row.primary_contact_email,
    preparedForName: row.prepared_for_name,
    preparedForEmail: row.prepared_for_email,
    preparedByUserId: row.prepared_by_user_id,
    preparedByUsername: row.prepared_by_username || null,
    preparedByFullName: row.prepared_by_full_name || null,
    preparedByEmail: row.prepared_by_email || null,
    opportunityId: row.opportunity_id,
    engagementId: row.engagement_id,
    status: row.status,
    proposalType: row.proposal_type,
    testTypes: safeParseJSON(row.test_types),
    proposalMetadata: safeParseJSON(row.proposal_metadata, {}),
    validUntil: row.valid_until,
    estimatedDays: row.estimated_days,
    quotedValue: row.quoted_value,
    createdBy: row.created_by,
    creatorUsername: row.creator_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function getReporterProposalById(id) {
  const row = stmts.getReporterProposalById.get(id);
  return row ? mapReporterProposalRow(row) : null;
}

function listReporterProposals() {
  return stmts.listReporterProposals.all().map(mapReporterProposalRow);
}

function createReporterProposalRow(payload) {
  const id = payload.id || generateId();
  stmts.createReporterProposal.run({
    id,
    templateId: payload.templateId || null,
    title: payload.title,
    clientName: payload.clientName || "",
    clientId: payload.clientId || null,
    primaryContactName: payload.primaryContactName || "",
    primaryContactEmail: payload.primaryContactEmail || "",
    preparedForName: payload.preparedForName || "",
    preparedForEmail: payload.preparedForEmail || "",
    preparedByUserId: payload.preparedByUserId || null,
    opportunityId: payload.opportunityId || null,
    engagementId: payload.engagementId || null,
    status: payload.status || "draft",
    proposalType: payload.proposalType || "security_assessment",
    testTypes: JSON.stringify(payload.testTypes || []),
    proposalMetadata: JSON.stringify(payload.proposalMetadata || {}),
    validUntil: payload.validUntil || null,
    estimatedDays: payload.estimatedDays || null,
    quotedValue: payload.quotedValue || null,
    createdBy: payload.createdBy,
  });
  if (Array.isArray(payload.sections)) {
    for (let i = 0; i < payload.sections.length; i++) {
      const s = payload.sections[i];
      stmts.createReporterProposalSection.run({
        id: generateId(),
        proposalId: id,
        title: s.title,
        sectionType: s.sectionType || "markdown",
        content: s.content || "",
        orderIndex: s.orderIndex != null ? s.orderIndex : i,
        isIncluded: s.isIncluded !== false ? 1 : 0,
        createdBy: payload.createdBy,
      });
    }
  }
  return getReporterProposalById(id);
}

function updateReporterProposalRow(id, payload) {
  const existing = getReporterProposalById(id);
  if (!existing) return null;
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  stmts.updateReporterProposal.run({
    id,
    title: has("title") ? payload.title : existing.title,
    clientName: has("clientName") ? payload.clientName : existing.clientName,
    clientId: has("clientId") ? payload.clientId : existing.clientId,
    primaryContactName: has("primaryContactName") ? payload.primaryContactName : existing.primaryContactName,
    primaryContactEmail: has("primaryContactEmail") ? payload.primaryContactEmail : existing.primaryContactEmail,
    preparedForName: has("preparedForName") ? payload.preparedForName : existing.preparedForName,
    preparedForEmail: has("preparedForEmail") ? payload.preparedForEmail : existing.preparedForEmail,
    preparedByUserId: has("preparedByUserId") ? payload.preparedByUserId : existing.preparedByUserId,
    proposalType: has("proposalType") ? payload.proposalType : existing.proposalType,
    testTypes: JSON.stringify(has("testTypes") ? payload.testTypes : existing.testTypes),
    proposalMetadata: JSON.stringify(has("proposalMetadata") ? payload.proposalMetadata : existing.proposalMetadata),
    validUntil: has("validUntil") ? payload.validUntil : existing.validUntil,
    estimatedDays: has("estimatedDays") ? payload.estimatedDays : existing.estimatedDays,
    quotedValue: has("quotedValue") ? payload.quotedValue : existing.quotedValue,
  });
  return getReporterProposalById(id);
}

function updateReporterProposalStatus(id, status) {
  stmts.updateReporterProposalStatus.run({ id, status });
  return getReporterProposalById(id);
}

function archiveReporterProposalRow(id) {
  stmts.archiveReporterProposal.run({ id });
  return getReporterProposalById(id);
}

function unarchiveReporterProposalRow(id) {
  stmts.unarchiveReporterProposal.run({ id });
  return getReporterProposalById(id);
}

// Proposal sections
function mapReporterProposalSectionRow(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    title: row.title,
    sectionType: row.section_type,
    content: row.content,
    orderIndex: row.order_index,
    isIncluded: !!row.is_included,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listReporterProposalSections(proposalId) {
  return stmts.listReporterProposalSections.all(proposalId).map(mapReporterProposalSectionRow);
}

function getReporterProposalSectionById(id) {
  const row = stmts.getReporterProposalSectionById.get(id);
  return row ? mapReporterProposalSectionRow(row) : null;
}

function createReporterProposalSectionRow(payload) {
  const id = generateId();
  stmts.createReporterProposalSection.run({
    id,
    proposalId: payload.proposalId,
    title: payload.title,
    sectionType: payload.sectionType || "markdown",
    content: payload.content || "",
    orderIndex: payload.orderIndex || 0,
    isIncluded: payload.isIncluded !== false ? 1 : 0,
    createdBy: payload.createdBy,
  });
  return getReporterProposalSectionById(id);
}

function updateReporterProposalSectionRow(id, payload) {
  stmts.updateReporterProposalSection.run({
    id,
    title: payload.title,
    content: payload.content || "",
    isIncluded: payload.isIncluded !== undefined ? (payload.isIncluded ? 1 : 0) : 1,
  });
  return getReporterProposalSectionById(id);
}

function deleteReporterProposalSectionById(id) {
  stmts.deleteReporterProposalSection.run(id);
}

function reorderReporterProposalSectionsRow(proposalId, orderedIds) {
  const txn = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmts.reorderReporterProposalSections.run({ id: orderedIds[i], orderIndex: i });
    }
  });
  txn();
}

// Proposal generations
function createReporterProposalGenerationRow(payload) {
  const id = generateId();
  stmts.createReporterProposalGeneration.run({
    id,
    proposalId: payload.proposalId,
    filename: payload.filename || "proposal.pdf",
    filePath: payload.filePath || "",
    version: payload.version || 1,
    status: payload.status || "pending",
    createdBy: payload.createdBy,
  });
  return stmts.getReporterProposalGenerationById.get(id);
}

function updateReporterProposalGenerationRow(id, payload) {
  stmts.updateReporterProposalGeneration.run({
    id,
    filePath: payload.filePath || "",
    status: payload.status,
    completedAt: payload.completedAt || null,
    errorMessage: payload.errorMessage || null,
  });
  return stmts.getReporterProposalGenerationById.get(id);
}

function getReporterProposalGenerationById(id) {
  return stmts.getReporterProposalGenerationById.get(id);
}

function listReporterProposalGenerations(proposalId) {
  return stmts.listReporterProposalGenerations.all(proposalId);
}

function deleteReporterProposalGenerationById(id) {
  stmts.deleteReporterProposalGenerationById.run(id);
}

// Proposal templates (read-only)
function listReporterProposalTemplates() {
  return stmts.listReporterProposalTemplates.all();
}

function getReporterProposalTemplateById(id) {
  return stmts.getReporterProposalTemplateById.get(id);
}

function listReporterProposalTemplateSections(templateId) {
  return stmts.listReporterProposalTemplateSections.all(templateId);
}

function createReporterProposalTemplate(payload) {
  stmts.createReporterProposalTemplate.run(payload);
  return stmts.getReporterProposalTemplateById.get(payload.id);
}

function updateReporterProposalTemplate(payload) {
  const result = stmts.updateReporterProposalTemplate.run(payload);
  if (!result.changes) return null;
  return stmts.getReporterProposalTemplateById.get(payload.id);
}

function archiveReporterProposalTemplate(id) {
  return stmts.archiveReporterProposalTemplate.run(id);
}

function createReporterProposalTemplateSection(payload) {
  stmts.createReporterProposalTemplateSection.run(payload);
  return stmts.getReporterProposalTemplateSectionById.get(payload.id);
}

function updateReporterProposalTemplateSection(payload) {
  const result = stmts.updateReporterProposalTemplateSection.run(payload);
  if (!result.changes) return null;
  return stmts.getReporterProposalTemplateSectionById.get(payload.id);
}

function deleteReporterProposalTemplateSection(id) {
  return stmts.deleteReporterProposalTemplateSection.run(id);
}

function duplicateReporterProposalTemplate(templateId, newId, createdBy) {
  const source = stmts.getReporterProposalTemplateById.get(templateId);
  if (!source) return null;
  stmts.createReporterProposalTemplate.run({
    id: newId,
    name: source.name + " (Copy)",
    description: source.description,
    templateType: source.template_type,
    htmlTemplate: source.html_template,
    cssTemplate: source.css_template,
    metadataSchema: source.metadata_schema,
    sortOrder: source.sort_order + 1,
    createdBy,
  });
  const sections = stmts.listReporterProposalTemplateSections.all(templateId);
  const crypto = require("crypto");
  for (const s of sections) {
    stmts.createReporterProposalTemplateSection.run({
      id: crypto.randomBytes(16).toString("base64url"),
      templateId: newId,
      title: s.title,
      sectionType: s.section_type,
      content: s.content,
      orderIndex: s.order_index,
      isRequired: s.is_required,
    });
  }
  return stmts.getReporterProposalTemplateById.get(newId);
}

// Test type templates
function mapReporterTestTypeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    testType: row.test_type,
    name: row.name,
    description: row.description,
    methodologyWriteup: row.methodology_writeup,
    methodology: row.methodology_writeup,
    scopeGuidance: row.scope_guidance,
    scope: row.scope_guidance,
    deliverables: row.deliverables,
    clientRequirements: row.client_requirements,
    consultantRequirements: row.consultant_requirements,
    assumptions: row.assumptions,
    restrictions: row.restrictions,
    isBuiltin: !!row.is_builtin,
    is_builtin: !!row.is_builtin,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function listReporterTestTypeTemplates() {
  return stmts.listReporterTestTypeTemplates.all().map(mapReporterTestTypeRow);
}

function listAllReporterTestTypeTemplates() {
  return stmts.listAllReporterTestTypeTemplates.all().map(mapReporterTestTypeRow);
}

function getReporterTestTypeTemplateById(id) {
  return mapReporterTestTypeRow(stmts.getReporterTestTypeTemplateById.get(id));
}

function getReporterTestTypeTemplateByType(testType) {
  return mapReporterTestTypeRow(stmts.getReporterTestTypeTemplateByType.get(testType));
}

function createReporterTestTypeTemplate(payload) {
  stmts.createReporterTestTypeTemplate.run(payload);
  return stmts.getReporterTestTypeTemplateById.get(payload.id);
}

function updateReporterTestTypeTemplate(payload) {
  const result = stmts.updateReporterTestTypeTemplate.run(payload);
  if (!result.changes) return null;
  return stmts.getReporterTestTypeTemplateById.get(payload.id);
}

function archiveReporterTestTypeTemplate(id) {
  return stmts.archiveReporterTestTypeTemplate.run(id);
}

function duplicateReporterTestTypeTemplate(sourceId, newId) {
  const source = stmts.getReporterTestTypeTemplateById.get(sourceId);
  if (!source) return null;
  stmts.createReporterTestTypeTemplate.run({
    id: newId,
    testType: source.test_type,
    name: source.name + " (Copy)",
    description: source.description,
    methodologyWriteup: source.methodology_writeup,
    scopeGuidance: source.scope_guidance,
    deliverables: source.deliverables,
    clientRequirements: source.client_requirements,
    consultantRequirements: source.consultant_requirements,
    assumptions: source.assumptions,
    restrictions: source.restrictions,
    sortOrder: source.sort_order + 1,
  });
  return stmts.getReporterTestTypeTemplateById.get(newId);
}

// ============================================================
// Notification functions
// ============================================================

function createNotification({ userId, category, action, title, body, linkUrl, entityType, entityId, severity, expiresAt, dedupeKey }) {
  const cat = category || "system";
  const sev = severity || "info";
  const act = action || "";

  if (dedupeKey) {
    const existing = stmts.findUnreadNotificationByDedupe.get(userId, dedupeKey);
    if (existing) {
      stmts.updateNotificationDedupe.run({
        id: existing.id,
        category: cat, action: act, title, body: body || "",
        linkUrl: linkUrl || null, entityType: entityType || null, entityId: entityId || null,
        severity: sev,
      });
      return stmts.getNotificationById.get(existing.id);
    }
  }

  const id = crypto.randomBytes(16).toString("base64url");
  stmts.createNotification.run({
    id, userId,
    category: cat, action: act, title, body: body || "",
    linkUrl: linkUrl || null, entityType: entityType || null, entityId: entityId || null,
    severity: sev, expiresAt: expiresAt || null,
    dedupeKey: dedupeKey || null,
  });
  return stmts.getNotificationById.get(id);
}

function getNotificationsByUserId(userId, limit = 50, offset = 0) {
  return stmts.getNotificationsByUserId.all(userId, limit, offset);
}

function getUnreadNotificationCount(userId) {
  const row = stmts.getUnreadCountByUserId.get(userId);
  return row ? row.count : 0;
}

function markNotificationRead(notificationId, userId) {
  const result = stmts.markNotificationRead.run(notificationId, userId);
  return result.changes > 0;
}

function markAllNotificationsRead(userId) {
  const result = stmts.markAllNotificationsReadByUserId.run(userId);
  return result.changes;
}

function getNotificationById(id) {
  return stmts.getNotificationById.get(id);
}

function deleteExpiredNotifications() {
  return stmts.deleteExpiredNotifications.run().changes;
}

// ============================================================
// Engage functions
// ============================================================

const VALID_CLIENT_STATUSES = new Set(["active", "inactive", "prospect", "archived"]);
const VALID_CONTACT_TYPES = new Set(["commercial", "technical", "security", "procurement", "executive", "other"]);
const VALID_OPP_STAGES = new Set(["lead", "qualified", "scoping", "proposal_drafting", "proposal_sent", "negotiation", "won", "lost", "rejected", "archived"]);
const VALID_OPP_TYPES = new Set(["internal", "external", "webapp", "cloud", "build_review", "red_team", "wireless", "configuration_review", "assumed_breach", "custom"]);
const VALID_ENG_STATUSES = new Set(["draft", "contract_signed", "scheduled", "testing_not_started", "testing_in_progress", "testing_blocked", "testing_complete", "reporting_in_progress", "ready_for_delivery", "ready_for_qa", "qa_assigned", "qa_in_progress", "qa_changes_required", "qa_ready_for_delivery", "delivered", "retest_pending", "post_engagement_followup", "closed", "cancelled", "archived"]);
const VALID_ENG_TYPES = VALID_OPP_TYPES;
const VALID_ENG_PRIORITIES = new Set(["low", "normal", "high", "critical"]);

function normaliseOppTypes(raw) {
  if (!raw) return "[]";
  if (Array.isArray(raw)) {
    const valid = raw.filter((t) => VALID_OPP_TYPES.has(t));
    return JSON.stringify(valid.length > 0 ? valid : ["custom"]);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normaliseOppTypes(parsed);
    } catch { /* not JSON — treat as single value */ }
    return JSON.stringify(VALID_OPP_TYPES.has(raw) ? [raw] : ["custom"]);
  }
  return "[]";
}
const VALID_TEAM_ROLES = new Set(["manager", "technical_lead", "tester", "qa_reviewer", "observer"]);
const VALID_QA_STATUSES = new Set(["not_requested", "ready_for_qa", "assigned", "reviewing", "requires_more_work", "ready_for_delivery", "cancelled"]);

function createEngageClient(payload) {
  const id = payload.id || generateId();
  stmts.createEngageClient.run({
    id,
    name: payload.name,
    displayName: payload.displayName || null,
    industry: payload.industry || null,
    website: payload.website || null,
    accountOwnerUserId: payload.accountOwnerUserId || null,
    status: VALID_CLIENT_STATUSES.has(payload.status) ? payload.status : "prospect",
    notes: payload.notes || "",
    createdBy: payload.createdBy || null,
  });
  return stmts.getEngageClientById.get(id);
}

function getEngageClientById(id) {
  return stmts.getEngageClientById.get(id);
}

function listEngageClients(limit = 50, offset = 0) {
  return stmts.listEngageClients.all(limit, offset);
}

function updateEngageClient(payload) {
  stmts.updateEngageClient.run({
    id: payload.id,
    name: payload.name,
    displayName: payload.displayName || null,
    industry: payload.industry || null,
    website: payload.website || null,
    accountOwnerUserId: payload.accountOwnerUserId || null,
    status: VALID_CLIENT_STATUSES.has(payload.status) ? payload.status : "prospect",
    notes: payload.notes || "",
    defaultBillingContactId: payload.defaultBillingContactId || null,
    defaultTechnicalContactId: payload.defaultTechnicalContactId || null,
  });
  return stmts.getEngageClientById.get(payload.id);
}

function archiveEngageClient(id) {
  return stmts.archiveEngageClient.run(id).changes > 0;
}

function createEngageContact(payload) {
  const id = payload.id || generateId();
  stmts.createEngageContact.run({
    id,
    clientId: payload.clientId,
    name: payload.name,
    title: payload.title || null,
    email: payload.email || null,
    phone: payload.phone || null,
    contactType: VALID_CONTACT_TYPES.has(payload.contactType) ? payload.contactType : "other",
    isPrimary: payload.isPrimary ? 1 : 0,
    notes: payload.notes || "",
  });
  return stmts.getEngageContactById.get(id);
}

function getEngageContactById(id) {
  return stmts.getEngageContactById.get(id);
}

function updateEngageContact(payload) {
  stmts.updateEngageContact.run({
    id: payload.id,
    name: payload.name,
    title: payload.title || null,
    email: payload.email || null,
    phone: payload.phone || null,
    contactType: VALID_CONTACT_TYPES.has(payload.contactType) ? payload.contactType : "other",
    isPrimary: payload.isPrimary ? 1 : 0,
    notes: payload.notes || "",
  });
  return stmts.getEngageContactById.get(payload.id);
}

function archiveEngageContact(id) {
  return stmts.archiveEngageContact.run(id).changes > 0;
}

function createEngageOpportunity(payload) {
  const id = payload.id || generateId();
  stmts.createEngageOpportunity.run({
    id,
    clientId: payload.clientId,
    title: payload.title,
    opportunityType: normaliseOppTypes(payload.opportunityType),
    stage: VALID_OPP_STAGES.has(payload.stage) ? payload.stage : "lead",
    estimatedValue: payload.estimatedValue ?? null,
    quotedValue: payload.quotedValue ?? null,
    estimatedDays: payload.estimatedDays ?? null,
    probabilityPercent: payload.probabilityPercent ?? null,
    expectedStartDate: payload.expectedStartDate || null,
    expectedDecisionDate: payload.expectedDecisionDate || null,
    proposalReporterDocId: payload.proposalReporterDocId || null,
    proposalPdfGenerationId: payload.proposalPdfGenerationId || null,
    ownerUserId: payload.ownerUserId || null,
    createdBy: payload.createdBy || null,
    notes: payload.notes || "",
  });
  return stmts.getEngageOpportunityById.get(id);
}

function getEngageOpportunityById(id) {
  return stmts.getEngageOpportunityById.get(id);
}

function listEngageOpportunities(limit = 50, offset = 0) {
  return stmts.listEngageOpportunities.all(limit, offset);
}

function updateEngageOpportunity(payload) {
  stmts.updateEngageOpportunity.run({
    id: payload.id,
    title: payload.title,
    opportunityType: normaliseOppTypes(payload.opportunityType),
    stage: VALID_OPP_STAGES.has(payload.stage) ? payload.stage : "lead",
    estimatedValue: payload.estimatedValue ?? null,
    quotedValue: payload.quotedValue ?? null,
    estimatedDays: payload.estimatedDays ?? null,
    probabilityPercent: payload.probabilityPercent ?? null,
    expectedStartDate: payload.expectedStartDate || null,
    expectedDecisionDate: payload.expectedDecisionDate || null,
    proposalReporterDocId: payload.proposalReporterDocId || null,
    proposalPdfGenerationId: payload.proposalPdfGenerationId || null,
    ownerUserId: payload.ownerUserId || null,
    lostReason: payload.lostReason || null,
    rejectedReason: payload.rejectedReason || null,
    notes: payload.notes || "",
  });
  return stmts.getEngageOpportunityById.get(payload.id);
}

function updateEngageOpportunityStage(id, stage) {
  const closedStages = new Set(["won", "lost", "rejected", "archived"]);
  const closedAt = closedStages.has(stage) ? Math.floor(Date.now() / 1000) : null;
  stmts.updateEngageOpportunityStage.run({ id, stage, closedAt });
  return stmts.getEngageOpportunityById.get(id);
}

function linkEngageOpportunityProposal(opportunityId, reporterProposalId) {
  stmts.linkEngageOpportunityProposal.run({ id: opportunityId, reporterProposalId });
  stmts.addOppProposalLink.run(opportunityId, reporterProposalId);
  return stmts.getEngageOpportunityById.get(opportunityId);
}

function listOppProposalLinks(opportunityId) {
  return stmts.listOppProposalLinks.all(opportunityId).map((r) => r.reporter_proposal_id);
}

function createEngageEngagement(payload) {
  const id = payload.id || generateId();
  stmts.createEngageEngagement.run({
    id,
    clientId: payload.clientId,
    opportunityId: payload.opportunityId || null,
    title: payload.title,
    engagementType: normaliseOppTypes(payload.engagementType),
    status: VALID_ENG_STATUSES.has(payload.status) ? payload.status : "draft",
    priority: VALID_ENG_PRIORITIES.has(payload.priority) ? payload.priority : "normal",
    commercialValue: payload.commercialValue ?? null,
    estimatedDays: payload.estimatedDays ?? null,
    scheduledStartDate: payload.scheduledStartDate || null,
    scheduledEndDate: payload.scheduledEndDate || null,
    engagementManagerUserId: payload.engagementManagerUserId || null,
    technicalLeadUserId: payload.technicalLeadUserId || null,
    highLevelScopeSummary: payload.highLevelScopeSummary || "",
    notes: payload.notes || "",
    createdBy: payload.createdBy || null,
  });
  return stmts.getEngageEngagementById.get(id);
}

function getEngageEngagementById(id) {
  return stmts.getEngageEngagementById.get(id);
}

function getEngageEngagementByReporterProject(projectId) {
  return stmts.getEngageEngagementByReporterProject.get(projectId);
}

function getEngageEngagementByCalendarProject(calendarProjectId) {
  return stmts.getEngageEngagementByCalendarProject.get(calendarProjectId);
}

function listEngageEngagements(limit = 50, offset = 0) {
  return stmts.listEngageEngagements.all(limit, offset);
}

function listEngageEngagementsByUser(userId) {
  return stmts.listEngageEngagementsByUser.all(userId);
}

function listEngageEngagementsByClient(clientId) {
  return stmts.listEngageEngagementsByClient.all(clientId);
}

function listEngageOpportunitiesByClient(clientId) {
  return stmts.listEngageOpportunitiesByClient.all(clientId);
}

function updateEngageEngagement(payload) {
  stmts.updateEngageEngagement.run({
    id: payload.id,
    title: payload.title,
    engagementType: normaliseOppTypes(payload.engagementType),
    status: VALID_ENG_STATUSES.has(payload.status) ? payload.status : "draft",
    priority: VALID_ENG_PRIORITIES.has(payload.priority) ? payload.priority : "normal",
    commercialValue: payload.commercialValue ?? null,
    estimatedDays: payload.estimatedDays ?? null,
    scheduledStartDate: payload.scheduledStartDate || null,
    scheduledEndDate: payload.scheduledEndDate || null,
    actualStartDate: payload.actualStartDate || null,
    actualEndDate: payload.actualEndDate || null,
    engagementManagerUserId: payload.engagementManagerUserId || null,
    technicalLeadUserId: payload.technicalLeadUserId || null,
    redseccalProjectId: payload.redseccalProjectId || null,
    redsecReporterProjectId: payload.redsecReporterProjectId || null,
    proposalReporterDocId: payload.proposalReporterDocId || null,
    deliveryReporterProjectId: payload.deliveryReporterProjectId || null,
    highLevelScopeSummary: payload.highLevelScopeSummary || "",
    notes: payload.notes || "",
  });
  return stmts.getEngageEngagementById.get(payload.id);
}

function updateEngageEngagementStatus(id, status) {
  const closingStates = new Set(["closed", "cancelled", "archived"]);
  const closedAt = closingStates.has(status) ? Math.floor(Date.now() / 1000) : null;
  stmts.updateEngageEngagementStatus.run({ id, status, closedAt });
  return stmts.getEngageEngagementById.get(id);
}

function archiveEngageEngagement(id) {
  return stmts.archiveEngageEngagement.run(id).changes > 0;
}

function createEngageMember(payload) {
  const id = payload.id || generateId();
  stmts.createEngageMember.run({
    id,
    engagementId: payload.engagementId,
    userId: payload.userId,
    role: VALID_TEAM_ROLES.has(payload.role) ? payload.role : "tester",
    isPrimary: payload.isPrimary ? 1 : 0,
  });
  return stmts.listEngageMembersByEngagement.all(payload.engagementId).find((m) => m.id === id);
}

function listEngageMembersByEngagement(engagementId) {
  return stmts.listEngageMembersByEngagement.all(engagementId);
}

function updateEngageMember(payload) {
  stmts.updateEngageMember.run({
    id: payload.id,
    role: VALID_TEAM_ROLES.has(payload.role) ? payload.role : "tester",
    isPrimary: payload.isPrimary ? 1 : 0,
  });
  return stmts.listEngageMembersByEngagement.all(payload.engagementId).find((m) => m.id === payload.id);
}

function deleteEngageMember(id) {
  return stmts.deleteEngageMember.run(id).changes > 0;
}

function createEngageQaReview(payload) {
  const id = payload.id || generateId();
  stmts.createEngageQaReview.run({
    id,
    engagementId: payload.engagementId,
    reporterProjectId: payload.reporterProjectId || null,
    assignedByUserId: payload.assignedByUserId || null,
    assignedToUserId: payload.assignedToUserId || null,
    status: VALID_QA_STATUSES.has(payload.status) ? payload.status : "not_requested",
    qaNotes: payload.qaNotes || "",
    reportLink: payload.reportLink || null,
    shareLink: payload.shareLink || null,
  });
  return stmts.getEngageQaReviewById.get(id);
}

function getEngageQaReviewById(id) {
  return stmts.getEngageQaReviewById.get(id);
}

function updateEngageQaReview(payload) {
  const existing = stmts.getEngageQaReviewById.get(payload.id) || {};
  stmts.updateEngageQaReview.run({
    id: payload.id,
    status: payload.status !== undefined ? payload.status : existing.status,
    qaNotes: payload.qaNotes !== undefined ? payload.qaNotes : (existing.qa_notes || ""),
    reportLink: payload.reportLink !== undefined ? payload.reportLink : (existing.report_link || null),
    shareLink: payload.shareLink !== undefined ? payload.shareLink : (existing.share_link || null),
    assignedToUserId: payload.assignedToUserId !== undefined ? payload.assignedToUserId : (existing.assigned_to_user_id || null),
    completedAt: payload.completedAt !== undefined ? payload.completedAt : (existing.completed_at || null),
  });
  return stmts.getEngageQaReviewById.get(payload.id);
}

function listEngageQaReviewsByStatus(status) {
  return stmts.listEngageQaReviewsByStatus.all(status);
}

function listEngageQaReviewsByAssignee(userId) {
  return stmts.listEngageQaReviewsByAssignee.all(userId);
}

function listEngageQaReviewsByStatusEnriched(status) {
  return stmts.listEngageQaReviewsByStatusEnriched.all(status);
}

function listEngageQaReviewsByAssigneeEnriched(userId) {
  return stmts.listEngageQaReviewsByAssigneeEnriched.all(userId);
}

function listAllEngageQaReviewsEnriched() {
  return stmts.listAllEngageQaReviewsEnriched.all();
}

function listEngageQaReviewsByEngagementEnriched(engagementId) {
  return stmts.listEngageQaReviewsByEngagementEnriched.all(engagementId);
}

function createEngageNote(payload) {
  const id = payload.id || generateId();
  stmts.createEngageNote.run({
    id,
    entityType: payload.entityType,
    entityId: payload.entityId,
    userId: payload.userId,
    content: payload.content,
  });
  return stmts.listEngageNotesByEntity.all(payload.entityType, payload.entityId).find((n) => n.id === id);
}

function listEngageNotesByEntity(entityType, entityId) {
  return stmts.listEngageNotesByEntity.all(entityType, entityId);
}

function createEngageActivity(payload) {
  const id = payload.id || generateId();
  stmts.createEngageActivity.run({
    id,
    entityType: payload.entityType,
    entityId: payload.entityId,
    action: payload.action,
    userId: payload.userId || null,
    username: payload.username || null,
    details: typeof payload.details === "string" ? payload.details : JSON.stringify(payload.details || {}),
  });
}

function listEngageActivityByEntity(entityType, entityId, limit = 50) {
  return stmts.listEngageActivityByEntity.all(entityType, entityId, limit);
}

// ============================================================
// Engage dashboard functions
// ============================================================

function getEngageDashboardStats() {
  const pipeline = stmts.engagePipelineValue.get();
  const oppStages = stmts.engageOppStageCounts.all();
  const engStatuses = stmts.engageEngStatusCounts.all();
  const qaQueue = stmts.engageQaQueueCounts.all();
  const active = stmts.engageEngActiveCount.get();
  const scheduled = stmts.engageEngScheduledCount.get();
  const blocked = stmts.engageBlockedEngagements.all();
  const overdue = stmts.engageOverdueEngagements.all();

  const now = new Date();
  const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const monthEnd = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
  const oppThisMonth = stmts.engageOppThisMonth.all(monthStart, monthEnd);

  const oppCounts = {};
  for (const row of oppStages) oppCounts[row.stage] = row.count;
  const engCounts = {};
  for (const row of engStatuses) engCounts[row.status] = row.count;
  const qaCounts = {};
  for (const row of qaQueue) qaCounts[row.status] = row.count;
  const latestQaCounts = {};
  const seenQaEngagements = new Set();
  for (const row of stmts.listAllEngageQaReviewsEnriched.all()) {
    if (seenQaEngagements.has(row.engagement_id)) continue;
    seenQaEngagements.add(row.engagement_id);
    latestQaCounts[row.status] = (latestQaCounts[row.status] || 0) + 1;
  }
  const monthCounts = {};
  for (const row of oppThisMonth) monthCounts[row.stage] = row.count;

  const deliveredThisMonth = stmts.engageDeliveredThisMonth.get(monthStart, monthEnd);
  const closedThisMonth = stmts.engageClosedThisMonth.get(monthStart, monthEnd);
  const avgQA = stmts.engageAvgDaysInQA.get();

  // Utilisation aggregates
  const nowTs = Math.floor(Date.now() / 1000);
  const endTs = nowTs + (30 * 86400);
  const utilRows = stmts.engageUtilisationSummary.all(nowTs, endTs);
  const workingHoursPerMonth = 160;
  let totalUtilisation = 0;
  let userCount = 0;
  let overallocated = 0;
  const availableSoon = [];
  for (const row of utilRows) {
    const pct = workingHoursPerMonth > 0 ? Math.round((row.booked_hours / workingHoursPerMonth) * 100) : 0;
    totalUtilisation += pct;
    userCount++;
    if (pct > 100) overallocated++;
    if (pct < 50) availableSoon.push({ userId: row.assignee_user_id, username: row.username, bookedHours: row.booked_hours });
  }
  const teamUtilisationPercent = userCount > 0 ? Math.round(totalUtilisation / userCount) : 0;

  return {
    pipelineValue: pipeline.total,
    weightedPipelineValue: pipeline.weighted,
    openOpportunities: (oppCounts.lead || 0) + (oppCounts.qualified || 0) + (oppCounts.scoping || 0) +
      (oppCounts.proposal_drafting || 0) + (oppCounts.proposal_sent || 0) + (oppCounts.negotiation || 0),
    wonThisMonth: monthCounts.won || 0,
    lostThisMonth: monthCounts.lost || 0,
    activeEngagements: active.count,
    scheduledEngagements: scheduled.count,
    testingInProgress: engCounts.testing_in_progress || 0,
    reportingInProgress: engCounts.reporting_in_progress || 0,
    waitingForQA: (latestQaCounts.ready_for_qa || 0) + (latestQaCounts.assigned || 0),
    qaInProgress: latestQaCounts.reviewing || 0,
    qaChangesRequired: latestQaCounts.requires_more_work || 0,
    readyForDelivery: engCounts.ready_for_delivery || 0,
    deliveredThisMonth: deliveredThisMonth.count,
    closedThisMonth: closedThisMonth.count,
    blockedEngagements: blocked.length,
    overdueEngagements: overdue.length,
    averageDaysInQA: avgQA.avg_days ? Math.round(avgQA.avg_days / 86400) : null,
    teamUtilisationPercent,
    usersOverallocated: overallocated,
    usersAvailableSoon: availableSoon,
    blockedList: blocked,
    overdueList: overdue,
    oppStageDistribution: oppCounts,
    engStatusDistribution: engCounts,
    qaStatusDistribution: latestQaCounts,
  };
}

function getEngageMyWork(userId) {
  const myEngagements = stmts.engageMyEngagements.all(userId);
  const myQa = stmts.engageQaAssignedToUser.all(userId);
  return { myEngagements, myQa };
}

function getEngageRecentActivity() {
  return stmts.engageRecentActivity.all();
}

function listEngageActivityPage(limit, offset) {
  return stmts.engageActivityPage.all(limit, offset);
}

function getEngageActivityCount() {
  return stmts.engageActivityCount.get().total;
}

function getEngageRecentlyUpdated() {
  return stmts.engageRecentlyUpdated.all();
}

function getEngageUtilisationSummary(daysAhead = 30) {
  const now = Math.floor(Date.now() / 1000);
  const end = now + (daysAhead * 86400);
  return stmts.engageUtilisationSummary.all(now, end);
}

function getEngageEngagementsWithoutTesters() {
  return stmts.engageEngagementsWithoutTesters.all();
}

module.exports = {
  db,
  DB_PATH,
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
  listShareFileRowsByShareId,
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
  updateUserProfile,
  updateUserDetails,
  setUserRole,
  suspendUserById,
  unsuspendUserById,
  deleteUserById,
  listUsers,
  listUsersByPermission,
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
  BRAND_DIR,
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
  listCalendarEntriesByGroup,
  deleteCalendarEntriesByGroup,
  countCalendarEntriesByGroup,
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
  reorderWikiPages,
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
  // Threat Intel
  THREAT_VALID_FEED_TYPES,
  THREAT_VALID_CRITICALITIES,
  THREAT_VALID_CHANNEL_TYPES,
  createThreatFeed,
  listThreatFeeds,
  getThreatFeedById,
  updateThreatFeed,
  deleteThreatFeedById,
  updateThreatFeedFetchStatus,
  setThreatFeedKeywords,
  getThreatFeedKeywords,
  getThreatFeedsForKeyword,
  setThreatFeedTags,
  getThreatFeedTags,
  createThreatKeyword,
  listThreatKeywords,
  listThreatKeywordsForUser,
  listEffectiveThreatKeywordsForUser,
  getThreatKeywordById,
  getThreatKeywordByIdForUser,
  updateThreatKeyword,
  deleteThreatKeywordById,
  disableSystemKeywordForUser,
  enableSystemKeywordForUser,
  isSystemKeywordDisabledForUser,
  setThreatKeywordTags,
  setThreatKeywordTagsForUser,
  getThreatKeywordTags,
  getThreatKeywordTagsForUser,
  createThreatTag,
  listThreatTags,
  updateThreatTag,
  deleteThreatTagById,
  createThreatAlert,
  createOrUpdateThreatArticle,
  listThreatArticles,
  getThreatArticleByHash,
  getThreatArticleById,
  listThreatAlerts,
  listThreatAlertsForUser,
  getThreatAlertById,
  getThreatAlertByIdForUser,
  updateThreatAlert,
  updateThreatAlertForUser,
  markAllThreatAlertsRead,
  markAllThreatAlertsReadForUser,
  deleteThreatAlertById,
  hideThreatAlertForUser,
  cleanupOldThreatAlerts,
  cleanupOldThreatArticles,
  setThreatAlertTags,
  setThreatAlertTagsForUser,
  getThreatAlertTags,
  getThreatAlertTagsForUser,
  upsertThreatUserAlertKeyword,
  listThreatUsersEligibleForAlerts,
  isThreatAlertSuppressed,
  threatAlertExistsByArticleHash,
  getThreatAlertByArticleHash,
  getThreatAlertByArticleHashForUser,
  threatAlertExistsByContextHash,
  threatAlertExistsByFeedKeyword,
  listThreatAlertUserIds,
  createThreatApiTemplate,
  listThreatApiTemplates,
  getThreatApiTemplateById,
  updateThreatApiTemplate,
  deleteThreatApiTemplateById,
  createThreatNotificationConfig,
  listThreatNotificationConfigs,
  listThreatNotificationConfigsEnabled,
  updateThreatNotificationConfig,
  deleteThreatNotificationConfigById,
  upsertThreatUserNotification,
  listThreatUserNotifications,
  deleteThreatUserNotificationById,
  getThreatStats,
  getThreatStatsForUser,
  getThreatFeedHealth,
  getThreatFeedErrors,
  seedDefaultThreatData,
  createAuditEvent,
  listAuditEvents,
  listSchemaMigrations,
  createServiceAccount,
  updateServiceAccount,
  getServiceAccountById,
  listServiceAccounts,
  createServiceAccountToken,
  getServiceAccountTokenByHash,
  revokeServiceAccountToken,
  revokeServiceAccountTokens,
  touchServiceAccountToken,
  createPlatformWebhook,
  updatePlatformWebhook,
  getPlatformWebhookById,
  listPlatformWebhooks,
  listPlatformWebhooksForEvent,
  deletePlatformWebhook,
  createPlatformWebhookDelivery,
  listPendingPlatformWebhookDeliveries,
  listPlatformWebhookDeliveries,
  updatePlatformWebhookDelivery,
  upsertLeakRadarUnlockedRecord,
  getLeakRadarUnlockedRecordById,
  listLeakRadarUnlockedRecordsByIds,
  getDeploymentCounts,
  // Reporter
  createReporterDesignRow,
  getReporterDesignById,
  listReporterDesigns,
  updateReporterDesignRow,
  deleteReporterDesignById,
  createReporterProjectRow,
  getReporterProjectById,
  listReporterProjects,
  updateReporterProjectRow,
  updateReporterProjectStatus,
  archiveReporterProjectRow,
  setReporterProjectReadonly,
  deleteReporterProjectById,
  duplicateReporterProject,
  addReporterProjectMember,
  listReporterProjectMembers,
  updateReporterProjectMemberRoleRow,
  removeReporterProjectMemberRow,
  isReporterProjectMemberRow,
  createReporterFindingRow,
  getReporterFindingByIdRow,
  listReporterFindingsByProject,
  updateReporterFindingRow,
  updateReporterFindingStatusRow,
  deleteReporterFindingById,
  copyReporterFinding,
  reorderReporterFindingsRow,
  setReporterFindingFieldRow,
  createReporterSectionRow,
  getReporterSectionByIdRow,
  listReporterSectionsByProject,
  updateReporterSectionRow,
  deleteReporterSectionById,
  reorderReporterSectionsRow,
  createReporterFindingTemplateRow,
  getReporterFindingTemplateByIdRow,
  listReporterFindingTemplates,
  updateReporterFindingTemplateRow,
  deleteReporterFindingTemplateById,
  getReporterGlobalStats,
  getReporterProjectStats,
  createReporterPdfGenerationRow,
  updateReporterPdfGenerationRow,
  getReporterPdfGenerationById,
  listReporterPdfGenerationsByProject,
  deleteReporterPdfGenerationById,
  createReporterNoteRow,
  getReporterNoteById,
  listReporterNotesByProject,
  updateReporterNoteRow,
  deleteReporterNoteById,
  createReporterCommentRow,
  getReporterCommentById,
  listReporterCommentsByProject,
  listReporterCommentsByTarget,
  resolveReporterCommentRow,
  deleteReporterCommentById,
  createReporterHistoryRow,
  listReporterHistoryByProject,
  createReporterEvidenceRow,
  getReporterEvidenceById,
  listReporterEvidenceByProject,
  updateReporterEvidenceRow,
  deleteReporterEvidenceById,
  createReporterImportJobRow,
  updateReporterImportJobRow,
  listReporterImportJobsByProject,
  incrementReporterTemplateUsage: (id) => stmts.incrementReporterTemplateUsage.run(id),

  // --- Reporter Proposal functions ---
  getReporterProposalById,
  listReporterProposals,
  createReporterProposalRow,
  updateReporterProposalRow,
  updateReporterProposalStatus,
  archiveReporterProposalRow,
  unarchiveReporterProposalRow,
  listReporterProposalSections,
  getReporterProposalSectionById,
  createReporterProposalSectionRow,
  updateReporterProposalSectionRow,
  deleteReporterProposalSectionById,
  reorderReporterProposalSectionsRow,
  createReporterProposalGenerationRow,
  updateReporterProposalGenerationRow,
  getReporterProposalGenerationById,
  listReporterProposalGenerations,
  deleteReporterProposalGenerationById,
  listReporterProposalTemplates,
  getReporterProposalTemplateById,
  createReporterProposalTemplate,
  updateReporterProposalTemplate,
  archiveReporterProposalTemplate,
  duplicateReporterProposalTemplate,
  listReporterProposalTemplateSections,
  createReporterProposalTemplateSection,
  updateReporterProposalTemplateSection,
  deleteReporterProposalTemplateSection,
  listReporterTestTypeTemplates,
  listAllReporterTestTypeTemplates,
  getReporterTestTypeTemplateById,
  getReporterTestTypeTemplateByType,
  createReporterTestTypeTemplate,
  updateReporterTestTypeTemplate,
  archiveReporterTestTypeTemplate,
  duplicateReporterTestTypeTemplate,

  // --- Notification functions ---
  createNotification,
  getNotificationsByUserId,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationById,
  deleteExpiredNotifications,

  // --- Engage functions ---
  createEngageClient,
  getEngageClientById,
  listEngageClients,
  updateEngageClient,
  archiveEngageClient,
  createEngageContact,
  getEngageContactById,
  listEngageContactsByClient: (clientId) => stmts.listEngageContactsByClient.all(clientId),
  updateEngageContact,
  archiveEngageContact,
  createEngageOpportunity,
  getEngageOpportunityById,
  listEngageOpportunities,
  listEngageOpportunitiesByClient,
  updateEngageOpportunity,
  updateEngageOpportunityStage,
  linkEngageOpportunityProposal,
  listOppProposalLinks,
  createEngageEngagement,
  getEngageEngagementById,
  getEngageEngagementByReporterProject,
  getEngageEngagementByCalendarProject,
  listEngageEngagements,
  listEngageEngagementsByUser,
  listEngageEngagementsByClient,
  updateEngageEngagement,
  updateEngageEngagementStatus,
  archiveEngageEngagement,
  createEngageMember,
  listEngageMembersByEngagement,
  updateEngageMember,
  deleteEngageMember,
  createEngageQaReview,
  getEngageQaReviewById,
  updateEngageQaReview,
  listEngageQaReviewsByStatus,
  listEngageQaReviewsByAssignee,
  listEngageQaReviewsByEngagement: (engagementId) => stmts.listEngageQaReviewsByEngagement.all(engagementId),
  listEngageQaReviewsByStatusEnriched,
  listEngageQaReviewsByAssigneeEnriched,
  listAllEngageQaReviewsEnriched,
  listEngageQaReviewsByEngagementEnriched,
  createEngageNote,
  listEngageNotesByEntity,
  createEngageActivity,
  listEngageActivityByEntity,
  listEngageActivityPage,
  getEngageActivityCount,
  getEngageDashboardStats,
  getEngageMyWork,
  getEngageRecentActivity,
  getEngageRecentlyUpdated,
  getEngageUtilisationSummary,
  getEngageEngagementsWithoutTesters,
};
