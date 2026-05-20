const DOMAIN_RE = /^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
const LEAKRADAR_PAGE_SIZE = 100;
const SEARCH_TYPES = new Set(["employees", "customers", "third_parties", "subdomains"]);

function normalizeLeakRadarDomain(raw) {
  let value = String(raw || "").trim().toLowerCase();
  if (!value) return { ok: false, error: "Valid domain required" };
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).hostname.toLowerCase();
    } catch (_) {
      return { ok: false, error: "Valid domain required" };
    }
  }
  value = value.replace(/\/.*$/, "").replace(/^\*\./, "");
  if (!DOMAIN_RE.test(value)) return { ok: false, error: "Valid domain required" };
  return { ok: true, domain: value };
}

function normalizeLeakRadarSearchType(raw) {
  const type = String(raw || "employees").trim().toLowerCase();
  if (!SEARCH_TYPES.has(type)) {
    return { ok: false, error: "Invalid LeakRadar search type" };
  }
  return { ok: true, type };
}

function normalizeLeakRadarPage(raw) {
  const page = parseInt(raw, 10);
  if (!Number.isInteger(page) || page < 1) return 1;
  return Math.min(page, 10000);
}

function normalizeLeakRadarLeakId(raw) {
  const leakId = String(raw || "").trim();
  if (!leakId || leakId.length > 200 || /[\r\n]/.test(leakId)) {
    return { ok: false, error: "Valid leak ID required" };
  }
  return { ok: true, leakId };
}

function arrayFromObjectPath(payload, keys) {
  let cursor = payload;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = cursor[key];
  }
  return Array.isArray(cursor) ? cursor : null;
}

function extractLeakRadarItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.items,
    payload.data,
    payload.results,
    payload.leaks,
    payload.unlocked,
    payload.subdomains,
    payload.records,
    arrayFromObjectPath(payload, ["data", "items"]),
    arrayFromObjectPath(payload, ["data", "results"]),
    arrayFromObjectPath(payload, ["data", "leaks"]),
    arrayFromObjectPath(payload, ["data", "subdomains"]),
    arrayFromObjectPath(payload, ["data", "unlocked"]),
  ];
  return candidates.find(Array.isArray) || [];
}

function readNestedNumber(payload, paths) {
  for (const path of paths) {
    let cursor = payload;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object") {
        cursor = null;
        break;
      }
      cursor = cursor[key];
    }
    if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    if (typeof cursor === "string" && cursor.trim() && Number.isFinite(Number(cursor))) return Number(cursor);
  }
  return null;
}

function readNestedBoolean(payload, paths) {
  for (const path of paths) {
    let cursor = payload;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object") {
        cursor = null;
        break;
      }
      cursor = cursor[key];
    }
    if (typeof cursor === "boolean") return cursor;
  }
  return null;
}

function buildLeakRadarEnvelope(payload, { page = 1, limit = LEAKRADAR_PAGE_SIZE } = {}) {
  const items = extractLeakRadarItems(payload);
  const apiPage = readNestedNumber(payload, [
    ["page"], ["current_page"], ["meta", "page"], ["pagination", "page"],
  ]);
  const apiPageSize = readNestedNumber(payload, [
    ["page_size"], ["pageSize"], ["per_page"], ["limit"], ["meta", "page_size"], ["pagination", "page_size"],
  ]);
  const total = readNestedNumber(payload, [
    ["total"], ["total_count"], ["count"], ["meta", "total"], ["pagination", "total"],
    ["data", "total"], ["data", "count"],
  ]);
  const apiNextPage = readNestedNumber(payload, [
    ["next_page"], ["nextPage"], ["meta", "next_page"], ["pagination", "next_page"],
  ]);
  const apiHasMore = readNestedBoolean(payload, [
    ["has_more"], ["hasMore"], ["meta", "has_more"], ["pagination", "has_more"],
  ]);
  const effectivePage = apiPage || page;
  const inferredUpstreamLimit = total !== null && total < limit && items.length > 0 && items.length < total ? items.length : null;
  const effectiveLimit = apiPageSize || inferredUpstreamLimit || limit;
  const hasMore = apiHasMore !== null ? apiHasMore
    : apiNextPage !== null ? apiNextPage > effectivePage
      : total !== null ? effectivePage * effectiveLimit < total
        : items.length >= effectiveLimit;
  return {
    page: effectivePage,
    limit: effectiveLimit,
    items,
    total,
    hasMore,
    nextPage: hasMore ? (apiNextPage || effectivePage + 1) : null,
    raw: payload,
  };
}

function leakRadarValueContainsDomain(value, domain) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => leakRadarValueContainsDomain(item, domain));
  if (typeof value === "object") return Object.values(value).some((item) => leakRadarValueContainsDomain(item, domain));
  return String(value).toLowerCase().includes(domain);
}

function filterLeakRadarItemsByDomain(items, domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!Array.isArray(items)) return [];
  if (!normalized) return items;
  return items.filter((item) => leakRadarValueContainsDomain(item, normalized));
}

function leakRadarItemMostRecentMs(item) {
  if (!item || typeof item !== "object") return 0;
  const keys = [
    "unlocked_at", "unlockedAt", "added_at", "addedAt", "last_seen_at", "lastSeenAt",
    "updated_at", "updatedAt", "created_at", "createdAt", "date", "timestamp",
  ];
  for (const key of keys) {
    const value = item[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 100000000000 ? value : value * 1000;
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sortLeakRadarItemsByMostRecent(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => leakRadarItemMostRecentMs(b) - leakRadarItemMostRecentMs(a));
}

module.exports = {
  LEAKRADAR_PAGE_SIZE,
  normalizeLeakRadarDomain,
  normalizeLeakRadarSearchType,
  normalizeLeakRadarPage,
  normalizeLeakRadarLeakId,
  buildLeakRadarEnvelope,
  filterLeakRadarItemsByDomain,
  sortLeakRadarItemsByMostRecent,
};
