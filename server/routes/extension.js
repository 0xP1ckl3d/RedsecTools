const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const totp = require("../totp");
const { requireExtensionUser } = require("../middleware/auth");
const { decodeBase64Strict } = require("../base64");
const {
  getUserByEmail,
  getUserById,
  getUserMFA,
  updateRecoveryCodes,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
  incrementPendingLoginAttempts,
  createTrustedDevice,
  getTrustedDeviceByTokenHash,
  getMfaLoginState,
  setMfaLoginState,
  clearMfaLoginState,
  getAuthLoginState,
  setAuthLoginState,
  clearAuthLoginState,
  getSetting,
  decryptValue,
  createExtensionSession,
  getExtensionSession,
  deleteExtensionSessionById,
  getUserVaults,
  getVault,
  getVaultMemberShip,
  getVaultEntriesList,
  createVaultEntry,
  updateVaultEntry,
  createVaultAudit,
  getSharesForUser,
  getUserKey,
  getVaultEntry,
  createPaste,
  createShare,
  VALID_EXPIRY_OPTIONS,
  VALID_SYNTAX_OPTIONS,
  TMP_DIR,
  FILES_DIR,
} = require("../database");

const router = Router();

const BCRYPT_ROUNDS = 12;
const VALID_ENTRY_TYPES = ["password", "note", "api_key", "ssh_key", "totp", "custom"];
const MAX_ENCRYPTED_SIZE = 256 * 1024;
const MAX_PASTE_CIPHERTEXT_SIZE = 512 * 1024;
const MIME_REGEX = /^[a-z0-9][a-z0-9!#$&\-^_.+]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/i;
const MAX_MIME_LENGTH = 128;
const TRUST_COOKIE_NAME = "redsec_mfa_trust";

function getSessionTTL(extended) {
  const ttl = parseInt(getSetting("session_ttl"), 10) || 43200;
  const extTtl = parseInt(getSetting("session_ttl_extended"), 10) || 604800;
  const maxExt = 30 * 24 * 60 * 60;
  return extended ? Math.min(extTtl, maxExt) : ttl;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = (req.body?.email || "").toLowerCase().trim();
    return `${req.ip}:${email || "unknown"}`;
  },
  message: { error: "Too many login attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const readLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const createEntryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: "Too many entries created. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const createPasteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Too many pastes created. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const createShareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many uploads. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex")),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
});

function logAction(action, req, extra = {}) {
  const ip = req.ip || req.connection?.remoteAddress;
  console.log(JSON.stringify({ ts: new Date().toISOString(), action, ip, userId: req.user?.id, ...extra }));
}

function generateId(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

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

function cleanupUploadedFiles(files) {
  for (const file of files || []) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
}

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
  if (!membership) return normalizeVaultPermission("viewer");
  if (membership.can_manage_members) return normalizeVaultPermission("full");
  if (membership.can_write) return normalizeVaultPermission("editor");
  return normalizeVaultPermission("viewer");
}

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

function createAuthenticatedExtensionSession(userId, ttl, req) {
  const sessionId = generateId(32);
  return createExtensionSession({
    id: sessionId,
    userId,
    expiresIn: ttl,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

function getMfaThrottleStatus(userId) {
  const state = getMfaLoginState(userId);
  if (!state) return { failedAttempts: 0, blockedUntil: 0 };

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 60 * 60;
  if (state.first_failed_at && (now - state.first_failed_at) > windowSeconds && state.blocked_until <= now) {
    clearMfaLoginState(userId);
    return { failedAttempts: 0, blockedUntil: 0 };
  }

  return {
    failedAttempts: state.failed_attempts || 0,
    blockedUntil: state.blocked_until || 0,
  };
}

function recordMfaFailure(userId) {
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 60 * 60;
  const current = getMfaThrottleStatus(userId);
  const existing = getMfaLoginState(userId);

  let failedAttempts = 1;
  let firstFailedAt = now;
  if (existing && existing.first_failed_at && (now - existing.first_failed_at) <= windowSeconds) {
    failedAttempts = current.failedAttempts + 1;
    firstFailedAt = existing.first_failed_at;
  }

  let cooldownSeconds = 0;
  if (failedAttempts >= 10) cooldownSeconds = 10 * 60;
  else if (failedAttempts >= 7) cooldownSeconds = 2 * 60;
  else if (failedAttempts >= 4) cooldownSeconds = 30;

  const blockedUntil = cooldownSeconds > 0 ? now + cooldownSeconds : 0;
  setMfaLoginState(userId, { failedAttempts, firstFailedAt, blockedUntil });
  return { failedAttempts, blockedUntil, cooldownSeconds };
}

function getLoginThrottleStatus(email) {
  const state = getAuthLoginState(email);
  if (!state) return { failedAttempts: 0, blockedUntil: 0 };

  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 60 * 60;
  if (state.first_failed_at && (now - state.first_failed_at) > windowSeconds && state.blocked_until <= now) {
    clearAuthLoginState(email);
    return { failedAttempts: 0, blockedUntil: 0 };
  }

  return {
    failedAttempts: state.failed_attempts || 0,
    blockedUntil: state.blocked_until || 0,
  };
}

function recordLoginFailure(email) {
  const now = Math.floor(Date.now() / 1000);
  const windowSeconds = 60 * 60;
  const current = getLoginThrottleStatus(email);
  const existing = getAuthLoginState(email);

  let failedAttempts = 1;
  let firstFailedAt = now;
  if (existing && existing.first_failed_at && (now - existing.first_failed_at) <= windowSeconds) {
    failedAttempts = current.failedAttempts + 1;
    firstFailedAt = existing.first_failed_at;
  }

  let cooldownSeconds = 0;
  if (failedAttempts >= 10) cooldownSeconds = 10 * 60;
  else if (failedAttempts >= 7) cooldownSeconds = 2 * 60;
  else if (failedAttempts >= 4) cooldownSeconds = 30;

  const blockedUntil = cooldownSeconds > 0 ? now + cooldownSeconds : 0;
  setAuthLoginState(email, { failedAttempts, firstFailedAt, blockedUntil });
  return { failedAttempts, blockedUntil, cooldownSeconds };
}

function getRemainingRecoveryCodes(mfaConfig) {
  if (!mfaConfig) return 0;
  try {
    const codes = JSON.parse(mfaConfig.recovery_codes);
    return codes.filter((code) => code !== null).length;
  } catch {
    return 0;
  }
}

function setTrustedDeviceCookie(res, userId, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const days = parseInt(getSetting("mfa_remember_days"), 10) || 30;
  const expiresIn = days * 24 * 60 * 60;

  createTrustedDevice({
    id: generateId(16),
    userId,
    tokenHash,
    deviceName: (req.get("user-agent") || "").substring(0, 200),
    expiresIn,
  });

  res.cookie(TRUST_COOKIE_NAME, { u: userId.substring(0, 8), t: token }, {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: expiresIn * 1000,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

function checkTrustedDevice(req, userId) {
  try {
    const raw = req.signedCookies[TRUST_COOKIE_NAME];
    if (!raw || !raw.u || !raw.t) return false;
    if (raw.u !== userId.substring(0, 8)) return false;
    const tokenHash = crypto.createHash("sha256").update(raw.t).digest("hex");
    const device = getTrustedDeviceByTokenHash(tokenHash);
    if (!device) return false;
    if (device.user_id !== userId) return false;
    if (device.expires_at < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password, keepSignedIn, rememberBrowser } = req.body || {};
  const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const throttle = getLoginThrottleStatus(normalizedEmail);
  const now = Math.floor(Date.now() / 1000);
  if (throttle.blockedUntil > now) {
    return res.status(429).json({
      error: `Too many login attempts. Try again in ${throttle.blockedUntil - now} seconds.`,
      retryAfter: throttle.blockedUntil - now,
    });
  }

  const user = getUserByEmail(normalizedEmail);
  if (!user) {
    logAction("ext:auth_login_failed", req, { email: normalizedEmail, reason: "not_found" });
    const failure = recordLoginFailure(normalizedEmail);
    if (failure.cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${failure.cooldownSeconds} seconds.`,
        retryAfter: failure.cooldownSeconds,
      });
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.suspended) {
    logAction("ext:auth_login_failed", req, { email: normalizedEmail, reason: "suspended", targetUserId: user.id });
    recordLoginFailure(normalizedEmail);
    return res.status(403).json({ error: "Account suspended" });
  }

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) {
    logAction("ext:auth_login_failed", req, { email: normalizedEmail, reason: "wrong_password", targetUserId: user.id });
    const failure = recordLoginFailure(normalizedEmail);
    if (failure.cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${failure.cooldownSeconds} seconds.`,
        retryAfter: failure.cooldownSeconds,
      });
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }

  clearAuthLoginState(normalizedEmail);

  const mfaConfig = getUserMFA(user.id);
  const mfaRequired = getSetting("mfa_required") === "true";
  const mfaEnabled = mfaConfig && mfaConfig.enabled;

  if (mfaRequired && !mfaEnabled) {
    const tempToken = generateId(32);
    createPendingLogin({
      id: tempToken,
      userId: user.id,
      expiresIn: 300,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: !!rememberBrowser,
    });
    logAction("ext:mfa_setup_required", req, { targetUserId: user.id });
    return res.json({ mfaSetupRequired: true, tempToken });
  }

  if (mfaEnabled) {
    if (checkTrustedDevice(req, user.id)) {
      const ttl = getSessionTTL(!!keepSignedIn);
      const session = createAuthenticatedExtensionSession(user.id, ttl, req);
      logAction("ext:auth_login_trusted", req, { targetUserId: user.id });
      return res.json({
        success: true,
        token: session.id,
        expiresAt: session.expiresAt,
        user: { id: user.id, username: user.username, avatarUpdatedAt: user.avatar_updated_at || null },
      });
    }

    const tempToken = generateId(32);
    createPendingLogin({
      id: tempToken,
      userId: user.id,
      expiresIn: 300,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: !!rememberBrowser,
    });

    const mfaThrottle = getMfaThrottleStatus(user.id);
    logAction("ext:mfa_required", req, { targetUserId: user.id });
    return res.json({
      mfaRequired: true,
      tempToken,
      hasRecoveryCodes: getRemainingRecoveryCodes(mfaConfig) > 0,
      cooldownSeconds: mfaThrottle.blockedUntil > now ? mfaThrottle.blockedUntil - now : 0,
    });
  }

  const ttl = getSessionTTL(!!keepSignedIn);
  const session = createAuthenticatedExtensionSession(user.id, ttl, req);
  logAction("ext:auth_login", req, { targetUserId: user.id });
  res.json({
    success: true,
    token: session.id,
    expiresAt: session.expiresAt,
    user: { id: user.id, username: user.username, avatarUpdatedAt: user.avatar_updated_at || null },
  });
});

router.post("/auth/login/mfa", async (req, res) => {
  const { tempToken, code, recoveryCode, rememberBrowser } = req.body || {};
  if (!tempToken) {
    return res.status(400).json({ error: "Temporary token is required" });
  }

  const pending = getPendingLogin(tempToken);
  if (!pending) {
    return res.status(401).json({ error: "Invalid or expired MFA session" });
  }
  if (pending.expires_at < Math.floor(Date.now() / 1000)) {
    deletePendingLogin(tempToken);
    return res.status(401).json({ error: "MFA session expired. Please try again." });
  }

  const mfaConfig = getUserMFA(pending.user_id);
  if (!mfaConfig || !mfaConfig.enabled) {
    deletePendingLogin(tempToken);
    return res.status(400).json({ error: "MFA not configured for this account" });
  }

  const now = Math.floor(Date.now() / 1000);
  const throttle = getMfaThrottleStatus(pending.user_id);
  if (throttle.blockedUntil > now) {
    return res.status(429).json({
      error: `Too many invalid MFA attempts. Try again in ${throttle.blockedUntil - now} seconds.`,
      retryAfter: throttle.blockedUntil - now,
    });
  }

  const secret = decryptValue(mfaConfig.totp_secret_encrypted);
  let verified = false;

  if (recoveryCode) {
    try {
      const codes = JSON.parse(mfaConfig.recovery_codes);
      for (let i = 0; i < codes.length; i++) {
        if (codes[i] && await bcrypt.compare(recoveryCode, codes[i])) {
          codes[i] = null;
          updateRecoveryCodes(pending.user_id, codes);
          verified = true;
          logAction("ext:mfa_recovery_used", req, { targetUserId: pending.user_id, codeIndex: i });
          break;
        }
      }
    } catch {}
  } else if (code) {
    verified = totp.verifyTOTP(secret, code);
  }

  if (!verified) {
    const attempts = incrementPendingLoginAttempts(tempToken);
    const mfaFailure = recordMfaFailure(pending.user_id);
    if (attempts >= 3 || attempts < 0) {
      deletePendingLogin(tempToken);
      logAction("ext:mfa_locked", req, { targetUserId: pending.user_id });
      if (mfaFailure.cooldownSeconds > 0) {
        return res.status(429).json({
          error: `Too many invalid MFA attempts. Try again in ${mfaFailure.cooldownSeconds} seconds.`,
          restartLogin: true,
          retryAfter: mfaFailure.cooldownSeconds,
        });
      }
      return res.status(401).json({ error: "Too many failed attempts. Please log in again.", restartLogin: true });
    }
    if (mfaFailure.cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Invalid verification code. Please wait ${mfaFailure.cooldownSeconds} seconds before trying again.`,
        retryAfter: mfaFailure.cooldownSeconds,
      });
    }
    return res.status(401).json({ error: `Invalid verification code (${3 - attempts} attempt${3 - attempts !== 1 ? "s" : ""} remaining)` });
  }

  clearMfaLoginState(pending.user_id);
  deletePendingLogin(tempToken);

  const ttl = getSessionTTL(!!pending.keep_signed_in);
  const session = createAuthenticatedExtensionSession(pending.user_id, ttl, req);
  const user = getUserById(pending.user_id);

  if (rememberBrowser) {
    setTrustedDeviceCookie(res, pending.user_id, req);
  }

  logAction("ext:mfa_success", req, { targetUserId: pending.user_id });
  res.json({
    success: true,
    token: session.id,
    expiresAt: session.expiresAt,
    user: { id: user.id, username: user.username, avatarUpdatedAt: user.avatar_updated_at || null },
  });
});

router.get("/auth/me", (req, res) => {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.json({ authenticated: false });
  }

  const session = getExtensionSession(match[1].trim());
  if (!session || session.expires_at < Math.floor(Date.now() / 1000) || session.suspended) {
    if (session) deleteExtensionSessionById(match[1].trim());
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: {
      id: session.user_id,
      username: session.username,
      avatarUpdatedAt: session.avatar_updated_at || null,
    },
    expiresAt: session.expires_at,
  });
});

router.post("/auth/logout", requireExtensionUser, (req, res) => {
  deleteExtensionSessionById(req.extensionSessionId);
  logAction("ext:auth_logout", req, { extensionSessionId: req.extensionSessionId });
  res.json({ success: true });
});

router.get("/chat/keys/backup", readLimiter, requireExtensionUser, (req, res) => {
  const row = getUserKey(req.user.id);
  if (!row) {
    return res.status(404).json({ error: "Key not found" });
  }

  res.json({
    encryptedPrivateKey: row.encrypted_private_key,
    privateKeyIv: row.private_key_iv,
    privateKeySalt: row.private_key_salt,
  });
});

router.get("/vault/vaults", readLimiter, requireExtensionUser, (req, res) => {
  const vaults = getUserVaults(req.user.id);
  res.json({
    vaults: vaults.map((v) => {
      const permissions = v.owner_id === req.user.id
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
        })();

      return {
        id: v.id,
        nameEncrypted: toBase64(v.name_encrypted),
        nameIv: toBase64(v.name_iv),
        type: v.type,
        ownerId: v.owner_id,
        encryptedMasterKey: toBase64(v.encrypted_master_key),
        masterKeyIv: toBase64(v.master_key_iv),
        masterKeySalt: toBase64(v.master_key_salt),
        permissions,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      };
    }),
  });
});

router.get("/vault/vaults/:id/master-key", readLimiter, requireExtensionUser, (req, res) => {
  const access = userHasVaultAccess(req.params.id, req.user.id);
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

  const membership = access.membership || getVaultMemberShip(vault.id, req.user.id);
  if (membership?.encrypted_master_key) {
    return res.json({ encryptedMasterKey: membership.encrypted_master_key });
  }
  if (vault.owner_id === req.user.id) {
    return res.json({ encryptedMasterKey: null });
  }
  return res.status(403).json({ error: "Not a member" });
});

router.get("/vault/vaults/:id/entries", readLimiter, requireExtensionUser, (req, res) => {
  const access = userHasVaultAccess(req.params.id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  const entries = getVaultEntriesList(req.params.id);
  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      vaultId: e.vault_id,
      type: e.type,
      titleEncrypted: toBase64(e.title_encrypted),
      titleIv: toBase64(e.title_iv),
      dataEncrypted: toBase64(e.data_encrypted),
      dataIv: toBase64(e.data_iv),
      folderEncrypted: toBase64(e.folder_encrypted),
      folderIv: toBase64(e.folder_iv),
      favorite: !!e.favorite,
      version: e.version,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    })),
  });
});

router.post("/vault/vaults/:id/entries", createEntryLimiter, requireExtensionUser, (req, res) => {
  const { id } = req.params;
  const { type, titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite } = req.body || {};

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

  const entryId = generateId(16);
  try {
    createVaultEntry({
      id: entryId,
      vaultId: id,
      type,
      titleEncrypted,
      titleIv,
      dataEncrypted,
      dataIv,
      folderEncrypted: folderEncrypted || null,
      folderIv: folderIv || null,
      favorite: !!favorite,
    });
    createVaultAudit({ id: generateId(16), vaultId: id, entryId, userId: req.user.id, action: "create" });
    logAction("ext:vault_entry_create", req, { vaultId: id, entryId, type });
    res.status(201).json({ id: entryId });
  } catch (err) {
    logAction("ext:vault_entry_create_error", req, { vaultId: id, error: err.message });
    res.status(500).json({ error: "Failed to create entry" });
  }
});

router.put("/vault/entries/:id", createEntryLimiter, requireExtensionUser, (req, res) => {
  const { id } = req.params;
  const { titleEncrypted, titleIv, dataEncrypted, dataIv, folderEncrypted, folderIv, favorite } = req.body || {};

  const entry = getVaultEntry(id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });
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

  try {
    updateVaultEntry({
      id,
      titleEncrypted,
      titleIv,
      dataEncrypted,
      dataIv,
      folderEncrypted: folderEncrypted || null,
      folderIv: folderIv || null,
      favorite: !!favorite,
    });
    createVaultAudit({ id: generateId(16), vaultId: entry.vault_id, entryId: id, userId: req.user.id, action: "update" });
    logAction("ext:vault_entry_update", req, { vaultId: entry.vault_id, entryId: id });
    res.json({ success: true });
  } catch (err) {
    logAction("ext:vault_entry_update_error", req, { entryId: id, error: err.message });
    res.status(500).json({ error: "Failed to update entry" });
  }
});

router.get("/vault/shared", readLimiter, requireExtensionUser, (req, res) => {
  const shares = getSharesForUser(req.user.id);
  res.json({
    shares: shares.map((s) => ({
      id: s.id,
      entryId: s.entry_id,
      fromUserId: s.from_user_id,
      fromUsername: s.from_username,
      type: s.entry_type,
      encryptedEntryKey: s.encrypted_entry_key,
      titleEncrypted: toBase64(s.title_encrypted),
      titleIv: toBase64(s.title_iv),
      dataEncrypted: toBase64(s.data_encrypted),
      dataIv: toBase64(s.data_iv),
      createdAt: s.created_at,
      expiresAt: s.expires_at,
    })),
  });
});

router.get("/vault/entries/:id", readLimiter, requireExtensionUser, (req, res) => {
  const entry = getVaultEntry(req.params.id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const access = userHasVaultAccess(entry.vault_id, req.user.id);
  if (access.error === "not_found") return res.status(404).json({ error: "Vault not found" });
  if (access.error === "forbidden") return res.status(403).json({ error: "Access denied" });

  res.json({
    entry: {
      id: entry.id,
      vaultId: entry.vault_id,
      type: entry.type,
      titleEncrypted: toBase64(entry.title_encrypted),
      titleIv: toBase64(entry.title_iv),
      dataEncrypted: toBase64(entry.data_encrypted),
      dataIv: toBase64(entry.data_iv),
      folderEncrypted: toBase64(entry.folder_encrypted),
      folderIv: toBase64(entry.folder_iv),
      favorite: !!entry.favorite,
      version: entry.version,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    },
  });
});

router.post("/paste", createPasteLimiter, requireExtensionUser, (req, res) => {
  const { ciphertext, iv, ivPassword, salt, hasPassword, burnAfterReading, expiresIn, syntax } = req.body || {};

  if (!ciphertext || !iv) {
    return res.status(400).json({ error: "Missing required fields: ciphertext, iv" });
  }

  for (const [field, val] of Object.entries({ ciphertext, iv })) {
    if (typeof val !== "string") {
      return res.status(400).json({ error: `${field} must be a string` });
    }
  }

  const ivErr = validateBase64(iv, "iv", 12);
  if (ivErr) return res.status(400).json({ error: ivErr });

  const ctErr = validateBase64(ciphertext, "ciphertext");
  if (ctErr) return res.status(400).json({ error: ctErr });

  const ctDecoded = decodeBase64Strict(ciphertext);
  if (ctDecoded.length > MAX_PASTE_CIPHERTEXT_SIZE) {
    return res.status(413).json({ error: "Ciphertext too large (max 512KB)" });
  }

  if (hasPassword) {
    if (!ivPassword || !salt) {
      return res.status(400).json({ error: "Missing required fields for password-protected paste: ivPassword, salt" });
    }
    const ivpErr = validateBase64(ivPassword, "ivPassword", 12);
    if (ivpErr) return res.status(400).json({ error: ivpErr });
    const saltErr = validateBase64(salt, "salt", 16);
    if (saltErr) return res.status(400).json({ error: saltErr });
  }

  const expiresInNum = parseInt(expiresIn, 10);
  if (!VALID_EXPIRY_OPTIONS.includes(expiresInNum)) {
    return res.status(400).json({ error: "Invalid expiration value" });
  }

  const safeSyntax = VALID_SYNTAX_OPTIONS.includes(syntax) ? syntax : "plaintext";
  const id = crypto.randomBytes(16).toString("base64url");

  try {
    const paste = createPaste({
      id,
      ciphertext,
      iv,
      ivPassword: hasPassword ? ivPassword : null,
      salt: hasPassword ? salt : null,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn: expiresInNum,
      sourceIp: req.ip,
      syntax: safeSyntax,
      userId: req.user.id,
      guestInvitedBy: null,
    });

    logAction("ext:paste_create", req, { id, hasPassword: !!hasPassword, burnAfterReading: !!burnAfterReading, expiresIn: expiresInNum });
    res.status(201).json({ id: paste.id });
  } catch (err) {
    logAction("ext:paste_create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to create paste" });
  }
});

router.post("/share", createShareLimiter, requireExtensionUser, upload.array("files", 20), (req, res) => {
  const uploadedFiles = req.files || [];
  const metadataStr = req.body?.metadata;

  if (!uploadedFiles.length) {
    return res.status(400).json({ error: "No files uploaded" });
  }
  if (!metadataStr) {
    cleanupUploadedFiles(uploadedFiles);
    return res.status(400).json({ error: "Missing metadata" });
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    cleanupUploadedFiles(uploadedFiles);
    return res.status(400).json({ error: "Invalid metadata JSON" });
  }

  const { expiresIn, hasPassword, burnAfterReading, salt, files: fileMeta } = metadata;
  const expiresInNum = parseInt(expiresIn, 10);
  if (!VALID_EXPIRY_OPTIONS.includes(expiresInNum)) {
    cleanupUploadedFiles(uploadedFiles);
    return res.status(400).json({ error: "Invalid expiration value" });
  }

  if (!Array.isArray(fileMeta) || fileMeta.length !== uploadedFiles.length) {
    cleanupUploadedFiles(uploadedFiles);
    return res.status(400).json({ error: "File metadata count mismatch" });
  }

  if (hasPassword) {
    if (!salt) {
      cleanupUploadedFiles(uploadedFiles);
      return res.status(400).json({ error: "Missing salt for password-protected share" });
    }
    const saltErr = validateBase64(salt, "salt", 16);
    if (saltErr) {
      cleanupUploadedFiles(uploadedFiles);
      return res.status(400).json({ error: saltErr });
    }
  }

  for (let i = 0; i < fileMeta.length; i++) {
    const fm = fileMeta[i];
    const ivErr = validateBase64(fm.iv, `file[${i}].iv`, 12);
    if (ivErr) {
      cleanupUploadedFiles(uploadedFiles);
      return res.status(400).json({ error: ivErr });
    }
    const fnIvErr = validateBase64(fm.filenameIv, `file[${i}].filenameIv`, 12);
    if (fnIvErr) {
      cleanupUploadedFiles(uploadedFiles);
      return res.status(400).json({ error: fnIvErr });
    }
    try {
      const decoded = decodeBase64Strict(fm.encryptedFilename);
      if (decoded.length < 17 || decoded.length > 512) {
        cleanupUploadedFiles(uploadedFiles);
        return res.status(400).json({ error: `file[${i}].encryptedFilename decoded size must be 17-512 bytes (got ${decoded.length})` });
      }
    } catch {
      cleanupUploadedFiles(uploadedFiles);
      return res.status(400).json({ error: `file[${i}].encryptedFilename is not valid base64` });
    }

    fm.mimeType = typeof fm.mimeType === "string" && fm.mimeType.length <= MAX_MIME_LENGTH && MIME_REGEX.test(fm.mimeType)
      ? fm.mimeType
      : "application/octet-stream";

    if (hasPassword && fm.ivPassword) {
      const ivpErr = validateBase64(fm.ivPassword, `file[${i}].ivPassword`, 12);
      if (ivpErr) {
        cleanupUploadedFiles(uploadedFiles);
        return res.status(400).json({ error: ivpErr });
      }
    }
  }

  const shareId = crypto.randomBytes(16).toString("base64url");

  try {
    const fileRecords = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const uf = uploadedFiles[i];
      const fm = fileMeta[i];
      const fileId = crypto.randomBytes(16).toString("base64url");
      const finalPath = path.join(FILES_DIR, `${fileId}.enc`);

      fs.renameSync(uf.path, finalPath);

      fileRecords.push({
        id: fileId,
        encryptedFilename: fm.encryptedFilename,
        filenameIv: fm.filenameIv,
        fileSize: fm.fileSize || uf.size,
        encryptedSize: uf.size,
        iv: fm.iv,
        ivPassword: hasPassword ? fm.ivPassword : null,
        mimeType: fm.mimeType,
      });
    }

    createShare({
      id: shareId,
      salt: hasPassword ? salt : null,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn: expiresInNum,
      sourceIp: req.ip,
      files: fileRecords,
      userId: req.user.id,
      guestInvitedBy: null,
    });

    logAction("ext:share_create", req, {
      id: shareId,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn: expiresInNum,
      fileCount: fileRecords.length,
      totalSize: fileRecords.reduce((sum, file) => sum + file.fileSize, 0),
    });

    res.status(201).json({ id: shareId });
  } catch (err) {
    logAction("ext:share_create_error", req, { error: err.message });
    cleanupUploadedFiles(uploadedFiles);
    res.status(500).json({ error: "Failed to create share" });
  }
});

module.exports = router;
