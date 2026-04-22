const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const {
  createBulletin,
  getBulletinById,
  getHomepageSettings,
  createBulletinAsset,
  getBulletinAssetById,
  BULLETIN_ASSETS_DIR,
  getShortcutsByCategory,
  getShortcutsByUser,
  getUserFavouriteIds,
  listAllBulletins,
  listBulletinsByAuthor,
  setHomepageSettings,
  updateBulletin,
} = require("../database");
const { TOOL_DEFINITIONS, isToolAvailable } = require("../access");
const {
  attachAssetsForBulletin,
  buildBulletinCapabilities,
  buildVisibleBulletinFeed,
  canEditBulletin,
  deleteBulletinWithAssets,
  generateBulletinId,
  sanitizeBulletinForSave,
} = require("../bulletin-service");

const router = Router();

const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: "Too many dashboard requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

function getSelectedToolFavourites(userId, permissionSet) {
  const settings = getHomepageSettings(userId);
  const allowedKeys = new Set(
    TOOL_DEFINITIONS
      .filter((tool) => isToolAvailable(tool, permissionSet))
      .map((tool) => tool.key)
  );
  const selected = Array.isArray(settings.toolFavourites) ? settings.toolFavourites.filter((key) => allowedKeys.has(key)) : [];
  const fallback = TOOL_DEFINITIONS
    .filter((tool) => allowedKeys.has(tool.key))
    .slice(0, 5)
    .map((tool) => tool.key);

  return selected.length ? selected.slice(0, 5) : fallback;
}

function getQuickAccessShortcuts(userId) {
  const settings = getHomepageSettings(userId);
  const teamOrder = Array.isArray(settings.teamShortcutOrder) ? settings.teamShortcutOrder : [];
  const teamOrderIndex = new Map(teamOrder.map((id, index) => [id, index]));
  const personalShortcuts = getShortcutsByUser(userId).filter((shortcut) => shortcut.category !== "team");
  const teamShortcuts = getShortcutsByCategory("team").sort((a, b) => {
    const aIndex = teamOrderIndex.has(a.id) ? teamOrderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bIndex = teamOrderIndex.has(b.id) ? teamOrderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });

  const favouriteIds = new Set(getUserFavouriteIds(userId));
  return [...teamShortcuts, ...personalShortcuts]
    .filter((shortcut) => favouriteIds.has(shortcut.id))
    .slice(0, 5)
    .map((shortcut) => ({
      id: shortcut.id,
      title: shortcut.title,
      url: shortcut.url,
      icon: shortcut.icon || null,
      iconUrl: shortcut.icon_url || shortcut.iconUrl || null,
      description: shortcut.description || "",
      category: shortcut.category,
    }));
}

router.get("/home-tab", requireUser, attachUserAccess, (req, res) => {
  const selectedTools = getSelectedToolFavourites(req.user.id, req.access.permissionSet);
  const shortcutFavourites = getQuickAccessShortcuts(req.user.id);
  const bulletins = req.access.permissionSet.has("bulletin.view")
    ? buildVisibleBulletinFeed(listAllBulletins(), 1, 5).bulletins
    : [];

  res.json({
    selectedTools,
    shortcutFavourites,
    bulletinPreview: bulletins,
    canViewBulletins: req.access.permissionSet.has("bulletin.view"),
  });
});

router.get("/bulletins", requireUser, attachUserAccess, (req, res) => {
  const capabilities = buildBulletinCapabilities(req);
  if (!capabilities.canView) {
    return res.json({
      capabilities,
      page: 1,
      limit: 20,
      total: 0,
      hasMore: false,
      bulletins: [],
    });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const feed = buildVisibleBulletinFeed(listAllBulletins(), page, limit);

  res.json({
    capabilities,
    page,
    limit,
    total: feed.total,
    hasMore: (page * limit) < feed.total,
    bulletins: feed.bulletins,
  });
});

router.get("/bulletins/manage", requireUser, attachUserAccess, (req, res) => {
  const capabilities = buildBulletinCapabilities(req);
  const editableBulletins = capabilities.canCreate
    ? listBulletinsByAuthor(req.user.id, 1, 50)
    : [];

  res.json({
    capabilities,
    bulletins: editableBulletins,
  });
});

router.get("/bulletins/:id", requireUser, attachUserAccess, (req, res) => {
  const bulletin = getBulletinById(req.params.id);
  if (!bulletin) return res.status(404).json({ error: "Bulletin not found" });
  if (!buildBulletinCapabilities(req).canView && !canEditBulletin(req, bulletin)) {
    return res.status(403).json({ error: "Bulletin access denied" });
  }
  res.json({ bulletin });
});

router.post("/bulletins", settingsLimiter, requireUser, attachUserAccess, (req, res) => {
  const capabilities = buildBulletinCapabilities(req);
  if (!capabilities.canCreate) {
    return res.status(403).json({ error: "Bulletin creation denied" });
  }

  const payload = sanitizeBulletinForSave(req, req.body);
  if (!payload.title) {
    return res.status(400).json({ error: "Bulletin title is required" });
  }

  const id = generateBulletinId();
  createBulletin({
    id,
    ...payload,
    authorId: req.user.id,
  });
  attachAssetsForBulletin(req.user.id, id, payload.bodyHtml);

  res.json({
    success: true,
    bulletin: getBulletinById(id),
  });
});

router.put("/bulletins/:id", settingsLimiter, requireUser, attachUserAccess, (req, res) => {
  const bulletin = getBulletinById(req.params.id);
  if (!bulletin) return res.status(404).json({ error: "Bulletin not found" });
  if (!canEditBulletin(req, bulletin)) {
    return res.status(403).json({ error: "Bulletin edit denied" });
  }

  const payload = sanitizeBulletinForSave(req, req.body, bulletin);
  if (!payload.title) {
    return res.status(400).json({ error: "Bulletin title is required" });
  }

  updateBulletin({
    id: bulletin.id,
    ...payload,
  });
  attachAssetsForBulletin(req.user.id, bulletin.id, payload.bodyHtml);

  res.json({
    success: true,
    bulletin: getBulletinById(bulletin.id),
  });
});

router.delete("/bulletins/:id", settingsLimiter, requireUser, attachUserAccess, (req, res) => {
  const bulletin = getBulletinById(req.params.id);
  if (!bulletin) return res.status(404).json({ error: "Bulletin not found" });
  if (!canEditBulletin(req, bulletin)) {
    return res.status(403).json({ error: "Bulletin delete denied" });
  }

  deleteBulletinWithAssets(bulletin.id);
  res.json({ success: true });
});

router.post("/bulletin-assets", settingsLimiter, upload.single("image"), requireUser, attachUserAccess, async (req, res) => {
  if (!req.access.permissionSet.has("bulletin.create")) {
    return res.status(403).json({ error: "Bulletin asset upload denied" });
  }
  const file = req.file;
  if (!file || !file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Image upload is required" });
  }

  try {
    const id = crypto.randomBytes(16).toString("base64url");
    const buffer = await sharp(file.buffer)
      .rotate()
      .resize(960, 960, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer();

    fs.writeFileSync(path.join(BULLETIN_ASSETS_DIR, `${id}.webp`), buffer);
    createBulletinAsset({
      id,
      bulletinId: null,
      authorId: req.user.id,
      filename: `${id}.webp`,
      mimeType: "image/webp",
      sizeBytes: buffer.length,
    });

    res.json({
      success: true,
      asset: {
        id,
        url: `/api/homepage/bulletin-assets/${id}`,
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to process bulletin image" });
  }
});

router.get("/bulletin-assets/:id", requireUser, (req, res) => {
  const asset = getBulletinAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: "Bulletin asset not found" });
  const assetPath = path.join(BULLETIN_ASSETS_DIR, asset.filename);
  if (!fs.existsSync(assetPath)) return res.status(404).json({ error: "Bulletin asset not found" });
  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", "public, max-age=3600");
  fs.createReadStream(assetPath).pipe(res);
});

router.get("/tool-favourites", requireUser, attachUserAccess, (req, res) => {
  const selected = getSelectedToolFavourites(req.user.id, req.access.permissionSet);
  const available = TOOL_DEFINITIONS
    .filter((tool) => isToolAvailable(tool, req.access.permissionSet))
    .map((tool) => ({ key: tool.key, name: tool.name, href: tool.href }));
  res.json({ selected, available });
});

router.put("/tool-favourites", settingsLimiter, requireUser, attachUserAccess, (req, res) => {
  const selected = Array.isArray(req.body?.selected) ? req.body.selected.slice(0, 5) : [];
  const allowed = new Set(
    TOOL_DEFINITIONS
      .filter((tool) => isToolAvailable(tool, req.access.permissionSet))
      .map((tool) => tool.key)
  );
  const normalized = [...new Set(selected.filter((key) => allowed.has(key)))].slice(0, 5);
  const settings = getHomepageSettings(req.user.id);
  setHomepageSettings(req.user.id, {
    ...settings,
    toolFavourites: normalized,
  });
  res.json({ success: true, selected: normalized });
});

module.exports = router;
