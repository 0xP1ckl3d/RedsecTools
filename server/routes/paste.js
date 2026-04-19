const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { createPaste, getPaste, VALID_EXPIRY_OPTIONS, VALID_SYNTAX_OPTIONS, redeemGuestLink } = require("../database");
const { requireGuestOrUserFor } = require("../middleware/auth");
const { decodeBase64Strict } = require("../base64");

const router = Router();

// Rate limits
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: "Too many pastes created. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const readLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Validation helpers ---

const MAX_CIPHERTEXT_SIZE = 512 * 1024; // 512KB decoded

function validateBase64Field(value, name, requiredLength) {
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

function toBase64(buffer) {
  if (!buffer) return null;
  return Buffer.from(buffer).toString("base64");
}

// --- Logging ---

function logAction(action, req, extra = {}) {
  const ip = req.ip || req.connection?.remoteAddress;
  console.log(JSON.stringify({ ts: new Date().toISOString(), action, ip, ...extra }));
}

// --- Routes ---

// POST /api/paste
router.post("/paste", createLimiter, requireGuestOrUserFor("paste"), (req, res) => {
  const { ciphertext, iv, ivPassword, salt, hasPassword, burnAfterReading, expiresIn, syntax } = req.body;

  // Validate required fields
  if (!ciphertext || !iv) {
    return res.status(400).json({ error: "Missing required fields: ciphertext, iv" });
  }

  // Validate types
  for (const [field, val] of Object.entries({ ciphertext, iv })) {
    if (typeof val !== "string") {
      return res.status(400).json({ error: `${field} must be a string` });
    }
  }

  // Validate IV is exactly 12 bytes
  const ivErr = validateBase64Field(iv, "iv", 12);
  if (ivErr) return res.status(400).json({ error: ivErr });

  // Validate ciphertext is valid base64 and within size limit
  const ctErr = validateBase64Field(ciphertext, "ciphertext");
  if (ctErr) return res.status(400).json({ error: ctErr });

  const ctDecoded = decodeBase64Strict(ciphertext);
  if (ctDecoded.length > MAX_CIPHERTEXT_SIZE) {
    return res.status(413).json({ error: "Ciphertext too large (max 512KB)" });
  }

  // Validate password fields when present
  if (hasPassword) {
    if (!ivPassword || !salt) {
      return res.status(400).json({ error: "Missing required fields for password-protected paste: ivPassword, salt" });
    }
    const ivpErr = validateBase64Field(ivPassword, "ivPassword", 12);
    if (ivpErr) return res.status(400).json({ error: ivpErr });

    const saltErr = validateBase64Field(salt, "salt", 16);
    if (saltErr) return res.status(400).json({ error: saltErr });
  }

  // Validate expiry
  if (!VALID_EXPIRY_OPTIONS.includes(expiresIn)) {
    return res.status(400).json({ error: "Invalid expiration value" });
  }

  // Validate syntax
  const safeSyntax = VALID_SYNTAX_OPTIONS.includes(syntax) ? syntax : "plaintext";

  const id = crypto.randomBytes(16).toString("base64url");

  // Redeem guest token atomically before creation
  if (req.guest) {
    const redeemed = redeemGuestLink(req.guest.token);
    if (!redeemed) {
      res.clearCookie("redsec_guest", { path: "/" });
      return res.status(401).json({ error: "Guest link has already been used or expired" });
    }
  }

  try {
    const paste = createPaste({
      id,
      ciphertext,
      iv,
      ivPassword: hasPassword ? ivPassword : null,
      salt: hasPassword ? salt : null,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn,
      sourceIp: req.ip,
      syntax: safeSyntax,
      userId: req.user ? req.user.id : null,
      guestInvitedBy: req.guest ? req.guest.invitedBy : null,
    });

    logAction("paste:create", req, { id, hasPassword: !!hasPassword, burnAfterReading: !!burnAfterReading, expiresIn });

    // Clear guest cookie after successful creation
    if (req.guest) {
      res.clearCookie("redsec_guest", { path: "/" });
    }

    res.status(201).json({ id: paste.id });
  } catch (err) {
    logAction("paste:create_error", req, { error: err.message });
    res.status(500).json({ error: "Failed to create paste" });
  }
});

// GET /api/paste/:id
router.get("/paste/:id", readLimiter, (req, res) => {
  const { id } = req.params;

  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid paste ID" });
  }

  const paste = getPaste(id);

  if (!paste) {
    logAction("paste:not_found", req, { id });
    return res.status(404).json({ error: "Paste not found" });
  }

  if (paste.expired) {
    logAction("paste:expired", req, { id });
    return res.status(410).json({ error: "Paste has expired" });
  }

  logAction("paste:read", req, { id, burned: !!paste.burned });

  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");

  res.json({
    id: paste.id,
    ciphertext: toBase64(paste.ciphertext),
    iv: toBase64(paste.iv),
    ivPassword: toBase64(paste.iv_password),
    salt: toBase64(paste.salt),
    hasPassword: !!paste.has_password,
    burned: !!paste.burned,
    syntax: paste.syntax || "plaintext",
  });
});

module.exports = router;
