const test = require("node:test");
const assert = require("node:assert/strict");

const { assertPublicHttpUrl, isBlockedIp } = require("../server/core/security/fetch-targets");

test("SSRF target guard blocks private and metadata addresses", async () => {
  assert.equal(isBlockedIp("127.0.0.1"), true);
  assert.equal(isBlockedIp("10.0.0.5"), true);
  assert.equal(isBlockedIp("169.254.169.254"), true);
  assert.equal(isBlockedIp("8.8.8.8"), false);

  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/feed.xml"), /Private or reserved/);
  await assert.rejects(() => assertPublicHttpUrl("http://localhost/feed.xml"), /Localhost/);
  await assert.rejects(() => assertPublicHttpUrl("ftp://example.com/feed.xml"), /HTTP/);
  await assert.rejects(() => assertPublicHttpUrl("https://user:pass@example.com/feed.xml"), /credentials/);
});
