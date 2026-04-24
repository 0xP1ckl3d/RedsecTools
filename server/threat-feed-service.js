"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const Parser = require("rss-parser");
const cheerio = require("cheerio");
const { SocksProxyAgent } = require("socks-proxy-agent");

const db = require("./database");
const { deliverAlertNotifications } = require("./threat-notify-service");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CRITICALITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };
const DEFAULT_FETCH_INTERVAL_SEC = 3600;
const MAX_ALERT_CONTENT_LENGTH = 12000;
const CONTEXT_WINDOW = 200;
const HTTP_TIMEOUT_MS = 30000;
const IPV4_RETRY_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"]);

function safeText(value) {
  return value == null ? "" : String(value);
}

function normalizeWhitespace(value) {
  return safeText(value).replace(/\s+/g, " ").trim();
}

function truncateText(value, max) {
  const text = normalizeWhitespace(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function parsePublishedAt(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function resolveHttpUrl(value, baseUrl = "") {
  const raw = safeText(value).trim();
  if (!raw) return "";
  try {
    const resolved = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    return /^https?:$/i.test(resolved.protocol) ? resolved.toString() : "";
  } catch (_) {
    return "";
  }
}

function extractFirstImageFromHtml(html, baseUrl = "") {
  const markup = safeText(html);
  if (!markup || !markup.includes("<")) return "";
  try {
    const $ = cheerio.load(markup);
    const selectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      "img",
    ];
    for (const selector of selectors) {
      const node = $(selector).first();
      if (!node.length) continue;
      const candidate = node.attr("content") || node.attr("src");
      const resolved = resolveHttpUrl(candidate, baseUrl);
      if (resolved) return resolved;
    }
  } catch (_) {
    return "";
  }
  return "";
}

function buildArticleSummary(text, fallback = "") {
  const summary = truncateText(text || fallback, 240);
  return summary || truncateText(fallback, 240);
}

function storeThreatArticle(feed, article) {
  if (!feed?.id || !article?.articleHash || !article?.headline) return null;
  return db.createOrUpdateThreatArticle({
    feedId: feed.id,
    articleHash: article.articleHash,
    headline: truncateText(article.headline, 255) || "Threat intelligence article",
    summary: buildArticleSummary(article.summary, article.content),
    content: safeText(article.content).slice(0, MAX_ALERT_CONTENT_LENGTH),
    articleUrl: article.articleUrl || null,
    imageUrl: article.imageUrl || null,
    apiMetadata: article.apiMetadata || {},
    publishedAt: article.publishedAt || null,
  });
}

function pickImageFromMetadata(metadata, baseUrl = "") {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const candidates = [
    source.image,
    source.imageUrl,
    source.image_url,
    source.thumbnail,
    source.thumbnail_url,
    source.cover,
    source.cover_image,
    source.featured_image,
    source.banner,
    source.banner_url,
    source.logo,
    source.media_url,
  ];
  for (const candidate of candidates) {
    const resolved = resolveHttpUrl(candidate, baseUrl);
    if (resolved) return resolved;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Feed Fetchers
// ---------------------------------------------------------------------------

async function fetchRssFeed(url) {
  const parser = new Parser({
    timeout: 30000,
    customFields: {
      item: [
        ["media:content", "mediaContent", { keepArray: true }],
        ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
        ["content:encoded", "contentEncoded"],
        ["description", "description"],
      ],
    },
  });
  const feed = await parser.parseURL(url);
  const content = JSON.stringify(feed);
  const hash = sha256(content);
  const entries = (feed.items || []).map((item) => ({
    title: item.title || "",
    link: item.link || "",
    content: item.content || item.contentEncoded || item.description || item.contentSnippet || "",
    pubDate: item.pubDate || item.isoDate || "",
    creator: item.creator || "",
    imageUrl: resolveHttpUrl(
      item.enclosure?.url
      || item.mediaContent?.[0]?.$?.url
      || item.mediaContent?.[0]?.url
      || item.mediaThumbnail?.[0]?.$?.url
      || item.mediaThumbnail?.[0]?.url
      || extractFirstImageFromHtml(item.content || item.contentEncoded || item.description || "", item.link || url),
      item.link || url
    ),
  }));
  return { success: true, content, hash, entries };
}

async function fetchWebsiteFeed(url) {
  const html = await httpGet(url);
  const $ = cheerio.load(html);
  // Extract visible text from body
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const title = $("head title").first().text().trim() || $('meta[property="og:title"]').attr("content") || "";
  const summary = $('meta[name="description"]').attr("content")
    || $('meta[property="og:description"]').attr("content")
    || bodyText.slice(0, 280);
  const imageUrl = resolveHttpUrl(
    $('meta[property="og:image"]').attr("content")
    || $('meta[name="twitter:image"]').attr("content")
    || $("img").first().attr("src"),
    url
  );
  const hash = sha256(bodyText);
  return { success: true, content: bodyText, hash, title, summary, imageUrl, articleUrl: url };
}

async function fetchApiFeed(url, templateConfig) {
  const config = templateConfig || {};
  const endpoint = config.endpoint || url;
  const method = (config.method || "GET").toUpperCase();
  const headers = config.headers || {};
  const authCfg = config.auth || { type: "none" };
  const fieldMapping = config.field_mapping || {};

  // Build request headers
  const reqHeaders = { ...headers };
  if (authCfg.type === "bearer" && authCfg.token) {
    reqHeaders["Authorization"] = `Bearer ${authCfg.token}`;
  } else if (authCfg.type === "header" && authCfg.headerName && authCfg.headerValue) {
    reqHeaders[authCfg.headerName] = authCfg.headerValue;
  }

  const bodyText = await httpGet(endpoint, reqHeaders);
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = { raw: bodyText };
  }

  // Handle pagination - extract last page indicator
  const pagination = config.pagination || null;
  let results = parsed;
  if (pagination && pagination.data_path) {
    results = getNestedValue(parsed, pagination.data_path) || parsed;
  }

  // Normalize to array of records
  const records = Array.isArray(results) ? results : [results];
  const contentFields = fieldMapping.content_fields || [];
  const metadataFields = fieldMapping.metadata_fields || {};

  const apiMetadata = {};
  if (metadataFields) {
    for (const [metaKey, fieldPath] of Object.entries(metadataFields)) {
      apiMetadata[metaKey] = fieldPath;
    }
  }

  const normalized = records.map((record) => {
    const parts = contentFields.map((f) => String(getNestedValue(record, f) || ""));
    const text = parts.join(" ").trim();
    const meta = {};
    if (metadataFields) {
      for (const [metaKey, fieldPath] of Object.entries(metadataFields)) {
        meta[metaKey] = String(getNestedValue(record, fieldPath) || "");
      }
    }
    return { content: text, metadata: meta };
  });

  const content = JSON.stringify(normalized);
  const hash = sha256(content);
  return { success: true, content, hash, apiMetadata: normalized };
}

async function fetchOnionFeed(url) {
  const proxyUrl = db.getSetting("threat_tor_proxy_url") || process.env.TOR_PROXY || "socks5h://127.0.0.1:9050";
  const agent = new SocksProxyAgent(proxyUrl);
  const html = await httpGet(url, {}, agent);
  const $ = cheerio.load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const hash = sha256(bodyText);
  return { success: true, content: bodyText, hash };
}

// ---------------------------------------------------------------------------
// Generic HTTP GET
// ---------------------------------------------------------------------------

function shouldRetryWithIpv4(error) {
  if (!error) return false;
  if (error.name === "AggregateError") return true;
  if (error.code && IPV4_RETRY_CODES.has(error.code)) return true;
  return /timeout|timed out|network|socket/i.test(String(error.message || ""));
}

function describeError(error) {
  if (!error) return "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (message) return message;
  if (error.code && error.name && error.name !== "Error") return `${error.name} (${error.code})`;
  if (error.code) return String(error.code);
  if (error.name) return String(error.name);
  return "";
}

function normalizeErrorMessage(error, url) {
  if (error && Array.isArray(error.errors) && error.errors.length > 0) {
    const nested = error.errors.map((entry) => describeError(entry)).filter(Boolean);
    if (nested.length > 0) {
      return nested.join("; ");
    }
  }
  return describeError(error) || `Request failed for ${url}`;
}

function httpGetInternal(url, headers = {}, agent = null, options = {}) {
  const preferIpv4 = options.preferIpv4 === true;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: {
        "User-Agent": "RedSecThreatBot/1.0",
        ...headers,
      },
      timeout: HTTP_TIMEOUT_MS,
    };

    if (agent) {
      options.agent = agent;
    }
    if (preferIpv4 && !agent) {
      options.family = 4;
    }

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      const timeoutError = new Error(`Request timeout for ${url}`);
      timeoutError.code = "ETIMEDOUT";
      req.destroy(timeoutError);
    });
    req.end();
  });
}

async function httpGet(url, headers = {}, agent = null) {
  try {
    return await httpGetInternal(url, headers, agent);
  } catch (error) {
    if (!agent && shouldRetryWithIpv4(error)) {
      return await httpGetInternal(url, headers, agent, { preferIpv4: true });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public fetch wrapper (for manual trigger / testing)
// ---------------------------------------------------------------------------

async function fetchFeedContent(feed) {
  const feedType = feed.feedType;
  let templateConfig = null;

  if (feedType === "api") {
    const metadata = feed.feedMetadata || {};
    if (metadata.template_id) {
      const template = db.getThreatApiTemplateById(metadata.template_id);
      if (template) {
        templateConfig = template.configuration;
      }
    }
  }

  switch (feedType) {
    case "rss":
      return await fetchRssFeed(feed.url);
    case "website":
      return await fetchWebsiteFeed(feed.url);
    case "api":
      return await fetchApiFeed(feed.url, templateConfig);
    case "onion":
      return await fetchOnionFeed(feed.url);
    default:
      return { success: false, content: "", hash: null, error: `Unknown feed type: ${feedType}` };
  }
}

// ---------------------------------------------------------------------------
// Keyword Matching
// ---------------------------------------------------------------------------

function matchKeywords(text, keywords) {
  const matches = [];

  for (const kw of keywords) {
    const pattern = kw.keyword;
    let regex;

    if (kw.isRegex) {
      try {
        regex = new RegExp(pattern, kw.caseSensitive ? "g" : "gi");
      } catch {
        continue; // Skip invalid regex
      }
    } else {
      // Plain text - escape for regex, find all occurrences
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(escaped, kw.caseSensitive ? "g" : "gi");
    }

    let match;
    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0];
      const matchStart = match.index;
      const matchEnd = matchStart + matchedText.length;

      // Extract context window (200 chars around match)
      const ctxStart = Math.max(0, matchStart - CONTEXT_WINDOW);
      const ctxEnd = Math.min(text.length, matchEnd + CONTEXT_WINDOW);
      const context = text.slice(ctxStart, ctxEnd);

      // Compute context hash from normalized surrounding text
      const normalized = context.toLowerCase().replace(/\s+/g, " ").trim();
      const contextHash = sha256(normalized);

      matches.push({
        keyword: kw,
        matchedText,
        context,
        contextHash,
      });

      // Prevent infinite loops on zero-length matches
      if (match[0].length === 0) regex.lastIndex++;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// IOC Extraction
// ---------------------------------------------------------------------------

function extractIOCs(text) {
  const results = {
    cves: [],
    ipv4: [],
    sha256: [],
    sha1: [],
    md5: [],
    urls: [],
    domains: [],
  };

  if (!text || typeof text !== "string") return results;

  // CVEs
  const cveRe = /\bCVE-\d{4}-\d{4,7}\b/gi;
  let cveMatch;
  const cveSet = new Set();
  while ((cveMatch = cveRe.exec(text)) !== null) {
    cveSet.add(cveMatch[0].toUpperCase());
  }
  results.cves = [...cveSet];

  // IPv4 - exclude private ranges
  const ipv4Re = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
  let ipMatch;
  const ipSet = new Set();
  while ((ipMatch = ipv4Re.exec(text)) !== null) {
    const ip = ipMatch[1];
    if (isPrivateIP(ip)) continue;
    ipSet.add(ip);
  }
  results.ipv4 = [...ipSet];

  // SHA-256 (64 hex chars) - process first, then remove from text
  let workingText = text;
  const sha256Re = /\b([0-9a-fA-F]{64})\b/g;
  let hashMatch;
  const sha256Set = new Set();
  const sha256Matches = [];
  while ((hashMatch = sha256Re.exec(workingText)) !== null) {
    const h = hashMatch[1].toLowerCase();
    if (!isTrivialHash(h, 64)) {
      sha256Set.add(h);
      sha256Matches.push(hashMatch[0]);
    }
  }
  results.sha256 = [...sha256Set].slice(0, 10);
  // Remove matched SHA-256s from working text
  for (const m of sha256Matches) {
    workingText = workingText.replace(m, " ");
  }

  // SHA-1 (40 hex chars)
  const sha1Re = /\b([0-9a-fA-F]{40})\b/g;
  const sha1Set = new Set();
  const sha1Matches = [];
  while ((hashMatch = sha1Re.exec(workingText)) !== null) {
    const h = hashMatch[1].toLowerCase();
    if (!isTrivialHash(h, 40)) {
      sha1Set.add(h);
      sha1Matches.push(hashMatch[0]);
    }
  }
  results.sha1 = [...sha1Set].slice(0, 10);
  for (const m of sha1Matches) {
    workingText = workingText.replace(m, " ");
  }

  // MD5 (32 hex chars)
  const md5Re = /\b([0-9a-fA-F]{32})\b/g;
  const md5Set = new Set();
  const md5Matches = [];
  while ((hashMatch = md5Re.exec(workingText)) !== null) {
    const h = hashMatch[1].toLowerCase();
    if (!isTrivialHash(h, 32)) {
      md5Set.add(h);
      md5Matches.push(hashMatch[0]);
    }
  }
  results.md5 = [...md5Set].slice(0, 10);
  for (const m of md5Matches) {
    workingText = workingText.replace(m, " ");
  }

  // URLs (cap 20)
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi;
  const urlSet = new Set();
  let match;
  while ((match = urlRe.exec(text)) !== null) {
    urlSet.add(match[0].replace(/[.,;:!?\)}\]]+$/, "")); // Strip trailing punctuation
  }
  results.urls = [...urlSet].slice(0, 20);

  // Domains (exclude those already in URLs)
  const domainRe = /\b([a-zA-Z0-9][-a-zA-Z0-9]*\.(?:com|net|org|io|co|dev|app|gov|edu|mil|int|info|biz|xyz|top|ru|cn|uk|de|fr|eu|nl|me|cc|tv|us|ca|au|jp|kr|in|br|mx|za|se|no|fi|dk|pl|it|es|ch|at|be|ie|pt|ro|bg|hr|cz|sk|si|hu|lt|lv|ee|lu|mt|cy|is|li|mc|va|sm|ad|fo|gl|gi|gg|je|im|ax|yt|gp|mq|gf|re|pm|bl|mf|wf|pf|nc|tf|sj|bv|hm|aq|cc|cx|nx|gs|ki|to|tv|ws|vu|tk|pw|fm|mp|gu|pr|vi|as|ck|nu|tk|tl|sb|vu|nr|pf|fj|sb|ws|nz|pk|lk|bd|mm|kh|la|vn|my|sg|id|ph|th|tw|hk|mo|kp|mz|tz|ug|ke|rw|et|mg|mw|zm|bw|na|sz|ls|za|gh|ng|cm|sn|gm|gm|gn|sl|lr|ci|ml|bf|ne|tg|bj|cf|td|cg|cd|ga|gq|st|ao|cv|km|sc|mu|mg|yt|re|km|dj|er|so|ug|ke|mz|tz|mw|rw|bi|km|mg|yt|re|mu|sc))\b/gi;
  const urlDomains = new Set();
  for (const u of results.urls) {
    try {
      urlDomains.add(new URL(u).hostname.toLowerCase());
    } catch { /* skip invalid URLs */ }
  }
  const domainSet = new Set();
  let domainMatch;
  while ((domainMatch = domainRe.exec(text)) !== null) {
    const d = domainMatch[1].toLowerCase();
    if (!urlDomains.has(d)) {
      domainSet.add(d);
    }
  }
  results.domains = [...domainSet].slice(0, 20);

  return results;
}

function isPrivateIP(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isTrivialHash(hash, len) {
  // All zeros
  if (/^0+$/.test(hash)) return true;
  // All 'f'
  if (/^f+$/i.test(hash)) return true;
  // All 'a'
  if (/^a+$/i.test(hash)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Alert Creation Strategies
// ---------------------------------------------------------------------------

function filterKeywordsForFeed(keywords, feedKeywords) {
  if (!Array.isArray(keywords) || !keywords.length) return [];
  if (!Array.isArray(feedKeywords) || !feedKeywords.length) return keywords;
  const feedKeywordIds = new Set(feedKeywords.map((keyword) => keyword.id));
  return keywords.filter((keyword) => !keyword.isSystem || feedKeywordIds.has(keyword.id));
}

function buildUserKeywordSets(feed, lastFetchedAt, options = {}) {
  const contentChanged = options.contentChanged === true;
  const forceKeywordScan = options.forceKeywordScan === true;
  const feedKeywords = db.getThreatFeedKeywords(feed.id);
  const users = db.listThreatUsersEligibleForAlerts().filter((user) => !user.suspended);
  const minimumCreatedAt = lastFetchedAt || 0;

  return users.map((user) => {
    let keywords = filterKeywordsForFeed(db.listEffectiveThreatKeywordsForUser(user.id), feedKeywords);
    if (!contentChanged && !forceKeywordScan) {
      keywords = keywords.filter((keyword) => (keyword.createdAt || 0) > minimumCreatedAt);
    }
    if (!keywords.length) return null;
    return { user, keywords };
  }).filter(Boolean);
}

function dedupeKeywordMatches(matches) {
  const deduped = [];
  const seen = new Set();
  for (const match of matches || []) {
    const key = match?.keyword?.id || match?.keyword?.keyword || match?.matchedText;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return deduped;
}

function collectMatchedUsers(text, userKeywordSets) {
  const matchedUsers = [];
  for (const entry of userKeywordSets) {
    const matches = dedupeKeywordMatches(matchKeywords(text, entry.keywords));
    if (!matches.length) continue;
    matchedUsers.push({
      userId: entry.user.id,
      username: entry.user.username,
      matches,
    });
  }
  return matchedUsers;
}

function flattenMatchedKeywords(userMatches) {
  const deduped = [];
  const seen = new Set();
  for (const userMatch of userMatches || []) {
    for (const match of userMatch.matches || []) {
      const key = match.keyword?.id || match.keyword?.keyword || match.matchedText;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        keyword: match.keyword.keyword,
        keywordId: match.keyword.id,
        matchedText: match.matchedText,
        criticality: match.keyword.criticality,
      });
    }
  }
  return deduped;
}

function attachUserMatchesToAlert(alertId, userMatches) {
  for (const userMatch of userMatches) {
    for (const match of userMatch.matches) {
      db.upsertThreatUserAlertKeyword({
        userId: userMatch.userId,
        alertId,
        keywordId: match.keyword.id,
        matchedText: match.matchedText,
        criticality: match.keyword.criticality,
      });
    }
  }
}

function createSharedAlert(feed, payload, userMatches) {
  const matchedKeywords = flattenMatchedKeywords(userMatches);
  if (!matchedKeywords.length) return null;

  const firstKeyword = matchedKeywords[0];
  const highestCriticality = pickHighestCriticality(matchedKeywords.map((keyword) => keyword.criticality));
  let alert = payload.articleHash ? db.getThreatAlertByArticleHash(feed.id, payload.articleHash) : null;
  let created = false;

  if (!alert) {
    alert = db.createThreatAlert({
      feedId: feed.id,
      keywordId: firstKeyword.keywordId,
      matchedContent: String(payload.matchedContent || firstKeyword.matchedText || "").slice(0, 500),
      context: String(payload.context || "").slice(0, MAX_ALERT_CONTENT_LENGTH),
      contextHash: payload.contextHash || null,
      articleHash: payload.articleHash || null,
      articleUrl: payload.articleUrl || null,
      matchedKeywords,
      apiMetadata: payload.apiMetadata || {},
      criticality: highestCriticality,
    });
    created = true;
    const feedTags = db.getThreatFeedTags(feed.id);
    if (feedTags.length > 0) {
      db.setThreatAlertTags(alert.id, feedTags.map((tag) => tag.id));
    }
  }

  attachUserMatchesToAlert(alert.id, userMatches);
  if (created) {
    queueNotifications(alert);
  }
  return { alert, created };
}

function createRssAlerts(feed, fetchResult, userKeywordSets) {
  const entries = fetchResult.entries || [];
  const alerts = [];

  for (const entry of entries) {
    let plainContent = entry.content || "";
    if (plainContent.includes("<")) {
      try {
        const $ = cheerio.load(plainContent);
        plainContent = $.text().replace(/\s+/g, " ").trim();
      } catch {
        plainContent = String(plainContent || "");
      }
    }
    const articleText = `${entry.title || ""}\n\n${plainContent}`.trim();
    if (!articleText) continue;

    const articleHash = sha256(`${feed.id}:${entry.link || entry.title || articleText}`);
    storeThreatArticle(feed, {
      articleHash,
      headline: entry.title || "Threat intelligence article",
      summary: buildArticleSummary(plainContent, entry.title || ""),
      content: articleText,
      articleUrl: entry.link || null,
      imageUrl: entry.imageUrl || null,
      publishedAt: parsePublishedAt(entry.pubDate),
      apiMetadata: {
        title: entry.title || "",
        link: entry.link || "",
        pubDate: entry.pubDate || "",
        imageUrl: entry.imageUrl || "",
        iocs: extractIOCs(articleText),
      },
    });
    if (db.isThreatAlertSuppressed(feed.id, articleHash, null, null)) continue;

    const userMatches = collectMatchedUsers(articleText, userKeywordSets);
    if (!userMatches.length) continue;

    const summary = (entry.title || userMatches[0].matches[0]?.matchedText || "").trim();
    const shared = createSharedAlert(feed, {
      matchedContent: summary || plainContent.slice(0, 180),
      context: articleText,
      contextHash: sha256(articleText.toLowerCase().replace(/\s+/g, " ").trim()),
      articleHash,
      articleUrl: entry.link || null,
      apiMetadata: {
        title: entry.title || "",
        link: entry.link || "",
        pubDate: entry.pubDate || "",
        imageUrl: entry.imageUrl || "",
        iocs: extractIOCs(articleText),
      },
    }, userMatches);

    if (shared?.created) alerts.push(shared.alert);
  }

  return alerts;
}

function createWebsiteAlerts(feed, fetchResult, userKeywordSets) {
  const content = String(fetchResult.content || "").trim();
  if (!content) return [];

  const articleHash = sha256(`${feed.id}:${fetchResult.hash || content}`);
  storeThreatArticle(feed, {
    articleHash,
    headline: fetchResult.title || feed.name || "Threat intelligence article",
    summary: buildArticleSummary(fetchResult.summary || content, content),
    content,
    articleUrl: fetchResult.articleUrl || feed.url || null,
    imageUrl: fetchResult.imageUrl || null,
    apiMetadata: {
      title: fetchResult.title || "",
      sourceUrl: feed.url || null,
      imageUrl: fetchResult.imageUrl || "",
      iocs: extractIOCs(content),
    },
  });

  const userMatches = collectMatchedUsers(content, userKeywordSets);
  if (!userMatches.length) return [];

  if (db.isThreatAlertSuppressed(feed.id, articleHash, null, null)) return [];

  const firstMatch = userMatches[0].matches[0];
  const shared = createSharedAlert(feed, {
    matchedContent: firstMatch?.matchedText || content.slice(0, 180),
    context: content,
    contextHash: sha256(content.toLowerCase().replace(/\s+/g, " ").trim()),
    articleHash,
    articleUrl: feed.url || null,
    apiMetadata: {
      title: fetchResult.title || "",
      sourceUrl: feed.url || null,
      imageUrl: fetchResult.imageUrl || "",
      iocs: extractIOCs(content),
    },
  }, userMatches);

  return shared?.created ? [shared.alert] : [];
}

function createApiAlerts(feed, fetchResult, userKeywordSets) {
  const apiMetadata = fetchResult.apiMetadata || [];
  if (!apiMetadata.length) return [];

  const alerts = [];

  for (const record of apiMetadata) {
    const recordText = String(record.content || "").trim();
    if (!recordText) continue;

    const recordUrl = record.metadata?.url || record.metadata?.link || record.metadata?.victim_website || null;
    const articleHash = sha256(`${feed.id}:${recordUrl || JSON.stringify(record.metadata || {}) || recordText}`);
    storeThreatArticle(feed, {
      articleHash,
      headline: record.metadata?.victim_name
        || record.metadata?.title
        || record.metadata?.post_title
        || feed.name
        || "Threat intelligence article",
      summary: buildArticleSummary(record.metadata?.description || recordText, recordText),
      content: recordText,
      articleUrl: recordUrl,
      imageUrl: pickImageFromMetadata(record.metadata, recordUrl || feed.url || ""),
      publishedAt: parsePublishedAt(
        record.metadata?.published_at
        || record.metadata?.publishedAt
        || record.metadata?.pubDate
        || record.metadata?.date
      ),
      apiMetadata: {
        record: record.metadata || {},
        imageUrl: pickImageFromMetadata(record.metadata, recordUrl || feed.url || ""),
        iocs: extractIOCs(recordText),
      },
    });

    const userMatches = collectMatchedUsers(recordText, userKeywordSets);
    if (!userMatches.length) continue;

    if (db.isThreatAlertSuppressed(feed.id, articleHash, null, null)) continue;

    const firstMatch = userMatches[0].matches[0];
    const shared = createSharedAlert(feed, {
      matchedContent: record.metadata?.victim_name
        || record.metadata?.title
        || record.metadata?.post_title
        || firstMatch?.matchedText
        || recordText.slice(0, 180),
      context: recordText,
      contextHash: sha256(recordText.toLowerCase().replace(/\s+/g, " ").trim()),
      articleHash,
      articleUrl: recordUrl,
      apiMetadata: {
        record: record.metadata || {},
        iocs: extractIOCs(recordText),
      },
    }, userMatches);

    if (shared?.created) alerts.push(shared.alert);
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Notification Queueing
// ---------------------------------------------------------------------------

function queueNotifications(alert) {
  Promise.resolve()
    .then(async () => {
      const results = await deliverAlertNotifications(alert);
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        action: "threat_notification_dispatch_complete",
        alertId: alert.id,
        deliveries: results.length,
        success: results.filter((result) => result.success).length,
        failed: results.filter((result) => !result.success).length,
      }));
    })
    .catch((err) => {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        action: "threat_notification_queue_error",
        alertId: alert.id,
        error: err.message,
      }));
    });
}

// ---------------------------------------------------------------------------
// Single Feed Check
// ---------------------------------------------------------------------------

async function checkFeed(feedId, options = {}) {
  const forceKeywordScan = options.forceKeywordScan === true;
  const feed = db.getThreatFeedById(feedId);
  if (!feed || !feed.enabled) {
    return { checked: false, reason: "Feed not found or disabled" };
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action: "threat_feed_check_start",
    feedId: feed.id,
    feedName: feed.name,
    feedType: feed.feedType,
  }));

  try {
    const fetchResult = await fetchFeedContent(feed);

    if (!fetchResult.success) {
      const existing = db.getThreatFeedById(feed.id);
      const failures = (existing?.consecutiveFailures || 0) + 1;
      const errorMessage = normalizeErrorMessage({ message: fetchResult.error }, feed.url);
      db.updateThreatFeedFetchStatus(feed.id, {
        hash: existing?.lastContentHash,
        error: errorMessage,
        errorAt: Math.floor(Date.now() / 1000),
        failures,
      });
      return { checked: true, alerts: 0, error: errorMessage };
    }

    // Determine if content changed
    const contentChanged = fetchResult.hash !== feed.lastContentHash;
    const userKeywordSets = buildUserKeywordSets(feed, feed.lastFetchedAt || 0, { contentChanged, forceKeywordScan });
    if (!contentChanged && !forceKeywordScan && userKeywordSets.length === 0) {
      db.updateThreatFeedFetchStatus(feed.id, { hash: fetchResult.hash, failures: 0 });
      return { checked: true, alerts: 0, unchanged: true };
    }

    // Create alerts based on feed type
    let alerts = [];
    switch (feed.feedType) {
      case "rss":
        alerts = createRssAlerts(feed, fetchResult, userKeywordSets);
        break;
      case "website":
      case "onion":
        alerts = createWebsiteAlerts(feed, fetchResult, userKeywordSets);
        break;
      case "api":
        alerts = createApiAlerts(feed, fetchResult, userKeywordSets);
        break;
    }

    // Update fetch status on success
    db.updateThreatFeedFetchStatus(feed.id, { hash: fetchResult.hash, failures: 0 });

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      action: "threat_feed_check_complete",
      feedId: feed.id,
      feedName: feed.name,
      alertsCreated: alerts.length,
      contentChanged,
    }));

    return { checked: true, alerts: alerts.length, contentChanged };
  } catch (err) {
    const existing = db.getThreatFeedById(feed.id);
    const failures = (existing?.consecutiveFailures || 0) + 1;
    const errorMessage = normalizeErrorMessage(err, feed.url);
    db.updateThreatFeedFetchStatus(feed.id, {
      hash: existing?.lastContentHash,
      error: errorMessage,
      errorAt: Math.floor(Date.now() / 1000),
      failures,
    });

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      action: "threat_feed_check_error",
      feedId: feed.id,
      feedName: feed.name,
      error: errorMessage,
    }));

    return { checked: true, alerts: 0, error: errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Check All Due Feeds
// ---------------------------------------------------------------------------

async function checkAllFeeds() {
  const autoEnabled = db.getSetting("threat_auto_fetch_enabled");
  if (autoEnabled !== "true") {
    return { checked: 0, alerts: 0 };
  }

  const feeds = db.listThreatFeeds(true);
  const now = Math.floor(Date.now() / 1000);
  let totalAlerts = 0;
  let checked = 0;

  for (const feed of feeds) {
    const interval = feed.fetchInterval || DEFAULT_FETCH_INTERVAL_SEC;
    const lastFetched = feed.lastFetchedAt || 0;
    const elapsed = now - lastFetched;

    if (elapsed >= interval) {
      const result = await checkFeed(feed.id);
      if (result.checked) {
        checked++;
        totalAlerts += result.alerts || 0;
      }
    }
  }

  return { checked, alerts: totalAlerts };
}

// ---------------------------------------------------------------------------
// Background Scheduling
// ---------------------------------------------------------------------------

let feedIntervalHandle = null;

function startFeedFetchInterval() {
  if (feedIntervalHandle) return; // Already running

  // Run immediately on start
  checkAllFeeds().catch((err) => {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      action: "threat_initial_fetch_error",
      error: err.message,
    }));
  });

  // Determine check interval from settings (default 30 minutes for the scheduler loop)
  const checkIntervalSec = parseInt(db.getSetting("threat_fetch_interval_seconds"), 10) || 1800;
  const intervalMs = checkIntervalSec * 1000;

  feedIntervalHandle = setInterval(async () => {
    try {
      await checkAllFeeds();
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        action: "threat_interval_error",
        error: err.message,
      }));
    }
  }, intervalMs);

  // Prevent the interval from keeping the process alive
  if (feedIntervalHandle.unref) {
    feedIntervalHandle.unref();
  }

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action: "threat_feed_interval_started",
    intervalSec: checkIntervalSec,
  }));
}

function stopFeedFetchInterval() {
  if (feedIntervalHandle) {
    clearInterval(feedIntervalHandle);
    feedIntervalHandle = null;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      action: "threat_feed_interval_stopped",
    }));
  }
}

function restartFeedFetchInterval() {
  stopFeedFetchInterval();
  startFeedFetchInterval();
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function seedDefaults() {
  const summary = db.seedDefaultThreatData() || {};
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    action: "threat_defaults_seeded",
    ...summary,
  }));

  const existingFetchedFeeds = db.listThreatFeeds(true).filter((feed) => !!feed.lastFetchedAt);
  if ((summary.keywordsCreated || 0) > 0 && existingFetchedFeeds.length > 0) {
    setTimeout(() => {
      forceRefreshAllFeeds({ forceKeywordScan: true })
        .then((results) => {
          console.log(JSON.stringify({
            ts: new Date().toISOString(),
            action: "threat_defaults_backfill_complete",
            checked: results.length,
            createdKeywords: summary.keywordsCreated,
          }));
        })
        .catch((error) => {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            action: "threat_defaults_backfill_failed",
            error: error.message,
          }));
        });
    }, 1500);
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function pickHighestCriticality(criticalities) {
  let highest = "low";
  for (const c of criticalities) {
    if ((CRITICALITY_RANK[c] || 0) > (CRITICALITY_RANK[highest] || 0)) {
      highest = c;
    }
  }
  return highest;
}

function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    // Support array index notation: items[0].field
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = current[key];
      if (Array.isArray(current)) {
        current = current[parseInt(index, 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

async function forceRefreshAllFeeds(options = {}) {
  const feeds = db.listThreatFeeds(true);
  const results = [];
  for (const feed of feeds) {
    const result = await checkFeed(feed.id, options);
    results.push({ id: feed.id, name: feed.name, ...result });
  }
  return results;
}

function backfillAlertOwnershipForUser(userId) {
  if (!userId) return 0;
  const alerts = db.listThreatAlerts({ limit: 100000, offset: 0 });
  let touched = 0;

  for (const alert of alerts) {
    const feed = db.getThreatFeedById(alert.feedId);
    if (!feed) continue;
    const keywords = filterKeywordsForFeed(
      db.listEffectiveThreatKeywordsForUser(userId),
      db.getThreatFeedKeywords(feed.id)
    );
    if (!keywords.length) continue;

    const alertText = [
      alert.apiMetadata?.title || "",
      alert.matchedContent || "",
      alert.context || "",
      alert.apiMetadata?.record ? JSON.stringify(alert.apiMetadata.record) : "",
    ].filter(Boolean).join("\n\n");

    const matches = dedupeKeywordMatches(matchKeywords(alertText, keywords));
    if (!matches.length) continue;

    for (const match of matches) {
      db.upsertThreatUserAlertKeyword({
        userId,
        alertId: alert.id,
        keywordId: match.keyword.id,
        matchedText: match.matchedText,
        criticality: match.keyword.criticality,
      });
      touched += 1;
    }
  }

  return touched;
}

module.exports = {
  startFeedFetchInterval,
  restartFeedFetchInterval,
  stopFeedFetchInterval,
  checkFeed,
  checkAllFeeds,
  forceRefreshAllFeeds,
  seedDefaults,
  fetchFeedContent,
  extractIOCs,
  backfillAlertOwnershipForUser,
};
