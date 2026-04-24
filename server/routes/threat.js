const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const db = require("../database");
const { backfillAlertOwnershipForUser } = require("../threat-feed-service");
const { getThreatNotificationPolicy } = require("../threat-notify-service");

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ID_REGEX = /^[A-Za-z0-9_-]{22}$/;

const THREAT_VALID_FEED_TYPES = new Set(["rss", "website", "api", "onion"]);
const THREAT_VALID_CRITICALITIES = new Set(["low", "medium", "high", "critical"]);
const THREAT_VALID_CHANNEL_TYPES = new Set(["webhook", "email", "discord"]);

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: { error: "Too many threat intel requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ---------------------------------------------------------------------------
// Permission guards
// ---------------------------------------------------------------------------

function requireThreatView(req, res, next) {
  if (!req.access.permissionSet.has("threat.view") && !req.access.permissionSet.has("threat.manage")) {
    return res.status(403).json({ error: "Threat intel access denied" });
  }
  next();
}

function requireThreatManage(req, res, next) {
  if (!req.access.permissionSet.has("threat.manage")) {
    return res.status(403).json({ error: "Threat intel management denied" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateId(id) {
  return typeof id === "string" && ID_REGEX.test(id);
}

function getAllowedThreatChannels() {
  const policy = getThreatNotificationPolicy();
  return Object.entries(policy)
    .filter(([, config]) => config?.enabled)
    .map(([channelType]) => channelType);
}

function adminThreatOnly(res, resource = "Threat management") {
  return res.status(403).json({ error: `${resource} is only available in the admin panel.` });
}

function feedAdminOnly(res) {
  return adminThreatOnly(res, "Feed source changes");
}

function filterAccessibleTagIds(userId, tagIds) {
  const requested = Array.isArray(tagIds) ? tagIds.filter((id) => typeof id === "string") : [];
  if (!requested.length) return [];
  const accessible = new Set(db.listThreatTags(userId).map((tag) => tag.id));
  return requested.filter((id) => accessible.has(id));
}

// ===========================================================================
// Bootstrap
// ===========================================================================

router.get("/threat/bootstrap", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const globalStats = db.getThreatStats();
  const currentAlerts = db.listThreatAlerts({ userId: req.user.id, limit: 1, offset: 0 });
  if (globalStats.totalAlerts > 0 && currentAlerts.length === 0) {
    backfillAlertOwnershipForUser(req.user.id);
  }
  const stats = db.getThreatStatsForUser(req.user.id);
  const recentAlerts = db.listThreatAlerts({ userId: req.user.id, limit: 10, offset: 0 });
  const feedHealth = db.getThreatFeedHealth();
  const settings = {
    autoFetchEnabled: db.getSetting("threat_auto_fetch_enabled") === "true",
    fetchIntervalSeconds: parseInt(db.getSetting("threat_fetch_interval_seconds"), 10) || 60,
  };
  const userNotifications = db.listThreatUserNotifications(req.user.id);
  const notificationPolicy = getThreatNotificationPolicy();

  res.json({
    stats,
    recentAlerts,
    feedHealth,
    settings,
    userNotifications,
    notificationPolicy,
    accountEmail: req.user.email || "",
    canManage: false,
  });
});

// ===========================================================================
// Feeds
// ===========================================================================

router.get("/threat/feeds", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const enabledOnly = req.query.enabled === "true" || req.query.enabled === "1";
  const feeds = db.listThreatFeeds(enabledOnly);
  res.json({ feeds });
});

router.post("/threat/feeds", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return feedAdminOnly(res);
});

router.get("/threat/feeds/:id", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid feed ID" });
  const feed = db.getThreatFeedById(req.params.id);
  if (!feed) return res.status(404).json({ error: "Feed not found" });
  res.json({ feed });
});

router.put("/threat/feeds/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return feedAdminOnly(res);
});

router.delete("/threat/feeds/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return feedAdminOnly(res);
});

router.post("/threat/feeds/:id/check", writeLimiter, requireUser, attachUserAccess, requireThreatView, async (req, res) => {
  return feedAdminOnly(res);
});

router.post("/threat/feeds/:id/keywords", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return feedAdminOnly(res);
});

// ===========================================================================
// Keywords
// ===========================================================================

router.get("/threat/keywords", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const enabledOnly = req.query.enabled === "true" || req.query.enabled === "1";
  const keywords = db.listThreatKeywordsForUser(req.user.id).filter((keyword) => !enabledOnly || keyword.enabled);
  res.json({ keywords });
});

router.post("/threat/keywords", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const keyword = String(req.body?.keyword || "").trim();
  if (!keyword) return res.status(400).json({ error: "Keyword text is required" });
  if (keyword.length > 255) return res.status(400).json({ error: "Keyword must be 255 characters or less" });

  const criticality = THREAT_VALID_CRITICALITIES.has(req.body?.criticality) ? req.body.criticality : "medium";
  const kw = db.createThreatKeyword({
    keyword,
    caseSensitive: !!req.body?.caseSensitive,
    isRegex: !!req.body?.isRegex,
    enabled: req.body?.enabled !== false,
    criticality,
    userId: req.user.id,
  });

  const tagIds = filterAccessibleTagIds(req.user.id, req.body?.tagIds);
  if (tagIds.length) db.setThreatKeywordTagsForUser(req.user.id, kw.id, tagIds);

  res.json({ success: true, keyword: db.getThreatKeywordByIdForUser(req.user.id, kw.id) });
});

router.get("/threat/keywords/:id", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid keyword ID" });
  const keyword = db.getThreatKeywordByIdForUser(req.user.id, req.params.id);
  if (!keyword) return res.status(404).json({ error: "Keyword not found" });
  res.json({ keyword });
});

router.put("/threat/keywords/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid keyword ID" });
  const existing = db.getThreatKeywordByIdForUser(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: "Keyword not found" });

  if (existing.isSystem) {
    const attemptedGlobalEdit = req.body?.keyword != null
      || req.body?.caseSensitive != null
      || req.body?.isRegex != null
      || req.body?.criticality != null;
    if (attemptedGlobalEdit) {
      return res.status(403).json({ error: "Default keywords can only be enabled, disabled, or tagged per user." });
    }
    if (req.body?.enabled === false) {
      db.disableSystemKeywordForUser(req.user.id, req.params.id);
    } else if (req.body?.enabled === true) {
      db.enableSystemKeywordForUser(req.user.id, req.params.id);
    }
    if (Array.isArray(req.body?.tagIds)) {
      db.setThreatKeywordTagsForUser(req.user.id, req.params.id, filterAccessibleTagIds(req.user.id, req.body.tagIds));
    }
    return res.json({ success: true, keyword: db.getThreatKeywordByIdForUser(req.user.id, req.params.id) });
  }

  const keyword = req.body?.keyword != null ? String(req.body.keyword).trim() : existing.keyword;
  if (!keyword) return res.status(400).json({ error: "Keyword text is required" });
  if (keyword.length > 255) return res.status(400).json({ error: "Keyword must be 255 characters or less" });

  const criticality = req.body?.criticality != null
    ? (THREAT_VALID_CRITICALITIES.has(req.body.criticality) ? req.body.criticality : existing.criticality)
    : existing.criticality;

  db.updateThreatKeyword(req.params.id, {
    keyword,
    caseSensitive: req.body?.caseSensitive,
    isRegex: req.body?.isRegex,
    enabled: req.body?.enabled,
    criticality,
  });
  if (Array.isArray(req.body?.tagIds)) {
    db.setThreatKeywordTagsForUser(req.user.id, req.params.id, filterAccessibleTagIds(req.user.id, req.body.tagIds));
  }

  res.json({ success: true, keyword: db.getThreatKeywordByIdForUser(req.user.id, req.params.id) });
});

router.delete("/threat/keywords/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid keyword ID" });
  const existing = db.getThreatKeywordByIdForUser(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: "Keyword not found" });
  if (existing.isSystem) return res.status(403).json({ error: "Default keywords cannot be deleted." });
  db.deleteThreatKeywordById(req.params.id);
  res.json({ success: true });
});

// ===========================================================================
// Tags
// ===========================================================================

router.get("/threat/tags", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const tags = db.listThreatTags(req.user.id);
  res.json({ tags });
});

router.post("/threat/tags", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Tag name is required" });
  if (name.length > 100) return res.status(400).json({ error: "Tag name must be 100 characters or less" });

  const tag = db.createThreatTag({
    name,
    color: String(req.body?.color || "#E53935").trim(),
    description: req.body?.description ? String(req.body.description).trim() : null,
    userId: req.user.id,
  });

  res.json({ success: true, tag });
});

router.put("/threat/tags/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid tag ID" });
  const existing = db.listThreatTags(req.user.id).find((tag) => tag.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Tag not found" });
  if (existing.isSystem) return res.status(403).json({ error: "Default tags cannot be edited." });

  const name = req.body?.name != null ? String(req.body.name).trim() : undefined;
  if (name === "") return res.status(400).json({ error: "Tag name is required" });
  if (name && name.length > 100) return res.status(400).json({ error: "Tag name must be 100 characters or less" });

  const tag = db.updateThreatTag(req.params.id, {
    name,
    color: req.body?.color != null ? String(req.body.color).trim() : undefined,
    description: req.body?.description != null ? String(req.body.description).trim() : undefined,
  });

  if (!tag) return res.status(404).json({ error: "Tag not found" });
  res.json({ success: true, tag });
});

router.delete("/threat/tags/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid tag ID" });
  const existing = db.listThreatTags(req.user.id).find((tag) => tag.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Tag not found" });
  if (existing.isSystem) return res.status(403).json({ error: "Default tags cannot be deleted." });
  db.deleteThreatTagById(req.params.id);
  res.json({ success: true });
});

router.post("/threat/tags/feeds/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return feedAdminOnly(res);
});

router.post("/threat/tags/keywords/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid keyword ID" });
  const keyword = db.getThreatKeywordByIdForUser(req.user.id, req.params.id);
  if (!keyword) return res.status(404).json({ error: "Keyword not found" });

  const tagIds = filterAccessibleTagIds(req.user.id, req.body?.tagIds);
  db.setThreatKeywordTagsForUser(req.user.id, req.params.id, tagIds);
  res.json({ success: true, tags: db.getThreatKeywordTagsForUser(req.user.id, req.params.id) });
});

router.post("/threat/tags/alerts/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid alert ID" });
  const alert = db.getThreatAlertByIdForUser(req.user.id, req.params.id);
  if (!alert) return res.status(404).json({ error: "Alert not found" });

  const tagIds = filterAccessibleTagIds(req.user.id, req.body?.tagIds);
  db.setThreatAlertTagsForUser(req.user.id, req.params.id, tagIds);
  res.json({ success: true, tags: db.getThreatAlertTagsForUser(req.user.id, req.params.id) });
});

// ===========================================================================
// Alerts
// ===========================================================================

// IMPORTANT: read-all MUST be defined BEFORE /:id to avoid route collision
router.put("/threat/alerts/read-all", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const count = db.markAllThreatAlertsReadForUser(req.user.id);
  res.json({ success: true, markedRead: count });
});

router.get("/threat/alerts", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const criticality = THREAT_VALID_CRITICALITIES.has(req.query.criticality) ? req.query.criticality : undefined;
  const isRead = req.query.isRead === "true" ? true : req.query.isRead === "false" ? false : undefined;
  const feedId = typeof req.query.feedId === "string" && req.query.feedId ? req.query.feedId : undefined;
  const keywordId = typeof req.query.keywordId === "string" && req.query.keywordId ? req.query.keywordId : undefined;
  const hours = parseInt(req.query.hours, 10);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  const alerts = db.listThreatAlerts({
    criticality,
    isRead,
    feedId,
    keywordId,
    hours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
    userId: req.user.id,
    limit,
    offset,
  });

  res.json({ alerts });
});

router.get("/threat/alerts/:id", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid alert ID" });
  const alert = db.getThreatAlertByIdForUser(req.user.id, req.params.id);
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  res.json({ alert });
});

router.put("/threat/alerts/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid alert ID" });
  const existing = db.getThreatAlertByIdForUser(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: "Alert not found" });

  const updates = {};
  if (req.body?.isRead != null) updates.isRead = !!req.body.isRead;
  if (req.body?.criticality != null) {
    return res.status(403).json({ error: "Alert criticality is determined by your matched keywords." });
  }

  res.json({ success: true, alert: db.updateThreatAlertForUser(req.user.id, req.params.id, updates) });
});

// IMPORTANT: cleanup MUST be defined BEFORE /:id delete to avoid route collision
router.delete("/threat/alerts/cleanup", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat alert cleanup");
});

router.delete("/threat/alerts/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid alert ID" });
  const existing = db.getThreatAlertByIdForUser(req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: "Alert not found" });
  db.hideThreatAlertForUser(req.user.id, req.params.id);
  res.json({ success: true });
});

// ===========================================================================
// Notifications
// ===========================================================================

router.get("/threat/notifications", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat notification policy");
});

router.post("/threat/notifications", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat notification policy");
});

router.put("/threat/notifications/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat notification policy");
});

router.delete("/threat/notifications/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat notification policy");
});

router.post("/threat/notifications/:id/test", writeLimiter, requireUser, attachUserAccess, requireThreatView, async (req, res) => {
  return adminThreatOnly(res, "Threat notification policy");
});

// ===========================================================================
// User Notifications
// ===========================================================================

router.get("/threat/user-notifications", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const notifications = db.listThreatUserNotifications(req.user.id);
  const notificationPolicy = getThreatNotificationPolicy();
  res.json({
    notifications,
    notificationPolicy,
    allowedChannels: getAllowedThreatChannels(),
    accountEmail: req.user.email || "",
  });
});

router.post("/threat/user-notifications", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const channelType = String(req.body?.channelType || "").trim();
  const allowedChannels = new Set(getAllowedThreatChannels());
  const destination = String(req.body?.destination || "").trim();

  if (!THREAT_VALID_CHANNEL_TYPES.has(channelType)) {
    return res.status(400).json({ error: "Invalid channel type. Must be one of: webhook, email, discord" });
  }
  if (!allowedChannels.has(channelType)) {
    return res.status(403).json({ error: "This notification type is disabled by an administrator" });
  }

  const resolvedDestination = channelType === "email" ? (req.user.email || "") : destination;
  if (!resolvedDestination) {
    return res.status(400).json({ error: channelType === "email" ? "Your account email is required for email notifications" : "Destination is required" });
  }

  const notifications = db.upsertThreatUserNotification({
    userId: req.user.id,
    channelType,
    destination: resolvedDestination,
    enabled: req.body?.enabled !== false,
  });

  res.json({ success: true, notifications });
});

router.delete("/threat/user-notifications/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  if (!validateId(req.params.id)) return res.status(400).json({ error: "Invalid notification ID" });
  db.deleteThreatUserNotificationById(req.params.id, req.user.id);
  res.json({ success: true });
});

// ===========================================================================
// API Templates
// ===========================================================================

router.get("/threat/templates", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat API template management");
});

router.post("/threat/templates", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat API template management");
});

router.put("/threat/templates/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat API template management");
});

router.delete("/threat/templates/:id", writeLimiter, requireUser, attachUserAccess, requireThreatView, (req, res) => {
  return adminThreatOnly(res, "Threat API template management");
});

router.post("/threat/templates/:id/test", writeLimiter, requireUser, attachUserAccess, requireThreatView, async (req, res) => {
  return adminThreatOnly(res, "Threat API template management");
});

// ===========================================================================
// Health / Logs
// ===========================================================================

router.get("/threat/health", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const health = db.getThreatFeedHealth();
  res.json({ health });
});

router.get("/threat/feed-errors", requireUser, attachUserAccess, requireThreatView, (req, res) => {
  const errors = db.getThreatFeedErrors();
  res.json({ errors });
});

module.exports = router;
