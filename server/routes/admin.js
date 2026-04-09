const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const {
  getPasteStats, listPastes, deletePaste, bulkDeletePastes,
  getFileStats, listFiles, deleteFile, bulkDeleteFiles,
  listUsers, getUserById, deleteUserById, suspendUserById, unsuspendUserById,
  updateUserDetails, getUserByEmail, getUserByUsername,
  createInvite, listInvites, markInviteUsed, revokeInvite,
  createPasswordReset,
  getSmtpConfig, setSmtpConfig,
  getSetting, setSetting,
  getUserMFA, disableUserMFA, deleteSessionsByUserId, deleteTrustedDevicesByUser,
} = require("../database");
const { sendInviteEmail, sendPasswordResetEmail, sendTestEmail } = require("../email");

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- Admin session store (in-memory, single-process) ---
const adminSessions = new Map(); // token → { createdAt, ip }

function isValidAdminSession(token) {
  if (!token) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

// Middleware: require admin session
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin not configured. Set ADMIN_PASSWORD in .env" });
  }

  const token = req.signedCookies.redsec_admin;
  if (!token || !isValidAdminSession(token)) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Admin login rate limiter
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- ID validation helper ---
function validateId(id, label = "ID") {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return `${label} is invalid`;
  }
  return null;
}

// --- Auth ---

// POST /admin/login
router.post("/login", adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin not configured" });
  }

  const { password } = req.body;
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }

  // Timing-safe comparison
  const a = Buffer.from(String(password), "utf8");
  const b = Buffer.from(String(ADMIN_PASSWORD), "utf8");
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // Constant-time dummy
    return res.status(401).json({ error: "Invalid password" });
  }
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid password" });
  }

  // Create session
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  adminSessions.set(sessionToken, { createdAt: Date.now(), ip: req.ip });

  res.cookie("redsec_admin", sessionToken, {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/admin",
    secure: process.env.NODE_ENV === "production",
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:login", ip: req.ip }));
  res.json({ success: true });
});

// POST /admin/logout
router.post("/logout", (req, res) => {
  const token = req.signedCookies.redsec_admin;
  if (token) adminSessions.delete(token);
  res.clearCookie("redsec_admin", { path: "/admin" });
  res.json({ success: true });
});

// ============================================================
// Paste stats/list/delete
// ============================================================

// GET /admin/api/paste-stats
router.get("/api/paste-stats", requireAdmin, (req, res) => {
  res.json(getPasteStats());
});

// GET /admin/api/file-stats
router.get("/api/file-stats", requireAdmin, (req, res) => {
  res.json(getFileStats());
});

// GET /admin/api/pastes?page=1&limit=50
router.get("/api/pastes", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json(listPastes(page, limit));
});

// GET /admin/api/files?page=1&limit=50
router.get("/api/files", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json(listFiles(page, limit));
});

// DELETE /admin/api/paste/:id
router.delete("/api/paste/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid paste ID" });
  }

  const deleted = deletePaste(id);
  if (!deleted) {
    return res.status(404).json({ error: "Paste not found" });
  }
  res.json({ success: true });
});

// DELETE /admin/api/file/:id
router.delete("/api/file/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid file ID" });
  }

  deleteFile(id);
  res.json({ success: true });
});

// POST /admin/api/pastes/bulk-delete
router.post("/api/pastes/bulk-delete", requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: "Maximum 500 IDs per request" });
  }

  for (const id of ids) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
      return res.status(400).json({ error: `Invalid paste ID: ${id}` });
    }
  }

  const deleted = bulkDeletePastes(ids);
  res.json({ success: true, deleted });
});

// POST /admin/api/files/bulk-delete
router.post("/api/files/bulk-delete", requireAdmin, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: "Maximum 500 IDs per request" });
  }

  for (const id of ids) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
      return res.status(400).json({ error: `Invalid file ID: ${id}` });
    }
  }

  const deleted = bulkDeleteFiles(ids);
  res.json({ success: true, deleted });
});

// ============================================================
// User management
// ============================================================

// GET /admin/api/users?page=1&limit=50
router.get("/api/users", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json(listUsers(page, limit));
});

// GET /admin/api/users/:id
router.get("/api/users/:id", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const mfaConfig = getUserMFA(user.id);
  res.json({
    id: user.id,
    email: user.email,
    username: user.username,
    suspended: !!user.suspended,
    mfaEnabled: !!(mfaConfig && mfaConfig.enabled),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  });
});

// PUT /admin/api/users/:id
router.put("/api/users/:id", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const { id } = req.params;
  const { email, username } = req.body || {};

  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // Validate uniqueness if changing email/username
  if (email && email !== user.email) {
    const existing = getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "Email already in use" });
  }
  if (username && username !== user.username) {
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: "Invalid username format" });
    }
    const existing = getUserByUsername(username);
    if (existing) return res.status(409).json({ error: "Username already in use" });
  }

  updateUserDetails({
    id,
    email: email || user.email,
    username: username || user.username,
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_user", ip: req.ip, userId: id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/suspend
router.post("/api/users/:id/suspend", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  suspendUserById(req.params.id);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:suspend_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/unsuspend
router.post("/api/users/:id/unsuspend", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  unsuspendUserById(req.params.id);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:unsuspend_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// DELETE /admin/api/users/:id
router.delete("/api/users/:id", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  deleteUserById(req.params.id);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:delete_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/reset-password
router.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomBytes(16).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  createPasswordReset({ id, userId: user.id, token, expiresAt });

  const resetUrl = `${req.protocol}://${req.get("host")}/reset-password?token=${token}`;

  try {
    const smtpInfo = await sendPasswordResetEmail(user.email, resetUrl);
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:reset_password_email", ip: req.ip, userId: user.id }));
    res.json({ success: true, emailSent: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:reset_password_fallback", ip: req.ip, userId: user.id, error: err.message }));
    res.json({ success: true, emailSent: false, resetUrl, error: "Failed to send email" });
  }
});

// ============================================================
// Invites
// ============================================================

// GET /admin/api/invites?page=1&limit=50
router.get("/api/invites", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json(listInvites(page, limit));
});

// POST /admin/api/invites
router.post("/api/invites", requireAdmin, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  // Check if user already exists with this email
  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "A user with this email already exists" });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

  createInvite({
    id,
    email: email.toLowerCase().trim(),
    token,
    createdBy: "admin",
    expiresAt,
  });

  const registrationUrl = `${req.protocol}://${req.get("host")}/register?token=${token}`;

  try {
    const smtpInfo = await sendInviteEmail(email, registrationUrl);
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:invite_sent", ip: req.ip, email }));
    res.json({ success: true, emailSent: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:invite_fallback", ip: req.ip, email, error: err.message }));
    res.json({ success: true, emailSent: false, registrationUrl, error: "Failed to send email" });
  }
});

// DELETE /admin/api/invites/:id — Revoke invite
router.delete("/api/invites/:id", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "Invite ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const deleted = revokeInvite(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Invite not found or already used" });
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:revoke_invite", ip: req.ip, inviteId: req.params.id }));
  res.json({ success: true });
});

// ============================================================
// Settings (SMTP)
// ============================================================

// GET /admin/api/settings/smtp
router.get("/api/settings/smtp", requireAdmin, (req, res) => {
  const config = getSmtpConfig();
  res.json({
    host: config.smtpHost || "",
    port: config.smtpPort || "587",
    user: config.smtpUser || "",
    pass: config.smtpPass ? "••••••••" : "", // Mask password
    from: config.smtpFrom || "",
    secure: config.smtpSecure === "true",
    configured: !!config.smtpHost,
  });
});

// POST /admin/api/settings/smtp
router.post("/api/settings/smtp", requireAdmin, (req, res) => {
  const { host, port, user, pass, from, secure } = req.body || {};

  // If password is the placeholder, keep the existing one
  const currentConfig = getSmtpConfig();
  const actualPass = (pass === "••••••••" || pass === "")
    ? (currentConfig.smtpPass || "")
    : pass;

  setSmtpConfig({
    host: typeof host === "string" ? host : "",
    port: typeof port === "string" ? port : "587",
    user: typeof user === "string" ? user : "",
    pass: actualPass,
    from: typeof from === "string" ? from : "",
    secure: !!secure,
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_smtp", ip: req.ip }));
  res.json({ success: true });
});

// POST /admin/api/settings/smtp/test
router.post("/api/settings/smtp/test", requireAdmin, async (req, res) => {
  const { to } = req.body || {};
  if (!to || typeof to !== "string") {
    return res.status(400).json({ error: "Recipient email is required" });
  }

  try {
    const smtpInfo = await sendTestEmail(to);
    res.json({ success: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:smtp_test_error", ip: req.ip, error: err.message }));
    res.status(400).json({ error: "SMTP test failed" });
  }
});

// ============================================================
// Chat management
// ============================================================

// GET /admin/api/chat-stats
router.get("/api/chat-stats", requireAdmin, (req, res) => {
  const { getChatStats } = require("../database");
  res.json(getChatStats());
});

// GET /admin/api/conversations?page=1&limit=50
router.get("/api/conversations", requireAdmin, (req, res) => {
  const { listConversationsAdmin } = require("../database");
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  res.json(listConversationsAdmin(page, limit));
});

// DELETE /admin/api/conversations/:id
router.delete("/api/conversations/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid conversation ID" });
  }
  const { deleteConversation } = require("../database");
  deleteConversation(id);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:delete_conversation", ip: req.ip, conversationId: id }));
  res.json({ success: true });
});

// ============================================================
// VAULTS
// ============================================================

router.get("/api/vault/stats", requireAdmin, (req, res) => {
  const { getVaultStats } = require("../database");
  const stats = getVaultStats();
  res.json(stats);
});

router.get("/api/vaults", requireAdmin, (req, res) => {
  const { listVaultsAdmin } = require("../database");
  const page = parseInt(req.query.page, 10) || 1;
  const result = listVaultsAdmin(page);
  res.json(result);
});

router.delete("/api/vaults/:id", requireAdmin, (req, res) => {
  const { deleteVault, getVault } = require("../database");
  const { id } = req.params;
  const vault = getVault(id);
  if (!vault) return res.status(404).json({ error: "Vault not found" });

  try {
    deleteVault(id);
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:vault_delete", ip: req.ip, vaultId: id }));
    res.json({ success: true });
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: "admin:vault_delete_error", ip: req.ip, error: err.message }));
    res.status(500).json({ error: "Failed to delete vault" });
  }
});

// ============================================================
// Security settings (MFA, session TTL)
// ============================================================

// GET /admin/api/settings/security
router.get("/api/settings/security", requireAdmin, (req, res) => {
  res.json({
    sessionTTL: parseInt(getSetting("session_ttl"), 10) || 43200,
    sessionTTLExtended: parseInt(getSetting("session_ttl_extended"), 10) || 604800,
    mfaRememberDays: parseInt(getSetting("mfa_remember_days"), 10) || 30,
    mfaRequired: getSetting("mfa_required") === "true",
  });
});

// POST /admin/api/settings/security
router.post("/api/settings/security", requireAdmin, (req, res) => {
  const { sessionTTL, sessionTTLExtended, mfaRememberDays, mfaRequired } = req.body || {};

  const VALID_SESSION_TTL = [1800, 3600, 7200, 14400, 43200, 86400];
  const VALID_EXTENDED_TTL = [86400, 172800, 604800, 1209600, 2592000];
  const VALID_MFA_DAYS = [7, 14, 30, 60, 90];

  if (sessionTTL !== undefined) {
    const ttl = parseInt(sessionTTL, 10);
    if (!VALID_SESSION_TTL.includes(ttl)) {
      return res.status(400).json({ error: "Invalid session TTL value" });
    }
    setSetting("session_ttl", String(ttl));
  }

  if (sessionTTLExtended !== undefined) {
    const ttl = parseInt(sessionTTLExtended, 10);
    if (!VALID_EXTENDED_TTL.includes(ttl)) {
      return res.status(400).json({ error: "Invalid extended session TTL value" });
    }
    setSetting("session_ttl_extended", String(ttl));
  }

  if (mfaRememberDays !== undefined) {
    const days = parseInt(mfaRememberDays, 10);
    if (!VALID_MFA_DAYS.includes(days)) {
      return res.status(400).json({ error: "Invalid MFA remember days value" });
    }
    setSetting("mfa_remember_days", String(days));
  }

  if (mfaRequired !== undefined) {
    setSetting("mfa_required", mfaRequired ? "true" : "false");
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_security", ip: req.ip }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/reset-mfa — admin resets user's MFA (account recovery)
router.post("/api/users/:id/reset-mfa", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const mfaConfig = getUserMFA(user.id);
  if (!mfaConfig) {
    return res.status(400).json({ error: "User does not have MFA configured" });
  }

  // Disable MFA and kill all sessions + trusted devices
  disableUserMFA(user.id);
  deleteSessionsByUserId(user.id);
  deleteTrustedDevicesByUser(user.id);

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:reset_mfa", ip: req.ip, userId: user.id }));
  res.json({ success: true });
});

module.exports = router;
