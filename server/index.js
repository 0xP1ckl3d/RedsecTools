require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const pasteRouter = require("./routes/paste");
const shareRouter = require("./routes/share");
const { router: adminRouter } = require("./routes/admin");
const authRouter = require("./routes/auth");
const chatRouter = require("./routes/chat");
const avatarRouter = require("./routes/avatar");
const vaultRouter = require("./routes/vault");
const extensionRouter = require("./routes/extension");
const { router: homepageRouter } = require("./routes/homepage");
const homepageDashboardRouter = require("./routes/homepage-dashboard");
const calendarRouter = require("./routes/calendar");
const surveyRouter = require("./routes/survey");
const wikiRouter = require("./routes/wiki");
const threatRouter = require("./routes/threat");
const reporterRouter = require("./routes/reporter");
const adminCollabRouter = require("./routes/admin-collab");
const redsecAiRouter = require("./routes/redsecai");
const notificationRouter = require("./routes/notifications");
const engageRouter = require("./routes/engage");
const integrationsRouter = require("./routes/integrations");
const minitoolsRouter = require("./routes/minitools");
const { captureRequest, cleanupExpiredCallbacks } = require("./core/minitools/callback");
const { runBulletinAutoPurge } = require("./bulletin-service");
const { startFeedFetchInterval, seedDefaults: seedThreatDefaults } = require("./threat-feed-service");
const { initWebSocket } = require("./chat-ws");
const { initRedSecAiWebSocket } = require("./redsecai-ws");
const { initNotificationWebSocket } = require("./notification-ws");
const { initCallbackWebSocket } = require("./callback-ws");
const {
  deleteExpired, deleteExpiredFiles,
  deleteExpiredSessions, deleteExpiredInvites,
  deleteExpiredGuestLinks, deleteExpiredPasswordResets,
  deleteExpiredMessages, deleteExpiredVaultShares,
  deleteExpiredPendingLogins, deleteExpiredTrustedDevices, deleteExpiredAdminSessions, deleteExpiredExtensionSessions,
  closeExpiredSurveys, cleanupOldThreatAlerts, cleanupOldThreatArticles, getSetting,
  deleteExpiredNotifications,
  BRAND_DIR,
  db,
  listSchemaMigrations,
} = require("./database");
const { pageRequireUser, pageRequireGuestOrUser } = require("./middleware/auth");
const { pageRequirePermission, pageRequireAnyPermission } = require("./middleware/permissions");
const { buildDeploymentWarnings } = require("./core/security/posture");
const { logWarn } = require("./core/logger");
const { startWebhookWorker } = require("./core/integrations/webhooks");
const { startLolLookupSyncScheduler } = require("./core/minitools/lol-lookup");
const redsecAiProvider = require("./modules/redsecai/provider");
const database = require("./database");

const rateLimit = require("express-rate-limit");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET || COOKIE_SECRET === "default-secret-change-me") {
  console.error("FATAL: COOKIE_SECRET must be set in .env and must not be the default value");
  process.exit(1);
}

function resolveTrustProxySetting(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return 1;
  }

  const parsed = parseInt(normalized, 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return value;
}

// Only trust proxy headers when explicitly configured.
app.set("trust proxy", resolveTrustProxySetting(process.env.TRUST_PROXY));

// --- Security headers ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"],
        frameSrc: ["'self'", "blob:"],
        fontSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://www.google.com"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts: false,
  }),
);

// --- Middleware ---
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser(COOKIE_SECRET));

const page = (file) => path.join(__dirname, "..", "public", file);

function readinessChecks() {
  const checks = {};
  try {
    db.prepare("SELECT 1 AS ok").get();
    checks.database = "ok";
  } catch {
    checks.database = "failed";
  }
  return checks;
}

app.get("/healthz", (req, res) => {
  res.json({
    status: "ok",
    name: "RedSecTools",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get("/readyz", (req, res) => {
  const checks = readinessChecks();
  const ready = Object.values(checks).every((status) => status === "ok");
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "degraded",
    checks,
    migrations: {
      latest: listSchemaMigrations().slice(-1)[0]?.id || null,
    },
    timestamp: new Date().toISOString(),
  });
});

function pageRequireRedSecAiEnabled(req, res, next) {
  if (redsecAiProvider.getConfig().enabled) return next();
  return res.status(404).sendFile(page("error.html"));
}

app.get("/ai/index.html", pageRequireUser, pageRequireRedSecAiEnabled, (req, res) => res.sendFile(page("ai/index.html")));

function runPageMiddlewares(middlewares) {
  return (req, res, next) => {
    let index = 0;
    function run(err) {
      if (err) return next(err);
      const middleware = middlewares[index++];
      if (!middleware) return next();
      return middleware(req, res, run);
    }
    return run();
  };
}

const protectedStaticPageRoutes = new Map([
  ["/index.html", runPageMiddlewares([pageRequireUser])],
  ["/paste/index.html", runPageMiddlewares([pageRequireGuestOrUser("paste")])],
  ["/share/index.html", runPageMiddlewares([pageRequireGuestOrUser("share")])],
  ["/chat/index.html", runPageMiddlewares([pageRequireUser])],
  ["/vault/index.html", runPageMiddlewares([pageRequireUser])],
  ["/calendar/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["calendar.view", "calendar.view_team", "calendar.manage"])])],
  ["/survey/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["survey.create", "survey.manage_any", "survey.view_results_any"])])],
  ["/survey/results.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["survey.create", "survey.manage_any", "survey.view_results_any"])])],
  ["/wiki/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"])])],
  ["/threat/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["threat.view", "threat.manage"])])],
  ["/reporter/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"])])],
  ["/ai/index.html", runPageMiddlewares([pageRequireUser, pageRequireRedSecAiEnabled])],
  ["/engage/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["engage.view_own", "engage.view_team", "engage.view_all", "engage.manage_all"])])],
  ["/minitools/index.html", runPageMiddlewares([pageRequireUser, pageRequireAnyPermission(["minitools.view"])])],
]);

app.use((req, res, next) => {
  const pathname = (() => {
    try {
      return decodeURIComponent(new URL(req.originalUrl || req.url, "http://redsectools.local").pathname);
    } catch {
      return req.path;
    }
  })();
  const protect = protectedStaticPageRoutes.get(pathname);
  if (!protect) return next();
  return protect(req, res, next);
});

// --- Custom brand logo / favicon override (before static middleware) ---
const BRAND_FAVICON_PATH = path.join(BRAND_DIR, "favicon.png");
const BRAND_LOGO_PATH = path.join(BRAND_DIR, "logo.webp");
const DEFAULT_FAVICON_PATH = path.join(__dirname, "..", "public", "assets", "favicon.ico");

app.get("/assets/favicon.ico", (req, res) => {
  if (fs.existsSync(BRAND_FAVICON_PATH)) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache");
    return fs.createReadStream(BRAND_FAVICON_PATH).pipe(res);
  }
  res.sendFile(DEFAULT_FAVICON_PATH);
});

app.get("/brand-logo.webp", (req, res) => {
  if (!fs.existsSync(BRAND_LOGO_PATH)) return res.status(404).send("Not found");
  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", "no-cache");
  fs.createReadStream(BRAND_LOGO_PATH).pipe(res);
});

// --- Static files ---
app.use(express.static(path.join(__dirname, "..", "public"), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith(`${path.sep}admin.js`) || filePath.endsWith(`${path.sep}admin.html`)) {
      res.setHeader("Cache-Control", "no-store");
      return;
    }
    if (filePath.endsWith(".css") || filePath.endsWith(".js") || filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));

const SITE_PRIMARY_THEMES = new Set(["red", "green", "blue", "orange", "purple"]);
app.get("/api/site-theme", (req, res) => {
  const primaryTheme = String(getSetting("site_primary_theme") || "red").trim().toLowerCase();
  const customHex = String(getSetting("site_custom_theme_hex") || "").trim();
  const brandPrefix = String(getSetting("site_brand_prefix") || "").trim();
  const theme = primaryTheme === "custom" && /^#[0-9A-Fa-f]{6}$/.test(customHex) ? "custom" : (SITE_PRIMARY_THEMES.has(primaryTheme) ? primaryTheme : "red");
  const hasBrandLogo = getSetting("site_brand_logo") === "true" && fs.existsSync(BRAND_LOGO_PATH);
  const brandLogoVersion = hasBrandLogo ? (getSetting("site_brand_logo_version") || "1") : "";
  res.json({ primaryTheme: theme, customHex: theme === "custom" ? customHex : "", brandPrefix, hasBrandLogo, brandLogoVersion });
});

// --- API routes ---
app.use("/api", pasteRouter);
app.use("/api", shareRouter);
app.use("/api", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api", avatarRouter);
app.use("/api", vaultRouter);
app.use("/api", calendarRouter);
app.use("/api", surveyRouter);
app.use("/api", wikiRouter);
app.use("/api", threatRouter);
app.use("/api", reporterRouter);
app.use("/api", redsecAiRouter);
app.use("/api", notificationRouter);
app.use("/api", engageRouter);
app.use("/api", integrationsRouter);
app.use("/api", minitoolsRouter);
app.use("/api/ext", extensionRouter);
app.use("/api/homepage", homepageRouter);
app.use("/api/homepage", homepageDashboardRouter);

// --- Admin routes ---
app.use("/admin", adminRouter);
app.use("/admin", adminCollabRouter);

// --- Page routes ---
// Public pages (no auth needed)
app.get("/login", (req, res) => res.sendFile(page("login.html")));
app.get("/register", (req, res) => res.sendFile(page("register.html")));
app.get("/forgot-password", (req, res) => res.sendFile(page("forgot-password.html")));
app.get("/reset-password", (req, res) => res.sendFile(page("reset-password.html")));
app.get("/p/:id", (req, res) => res.sendFile(page("paste/view.html")));
app.get("/s/:id", (req, res) => res.sendFile(page("share/view.html")));

// Auth-gated pages (server-side redirect if not authenticated)
app.get("/", pageRequireUser, (req, res) => res.sendFile(page("index.html")));
app.get("/profile", pageRequireUser, (req, res) => res.redirect("/?view=profile"));
app.get("/paste", pageRequireGuestOrUser("paste"), (req, res) => res.sendFile(page("paste/index.html")));
app.get("/share", pageRequireGuestOrUser("share"), (req, res) => res.sendFile(page("share/index.html")));
app.get("/chat", pageRequireUser, (req, res) => res.sendFile(page("chat/index.html")));
app.get("/vault", pageRequireUser, (req, res) => res.sendFile(page("vault/index.html")));
app.get("/calendar", pageRequireUser, pageRequireAnyPermission(["calendar.view", "calendar.view_team", "calendar.manage"]), (req, res) => res.sendFile(page("calendar/index.html")));
app.get("/survey", pageRequireUser, pageRequireAnyPermission(["survey.create", "survey.manage_any", "survey.view_results_any"]), (req, res) => res.sendFile(page("survey/index.html")));
app.get("/survey/results", pageRequireUser, pageRequireAnyPermission(["survey.create", "survey.manage_any", "survey.view_results_any"]), (req, res) => res.sendFile(page("survey/results.html")));
app.get("/survey/r/:token", (req, res) => res.sendFile(page("survey/respond.html")));
app.get("/wiki", pageRequireUser, pageRequireAnyPermission(["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"]), (req, res) => res.sendFile(page("wiki/index.html")));
app.get("/threat", pageRequireUser, pageRequireAnyPermission(["threat.view", "threat.manage"]), (req, res) => res.sendFile(page("threat/index.html")));
app.get("/reporter", pageRequireUser, pageRequireAnyPermission(["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"]), (req, res) => res.sendFile(page("reporter/index.html")));
app.get(["/ai", "/ai/"], pageRequireUser, pageRequireRedSecAiEnabled, (req, res) => res.sendFile(page("ai/index.html")));
app.get("/engage", pageRequireUser, pageRequireAnyPermission(["engage.view_own", "engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => res.sendFile(page("engage/index.html")));
app.get("/minitools", pageRequireUser, pageRequireAnyPermission(["minitools.view"]), (req, res) => res.sendFile(page("minitools/index.html")));
app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(page("admin.html"));
});

// Guest link redemption
app.get("/guest/:token", authRouter.getGuestRedirect);

// --- Callback listener (public, no auth) ---
const callbackCaptureLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const id = req.params.id;
    return !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  },
});

const cbCaptureMiddleware = [express.text({ type: "*/*", limit: "512kb" }), callbackCaptureLimiter];

function handleCallbackCapture(req, res) {
  const { id } = req.params;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(404).sendFile(page("error.html"));
  }
  const baseUrl = `/cb/${id}`;
  req.path = req.originalUrl.slice(baseUrl.length).split("?")[0] || "/";
  const result = captureRequest(id, req);
  if (!result.captured) {
    return res.status(404).sendFile(page("error.html"));
  }
  res.status(200).send("OK");
}

app.all("/cb/:id", cbCaptureMiddleware, handleCallbackCapture);
app.all("/cb/:id/*", cbCaptureMiddleware, handleCallbackCapture);

// --- Custom error pages ---
app.use((req, res) => {
  res.status(404).sendFile(page("error.html"));
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).sendFile(page("error.html"));
});

// --- Expired content cleanup (every 10 minutes) ---
setInterval(() => {
  const pastes = deleteExpired();
  const files = deleteExpiredFiles();
  const sessions = deleteExpiredSessions();
  const invites = deleteExpiredInvites();
  const guestLinks = deleteExpiredGuestLinks();
  const passwordResets = deleteExpiredPasswordResets();
  const messages = deleteExpiredMessages();
  const vaultShares = deleteExpiredVaultShares();
  const pendingLogins = deleteExpiredPendingLogins();
  const trustedDevices = deleteExpiredTrustedDevices();
  const adminSessions = deleteExpiredAdminSessions();
  const extensionSessions = deleteExpiredExtensionSessions();
  const expiredSurveys = closeExpiredSurveys();
  const bulletinPurge = runBulletinAutoPurge();
  const parsedThreatRetentionDays = parseInt(getSetting("threat_alert_retention_days"), 10);
  const threatRetentionDays = Number.isFinite(parsedThreatRetentionDays) && parsedThreatRetentionDays > 0
    ? parsedThreatRetentionDays
    : 14;
  const threatAlerts = cleanupOldThreatAlerts(threatRetentionDays);
  const threatArticles = cleanupOldThreatArticles(threatRetentionDays);
  const expiredNotifications = deleteExpiredNotifications();
  const callbackCleanup = cleanupExpiredCallbacks();
  if (shareRouter.cleanupTmp) shareRouter.cleanupTmp();
  const total = pastes + files + sessions + invites + guestLinks + passwordResets + messages + vaultShares + pendingLogins + trustedDevices + adminSessions + extensionSessions + expiredSurveys + bulletinPurge.deletedBulletins + bulletinPurge.deletedAssets + threatAlerts + threatArticles + expiredNotifications + callbackCleanup;
  if (total > 0) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      action: "cleanup",
      pastes,
      files,
      sessions,
      invites,
      guestLinks,
      passwordResets,
      messages,
      vaultShares,
      pendingLogins,
      trustedDevices,
      adminSessions,
      extensionSessions,
      expiredSurveys,
      threatRetentionDays,
      threatAlerts,
      threatArticles,
      expiredNotifications,
      callbackCleanup,
      bulletinPurge,
    }));
  }
}, 10 * 60 * 1000);

// --- Start ---
const server = http.createServer(app);
initWebSocket(server);
initRedSecAiWebSocket(server);
initNotificationWebSocket(server);
initCallbackWebSocket(server);
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "start", host: HOST, port: PORT, name: "RedSecTools" }));
  for (const warning of buildDeploymentWarnings({ host: HOST })) {
    logWarn("deployment:posture_warning", warning);
  }
  redsecAiProvider.ensureLocalModelService().catch((error) => {
    logWarn("redsecai:autostart_failed", { message: error.message });
  });
  seedThreatDefaults();
  startFeedFetchInterval();
  startWebhookWorker(database);
  startLolLookupSyncScheduler(database.db, { getSetting: database.getSetting });
});

module.exports = { server };
