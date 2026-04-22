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
} = require("../database");
const { ALL_PERMISSIONS, PERMISSION_DEFINITIONS } = require("../access");
const {
  buildVisibleBulletinFeed,
  deleteBulletinWithAssets,
  getBulletinRetentionSettings,
  purgeAllBulletins,
  purgeBulletinsByAuthor,
  updateBulletinRetentionSettings,
} = require("../bulletin-service");

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many admin collaboration requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  res.json({ success: true });
});

router.delete("/api/roles/:id", writeLimiter, requireAdmin, (req, res) => {
  const deleted = deleteRoleById(req.params.id);
  if (!deleted) {
    return res.status(400).json({ error: "Role could not be deleted" });
  }
  res.json({ success: true });
});

router.put("/api/users/:id/role", writeLimiter, requireAdmin, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const role = getRoleById(req.body?.roleId);
  if (!role) return res.status(400).json({ error: "Role not found" });
  setUserRole(user.id, role.id);
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

module.exports = router;
