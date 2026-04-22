const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const {
  createWikiPage,
  updateWikiPage,
  getWikiPageById,
  getWikiPageBySlug,
  listWikiPages,
  searchWikiPages,
  deleteWikiPageById,
  listWikiRevisions,
  getWikiRevisionById,
} = require("../database");
const { renderMarkdownToHtml } = require("../wiki-render");

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
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

function canManageWiki(req) {
  return req.access.permissionSet.has("wiki.manage");
}

function canEditAnyWiki(req) {
  return req.access.permissionSet.has("wiki.edit_any") || canManageWiki(req);
}

router.get("/wiki/pages", requireUser, attachUserAccess, (req, res) => {
  if (!req.access.permissionSet.has("wiki.view")) {
    return res.status(403).json({ error: "Wiki access denied" });
  }
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pages = query ? searchWikiPages(query) : listWikiPages();
  res.json({ pages });
});

router.get("/wiki/pages/slug/:slug", requireUser, attachUserAccess, (req, res) => {
  if (!req.access.permissionSet.has("wiki.view")) {
    return res.status(403).json({ error: "Wiki access denied" });
  }
  const page = getWikiPageBySlug(req.params.slug);
  if (!page) return res.status(404).json({ error: "Wiki page not found" });
  res.json({ page, revisions: listWikiRevisions(page.id) });
});

router.get("/wiki/pages/:id", requireUser, attachUserAccess, (req, res) => {
  if (!req.access.permissionSet.has("wiki.view")) {
    return res.status(403).json({ error: "Wiki access denied" });
  }
  const page = getWikiPageById(req.params.id);
  if (!page) return res.status(404).json({ error: "Wiki page not found" });
  res.json({ page, revisions: listWikiRevisions(page.id) });
});

router.post("/wiki/pages", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!req.access.permissionSet.has("wiki.create")) {
    return res.status(403).json({ error: "Wiki create access denied" });
  }

  const { title, slug, bodyMarkdown, parentPageId } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Wiki title is required" });
  }
  const safeSlug = normalizeSlug(slug || title);
  if (!safeSlug) return res.status(400).json({ error: "Wiki slug is required" });
  if (getWikiPageBySlug(safeSlug)) {
    return res.status(409).json({ error: "Wiki slug already exists" });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  createWikiPage({
    id,
    slug: safeSlug,
    title: title.trim().slice(0, 160),
    bodyMarkdown: typeof bodyMarkdown === "string" ? bodyMarkdown : "",
    bodyHtml: renderMarkdownToHtml(bodyMarkdown || ""),
    parentPageId: typeof parentPageId === "string" && parentPageId ? parentPageId : null,
    authorId: req.user.id,
  });
  res.json({ success: true, id, slug: safeSlug });
});

router.put("/wiki/pages/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page) return res.status(404).json({ error: "Wiki page not found" });
  if (page.author_id !== req.user.id && !canEditAnyWiki(req)) {
    return res.status(403).json({ error: "Wiki edit access denied" });
  }

  const safeSlug = normalizeSlug(req.body?.slug || page.slug || req.body?.title || page.title);
  const slugOwner = getWikiPageBySlug(safeSlug);
  if (slugOwner && slugOwner.id !== page.id) {
    return res.status(409).json({ error: "Wiki slug already exists" });
  }

  updateWikiPage({
    id: page.id,
    slug: safeSlug,
    title: typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 160) : page.title,
    bodyMarkdown: typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : page.body_markdown,
    bodyHtml: renderMarkdownToHtml(typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : page.body_markdown),
    parentPageId: req.body?.parentPageId === undefined ? page.parent_page_id : (req.body.parentPageId || null),
    authorId: req.user.id,
  });
  res.json({ success: true });
});

router.delete("/wiki/pages/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page) return res.status(404).json({ error: "Wiki page not found" });
  if (page.author_id !== req.user.id && !canManageWiki(req)) {
    return res.status(403).json({ error: "Wiki delete access denied" });
  }
  deleteWikiPageById(page.id);
  res.json({ success: true });
});

router.post("/wiki/pages/:id/restore/:revisionId", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page) return res.status(404).json({ error: "Wiki page not found" });
  if (page.author_id !== req.user.id && !canEditAnyWiki(req)) {
    return res.status(403).json({ error: "Wiki edit access denied" });
  }
  const revision = getWikiRevisionById(req.params.revisionId);
  if (!revision || revision.page_id !== page.id) {
    return res.status(404).json({ error: "Wiki revision not found" });
  }
  updateWikiPage({
    id: page.id,
    slug: page.slug,
    title: revision.title,
    bodyMarkdown: revision.body_markdown,
    bodyHtml: revision.body_html,
    parentPageId: page.parent_page_id,
    authorId: req.user.id,
  });
  res.json({ success: true });
});

module.exports = router;
