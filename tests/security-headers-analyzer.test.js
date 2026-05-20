const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeSecurityHeaders,
  parseRawHeaders,
} = require("../server/core/minitools/security-headers");

test("security header analyzer grades strong browser security headers", () => {
  const parsed = parseRawHeaders(`HTTP/2 200
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Set-Cookie: redsec_session=abc; Secure; HttpOnly; SameSite=Strict`);

  const result = analyzeSecurityHeaders(parsed);
  assert.equal(result.grade, "A");
  assert.equal(result.counts.fail, 0);
  assert.ok(result.findings.some((finding) => finding.header === "Content-Security-Policy" && finding.status === "pass"));
});

test("security header analyzer reports missing and weak controls with remediation", () => {
  const parsed = parseRawHeaders(`HTTP/1.1 200 OK
Server: nginx
Content-Security-Policy: default-src * 'unsafe-inline'
Set-Cookie: sid=abc`);

  const result = analyzeSecurityHeaders(parsed);
  assert.ok(["D", "E", "F"].includes(result.grade), `Unexpected grade ${result.grade}`);
  assert.ok(result.counts.fail >= 2);
  assert.ok(result.findings.some((finding) => finding.header === "Strict-Transport-Security" && finding.fix.includes("max-age")));
  assert.ok(result.findings.some((finding) => finding.header === "Set-Cookie" && finding.status === "warn"));
});
