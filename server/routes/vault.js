const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const {
  createVault, getVault, getUserVaults, updateVault, deleteVault,
  addVaultMember, getVaultMembersList, getVaultMemberShip, updateVaultMemberPermission, removeVaultMember,
  createVaultEntry, getVaultEntriesList, getVaultEntry, updateVaultEntry, deleteVaultEntry,
  getVaultEntryHistoryList,
  createVaultEntryShare, getSharesForUser, getSharesByEntryId, getVaultShare, deleteVaultShare,
  createVaultAudit, getVaultAuditLog,
  getUserKey, searchUsersWithKeys,
} = require("../database");
const { requireUser } = require("../middleware/auth");
const { decodeBase64Strict } = require("../base64");
const { logEvent } = require("../core/logger");

const router = Router();

// Rate limits
const createVaultLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { error: "Too many vaults created. Try again later." },
  standardHeaders: true, legacyHeaders: false,
});
const createEntryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 100,
  message: { error: "Too many entries created. Try again later." },
  standardHeaders: true, legacyHeaders: false,
});
const shareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 50,
  message: { error: "Too many shares created. Try again later." },
  standardHeaders: true, legacyHeaders: false,
});
const readLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 200,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true, legacyHeaders: false,
});
const memberLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  message: { error: "Too many member changes. Try again later." },
  standardHeaders: true, legacyHeaders: false,
});

// --- Helpers ---

function toBase64(buffer) {
  if (!buffer) return null;
  return Buffer.from(buffer).toString("base64");
}

function validateBase64(value, name, requiredLength) {
  if (typeof value !== "string") return `${name} must be a string`;
  if (!value.length) return `${name} is empty`;
  try {
    const decoded = decodeBase64Strict(value);
    if (requiredLength && decoded.length !== requiredLength) {
      return `${name} must decode to ${requiredLength} bytes (got ${decoded.length})`;
    }
    return null;
  } catch {
    return `${name} is not valid base64`;
  }
}

function logAction(action, req, extra = {}) {
  logEvent(action, req, extra);
}

function generateId() {
  return crypto.randomBytes(16).toString("base64url");
}

const VALID_ENTRY_TYPES = ["password", "note", "api_key", "ssh_key", "totp", "custom"];
const VALID_VAULT_TYPES = ["personal", "team"];
const MAX_ENCRYPTED_SIZE = 256 * 1024; // 256KB per encrypted field

function normalizeVaultPermission(rawPermission) {
  const value = String(rawPermission || "editor").toLowerCase().trim();
  if (["full", "admin", "manager"].includes(value)) {
    return { permission: "full", role: "admin", canWrite: true, canManageMembers: true };
  }
  if (["viewer", "read-only", "read_only", "readonly", "read only"].includes(value)) {
    return { permission: "viewer", role: "member", canWrite: false, canManageMembers: false };
  }
  return { permission: "editor", role: "member", canWrite: true, canManageMembers: false };
}

function membershipPermission(membership) {
  if (!membership) {
    return normalizeVaultPermission("viewer");
  }
  if (membership.can_manage_members) {
    return normalizeVaultPermission("full");
  }
  if (membership.can_write) {
    return normalizeVaultPermission("editor");
  }
  return normalizeVaultPermission("viewer");
}

// Check user owns or is member of vault
function userHasVaultAccess(vaultId, userId) {
  const vault = getVault(vaultId);
  if (!vault) return { error: "not_found" };
  const membership = getVaultMemberShip(vaultId, userId);
  if (vault.owner_id === userId) {
    return {
      vault,
      membership: membership || null,
      permission: "full",
      canWrite: true,
      canManageMembers: true,
      isOwner: true,
    };
  }
  if (!membership) return { error: "forbidden" };
  const permission = membershipPermission(membership);
  return {
    vault,
    membership,
    permission: permission.permission,
    canWrite: permission.canWrite,
    canManageMembers: permission.canManageMembers,
    isOwner: false,
  };
}

// ============================================================
// Vault CRUD
// ============================================================

// GET /api/vault/vaults
router.get("/vault/vaults", readLimiter, requireUser, (req, res) => {
  const vaults = getUserVaults(req.user.id);
  res.json({
    vaults: vaults.map((v) => ({
      id: v.id,
      nameEncrypted: toBase64(v.name_encrypted),
      nameIv: toBase64(v.name_iv),
      type: v.type,
      ownerId: v.owner_id,
      encryptedMasterKey: toBase64(v.encrypted_master_key),
      masterKeyIv: toBase64(v.master_key_iv),
      masterKeySalt: toBase64(v.master_key_salt),
      permissions: v.owner_id === req.user.id
        ? { permission: "full", canWrite: true, canManageMembers: true, isOwner: true }
        : (() => {
          const membership = getVaultMemberShip(v.id, req.user.id);
          const permission = membershipPermission(membership);
          return {
            permission: permission.permission,
            canWrite: permission.canWrite,
            canManageMembers: permission.canManageMembers,
            isOwner: false,
          };
        })(),
      createdAt: v.created_at,
      updatedAt: v.updated_at,
    })),
  });
});

// POST /api/vault/vaults
router.post("/vault/vaults", createVaultLimiter, requireUser, (req, res) => {
  const { nameEncrypted, nameIv, type, encryptedMasterKey, masterKeyIv, masterKeySalt, members } = req.body;

  if (!nameEncrypted || !nameIv || !type) {
    return res.status(400).json({ error: "Missing required fields: nameEncrypted, nameIv, type" });
  }
  if (!VALID_VAULT_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid vault type" });
  }
  const nameIvErr = validateBase64(nameIv, "nameIv", 12);
  if (nameIvErr) return res.status(400).json({ error: nameIvErr });
  const nameErr = validateBase64(nameEncrypted, "nameEncrypted");
  if (nameErr) return res.status(400).json({ error: nameErr });
  if (decodeBase64Strict(nameEncrypted).length > MAX_ENCRYPTED_SIZE) {
    return res.status(413).json({ error: "Encrypted name too large" });
  }
  if (encryptedMasterKey) {
    const mkErr = validateBase64(encryptedMasterKey, "encryptedMasterKey");
    if (mkErr) return res.status(400).json({ error: mkErr });
  }
  if (masterKeyIv) {
    const ivErr = validateBase64(masterKeyIv, "masterKeyIv", 12);
    if (ivErr) return res.status(400).json({ error: ivErr });
  }
  if (masterKeySalt) {
    const saltErr = validateBase64(masterKeySalt, "masterKeySalt", 16);
    if (saltErr) return res.status(400).json({ error: saltErr });
  }

  // Team vault: validate members array
  if (type === "team") {
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "Team vaults require at least one member" });
    }
    const seenUserIds = new Set();
    for (const m of members) {
      if (!m.userId || !m.encryptedMasterKey) {
        return res.status(400).json({ error: "Each member must have userId and encryptedMasterKey" });
      }
      if (seenUserIds.has(m.userId)) {
        return res.status(400).json({ error: "Duplicate team member" });
      }
      seenUserIds.add(m.userId);
      const targetKey = getUserKey(m.userId);
      if (!targetKey) {
        return res.status(400).json({ error: "Each team member must have encryption keys set up" });
      }
    }
  }

  const id = generateId();

  try {
    createVault({ id, nameEncrypted, nameIv, type, ownerId: req.user.id, encryptedMasterKey, masterKeyIv, masterKeySalt });

    // Add members for team vault
    if (type === "team") {
      for (const m of members) {
        addVaultMember({
          id: generateId(), vaultId: id, userId: m.userId,
          role: normalizeVaultPermission(m.permission || m.role).role,
          canWrite: normalizeVaultPermission(m.permission || m.role).canWrite,
          canManageMembers: normalizeVaultPermission(m.permission || m.role).canManageMembers,
          encryptedMasterKey: m.encryptedMasterKey,
        });
      }
    }

    createVaultAudit({ id: generateId(), vaultId: id, userId: req.user.id, action: "create" });
    logAction("vault:create", req, { id, type });
    res.status(201).json({ id });
  } catch (err) {
    logAction("vault:create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to create vault" });
  }
});

// PUT /api/vault/vaults/:id
router.put("/vault/vaults/:id", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { nameEncrypted, nameIv } = req.body;

  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
  if (!access.canWrite) return res.status(403).json({ error: "Write access required" });

  if (!nameEncrypted || !nameIv) {
    return res.status(400).json({ error: "Missing required fields: nameEncrypted, nameIv" });
  }
  const nameIvErr = validateBase64(nameIv, "nameIv", 12);
  if (nameIvErr) return res.status(400).json({ error: nameIvErr });
  const nameErr = validateBase64(nameEncrypted, "nameEncrypted");
  if (nameErr) return res.status(400).json({ error: nameErr });

  try {
    updateVault({ id, nameEncrypted, nameIv });
    logAction("vault:update", req, { id });
    res.json({ success: true });
  } catch (err) {
    logAction("vault:update_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to update vault" });
  }
});

// DELETE /api/vault/vaults/:id
router.delete("/vault/vaults/:id", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const vault = getVault(id);
  if (!vault) return res.status(404).json({ error: "Vault not found" });
  if (vault.owner_id !== req.user.id) return res.status(403).json({ error: "Only the owner can delete a vault" });

  try {
    deleteVault(id);
    logAction("vault:delete", req, { id });
    res.json({ success: true });
  } catch (err) {
    logAction("vault:delete_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to delete vault" });
  }
});

// GET /api/vault/vaults/:id/master-key — get encrypted master key for personal vault unlock
router.get("/vault/vaults/:id/master-key", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  const vault = access.vault;
  if (vault.type === "personal") {
    return res.json({
      encryptedMasterKey: toBase64(vault.encrypted_master_key),
      masterKeyIv: toBase64(vault.master_key_iv),
      masterKeySalt: toBase64(vault.master_key_salt),
    });
  }

  // Team vault: return the member's encrypted master key
  const membership = access.membership || getVaultMemberShip(vault.id, req.user.id);
  if (membership?.encrypted_master_key) {
    return res.json({ encryptedMasterKey: membership.encrypted_master_key });
  }
  // Owner not in vault_members (pre-migration vault)
  if (vault.owner_id === req.user.id) {
    return res.json({ encryptedMasterKey: null });
  }
  return res.status(403).json({ error: "Not a member" });
});

// ============================================================
// Vault Members
// ============================================================

// GET /api/vault/vaults/:id/members
router.get("/vault/vaults/:id/members", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  const members = getVaultMembersList(id);
  res.json({
    members: members.map((m) => ({
      id: m.id, userId: m.user_id, username: m.username,
      role: m.role, joinedAt: m.joined_at,
      isOwner: m.user_id === access.vault.owner_id,
      permission: membershipPermission(m).permission,
      canWrite: !!m.can_write,
      canManageMembers: !!m.can_manage_members,
      avatarUpdatedAt: m.avatar_updated_at,
    })),
  });
});

// POST /api/vault/vaults/:id/members
router.post("/vault/vaults/:id/members", memberLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { userId, role, permission, encryptedMasterKey } = req.body;

  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
  const vault = access.vault;
  if (vault.type !== "team") return res.status(400).json({ error: "Only team vaults support members" });
  if (!access.canManageMembers) return res.status(403).json({ error: "Member management access required" });
  if (!userId || !encryptedMasterKey) return res.status(400).json({ error: "Missing userId and encryptedMasterKey" });

  // Verify the target user has RSA keys (needed for key wrapping)
  const targetKey = getUserKey(userId);
  if (!targetKey) return res.status(400).json({ error: "Target user has no encryption keys set up" });

  try {
    const normalizedPermission = normalizeVaultPermission(permission || role);
    addVaultMember({
      id: generateId(),
      vaultId: id,
      userId,
      role: normalizedPermission.role,
      canWrite: normalizedPermission.canWrite,
      canManageMembers: normalizedPermission.canManageMembers,
      encryptedMasterKey,
    });
    createVaultAudit({ id: generateId(), vaultId: id, userId: req.user.id, action: "add_member", entryId: userId });
    logAction("vault:add_member", req, { vaultId: id, memberId: userId });
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "User is already a member of this vault" });
    }
    logAction("vault:add_member_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to add member" });
  }
});

// PUT /api/vault/vaults/:id/members/:userId
router.put("/vault/vaults/:id/members/:userId", memberLimiter, requireUser, (req, res) => {
  const { id, userId } = req.params;
  const { role, permission } = req.body || {};

  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
  if (access.vault.type !== "team") return res.status(400).json({ error: "Only team vaults support members" });
  if (!access.canManageMembers) return res.status(403).json({ error: "Member management access required" });
  if (userId === access.vault.owner_id) return res.status(400).json({ error: "Owner permissions cannot be changed" });

  const membership = getVaultMemberShip(id, userId);
  if (!membership) return res.status(404).json({ error: "Member not found" });

  const normalizedPermission = normalizeVaultPermission(permission || role);
  const updated = updateVaultMemberPermission({
    vaultId: id,
    userId,
    role: normalizedPermission.role,
    canWrite: normalizedPermission.canWrite,
    canManageMembers: normalizedPermission.canManageMembers,
  });

  if (!updated) {
    return res.status(404).json({ error: "Member not found" });
  }

  createVaultAudit({ id: generateId(), vaultId: id, userId: req.user.id, action: "update_member", entryId: userId });
  logAction("vault:update_member", req, { vaultId: id, memberId: userId, permission: normalizedPermission.permission });
  res.json({ success: true });
});

// DELETE /api/vault/vaults/:id/members/:userId
router.delete("/vault/vaults/:id/members/:userId", memberLimiter, requireUser, (req, res) => {
  const { id, userId } = req.params;
  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
  if (!access.canManageMembers) return res.status(403).json({ error: "Member management access required" });
  if (userId === access.vault.owner_id) return res.status(400).json({ error: "Owner cannot be removed from vault" });

  try {
    removeVaultMember(id, userId);
    createVaultAudit({ id: generateId(), vaultId: id, userId: req.user.id, action: "remove_member", entryId: userId });
    logAction("vault:remove_member", req, { vaultId: id, memberId: userId });
    res.json({ success: true });
  } catch (err) {
    logAction("vault:remove_member_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ============================================================
// Vault Entries
// ============================================================

// GET /api/vault/vaults/:id/entries
router.get("/vault/vaults/:id/entries", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  const entries = getVaultEntriesList(id);
  res.json({
    entries: entries.map((e) => ({
      id: e.id, vaultId: e.vault_id, type: e.type,
      titleEncrypted: toBase64(e.title_encrypted), titleIv: toBase64(e.title_iv),
      dataEncrypted: toBase64(e.data_encrypted), dataIv: toBase64(e.data_iv),
      folderEncrypted: toBase64(e.folder_encrypted), folderIv: toBase64(e.folder_iv),
      favorite: !!e.favorite, version: e.version,
      createdAt: e.created_at, updatedAt: e.updated_at,
    })),
  });
});

// POST /api/vault/vaults/:id/entries
router.post("/vault/vaults/:id/entries", createEntryLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { type, titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite } = req.body;

  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
  if (!access.canWrite) return res.status(403).json({ error: "Write access required" });

  if (!type || !titleEncrypted || !titleIv || !dataEncrypted || !dataIv) {
    return res.status(400).json({ error: "Missing required fields: type, titleEncrypted, titleIv, dataEncrypted, dataIv" });
  }
  if (!VALID_ENTRY_TYPES.includes(type)) {
    return res.status(400).json({ error: "Invalid entry type" });
  }

  // Validate base64 fields
  for (const [field, len] of [["titleIv", 12], ["dataIv", 12]]) {
    const err = validateBase64(req.body[field], field, len);
    if (err) return res.status(400).json({ error: err });
  }
  for (const field of ["titleEncrypted", "dataEncrypted"]) {
    const err = validateBase64(req.body[field], field);
    if (err) return res.status(400).json({ error: err });
    if (decodeBase64Strict(req.body[field]).length > MAX_ENCRYPTED_SIZE) {
      return res.status(413).json({ error: `${field} too large (max 256KB)` });
    }
  }
  if (folderEncrypted) {
    const err = validateBase64(folderEncrypted, "folderEncrypted");
    if (err) return res.status(400).json({ error: err });
  }
  if (folderIv) {
    const err = validateBase64(folderIv, "folderIv", 12);
    if (err) return res.status(400).json({ error: err });
  }

  const entryId = generateId();
  try {
    createVaultEntry({
      id: entryId, vaultId: id, type,
      titleEncrypted, titleIv, dataEncrypted, dataIv,
      folderEncrypted: folderEncrypted || null, folderIv: folderIv || null,
      favorite: !!favorite,
    });
    createVaultAudit({ id: generateId(), vaultId: id, entryId, userId: req.user.id, action: "create" });
    logAction("vault:entry_create", req, { vaultId: id, entryId, type });
    res.status(201).json({ id: entryId });
  } catch (err) {
    logAction("vault:entry_create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to create entry" });
  }
});

// PUT /api/vault/entries/:id
router.put("/vault/entries/:id", createEntryLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite } = req.body;

  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error) return res.status(access.error === "not_found" ? 404 : 403).json({ error: "Access denied" });
  if (!access.canWrite) return res.status(403).json({ error: "Write access required" });

  if (!titleEncrypted || !titleIv || !dataEncrypted || !dataIv) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  for (const [field, len] of [["titleIv", 12], ["dataIv", 12]]) {
    const err = validateBase64(req.body[field], field, len);
    if (err) return res.status(400).json({ error: err });
  }
  for (const field of ["titleEncrypted", "dataEncrypted"]) {
    const err = validateBase64(req.body[field], field);
    if (err) return res.status(400).json({ error: err });
  }

  try {
    updateVaultEntry({
      id, titleEncrypted, titleIv, dataEncrypted, dataIv,
      folderEncrypted: folderEncrypted || null, folderIv: folderIv || null,
      favorite: !!favorite,
    });
    createVaultAudit({ id: generateId(), vaultId: entry.vault_id, entryId: id, userId: req.user.id, action: "update" });
    logAction("vault:entry_update", req, { entryId: id });
    res.json({ success: true });
  } catch (err) {
    logAction("vault:entry_update_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// DELETE /api/vault/entries/:id
router.delete("/vault/entries/:id", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error) return res.status(access.error === "not_found" ? 404 : 403).json({ error: "Access denied" });
  if (!access.canWrite) return res.status(403).json({ error: "Write access required" });

  try {
    deleteVaultEntry(id);
    createVaultAudit({ id: generateId(), vaultId: entry.vault_id, entryId: id, userId: req.user.id, action: "delete" });
    logAction("vault:entry_delete", req, { entryId: id });
    res.json({ success: true });
  } catch (err) {
    logAction("vault:entry_delete_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

// GET /api/vault/entries/:id/history
router.get("/vault/entries/:id/history", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error) return res.status(access.error === "not_found" ? 404 : 403).json({ error: "Access denied" });

  const history = getVaultEntryHistoryList(id);
  res.json({
    history: history.map((h) => ({
      id: h.id, entryId: h.entry_id, version: h.version,
      dataEncrypted: toBase64(h.data_encrypted), dataIv: toBase64(h.data_iv),
      createdAt: h.created_at,
    })),
  });
});

// ============================================================
// Entry Sharing
// ============================================================

// POST /api/vault/entries/:id/share
router.post("/vault/entries/:id/share", shareLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { toUserId, encryptedEntryKey, titleEncrypted, titleIv, dataEncrypted, dataIv, expiresAt } = req.body;

  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error) return res.status(403).json({ error: "Access denied" });
  if (!access.canWrite) return res.status(403).json({ error: "Write access required" });

  if (!toUserId || !encryptedEntryKey || !titleEncrypted || !titleIv || !dataEncrypted || !dataIv) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (toUserId === req.user.id) return res.status(400).json({ error: "Cannot share with yourself" });

  // Validate target user exists and has keys
  const targetKey = getUserKey(toUserId);
  if (!targetKey) return res.status(400).json({ error: "Target user has no encryption keys" });

  for (const [field, len] of [["titleIv", 12], ["dataIv", 12]]) {
    const err = validateBase64(req.body[field], field, len);
    if (err) return res.status(400).json({ error: err });
  }
  for (const field of ["titleEncrypted", "dataEncrypted"]) {
    const err = validateBase64(req.body[field], field);
    if (err) return res.status(400).json({ error: err });
  }

  const shareId = generateId();
  try {
    createVaultEntryShare({
      id: shareId, entryId: id, fromUserId: req.user.id, toUserId,
      encryptedEntryKey, titleEncrypted, titleIv, dataEncrypted, dataIv,
      expiresAt: expiresAt || null,
    });
    createVaultAudit({ id: generateId(), vaultId: entry.vault_id, entryId: id, userId: req.user.id, action: "share" });
    logAction("vault:share_create", req, { entryId: id, shareId, toUserId });
    res.status(201).json({ id: shareId });
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "Already shared with this user" });
    }
    logAction("vault:share_create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to share entry" });
  }
});

// GET /api/vault/shared
router.get("/vault/shared", readLimiter, requireUser, (req, res) => {
  const shares = getSharesForUser(req.user.id);
  res.json({
    shares: shares.map((s) => ({
      id: s.id, entryId: s.entry_id, fromUserId: s.from_user_id, fromUsername: s.from_username,
      type: s.entry_type,
      encryptedEntryKey: s.encrypted_entry_key,
      titleEncrypted: toBase64(s.title_encrypted), titleIv: toBase64(s.title_iv),
      dataEncrypted: toBase64(s.data_encrypted), dataIv: toBase64(s.data_iv),
      createdAt: s.created_at, expiresAt: s.expires_at,
    })),
  });
});

// DELETE /api/vault/shared/:id
router.delete("/vault/shared/:id", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const share = getVaultShare(id);
  if (!share) return res.status(404).json({ error: "Share not found" });
  // Only the sender or recipient can revoke
  if (share.from_user_id !== req.user.id && share.to_user_id !== req.user.id) {
    return res.status(403).json({ error: "Access denied" });
  }
  const success = deleteVaultShare(id);
  if (!success) return res.status(404).json({ error: "Share not found" });
  logAction("vault:share_delete", req, { shareId: id });
  res.json({ success: true });
});

// GET /api/vault/entries/:id/shares
router.get("/vault/entries/:id/shares", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error) return res.status(403).json({ error: "Access denied" });

  const shares = getSharesByEntryId(id);
  res.json({
    shares: shares.map((s) => ({
      id: s.id, toUserId: s.to_user_id, toUsername: s.to_username,
      createdAt: s.created_at, expiresAt: s.expires_at,
    })),
  });
});

// ============================================================
// Audit Log
// ============================================================

// GET /api/vault/vaults/:id/audit
router.get("/vault/vaults/:id/audit", readLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const access = userHasVaultAccess(id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  const page = parseInt(req.query.page, 10) || 1;
  const logs = getVaultAuditLog(id, page);
  res.json({ logs });
});

// ============================================================
// User search (for sharing / adding members)
// ============================================================

// GET /api/vault/users/search?q=...
router.get("/vault/users/search", readLimiter, requireUser, (req, res) => {
  const q = (req.query.q || "").trim();
  // Empty query returns all users (for listing), non-empty filters
  const users = searchUsersWithKeys(q, req.user.id);
  res.json({
    users: users.map((u) => ({
      id: u.id, username: u.username, hasPublicKey: !!u.has_public_key,
      avatarUpdatedAt: u.avatar_updated_at,
    })),
  });
});

module.exports = router;
