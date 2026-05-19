const { isValidBulletinAnimationPreset, isValidBulletinStylePreset } = require("./access");
const cheerio = require("cheerio");

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "span",
  "h1",
  "h2",
  "h3",
  "a",
  "img",
]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripUnsafeUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "";
  if (/^\/\//.test(trimmed)) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

function sanitizeBulletinHtml(input) {
  const source = String(input || "");
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const $ = cheerio.load(withoutComments, { decodeEntities: false }, false);

  $("script, style, iframe, object, embed, svg, math, template").remove();

  function sanitizeElement(_index, element) {
    if (element.type !== "tag") return;
    const tagName = String(element.name || "").toLowerCase();
    const node = $(element);

    if (!ALLOWED_TAGS.has(tagName)) {
      node.replaceWith(node.contents());
      return;
    }

    const originalAttrs = { ...(element.attribs || {}) };
    for (const attrName of Object.keys(originalAttrs)) {
      node.removeAttr(attrName);
    }

    if (tagName === "a") {
      const href = stripUnsafeUrl(originalAttrs.href);
      if (href) node.attr("href", href);
      if (originalAttrs.title) node.attr("title", originalAttrs.title);
      node.attr("rel", "noopener noreferrer");
      node.attr("target", "_blank");
    }

    if (tagName === "img") {
      const src = String(originalAttrs.src || "").trim();
      if (/^\/api\/homepage\/bulletin-assets\/[A-Za-z0-9_-]+$/.test(src)) {
        node.attr("src", src);
      }
      if (originalAttrs.alt) node.attr("alt", originalAttrs.alt);
      if (originalAttrs.title) node.attr("title", originalAttrs.title);
      node.attr("loading", "lazy");
      node.attr("decoding", "async");
    }
  }

  $("*").each(sanitizeElement);

  return $.root().html() || "";
}

function extractBulletinAssetIds(html) {
  const matches = String(html || "").match(/\/api\/homepage\/bulletin-assets\/([A-Za-z0-9_-]+)/g) || [];
  return [...new Set(matches.map((match) => match.split("/").pop()))];
}

function normalizeBulletinPresentation(value, fallbackStyle = "default", fallbackAnimation = "none") {
  return {
    stylePreset: isValidBulletinStylePreset(value?.stylePreset) ? value.stylePreset : fallbackStyle,
    animationPreset: isValidBulletinAnimationPreset(value?.animationPreset) ? value.animationPreset : fallbackAnimation,
  };
}

module.exports = {
  escapeHtml,
  sanitizeBulletinHtml,
  extractBulletinAssetIds,
  normalizeBulletinPresentation,
};
