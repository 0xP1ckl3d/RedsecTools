const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { createShare, getShare, getShareFile, deleteShareFile, VALID_EXPIRY_OPTIONS, TMP_DIR, FILES_DIR, redeemGuestLink } = require("../database");
const { requireGuestOrUserFor } = require("../middleware/auth");
const { decodeBase64Strict } = require("../base64");

const router = Router();

// Rate limits
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many uploads. Try again later." },
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

// Multer config — temp storage for multiple files
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex")),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
});

// --- Validation helpers ---

const MIME_REGEX = /^[a-z0-9][a-z0-9!#$&\-^_.+]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/i;
const MAX_MIME_LENGTH = 128;

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

// --- Cleanup temp files older than 1 hour ---
function cleanupTmp() {
  const now = Date.now();
  try {
    const entries = fs.readdirSync(TMP_DIR);
    for (const entry of entries) {
      const fullPath = path.join(TMP_DIR, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > 60 * 60 * 1000) {
          fs.unlinkSync(fullPath);
        }
      } catch {}
    }
  } catch {}
}

// --- Routes ---

// POST /api/share — multi-file upload
router.post("/share", uploadLimiter, requireGuestOrUserFor("share"), upload.array("files", 20), (req, res) => {
  const uploadedFiles = req.files;
  const metadataStr = req.body.metadata;

  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }

  if (!metadataStr) {
    cleanupFiles(uploadedFiles);
    return res.status(400).json({ error: "Missing metadata" });
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    cleanupFiles(uploadedFiles);
    return res.status(400).json({ error: "Invalid metadata JSON" });
  }

  const { expiresIn, hasPassword, burnAfterReading, salt, files: fileMeta } = metadata;

  // Validate expiry
  const expiresInNum = parseInt(expiresIn, 10);
  if (!VALID_EXPIRY_OPTIONS.includes(expiresInNum)) {
    cleanupFiles(uploadedFiles);
    return res.status(400).json({ error: "Invalid expiration value" });
  }

  // Validate file count matches
  if (!Array.isArray(fileMeta) || fileMeta.length !== uploadedFiles.length) {
    cleanupFiles(uploadedFiles);
    return res.status(400).json({ error: "File metadata count mismatch" });
  }

  // Validate password fields
  if (hasPassword) {
    if (!salt) {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ error: "Missing salt for password-protected share" });
    }
    const saltErr = validateBase64Field(salt, "salt", 16);
    if (saltErr) { cleanupFiles(uploadedFiles); return res.status(400).json({ error: saltErr }); }
  }

  // Validate each file's metadata
  for (let i = 0; i < fileMeta.length; i++) {
    const fm = fileMeta[i];
    const ivErr = validateBase64Field(fm.iv, `file[${i}].iv`, 12);
    if (ivErr) { cleanupFiles(uploadedFiles); return res.status(400).json({ error: ivErr }); }

    const fnIvErr = validateBase64Field(fm.filenameIv, `file[${i}].filenameIv`, 12);
    if (fnIvErr) { cleanupFiles(uploadedFiles); return res.status(400).json({ error: fnIvErr }); }

    // Validate encrypted filename — just check it's valid base64, minimum 17 bytes (1 byte plaintext + 16 GCM tag)
    try {
      const decoded = decodeBase64Strict(fm.encryptedFilename);
      if (decoded.length < 17 || decoded.length > 512) {
        cleanupFiles(uploadedFiles);
        return res.status(400).json({ error: `file[${i}].encryptedFilename decoded size must be 17-512 bytes (got ${decoded.length})` });
      }
    } catch {
      cleanupFiles(uploadedFiles);
      return res.status(400).json({ error: `file[${i}].encryptedFilename is not valid base64` });
    }

    // Validate MIME type
    const safeMime = typeof fm.mimeType === "string" && fm.mimeType.length <= MAX_MIME_LENGTH && MIME_REGEX.test(fm.mimeType)
      ? fm.mimeType
      : "application/octet-stream";
    fm.mimeType = safeMime;

    // Password: validate per-file ivPassword if present
    if (hasPassword && fm.ivPassword) {
      const ivpErr = validateBase64Field(fm.ivPassword, `file[${i}].ivPassword`, 12);
      if (ivpErr) { cleanupFiles(uploadedFiles); return res.status(400).json({ error: ivpErr }); }
    }
  }

  const shareId = crypto.randomBytes(16).toString("base64url");

  // Redeem guest token atomically before creation
  if (req.guest) {
    const redeemed = redeemGuestLink(req.guest.token);
    if (!redeemed) {
      cleanupFiles(uploadedFiles);
      res.clearCookie("redsec_guest", { path: "/" });
      return res.status(401).json({ error: "Guest link has already been used or expired" });
    }
  }

  try {
    // Move temp files to final location and build file records
    const fileRecords = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const uf = uploadedFiles[i];
      const fm = fileMeta[i];
      const fileId = crypto.randomBytes(16).toString("base64url");
      const finalPath = path.join(FILES_DIR, `${fileId}.enc`);

      fs.renameSync(uf.path, finalPath);

      fileRecords.push({
        id: fileId,
        encryptedFilename: fm.encryptedFilename,
        filenameIv: fm.filenameIv,
        fileSize: fm.fileSize || uf.size,
        encryptedSize: uf.size,
        iv: fm.iv,
        ivPassword: hasPassword ? fm.ivPassword : null,
        mimeType: fm.mimeType,
      });
    }

    createShare({
      id: shareId,
      salt: hasPassword ? salt : null,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn: expiresInNum,
      sourceIp: req.ip,
      files: fileRecords,
      userId: req.user ? req.user.id : null,
      guestInvitedBy: req.guest ? req.guest.invitedBy : null,
    });

    logAction("share:create", req, {
      id: shareId,
      hasPassword: !!hasPassword,
      burnAfterReading: !!burnAfterReading,
      expiresIn: expiresInNum,
      fileCount: fileRecords.length,
      totalSize: fileRecords.reduce((s, f) => s + f.fileSize, 0),
    });

    // Clear guest cookie after successful creation
    if (req.guest) {
      res.clearCookie("redsec_guest", { path: "/" });
    }

    res.status(201).json({ id: shareId });
  } catch (err) {
    logAction("share:create_error", req, { error: err.message });
    // Clean up on error
    for (const uf of uploadedFiles) {
      try { fs.unlinkSync(uf.path); } catch {}
    }
    try { cleanupShareFiles(shareId); } catch {}
    res.status(500).json({ error: "Failed to create share" });
  }
});

// GET /api/share/:id — share metadata + file list
router.get("/share/:id", readLimiter, (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
    return res.status(400).json({ error: "Invalid share ID" });
  }

  const share = getShare(id);

  if (!share) {
    logAction("share:not_found", req, { id });
    return res.status(404).json({ error: "Share not found" });
  }

  if (share.expired) {
    logAction("share:expired", req, { id });
    return res.status(410).json({ error: "Share has expired" });
  }

  logAction("share:read_meta", req, { id, burned: !!share.burned, fileCount: share.files.length });

  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");

  // For burned shares, only return minimal info (no encryption metadata)
  if (share.burned) {
    return res.json({
      id: share.id,
      hasPassword: share.hasPassword,
      burnAfterReading: true,
      burned: true,
      fileCount: share.fileCount,
      totalSize: share.totalSize,
      files: share.files,
    });
  }

  res.json({
    id: share.id,
    salt: share.salt ? share.salt.toString("base64") : null,
    hasPassword: share.hasPassword,
    burnAfterReading: share.burnAfterReading,
    burned: false,
    fileCount: share.fileCount,
    totalSize: share.totalSize,
    files: share.files,
  });
});

// GET /api/share/:shareId/file/:fileId — download individual file
router.get("/share/:shareId/file/:fileId", readLimiter, (req, res) => {
  const { shareId, fileId } = req.params;
  if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(fileId)) {
    return res.status(400).json({ error: "Invalid file ID" });
  }

  const file = getShareFile(fileId);

  if (!file) {
    logAction("share:file_not_found", req, { shareId, fileId });
    return res.status(404).json({ error: "File not found" });
  }

  if (file.expired) {
    logAction("share:file_expired", req, { shareId, fileId });
    return res.status(410).json({ error: "Share has expired" });
  }

  // Verify file belongs to the share
  if (file.share_id !== shareId) {
    return res.status(400).json({ error: "File does not belong to this share" });
  }

  const filePath = file.filePath;
  if (!fs.existsSync(filePath)) {
    logAction("share:file_missing_disk", req, { shareId, fileId });
    return res.status(404).json({ error: "File data not found" });
  }

  logAction("share:file_download", req, { shareId, fileId, burnAfterReading: file.burnAfterReading });

  res.set("Content-Type", "application/octet-stream");
  res.set("Content-Length", fs.statSync(filePath).size);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // If burn-after-reading, DB row was already atomically deleted by getShareFile().
  // Just need to clean up the disk file after stream completes.
  if (file.burnAfterReading) {
    stream.on("end", () => {
      try { fs.unlinkSync(filePath); } catch {}
    });
  }
});

// --- Helpers ---
function cleanupFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f.path); } catch {}
  }
}

function cleanupShareFiles(shareId) {
  const { getFilesByShareId } = require("../database");
  const stmts = require("../database");
  const files = getFilesByShareId.all(shareId);
  for (const f of files) {
    try { fs.unlinkSync(path.join(FILES_DIR, `${f.id}.enc`)); } catch {}
  }
}

router.cleanupTmp = cleanupTmp;

module.exports = router;
