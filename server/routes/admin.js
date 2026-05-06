const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
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
  getShortcutsByUser, deleteShortcutById, deleteFavouritesByShortcut, AVATARS_DIR,
  getVault, getVaultMembersList, updateVaultMemberPermission, removeVaultMember,
  listAllSurveys, getSurveyStats, deleteSurveyById,
  createAuditEvent, listAuditEvents, listSchemaMigrations, getDeploymentCounts,
  getReporterGlobalStats, listReporterProjects, listReporterProjectMembers,
  db, DB_PATH,
} = require("../database");
const { sendInviteEmail, sendPasswordResetEmail, sendTestEmail } = require("../email");
const { buildAbsoluteUrl } = require("../public-origin");
const { createEncryptedDatabaseBackup } = require("../core/backup");
const { getCookieSecure } = require("../core/security/cookies");
const { buildBasePosture } = require("../core/security/posture");
const { logEvent, redactObject } = require("../core/logger");
const { parseInteger } = require("../core/validation");
const redsecAiProvider = require("../modules/redsecai/provider");

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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
      return res.status(403).json({ error: "Admin access requires an active user session. Please log in to your account first." });
    }
  }

  // Timing-safe comparison
  const a = Buffer.from(String(password), "utf8");
  const b = Buffer.from(String(ADMIN_PASSWORD), "utf8");
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a); // Constant-time dummy
    createAuditEvent({
      actorType: "admin",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "auth",
      action: "admin_login",
      outcome: "failure",
      metadata: { reason: "invalid_password" },
    });
    return res.status(401).json({ error: "Invalid password" });
  }
  if (!crypto.timingSafeEqual(a, b)) {
    createAuditEvent({
      actorType: "admin",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "auth",
      action: "admin_login",
      outcome: "failure",
      metadata: { reason: "invalid_password" },
    });
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
  createAuditEvent({
    actorUserId: linkedUserSession?.id || null,
    actorUsername: linkedUserSession?.username || null,
    actorType: "admin",
    ipAddress: req.ip || null,
    userAgent: req.get("user-agent") || null,
    category: "auth",
    action: "admin_login",
    targetType: "admin_session",
    outcome: "success",
  });
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
  res.json({
    ...base,
    database: {
      path: path.relative(path.join(__dirname, "..", ".."), DB_PATH),
      sizeBytes: dbStat?.size || 0,
      migrations: listSchemaMigrations(),
      latestMigration: listSchemaMigrations().slice(-1)[0]?.id || null,
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

// POST /admin/api/backup/export
router.post("/api/backup/export", requireAdmin, async (req, res) => {
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
router.post("/api/settings/share", requireAdmin, (req, res) => {
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
    timeoutMs: config.timeoutMs,
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
router.post("/api/settings/redsecai", requireAdmin, (req, res) => {
  const enabled = req.body?.enabled !== false;
  const baseUrl = String(req.body?.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(req.body?.model || "").trim();
  const timeoutMs = parseInt(req.body?.timeoutMs, 10);
  const autostart = req.body?.autostart === true;
  const autoPull = req.body?.autoPull !== false;

  if (!/^https?:\/\/[A-Za-z0-9._:-]+$/i.test(baseUrl)) {
    return res.status(400).json({ error: "RedSecAI base URL must be an http(s) origin without a path" });
  }
  if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    return res.status(400).json({ error: "RedSecAI model name is invalid" });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 600000) {
    return res.status(400).json({ error: "RedSecAI timeout must be between 5000 and 600000 ms" });
  }

  setSetting("redsecai_enabled", enabled ? "true" : "false");
  setSetting("redsecai_base_url", baseUrl);
  setSetting("redsecai_model", model);
  setSetting("redsecai_timeout_ms", String(timeoutMs));
  setSetting("redsecai_autostart", autostart ? "true" : "false");
  setSetting("redsecai_auto_pull", autoPull ? "true" : "false");

  auditAdmin(req, {
    category: "settings",
    action: "redsecai_update",
    targetType: "redsecai_settings",
    metadata: { enabled, baseUrl, model, timeoutMs, autostart, autoPull },
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
router.delete("/api/paste/:id", requireAdmin, (req, res) => {
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
router.delete("/api/file/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid file ID" });
  }

  deleteFile(id);
  auditAdmin(req, { category: "content", action: "share_delete", targetType: "share", targetId: id });
  res.json({ success: true });
});

// DELETE /admin/api/survey/:id
router.delete("/api/survey/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid survey ID" });
  }

  deleteSurveyById(id);
  auditAdmin(req, { category: "content", action: "survey_delete", targetType: "survey", targetId: id });
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
  auditAdmin(req, { category: "content", action: "paste_bulk_delete", targetType: "paste", metadata: { count: ids.length, deleted } });
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
  auditAdmin(req, { category: "identity", action: "user_update", targetType: "user", targetId: id, metadata: { emailChanged: !!(email && email !== user.email), usernameChanged: !!(username && username !== user.username) } });

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
  auditAdmin(req, { category: "identity", action: "user_suspend", targetType: "user", targetId: req.params.id });
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
  auditAdmin(req, { category: "identity", action: "user_unsuspend", targetType: "user", targetId: req.params.id });
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "admin:unsuspend_user", ip: req.ip, userId: req.params.id }));
  res.json({ success: true });
});

// DELETE /admin/api/users/:id
router.delete("/api/users/:id", requireAdmin, (req, res) => {
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
router.post("/api/users/:id/reset-password", requireAdmin, async (req, res) => {
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
router.post("/api/invites", requireAdmin, async (req, res) => {
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
router.delete("/api/invites/:id", requireAdmin, (req, res) => {
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

router.post("/api/settings/calendar", requireAdmin, (req, res) => {
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

router.put("/api/vaults/:id/members/:userId", requireAdmin, (req, res) => {
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

router.delete("/api/vaults/:id/members/:userId", requireAdmin, (req, res) => {
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

  auditAdmin(req, {
    category: "settings",
    action: "security_update",
    targetType: "security_settings",
    metadata: {
      sessionTTL,
      sessionTTLExtended,
      mfaRememberDays,
      mfaRequired: mfaRequired !== undefined ? !!mfaRequired : undefined,
    },
  });
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
router.post("/api/settings/weather", requireAdmin, (req, res) => {
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
router.post("/api/shortcuts/team", requireAdmin, async (req, res) => {
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
router.put("/api/shortcuts/team/:id", requireAdmin, async (req, res) => {
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
router.delete("/api/shortcuts/team/:id", requireAdmin, (req, res) => {
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

router.post("/api/shortcuts/team/upload-icon", requireAdmin, teamIconUpload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file uploaded" });
  if (!file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Only image files" });

  try {
    const id = crypto.randomBytes(16).toString("base64url");
    const sharp = require("sharp");
    const buffer = await sharp(file.buffer).resize(64, 64, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
    const iconsDir = path.join(__dirname, "..", "..", "data", "shortcut-icons");
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
    fs.writeFileSync(path.join(iconsDir, `${id}.webp`), buffer);
    res.json({ url: `/api/homepage/shortcut-icon/${id}` });
  } catch {
    res.status(500).json({ error: "Failed to process image" });
  }
});

module.exports = {
  router,
  requireAdmin,
};
