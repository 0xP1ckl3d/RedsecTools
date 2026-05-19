const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { requireUser, optionalUser } = require("../middleware/auth");
const {
  getUserByEmail, getUserById, createUser, createSession, getSession, deleteSessionById,
  deleteOtherSessions, updateUserPassword, updateUsername, updateUserProfile,
  getInviteByToken, markInviteUsed,
  createGuestLink, validateGuestLink, redeemGuestLink,
  createPasswordReset, getPasswordResetByToken, markPasswordResetUsed, deleteSessionsByUserId,
  deleteExtensionSessionsByUserId,
  getUserByUsername, getSmtpConfig,
  getUserMFA, setUserMFA, enableUserMFA, disableUserMFA, updateRecoveryCodes,
  createPendingLogin, getPendingLogin, deletePendingLogin, incrementPendingLoginAttempts,
  createTrustedDevice, getTrustedDeviceByTokenHash, deleteTrustedDevicesByUser, countTrustedDevicesByUser,
  getMfaLoginState, setMfaLoginState, clearMfaLoginState,
  getAuthLoginState, setAuthLoginState, clearAuthLoginState,
  getEmailSendState, setEmailSendState,
  deletePersonalVaultsByUser, deleteUserKeyBackup, flagVaultMembersForRekey,
  getSetting, setSetting, getRolePermissionsByUserId,
  encryptValue, decryptValue,
  createAuditEvent,
  VALID_GUEST_EXPIRY,
} = require("../database");
const { getAvailableTools } = require("../access");
const { sendInviteEmail, sendPasswordResetEmail, sendShareLinkEmail } = require("../email");
const totp = require("../totp");
const { buildAbsoluteUrl, isTrustedAbsoluteUrl } = require("../public-origin");
const { getCookieSecure } = require("../core/security/cookies");
const { logEvent, redactObject } = require("../core/logger");
const samlAuth = require("../core/auth/saml");

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
  logEvent(action, req, extra);
}

function auditAuth(req, {
  action,
  actorUser = null,
  targetType = "user",
  targetId = null,
  outcome = "success",
  metadata = {},
}) {
  try {
    createAuditEvent({
      actorUserId: actorUser?.id || req.user?.id || null,
      actorUsername: actorUser?.username || req.user?.username || null,
      actorType: actorUser || req.user ? "user" : "anonymous",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "auth",
      action,
      targetType,
      targetId: targetId || actorUser?.id || req.user?.id || null,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
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
    secure: getCookieSecure(),
  };
}

function createAuthenticatedSession(res, userId, ttl, reqContext) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  createSession({
    id: sessionId,
    userId,
    expiresIn: ttl,
    ipAddress: reqContext.ipAddress,
    userAgent: reqContext.userAgent,
  });
  res.cookie("redsec_session", sessionId, sessionCookieOptions(ttl));
}

function createPendingMfaLogin(userId, req, options = {}) {
  const tempToken = crypto.randomBytes(32).toString("base64url");
  createPendingLogin({
    id: tempToken,
    userId,
    expiresIn: 300,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
    keepSignedIn: !!options.keepSignedIn,
    rememberBrowser: !!options.rememberBrowser,
  });
  return tempToken;
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

function getMfaThrottleStatus(userId) {
  const state = getMfaLoginState(userId);
  if (!state) {
    return { failedAttempts: 0, blockedUntil: 0 };
  }

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
  const prior = current.failedAttempts;
  const existing = getMfaLoginState(userId);

  let failedAttempts = 1;
  let firstFailedAt = now;
  if (existing && existing.first_failed_at && (now - existing.first_failed_at) <= windowSeconds) {
    failedAttempts = prior + 1;
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

function clearMfaThrottle(userId) {
  clearMfaLoginState(userId);
}

function getLoginThrottleStatus(email) {
  const state = getAuthLoginState(email);
  if (!state) {
    return { failedAttempts: 0, blockedUntil: 0 };
  }

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

function clearLoginThrottle(email) {
  clearAuthLoginState(email);
}

function getConfiguredSamlSettings() {
  return samlAuth.getSamlSettings({ getSetting, decryptValue });
}

function safeLocalReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\u0000-\u001F\u007F]/.test(value)) return "/";
  return value.length <= 300 ? value : "/";
}

function redirectWithSsoError(res, message) {
  const url = new URL("/login", "http://redsectools.local");
  url.searchParams.set("ssoError", message || "SSO login failed");
  return res.redirect(`${url.pathname}${url.search}`);
}

function uniqueUsernameFromSaml(usernameValue, email) {
  const base = samlAuth.sanitizeUsername(usernameValue, email);
  let candidate = base;
  let suffix = 1;
  while (getUserByUsername(candidate)) {
    const ending = `_${suffix++}`;
    candidate = `${base.slice(0, Math.max(3, 30 - ending.length))}${ending}`;
  }
  return candidate;
}

async function resolveSamlUser(profile, settings) {
  const email = samlAuth.getProfileEmail(profile, settings);
  if (!email || validateEmail(email)) {
    return { error: "SAML response did not include a valid email address" };
  }

  const existing = getUserByEmail(email);
  if (existing) {
    if (existing.suspended) return { error: "Account suspended", status: 403 };
    const fullName = samlAuth.getProfileFullName(profile, settings);
    if (fullName) updateUserProfile({ id: existing.id, fullName });
    return { user: existing, provisioned: false };
  }

  if (!settings.autoProvision) {
    return { error: "No RedSecTools account is linked to this SSO identity", status: 403 };
  }

  const userId = crypto.randomBytes(16).toString("base64url");
  const username = uniqueUsernameFromSaml(samlAuth.getProfileUsername(profile, settings), email);
  const randomPassword = crypto.randomBytes(48).toString("base64url");
  const passwordHash = await bcrypt.hash(randomPassword, BCRYPT_ROUNDS);
  createUser({
    id: userId,
    email,
    username,
    passwordHash,
    roleId: settings.defaultRoleId || null,
  });
  const fullName = samlAuth.getProfileFullName(profile, settings);
  if (fullName) updateUserProfile({ id: userId, fullName });
  return { user: getUserById(userId), provisioned: true };
}

function checkEmailSendThrottle(email, { limit, windowSeconds, blockSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const state = getEmailSendState(email);

  if (state && state.blocked_until > now) {
    return { allowed: false, retryAfter: state.blocked_until - now };
  }

  let sentCount = 0;
  let windowStartedAt = now;
  if (state && state.window_started_at && (now - state.window_started_at) <= windowSeconds) {
    sentCount = state.sent_count || 0;
    windowStartedAt = state.window_started_at;
  }

  if (sentCount >= limit) {
    const blockedUntil = now + blockSeconds;
    setEmailSendState(email, { sentCount, windowStartedAt, blockedUntil });
    return { allowed: false, retryAfter: blockSeconds };
  }

  setEmailSendState(email, {
    sentCount: sentCount + 1,
    windowStartedAt,
    blockedUntil: 0,
  });
  return { allowed: true, retryAfter: 0 };
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
    secure: getCookieSecure(),
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

// GET /api/auth/sso/config
router.get("/auth/sso/config", (req, res) => {
  const settings = getConfiguredSamlSettings();
  res.json({
    enabled: samlAuth.isSamlEnabled(settings),
    provider: settings.provider,
    requireForLogin: settings.requireForLogin,
    loginPath: settings.loginPath,
  });
});

// GET /api/auth/sso/saml/metadata
router.get("/auth/sso/saml/metadata", (req, res) => {
  const settings = getConfiguredSamlSettings();
  try {
    const metadata = samlAuth.getServiceProviderMetadata(settings, req);
    res.setHeader("Content-Type", "application/samlmetadata+xml; charset=utf-8");
    res.send(metadata);
  } catch (error) {
    auditAuth(req, { action: "sso_metadata", outcome: "failure", metadata: { error: error.message } });
    res.status(400).json({ error: error.message || "SAML metadata is not available" });
  }
});

// GET /api/auth/sso/saml/login
router.get("/auth/sso/saml/login", loginLimiter, async (req, res) => {
  const settings = getConfiguredSamlSettings();
  try {
    const saml = samlAuth.createSamlClient(settings, req);
    const relayState = safeLocalReturnTo(req.query.returnTo);
    const redirectUrl = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
    auditAuth(req, { action: "sso_login_start", outcome: "pending", metadata: { provider: "saml" } });
    res.redirect(redirectUrl);
  } catch (error) {
    auditAuth(req, { action: "sso_login_start", outcome: "failure", metadata: { provider: "saml", error: error.message } });
    redirectWithSsoError(res, error.message || "SAML is not configured");
  }
});

// POST /api/auth/sso/saml/acs
router.post("/auth/sso/saml/acs", loginLimiter, async (req, res) => {
  const settings = getConfiguredSamlSettings();
  try {
    const saml = samlAuth.createSamlClient(settings, req);
    const { profile } = await saml.validatePostResponseAsync(req.body || {});
    if (!profile) {
      auditAuth(req, { action: "sso_login", outcome: "failure", metadata: { provider: "saml", reason: "missing_profile" } });
      return redirectWithSsoError(res, "SAML response did not include a user profile");
    }

    const resolved = await resolveSamlUser(profile, settings);
    if (resolved.error) {
      auditAuth(req, {
        action: "sso_login",
        outcome: "failure",
        metadata: { provider: "saml", reason: resolved.error },
      });
      return redirectWithSsoError(res, resolved.error);
    }

    const ttl = getSessionTTL(false);
    createAuthenticatedSession(res, resolved.user.id, ttl, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    clearLoginThrottle(resolved.user.email);
    auditAuth(req, {
      action: "sso_login",
      actorUser: resolved.user,
      outcome: "success",
      metadata: {
        provider: "saml",
        provisioned: !!resolved.provisioned,
        issuer: profile.issuer || null,
      },
    });
    res.redirect(safeLocalReturnTo(req.body?.RelayState));
  } catch (error) {
    auditAuth(req, {
      action: "sso_login",
      outcome: "failure",
      metadata: { provider: "saml", error: error.message },
    });
    redirectWithSsoError(res, "SAML login failed");
  }
});

// POST /api/auth/login (modified for MFA)
router.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password, keepSignedIn, rememberBrowser } = req.body || {};
  const normalizedEmail = typeof email === "string" ? email.toLowerCase().trim() : "";

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const ssoSettings = getConfiguredSamlSettings();
  if (samlAuth.isSamlEnabled(ssoSettings) && ssoSettings.requireForLogin) {
    return res.status(403).json({ error: "Single sign-on is required for this deployment" });
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
    logAction("auth:login_failed", req, { email, reason: "not_found" });
    auditAuth(req, { action: "login", outcome: "failure", metadata: { email: normalizedEmail, reason: "not_found" } });
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
    logAction("auth:login_failed", req, { email, reason: "suspended" });
    auditAuth(req, { action: "login", actorUser: user, outcome: "failure", metadata: { reason: "suspended" } });
    recordLoginFailure(normalizedEmail);
    return res.status(403).json({ error: "Account suspended" });
  }

  const match = await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!match) {
    logAction("auth:login_failed", req, { email, reason: "wrong_password" });
    auditAuth(req, { action: "login", actorUser: user, outcome: "failure", metadata: { reason: "wrong_password" } });
    const failure = recordLoginFailure(normalizedEmail);
    if (failure.cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${failure.cooldownSeconds} seconds.`,
        retryAfter: failure.cooldownSeconds,
      });
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }

  clearLoginThrottle(normalizedEmail);

  // Check MFA status
  const mfaConfig = getUserMFA(user.id);
  const mfaRequired = getSetting("mfa_required") === "true";
  const mfaEnabled = mfaConfig && mfaConfig.enabled;

  // CASE: MFA required by admin but user hasn't set it up yet
  if (mfaRequired && !mfaEnabled) {
    const tempToken = createPendingMfaLogin(user.id, req, {
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: false,
    });
    logAction("auth:mfa_setup_required", req, { userId: user.id });
    auditAuth(req, { action: "login", actorUser: user, outcome: "pending", metadata: { reason: "mfa_setup_required" } });
    return res.json({ mfaSetupRequired: true, tempToken });
  }

  // CASE: MFA enabled — check trusted device
  if (mfaEnabled) {
    if (checkTrustedDevice(req, user.id)) {
      // Trusted device — skip MFA
      const ttl = getSessionTTL(!!keepSignedIn);
      createAuthenticatedSession(res, user.id, ttl, {
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });
      logAction("auth:login_trusted", req, { userId: user.id, username: user.username });
      auditAuth(req, { action: "login", actorUser: user, outcome: "success", metadata: { mfa: "trusted_device" } });
      return res.json({ success: true, user: { username: user.username } });
    }

    // MFA required — create pending login
    const tempToken = createPendingMfaLogin(user.id, req, {
      keepSignedIn: !!keepSignedIn,
      rememberBrowser: !!rememberBrowser,
    });
    const throttle = getMfaThrottleStatus(user.id);

    logAction("auth:mfa_required", req, { userId: user.id });
    auditAuth(req, { action: "login", actorUser: user, outcome: "pending", metadata: { reason: "mfa_required" } });
    return res.json({
      mfaRequired: true,
      tempToken,
      hasRecoveryCodes: getRemainingRecoveryCodes(mfaConfig) > 0,
      cooldownSeconds: throttle.blockedUntil > Math.floor(Date.now() / 1000)
        ? throttle.blockedUntil - Math.floor(Date.now() / 1000)
        : 0,
    });
  }

  // CASE: No MFA — create session directly
  const ttl = getSessionTTL(!!keepSignedIn);
  createAuthenticatedSession(res, user.id, ttl, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });

  logAction("auth:login", req, { userId: user.id, username: user.username });
  auditAuth(req, { action: "login", actorUser: user, outcome: "success", metadata: { mfa: "not_required" } });

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

  const now = Math.floor(Date.now() / 1000);
  const throttle = getMfaThrottleStatus(pending.user_id);
  if (throttle.blockedUntil > now) {
    return res.status(429).json({
      error: `Too many invalid MFA attempts. Try again in ${throttle.blockedUntil - now} seconds.`,
      retryAfter: throttle.blockedUntil - now,
    });
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
    const mfaFailure = recordMfaFailure(pending.user_id);
    if (attempts >= 3 || attempts < 0) {
      deletePendingLogin(tempToken);
      logAction("auth:mfa_locked", req, { userId: pending.user_id });
      auditAuth(req, { action: "login_mfa", targetId: pending.user_id, outcome: "failure", metadata: { reason: "locked" } });
      if (mfaFailure.cooldownSeconds > 0) {
        return res.status(429).json({
          error: `Too many invalid MFA attempts. Try again in ${mfaFailure.cooldownSeconds} seconds.`,
          restartLogin: true,
          retryAfter: mfaFailure.cooldownSeconds,
        });
      }
      return res.status(401).json({ error: "Too many failed attempts. Please log in again.", restartLogin: true });
    }
    logAction("auth:mfa_failed", req, { userId: pending.user_id, attempts });
    auditAuth(req, { action: "login_mfa", targetId: pending.user_id, outcome: "failure", metadata: { attempts } });
    if (mfaFailure.cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Invalid verification code. Please wait ${mfaFailure.cooldownSeconds} seconds before trying again.`,
        retryAfter: mfaFailure.cooldownSeconds,
      });
    }
    return res.status(401).json({ error: `Invalid verification code (${3 - attempts} attempt${3 - attempts !== 1 ? "s" : ""} remaining)` });
  }

  // MFA verified — create session
  clearMfaThrottle(pending.user_id);
  deletePendingLogin(tempToken);

  const ttl = getSessionTTL(!!pending.keep_signed_in);
  createAuthenticatedSession(res, pending.user_id, ttl, {
    ipAddress: pending.ip_address,
    userAgent: pending.user_agent,
  });

  // Set trusted device cookie if requested (value from MFA form, not login form)
  if (rememberBrowser) {
    setTrustedDeviceCookie(res, pending.user_id, req);
  }

  const user = getUserById(pending.user_id);

  logAction("auth:mfa_success", req, { userId: pending.user_id });
  auditAuth(req, { action: "login_mfa", actorUser: user, outcome: "success", metadata: { rememberBrowser: !!rememberBrowser } });
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

  const now = Math.floor(Date.now() / 1000);
  const throttle = getMfaThrottleStatus(pending.user_id);
  if (throttle.blockedUntil > now) {
    return res.status(429).json({
      error: `Too many invalid MFA attempts. Try again in ${throttle.blockedUntil - now} seconds.`,
      retryAfter: throttle.blockedUntil - now,
    });
  }

  const secret = decryptValue(mfaConfig.totp_secret_encrypted);

  if (!totp.verifyTOTP(secret, code)) {
    const attempts = incrementPendingLoginAttempts(tempToken);
    const mfaFailure = recordMfaFailure(pending.user_id);
    if (attempts >= 3 || attempts < 0) {
      deletePendingLogin(tempToken);
      logAction("auth:mfa_setup_locked", req, { userId: pending.user_id });
      auditAuth(req, { action: "mfa_forced_setup", targetId: pending.user_id, outcome: "failure", metadata: { reason: "locked" } });
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

  // Enable MFA and create session
  clearMfaThrottle(pending.user_id);
  enableUserMFA(pending.user_id);
  deletePendingLogin(tempToken);

  const ttl = getSessionTTL(!!pending.keep_signed_in);
  createAuthenticatedSession(res, pending.user_id, ttl, {
    ipAddress: pending.ip_address,
    userAgent: pending.user_agent,
  });

  // Always trust browser during forced MFA setup (user just proved password + TOTP on this device)
  setTrustedDeviceCookie(res, pending.user_id, req);

  const user = getUserById(pending.user_id);

  logAction("auth:mfa_forced_enabled", req, { userId: pending.user_id });
  auditAuth(req, { action: "mfa_forced_setup", actorUser: user, outcome: "success" });
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
      roleId: invite.role_id || null,
    });

    markInviteUsed(invite.id);

    const mfaRequired = getSetting("mfa_required") === "true";
    if (mfaRequired) {
      const tempToken = createPendingMfaLogin(userId, req, {
        keepSignedIn: false,
        rememberBrowser: false,
      });
      logAction("auth:register_mfa_setup_required", req, { userId, username, email: invite.email });
      auditAuth(req, {
        action: "register",
        actorUser: { id: userId, username },
        outcome: "pending",
        metadata: { inviteId: invite.id, reason: "mfa_setup_required" },
      });
      return res.json({ success: true, mfaSetupRequired: true, tempToken });
    }

    // Auto-login: create session
    const ttl = getSessionTTL(false);
    createAuthenticatedSession(res, userId, ttl, {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    logAction("auth:register", req, { userId, username, email: invite.email });
    auditAuth(req, {
      action: "register",
      actorUser: { id: userId, username },
      outcome: "success",
      metadata: { inviteId: invite.id },
    });

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
      const permissions = getRolePermissionsByUserId(session.user_id);
      return res.json({
        authenticated: true,
        user: {
          id: session.user_id,
          username: session.username,
          email: session.email || null,
          fullName: session.full_name || "",
          avatarUpdatedAt: session.avatar_updated_at || null,
          roleId: session.role_id || null,
          roleKey: session.role_key || null,
          roleName: session.role_name || null,
        },
        role: {
          id: session.role_id || null,
          key: session.role_key || null,
          name: session.role_name || null,
        },
        permissions,
        availableTools: getAvailableTools(permissions),
      });
    }
    if (session) {
      deleteSessionById(sessionId);
    }
    res.clearCookie("redsec_session", { path: "/" });
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
  deleteExtensionSessionsByUserId(req.user.id);

  logAction("auth:change_password", req, { userId: req.user.id });
  auditAuth(req, { action: "change_password", outcome: "success" });
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
  auditAuth(req, { action: "update_username", outcome: "success", metadata: { username } });
  res.json({ success: true, username });
});

router.post("/auth/update-profile", usernameLimiter, requireUser, (req, res) => {
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim() : "";
  if (fullName && fullName.length > 120) return res.status(400).json({ error: "Full name must be 120 characters or less" });
  updateUserProfile({ id: req.user.id, fullName });
  logAction("auth:update_profile", req, { userId: req.user.id });
  auditAuth(req, { action: "update_profile", outcome: "success", metadata: { fullNameSet: !!fullName } });
  res.json({ success: true, fullName });
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
    if (session) {
      deleteSessionById(sessionId);
    }
    res.clearCookie("redsec_session", { path: "/" });
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

  const url = buildAbsoluteUrl(req, `/guest/${token}`);
  if (!url) {
    return res.status(503).json({ error: "Unable to determine a trusted public URL for guest links" });
  }

  logAction("auth:guest_link", req, { userId: req.user.id, tool, expiresAt });
  auditAuth(req, {
    action: "guest_link_create",
    targetType: "guest_link",
    targetId: id,
    outcome: "success",
    metadata: { tool, expiresAt },
  });

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

  if (!isTrustedAbsoluteUrl(url, req)) {
    return res.status(400).json({ error: "Invalid link URL" });
  }

  const safeToolName = typeof toolName === "string" && toolName.length <= 50 ? toolName : "RedSecTools";
  const emailThrottle = checkEmailSendThrottle(email.toLowerCase().trim(), {
    limit: 5,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 30,
  });
  if (!emailThrottle.allowed) {
    return res.status(429).json({
      error: `Too many emails sent to this recipient. Try again in ${emailThrottle.retryAfter} seconds.`,
      retryAfter: emailThrottle.retryAfter,
    });
  }

  try {
    const smtpInfo = await sendShareLinkEmail(email, url, safeToolName);
    logAction("auth:email_link", req, { userId: req.user.id, to: email });
    auditAuth(req, {
      action: "email_link_send",
      targetType: "email",
      targetId: email.toLowerCase().trim(),
      outcome: "success",
      metadata: { toolName: safeToolName },
    });
    res.json({ success: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    logAction("auth:email_link_error", req, { error: err.message });
    auditAuth(req, {
      action: "email_link_send",
      targetType: "email",
      targetId: email.toLowerCase().trim(),
      outcome: "failure",
      metadata: { error: err.message },
    });
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
  const normalizedEmail = email.toLowerCase().trim();
  const emailThrottle = checkEmailSendThrottle(normalizedEmail, {
    limit: 5,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 30,
  });
  if (!emailThrottle.allowed) {
    logAction("auth:forgot_password_throttled", req, { email: normalizedEmail, retryAfter: emailThrottle.retryAfter });
    return res.json({ success: true });
  }

  const user = getUserByEmail(normalizedEmail);
  if (!user || user.suspended) {
    // Don't reveal whether email exists
    return res.json({ success: true });
  }

  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomBytes(16).toString("base64url");
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    createPasswordReset({ id, userId: user.id, token, expiresAt });

    const resetUrl = buildAbsoluteUrl(req, `/reset-password?token=${encodeURIComponent(token)}`);
    if (!resetUrl) {
      return res.status(503).json({ error: "Trusted public origin is not configured for password reset links" });
    }

    // Try to send email, but don't fail if SMTP not configured
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch {
      logAction("auth:forgot_password_smtp_fail", req, { userId: user.id });
    }

    logAction("auth:forgot_password", req, { userId: user.id, email: user.email });
    auditAuth(req, { action: "password_reset_request", actorUser: user, outcome: "success" });
  } catch (err) {
    logAction("auth:forgot_password_error", req, { error: err.message });
    auditAuth(req, { action: "password_reset_request", outcome: "failure", metadata: { error: err.message } });
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
  deleteExtensionSessionsByUserId(reset.user_id);

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
  auditAuth(req, { action: "password_reset_complete", targetId: reset.user_id, outcome: "success" });
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
  clearMfaThrottle(req.user.id);

  logAction("auth:mfa_enabled", req, { userId: req.user.id });
  auditAuth(req, { action: "mfa_enable", outcome: "success" });
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
  clearMfaThrottle(req.user.id);

  logAction("auth:mfa_disabled", req, { userId: req.user.id });
  auditAuth(req, { action: "mfa_disable", outcome: "success" });
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
  auditAuth(req, { action: "mfa_recovery_codes_regenerate", outcome: "success" });
  res.json({ recoveryCodes });
});

// DELETE /api/auth/mfa/trusted-devices — revoke all trusted devices
router.delete("/auth/mfa/trusted-devices", requireUser, (req, res) => {
  deleteTrustedDevicesByUser(req.user.id);
  res.clearCookie(TRUST_COOKIE_NAME, { path: "/" });
  logAction("auth:mfa_revoke_devices", req, { userId: req.user.id });
  auditAuth(req, { action: "mfa_trusted_devices_revoke", outcome: "success" });
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
    secure: getCookieSecure(),
  });

  logAction("guest:visit", req, { tool: link.tool, invitedBy: link.created_by });
  auditAuth(req, {
    action: "guest_link_visit",
    targetType: "guest_link",
    targetId: link.id || null,
    outcome: "success",
    metadata: { tool: link.tool, invitedBy: link.created_by },
  });

  res.redirect(link.tool === "share" ? "/share" : "/paste");
};

module.exports = router;
