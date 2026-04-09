const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { requireUser, optionalUser } = require("../middleware/auth");
const {
  getUserByEmail, getUserById, createUser, createSession, getSession, deleteSessionById,
  deleteOtherSessions, updateUserPassword, updateUsername,
  getInviteByToken, markInviteUsed,
  createGuestLink, validateGuestLink, redeemGuestLink,
  createPasswordReset, getPasswordResetByToken, markPasswordResetUsed, deleteSessionsByUserId,
  getUserByUsername, getSmtpConfig,
  getUserMFA, setUserMFA, enableUserMFA, disableUserMFA, updateRecoveryCodes,
  createPendingLogin, getPendingLogin, deletePendingLogin, incrementPendingLoginAttempts,
  createTrustedDevice, getTrustedDeviceByTokenHash, deleteTrustedDevicesByUser, countTrustedDevicesByUser,
  deletePersonalVaultsByUser, deleteUserKeyBackup, flagVaultMembersForRekey,
  getSetting, setSetting,
  encryptValue, decryptValue,
  VALID_GUEST_EXPIRY,
} = require("../database");
const { sendInviteEmail, sendPasswordResetEmail, sendShareLinkEmail } = require("../email");
const totp = require("../totp");

const router = Router();

const BCRYPT_ROUNDS = 12;

// Dynamic session TTL from settings
function getSessionTTL(extended) {
  const ttl = parseInt(getSetting("session_ttl"), 10) || 43200;       // default 12h
  const extTtl = parseInt(getSetting("session_ttl_extended"), 10) || 604800; // default 7d
  const maxExt = 30 * 24 * 60 * 60; // hard cap 30 days
  return extended ? Math.min(extTtl, maxExt) : ttl;
}

// Rate limits
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

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const guestLinkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many guest links created. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const usernameLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many MFA attempts. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Logging ---
function logAction(action, req, extra = {}) {
  const ip = req.ip || req.connection?.remoteAddress;
  console.log(JSON.stringify({ ts: new Date().toISOString(), action, ip, ...extra }));
}

// --- Validation helpers ---
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password) {
  if (!password || typeof password !== "string") return "Password is required";
  if (password.length < 12) return "Password must be at least 12 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  return null;
}

function validateUsername(username) {
  if (!username || typeof username !== "string") return "Username is required";
  if (!USERNAME_REGEX.test(username)) return "Username must be 3-30 characters (letters, numbers, underscores)";
  return null;
}

function validateEmail(email) {
  if (!email || typeof email !== "string") return "Email is required";
  if (!EMAIL_REGEX.test(email)) return "Invalid email address";
  return null;
}

// --- Cookie helpers ---
function sessionCookieOptions(ttl) {
  return {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: ttl * 1000,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

// --- Trusted device cookie ---
const TRUST_COOKIE_NAME = "redsec_mfa_trust";

function setTrustedDeviceCookie(res, userId, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const days = parseInt(getSetting("mfa_remember_days"), 10) || 30;
  const expiresIn = days * 24 * 60 * 60;

  const id = crypto.randomBytes(16).toString("base64url");
  createTrustedDevice({
    id,
    userId,
    tokenHash,
    deviceName: (req.get("user-agent") || "").substring(0, 200),
    expiresIn,
  });

  const shortId = userId.substring(0, 8);
  res.cookie(TRUST_COOKIE_NAME, { u: shortId, t: token }, {
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

// --- Routes ---

// POST /api/auth/login (modified for MFA)
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password, keepSignedIn, rememberBrowser } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = getUserByEmail(email.toLowerCase().trim());
  if (!user) {
    logAction("auth:login_failed", req, { email, reason: "not_found" });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (user.suspended) {
    logAction("auth:login_failed", req, { email, reason: "suspended" });
    return res.status(403).json({ error: "Account suspended" });
  }

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) {
    logAction("auth:login_failed", req, { email, reason: "wrong_password" });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // Check MFA status
  const mfaConfig = getUserMFA(user.id);
  const mfaRequired = getSetting("mfa_required") === "true";
  const mfaEnabled = mfaConfig && mfaConfig.enabled;

  // CASE: MFA required by admin but user hasn't set it up yet
  if (mfaRequired && !mfaEnabled) {
    const tempToken = crypto.randomBytes(32).toString("base64url");
    createPendingLogin({
      id: tempToken,
      userId: user.id,
      expiresIn: 300, // 5 minutes
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: false,
    });
    logAction("auth:mfa_setup_required", req, { userId: user.id });
    return res.json({ mfaSetupRequired: true, tempToken });
  }

  // CASE: MFA enabled — check trusted device
  if (mfaEnabled) {
    if (checkTrustedDevice(req, user.id)) {
      // Trusted device — skip MFA
      const ttl = getSessionTTL(!!keepSignedIn);
      const sessionId = crypto.randomBytes(32).toString("base64url");
      createSession({
        id: sessionId,
        userId: user.id,
        expiresIn: ttl,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));
      logAction("auth:login_trusted", req, { userId: user.id, username: user.username });
      return res.json({ success: true, user: { username: user.username } });
    }

    // MFA required — create pending login
    const tempToken = crypto.randomBytes(32).toString("base64url");
    createPendingLogin({
      id: tempToken,
      userId: user.id,
      expiresIn: 300,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: !!rememberBrowser,
    });

    // Check if user has recovery codes
    let hasRecoveryCodes = false;
    try {
      const codes = JSON.parse(mfaConfig.recovery_codes);
      hasRecoveryCodes = codes.some((c) => c !== null);
    } catch {}

    logAction("auth:mfa_required", req, { userId: user.id });
    return res.json({ mfaRequired: true, tempToken, hasRecoveryCodes });
  }

  // CASE: No MFA — create session directly
  const ttl = getSessionTTL(!!keepSignedIn);
  const sessionId = crypto.randomBytes(32).toString("base64url");
  createSession({
    id: sessionId,
    userId: user.id,
    expiresIn: ttl,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));

  logAction("auth:login", req, { userId: user.id, username: user.username });

  res.json({
    success: true,
    user: { username: user.username },
  });
});

// POST /api/auth/login/mfa — verify TOTP code and create session
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

  // Decrypt TOTP secret
  const secret = decryptValue(mfaConfig.totp_secret_encrypted);

  let verified = false;

  if (recoveryCode) {
    // Verify recovery code
    try {
      const codes = JSON.parse(mfaConfig.recovery_codes);
      for (let i = 0; i < codes.length; i++) {
        if (codes[i] && await bcrypt.compare(recoveryCode, codes[i])) {
          // Mark code as used
          codes[i] = null;
          updateRecoveryCodes(pending.user_id, codes);
          verified = true;
          logAction("auth:mfa_recovery_used", req, { userId: pending.user_id, codeIndex: i });
          break;
        }
      }
    } catch {}
  } else if (code) {
    verified = totp.verifyTOTP(secret, code);
  }

  if (!verified) {
    const attempts = incrementPendingLoginAttempts(tempToken);
    if (attempts >= 3 || attempts < 0) {
      deletePendingLogin(tempToken);
      logAction("auth:mfa_locked", req, { userId: pending.user_id });
      return res.status(401).json({ error: "Too many failed attempts. Please log in again.", restartLogin: true });
    }
    logAction("auth:mfa_failed", req, { userId: pending.user_id, attempts });
    return res.status(401).json({ error: `Invalid verification code (${3 - attempts} attempt${3 - attempts !== 1 ? "s" : ""} remaining)` });
  }

  // MFA verified — create session
  deletePendingLogin(tempToken);

  const ttl = getSessionTTL(!!pending.keep_signed_in);
  const sessionId = crypto.randomBytes(32).toString("base64url");
  createSession({
    id: sessionId,
    userId: pending.user_id,
    expiresIn: ttl,
    ipAddress: pending.ip_address,
    userAgent: pending.user_agent,
  });
  res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));

  // Set trusted device cookie if requested (value from MFA form, not login form)
  if (rememberBrowser) {
    setTrustedDeviceCookie(res, pending.user_id, req);
  }

  const user = getUserById(pending.user_id);

  logAction("auth:mfa_success", req, { userId: pending.user_id });
  res.json({ success: true, user: { username: user.username } });
});

// POST /api/auth/login/mfa/setup — forced MFA setup during login
router.post("/auth/login/mfa/setup", mfaLimiter, async (req, res) => {
  const { tempToken } = req.body || {};

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

  const secret = totp.generateSecret();
  const recoveryCodes = totp.generateRecoveryCodes(10);
  const hashedCodes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));

  setUserMFA(pending.user_id, {
    totpSecretEncrypted: encryptValue(secret),
    recoveryCodes: JSON.stringify(hashedCodes),
  });

  const user = getUserById(pending.user_id);
  const provisioningURI = totp.buildProvisioningURI(secret, user.email);

  logAction("auth:mfa_forced_setup", req, { userId: pending.user_id });
  res.json({ provisioningURI, recoveryCodes, secret });
});

// POST /api/auth/login/mfa/setup/verify — verify and enable forced MFA setup
router.post("/auth/login/mfa/setup/verify", async (req, res) => {
  const { tempToken, code } = req.body || {};

  if (!tempToken || !code) {
    return res.status(400).json({ error: "Token and code are required" });
  }

  const pending = getPendingLogin(tempToken);
  if (!pending) {
    return res.status(401).json({ error: "Invalid or expired MFA session" });
  }
  if (pending.expires_at < Math.floor(Date.now() / 1000)) {
    deletePendingLogin(tempToken);
    return res.status(401).json({ error: "MFA session expired" });
  }

  const mfaConfig = getUserMFA(pending.user_id);
  if (!mfaConfig) {
    return res.status(400).json({ error: "MFA setup not initiated" });
  }

  const secret = decryptValue(mfaConfig.totp_secret_encrypted);

  if (!totp.verifyTOTP(secret, code)) {
    const attempts = incrementPendingLoginAttempts(tempToken);
    if (attempts >= 3 || attempts < 0) {
      deletePendingLogin(tempToken);
      logAction("auth:mfa_setup_locked", req, { userId: pending.user_id });
      return res.status(401).json({ error: "Too many failed attempts. Please log in again.", restartLogin: true });
    }
    return res.status(401).json({ error: `Invalid verification code (${3 - attempts} attempt${3 - attempts !== 1 ? "s" : ""} remaining)` });
  }

  // Enable MFA and create session
  enableUserMFA(pending.user_id);
  deletePendingLogin(tempToken);

  const ttl = getSessionTTL(!!pending.keep_signed_in);
  const sessionId = crypto.randomBytes(32).toString("base64url");
  createSession({
    id: sessionId,
    userId: pending.user_id,
    expiresIn: ttl,
    ipAddress: pending.ip_address,
    userAgent: pending.user_agent,
  });
  res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));

  // Always trust browser during forced MFA setup (user just proved password + TOTP on this device)
  setTrustedDeviceCookie(res, pending.user_id, req);

  const user = getUserById(pending.user_id);

  logAction("auth:mfa_forced_enabled", req, { userId: pending.user_id });
  res.json({ success: true, user: { username: user.username } });
});

// POST /api/auth/logout
router.post("/auth/logout", optionalUser, (req, res) => {
  const sessionId = req.signedCookies.redsec_session;
  if (sessionId) {
    deleteSessionById(sessionId);
  }
  res.clearCookie("redsec_session", { path: "/" });
  logAction("auth:logout", req);
  res.json({ success: true });
});

// POST /api/auth/register
router.post("/auth/register", registerLimiter, async (req, res) => {
  const { token, username, password } = req.body || {};

  // Validate invite token
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Registration token is required" });
  }

  const invite = getInviteByToken(token);
  if (!invite) {
    return res.status(400).json({ error: "Invalid or expired invitation" });
  }
  if (invite.used) {
    return res.status(400).json({ error: "This invitation has already been used" });
  }
  if (invite.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: "This invitation has expired" });
  }

  // Validate fields
  const usernameErr = validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });

  const passwordErr = validatePassword(password);
  if (passwordErr) return res.status(400).json({ error: passwordErr });

  // Check username uniqueness
  const existingUser = getUserByUsername(username);
  if (existingUser) {
    return res.status(409).json({ error: "Username is already taken" });
  }

  // Check email uniqueness (invite email)
  const existingEmail = getUserByEmail(invite.email);
  if (existingEmail) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = crypto.randomBytes(16).toString("base64url");

    createUser({
      id: userId,
      email: invite.email,
      username,
      passwordHash,
    });

    markInviteUsed(invite.id);

    // Auto-login: create session
    const ttl = getSessionTTL(false);
    const sessionId = crypto.randomBytes(32).toString("base64url");
    createSession({
      id: sessionId,
      userId,
      expiresIn: ttl,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));

    logAction("auth:register", req, { userId, username, email: invite.email });

    res.json({
      success: true,
      user: { username },
    });
  } catch (err) {
    logAction("auth:register_error", req, { error: err.message });
    res.status(500).json({ error: "Registration failed" });
  }
});

// GET /api/auth/me
router.get("/auth/me", (req, res) => {
  // Check user session
  const sessionId = req.signedCookies.redsec_session;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session && session.expires_at >= Math.floor(Date.now() / 1000) && !session.suspended) {
      return res.json({
        authenticated: true,
        user: {
          id: session.user_id,
          username: session.username,
          avatarUpdatedAt: session.avatar_updated_at || null,
        },
      });
    }
    if (session) {
      deleteSessionById(sessionId);
      res.clearCookie("redsec_session", { path: "/" });
    }
  }

  // Check guest cookie
  const guest = req.signedCookies.redsec_guest;
  if (guest && guest.guestToken && guest.tool) {
    if (guest.expires && guest.expires < Math.floor(Date.now() / 1000)) {
      res.clearCookie("redsec_guest", { path: "/" });
      return res.json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      guest: true,
      tool: guest.tool,
      invitedBy: guest.invitedBy,
    });
  }

  res.json({ authenticated: false });
});

// POST /api/auth/change-password
router.post("/auth/change-password", passwordLimiter, requireUser, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required" });
  }

  const passwordErr = validatePassword(newPassword);
  if (passwordErr) return res.status(400).json({ error: passwordErr });

  const user = getUserById(req.user.id);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  const match = await bcrypt.compare(currentPassword, user.password_hash).catch(() => false);
  if (!match) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  updateUserPassword(req.user.id, newHash);

  // Invalidate all other sessions (keep current)
  const currentSessionId = req.signedCookies.redsec_session;
  deleteOtherSessions(req.user.id, currentSessionId);

  logAction("auth:change_password", req, { userId: req.user.id });
  res.json({ success: true });
});

// POST /api/auth/verify-password — Verify current password (used for chat key setup)
router.post("/auth/verify-password", passwordLimiter, requireUser, async (req, res) => {
  const { password } = req.body || {};

  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password is required" });
  }

  const user = getUserById(req.user.id);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  res.json({ valid: true });
});

// POST /api/auth/update-username
router.post("/auth/update-username", usernameLimiter, requireUser, (req, res) => {
  const { username } = req.body || {};
  const err = validateUsername(username);
  if (err) return res.status(400).json({ error: err });

  const existing = getUserByUsername(username);
  if (existing && existing.id !== req.user.id) {
    return res.status(409).json({ error: "Username is already taken" });
  }

  updateUsername(req.user.id, username);
  logAction("auth:update_username", req, { userId: req.user.id, username });
  res.json({ success: true, username });
});

// GET /api/auth/smtp-status — check if SMTP is configured (for showing email buttons)
router.get("/auth/smtp-status", (req, res) => {
  // Allow both logged-in users and guests
  const sessionId = req.signedCookies.redsec_session;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session && session.expires_at >= Math.floor(Date.now() / 1000) && !session.suspended) {
      const config = getSmtpConfig();
      return res.json({ configured: !!config.smtpHost });
    }
  }

  const guest = req.signedCookies.redsec_guest;
  if (guest && guest.guestToken && guest.tool) {
    if (guest.expires && guest.expires >= Math.floor(Date.now() / 1000)) {
      const config = getSmtpConfig();
      return res.json({ configured: !!config.smtpHost });
    }
  }

  res.status(401).json({ error: "Authentication required" });
});

// POST /api/auth/guest-link
router.post("/auth/guest-link", guestLinkLimiter, requireUser, (req, res) => {
  const { tool, expiresIn } = req.body || {};

  if (!tool || (tool !== "paste" && tool !== "share")) {
    return res.status(400).json({ error: "Tool must be 'paste' or 'share'" });
  }

  const ttl = parseInt(expiresIn, 10);
  if (!VALID_GUEST_EXPIRY.includes(ttl)) {
    return res.status(400).json({ error: "Invalid expiry option" });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;

  createGuestLink({
    id,
    token,
    createdBy: req.user.username,
    tool,
    maxUses: 1,
    expiresAt,
  });

  const url = `${req.protocol}://${req.get("host")}/guest/${token}`;

  logAction("auth:guest_link", req, { userId: req.user.id, tool, expiresAt });

  res.json({ success: true, url, expiresAt });
});

// POST /api/auth/email-link
router.post("/auth/email-link", guestLinkLimiter, requireUser, async (req, res) => {
  const { email, url, toolName } = req.body || {};

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email address is required" });
  }

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  // Only allow links from our own host
  const host = req.get("host");
  if (!url.startsWith(`${req.protocol}://${host}/`)) {
    return res.status(400).json({ error: "Invalid link URL" });
  }

  const safeToolName = typeof toolName === "string" && toolName.length <= 50 ? toolName : "RedSecTools";

  try {
    const smtpInfo = await sendShareLinkEmail(email, url, safeToolName);
    logAction("auth:email_link", req, { userId: req.user.id, to: email });
    res.json({ success: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    logAction("auth:email_link_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /api/auth/forgot-password
router.post("/auth/forgot-password", passwordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    // Always return success to prevent email enumeration
    return res.json({ success: true });
  }

  const user = getUserByEmail(email.toLowerCase().trim());
  if (!user || user.suspended) {
    // Don't reveal whether email exists
    return res.json({ success: true });
  }

  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomBytes(16).toString("base64url");
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    createPasswordReset({ id, userId: user.id, token, expiresAt });

    const resetUrl = `${req.protocol}://${req.get("host")}/reset-password?token=${token}`;

    // Try to send email, but don't fail if SMTP not configured
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch {
      logAction("auth:forgot_password_smtp_fail", req, { userId: user.id });
    }

    logAction("auth:forgot_password", req, { userId: user.id, email: user.email });
  } catch (err) {
    logAction("auth:forgot_password_error", req, { error: err.message });
  }

  // Always return success
  res.json({ success: true });
});

// POST /api/auth/reset-password (modified for MFA + vault rules)
router.post("/auth/reset-password", passwordLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Reset token is required" });
  }

  const passwordErr = validatePassword(newPassword);
  if (passwordErr) return res.status(400).json({ error: passwordErr });

  const reset = getPasswordResetByToken(token);
  if (!reset) {
    return res.status(400).json({ error: "Invalid or expired reset token" });
  }
  if (reset.used) {
    return res.status(400).json({ error: "This reset token has already been used" });
  }
  if (reset.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(400).json({ error: "This reset token has expired" });
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  updateUserPassword(reset.user_id, newHash);
  markPasswordResetUsed(reset.id);
  deleteSessionsByUserId(reset.user_id);

  // NEW: Revoke trusted devices
  deleteTrustedDevicesByUser(reset.user_id);

  // NEW: Delete personal vaults (master keys encrypted with old password, unrecoverable)
  deletePersonalVaultsByUser(reset.user_id);

  // NEW: Delete RSA key backup (encrypted with old password, undecryptable)
  deleteUserKeyBackup(reset.user_id);

  // NEW: Flag team vault memberships for re-key
  flagVaultMembersForRekey(reset.user_id);

  // MFA stays active — TOTP secret is independent of password

  logAction("auth:reset_password", req, { userId: reset.user_id });
  res.json({ success: true });
});

// ============================================================
// MFA management endpoints (require logged-in user)
// ============================================================

// GET /api/auth/mfa/status
router.get("/auth/mfa/status", requireUser, (req, res) => {
  const mfaConfig = getUserMFA(req.user.id);
  const enabled = mfaConfig ? !!mfaConfig.enabled : false;

  let remainingCodes = 0;
  if (mfaConfig) {
    try {
      const codes = JSON.parse(mfaConfig.recovery_codes);
      remainingCodes = codes.filter((c) => c !== null).length;
    } catch {}
  }

  const trustedDeviceCount = countTrustedDevicesByUser(req.user.id);

  res.json({ enabled, remainingCodes, trustedDeviceCount });
});

// POST /api/auth/mfa/setup — generate TOTP secret, return QR URI + recovery codes
router.post("/auth/mfa/setup", passwordLimiter, requireUser, async (req, res) => {
  const { password } = req.body || {};

  // Verify password
  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) return res.status(401).json({ error: "Incorrect password" });

  const secret = totp.generateSecret();
  const recoveryCodes = totp.generateRecoveryCodes(10);
  const hashedCodes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));

  setUserMFA(req.user.id, {
    totpSecretEncrypted: encryptValue(secret),
    recoveryCodes: JSON.stringify(hashedCodes),
  });

  const provisioningURI = totp.buildProvisioningURI(secret, user.email);

  logAction("auth:mfa_setup", req, { userId: req.user.id });
  res.json({ provisioningURI, recoveryCodes, secret });
});

// POST /api/auth/mfa/verify-setup — verify first TOTP code to confirm and enable
router.post("/auth/mfa/verify-setup", mfaLimiter, requireUser, (req, res) => {
  const { code } = req.body || {};

  if (!code) return res.status(400).json({ error: "Verification code is required" });

  const mfaConfig = getUserMFA(req.user.id);
  if (!mfaConfig) return res.status(400).json({ error: "MFA setup not initiated" });
  if (mfaConfig.enabled) return res.status(400).json({ error: "MFA is already enabled" });

  const secret = decryptValue(mfaConfig.totp_secret_encrypted);

  if (!totp.verifyTOTP(secret, code)) {
    return res.status(401).json({ error: "Invalid verification code" });
  }

  enableUserMFA(req.user.id);

  logAction("auth:mfa_enabled", req, { userId: req.user.id });
  res.json({ success: true });
});

// POST /api/auth/mfa/disable
router.post("/auth/mfa/disable", passwordLimiter, requireUser, async (req, res) => {
  const { password } = req.body || {};

  if (!password) return res.status(400).json({ error: "Password is required" });

  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) return res.status(401).json({ error: "Incorrect password" });

  disableUserMFA(req.user.id);

  logAction("auth:mfa_disabled", req, { userId: req.user.id });
  res.json({ success: true });
});

// POST /api/auth/mfa/regenerate-codes
router.post("/auth/mfa/regenerate-codes", passwordLimiter, requireUser, async (req, res) => {
  const { password } = req.body || {};

  if (!password) return res.status(400).json({ error: "Password is required" });

  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) return res.status(401).json({ error: "Incorrect password" });

  const mfaConfig = getUserMFA(req.user.id);
  if (!mfaConfig || !mfaConfig.enabled) {
    return res.status(400).json({ error: "MFA is not enabled" });
  }

  const recoveryCodes = totp.generateRecoveryCodes(10);
  const hashedCodes = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
  updateRecoveryCodes(req.user.id, hashedCodes);

  logAction("auth:mfa_regenerate_codes", req, { userId: req.user.id });
  res.json({ recoveryCodes });
});

// DELETE /api/auth/mfa/trusted-devices — revoke all trusted devices
router.delete("/auth/mfa/trusted-devices", requireUser, (req, res) => {
  deleteTrustedDevicesByUser(req.user.id);
  res.clearCookie(TRUST_COOKIE_NAME, { path: "/" });
  logAction("auth:mfa_revoke_devices", req, { userId: req.user.id });
  res.json({ success: true });
});

// GET /guest/:token — validate guest link, set cookie, redirect (NOT consumed yet)
router.getGuestRedirect = function (req, res) {
  const { token } = req.params;

  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return res.redirect("/login");
  }

  const link = validateGuestLink(token);
  if (!link) {
    return res.redirect("/login");
  }

  // Set guest cookie — token is NOT redeemed yet, only validated
  const ttl = Math.max(0, link.expires_at - Math.floor(Date.now() / 1000));
  res.cookie("redsec_guest", {
    guestToken: token,
    tool: link.tool,
    invitedBy: link.created_by,
    expires: link.expires_at,
  }, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    maxAge: ttl * 1000,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  logAction("guest:visit", req, { tool: link.tool, invitedBy: link.created_by });

  res.redirect(link.tool === "share" ? "/share" : "/paste");
};

module.exports = router;
