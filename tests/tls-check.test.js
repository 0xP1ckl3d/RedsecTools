const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hostnameMatches,
  internalNameIndicators,
  normalizeTlsTarget,
  rateCipher,
  sortIssues,
} = require("../server/core/minitools/tls-check");

test("TLS MiniTool target normalization accepts URLs, bare hosts, and ports", () => {
  assert.deepEqual(normalizeTlsTarget("example.com"), { ok: true, host: "example.com", port: 443, target: "example.com:443" });
  assert.deepEqual(normalizeTlsTarget("https://Example.com:8443/path"), { ok: true, host: "example.com", port: 8443, target: "example.com:8443" });
  assert.equal(normalizeTlsTarget("ftp://example.com").ok, false);
  assert.equal(normalizeTlsTarget("https://user:pass@example.com").ok, false);
});

test("TLS MiniTool hostname matching follows single-label wildcard rules", () => {
  assert.equal(hostnameMatches("*.example.com", "www.example.com"), true);
  assert.equal(hostnameMatches("*.example.com", "a.b.example.com"), false);
  assert.equal(hostnameMatches("example.com", "example.com"), true);
});

test("TLS MiniTool helpers classify internal names and cipher risk", () => {
  assert.equal(internalNameIndicators("intranet.local"), true);
  assert.equal(internalNameIndicators("fileserver"), true);
  assert.equal(internalNameIndicators("www.example.com"), false);
  assert.equal(rateCipher("RC4-SHA"), "broken");
  assert.equal(rateCipher("ECDHE-RSA-AES128-SHA"), "weak");
  assert.equal(rateCipher("ECDHE-RSA-AES128-GCM-SHA256"), "strong");
});

test("TLS MiniTool issues sort by severity", () => {
  const sorted = sortIssues([
    { severity: "info", title: "info", detail: "" },
    { severity: "critical", title: "critical", detail: "" },
    { severity: "medium", title: "medium", detail: "" },
  ]);
  assert.deepEqual(sorted.map((item) => item.severity), ["critical", "medium", "info"]);
});
