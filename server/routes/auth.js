const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { requireUser, optionalUser } = require("../middleware/auth");
const {
  getUserByEmail, createUser, createSession, getSession, deleteSessionById,
  deleteOtherSessions, updateUserPassword, updateUsername,
  getInviteByToken, markInviteUsed,
  createGuestLink, validateGuestLink, redeemGuestLink,
  createPasswordReset, getPasswordResetByToken, markPasswordResetUsed, deleteSessionsByUserId,
  getUserByUsername, getSmtpConfig,
  VALID_GUEST_EXPIRY,
} = require("../database");
const { sendInviteEmail, sendPasswordResetEmail, sendShareLinkEmail } = require("../email");

const router = Router();

const BCRYPT_ROUNDS = 12;
const SESSION_TTL = 24 * 60 * 60; // 24 hours

// Rate limits
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
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

// --- Cookie options ---
const SESSION_COOKIE_OPTIONS = {
  signed: true,
  httpOnly: true,
  sameSite: "strict",
  maxAge: SESSION_TTL * 1000,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

// --- Routes ---

// POST /api/auth/login
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

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

  // Create session
  const sessionId = crypto.randomBytes(32).toString("base64url");
  createSession({
    id: sessionId,
    userId: user.id,
    expiresIn: SESSION_TTL,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });

  res.cookie("redsec_session", sessionId, SESSION_COOKIE_OPTIONS);

  logAction("auth:login", req, { userId: user.id, username: user.username });

  res.json({
    success: true,
    user: { username: user.username },
  });
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
    const sessionId = crypto.randomBytes(32).toString("base64url");
    createSession({
      id: sessionId,
      userId,
      expiresIn: SESSION_TTL,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.cookie("redsec_session", sessionId, SESSION_COOKIE_OPTIONS);

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

  const { getUserById } = require("../database");
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

  const { getUserById } = require("../database");
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

// POST /api/auth/reset-password
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

  logAction("auth:reset_password", req, { userId: reset.user_id });
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
