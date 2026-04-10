const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const { requireUser } = require("../middleware/auth");
const { httpGetJSON } = require("../http-helper");
const {
  getShortcutsByUser, createShortcut, updateShortcutById, deleteShortcutById, getShortcutById,
  getShortcutByIdAny,
  getHomepageSettings, setHomepageSettings,
  getSetting, setSetting,
  addUserFavourite, removeUserFavourite, isUserFavourite, getUserFavouriteIds, countUserFavourites,
  deleteFavouritesByShortcut,
} = require("../database");

const router = Router();

// Shortcut icons directory
const SHORTCUT_ICONS_DIR = path.join(__dirname, "..", "data", "shortcut-icons");
if (!fs.existsSync(SHORTCUT_ICONS_DIR)) fs.mkdirSync(SHORTCUT_ICONS_DIR, { recursive: true });

// Delete an orphaned shortcut icon file from disk
function deleteShortcutIconFile(iconUrl) {
  if (!iconUrl || !iconUrl.startsWith("/api/homepage/shortcut-icon/")) return;
  const iconId = iconUrl.replace("/api/homepage/shortcut-icon/", "").replace(/\.webp$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(iconId)) return;
  const iconPath = path.join(SHORTCUT_ICONS_DIR, `${iconId}.webp`);
  try { if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath); } catch {}
}

// Rate limit for shortcut operations
const shortcutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadIconLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many uploads. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const iconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ============================================================
// Shortcuts
// ============================================================

// GET /api/homepage/shortcuts
router.get("/shortcuts", requireUser, (req, res) => {
  const shortcuts = getShortcutsByUser(req.user.id);
  const { getShortcutsByCategory } = require("../database");
  const teamShortcuts = getShortcutsByCategory("team");
  const all = [...teamShortcuts, ...shortcuts.filter((s) => s.category !== "team")];

  // Attach per-user favourite status
  const favIds = new Set(getUserFavouriteIds(req.user.id));
  all.forEach((s) => { s.isFavourite = favIds.has(s.id); });

  res.json({ shortcuts: all });
});

// POST /api/homepage/shortcuts/upload-icon
router.post("/shortcuts/upload-icon", uploadIconLimiter, iconUpload.single("image"), requireUser, async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  if (!file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Only image files are allowed" });
  }

  try {
    const id = crypto.randomBytes(16).toString("base64url");
    const buffer = await sharp(file.buffer)
      .resize(64, 64, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const iconPath = path.join(SHORTCUT_ICONS_DIR, `${id}.webp`);
    fs.writeFileSync(iconPath, buffer);

    res.json({ url: `/api/homepage/shortcut-icon/${id}` });
  } catch {
    res.status(500).json({ error: "Failed to process image" });
  }
});

// GET /api/homepage/shortcut-icon/:id — serve shortcut icon
router.get("/shortcut-icon/:id", (req, res) => {
  const iconId = req.params.id.replace(/\.webp$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(iconId)) {
    return res.status(400).json({ error: "Invalid icon ID" });
  }
  const iconPath = path.join(SHORTCUT_ICONS_DIR, `${iconId}.webp`);
  if (!fs.existsSync(iconPath)) {
    return res.status(404).json({ error: "Icon not found" });
  }
  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", "public, max-age=86400");
  fs.createReadStream(iconPath).pipe(res);
});

// POST /api/homepage/shortcuts
router.post("/shortcuts", shortcutLimiter, requireUser, (req, res) => {
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

  // Users can only create personal shortcuts
  const safeIcon = (typeof icon === "string" && icon.length <= 20) ? icon : null;
  const safeIconUrl = (typeof icon_url === "string" && icon_url.startsWith("/api/homepage/shortcut-icon/")) ? icon_url : null;
  const safeTitle = title.trim();
  const safeUrl = url.trim();
  const safeDescription = (typeof description === "string" && description.length <= 200) ? description.trim() : null;

  const id = crypto.randomBytes(16).toString("base64url");

  createShortcut({
    id,
    userId: req.user.id,
    category: "personal",
    title: safeTitle,
    url: safeUrl,
    icon: safeIcon,
    iconUrl: safeIconUrl,
    description: safeDescription,
    sortOrder: 0,
  });

  res.json({ success: true, id });
});

// PUT /api/homepage/shortcuts/:id/favourite — toggle favourite (any shortcut, per-user)
router.put("/shortcuts/:id/favourite", shortcutLimiter, requireUser, (req, res) => {
  const { id } = req.params;

  // Shortcut must exist (either user-owned or team)
  const owned = getShortcutById(id, req.user.id);
  const any = getShortcutByIdAny(id);
  if (!owned && !any) {
    return res.status(404).json({ error: "Shortcut not found" });
  }

  const currentlyFav = isUserFavourite(req.user.id, id);
  if (currentlyFav) {
    removeUserFavourite(req.user.id, id);
  } else {
    const count = countUserFavourites(req.user.id);
    if (count >= 4) {
      return res.status(400).json({ error: "Maximum 4 favourites allowed" });
    }
    addUserFavourite(req.user.id, id);
  }

  res.json({ success: true, isFavourite: !currentlyFav });
});

// PUT /api/homepage/shortcuts/reorder — MUST be before /:id route
router.put("/shortcuts/reorder", shortcutLimiter, requireUser, (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order) || order.length > 100) {
    return res.status(400).json({ error: "Invalid reorder data" });
  }

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (typeof id !== "string") continue;

    // Check if user owns this shortcut
    let existing = getShortcutById(id, req.user.id);
    let userId = req.user.id;

    // If not owned, check if it's a team shortcut (users can reorder those for personal view)
    if (!existing) {
      const any = getShortcutByIdAny(id);
      if (any && any.category === "team") {
        existing = any;
        userId = any.user_id;
      }
    }

    if (!existing) continue;
    updateShortcutById({
      id,
      userId,
      category: existing.category,
      title: existing.title,
      url: existing.url,
      icon: existing.icon,
      iconUrl: existing.icon_url || existing.iconUrl || null,
      description: existing.description,
      sortOrder: i,
    });
  }

  res.json({ success: true });
});

// PUT /api/homepage/shortcuts/:id
router.put("/shortcuts/:id", shortcutLimiter, requireUser, (req, res) => {
  const { id } = req.params;
  const { title, url, icon, icon_url, sortOrder, description } = req.body || {};

  const existing = getShortcutById(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: "Shortcut not found" });
  }
  // Users can only edit personal shortcuts
  if (existing.category === "team") {
    return res.status(403).json({ error: "Cannot edit team shortcuts" });
  }

  const safeIcon = (typeof icon === "string" && icon.length <= 20) ? icon : existing.icon;
  const oldIconUrl = existing.icon_url || existing.iconUrl || null;
  const safeIconUrl = (typeof icon_url === "string" && icon_url.startsWith("/api/homepage/shortcut-icon/")) ? icon_url : oldIconUrl;
  const safeTitle = (typeof title === "string" && title.trim()) ? title.trim() : existing.title;
  const safeDescription = (typeof description === "string") ? description.trim() : existing.description;
  let safeUrl = existing.url;
  if (typeof url === "string" && url.trim()) {
    if (!url.trim().startsWith("/") && !/^https?:\/\//i.test(url.trim())) {
      return res.status(400).json({ error: "URL must start with / or http(s)://" });
    }
    safeUrl = url.trim();
  }
  const safeOrder = typeof sortOrder === "number" ? sortOrder : (existing.sort_order || existing.sortOrder || 0);

  // Clean up old icon if it changed
  if (oldIconUrl && oldIconUrl !== safeIconUrl) {
    deleteShortcutIconFile(oldIconUrl);
  }

  const updated = updateShortcutById({
    id,
    userId: req.user.id,
    category: existing.category,
    title: safeTitle,
    url: safeUrl,
    icon: safeIcon,
    iconUrl: safeIconUrl,
    description: safeDescription,
    sortOrder: safeOrder,
  });

  if (!updated) {
    return res.status(404).json({ error: "Shortcut not found" });
  }
  res.json({ success: true });
});

// DELETE /api/homepage/shortcuts/:id
router.delete("/shortcuts/:id", shortcutLimiter, requireUser, (req, res) => {
  // Check shortcut belongs to user and is personal
  const existing = getShortcutById(req.params.id, req.user.id);
  if (!existing) {
    return res.status(404).json({ error: "Shortcut not found" });
  }
  if (existing.category === "team") {
    return res.status(403).json({ error: "Cannot delete team shortcuts" });
  }
  // Clean up icon file before deleting the record
  const iconUrl = existing.icon_url || existing.iconUrl;
  if (iconUrl) deleteShortcutIconFile(iconUrl);
  deleteFavouritesByShortcut(req.params.id);
  const deleted = deleteShortcutById(req.params.id, req.user.id);
  if (!deleted) {
    return res.status(404).json({ error: "Shortcut not found" });
  }
  res.json({ success: true });
});

// ============================================================
// Settings
// ============================================================

// GET /api/homepage/settings
router.get("/settings", requireUser, (req, res) => {
  const layout = getHomepageSettings(req.user.id);
  res.json(layout);
});

// PUT /api/homepage/settings
router.put("/settings", requireUser, (req, res) => {
  const { showWeather, showSearch, showShortcuts } = req.body || {};

  const layout = {};
  if (typeof showWeather === "boolean") layout.showWeather = showWeather;
  if (typeof showSearch === "boolean") layout.showSearch = showSearch;
  if (typeof showShortcuts === "boolean") layout.showShortcuts = showShortcuts;

  const current = getHomepageSettings(req.user.id);
  const merged = { ...current, ...layout };
  setHomepageSettings(req.user.id, merged);

  res.json({ success: true });
});

// ============================================================
// Weather (server-side fetch + cache)
// ============================================================

let weatherCache = { data: null, ts: 0 };
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// GET /api/homepage/weather
router.get("/weather", requireUser, async (req, res) => {
  const locationsJson = getSetting("weather_locations");
  if (!locationsJson) {
    return res.json({ locations: [] });
  }

  let locations;
  try {
    locations = JSON.parse(locationsJson);
  } catch {
    return res.json({ locations: [] });
  }

  if (!Array.isArray(locations) || locations.length === 0) {
    return res.json({ locations: [] });
  }

  // Check cache
  const now = Date.now();
  if (weatherCache.data && (now - weatherCache.ts) < WEATHER_CACHE_TTL) {
    return res.json({ locations: weatherCache.data, cached: true });
  }

  // Fetch from Open-Meteo
  try {
    const results = await Promise.all(
      locations.map(async (loc) => {
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code&timezone=auto`;
        try {
          const data = await httpGetJSON(weatherUrl);
          return {
            name: loc.name,
            temp: Math.round(data.current?.temperature_2m),
            code: data.current?.weather_code ?? 0,
            timezone: data.timezone || "UTC",
          };
        } catch {
          return { name: loc.name, error: true };
        }
      })
    );

    weatherCache = { data: results, ts: now };
    res.json({ locations: results });
  } catch (err) {
    // Return stale cache on error
    if (weatherCache.data) {
      return res.json({ locations: weatherCache.data, cached: true, stale: true });
    }
    res.json({ locations: [], error: "Weather fetch failed" });
  }
});

// Allow admin to invalidate weather cache when locations change
function clearWeatherCache() {
  weatherCache = { data: null, ts: 0 };
}

module.exports = { router, clearWeatherCache };
