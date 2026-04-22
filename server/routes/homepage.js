const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");
const net = require("net");
const dns = require("dns").promises;
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
const SHORTCUT_ICONS_DIR = path.join(__dirname, "..", "..", "data", "shortcut-icons");
if (!fs.existsSync(SHORTCUT_ICONS_DIR)) fs.mkdirSync(SHORTCUT_ICONS_DIR, { recursive: true });

// Delete an orphaned shortcut icon file from disk
function deleteShortcutIconFile(iconUrl) {
  if (!iconUrl || !iconUrl.startsWith("/api/homepage/shortcut-icon/")) return;
  const rawId = iconUrl.replace("/api/homepage/shortcut-icon/", "");
  const baseId = rawId.replace(/\.(webp|ico)$/, "");
  if (!/^[A-Za-z0-9_-]+$/.test(baseId)) return;
  // Try both possible extensions
  for (const ext of ["webp", "ico"]) {
    const iconPath = path.join(SHORTCUT_ICONS_DIR, `${baseId}.${ext}`);
    try { if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath); } catch {}
  }
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

const MAX_ICON_REDIRECTS = 3;
const ALLOWED_ICON_PORTS = new Set(["", "80", "443"]);

function isPrivateIpv4(address) {
  const parts = address.split(".").map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("ff")) return true;

  const mappedMatch = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch) {
    return isPrivateIpv4(mappedMatch[1]);
  }

  return false;
}

function isReservedIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function isPublicFetchTarget(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }
  if (!ALLOWED_ICON_PORTS.has(parsed.port)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost") {
    return false;
  }
  if (net.isIP(hostname)) {
    return false;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }

  if (!addresses.length) {
    return false;
  }

  return addresses.every((entry) => !isReservedIp(entry.address));
}

async function fetchWithValidatedRedirects(initialUrl, options = {}) {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_ICON_REDIRECTS; redirectCount++) {
    if (!(await isPublicFetchTarget(currentUrl))) {
      throw new Error("Blocked unsafe icon fetch target");
    }

    const response = await fetch(currentUrl, {
      ...options,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect missing location");
      }
      if (redirectCount === MAX_ICON_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error("Too many redirects");
}

// ============================================================
// Favicon fetcher — fetches site favicon by parsing <link> tags,
// falls back to /favicon.ico. All server-side (CSP-safe).
// ============================================================

async function fetchFavicon(pageUrl) {
  try {
    if (!(await isPublicFetchTarget(pageUrl))) return null;

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_fetch_start", url: pageUrl }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const { response, finalUrl } = await fetchWithValidatedRedirects(pageUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RedSecTools/1.0)" },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_fetch_page_fail", url: pageUrl, status: response.status }));
      return null;
    }

    // Read HTML — use text() for reliability across Node fetch implementations
    const html = await response.text();
    const trimmedHtml = html.substring(0, 100 * 1024);

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_html_fetched", url: pageUrl, htmlLen: trimmedHtml.length }));

    // Extract favicon URLs from <link> tags
    const candidates = extractFaviconCandidates(trimmedHtml, finalUrl);

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_candidates", url: pageUrl, count: candidates.length, urls: candidates.map((c) => c.url) }));

    // Also add /favicon.ico as last resort
    const parsed = new URL(finalUrl);
    candidates.push({ url: `${parsed.origin}/favicon.ico`, isIco: true });

    // Try each candidate — prefer non-ICO first (sharp can't handle ICO)
    const sortedCandidates = candidates.sort((a, b) => {
      if (a.isIco && !b.isIco) return 1;
      if (!a.isIco && b.isIco) return -1;
      return 0;
    });

    for (const candidate of sortedCandidates) {
      const result = await tryFetchIcon(candidate);
      if (result) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_fetch_success", url: pageUrl, faviconUrl: candidate.url }));
        return result;
      }
    }

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_fetch_all_failed", url: pageUrl }));
    return null;
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_fetch_error", url: pageUrl, error: err.message, stack: err.stack }));
    return null;
  }
}

function extractFaviconCandidates(html, baseUrl) {
  const parsed = new URL(baseUrl);
  const baseOrigin = parsed.origin;
  const linkRegex = /<link\s[^>]*>/gi;
  const iconRels = /rel=["'](?:apple-touch-icon(?:-precomposed)?|shortcut\s+icon|icon)["']/i;

  const candidates = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    if (!iconRels.test(tag)) continue;

    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    let href;
    try {
      href = new URL(hrefMatch[1], baseUrl).href;
    } catch {
      continue;
    }

    const isApple = /apple-touch-icon/.test(tag);
    const sizesMatch = tag.match(/sizes=["']([^"']+)["']/i);
    const size = sizesMatch ? parseFaviconSize(sizesMatch[1]) : 0;
    const isIco = /\.ico(\?|$)/i.test(href);

    candidates.push({ url: href, isApple, size, isIco });
  }

  // Prefer apple-touch-icon (usually 180x180), then largest size, then non-ICO
  candidates.sort((a, b) => {
    if (a.isApple && !b.isApple) return -1;
    if (!a.isApple && b.isApple) return 1;
    return b.size - a.size;
  });

  return candidates;
}

// Extract the largest PNG embedded inside an ICO file
function extractPngFromIco(buf) {
  try {
    if (buf.length < 6) return null;
    const count = buf.readUInt16LE(4);
    if (count === 0 || count > 20) return null;

    let bestEntry = null;
    let bestSize = 0;

    for (let i = 0; i < count; i++) {
      const entryOff = 6 + i * 16;
      if (entryOff + 16 > buf.length) break;

      const dataSize = buf.readUInt32LE(entryOff + 8);
      const dataOff = buf.readUInt32LE(entryOff + 12);

      if (dataOff + 4 > buf.length || dataSize < 10) continue;

      // Check for PNG magic at the data offset
      if (buf[dataOff] === 0x89 && buf[dataOff + 1] === 0x50 &&
          buf[dataOff + 2] === 0x4E && buf[dataOff + 3] === 0x47) {
        if (dataSize > bestSize) {
          bestSize = dataSize;
          bestEntry = { offset: dataOff, size: dataSize };
        }
      }
    }

    if (bestEntry) {
      return buf.slice(bestEntry.offset, bestEntry.offset + bestEntry.size);
    }
    return null;
  } catch {
    return null;
  }
}

// Save a raw icon file (e.g. ICO with no embedded PNG) to disk
async function saveIconRaw(buf, ext) {
  const id = crypto.randomBytes(16).toString("base64url");
  const iconPath = path.join(SHORTCUT_ICONS_DIR, `${id}.${ext}`);
  fs.writeFileSync(iconPath, buf);
  console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_saved_raw", id, ext, size: buf.length }));
  return `/api/homepage/shortcut-icon/${id}.${ext}`;
}

async function tryFetchIcon(candidate) {
  try {
    if (!(await isPublicFetchTarget(candidate.url))) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const { response: imgResponse } = await fetchWithValidatedRedirects(candidate.url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RedSecTools/1.0)" },
    });
    clearTimeout(timeout);

    if (!imgResponse.ok) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_fail", url: candidate.url, status: imgResponse.status }));
      return null;
    }

    const contentType = imgResponse.headers.get("content-type") || "";
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_response", url: candidate.url, contentType, isIco: !!candidate.isIco }));

    const arrayBuf = await imgResponse.arrayBuffer();
    if (arrayBuf.byteLength < 10 || arrayBuf.byteLength > 2 * 1024 * 1024) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_size", url: candidate.url, size: arrayBuf.byteLength }));
      return null;
    }

    const buf = Buffer.from(arrayBuf);

    // Check actual file format via magic bytes (more reliable than content-type)
    // PNG: 89 50 4E 47
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    // JPEG: FF D8 FF
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    // WebP: 52 49 46 46 ... 57 45 42 50
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    // GIF: 47 49 46 38
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
    // ICO: 00 00 01 00
    const isIco = buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
    // SVG (text-based): starts with < or has <svg
    const isSvg = contentType.includes("svg") || (buf[0] === 0x3C && buf.toString("utf8", 0, 200).includes("<svg"));

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_format", url: candidate.url, isPng, isJpeg, isWebp, isGif, isIco, isSvg }));

    // sharp can process: PNG, JPEG, WebP, GIF, SVG
    if (isPng || isJpeg || isWebp || isGif || isSvg) {
      return await convertToWebpIcon(buf);
    }

    // ICO format — extract embedded PNG and convert, or save as-is
    if (isIco) {
      const pngBuf = extractPngFromIco(buf);
      if (pngBuf) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_ico_png_extracted", url: candidate.url, pngSize: pngBuf.length }));
        return await convertToWebpIcon(pngBuf);
      }
      // No PNG inside ICO — save ICO directly (browsers display ICO in <img>)
      console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_ico_save_raw", url: candidate.url }));
      return await saveIconRaw(buf, "ico");
    }

    // Unknown format but looks like an image — try sharp anyway
    if (contentType.startsWith("image/")) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_unknown_try", url: candidate.url, contentType }));
      try {
        return await convertToWebpIcon(buf);
      } catch (sharpErr) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_unknown_fail", url: candidate.url, error: sharpErr.message }));
        return null;
      }
    }

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_not_image", url: candidate.url, contentType }));
    return null;
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_icon_error", url: candidate.url, error: err.message }));
    return null;
  }
}

async function convertToWebpIcon(buffer) {
  const id = crypto.randomBytes(16).toString("base64url");
  try {
    const webpBuffer = await sharp(buffer)
      .resize(64, 64, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();

    const iconPath = path.join(SHORTCUT_ICONS_DIR, `${id}.webp`);
    fs.writeFileSync(iconPath, webpBuffer);

    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_converted", id, size: webpBuffer.length }));
    return `/api/homepage/shortcut-icon/${id}`;
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), action: "favicon_convert_fail", id, error: err.message }));
    throw err;
  }
}

// ============================================================
// Shortcuts
// ============================================================

// GET /api/homepage/shortcuts
router.get("/shortcuts", requireUser, (req, res) => {
  const shortcuts = getShortcutsByUser(req.user.id);
  const { getShortcutsByCategory } = require("../database");
  const settings = getHomepageSettings(req.user.id);
  const teamOrder = Array.isArray(settings.teamShortcutOrder) ? settings.teamShortcutOrder : [];
  const teamOrderIndex = new Map(teamOrder.map((id, index) => [id, index]));
  const teamShortcuts = getShortcutsByCategory("team").sort((a, b) => {
    const aIndex = teamOrderIndex.has(a.id) ? teamOrderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bIndex = teamOrderIndex.has(b.id) ? teamOrderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
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

// GET /api/homepage/shortcut-icon/:id — serve shortcut icon (WebP or ICO)
router.get("/shortcut-icon/:id", (req, res) => {
  const rawId = req.params.id;
  // Allow id.webp or id.ico extensions
  if (!/^[A-Za-z0-9_-]+(\.(webp|ico))?$/.test(rawId)) {
    return res.status(400).json({ error: "Invalid icon ID" });
  }

  const ext = rawId.endsWith(".ico") ? "ico" : "webp";
  const baseId = rawId.replace(/\.(webp|ico)$/, "");
  const iconPath = path.join(SHORTCUT_ICONS_DIR, `${baseId}.${ext}`);

  if (!fs.existsSync(iconPath)) {
    // Fallback: try the other extension
    const fallbackExt = ext === "ico" ? "webp" : "ico";
    const fallbackPath = path.join(SHORTCUT_ICONS_DIR, `${baseId}.${fallbackExt}`);
    if (fs.existsSync(fallbackPath)) {
      res.set("Content-Type", fallbackExt === "ico" ? "image/x-icon" : "image/webp");
      res.set("Cache-Control", "public, max-age=86400");
      return fs.createReadStream(fallbackPath).pipe(res);
    }
    return res.status(404).json({ error: "Icon not found" });
  }

  res.set("Content-Type", ext === "ico" ? "image/x-icon" : "image/webp");
  res.set("Cache-Control", "public, max-age=86400");
  fs.createReadStream(iconPath).pipe(res);
});

// POST /api/homepage/shortcuts
router.post("/shortcuts", shortcutLimiter, requireUser, async (req, res) => {
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
  let safeIconUrl = (typeof icon_url === "string" && icon_url.startsWith("/api/homepage/shortcut-icon/")) ? icon_url : null;
  const safeTitle = title.trim();
  const safeUrl = url.trim();
  const safeDescription = (typeof description === "string" && description.length <= 200) ? description.trim() : null;

  // If no icon provided, try fetching the site's favicon
  if (!safeIcon && !safeIconUrl) {
    const faviconUrl = await fetchFavicon(safeUrl);
    if (faviconUrl) safeIconUrl = faviconUrl;
  }

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
    if (count >= 5) {
      return res.status(400).json({ error: "Maximum 5 favourites allowed" });
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

  const settings = getHomepageSettings(req.user.id);
  const teamShortcutOrder = [];

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (typeof id !== "string") continue;

    // Check if user owns this shortcut
    let existing = getShortcutById(id, req.user.id);

    // Team shortcuts are ordered per-user, not by mutating the shared shortcut row.
    if (!existing) {
      const any = getShortcutByIdAny(id);
      if (any && any.category === "team") {
        teamShortcutOrder.push(id);
      }
      continue;
    }

    updateShortcutById({
      id,
      userId: req.user.id,
      category: existing.category,
      title: existing.title,
      url: existing.url,
      icon: existing.icon,
      iconUrl: existing.icon_url || existing.iconUrl || null,
      description: existing.description,
      sortOrder: i,
    });
  }

  setHomepageSettings(req.user.id, {
    ...settings,
    teamShortcutOrder,
  });

  res.json({ success: true });
});

// PUT /api/homepage/shortcuts/:id
router.put("/shortcuts/:id", shortcutLimiter, requireUser, async (req, res) => {
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
  const safeOrder = typeof sortOrder === "number" ? sortOrder : (existing.sort_order || existing.sortOrder || 0);

  // If no icon and no icon URL, try fetching favicon for the (possibly new) URL
  if (!safeIcon && !safeIconUrl) {
    const faviconUrl = await fetchFavicon(safeUrl);
    if (faviconUrl) safeIconUrl = faviconUrl;
  }

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

module.exports = { router, clearWeatherCache, fetchFavicon, SHORTCUT_ICONS_DIR };
