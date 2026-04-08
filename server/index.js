require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const pasteRouter = require("./routes/paste");
const shareRouter = require("./routes/share");
const adminRouter = require("./routes/admin");
const authRouter = require("./routes/auth");
const chatRouter = require("./routes/chat");
const avatarRouter = require("./routes/avatar");
const { initWebSocket } = require("./chat-ws");
const {
  deleteExpired, deleteExpiredFiles,
  deleteExpiredSessions, deleteExpiredInvites,
  deleteExpiredGuestLinks, deleteExpiredPasswordResets,
  deleteExpiredMessages,
} = require("./database");
const { pageRequireUser, pageRequireGuestOrUser } = require("./middleware/auth");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
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
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
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

// --- Admin routes ---
app.use("/admin", adminRouter);

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
  if (shareRouter.cleanupTmp) shareRouter.cleanupTmp();
  const total = pastes + files + sessions + invites + guestLinks + passwordResets + messages;
  if (total > 0) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "cleanup", pastes, files, sessions, invites, guestLinks, passwordResets, messages }));
  }
}, 10 * 60 * 1000);

// --- Start ---
const server = http.createServer(app);
initWebSocket(server);
server.listen(PORT, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "start", port: PORT, name: "RedSecTools" }));
});

module.exports = { server };
