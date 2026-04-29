const { Router } = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { requireAdmin } = require("./admin");
const {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRoleById,
  listAllBulletins,
  listBulletins,
  getUserById,
  setUserRole,
  listWikiPages,
  getSetting,
  setSetting,
  getWikiStats,
  getThreatStats,
  listThreatFeeds,
  createThreatFeed,
  updateThreatFeed,
  deleteThreatFeedById,
  listThreatNotificationConfigs,
  createThreatNotificationConfig,
  updateThreatNotificationConfig,
  deleteThreatNotificationConfigById,
  listThreatApiTemplates,
  createThreatApiTemplate,
  getThreatApiTemplateById,
  updateThreatApiTemplate,
  deleteThreatApiTemplateById,
  createAuditEvent,
} = require("../database");
const { logEvent, redactObject } = require("../core/logger");
const { ALL_PERMISSIONS, PERMISSION_DEFINITIONS } = require("../access");
const {
  buildVisibleBulletinFeed,
  deleteBulletinWithAssets,
  getBulletinRetentionSettings,
  purgeAllBulletins,
  purgeBulletinsByAuthor,
  updateBulletinRetentionSettings,
} = require("../bulletin-service");
const { forceRefreshAllFeeds, restartFeedFetchInterval, fetchFeedContent } = require("../threat-feed-service");
const { getThreatNotificationPolicy } = require("../threat-notify-service");

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many admin collaboration requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function auditAdmin(req, { category = "admin", action, targetType = null, targetId = null, outcome = "success", metadata = {} }) {
  try {
    createAuditEvent({
      actorUserId: req.user?.id || null,
      actorUsername: req.user?.username || null,
      actorType: "admin",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category,
      action,
      targetType,
      targetId,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
}

router.get("/api/roles", requireAdmin, (req, res) => {
  res.json({ roles: listRoles(), permissions: ALL_PERMISSIONS, permissionDefinitions: PERMISSION_DEFINITIONS });
});

router.post("/api/roles", writeLimiter, requireAdmin, (req, res) => {
  const { name, description, permissions } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Role name is required" });
  }
  const id = crypto.randomBytes(16).toString("base64url");
  createRole({
    id,
    name: name.trim().slice(0, 120),
    description: typeof description === "string" ? description.trim() : "",
    permissions,
  });
  auditAdmin(req, { category: "identity", action: "role_create", targetType: "role", targetId: id, metadata: { name } });
  res.json({ success: true, id });
});

router.put("/api/roles/:id", writeLimiter, requireAdmin, (req, res) => {
  const role = getRoleById(req.params.id);
  if (!role) return res.status(404).json({ error: "Role not found" });
  updateRole({
    id: role.id,
    name: typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : role.name,
    description: typeof req.body?.description === "string" ? req.body.description.trim() : role.description,
    permissions: Array.isArray(req.body?.permissions) ? req.body.permissions : role.permissions,
  });
  auditAdmin(req, { category: "identity", action: "role_update", targetType: "role", targetId: role.id, metadata: { name: req.body?.name || role.name } });
  res.json({ success: true });
});

router.delete("/api/roles/:id", writeLimiter, requireAdmin, (req, res) => {
  const deleted = deleteRoleById(req.params.id);
  if (!deleted) {
    return res.status(400).json({ error: "Role could not be deleted" });
  }
  auditAdmin(req, { category: "identity", action: "role_delete", targetType: "role", targetId: req.params.id });
  res.json({ success: true });
});

router.put("/api/users/:id/role", writeLimiter, requireAdmin, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const role = getRoleById(req.body?.roleId);
  if (!role) return res.status(400).json({ error: "Role not found" });
  setUserRole(user.id, role.id);
  auditAdmin(req, { category: "identity", action: "user_role_update", targetType: "user", targetId: user.id, metadata: { roleId: role.id, roleName: role.name } });
  res.json({ success: true });
});

router.get("/api/bulletins", requireAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const allBulletins = listAllBulletins();
  const activeCount = buildVisibleBulletinFeed(allBulletins, 1, allBulletins.length || 1).total;

  res.json({
    bulletins: listBulletins(page, limit),
    stats: {
      total: allBulletins.length,
      active: activeCount,
    },
    retention: getBulletinRetentionSettings(),
  });
});

router.put("/api/bulletins/settings", writeLimiter, requireAdmin, (req, res) => {
  const retention = updateBulletinRetentionSettings(req.body || {});
  res.json({ success: true, retention });
});

router.delete("/api/bulletins/:id", writeLimiter, requireAdmin, (req, res) => {
  const deleted = deleteBulletinWithAssets(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Bulletin not found" });
  }
  res.json({ success: true });
});

router.post("/api/bulletins/purge-user", writeLimiter, requireAdmin, (req, res) => {
  const user = getUserById(req.body?.userId);
  if (!user) return res.status(400).json({ error: "User not found" });
  const deleted = purgeBulletinsByAuthor(user.id);
  res.json({ success: true, deleted });
});

router.post("/api/bulletins/purge-all", writeLimiter, requireAdmin, (req, res) => {
  const confirm = String(req.body?.confirm || "");
  if (confirm !== "PURGE ALL") {
    return res.status(400).json({ error: "Confirmation text must be PURGE ALL" });
  }
  const deleted = purgeAllBulletins();
  res.json({ success: true, deleted });
});

router.get("/api/wiki/settings", requireAdmin, (req, res) => {
  const teamPages = listWikiPages({ scope: "team" });
  res.json({
    stats: getWikiStats(),
    settings: {
      personalSpacesEnabled: getSetting("wiki_personal_spaces_enabled") !== "false",
      searchResultLimit: parseInt(getSetting("wiki_search_result_limit"), 10) || 20,
      teamHomePageId: String(getSetting("wiki_team_home_page_id") || ""),
    },
    teamPages: teamPages.map((page) => ({
      id: page.id,
      title: page.title,
      slug: page.slug,
      updatedAt: page.updatedAt,
      authorUsername: page.authorUsername || null,
    })),
    recentPages: [...teamPages]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 12),
  });
});

router.put("/api/wiki/settings", writeLimiter, requireAdmin, (req, res) => {
  const personalSpacesEnabled = req.body?.personalSpacesEnabled !== false;
  const searchResultLimit = Math.min(50, Math.max(5, parseInt(req.body?.searchResultLimit, 10) || 20));
  const teamHomePageId = String(req.body?.teamHomePageId || "");
  const teamHomePage = teamHomePageId ? listWikiPages({ scope: "team" }).find((page) => page.id === teamHomePageId) : null;
  if (teamHomePageId && !teamHomePage) {
    return res.status(400).json({ error: "Team home page not found" });
  }

  setSetting("wiki_personal_spaces_enabled", personalSpacesEnabled ? "true" : "false");
  setSetting("wiki_search_result_limit", String(searchResultLimit));
  setSetting("wiki_team_home_page_id", teamHomePageId);

  res.json({
    success: true,
    settings: {
      personalSpacesEnabled,
      searchResultLimit,
      teamHomePageId,
    },
  });
});

// ============================================================
// THREAT INTELLIGENCE
// ============================================================

router.get("/api/threat/stats", requireAdmin, (req, res) => {
  const stats = getThreatStats();
  res.json({
    ...stats,
    feedSources: stats.totalFeeds,
    activeFeeds: stats.activeFeeds,
    totalAlerts: stats.totalAlerts,
    unresolved: stats.unreadAlerts,
  });
});

router.get("/api/threat/feeds", requireAdmin, (req, res) => {
  res.json({ feeds: listThreatFeeds() });
});

router.post("/api/threat/feeds", writeLimiter, requireAdmin, (req, res) => {
  const { name, url, feedType, enabled, isDefault, fetchInterval, feedMetadata } = req.body || {};
  if (!url || !feedType) {
    return res.status(400).json({ error: "URL and feed type are required" });
  }
  const validTypes = ["rss", "website", "api", "onion"];
  if (!validTypes.includes(feedType)) {
    return res.status(400).json({ error: "Invalid feed type. Must be one of: " + validTypes.join(", ") });
  }
  const interval = Math.max(60, Math.min(86400, parseInt(fetchInterval, 10) || 3600));
  const feed = createThreatFeed({
    name: name || url,
    url,
    feedType,
    enabled: enabled !== false,
    isDefault: isDefault === true,
    fetchInterval: interval,
    feedMetadata: feedMetadata ? JSON.stringify(feedMetadata) : "{}",
  });
  res.json({ success: true, feed });
});

router.put("/api/threat/feeds/:id", writeLimiter, requireAdmin, (req, res) => {
  const feedId = req.params.id;
  const validTypes = ["rss", "website", "api", "onion"];
  const updates = {};
  if (typeof req.body?.enabled === "boolean") updates.enabled = req.body.enabled;
  if (typeof req.body?.isDefault === "boolean") updates.isDefault = req.body.isDefault;
  if (typeof req.body?.fetchInterval === "number") updates.fetchInterval = Math.max(60, Math.min(86400, req.body.fetchInterval));
  if (typeof req.body?.name === "string") updates.name = req.body.name;
  if (typeof req.body?.url === "string") updates.url = req.body.url;
  if (typeof req.body?.feedType === "string") {
    if (!validTypes.includes(req.body.feedType)) {
      return res.status(400).json({ error: "Invalid feed type. Must be one of: " + validTypes.join(", ") });
    }
    updates.feedType = req.body.feedType;
  }
  if (typeof req.body?.feedMetadata === "object") updates.feedMetadata = JSON.stringify(req.body.feedMetadata);
  const updated = updateThreatFeed(feedId, updates);
  if (!updated) return res.status(404).json({ error: "Feed not found" });
  res.json({ success: true, feed: updated });
});

router.post("/api/threat/feeds/refresh-all", writeLimiter, requireAdmin, async (req, res) => {
  try {
    const results = await forceRefreshAllFeeds({ forceKeywordScan: true });
    res.json({ success: true, checked: results.length, results });
  } catch (err) {
    res.status(500).json({ error: "Feed refresh failed: " + err.message });
  }
});

router.delete("/api/threat/feeds/:id", writeLimiter, requireAdmin, (req, res) => {
  const deleted = deleteThreatFeedById(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Feed not found" });
  res.json({ success: true });
});

router.get("/api/threat/templates", requireAdmin, (req, res) => {
  res.json({ templates: listThreatApiTemplates() });
});

router.post("/api/threat/templates", writeLimiter, requireAdmin, (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    return res.status(400).json({ error: "Template name is required" });
  }
  const template = createThreatApiTemplate({
    name,
    description: typeof req.body?.description === "string" ? req.body.description.trim() : null,
    configuration: req.body?.configuration || {},
    enabled: req.body?.enabled !== false,
  });
  res.json({ success: true, template });
});

router.put("/api/threat/templates/:id", writeLimiter, requireAdmin, (req, res) => {
  const template = updateThreatApiTemplate(req.params.id, {
    name: typeof req.body?.name === "string" ? req.body.name.trim() : undefined,
    description: typeof req.body?.description === "string" ? req.body.description.trim() : undefined,
    configuration: req.body?.configuration,
    enabled: req.body?.enabled,
  });
  if (!template) return res.status(404).json({ error: "Template not found" });
  res.json({ success: true, template });
});

router.delete("/api/threat/templates/:id", writeLimiter, requireAdmin, (req, res) => {
  const template = getThreatApiTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  if (template.isSystem) return res.status(403).json({ error: "System templates cannot be deleted." });
  deleteThreatApiTemplateById(req.params.id);
  res.json({ success: true });
});

router.post("/api/threat/templates/:id/test", writeLimiter, requireAdmin, async (req, res) => {
  const template = getThreatApiTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });

  try {
    const result = await fetchFeedContent({
      feedType: "api",
      url: template.configuration?.endpoint || "",
      feedMetadata: { template_id: template.id },
    });
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: "Template test failed", details: error.message });
  }
});

router.get("/api/threat/settings", requireAdmin, (req, res) => {
  const fetchIntervalSeconds = parseInt(getSetting("threat_fetch_interval_seconds") || getSetting("threat_fetch_interval"), 10) || 1800;
  res.json({
    autoFetch: (getSetting("threat_auto_fetch_enabled") || getSetting("threat_auto_fetch")) === "true",
    fetchInterval: Math.max(1, Math.round(fetchIntervalSeconds / 60)),
    alertRetentionDays: parseInt(getSetting("threat_alert_retention_days"), 10) || 14,
    torProxyUrl: getSetting("threat_tor_proxy_url") || "",
    notificationChannels: getThreatNotificationPolicy(),
  });
});

router.put("/api/threat/settings", writeLimiter, requireAdmin, (req, res) => {
  const autoFetch = req.body?.autoFetch === true;
  const fetchIntervalMinutes = Math.min(1440, Math.max(1, parseInt(req.body?.fetchInterval, 10) || 30));
  const fetchIntervalSeconds = fetchIntervalMinutes * 60;
  const alertRetentionDays = Math.min(365, Math.max(1, parseInt(req.body?.alertRetentionDays, 10) || 14));
  const torProxyUrl = typeof req.body?.torProxyUrl === "string" ? req.body.torProxyUrl.trim() : "";
  const policy = req.body?.notificationChannels || {};
  const emailPolicy = policy.email || {};
  const webhookPolicy = policy.webhook || {};
  const discordPolicy = policy.discord || {};

  setSetting("threat_auto_fetch_enabled", autoFetch ? "true" : "false");
  setSetting("threat_fetch_interval_seconds", String(fetchIntervalSeconds));
  setSetting("threat_alert_retention_days", String(alertRetentionDays));
  setSetting("threat_tor_proxy_url", torProxyUrl);
  setSetting("threat_notify_email_enabled", emailPolicy.enabled === false ? "false" : "true");
  setSetting("threat_notify_email_from_override", typeof emailPolicy.fromOverride === "string" ? emailPolicy.fromOverride.trim() : "");
  setSetting("threat_notify_webhook_enabled", webhookPolicy.enabled === false ? "false" : "true");
  setSetting("threat_notify_discord_enabled", discordPolicy.enabled === false ? "false" : "true");
  setSetting("threat_notify_discord_username", typeof discordPolicy.username === "string" ? discordPolicy.username.trim() : "");
  setSetting("threat_notify_discord_avatar_url", typeof discordPolicy.avatarUrl === "string" ? discordPolicy.avatarUrl.trim() : "");

  restartFeedFetchInterval();

  res.json({
    success: true,
    autoFetch,
    fetchInterval: fetchIntervalMinutes,
    alertRetentionDays,
    torProxyUrl,
    notificationChannels: getThreatNotificationPolicy(),
  });
});

router.get("/api/threat/notifications", requireAdmin, (req, res) => {
  res.json({ notifications: listThreatNotificationConfigs() });
});

router.post("/api/threat/notifications", writeLimiter, requireAdmin, (req, res) => {
  const { name, channelType, destination, enabled } = req.body || {};
  if (!name || !channelType || !destination) {
    return res.status(400).json({ error: "Name, channel type, and destination are required" });
  }
  const validChannels = ["webhook", "email", "discord"];
  if (!validChannels.includes(String(channelType).trim())) {
    return res.status(400).json({ error: "Invalid channel type. Must be one of: " + validChannels.join(", ") });
  }
  const notification = createThreatNotificationConfig({
    name: String(name).trim(),
    channelType: String(channelType).trim(),
    destination: String(destination).trim(),
    enabled: enabled !== false,
  });
  res.json({ success: true, notification });
});

router.put("/api/threat/notifications/:id", writeLimiter, requireAdmin, (req, res) => {
  const updated = updateThreatNotificationConfig(req.params.id, {
    name: typeof req.body?.name === "string" ? req.body.name.trim() : undefined,
    destination: typeof req.body?.destination === "string" ? req.body.destination.trim() : undefined,
    enabled: req.body?.enabled,
  });
  if (!updated) return res.status(404).json({ error: "Notification config not found" });
  res.json({ success: true, notification: updated });
});

router.delete("/api/threat/notifications/:id", writeLimiter, requireAdmin, (req, res) => {
  const deleted = deleteThreatNotificationConfigById(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Notification config not found" });
  res.json({ success: true });
});

module.exports = router;
