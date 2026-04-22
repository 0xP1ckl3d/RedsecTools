require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
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
const adminCollabRouter = require("./routes/admin-collab");
const { runBulletinAutoPurge } = require("./bulletin-service");
const { initWebSocket } = require("./chat-ws");
const {
  deleteExpired, deleteExpiredFiles,
  deleteExpiredSessions, deleteExpiredInvites,
  deleteExpiredGuestLinks, deleteExpiredPasswordResets,
  deleteExpiredMessages, deleteExpiredVaultShares,
  deleteExpiredPendingLogins, deleteExpiredTrustedDevices, deleteExpiredAdminSessions, deleteExpiredExtensionSessions,
} = require("./database");
const { pageRequireUser, pageRequireGuestOrUser } = require("./middleware/auth");
const { pageRequirePermission, pageRequireAnyPermission } = require("./middleware/permissions");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (!COOKIE_SECRET || COOKIE_SECRET === "default-secret-change-me") {
  console.error("FATAL: COOKIE_SECRET must be set in .env and must not be the default value");
  process.exit(1);
}

// Trust first proxy (for X-Forwarded-For header)
app.set("trust proxy", 1);

// --- Security headers ---
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:", "https://api.open-meteo.com", "https://geocoding-api.open-meteo.com"],
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
app.use(cookieParser(COOKIE_SECRET));

// --- Static files ---
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

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
app.use("/api/ext", extensionRouter);
app.use("/api/homepage", homepageRouter);
app.use("/api/homepage", homepageDashboardRouter);

// --- Admin routes ---
app.use("/admin", adminRouter);
app.use("/admin", adminCollabRouter);

// --- Page routes ---
const page = (file) => path.join(__dirname, "..", "public", file);

// Public pages (no auth needed)
app.get("/login", (req, res) => res.sendFile(page("login.html")));
app.get("/register", (req, res) => res.sendFile(page("register.html")));
app.get("/forgot-password", (req, res) => res.sendFile(page("forgot-password.html")));
app.get("/reset-password", (req, res) => res.sendFile(page("reset-password.html")));
app.get("/p/:id", (req, res) => res.sendFile(page("paste/view.html")));
app.get("/s/:id", (req, res) => res.sendFile(page("share/view.html")));
app.get("/paste/about", (req, res) => res.sendFile(page("paste/about.html")));
app.get("/share/about", (req, res) => res.sendFile(page("share/about.html")));

// Auth-gated pages (server-side redirect if not authenticated)
app.get("/", pageRequireUser, (req, res) => res.sendFile(page("index.html")));
app.get("/profile", pageRequireUser, (req, res) => res.sendFile(page("profile.html")));
app.get("/paste", pageRequireGuestOrUser("paste"), (req, res) => res.sendFile(page("paste/index.html")));
app.get("/share", pageRequireGuestOrUser("share"), (req, res) => res.sendFile(page("share/index.html")));
app.get("/chat", pageRequireUser, (req, res) => res.sendFile(page("chat/index.html")));
app.get("/chat/about", (req, res) => res.sendFile(page("chat/about.html")));
app.get("/vault", pageRequireUser, (req, res) => res.sendFile(page("vault/index.html")));
app.get("/vault/about", (req, res) => res.sendFile(page("vault/about.html")));
app.get("/calendar", pageRequireUser, pageRequirePermission("calendar.view"), (req, res) => res.sendFile(page("calendar/index.html")));
app.get("/calendar/about", (req, res) => res.sendFile(page("calendar/about.html")));
app.get("/survey", pageRequireUser, pageRequireAnyPermission(["survey.create", "survey.manage_any", "survey.view_results_any"]), (req, res) => res.sendFile(page("survey/index.html")));
app.get("/survey/about", (req, res) => res.sendFile(page("survey/about.html")));
app.get("/survey/r/:token", (req, res) => res.sendFile(page("survey/respond.html")));
app.get("/wiki", pageRequireUser, pageRequirePermission("wiki.view"), (req, res) => res.sendFile(page("wiki/index.html")));
app.get("/wiki/about", (req, res) => res.sendFile(page("wiki/about.html")));
app.get("/admin", (req, res) => res.sendFile(page("admin.html")));

// Guest link redemption
app.get("/guest/:token", authRouter.getGuestRedirect);

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
  const bulletinPurge = runBulletinAutoPurge();
  if (shareRouter.cleanupTmp) shareRouter.cleanupTmp();
  const total = pastes + files + sessions + invites + guestLinks + passwordResets + messages + vaultShares + pendingLogins + trustedDevices + adminSessions + extensionSessions + bulletinPurge.deletedBulletins + bulletinPurge.deletedAssets;
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
      bulletinPurge,
    }));
  }
}, 10 * 60 * 1000);

// --- Start ---
const server = http.createServer(app);
initWebSocket(server);
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "start", host: HOST, port: PORT, name: "RedSecTools" }));
});

module.exports = { server };
