const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const {
  createWikiPage,
  updateWikiPage,
  reorderWikiPages,
  getWikiPageById,
  getWikiPageBySlug,
  listWikiPages,
  searchWikiPages,
  deleteWikiPageById,
  listWikiRevisions,
  getWikiRevisionById,
  getSetting,
  getWikiStats,
} = require("../database");
const { renderMarkdownToHtml, markdownToExcerpt } = require("../wiki-render");

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "Too many wiki requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getWikiSettings() {
  const searchLimit = Math.min(50, Math.max(5, parseInt(getSetting("wiki_search_result_limit"), 10) || 20));
  return {
    personalSpacesEnabled: getSetting("wiki_personal_spaces_enabled") !== "false",
    searchResultLimit: searchLimit,
    teamHomePageId: String(getSetting("wiki_team_home_page_id") || ""),
  };
}

function getWikiCapabilities(req, settings) {
  const set = req.access.permissionSet;
  return {
    canUseWiki: [
      "wiki.view",
      "wiki.create_personal",
      "wiki.create_team",
      "wiki.edit_team",
      "wiki.manage",
    ].some((permission) => set.has(permission)),
    canViewTeam: [
      "wiki.view",
      "wiki.create_team",
      "wiki.edit_team",
      "wiki.manage",
    ].some((permission) => set.has(permission)),
    canViewPersonal: settings.personalSpacesEnabled && [
      "wiki.view",
      "wiki.create_personal",
      "wiki.manage",
    ].some((permission) => set.has(permission)),
    canCreatePersonal: settings.personalSpacesEnabled && (set.has("wiki.create_personal") || set.has("wiki.manage")),
    canCreateTeam: set.has("wiki.create_team") || set.has("wiki.manage"),
    canEditTeam: set.has("wiki.edit_team") || set.has("wiki.manage"),
    canManage: set.has("wiki.manage"),
  };
}

function getVisiblePages(req, settings) {
  const capabilities = getWikiCapabilities(req, settings);
  const pages = [];
  if (capabilities.canViewTeam) {
    pages.push(...listWikiPages({ scope: "team" }));
  }
  if (capabilities.canViewPersonal) {
    pages.push(...listWikiPages({ scope: "personal", ownerId: req.user.id }));
  }
  return pages;
}

function canViewPage(req, page, settings = getWikiSettings()) {
  if (!page) return false;
  const capabilities = getWikiCapabilities(req, settings);
  if (page.scope === "team") return capabilities.canViewTeam;
  if (page.scope === "personal") return capabilities.canViewPersonal && page.ownerId === req.user.id;
  return false;
}

function canEditPage(req, page, settings = getWikiSettings()) {
  if (!page) return false;
  const capabilities = getWikiCapabilities(req, settings);
  if (page.scope === "personal") {
    return page.ownerId === req.user.id && capabilities.canCreatePersonal;
  }
  if (page.scope === "team") {
    return capabilities.canManage
      || capabilities.canEditTeam
      || (capabilities.canCreateTeam && page.authorId === req.user.id);
  }
  return false;
}

function canDeletePage(req, page, settings = getWikiSettings()) {
  return canEditPage(req, page, settings);
}

function validateParentForScope(parentPageId, scope, req, settings) {
  if (!parentPageId) return null;
  const parentPage = getWikiPageById(parentPageId);
  if (!parentPage) {
    const error = new Error("Parent page not found");
    error.status = 400;
    throw error;
  }
  if (!canViewPage(req, parentPage, settings) || parentPage.scope !== scope) {
    const error = new Error("Parent page is not available in this wiki space");
    error.status = 400;
    throw error;
  }
  if (scope === "personal" && parentPage.ownerId !== req.user.id) {
    const error = new Error("Parent page must be in your personal wiki");
    error.status = 400;
    throw error;
  }
  return parentPage.id;
}

function ensureUniqueSlug(slug, currentPageId = null) {
  const existing = listWikiPages().find((page) => page.slug === slug && page.id !== currentPageId);
  return !existing;
}

function getNextSortOrder(scope, ownerId, parentPageId) {
  const siblings = listWikiPages({ scope, ownerId: scope === "personal" ? ownerId : "" })
    .filter((page) => (page.parentPageId || null) === (parentPageId || null));
  if (!siblings.length) return 0;
  return Math.max(...siblings.map((page) => Number(page.sortOrder || 0))) + 1;
}

function buildRecentPages(pages, limit = 8) {
  return [...pages]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit);
}

function selectDefaultPage(scope, settings, teamPages, personalPages) {
  if (scope === "personal") {
    return personalPages[0] || null;
  }
  const homePage = settings.teamHomePageId ? teamPages.find((page) => page.id === settings.teamHomePageId) : null;
  if (homePage) return homePage;
  return teamPages.find((page) => !page.parentPageId) || teamPages[0] || personalPages[0] || null;
}

router.get("/wiki/bootstrap", requireUser, attachUserAccess, (req, res) => {
  const settings = getWikiSettings();
  const capabilities = getWikiCapabilities(req, settings);
  if (!capabilities.canUseWiki) {
    return res.status(403).json({ error: "Wiki access denied" });
  }

  const visiblePages = getVisiblePages(req, settings);
  const teamPages = visiblePages.filter((page) => page.scope === "team");
  const personalPages = visiblePages.filter((page) => page.scope === "personal");
  const requestedScope = String(req.query.scope || "team") === "personal" ? "personal" : "team";
  const defaultScope = requestedScope === "personal" && settings.personalSpacesEnabled ? "personal" : "team";

  let selectedPage = null;
  if (typeof req.query.pageId === "string" && req.query.pageId) {
    const requestedPage = getWikiPageById(req.query.pageId);
    if (requestedPage && canViewPage(req, requestedPage, settings)) {
      selectedPage = requestedPage;
    }
  }
  if (!selectedPage) {
    selectedPage = selectDefaultPage(defaultScope, settings, teamPages, personalPages);
  }

  res.json({
    currentUserId: req.user.id,
    currentUsername: req.user.username || null,
    settings,
    capabilities,
    stats: getWikiStats(),
    teamPages,
    personalPages,
    recentPages: buildRecentPages(visiblePages),
    selectedPage,
    revisions: selectedPage ? listWikiRevisions(selectedPage.id) : [],
  });
});

router.get("/wiki/search", requireUser, attachUserAccess, (req, res) => {
  const settings = getWikiSettings();
  const capabilities = getWikiCapabilities(req, settings);
  if (!capabilities.canUseWiki) {
    return res.status(403).json({ error: "Wiki access denied" });
  }

  const query = String(req.query.q || "").trim();
  const scope = String(req.query.scope || "all");
  if (!query) {
    return res.json({ results: [] });
  }

  const filtersByScope = [];
  if ((scope === "all" || scope === "team") && capabilities.canViewTeam) {
    filtersByScope.push({ scope: "team", ownerId: "" });
  }
  if ((scope === "all" || scope === "personal") && capabilities.canViewPersonal) {
    filtersByScope.push({ scope: "personal", ownerId: req.user.id });
  }

  const results = filtersByScope.flatMap((filter) => (
    searchWikiPages(query, {
      scope: filter.scope,
      ownerId: filter.ownerId,
      limit: settings.searchResultLimit,
    })
  ));

  const uniqueResults = [];
  const seen = new Set();
  for (const result of results) {
    if (!seen.has(result.id)) {
      seen.add(result.id);
      uniqueResults.push(result);
    }
  }

  res.json({ results: uniqueResults.slice(0, settings.searchResultLimit) });
});

router.post("/wiki/preview", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const settings = getWikiSettings();
  const capabilities = getWikiCapabilities(req, settings);
  if (!capabilities.canUseWiki) {
    return res.status(403).json({ error: "Wiki access denied" });
  }

  const markdown = typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : "";
  res.json({
    html: renderMarkdownToHtml(markdown),
    excerpt: markdownToExcerpt(markdown),
  });
});

router.get("/wiki/pages/:id", requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page || !canViewPage(req, page)) {
    return res.status(404).json({ error: "Wiki page not found" });
  }

  res.json({
    page,
    revisions: listWikiRevisions(page.id),
  });
});

router.get("/wiki/pages/slug/:slug", requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageBySlug(req.params.slug);
  if (!page || !canViewPage(req, page)) {
    return res.status(404).json({ error: "Wiki page not found" });
  }
  res.json({
    page,
    revisions: listWikiRevisions(page.id),
  });
});

router.post("/wiki/pages", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const settings = getWikiSettings();
  const capabilities = getWikiCapabilities(req, settings);
  const scope = String(req.body?.scope || "team") === "personal" ? "personal" : "team";

  if (scope === "personal" && !capabilities.canCreatePersonal) {
    return res.status(403).json({ error: "Personal wiki create access denied" });
  }
  if (scope === "team" && !capabilities.canCreateTeam) {
    return res.status(403).json({ error: "Team wiki create access denied" });
  }

  const title = String(req.body?.title || "").trim();
  const markdown = typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : "";
  if (!title) return res.status(400).json({ error: "Page title is required" });

  const slug = normalizeSlug(req.body?.slug || title);
  if (!slug) return res.status(400).json({ error: "Page slug is required" });
  if (!ensureUniqueSlug(slug)) {
    return res.status(409).json({ error: "Page slug already exists" });
  }

  let parentPageId;
  try {
    parentPageId = validateParentForScope(req.body?.parentPageId || null, scope, req, settings);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const html = renderMarkdownToHtml(markdown);
  createWikiPage({
    id,
    slug,
    title: title.slice(0, 160),
    bodyMarkdown: markdown,
    bodyHtml: html,
    excerpt: markdownToExcerpt(markdown),
    scope,
    ownerId: scope === "personal" ? req.user.id : null,
    parentPageId,
    authorId: req.user.id,
    lastEditorId: req.user.id,
    publishedAt: Math.floor(Date.now() / 1000),
    sortOrder: getNextSortOrder(scope, scope === "personal" ? req.user.id : "", parentPageId),
  });

  res.json({ success: true, id });
});

router.put("/wiki/pages/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const settings = getWikiSettings();
  const page = getWikiPageById(req.params.id);
  if (!page || !canViewPage(req, page, settings)) {
    return res.status(404).json({ error: "Wiki page not found" });
  }
  if (!canEditPage(req, page, settings)) {
    return res.status(403).json({ error: "Wiki edit access denied" });
  }

  const title = String(req.body?.title || page.title || "").trim();
  if (!title) return res.status(400).json({ error: "Page title is required" });
  const slug = normalizeSlug(req.body?.slug || page.slug || title);
  if (!slug) return res.status(400).json({ error: "Page slug is required" });
  if (!ensureUniqueSlug(slug, page.id)) {
    return res.status(409).json({ error: "Page slug already exists" });
  }

  let parentPageId;
  try {
    parentPageId = validateParentForScope(
      req.body?.parentPageId === undefined ? page.parentPageId : req.body.parentPageId,
      page.scope,
      req,
      settings
    );
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  if (parentPageId === page.id) {
    return res.status(400).json({ error: "A page cannot be its own parent" });
  }

  const markdown = typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : page.bodyMarkdown;
  updateWikiPage({
    id: page.id,
    slug,
    title: title.slice(0, 160),
    bodyMarkdown: markdown,
    bodyHtml: renderMarkdownToHtml(markdown),
    excerpt: markdownToExcerpt(markdown),
    scope: page.scope,
    ownerId: page.ownerId,
    parentPageId,
    authorId: req.user.id,
    lastEditorId: req.user.id,
    publishedAt: Math.floor(Date.now() / 1000),
    sortOrder: Number(req.body?.sortOrder ?? page.sortOrder ?? 0),
  });

  res.json({ success: true });
});

router.delete("/wiki/pages/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page || !canViewPage(req, page)) {
    return res.status(404).json({ error: "Wiki page not found" });
  }
  if (!canDeletePage(req, page)) {
    return res.status(403).json({ error: "Wiki delete access denied" });
  }

  deleteWikiPageById(page.id);
  res.json({ success: true });
});

router.patch("/wiki/pages/reorder", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "No items to reorder" });
  if (items.length > 50) return res.status(400).json({ error: "Too many items" });

  for (const item of items) {
    if (typeof item.id !== "string" || !item.id) return res.status(400).json({ error: "Each item requires a valid id" });
    if (typeof item.sortOrder !== "number") return res.status(400).json({ error: "Each item requires a numeric sortOrder" });
    const page = getWikiPageById(item.id);
    if (!page || !canViewPage(req, page)) return res.status(404).json({ error: `Page ${item.id} not found` });
    if (!canEditPage(req, page, getWikiSettings())) return res.status(403).json({ error: `Cannot reorder page ${item.id}` });
  }

  reorderWikiPages(items);
  res.json({ success: true });
});

router.post("/wiki/pages/:id/restore/:revisionId", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page || !canViewPage(req, page)) {
    return res.status(404).json({ error: "Wiki page not found" });
  }
  if (!canEditPage(req, page)) {
    return res.status(403).json({ error: "Wiki edit access denied" });
  }

  const revision = getWikiRevisionById(req.params.revisionId);
  if (!revision || revision.pageId !== page.id) {
    return res.status(404).json({ error: "Wiki revision not found" });
  }

  updateWikiPage({
    id: page.id,
    slug: page.slug,
    title: revision.title,
    bodyMarkdown: revision.bodyMarkdown,
    bodyHtml: revision.bodyHtml,
    excerpt: revision.excerpt || markdownToExcerpt(revision.bodyMarkdown),
    scope: page.scope,
    ownerId: page.ownerId,
    parentPageId: page.parentPageId,
    authorId: req.user.id,
    lastEditorId: req.user.id,
    publishedAt: Math.floor(Date.now() / 1000),
    sortOrder: page.sortOrder,
  });

  res.json({ success: true });
});

module.exports = router;
