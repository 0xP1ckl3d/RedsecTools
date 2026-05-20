const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSecurityHeadersTargetUrl } = require("../server/core/minitools/security-headers-url");

test("security headers URL normalization assumes HTTPS for bare hosts", () => {
  assert.deepEqual(normalizeSecurityHeadersTargetUrl("example.com").url, "https://example.com/");
  assert.deepEqual(normalizeSecurityHeadersTargetUrl("www.example.com/path?q=1").url, "https://www.example.com/path?q=1");
  assert.deepEqual(normalizeSecurityHeadersTargetUrl("//example.com/a").url, "https://example.com/a");
});

test("security headers URL normalization preserves explicit HTTP(S) and rejects unsupported schemes", () => {
  assert.deepEqual(normalizeSecurityHeadersTargetUrl("http://example.com").url, "http://example.com/");
  assert.deepEqual(normalizeSecurityHeadersTargetUrl("https://example.com").url, "https://example.com/");
  assert.equal(normalizeSecurityHeadersTargetUrl("ftp://example.com").ok, false);
  assert.equal(normalizeSecurityHeadersTargetUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizeSecurityHeadersTargetUrl("not a url").ok, false);
});
