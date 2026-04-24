const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { requireUser } = require("../middleware/auth");
const { AVATARS_DIR, updateAvatarTimestamp, clearAvatarTimestamp } = require("../database");

const router = Router();

// Rate limits
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many avatar uploads. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Multer config — memory storage for image processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// --- Logging ---

function logAction(action, req, extra = {}) {
  const ip = req.ip || req.connection?.remoteAddress;
  console.log(JSON.stringify({ ts: new Date().toISOString(), action, ip, ...extra }));
}

// --- Routes ---

// POST /api/avatar — Upload/replace avatar
router.post("/avatar", uploadLimiter, requireUser, upload.single("avatar"), async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (!file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Only image files are allowed" });
  }

  try {
    const buffer = await sharp(file.buffer)
      .resize(128, 128, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const avatarPath = path.join(AVATARS_DIR, `${req.user.id}.webp`);
    fs.writeFileSync(avatarPath, buffer);

    updateAvatarTimestamp(req.user.id);

    logAction("avatar:upload", req, { userId: req.user.id });

    res.json({ success: true });
  } catch (err) {
    logAction("avatar:upload_error", req, { userId: req.user.id, error: err.message });
    res.status(500).json({ error: "Failed to process avatar" });
  }
});

// DELETE /api/avatar — Delete avatar
router.delete("/avatar", deleteLimiter, requireUser, (req, res) => {
  const avatarPath = path.join(AVATARS_DIR, `${req.user.id}.webp`);

  try {
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }
  } catch {}

  clearAvatarTimestamp(req.user.id);

  logAction("avatar:delete", req, { userId: req.user.id });

  res.json({ success: true });
});

// GET /avatar/:id — Serve avatar (authenticated only)
router.get("/avatar/:id", requireUser, (req, res) => {
  const userId = req.params.id.replace(/\.webp$/, "");

  if (!/^[A-Za-z0-9_-]{22}$/.test(userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  const avatarPath = path.join(AVATARS_DIR, `${userId}.webp`);

  if (!fs.existsSync(avatarPath)) {
    return res.status(404).json({ error: "Avatar not found" });
  }

  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", "public, max-age=3600");

  const stream = fs.createReadStream(avatarPath);
  stream.pipe(res);
});

module.exports = router;
