const express = require("express");
const { Router } = express;
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const http = require("http");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { httpGetJSON } = require("../http-helper");
const { getActiveUserSession } = require("../middleware/auth");
const {
  getPasteStats, listPastes, deletePaste, bulkDeletePastes,
  getFileStats, listFiles, deleteFile, bulkDeleteFiles,
  listUsers, getUserById, deleteUserById, suspendUserById, unsuspendUserById,
  updateUserDetails, getUserByEmail, getUserByUsername,
  getRoleById,
  createInvite, listInvites, markInviteUsed, revokeInvite,
  createPasswordReset,
  getSmtpConfig, setSmtpConfig,
  getShareConfig,
  SHARE_MAX_FILE_SIZE_OPTIONS_MB,
  SHARE_MAX_FILE_COUNT_OPTIONS,
  getSetting, setSetting,
  getUserMFA, disableUserMFA, deleteSessionsByUserId, deleteExtensionSessionsByUserId, deleteTrustedDevicesByUser,
  createAdminSession, getAdminSession, deleteAdminSessionById,
  getEmailSendState, setEmailSendState,
  countAllUsers,
  getShortcutsByCategory, getShortcutByIdAny, deleteShortcutByIdAdmin,
  getShortcutsByUser, deleteShortcutById, deleteFavouritesByShortcut, AVATARS_DIR, BRAND_DIR,
  getVault, getVaultMembersList, updateVaultMemberPermission, removeVaultMember,
  listAllSurveys, getSurveyStats, deleteSurveyById,
  createAuditEvent, listAuditEvents, listSchemaMigrations, getDeploymentCounts,
  createServiceAccount, updateServiceAccount, getServiceAccountById, listServiceAccounts,
  createServiceAccountToken, revokeServiceAccountToken, revokeServiceAccountTokens,
  createPlatformWebhook, updatePlatformWebhook, getPlatformWebhookById, listPlatformWebhooks,
  deletePlatformWebhook, createPlatformWebhookDelivery, listPlatformWebhookDeliveries,
  getReporterGlobalStats, listReporterProjects, listReporterProjectMembers,
  encryptValue, decryptValue,
  db, DB_PATH,
} = require("../database");
const { sendInviteEmail, sendPasswordResetEmail, sendTestEmail } = require("../email");
const { buildAbsoluteUrl } = require("../public-origin");
const { createEncryptedDatabaseBackup } = require("../core/backup");
const { getCookieSecure } = require("../core/security/cookies");
const { buildBasePosture } = require("../core/security/posture");
const { logEvent, redactObject } = require("../core/logger");
const { parseInteger } = require("../core/validation");
const { getFeatureFlag, listFeatureFlags } = require("../core/config/feature-flags");
const { createPlainApiToken, hashApiToken, tokenDisplayPrefix } = require("../middleware/service-auth");
const { SERVICE_ACCOUNT_SCOPES, isValidServiceAccountScope } = require("../core/integrations/service-account-scopes");
const { PERMISSION_DEFINITIONS } = require("../access");
const { assertPublicHttpUrl } = require("../core/security/fetch-targets");
const { deliverPendingWebhooks, enqueueWebhookEvent } = require("../core/integrations/webhooks");
const samlAuth = require("../core/auth/saml");
const redsecAiProvider = require("../modules/redsecai/provider");

const router = Router();
const swaggerUiAssetPath = require("swagger-ui-dist").absolutePath();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SITE_PRIMARY_THEMES = new Set(["red", "green", "blue", "orange", "purple"]);
const ADMIN_REAUTH_WINDOW_SECONDS = 15 * 60;
const SSO_PROVIDERS = new Set(["none", "saml"]);
const WEBHOOK_EVENTS = Object.freeze([
  "*",
  "service_account.created",
  "service_account.updated",
  "service_account.token_created",
  "service_account.token_revoked",
  "webhook.created",
  "webhook.updated",
  "webhook.deleted",
  "webhook.test",
]);

function adminCookieOptions() {
  return {
    signed: true,
    httpOnly: true,
    sameSite: "strict",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/admin",
    secure: getCookieSecure(),
  };
}

function auditAdmin(req, { category = "admin", action, targetType = null, targetId = null, outcome = "success", metadata = {} }) {
  try {
    createAuditEvent({
      actorUserId: req.user?.id || null,
      actorUsername: req.user?.username || null,
      actorType: "admin",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category,
      action,
      targetType,
      targetId,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
}

function auditAdminLogin(req, linkedUserSession, { outcome, metadata = {}, targetId = null }) {
  try {
    createAuditEvent({
      actorUserId: linkedUserSession?.id || null,
      actorUsername: linkedUserSession?.username || null,
      actorType: "admin",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "auth",
      action: "admin_login",
      targetType: targetId ? "admin_session" : null,
      targetId,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action: "admin_login", error: error.message });
  }
}

function getDirectorySize(dirPath) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += getDirectorySize(fullPath);
      else if (entry.isFile()) total += fs.statSync(fullPath).size;
    }
  } catch {}
  return total;
}

function parseAuditTimestamp(value) {
  if (!value) return null;
  const numeric = parseInteger(value, { min: 0, fallback: null });
  if (numeric != null) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function clearAdminCookie(res) {
  res.clearCookie("redsec_admin", { path: "/admin" });
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

function getValidAdminSession(req) {
  const token = req.signedCookies.redsec_admin;
  if (!token) return null;

  const session = getAdminSession(token);
  if (!session) {
    return { error: "missing", sessionId: token };
  }

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    deleteAdminSessionById(token);
    return { error: "expired", sessionId: token };
  }

  return {
    sessionId: token,
    session,
  };
}

// Middleware: require admin session
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: "Admin not configured. Set ADMIN_PASSWORD in .env" });
  }

  const adminResult = getValidAdminSession(req);
  if (!adminResult) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (adminResult.error) {
    clearAdminCookie(res);
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (countAllUsers() > 0) {
    const userSession = getActiveUserSession(req);
    if (!userSession) {
      deleteAdminSessionById(adminResult.sessionId);
      clearAdminCookie(res);
      return res.status(403).json({ error: "Admin access requires an active user session. Please log in to your account first." });
    }
    const userSessionId = req.signedCookies.redsec_session;
    const adminSession = adminResult.session;
    if (
      !adminSession.linked_session_id ||
      adminSession.linked_session_id !== userSessionId ||
      adminSession.user_id !== userSession.id
    ) {
      deleteAdminSessionById(adminResult.sessionId);
      clearAdminCookie(res);
      return res.status(401).json({ error: "Admin session expired" });
    }
    req.user = userSession;
  }
  req.adminSession = adminResult.session;
  next();
}

function isAdminReauthRequired() {
  return getFeatureFlag("adminReauthRequired", { getSetting });
}

function requireRecentAdminAuth(req, res, next) {
  if (!isAdminReauthRequired()) return next();
  const createdAt = parseInt(req.adminSession?.created_at, 10) || 0;
  const ageSeconds = Math.floor(Date.now() / 1000) - createdAt;
  if (!createdAt || ageSeconds > ADMIN_REAUTH_WINDOW_SECONDS) {
    return res.status(403).json({
      error: "Recent admin authentication required",
      code: "recent_admin_required",
      maxAgeSeconds: ADMIN_REAUTH_WINDOW_SECONDS,
    });
  }
  return next();
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

function cleanOptionalText(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function getSsoAdminSettings() {
  const settings = samlAuth.getSamlSettings({ getSetting, decryptValue });
  const normalizedProvider = SSO_PROVIDERS.has(settings.provider) ? settings.provider : "none";
  return {
    ...settings,
    provider: normalizedProvider,
    privateKey: "",
    privateKeyConfigured: !!settings.privateKey,
  };
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
  if (membership?.can_manage_members) return "full";
  if (membership?.can_write) return "editor";
  return "viewer";
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

  // After first user exists, require an active user session for admin access
  const userCount = countAllUsers();
  let linkedUserSession = null;
  if (userCount > 0) {
    linkedUserSession = getActiveUserSession(req);
    if (!linkedUserSession) {
      auditAdminLogin(req, null, { outcome: "failure", metadata: { reason: "user_session_required" } });
      return res.status(403).json({ error: "Admin access requires an active user session. Please log in to your account first." });
    }
  }

  // Timing-safe comparison
  const a = Buffer.from(String(password), "utf8");
  const b = Buffer.from(String(ADMIN_PASSWORD), "utf8");
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // Constant-time dummy
    auditAdminLogin(req, linkedUserSession, { outcome: "failure", metadata: { reason: "invalid_password" } });
    return res.status(401).json({ error: "Invalid password" });
  }
  if (!crypto.timingSafeEqual(a, b)) {
    auditAdminLogin(req, linkedUserSession, { outcome: "failure", metadata: { reason: "invalid_password" } });
    return res.status(401).json({ error: "Invalid password" });
  }

  // Create session
  const sessionToken = crypto.randomBytes(32).toString("base64url");
  createAdminSession({
    id: sessionToken,
    userId: linkedUserSession ? linkedUserSession.id : null,
    linkedSessionId: linkedUserSession ? req.signedCookies.redsec_session : null,
    expiresIn: 24 * 60 * 60,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  res.cookie("redsec_admin", sessionToken, adminCookieOptions());

  logEvent("admin:login", req, { userId: linkedUserSession?.id || null });
  auditAdminLogin(req, linkedUserSession, { outcome: "success", targetId: sessionToken });
  res.json({ success: true });
});

// POST /admin/logout
router.post("/logout", (req, res) => {
  const token = req.signedCookies.redsec_admin;
  if (token) deleteAdminSessionById(token);
  clearAdminCookie(res);
  res.json({ success: true });
});

// GET /admin/api/auth-status
router.get("/api/auth-status", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ authenticated: false, error: "Admin not configured" });
  }

  const adminResult = getValidAdminSession(req);
  if (!adminResult || adminResult.error) {
    if (adminResult?.sessionId) {
      clearAdminCookie(res);
    }
    return res.json({ authenticated: false });
  }

  if (countAllUsers() > 0) {
    const userSession = getActiveUserSession(req);
    if (!userSession) {
      return res.json({ authenticated: false });
    }
    const userSessionId = req.signedCookies.redsec_session;
    const adminSession = adminResult.session;
    if (
      !adminSession.linked_session_id ||
      adminSession.linked_session_id !== userSessionId ||
      adminSession.user_id !== userSession.id
    ) {
      deleteAdminSessionById(adminResult.sessionId);
      clearAdminCookie(res);
      return res.json({ authenticated: false });
    }
  }

  return res.json({ authenticated: true });
});

// GET /admin/api/security-posture
router.get("/api/security-posture", requireAdmin, (req, res) => {
  const base = buildBasePosture();
  const dbStat = (() => {
    try { return fs.statSync(DB_PATH); } catch { return null; }
  })();
  const dbReady = (() => {
    try {
      db.prepare("SELECT 1 AS ok").get();
      return true;
    } catch {
      return false;
    }
  })();
  const migrations = listSchemaMigrations();
  const sso = getSsoAdminSettings();
  const flags = listFeatureFlags({ getSetting });
  res.json({
    ...base,
    database: {
      path: path.relative(path.join(__dirname, "..", ".."), DB_PATH),
      sizeBytes: dbStat?.size || 0,
      migrations,
      latestMigration: migrations.slice(-1)[0]?.id || null,
    },
    readiness: {
      status: dbReady ? "ready" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      checks: {
        database: dbReady ? "ok" : "failed",
      },
    },
    controls: {
      adminReauthRequired: isAdminReauthRequired(),
      adminReauthWindowSeconds: ADMIN_REAUTH_WINDOW_SECONDS,
      ssoEnabled: sso.enabled,
      ssoProvider: sso.provider,
      openApiEnabled: flags.openApiEnabled,
      serviceAccountsEnabled: flags.serviceAccountsEnabled,
      webhooksEnabled: flags.webhooksEnabled,
    },
    counts: getDeploymentCounts(),
    storage: {
      dataBytes: getDirectorySize(path.join(__dirname, "..", "..", "data")),
    },
  });
});

// GET /admin/api/audit-events
router.get("/api/audit-events", requireAdmin, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  res.json(listAuditEvents({
    limit,
    offset,
    actorUserId: typeof req.query.actorUserId === "string" && req.query.actorUserId ? req.query.actorUserId : null,
    category: typeof req.query.category === "string" && req.query.category ? req.query.category : null,
    action: typeof req.query.action === "string" && req.query.action ? req.query.action : null,
    outcome: typeof req.query.outcome === "string" && req.query.outcome ? req.query.outcome : null,
    targetType: typeof req.query.targetType === "string" && req.query.targetType ? req.query.targetType : null,
    targetId: typeof req.query.targetId === "string" && req.query.targetId ? req.query.targetId : null,
    fromTs: parseAuditTimestamp(req.query.from),
    toTs: parseAuditTimestamp(req.query.to),
  }));
});

// GET /admin/api/audit-events.csv
router.get("/api/audit-events.csv", requireAdmin, (req, res) => {
  const data = listAuditEvents({ limit: 500, offset: 0 });
  const headers = ["createdAt", "actorUsername", "actorUserId", "category", "action", "targetType", "targetId", "outcome", "metadata"];
  const rows = data.events.map((event) => headers.map((field) => {
    const value = field === "metadata" ? JSON.stringify(event.metadata) : event[field];
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"redsectools-audit-events.csv\"");
  res.send([headers.join(","), ...rows].join("\n"));
});

function requireOpenApiPublished(req, res, next) {
  if (!getFeatureFlag("openApiEnabled", { getSetting })) {
    if (req.path.endsWith(".json") || req.path.endsWith(".js")) {
      return res.status(404).json({ error: "OpenAPI publishing is disabled" });
    }
    return res.status(404).send("OpenAPI publishing is disabled");
  }
  return next();
}

router.get("/openapi", requireAdmin, requireOpenApiPublished, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RedSecTools API Docs</title>
  <link rel="stylesheet" href="/admin/openapi/assets/swagger-ui.css">
  <link rel="stylesheet" href="/admin/openapi/controls.css">
</head>
<body>
  <section class="redsec-swagger-auth-panel" aria-label="Swagger request authentication controls">
    <div class="redsec-swagger-auth-copy">
      <h1>RedSecTools API Docs</h1>
      <p>Requests are sent through an admin-only test proxy so Swagger can test current browser cookies, no cookies, or Swagger Authorize-only requests without changing the browser session.</p>
    </div>
    <label class="redsec-swagger-auth-field" for="swagger-cookie-mode">
      <span>Cookie mode</span>
      <select id="swagger-cookie-mode">
        <option value="current">Use my current browser cookies</option>
        <option value="none">Send no cookies</option>
        <option value="authorize">Override cookies with Swagger Authorize</option>
      </select>
    </label>
  </section>
  <div id="swagger-ui"></div>
  <script src="/admin/openapi/assets/swagger-ui-bundle.js"></script>
  <script src="/admin/openapi/assets/swagger-ui-standalone-preset.js"></script>
  <script src="/admin/openapi/init.js"></script>
</body>
</html>`);
});

router.get("/openapi/controls.css", requireAdmin, requireOpenApiPublished, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("text/css").send(`
.redsec-swagger-auth-panel {
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  max-width: 1460px;
  margin: 16px auto 0;
  padding: 14px 20px;
  border: 1px solid #d8dde7;
  border-radius: 4px;
  background: #ffffff;
  color: #3b4151;
  font-family: sans-serif;
}
.redsec-swagger-auth-panel * {
  box-sizing: border-box;
}
.redsec-swagger-auth-copy {
  min-width: 0;
}
.redsec-swagger-auth-copy h1 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.25;
}
.redsec-swagger-auth-copy p {
  max-width: 900px;
  margin: 0;
  color: #59636e;
  font-size: 13px;
  line-height: 1.45;
}
.redsec-swagger-auth-field {
  display: grid;
  flex: 0 0 min(460px, 100%);
  gap: 6px;
  color: #3b4151;
  font-size: 12px;
  font-weight: 700;
}
.redsec-swagger-auth-field select {
  width: 100%;
  min-height: 36px;
  padding: 0 32px 0 10px;
  border: 1px solid #d8dde7;
  border-radius: 4px;
  background: #ffffff;
  color: #3b4151;
  font: 400 13px/1.4 sans-serif;
}
.redsec-swagger-auth-field select:focus {
  outline: 2px solid #61affe;
  outline-offset: 1px;
}
html.dark-mode .redsec-swagger-auth-panel {
  border-color: #30363d;
  background: #161b22;
  color: #f0f6fc;
}
html.dark-mode .redsec-swagger-auth-copy p {
  color: #8b949e;
}
html.dark-mode .redsec-swagger-auth-field,
html.dark-mode .redsec-swagger-auth-field select {
  color: #f0f6fc;
}
html.dark-mode .redsec-swagger-auth-field select {
  border-color: #30363d;
  background: #0d1117;
}
@media (max-width: 760px) {
  .redsec-swagger-auth-panel {
    align-items: stretch;
    flex-direction: column;
    margin: 8px;
  }
  .redsec-swagger-auth-field {
    flex-basis: auto;
  }
}`);
});

router.get("/openapi/init.js", requireAdmin, requireOpenApiPublished, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(`(() => {
  const target = document.getElementById("swagger-ui");
  if (!target || typeof window.SwaggerUIBundle !== "function") return;
  const cookieModeInput = document.getElementById("swagger-cookie-mode");

  function isApiRequest(url) {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin
      && (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/admin/api/"));
  }

  function bodyEnvelope(body) {
    if (body === undefined || body === null) return { kind: "none", value: null };
    if (typeof body === "string") return { kind: "text", value: body };
    return { kind: "json", value: body };
  }

  window.ui = window.SwaggerUIBundle({
    url: "/admin/api/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    persistAuthorization: false,
    requestInterceptor: (request) => {
      if (!isApiRequest(request.url)) {
        request.credentials = "same-origin";
        return request;
      }
      const originalMethod = request.method || "GET";
      const originalUrl = new URL(request.url, window.location.origin);
      const originalHeaders = request.headers || {};
      request.url = "/admin/openapi/proxy";
      request.method = "POST";
      request.credentials = "same-origin";
      request.headers = { "content-type": "application/json" };
      request.body = JSON.stringify({
        method: originalMethod,
        target: originalUrl.pathname + originalUrl.search,
        headers: originalHeaders,
        body: bodyEnvelope(request.body),
        cookieMode: cookieModeInput?.value || "current"
      });
      return request;
    },
    presets: [
      window.SwaggerUIBundle.presets.apis,
      window.SwaggerUIStandalonePreset
    ],
    layout: "StandaloneLayout"
  });
})();`);
});

const OPENAPI_PROXY_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const OPENAPI_PROXY_STRIPPED_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function cleanProxyHeaders(rawHeaders, { allowCookieHeader = false } = {}) {
  const headers = {};
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) return headers;
  for (const [name, value] of Object.entries(rawHeaders)) {
    const lower = String(name || "").toLowerCase();
    if (!lower || lower.startsWith("x-redsec-swagger")) continue;
    if (OPENAPI_PROXY_STRIPPED_HEADERS.has(lower) && !(allowCookieHeader && lower === "cookie")) continue;
    if (Array.isArray(value)) {
      headers[lower] = value.map((item) => String(item)).join(", ");
    } else if (value !== undefined && value !== null) {
      headers[lower] = String(value);
    }
  }
  return headers;
}

function getProxyBody(envelope) {
  if (!envelope || envelope.kind === "none") return null;
  if (envelope.kind === "json") return Buffer.from(JSON.stringify(envelope.value ?? null));
  return Buffer.from(String(envelope.value ?? ""));
}

function cleanProxyTarget(target) {
  const value = String(target || "");
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const parsed = new URL(value, "http://redsectools.local");
  if (!parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/admin/api/")) return null;
  return parsed.pathname + parsed.search;
}

function filterCurrentCookiesForProxy(cookieHeader, targetPath) {
  const value = String(cookieHeader || "");
  if (!value || targetPath.startsWith("/admin/")) return value;
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith("redsec_admin="))
    .join("; ");
}

router.post("/openapi/proxy", requireAdmin, requireOpenApiPublished, (req, res) => {
  const method = String(req.body?.method || "GET").toUpperCase();
  const targetPath = cleanProxyTarget(req.body?.target);
  const cookieMode = ["current", "none", "authorize"].includes(req.body?.cookieMode) ? req.body.cookieMode : "current";
  if (!OPENAPI_PROXY_METHODS.has(method)) return res.status(400).json({ error: "Unsupported proxy method" });
  if (!targetPath) return res.status(400).json({ error: "Unsupported proxy target" });

  const headers = cleanProxyHeaders(req.body?.headers, { allowCookieHeader: cookieMode === "authorize" });
  const body = getProxyBody(req.body?.body);
  if (body) headers["content-length"] = String(body.length);
  if (body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (cookieMode === "none") {
    delete headers.authorization;
    delete headers.cookie;
  }
  if (cookieMode === "current") {
    const currentCookie = filterCurrentCookiesForProxy(req.get("cookie"), targetPath);
    if (currentCookie) headers.cookie = currentCookie;
  }

  auditAdmin(req, {
    category: "api",
    action: "openapi_proxy_request",
    targetType: "route",
    targetId: targetPath.split("?")[0],
    metadata: {
      method,
      cookieMode,
      hasQuery: targetPath.includes("?"),
      hasAuthorization: !!headers.authorization,
    },
  });

  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: req.socket.localPort,
    method,
    path: targetPath,
    headers,
  }, (proxyRes) => {
    const chunks = [];
    proxyRes.on("data", (chunk) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const responseHeaders = {};
      for (const [name, value] of Object.entries(proxyRes.headers || {})) {
        const lower = String(name).toLowerCase();
        if (OPENAPI_PROXY_STRIPPED_HEADERS.has(lower)) continue;
        responseHeaders[name] = value;
      }
      res.status(proxyRes.statusCode || 502).set(responseHeaders).send(Buffer.concat(chunks));
    });
  });
  proxyReq.on("error", () => res.status(502).json({ error: "OpenAPI proxy request failed" }));
  if (body) proxyReq.write(body);
  proxyReq.end();
});

router.use(
  "/openapi/assets",
  requireAdmin,
  requireOpenApiPublished,
  express.static(swaggerUiAssetPath, {
    index: false,
    immutable: true,
    maxAge: "1d",
  }),
);

router.get("/api/openapi.json", requireAdmin, requireOpenApiPublished, (req, res) => {
  const specPath = path.join(__dirname, "..", "..", "docs", "api", "openapi.json");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(specPath);
});

function normalizeScopes(rawScopes) {
  const requested = Array.isArray(rawScopes) ? rawScopes : [];
  return [...new Set(requested.map((scope) => String(scope || "").trim()).filter(Boolean))];
}

function validateScopes(scopes) {
  return scopes.every(isValidServiceAccountScope);
}

const SERVICE_ACCOUNT_SCOPE_DEFINITION_OVERRIDES = Object.freeze([
  {
    key: "*",
    category: "Global",
    label: "All Service Account Scopes",
    description: "Allow this service account to satisfy every current and future service-account scope.",
  },
  {
    key: "audit.read",
    category: "Operational API",
    label: "Audit Read",
    description: "Read audit events and export audit datasets through API routes.",
  },
  {
    key: "deployment.read",
    category: "Operational API",
    label: "Deployment Read",
    description: "Read deployment quality and migration status through API routes.",
  },
  {
    key: "webhooks.manage",
    category: "Integrations",
    label: "Manage Webhooks",
    description: "Manage platform webhook endpoints, tests, secrets, and delivery history.",
  },
  {
    key: "threat.read",
    category: "Legacy Compatibility",
    label: "Threat Read",
    description: "Compatibility alias for threat.view used by earlier API clients.",
  },
]);

function listServiceAccountScopeDefinitions() {
  const definitionsByKey = new Map();
  for (const definition of SERVICE_ACCOUNT_SCOPE_DEFINITION_OVERRIDES) {
    definitionsByKey.set(definition.key, definition);
  }
  for (const definition of PERMISSION_DEFINITIONS) {
    if (SERVICE_ACCOUNT_SCOPES.includes(definition.key) && !definitionsByKey.has(definition.key)) {
      definitionsByKey.set(definition.key, definition);
    }
  }
  return ["*", ...SERVICE_ACCOUNT_SCOPES].map((scope) => definitionsByKey.get(scope) || {
    key: scope,
    category: "Other",
    label: scope,
    description: "",
  });
}

function serviceAccountsAvailable(res) {
  if (getFeatureFlag("serviceAccountsEnabled", { getSetting })) return true;
  res.status(404).json({ error: "Service accounts are disabled" });
  return false;
}

router.get("/api/service-accounts/scopes", requireAdmin, (req, res) => {
  res.json({
    scopes: ["*", ...SERVICE_ACCOUNT_SCOPES],
    scopeDefinitions: listServiceAccountScopeDefinitions(),
  });
});

router.get("/api/service-accounts", requireAdmin, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  res.json({ serviceAccounts: listServiceAccounts() });
});

router.post("/api/service-accounts", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  const name = cleanOptionalText(req.body?.name, 120);
  const description = cleanOptionalText(req.body?.description, 500);
  const scopes = normalizeScopes(req.body?.scopes);
  const enabled = req.body?.enabled !== false;
  if (!name) return res.status(400).json({ error: "Service account name is required" });
  if (!scopes.length) return res.status(400).json({ error: "At least one scope is required" });
  if (!validateScopes(scopes)) return res.status(400).json({ error: "Invalid service account scope" });

  const account = createServiceAccount({
    name,
    description,
    scopes,
    enabled,
    createdBy: req.user?.id || null,
  });
  auditAdmin(req, {
    category: "api",
    action: "service_account_created",
    targetType: "service_account",
    targetId: account.id,
    metadata: { name, scopes, enabled },
  });
  enqueueWebhookEvent(require("../database"), "service_account.created", { id: account.id, name, scopes, enabled });
  res.status(201).json({ serviceAccount: account });
});

router.put("/api/service-accounts/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  const existing = getServiceAccountById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Service account not found" });
  const name = cleanOptionalText(req.body?.name, 120);
  const description = cleanOptionalText(req.body?.description, 500);
  const scopes = normalizeScopes(req.body?.scopes);
  const enabled = req.body?.enabled !== false;
  if (!name) return res.status(400).json({ error: "Service account name is required" });
  if (!scopes.length) return res.status(400).json({ error: "At least one scope is required" });
  if (!validateScopes(scopes)) return res.status(400).json({ error: "Invalid service account scope" });

  const account = updateServiceAccount({ id: req.params.id, name, description, scopes, enabled });
  auditAdmin(req, {
    category: "api",
    action: "service_account_updated",
    targetType: "service_account",
    targetId: account.id,
    metadata: { name, scopes, enabled },
  });
  enqueueWebhookEvent(require("../database"), "service_account.updated", { id: account.id, name, scopes, enabled });
  res.json({ serviceAccount: account });
});

router.post("/api/service-accounts/:id/tokens", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  const account = getServiceAccountById(req.params.id);
  if (!account) return res.status(404).json({ error: "Service account not found" });
  const label = cleanOptionalText(req.body?.label, 120) || "API token";
  const expiresAt = req.body?.expiresAt ? parseInteger(req.body.expiresAt, { min: Math.floor(Date.now() / 1000) + 60, fallback: null }) : null;
  if (req.body?.expiresAt && !expiresAt) return res.status(400).json({ error: "Token expiry must be a future Unix timestamp" });
  const token = createPlainApiToken();
  const tokenId = createServiceAccountToken({
    serviceAccountId: account.id,
    tokenHash: hashApiToken(token),
    label,
    prefix: tokenDisplayPrefix(token),
    expiresAt,
    createdBy: req.user?.id || null,
  });
  auditAdmin(req, {
    category: "api",
    action: "service_account_token_created",
    targetType: "service_account",
    targetId: account.id,
    metadata: { tokenId, label, expiresAt, prefix: tokenDisplayPrefix(token) },
  });
  enqueueWebhookEvent(require("../database"), "service_account.token_created", { serviceAccountId: account.id, tokenId, label, expiresAt });
  res.status(201).json({ token, tokenRecord: { id: tokenId, label, prefix: tokenDisplayPrefix(token), expiresAt } });
});

router.post("/api/service-accounts/:id/revoke-tokens", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  const account = getServiceAccountById(req.params.id);
  if (!account) return res.status(404).json({ error: "Service account not found" });
  const revoked = revokeServiceAccountTokens(account.id);
  auditAdmin(req, {
    category: "api",
    action: "service_account_tokens_revoked",
    targetType: "service_account",
    targetId: account.id,
    metadata: { revoked },
  });
  enqueueWebhookEvent(require("../database"), "service_account.token_revoked", { serviceAccountId: account.id, revoked });
  res.json({ success: true, revoked });
});

router.post("/api/service-accounts/tokens/:tokenId/revoke", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!serviceAccountsAvailable(res)) return;
  const revoked = revokeServiceAccountToken(req.params.tokenId);
  if (!revoked) return res.status(404).json({ error: "Active token not found" });
  auditAdmin(req, {
    category: "api",
    action: "service_account_token_revoked",
    targetType: "service_account_token",
    targetId: req.params.tokenId,
  });
  enqueueWebhookEvent(require("../database"), "service_account.token_revoked", { tokenId: req.params.tokenId });
  res.json({ success: true });
});

function webhooksAvailable(res) {
  if (getFeatureFlag("webhooksEnabled", { getSetting })) return true;
  res.status(404).json({ error: "Platform webhooks are disabled" });
  return false;
}

function normalizeWebhookEvents(rawEvents) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  return [...new Set(events.map((event) => String(event || "").trim()).filter(Boolean))];
}

router.get("/api/webhooks/events", requireAdmin, (req, res) => {
  res.json({ events: WEBHOOK_EVENTS });
});

router.get("/api/webhooks", requireAdmin, (req, res) => {
  if (!webhooksAvailable(res)) return;
  res.json({ webhooks: listPlatformWebhooks() });
});

router.post("/api/webhooks", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  if (!webhooksAvailable(res)) return;
  const name = cleanOptionalText(req.body?.name, 120);
  const url = cleanOptionalText(req.body?.url, 1000);
  const secret = cleanOptionalText(req.body?.secret, 500);
  const events = normalizeWebhookEvents(req.body?.events);
  const enabled = req.body?.enabled !== false;
  if (!name) return res.status(400).json({ error: "Webhook name is required" });
  if (!url) return res.status(400).json({ error: "Webhook URL is required" });
  if (!secret || secret.length < 16) return res.status(400).json({ error: "Webhook secret must be at least 16 characters" });
  if (!events.length || events.some((event) => !WEBHOOK_EVENTS.includes(event))) {
    return res.status(400).json({ error: "Invalid webhook event subscription" });
  }
  try {
    await assertPublicHttpUrl(url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const webhook = createPlatformWebhook({
    name,
    url,
    secretEncrypted: encryptValue(secret),
    events,
    enabled,
    createdBy: req.user?.id || null,
  });
  auditAdmin(req, {
    category: "api",
    action: "webhook_created",
    targetType: "webhook",
    targetId: webhook.id,
    metadata: { name, url, events, enabled },
  });
  enqueueWebhookEvent(require("../database"), "webhook.created", { id: webhook.id, name, events, enabled });
  delete webhook.secretEncrypted;
  res.status(201).json({ webhook });
});

router.put("/api/webhooks/:id", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  if (!webhooksAvailable(res)) return;
  const existing = getPlatformWebhookById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Webhook not found" });
  const name = cleanOptionalText(req.body?.name, 120);
  const url = cleanOptionalText(req.body?.url, 1000);
  const secret = cleanOptionalText(req.body?.secret, 500);
  const events = normalizeWebhookEvents(req.body?.events);
  const enabled = req.body?.enabled !== false;
  if (!name) return res.status(400).json({ error: "Webhook name is required" });
  if (!url) return res.status(400).json({ error: "Webhook URL is required" });
  if (secret && secret.length < 16) return res.status(400).json({ error: "Webhook secret must be at least 16 characters" });
  if (!events.length || events.some((event) => !WEBHOOK_EVENTS.includes(event))) {
    return res.status(400).json({ error: "Invalid webhook event subscription" });
  }
  try {
    await assertPublicHttpUrl(url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const webhook = updatePlatformWebhook({
    id: req.params.id,
    name,
    url,
    secretEncrypted: secret ? encryptValue(secret) : existing.secretEncrypted,
    events,
    enabled,
  });
  auditAdmin(req, {
    category: "api",
    action: "webhook_updated",
    targetType: "webhook",
    targetId: webhook.id,
    metadata: { name, url, events, enabled, secretRotated: !!secret },
  });
  enqueueWebhookEvent(require("../database"), "webhook.updated", { id: webhook.id, name, events, enabled });
  delete webhook.secretEncrypted;
  res.json({ webhook });
});

router.delete("/api/webhooks/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  if (!webhooksAvailable(res)) return;
  const existing = getPlatformWebhookById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Webhook not found" });
  deletePlatformWebhook(req.params.id);
  auditAdmin(req, {
    category: "api",
    action: "webhook_deleted",
    targetType: "webhook",
    targetId: req.params.id,
    metadata: { name: existing.name },
  });
  enqueueWebhookEvent(require("../database"), "webhook.deleted", { id: req.params.id, name: existing.name });
  res.json({ success: true });
});

router.get("/api/webhooks/:id/deliveries", requireAdmin, (req, res) => {
  if (!webhooksAvailable(res)) return;
  if (!getPlatformWebhookById(req.params.id)) return res.status(404).json({ error: "Webhook not found" });
  res.json({ deliveries: listPlatformWebhookDeliveries(req.params.id, 50) });
});

router.post("/api/webhooks/:id/test", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  if (!webhooksAvailable(res)) return;
  const webhook = getPlatformWebhookById(req.params.id);
  if (!webhook) return res.status(404).json({ error: "Webhook not found" });
  const deliveryId = createPlatformWebhookDelivery({
    webhookId: webhook.id,
    eventType: "webhook.test",
    payload: {
      id: crypto.randomBytes(16).toString("base64url"),
      type: "webhook.test",
      createdAt: new Date().toISOString(),
      data: { source: "admin", webhookId: webhook.id },
    },
  });
  await deliverPendingWebhooks(require("../database"), { limit: 10 });
  auditAdmin(req, {
    category: "api",
    action: "webhook_test_sent",
    targetType: "webhook",
    targetId: webhook.id,
    metadata: { deliveryId },
  });
  res.status(202).json({ deliveryId, deliveries: listPlatformWebhookDeliveries(webhook.id, 10) });
});

// POST /admin/api/backup/export
router.post("/api/backup/export", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const passphrase = req.body?.passphrase;
  try {
    const backup = await createEncryptedDatabaseBackup({ db, dbPath: DB_PATH, passphrase });
    auditAdmin(req, {
      category: "deployment",
      action: "backup_export",
      targetType: "database",
      outcome: "success",
      metadata: { bytes: backup.length },
    });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="redsectools-backup-${new Date().toISOString().slice(0, 10)}.rsecbackup"`);
    res.send(backup);
  } catch (error) {
    auditAdmin(req, {
      category: "deployment",
      action: "backup_export",
      targetType: "database",
      outcome: "failure",
      metadata: { error: error.message },
    });
    res.status(400).json({ error: error.message || "Backup export failed" });
  }
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

// GET /admin/api/reporter-stats
router.get("/api/reporter-stats", requireAdmin, (req, res) => {
  try {
    const stats = getReporterGlobalStats();
    const recentProjects = listReporterProjects(null, true).slice(0, 20).map((project) => ({
      ...project,
      members: listReporterProjectMembers(project.id),
    }));
    res.json({ stats, recentProjects });
  } catch (error) {
    res.status(500).json({ error: "Failed to load reporter stats" });
  }
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

// GET /admin/api/settings/share
router.get("/api/settings/share", requireAdmin, (req, res) => {
  const config = getShareConfig();
  res.json({
    maxFileSizeMb: config.maxFileSizeMb,
    maxFilesPerShare: config.maxFilesPerShare,
    allowedFileSizesMb: SHARE_MAX_FILE_SIZE_OPTIONS_MB,
    allowedFileCounts: SHARE_MAX_FILE_COUNT_OPTIONS,
  });
});

// POST /admin/api/settings/share
router.post("/api/settings/share", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const maxFileSizeMb = parseInt(req.body?.maxFileSizeMb, 10);
  const maxFilesPerShare = parseInt(req.body?.maxFilesPerShare, 10);

  if (!SHARE_MAX_FILE_SIZE_OPTIONS_MB.includes(maxFileSizeMb)) {
    return res.status(400).json({ error: `Max file size must be one of: ${SHARE_MAX_FILE_SIZE_OPTIONS_MB.join(", ")} MB` });
  }
  if (!SHARE_MAX_FILE_COUNT_OPTIONS.includes(maxFilesPerShare)) {
    return res.status(400).json({ error: `Max files per share must be one of: ${SHARE_MAX_FILE_COUNT_OPTIONS.join(", ")}` });
  }

  setSetting("share_max_file_size_mb", String(maxFileSizeMb));
  setSetting("share_max_files_per_share", String(maxFilesPerShare));
  auditAdmin(req, {
    category: "settings",
    action: "share_limits_update",
    targetType: "share_settings",
    metadata: { maxFileSizeMb, maxFilesPerShare },
  });

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action: "admin:update_share_settings",
    ip: req.ip,
    maxFileSizeMb,
    maxFilesPerShare,
  }));

  res.json({
    success: true,
    maxFileSizeMb,
    maxFilesPerShare,
    allowedFileSizesMb: SHARE_MAX_FILE_SIZE_OPTIONS_MB,
    allowedFileCounts: SHARE_MAX_FILE_COUNT_OPTIONS,
  });
});

// GET /admin/api/settings/redsecai
router.get("/api/settings/redsecai", requireAdmin, async (req, res) => {
  const config = redsecAiProvider.getConfig();
  const health = await redsecAiProvider.checkModelHealth();
  const { getRedSecAiActionStats } = require("../modules/redsecai/actions");
  const actionStats = getRedSecAiActionStats();
  res.json({
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    cloudModel: config.cloudModel,
    processingMode: config.processingMode,
    endpointRisk: config.endpointRisk,
    endpointWarnings: config.endpointWarnings,
    timeoutMs: config.timeoutMs,
    actionTtlSeconds: actionStats.actionTtlSeconds,
    autostart: config.autostart,
    autoPull: config.autoPull,
    ready: health.ok,
    installing: !!health.installing,
    error: health.error || null,
    availableModels: health.availableModels || [],
    actionStats,
  });
});

// POST /admin/api/settings/redsecai/diagnostics
router.post("/api/settings/redsecai/diagnostics", requireAdmin, async (req, res) => {
  const timeoutMs = Math.min(120000, Math.max(5000, parseInt(req.body?.timeoutMs, 10) || 60000));
  const diagnostics = await redsecAiProvider.runDiagnostics(timeoutMs);
  res.json(diagnostics);
});

// POST /admin/api/settings/redsecai
router.post("/api/settings/redsecai", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const enabled = req.body?.enabled !== false;
  const baseUrl = String(req.body?.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(req.body?.model || "").trim();
  const timeoutMs = parseInt(req.body?.timeoutMs, 10);
  const actionTtlSeconds = req.body?.actionTtlSeconds === undefined
    ? (parseInt(getSetting("redsecai_action_ttl_seconds"), 10) || 7200)
    : parseInt(req.body?.actionTtlSeconds, 10);
  const autostart = req.body?.autostart === true;
  const autoPull = req.body?.autoPull !== false;
  const endpoint = redsecAiProvider.classifyEndpoint(baseUrl, model);

  if (!/^https?:\/\/[A-Za-z0-9._:-]+$/i.test(baseUrl)) {
    return res.status(400).json({ error: "RedSecAI base URL must be an http(s) origin without a path" });
  }
  if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    return res.status(400).json({ error: "RedSecAI model name is invalid" });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 600000) {
    return res.status(400).json({ error: "RedSecAI timeout must be between 5000 and 600000 ms" });
  }
  if (!Number.isInteger(actionTtlSeconds) || actionTtlSeconds < 300 || actionTtlSeconds > 86400) {
    return res.status(400).json({ error: "RedSecAI action expiry must be between 300 and 86400 seconds" });
  }

  setSetting("redsecai_enabled", enabled ? "true" : "false");
  setSetting("redsecai_base_url", baseUrl);
  setSetting("redsecai_model", model);
  setSetting("redsecai_timeout_ms", String(timeoutMs));
  setSetting("redsecai_action_ttl_seconds", String(actionTtlSeconds));
  setSetting("redsecai_autostart", autostart ? "true" : "false");
  setSetting("redsecai_auto_pull", autoPull ? "true" : "false");

  auditAdmin(req, {
    category: "settings",
    action: "redsecai_update",
    targetType: "redsecai_settings",
    metadata: {
      enabled,
      baseUrl,
      model,
      timeoutMs,
      actionTtlSeconds,
      autostart,
      autoPull,
      processingMode: endpoint.processingMode,
      endpointRisk: endpoint.endpointRisk,
    },
  });

  res.json({ success: true });
});

// GET /admin/api/settings/securitytrails
router.get("/api/settings/securitytrails", requireAdmin, (req, res) => {
  const apiKey = getSetting("securitytrails_api_key") || "";
  const dailyLimit = parseInt(getSetting("securitytrails_daily_limit"), 10) || 50;
  res.json({
    apiKeyConfigured: apiKey.length > 0,
    apiKeyPreview: apiKey.length > 0 ? apiKey.slice(0, 4) + "..." + apiKey.slice(-4) : "",
    dailyLimit,
  });
});

// POST /admin/api/settings/securitytrails
router.post("/api/settings/securitytrails", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const apiKey = String(req.body?.apiKey || "").trim();
  const dailyLimit = parseInt(req.body?.dailyLimit, 10);

  if (apiKey && (apiKey.length < 8 || apiKey.length > 256)) {
    return res.status(400).json({ error: "API key must be between 8 and 256 characters" });
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) {
    return res.status(400).json({ error: "Daily limit must be between 1 and 10000" });
  }

  setSetting("securitytrails_api_key", apiKey);
  setSetting("securitytrails_daily_limit", String(dailyLimit));

  auditAdmin(req, {
    category: "settings",
    action: "securitytrails_update",
    targetType: "securitytrails_settings",
    metadata: { apiKeyConfigured: apiKey.length > 0, dailyLimit },
  });

  res.json({ success: true });
});

function getLeakRadarStoredApiKey() {
  const encrypted = getSetting("leakradar_api_key_encrypted") || "";
  const legacy = getSetting("leakradar_api_key") || "";
  return (decryptValue(encrypted || legacy) || "").trim();
}

// GET /admin/api/settings/leakradar
router.get("/api/settings/leakradar", requireAdmin, (req, res) => {
  const apiKey = getLeakRadarStoredApiKey();
  res.json({
    apiKeyConfigured: apiKey.length > 0,
    apiKeyPreview: apiKey.length > 0 ? apiKey.slice(0, 4) + "..." + apiKey.slice(-4) : "",
  });
});

// POST /admin/api/settings/leakradar
router.post("/api/settings/leakradar", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const apiKey = String(req.body?.apiKey || "").trim();
  const clearApiKey = !!req.body?.clearApiKey;

  if (apiKey && (apiKey.length < 8 || apiKey.length > 512)) {
    return res.status(400).json({ error: "API key must be between 8 and 512 characters" });
  }

  if (clearApiKey) {
    setSetting("leakradar_api_key_encrypted", "");
    setSetting("leakradar_api_key", "");
  } else if (apiKey) {
    setSetting("leakradar_api_key_encrypted", encryptValue(apiKey));
    setSetting("leakradar_api_key", "");
  }

  const configured = clearApiKey ? false : (apiKey.length > 0 || getLeakRadarStoredApiKey().length > 0);
  auditAdmin(req, {
    category: "settings",
    action: "leakradar_update",
    targetType: "leakradar_settings",
    metadata: { apiKeyConfigured: configured },
  });

  res.json({ success: true, apiKeyConfigured: configured });
});

// GET /admin/api/settings/minitools
router.get("/api/settings/minitools", requireAdmin, (req, res) => {
  const parseEnabled = (key) => {
    const val = getSetting(key);
    if (val === "false") return false;
    return true;
  };
  res.json({
    cvss: parseEnabled("minitool_cvss_enabled"),
    breach: parseEnabled("minitool_breach_enabled"),
    azure: parseEnabled("minitool_azure_enabled"),
    securitytrails: parseEnabled("minitool_securitytrails_enabled"),
    securityHeaders: parseEnabled("minitool_security_headers_enabled"),
    tlsCheck: parseEnabled("minitool_tls_check_enabled"),
    dnsLookup: parseEnabled("minitool_dns_lookup_enabled"),
    leakradar: parseEnabled("minitool_leakradar_enabled"),
    cyberchef: parseEnabled("minitool_cyberchef_enabled"),
  });
});

// POST /admin/api/settings/minitools
router.post("/api/settings/minitools", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const { cvssEnabled, breachEnabled, azureEnabled, securitytrailsEnabled, securityHeadersEnabled, tlsCheckEnabled, dnsLookupEnabled, leakradarEnabled, cyberchefEnabled } = req.body || {};
  if (cvssEnabled !== undefined) {
    setSetting("minitool_cvss_enabled", cvssEnabled ? "true" : "false");
  }
  if (breachEnabled !== undefined) {
    setSetting("minitool_breach_enabled", breachEnabled ? "true" : "false");
  }
  if (azureEnabled !== undefined) {
    setSetting("minitool_azure_enabled", azureEnabled ? "true" : "false");
  }
  if (securitytrailsEnabled !== undefined) {
    setSetting("minitool_securitytrails_enabled", securitytrailsEnabled ? "true" : "false");
  }
  if (securityHeadersEnabled !== undefined) {
    setSetting("minitool_security_headers_enabled", securityHeadersEnabled ? "true" : "false");
  }
  if (tlsCheckEnabled !== undefined) {
    setSetting("minitool_tls_check_enabled", tlsCheckEnabled ? "true" : "false");
  }
  if (dnsLookupEnabled !== undefined) {
    setSetting("minitool_dns_lookup_enabled", dnsLookupEnabled ? "true" : "false");
  }
  if (leakradarEnabled !== undefined) {
    setSetting("minitool_leakradar_enabled", leakradarEnabled ? "true" : "false");
  }
  if (cyberchefEnabled !== undefined) {
    setSetting("minitool_cyberchef_enabled", cyberchefEnabled ? "true" : "false");
  }
  auditAdmin(req, {
    category: "settings",
    action: "minitools_update",
    targetType: "minitools_settings",
    metadata: { cvssEnabled, breachEnabled, azureEnabled, securitytrailsEnabled, securityHeadersEnabled, tlsCheckEnabled, dnsLookupEnabled, leakradarEnabled, cyberchefEnabled },
  });
  res.json({ success: true });
});

// GET /admin/api/survey-stats
router.get("/api/survey-stats", requireAdmin, (req, res) => {
  const surveys = listAllSurveys();
  const stats = {
    total: surveys.length,
    active: 0,
    draft: 0,
    ended: 0,
    closed: 0,
  };
  for (const survey of surveys) {
    if (survey.status === "published") stats.active++;
    else if (survey.status === "draft") stats.draft++;
    else if (survey.status === "ended") stats.ended++;
    else if (survey.status === "closed") stats.closed++;
  }
  res.json(stats);
});

// GET /admin/api/surveys?page=1&limit=50
router.get("/api/surveys", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const allSurveys = listAllSurveys();
  const total = allSurveys.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const surveys = allSurveys.slice(start, start + limit).map((survey) => {
    const owner = getUserById(survey.owner_id);
    const stats = getSurveyStats(survey.id);
    return {
      id: survey.id,
      title: survey.title,
      ownerId: survey.owner_id,
      ownerUsername: owner?.username || null,
      status: survey.status,
      responseMode: survey.response_mode,
      startsAt: survey.starts_at,
      endsAt: survey.ends_at,
      createdAt: survey.created_at,
      updatedAt: survey.updated_at,
      questionCount: stats.questionCount || 0,
      responseCount: stats.responseCount || 0,
    };
  });
  res.json({ surveys, page, totalPages, total });
});

// DELETE /admin/api/paste/:id
router.delete("/api/paste/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid paste ID" });
  }

  const deleted = deletePaste(id);
  if (!deleted) {
    return res.status(404).json({ error: "Paste not found" });
  }
  auditAdmin(req, { category: "content", action: "paste_delete", targetType: "paste", targetId: id });
  res.json({ success: true });
});

// DELETE /admin/api/file/:id
router.delete("/api/file/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid file ID" });
  }

  deleteFile(id);
  auditAdmin(req, { category: "content", action: "share_delete", targetType: "share", targetId: id });
  res.json({ success: true });
});

// DELETE /admin/api/survey/:id
router.delete("/api/survey/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid survey ID" });
  }

  deleteSurveyById(id);
  auditAdmin(req, { category: "content", action: "survey_delete", targetType: "survey", targetId: id });
  res.json({ success: true });
});

// POST /admin/api/pastes/bulk-delete
router.post("/api/pastes/bulk-delete", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  auditAdmin(req, { category: "content", action: "paste_bulk_delete", targetType: "paste", metadata: { count: ids.length, deleted } });
  res.json({ success: true, deleted });
});

// POST /admin/api/files/bulk-delete
router.post("/api/files/bulk-delete", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  auditAdmin(req, { category: "content", action: "share_bulk_delete", targetType: "share", metadata: { count: ids.length, deleted } });
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
router.put("/api/users/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  auditAdmin(req, { category: "identity", action: "user_update", targetType: "user", targetId: id, metadata: { emailChanged: !!(email && email !== user.email), usernameChanged: !!(username && username !== user.username) } });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_user", ip: req.ip, userId: id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/suspend
router.post("/api/users/:id/suspend", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  suspendUserById(req.params.id);
  auditAdmin(req, { category: "identity", action: "user_suspend", targetType: "user", targetId: req.params.id });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:suspend_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/unsuspend
router.post("/api/users/:id/unsuspend", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  unsuspendUserById(req.params.id);
  auditAdmin(req, { category: "identity", action: "user_unsuspend", targetType: "user", targetId: req.params.id });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:unsuspend_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// DELETE /admin/api/users/:id
router.delete("/api/users/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  // Clean up avatar file
  const avatarPath = path.join(AVATARS_DIR, `${req.params.id}.webp`);
  try { if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath); } catch {}

  // Clean up personal shortcut icons
  const userShortcuts = getShortcutsByUser(req.params.id);
  for (const sc of userShortcuts) {
    if (sc.iconUrl) deleteShortcutIconFile(sc.iconUrl);
  }

  deleteUserById(req.params.id);
  auditAdmin(req, { category: "identity", action: "user_delete", targetType: "user", targetId: req.params.id });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:delete_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// POST /admin/api/users/:id/reset-password
router.post("/api/users/:id/reset-password", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const idErr = validateId(req.params.id, "User ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomBytes(16).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  createPasswordReset({ id, userId: user.id, token, expiresAt });

  const resetUrl = buildAbsoluteUrl(req, `/reset-password?token=${encodeURIComponent(token)}`);
  if (!resetUrl) {
    return res.status(503).json({ error: "Trusted public origin is not configured for password reset links" });
  }
  const emailThrottle = checkEmailSendThrottle(user.email.toLowerCase().trim(), {
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
    const smtpInfo = await sendPasswordResetEmail(user.email, resetUrl);
    auditAdmin(req, { category: "identity", action: "password_reset_create", targetType: "user", targetId: user.id, metadata: { emailSent: true } });
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:reset_password_email", ip: req.ip, userId: user.id }));
    res.json({ success: true, emailSent: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    auditAdmin(req, { category: "identity", action: "password_reset_create", targetType: "user", targetId: user.id, metadata: { emailSent: false, error: err.message } });
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
router.post("/api/invites", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const { email, roleId } = req.body || {};
  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  if (roleId && !getRoleById(roleId)) {
    return res.status(400).json({ error: "Selected role not found" });
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
    roleId: roleId || null,
    expiresAt,
  });
  auditAdmin(req, { category: "identity", action: "invite_create", targetType: "invite", targetId: id, metadata: { email, roleId: roleId || null } });

  const registrationUrl = buildAbsoluteUrl(req, `/register?token=${encodeURIComponent(token)}`);
  if (!registrationUrl) {
    return res.status(503).json({ error: "Trusted public origin is not configured for invite links" });
  }
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
    const smtpInfo = await sendInviteEmail(email, registrationUrl);
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:invite_sent", ip: req.ip, email }));
    res.json({ success: true, emailSent: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:invite_fallback", ip: req.ip, email, error: err.message }));
    res.json({ success: true, emailSent: false, registrationUrl, error: "Failed to send email" });
  }
});

// DELETE /admin/api/invites/:id — Revoke invite
router.delete("/api/invites/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "Invite ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const deleted = revokeInvite(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Invite not found or already used" });
  }
  auditAdmin(req, { category: "identity", action: "invite_revoke", targetType: "invite", targetId: req.params.id });
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
router.post("/api/settings/smtp", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  auditAdmin(req, { category: "settings", action: "smtp_update", targetType: "smtp", metadata: { host, port, from, secure: !!secure, passwordChanged: actualPass !== currentConfig.smtpPass } });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_smtp", ip: req.ip }));
  res.json({ success: true });
});

// POST /admin/api/settings/smtp/test
router.post("/api/settings/smtp/test", requireAdmin, async (req, res) => {
  const { to } = req.body || {};
  if (!to || typeof to !== "string") {
    return res.status(400).json({ error: "Recipient email is required" });
  }
  const emailThrottle = checkEmailSendThrottle(to.toLowerCase().trim(), {
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
    const smtpInfo = await sendTestEmail(to);
    res.json({ success: true, smtpResponse: smtpInfo.response });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:smtp_test_error", ip: req.ip, error: err.message }));
    res.status(400).json({ error: "SMTP test failed" });
  }
});

// ============================================================
// Calendar settings
// ============================================================

router.get("/api/settings/calendar", requireAdmin, (req, res) => {
  const dailyHours = Number.parseFloat(getSetting("calendar_daily_hours"));
  const workdayStart = String(getSetting("calendar_workday_start") || "08:30");
  const workdayEnd = String(getSetting("calendar_workday_end") || "17:30");
  const workdays = String(getSetting("calendar_workdays") || "1,2,3,4,5")
    .split(",")
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  res.json({
    dailyHours: Number.isFinite(dailyHours) ? dailyHours : 7.6,
    workdayStart,
    workdayEnd,
    workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
  });
});

router.post("/api/settings/calendar", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const parsed = Number.parseFloat(req.body?.dailyHours);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 24) {
    return res.status(400).json({ error: "Daily hours must be between 1 and 24" });
  }
  const workdayStart = String(req.body?.workdayStart || "").trim();
  const workdayEnd = String(req.body?.workdayEnd || "").trim();
  const workdays = Array.isArray(req.body?.workdays)
    ? req.body.workdays.map((value) => parseInt(value, 10)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    : [];
  if (!/^\d{2}:\d{2}$/.test(workdayStart) || !/^\d{2}:\d{2}$/.test(workdayEnd)) {
    return res.status(400).json({ error: "Workday start and end times must use HH:MM format" });
  }
  if (workdays.length === 0) {
    return res.status(400).json({ error: "Select at least one workday" });
  }
  setSetting("calendar_daily_hours", String(Number(parsed.toFixed(2))));
  setSetting("calendar_workday_start", workdayStart);
  setSetting("calendar_workday_end", workdayEnd);
  setSetting("calendar_workdays", workdays.join(","));
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_calendar_settings", ip: req.ip }));
  res.json({
    success: true,
    dailyHours: Number(parsed.toFixed(2)),
    workdayStart,
    workdayEnd,
    workdays,
  });
});

const VALID_CUSTOM_HEX = /^#[0-9A-Fa-f]{6}$/;
const VALID_BRAND_PREFIX = /^[A-Za-z][A-Za-z0-9]{0,29}$/;

router.get("/api/settings/theme", requireAdmin, (req, res) => {
  const primaryTheme = String(getSetting("site_primary_theme") || "red").trim().toLowerCase();
  const customHex = String(getSetting("site_custom_theme_hex") || "").trim();
  const brandPrefix = String(getSetting("site_brand_prefix") || "").trim();
  const theme = primaryTheme === "custom" && VALID_CUSTOM_HEX.test(customHex) ? "custom" : (SITE_PRIMARY_THEMES.has(primaryTheme) ? primaryTheme : "red");
  const brandLogoPath = path.join(BRAND_DIR, "logo.webp");
  const hasBrandLogoFile = fs.existsSync(brandLogoPath);
  const hasBrandLogo = hasBrandLogoFile;
  let brandLogoVersion = hasBrandLogo ? (getSetting("site_brand_logo_version") || "") : "";
  if (hasBrandLogoFile && getSetting("site_brand_logo") !== "true") {
    setSetting("site_brand_logo", "true");
  }
  if (!hasBrandLogoFile && getSetting("site_brand_logo") === "true") {
    setSetting("site_brand_logo", "");
    setSetting("site_brand_logo_version", "");
  }
  if (hasBrandLogoFile && !brandLogoVersion) {
    brandLogoVersion = String(fs.statSync(brandLogoPath).mtimeMs || Date.now());
    setSetting("site_brand_logo_version", brandLogoVersion);
  }
  res.json({ primaryTheme: theme, customHex: theme === "custom" ? customHex : "", brandPrefix, hasBrandLogo, brandLogoVersion });
});

router.post("/api/settings/theme", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const primaryTheme = String(req.body?.primaryTheme || "red").trim().toLowerCase();
  const customHex = String(req.body?.customHex || "").trim();
  const brandPrefix = String(req.body?.brandPrefix || "").trim();

  if (brandPrefix && !VALID_BRAND_PREFIX.test(brandPrefix)) {
    return res.status(400).json({ error: "Brand prefix must be 1-30 alphanumeric characters, starting with a letter" });
  }
  setSetting("site_brand_prefix", brandPrefix);

  if (primaryTheme === "custom") {
    if (!VALID_CUSTOM_HEX.test(customHex)) {
      return res.status(400).json({ error: "Custom theme requires a valid hex colour (#RRGGBB)" });
    }
    setSetting("site_primary_theme", "custom");
    setSetting("site_custom_theme_hex", customHex);
  } else if (SITE_PRIMARY_THEMES.has(primaryTheme)) {
    setSetting("site_primary_theme", primaryTheme);
  } else {
    return res.status(400).json({ error: "Invalid site theme" });
  }

  auditAdmin(req, {
    category: "settings",
    action: "theme_update",
    targetType: "site_theme",
    metadata: { primaryTheme, customHex: primaryTheme === "custom" ? customHex : "", brandPrefix },
  });
  res.json({ success: true, primaryTheme, customHex: primaryTheme === "custom" ? customHex : "", brandPrefix });
});

// ============================================================
// Brand logo upload
// ============================================================

const VALID_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/bmp", "image/tiff"]);

const brandLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /admin/api/settings/brand-logo
router.post("/api/settings/brand-logo", requireAdmin, requireRecentAdminAuth, brandLogoUpload.single("logo"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  if (!VALID_LOGO_MIMES.has(file.mimetype)) {
    return res.status(400).json({ error: "Only image files are accepted (PNG, JPEG, WebP, GIF, SVG, BMP, TIFF)" });
  }

  try {
    const sharp = require("sharp");
    const logoPath = path.join(BRAND_DIR, "logo.webp");
    const faviconPath = path.join(BRAND_DIR, "favicon.png");

    const logoBuffer = await sharp(file.buffer)
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();

    const faviconBuffer = await sharp(file.buffer)
      .rotate()
      .resize(64, 64, { fit: "cover" })
      .png()
      .toBuffer();

    fs.writeFileSync(logoPath, logoBuffer);
    fs.writeFileSync(faviconPath, faviconBuffer);

    const brandLogoVersion = String(Date.now());
    setSetting("site_brand_logo", "true");
    setSetting("site_brand_logo_version", brandLogoVersion);

    auditAdmin(req, {
      category: "settings",
      action: "brand_logo_upload",
      targetType: "site_brand",
    });

    res.json({ success: true, hasBrandLogo: true, brandLogoVersion });
  } catch (err) {
    auditAdmin(req, {
      category: "settings",
      action: "brand_logo_upload",
      targetType: "site_brand",
      outcome: "failure",
      metadata: { error: err.message },
    });
    res.status(500).json({ error: "Failed to process logo image" });
  }
});

// DELETE /admin/api/settings/brand-logo
router.delete("/api/settings/brand-logo", requireAdmin, requireRecentAdminAuth, (req, res) => {
  try {
    const logoPath = path.join(BRAND_DIR, "logo.webp");
    const faviconPath = path.join(BRAND_DIR, "favicon.png");
    if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
    if (fs.existsSync(faviconPath)) fs.unlinkSync(faviconPath);
    setSetting("site_brand_logo", "");
    setSetting("site_brand_logo_version", "");

    auditAdmin(req, {
      category: "settings",
      action: "brand_logo_delete",
      targetType: "site_brand",
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete logo" });
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
router.delete("/api/conversations/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
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

router.get("/api/vaults/:id/members", requireAdmin, (req, res) => {
  const idErr = validateId(req.params.id, "Vault ID");
  if (idErr) return res.status(400).json({ error: idErr });

  const vault = getVault(req.params.id);
  if (!vault) return res.status(404).json({ error: "Vault not found" });

  const rawMembers = getVaultMembersList(req.params.id);
  const members = [];
  const seenUserIds = new Set();
  const ownerMembership = rawMembers.find((member) => member.user_id === vault.owner_id);

  if (ownerMembership) {
    members.push({
      userId: ownerMembership.user_id,
      username: ownerMembership.username,
      permission: "owner",
      canWrite: true,
      canManageMembers: true,
      isOwner: true,
      joinedAt: ownerMembership.joined_at,
    });
    seenUserIds.add(ownerMembership.user_id);
  } else {
    const owner = getUserById(vault.owner_id);
    members.push({
      userId: vault.owner_id,
      username: owner?.username || vault.owner_id,
      permission: "owner",
      canWrite: true,
      canManageMembers: true,
      isOwner: true,
      joinedAt: vault.created_at,
    });
    seenUserIds.add(vault.owner_id);
  }

  for (const member of rawMembers) {
    if (seenUserIds.has(member.user_id)) continue;
    members.push({
      userId: member.user_id,
      username: member.username,
      permission: membershipPermission(member),
      canWrite: !!member.can_write,
      canManageMembers: !!member.can_manage_members,
      isOwner: false,
      joinedAt: member.joined_at,
    });
  }

  res.json({
    vault: { id: vault.id, type: vault.type, ownerId: vault.owner_id },
    members,
  });
});

router.put("/api/vaults/:id/members/:userId", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "Vault ID");
  if (idErr) return res.status(400).json({ error: idErr });
  const userIdErr = validateId(req.params.userId, "User ID");
  if (userIdErr) return res.status(400).json({ error: userIdErr });

  const vault = getVault(req.params.id);
  if (!vault) return res.status(404).json({ error: "Vault not found" });
  if (req.params.userId === vault.owner_id) {
    return res.status(400).json({ error: "Owner permissions cannot be changed" });
  }

  const normalizedPermission = normalizeVaultPermission(req.body?.permission);
  const updated = updateVaultMemberPermission({
    vaultId: req.params.id,
    userId: req.params.userId,
    role: normalizedPermission.role,
    canWrite: normalizedPermission.canWrite,
    canManageMembers: normalizedPermission.canManageMembers,
  });
  if (!updated) return res.status(404).json({ error: "Member not found" });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:vault_member_update", ip: req.ip, vaultId: req.params.id, userId: req.params.userId, permission: normalizedPermission.permission }));
  res.json({ success: true });
});

router.delete("/api/vaults/:id/members/:userId", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const idErr = validateId(req.params.id, "Vault ID");
  if (idErr) return res.status(400).json({ error: idErr });
  const userIdErr = validateId(req.params.userId, "User ID");
  if (userIdErr) return res.status(400).json({ error: userIdErr });

  const vault = getVault(req.params.id);
  if (!vault) return res.status(404).json({ error: "Vault not found" });
  if (req.params.userId === vault.owner_id) {
    return res.status(400).json({ error: "Owner cannot be removed from vault" });
  }

  removeVaultMember(req.params.id, req.params.userId);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:vault_member_remove", ip: req.ip, vaultId: req.params.id, userId: req.params.userId }));
  res.json({ success: true });
});

router.delete("/api/vaults/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  const flags = listFeatureFlags({ getSetting });
  res.json({
    sessionTTL: parseInt(getSetting("session_ttl"), 10) || 43200,
    sessionTTLExtended: parseInt(getSetting("session_ttl_extended"), 10) || 604800,
    mfaRememberDays: parseInt(getSetting("mfa_remember_days"), 10) || 30,
    mfaRequired: getSetting("mfa_required") === "true",
    adminReauthRequired: isAdminReauthRequired(),
    adminReauthWindowSeconds: ADMIN_REAUTH_WINDOW_SECONDS,
    openApiEnabled: flags.openApiEnabled,
    serviceAccountsEnabled: flags.serviceAccountsEnabled,
    webhooksEnabled: flags.webhooksEnabled,
  });
});

// POST /admin/api/settings/security
router.post("/api/settings/security", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const {
    sessionTTL,
    sessionTTLExtended,
    mfaRememberDays,
    mfaRequired,
    adminReauthRequired,
    openApiEnabled,
    serviceAccountsEnabled,
    webhooksEnabled,
  } = req.body || {};

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

  if (adminReauthRequired !== undefined) {
    setSetting("admin_reauth_required", adminReauthRequired ? "true" : "false");
  }
  if (openApiEnabled !== undefined) {
    setSetting("openapi_enabled", openApiEnabled ? "true" : "false");
  }
  if (serviceAccountsEnabled !== undefined) {
    setSetting("service_accounts_enabled", serviceAccountsEnabled ? "true" : "false");
  }
  if (webhooksEnabled !== undefined) {
    setSetting("webhooks_enabled", webhooksEnabled ? "true" : "false");
  }

  auditAdmin(req, {
    category: "settings",
    action: "security_update",
    targetType: "security_settings",
    metadata: {
      sessionTTL,
      sessionTTLExtended,
      mfaRememberDays,
      mfaRequired: mfaRequired !== undefined ? !!mfaRequired : undefined,
      adminReauthRequired: adminReauthRequired !== undefined ? !!adminReauthRequired : undefined,
      openApiEnabled: openApiEnabled !== undefined ? !!openApiEnabled : undefined,
      serviceAccountsEnabled: serviceAccountsEnabled !== undefined ? !!serviceAccountsEnabled : undefined,
      webhooksEnabled: webhooksEnabled !== undefined ? !!webhooksEnabled : undefined,
    },
  });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_security", ip: req.ip }));
  res.json({ success: true });
});

// GET /admin/api/settings/sso
router.get("/api/settings/sso", requireAdmin, (req, res) => {
  res.json(getSsoAdminSettings());
});

// POST /admin/api/settings/sso
router.post("/api/settings/sso", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const body = req.body || {};
  const enabled = !!body.enabled;
  const provider = String(body.provider || "none").trim().toLowerCase();
  const requireForLogin = !!body.requireForLogin;
  const autoProvision = !!body.autoProvision;
  const loginPath = samlAuth.DEFAULT_LOGIN_PATH;
  const acsPath = samlAuth.DEFAULT_ACS_PATH;
  const metadataPath = samlAuth.DEFAULT_METADATA_PATH;
  const entityId = cleanOptionalText(body.entityId, 300);
  const idpEntityId = cleanOptionalText(body.idpEntityId, 300);
  const idpMetadataUrl = cleanOptionalText(body.idpMetadataUrl, 500);
  const entryPoint = cleanOptionalText(body.entryPoint, 500);
  const idpCert = cleanOptionalText(body.idpCert, 20000);
  const emailAttribute = cleanOptionalText(body.emailAttribute || samlAuth.DEFAULT_EMAIL_ATTRIBUTE, 180);
  const usernameAttribute = cleanOptionalText(body.usernameAttribute || samlAuth.DEFAULT_USERNAME_ATTRIBUTE, 180);
  const fullNameAttribute = cleanOptionalText(body.fullNameAttribute || samlAuth.DEFAULT_FULL_NAME_ATTRIBUTE, 180);
  const defaultRoleId = cleanOptionalText(body.defaultRoleId, 80);
  const signRequests = !!body.signRequests;
  const publicCert = cleanOptionalText(body.publicCert, 20000);
  const privateKey = cleanOptionalText(body.privateKey, 20000);
  const forceAuthn = !!body.forceAuthn;
  const currentPrivateKey = decryptValue(getSetting("sso_sp_private_key") || "");

  if (!SSO_PROVIDERS.has(provider)) {
    return res.status(400).json({ error: "Invalid SSO provider" });
  }
  if (enabled && provider === "none") {
    return res.status(400).json({ error: "Select a provider before enabling SSO" });
  }
  if (requireForLogin && !enabled) {
    return res.status(400).json({ error: "SSO must be enabled before requiring it for login" });
  }
  if (enabled && provider === "saml") {
    if (!entryPoint) return res.status(400).json({ error: "SAML IdP SSO URL is required" });
    if (!/^https:\/\//i.test(entryPoint)) return res.status(400).json({ error: "SAML IdP SSO URL must use HTTPS" });
    if (!idpCert) return res.status(400).json({ error: "SAML IdP signing certificate is required" });
    if (!entityId) return res.status(400).json({ error: "SAML SP Entity ID is required" });
  }
  if (defaultRoleId && !getRoleById(defaultRoleId)) {
    return res.status(400).json({ error: "Selected SSO default role does not exist" });
  }
  if (enabled && provider === "saml" && signRequests && (!publicCert || !(privateKey || currentPrivateKey))) {
    return res.status(400).json({ error: "Signed SAML requests require an SP public certificate and private key" });
  }

  setSetting("sso_enabled", enabled ? "true" : "false");
  setSetting("sso_provider", provider);
  setSetting("sso_require_for_login", requireForLogin ? "true" : "false");
  setSetting("sso_auto_provision", autoProvision ? "true" : "false");
  setSetting("sso_login_path", loginPath);
  setSetting("sso_acs_path", acsPath);
  setSetting("sso_metadata_path", metadataPath);
  setSetting("sso_entity_id", entityId);
  setSetting("sso_idp_entity_id", idpEntityId);
  setSetting("sso_idp_metadata_url", idpMetadataUrl);
  setSetting("sso_saml_entry_point", entryPoint);
  setSetting("sso_idp_cert", idpCert);
  setSetting("sso_email_attribute", emailAttribute);
  setSetting("sso_username_attribute", usernameAttribute);
  setSetting("sso_full_name_attribute", fullNameAttribute);
  setSetting("sso_default_role_id", defaultRoleId);
  setSetting("sso_sign_requests", signRequests ? "true" : "false");
  setSetting("sso_sp_public_cert", publicCert);
  if (privateKey) {
    setSetting("sso_sp_private_key", encryptValue(privateKey));
  } else if (!signRequests) {
    setSetting("sso_sp_private_key", "");
  }
  setSetting("sso_force_authn", forceAuthn ? "true" : "false");

  auditAdmin(req, {
    category: "identity",
    action: "sso_settings_update",
    targetType: "sso_settings",
    metadata: {
      enabled,
      provider,
      requireForLogin,
      autoProvision,
      loginPath,
      acsPath,
      metadataPath,
      entityIdConfigured: !!entityId,
      idpEntityIdConfigured: !!idpEntityId,
      idpMetadataUrlConfigured: !!idpMetadataUrl,
      entryPointConfigured: !!entryPoint,
      idpCertConfigured: !!idpCert,
      defaultRoleId: defaultRoleId || null,
      signRequests,
      publicCertConfigured: !!publicCert,
      privateKeyConfigured: !!(privateKey || currentPrivateKey),
      forceAuthn,
    },
  });

  res.json({ success: true });
});

// POST /admin/api/users/:id/reset-mfa — admin resets user's MFA (account recovery)
router.post("/api/users/:id/reset-mfa", requireAdmin, requireRecentAdminAuth, (req, res) => {
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
  deleteExtensionSessionsByUserId(user.id);
  deleteTrustedDevicesByUser(user.id);

  auditAdmin(req, { category: "identity", action: "mfa_reset", targetType: "user", targetId: user.id });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:reset_mfa", ip: req.ip, userId: user.id }));
  res.json({ success: true });
});

// ============================================================
// Weather locations
// ============================================================

// GET /admin/api/settings/weather
router.get("/api/settings/weather", requireAdmin, (req, res) => {
  const raw = getSetting("weather_locations");
  const locations = raw ? JSON.parse(raw) : [];
  res.json({ locations });
});

// POST /admin/api/settings/weather
router.post("/api/settings/weather", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const { locations } = req.body || {};

  if (!Array.isArray(locations) || locations.length > 5) {
    return res.status(400).json({ error: "Maximum 5 locations allowed" });
  }

  const cleaned = locations.map((loc) => ({
    name: String(loc.name || "").substring(0, 100),
    lat: parseFloat(loc.lat) || 0,
    lon: parseFloat(loc.lon) || 0,
  })).filter((loc) => loc.name && loc.lat !== 0 && loc.lon !== 0);

  setSetting("weather_locations", JSON.stringify(cleaned));

  // Invalidate weather cache so homepage picks up new locations
  const { clearWeatherCache } = require("../routes/homepage");

  clearWeatherCache();

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:update_weather", ip: req.ip }));
  res.json({ success: true, locations: cleaned });
});

// GET /admin/api/settings/weather/search?q=city
router.get("/api/settings/weather/search", requireAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) {
    return res.json({ results: [] });
  }

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en`;
    const data = await httpGetJSON(geoUrl);
    const results = (data.results || []).map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lon: r.longitude,
    }));
    res.json({ results });
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: "weather:search_error", error: err.message }));
    res.json({ results: [] });
  }
});

// ============================================================
// Team Shortcuts (Admin)
// ============================================================

const { createShortcut: dbCreateShortcut, updateShortcutById: dbUpdateShortcutById } = require("../database");

// Delete an orphaned shortcut icon file from disk
function deleteShortcutIconFile(iconUrl) {
  if (!iconUrl || !iconUrl.startsWith("/api/homepage/shortcut-icon/")) return;
  const rawId = iconUrl.replace("/api/homepage/shortcut-icon/", "");
  const baseId = rawId.replace(/\.(webp|ico)$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(baseId)) return;
  for (const ext of ["webp", "ico"]) {
    const iconPath = path.join(__dirname, "..", "..", "data", "shortcut-icons", `${baseId}.${ext}`);
    try { if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath); } catch {}
  }
}

// GET /admin/api/shortcuts/team
router.get("/api/shortcuts/team", requireAdmin, (req, res) => {
  const shortcuts = getShortcutsByCategory("team");
  res.json({ shortcuts });
});

// POST /admin/api/shortcuts/team
router.post("/api/shortcuts/team", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const { title, url, icon, icon_url, description } = req.body || {};

  if (!title || typeof title !== "string" || title.length > 100) {
    return res.status(400).json({ error: "Title is required (max 100 chars)" });
  }
  if (!url || typeof url !== "string" || url.length > 500) {
    return res.status(400).json({ error: "URL is required (max 500 chars)" });
  }
  if (!url.startsWith("/") && !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "URL must start with / or http(s)://" });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const safeIcon = (typeof icon === "string" && icon.length <= 20) ? icon : null;
  let safeIconUrl = (typeof icon_url === "string" && icon_url.startsWith("/api/homepage/shortcut-icon/")) ? icon_url : null;
  const safeDescription = (typeof description === "string" && description.length <= 200) ? description.trim() : null;

  // If no icon provided, try fetching the site's favicon
  if (!safeIcon && !safeIconUrl) {
    const { fetchFavicon } = require("../routes/homepage");
    const faviconUrl = await fetchFavicon(url.trim());
    if (faviconUrl) safeIconUrl = faviconUrl;
  }

  // Use "admin" as userId for team shortcuts (they're shared)
  dbCreateShortcut({
    id,
    userId: "admin",
    category: "team",
    title: title.trim(),
    url: url.trim(),
    icon: safeIcon,
    iconUrl: safeIconUrl,
    description: safeDescription,
    sortOrder: 0,
  });

  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:team_shortcut_create", ip: req.ip }));
  res.json({ success: true, id });
});

// PUT /admin/api/shortcuts/team/:id
router.put("/api/shortcuts/team/:id", requireAdmin, requireRecentAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { title, url, icon, icon_url, description } = req.body || {};

  const existing = getShortcutByIdAny(id);
  if (!existing || existing.category !== "team") {
    return res.status(404).json({ error: "Team shortcut not found" });
  }

  const safeIcon = (typeof icon === "string" && icon.length <= 20) ? icon : existing.icon;
  const oldIconUrl = existing.icon_url || null;
  let safeIconUrl = (typeof icon_url === "string" && icon_url.startsWith("/api/homepage/shortcut-icon/")) ? icon_url : oldIconUrl;
  const safeTitle = (typeof title === "string" && title.trim()) ? title.trim() : existing.title;
  const safeDescription = (typeof description === "string") ? description.trim() : existing.description;
  let safeUrl = existing.url;
  if (typeof url === "string" && url.trim()) {
    if (!url.trim().startsWith("/") && !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: "URL must start with / or http(s)://" });
    }
    safeUrl = url.trim();
  }

  // If no icon and no icon URL, try fetching favicon
  if (!safeIcon && !safeIconUrl) {
    const { fetchFavicon } = require("../routes/homepage");
    const faviconUrl = await fetchFavicon(safeUrl);
    if (faviconUrl) safeIconUrl = faviconUrl;
  }

  // Clean up old icon if it changed
  if (oldIconUrl && oldIconUrl !== safeIconUrl) {
    deleteShortcutIconFile(oldIconUrl);
  }

  // Use actual user_id from the existing row
  const updated = dbUpdateShortcutById({
    id,
    userId: existing.user_id,
    category: "team",
    title: safeTitle,
    url: safeUrl,
    icon: safeIcon,
    iconUrl: safeIconUrl,
    description: safeDescription,
    sortOrder: existing.sort_order || 0,
  });

  if (!updated) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), action: "admin:team_shortcut_update_failed", id, userId: existing.user_id }));
    return res.status(404).json({ error: "Failed to update" });
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:team_shortcut_update", ip: req.ip, id }));
  res.json({ success: true });
});
router.delete("/api/shortcuts/team/:id", requireAdmin, requireRecentAdminAuth, (req, res) => {
  const existing = getShortcutByIdAny(req.params.id);
  if (!existing || existing.category !== "team") {
    return res.status(404).json({ error: "Team shortcut not found" });
  }
  // Clean up icon file and favourites
  const iconUrl = existing.icon_url || null;
  if (iconUrl) deleteShortcutIconFile(iconUrl);
  deleteFavouritesByShortcut(req.params.id);
  deleteShortcutByIdAdmin(req.params.id);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:team_shortcut_delete", ip: req.ip, id: req.params.id }));
  res.json({ success: true });
});

// POST /admin/api/shortcuts/team/upload-icon
const teamIconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.post("/api/shortcuts/team/upload-icon", requireAdmin, requireRecentAdminAuth, teamIconUpload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  if (!file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Only image files" });

  try {
    const id = crypto.randomBytes(16).toString("base64url");
    const sharp = require("sharp");
    const buffer = await sharp(file.buffer).rotate().resize(64, 64, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
    const iconsDir = path.join(__dirname, "..", "..", "data", "shortcut-icons");
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(path.join(iconsDir, `${id}.webp`), buffer);
    res.json({ url: `/api/homepage/shortcut-icon/${id}` });
  } catch {
    res.status(500).json({ error: "Failed to process image" });
  }
});

// ============================================================
// Engage Operations (Admin)
// ============================================================

router.get("/api/engage-summary", requireAdmin, (req, res) => {
  try {
    const {
      getEngageDashboardStats,
      getEngageEngagementsWithoutTesters,
      listEngageClients,
      listEngageOpportunities,
      listEngageEngagements,
      listAllEngageQaReviewsEnriched,
      getEngageActivityCount,
    } = require("../database");
    const stats = getEngageDashboardStats();
    const clients = listEngageClients(100000, 0);
    const opportunities = listEngageOpportunities(100000, 0);
    const engagements = listEngageEngagements(100000, 0);
    const qaReviews = listAllEngageQaReviewsEnriched();
    const activeQaStatuses = new Set(["ready_for_qa", "assigned", "reviewing", "requires_more_work"]);
    const terminalEngagementStatuses = new Set(["delivered", "closed", "cancelled", "archived"]);
    const activeEngagements = engagements.filter((item) => !item.archived_at && !terminalEngagementStatuses.has(item.status));
    const qaQueue = qaReviews.filter((item) => activeQaStatuses.has(item.status));
    const unassignedQa = qaQueue.filter((item) => !item.assigned_to_user_id);
    const missingTeam = getEngageEngagementsWithoutTesters();
    const linkedEngagements = engagements.filter((item) => item.reporter_project_id || item.calendar_project_id);
    const unlinkedActive = activeEngagements.filter((item) => !item.reporter_project_id && !item.calendar_project_id);
    res.status(200).json({
      stats,
      counts: {
        clients: clients.filter((item) => !item.archived_at).length,
        opportunities: opportunities.filter((item) => !item.archived_at && !["won", "lost", "rejected", "archived"].includes(item.stage)).length,
        engagements: activeEngagements.length,
        linkedEngagements: linkedEngagements.length,
        qaQueue: qaQueue.length,
        unassignedQa: unassignedQa.length,
        missingTeam: missingTeam.length,
        attention: Number(stats.blockedEngagements || 0) + Number(stats.overdueEngagements || 0) + missingTeam.length + unassignedQa.length,
        activity: getEngageActivityCount(),
      },
      issues: {
        blocked: stats.blockedList || [],
        overdue: stats.overdueList || [],
        missingTeam,
        unassignedQa: unassignedQa.slice(0, 10),
        unlinkedActive: unlinkedActive.slice(0, 10),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to load engage summary." });
  }
});

router.get("/api/engage-activity", requireAdmin, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  try {
    const { listEngageActivityPage, getEngageActivityCount } = require("../database");
    const total = getEngageActivityCount();
    const rows = listEngageActivityPage(limit, offset);
    res.status(200).json({ rows, total, page, limit });
  } catch {
    res.status(500).json({ error: "Failed to load engage activity." });
  }
});

router.get("/api/engage-activity.csv", requireAdmin, (req, res) => {
  try {
    const { listEngageActivityPage } = require("../database");
    const rows = listEngageActivityPage(100000, 0);
    const header = "Time,Entity Type,Entity ID,Action,User,Username,Details";
    const lines = rows.map((r) => {
      const ts = r.created_at ? new Date(r.created_at * 1000).toISOString() : "";
      const details = r.details ? String(r.details).replace(/"/g, '""') : "";
      return `"${ts}","${r.entity_type || ""}","${r.entity_id || ""}","${r.action || ""}","${r.user_id || ""}","${r.username || ""}","${details}"`;
    });
    const csv = [header, ...lines].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=engage-activity.csv");
    res.status(200).send(csv);
  } catch {
    res.status(500).json({ error: "Failed to export engage activity." });
  }
});

module.exports = {
  router,
  requireAdmin,
  requireRecentAdminAuth,
};
