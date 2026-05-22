const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const migration = require("../server/core/db/migrations/036_callback_tables");

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migration.up(db);
  return db;
}

function mockReq(overrides = {}) {
  return {
    method: "GET",
    path: "/",
    originalUrl: "/",
    url: "/",
    headers: { "user-agent": "test-agent", "content-type": "text/plain" },
    ip: "127.0.0.1",
    body: null,
    get(key) {
      const lower = key.toLowerCase();
      for (const [k, v] of Object.entries(this.headers)) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    },
    _parsedUrl: { query: "" },
    ...overrides,
  };
}

test("createCallbackUrl creates a live callback URL", () => {
  const db = createDb();
  const origDb = require("../server/database");
  const origGetDb = require("../server/core/minitools/callback");
  require("../server/database").db = db;
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, listCallbackUrls } = require("../server/core/minitools/callback");
  const userId = "user-1";

  const result = createCallbackUrl(userId, 60, "test callback");
  assert.ok(result.ok, result.error);
  assert.ok(result.id);
  assert.equal(result.nickname, "test callback");

  const urls = listCallbackUrls(userId);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].id, result.id);
  assert.equal(urls[0].isDeleted, false);
  assert.equal(urls[0].isExpired, false);
  assert.equal(urls[0].requestCount, 0);

  db.close();
});

test("captureRequest stores a valid request and enforces request cap", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, getCallbackRequests, MAX_REQUESTS_PER_URL } = require("../server/core/minitools/callback");
  const userId = "user-1";

  const url = createCallbackUrl(userId, 60);
  assert.ok(url.ok);

  // Capture up to the cap
  for (let i = 0; i < MAX_REQUESTS_PER_URL; i++) {
    const result = captureRequest(url.id, mockReq({ method: "POST", path: "/test", body: `body-${i}` }));
    assert.equal(result.captured, true);
  }

  const reqs = getCallbackRequests(url.id, userId);
  assert.ok(reqs.ok);
  assert.equal(reqs.requests.length, MAX_REQUESTS_PER_URL);

  // One more — should still be at cap due to pruning
  const overflow = captureRequest(url.id, mockReq({ method: "POST", path: "/overflow", body: "overflow" }));
  assert.equal(overflow.captured, true);

  const afterOverflow = getCallbackRequests(url.id, userId);
  assert.equal(afterOverflow.requests.length, MAX_REQUESTS_PER_URL);

  db.close();
});

test("expired callback does not capture", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest } = require("../server/core/minitools/callback");
  const userId = "user-1";

  // Create URL that expired 100 seconds ago
  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO callback_urls (id, user_id, nickname, created_at, expires_at) VALUES (?, ?, '', ?, ?)").run(
    "expired-id", userId, now - 200, now - 100
  );

  const result = captureRequest("expired-id", mockReq());
  assert.equal(result.captured, false);
  assert.equal(result.reason, "expired");

  db.close();
});

test("deleted callback does not capture", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { captureRequest } = require("../server/core/minitools/callback");
  const userId = "user-1";

  const now = Math.floor(Date.now() / 1000);
  db.prepare("INSERT INTO callback_urls (id, user_id, nickname, created_at, expires_at, deleted_at) VALUES (?, ?, '', ?, ?, ?)").run(
    "deleted-id", userId, now - 200, now + 3600, now - 50
  );

  const result = captureRequest("deleted-id", mockReq());
  assert.equal(result.captured, false);
  assert.equal(result.reason, "deleted");

  db.close();
});

test("non-existent callback returns not_found", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { captureRequest } = require("../server/core/minitools/callback");

  const result = captureRequest("00000000-0000-0000-0000-000000000000", mockReq());
  assert.equal(result.captured, false);
  assert.equal(result.reason, "not_found");

  db.close();
});

test("users cannot read another user's callback requests", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, getCallbackRequests, getRequestDetail } = require("../server/core/minitools/callback");
  const userA = "user-a";
  const userB = "user-b";

  const url = createCallbackUrl(userA, 60);
  assert.ok(url.ok);

  captureRequest(url.id, mockReq({ method: "POST", body: "secret-data" }));

  // userB should be denied
  const result = getCallbackRequests(url.id, userB);
  assert.equal(result.ok, false);
  assert.match(result.error, /denied/i);

  // Get the request ID and check detail access
  const userAReqs = getCallbackRequests(url.id, userA);
  assert.ok(userAReqs.ok);
  assert.equal(userAReqs.requests.length, 1);

  const detailB = getRequestDetail(userAReqs.requests[0].id, userB);
  assert.equal(detailB.ok, false);
  assert.match(detailB.error, /denied/i);

  const detailA = getRequestDetail(userAReqs.requests[0].id, userA);
  assert.ok(detailA.ok);
  assert.equal(detailA.request.body, "secret-data");

  db.close();
});

test("max live URL limit is enforced", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, MAX_LIVE_URLS } = require("../server/core/minitools/callback");
  const userId = "user-1";

  for (let i = 0; i < MAX_LIVE_URLS; i++) {
    const result = createCallbackUrl(userId, 60, `url-${i}`);
    assert.ok(result.ok, `Failed at URL ${i}: ${result.error}`);
  }

  // One more should fail
  const overflow = createCallbackUrl(userId, 60, "overflow");
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /maximum/i);

  db.close();
});

test("captureRequest stores subpaths and query strings", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, getCallbackRequests, getRequestDetail } = require("../server/core/minitools/callback");
  const userId = "user-1";

  const url = createCallbackUrl(userId, 60);
  assert.ok(url.ok);

  captureRequest(url.id, mockReq({
    method: "POST",
    path: "/deep/nested/path",
    originalUrl: "/deep/nested/path?foo=bar&baz=123",
    _parsedUrl: { query: "foo=bar&baz=123" },
    body: "test-body",
  }));

  const reqs = getCallbackRequests(url.id, userId);
  assert.ok(reqs.ok);
  assert.equal(reqs.requests.length, 1);
  assert.equal(reqs.requests[0].path, "/deep/nested/path");
  assert.equal(reqs.requests[0].query, "foo=bar&baz=123");

  const detail = getRequestDetail(reqs.requests[0].id, userId);
  assert.ok(detail.ok);
  assert.equal(detail.request.path, "/deep/nested/path");
  assert.equal(detail.request.query, "foo=bar&baz=123");

  db.close();
});

test("captureRequest stores body for any method when body exists", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, getRequestDetail } = require("../server/core/minitools/callback");
  const userId = "user-1";

  const url = createCallbackUrl(userId, 60);
  assert.ok(url.ok);

  // DELETE with a body
  captureRequest(url.id, mockReq({ method: "DELETE", body: '{"target":"x"}' }));

  const reqs = captureRequest.__lastRequests || [];
  const detail = getRequestDetail(
    require("../server/core/minitools/callback").getCallbackRequests(url.id, userId).requests[0].id,
    userId
  );
  assert.ok(detail.ok);
  assert.equal(detail.request.body, '{"target":"x"}');

  db.close();
});

test("cleanupExpiredCallbacks removes old expired and revoked URLs", () => {
  const db = createDb();
  require.cache[require.resolve("../server/database")].exports.db = db;

  const { createCallbackUrl, captureRequest, cleanupExpiredCallbacks } = require("../server/core/minitools/callback");
  const userId = "user-1";

  // Create and capture on a URL, then make it expired long ago
  const url = createCallbackUrl(userId, 60);
  assert.ok(url.ok);
  captureRequest(url.id, mockReq());

  const now = Math.floor(Date.now() / 1000);
  // Make it expire 8 days ago (beyond 7-day retention)
  db.prepare("UPDATE callback_urls SET expires_at = ? WHERE id = ?").run(now - 8 * 86400, url.id);

  const deleted = cleanupExpiredCallbacks();
  assert.equal(deleted, 1);

  // Verify it's gone
  const remaining = db.prepare("SELECT COUNT(*) AS cnt FROM callback_urls WHERE id = ?").get(url.id);
  assert.equal(remaining.cnt, 0);

  const remainingReqs = db.prepare("SELECT COUNT(*) AS cnt FROM callback_requests WHERE callback_id = ?").get(url.id);
  assert.equal(remainingReqs.cnt, 0);

  db.close();
});
