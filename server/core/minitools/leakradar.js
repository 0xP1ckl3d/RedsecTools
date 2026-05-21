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

function readNestedValue(payload, paths) {
  for (const path of paths) {
    let cursor = payload;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object") {
        cursor = null;
        break;
      }
      cursor = cursor[key];
    }
    if (cursor !== null && cursor !== undefined && cursor !== "") return cursor;
  }
  return null;
}

function pageFromReference(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  try {
    const parsed = new URL(value, "https://api.leakradar.io");
    const page = Number(parsed.searchParams.get("page"));
    return Number.isInteger(page) && page > 0 ? page : null;
  } catch (_) {
    const match = value.match(/[?&]page=(\d+)/i);
    return match ? Number(match[1]) : null;
  }
}

function buildLeakRadarEnvelope(payload, { page = 1, limit = LEAKRADAR_PAGE_SIZE } = {}) {
  const items = extractLeakRadarItems(payload);
  const apiPage = readNestedNumber(payload, [
    ["page"], ["current_page"], ["currentPage"], ["meta", "page"], ["meta", "current_page"],
    ["pagination", "page"], ["pagination", "current_page"],
  ]);
  const apiPageSize = readNestedNumber(payload, [
    ["page_size"], ["pageSize"], ["per_page"], ["perPage"], ["limit"],
    ["meta", "page_size"], ["meta", "per_page"], ["pagination", "page_size"], ["pagination", "per_page"],
  ]);
  const total = readNestedNumber(payload, [
    ["total"], ["total_count"], ["count"], ["meta", "total"], ["pagination", "total"],
    ["data", "total"], ["data", "count"],
  ]);
  const totalPages = readNestedNumber(payload, [
    ["pages"], ["total_pages"], ["totalPages"], ["last_page"], ["lastPage"],
    ["meta", "pages"], ["meta", "total_pages"], ["pagination", "pages"], ["pagination", "total_pages"],
  ]);
  const apiNextPage = pageFromReference(readNestedValue(payload, [
    ["next_page"], ["nextPage"], ["next"], ["links", "next"], ["meta", "next_page"],
    ["meta", "next"], ["pagination", "next_page"], ["pagination", "next"],
  ]));
  const apiHasMore = readNestedBoolean(payload, [
    ["has_more"], ["hasMore"], ["has_next"], ["hasNext"], ["meta", "has_more"], ["meta", "has_next"],
    ["pagination", "has_more"], ["pagination", "has_next"], ["pagination", "hasNext"],
  ]);
  const effectivePage = apiPage || page;
  const inferredUpstreamLimit = total !== null && total < limit && items.length > 0 && items.length < total ? items.length : null;
  const effectiveLimit = apiPageSize || inferredUpstreamLimit || limit;
  const hasMore = apiHasMore !== null ? apiHasMore
    : apiNextPage !== null ? apiNextPage > effectivePage
      : totalPages !== null ? effectivePage < totalPages
      : total !== null ? effectivePage * effectiveLimit < total
        : items.length >= effectiveLimit;
  return {
    page: effectivePage,
    limit: effectiveLimit,
    items,
    total,
    totalPages,
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
