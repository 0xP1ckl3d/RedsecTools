const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEAKRADAR_PAGE_SIZE,
  normalizeLeakRadarDomain,
  normalizeLeakRadarSearchType,
  normalizeLeakRadarPage,
  normalizeLeakRadarLeakId,
  buildLeakRadarEnvelope,
  filterLeakRadarItemsByDomain,
  sortLeakRadarItemsByMostRecent,
} = require("../server/core/minitools/leakradar");

test("LeakRadar domain normalization accepts bare domains and strips URL paths", () => {
  assert.deepEqual(normalizeLeakRadarDomain("Example.COM"), { ok: true, domain: "example.com" });
  assert.deepEqual(normalizeLeakRadarDomain("https://portal.example.com/path?q=1"), { ok: true, domain: "portal.example.com" });
  assert.equal(normalizeLeakRadarDomain("localhost").ok, false);
  assert.equal(normalizeLeakRadarDomain("https://127.0.0.1").ok, false);
});

test("LeakRadar search type and pagination are constrained", () => {
  assert.deepEqual(normalizeLeakRadarSearchType("third_parties"), { ok: true, type: "third_parties" });
  assert.equal(normalizeLeakRadarSearchType("partners").ok, false);
  assert.equal(normalizeLeakRadarPage("0"), 1);
  assert.equal(normalizeLeakRadarPage("3"), 3);
});

test("LeakRadar leak IDs reject empty and multiline values", () => {
  assert.deepEqual(normalizeLeakRadarLeakId("abc-123"), { ok: true, leakId: "abc-123" });
  assert.equal(normalizeLeakRadarLeakId("").ok, false);
  assert.equal(normalizeLeakRadarLeakId("abc\n123").ok, false);
});

test("LeakRadar envelope extracts common paginated response shapes", () => {
  const envelope = buildLeakRadarEnvelope({
    data: {
      results: [{ id: "1" }, { id: "2" }],
      total: 250,
    },
  }, { page: 2, limit: LEAKRADAR_PAGE_SIZE });

  assert.equal(envelope.limit, 100);
  assert.equal(envelope.items.length, 2);
  assert.equal(envelope.total, 250);
  assert.equal(envelope.hasMore, true);
  assert.equal(envelope.nextPage, 3);
});

test("LeakRadar envelope respects upstream page size for pagination", () => {
  const envelope = buildLeakRadarEnvelope({
    items: Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1) })),
    total: 89,
    page: 1,
    page_size: 30,
  }, { page: 1, limit: LEAKRADAR_PAGE_SIZE });

  assert.equal(envelope.limit, 30);
  assert.equal(envelope.hasMore, true);
  assert.equal(envelope.nextPage, 2);
});

test("LeakRadar envelope accepts upstream total-page and next-link pagination shapes", () => {
  const totalPages = buildLeakRadarEnvelope({
    items: [{ id: "1" }],
    page: 2,
    total_pages: 4,
  }, { page: 2, limit: LEAKRADAR_PAGE_SIZE });
  const nextLink = buildLeakRadarEnvelope({
    data: [{ id: "1" }],
    pagination: {
      page: 3,
      next: "/search/domain/example.com/employees?page=4",
    },
  }, { page: 3, limit: LEAKRADAR_PAGE_SIZE });

  assert.equal(totalPages.hasMore, true);
  assert.equal(totalPages.nextPage, 3);
  assert.equal(totalPages.totalPages, 4);
  assert.equal(nextLink.hasMore, true);
  assert.equal(nextLink.nextPage, 4);
});

test("LeakRadar unlocked filter keeps only records matching the requested domain", () => {
  const items = [
    { id: "1", email_domain: "example.com", username: "a@example.com" },
    { id: "2", url: "https://other.example.org/login" },
    { id: "3", nested: { host: "portal.example.com" } },
  ];
  assert.deepEqual(filterLeakRadarItemsByDomain(items, "example.com").map((item) => item.id), ["1", "3"]);
  assert.deepEqual(filterLeakRadarItemsByDomain(items, "").map((item) => item.id), ["1", "2", "3"]);
});

test("LeakRadar unlocked results sort most recent records first", () => {
  const items = [
    { id: "old", unlocked_at: "2025-01-01T00:00:00Z" },
    { id: "new", unlocked_at: "2026-01-01T00:00:00Z" },
    { id: "epoch", last_seen_at: 1800000000 },
    { id: "added", added_at: "2028-01-01T00:00:00Z" },
  ];
  assert.deepEqual(sortLeakRadarItemsByMostRecent(items).map((item) => item.id), ["added", "epoch", "new", "old"]);
});

test("LeakRadar cache migration creates encrypted unlocked record table", () => {
  const migration = require("../server/core/db/migrations/033_leakradar_unlocked_cache");
  assert.equal(migration.id, "033_leakradar_unlocked_cache");
  assert.match(String(migration.up), /leakradar_unlocked_records/);
  assert.match(String(migration.up), /payload_encrypted/);
});
