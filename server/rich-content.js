const { isValidBulletinAnimationPreset, isValidBulletinStylePreset } = require("./access");

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
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

function sanitizeAttrs(tagName, attrSource) {
  const attrs = [];
  const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;

  while ((match = attrRegex.exec(attrSource)) !== null) {
    const rawName = String(match[1] || "").toLowerCase();
    const rawValue = match[3] ?? match[4] ?? match[5] ?? "";
    if (rawName.startsWith("on") || rawName === "style" || rawName === "class") continue;

    if (tagName === "a" && rawName === "href") {
      const href = stripUnsafeUrl(rawValue);
      if (href) attrs.push(`href="${escapeHtml(href)}"`);
      continue;
    }

    if (tagName === "img" && rawName === "src") {
      if (/^\/api\/homepage\/bulletin-assets\//.test(rawValue)) {
        attrs.push(`src="${escapeHtml(rawValue)}"`);
      }
      continue;
    }

    if ((tagName === "img" || tagName === "a") && (rawName === "title" || rawName === "alt")) {
      attrs.push(`${rawName}="${escapeHtml(rawValue)}"`);
      continue;
    }
  }

  if (tagName === "a") {
    attrs.push('rel="noopener noreferrer"');
    attrs.push('target="_blank"');
  }

  if (tagName === "img") {
    attrs.push('loading="lazy"');
    attrs.push('decoding="async"');
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

function sanitizeBulletinHtml(input) {
  const source = String(input || "");
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const withoutDangerousBlocks = withoutComments
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");

  return withoutDangerousBlocks.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, rawTagName, rawAttrs) => {
    const tagName = String(rawTagName || "").toLowerCase();
    const isClosing = full.startsWith("</");
    if (!ALLOWED_TAGS.has(tagName)) return "";
    if (isClosing) return `</${tagName}>`;
    const attrs = sanitizeAttrs(tagName, rawAttrs || "");
    if (tagName === "br" || full.endsWith("/>")) {
      return `<${tagName}${attrs}>`;
    }
    return `<${tagName}${attrs}>`;
  });
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
