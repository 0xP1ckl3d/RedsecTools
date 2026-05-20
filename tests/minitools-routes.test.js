const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/routes/minitools.js"), "utf8");
const frontendSource = fs.readFileSync(path.join(__dirname, "../public/js/minitools.js"), "utf8");

test("MiniTools routes enforce authentication and access attachment on all endpoints", () => {
  for (const line of source.split(/\r?\n/).filter((item) => /router\.(get|post)\("\/minitools\//.test(item))) {
    assert.ok(line.includes("requireUser"), `Missing requireUser: ${line}`);
    assert.ok(line.includes("attachUserAccess"), `Missing attachUserAccess: ${line}`);
  }
});

test("MiniTools routes enforce permission checks on all endpoints", () => {
  for (const line of source.split(/\r?\n/).filter((item) => /router\.(get|post)\("\/minitools\//.test(item))) {
    assert.ok(line.includes("canViewMiniTools"), `Missing canViewMiniTools: ${line}`);
  }
});

test("MiniTools routes apply rate limiting on all endpoints", () => {
  for (const line of source.split(/\r?\n/).filter((item) => /router\.(get|post)\("\/minitools\//.test(item))) {
    assert.match(line, /Limiter/, `Missing rate limiter: ${line}`);
  }
});

test("MiniTools external proxy routes use safeFetchPublicUrl for SSRF protection", () => {
  assert.ok(source.includes("safeFetchPublicUrl"), "Must use safeFetchPublicUrl for external API calls");
  assert.ok(source.includes("readResponseTextWithLimit"), "Must use readResponseTextWithLimit for response handling");
});

test("MiniTools breach-check validates email input", () => {
  assert.match(source, /EMAIL_RE/);
  assert.match(source, /Valid email address required/);
});

test("MiniTools azure-tenant validates domain input", () => {
  assert.match(source, /DOMAIN_RE/);
  assert.match(source, /Valid domain required/);
});

test("MiniTools azure-tenant handles raw response fallback", () => {
  assert.ok(source.includes('format: "raw"'), "Must handle non-JSON responses with raw fallback");
});

test("MiniTools handles upstream failures with 502", () => {
  const lines502 = source.split(/\r?\n/).filter((line) => line.includes("502"));
  assert.ok(lines502.length >= 2, "Should have 502 handlers for both breach and azure endpoints");
});

test("MiniTools SecurityTrails route checks for API key configuration", () => {
  assert.match(source, /No API key configured|API key not configured/);
});

test("MiniTools SecurityTrails route enforces per-user daily quota", () => {
  assert.ok(source.includes("getSecurityTrailsUsage"), "Must check per-user daily usage");
  assert.ok(source.includes("getSecurityTrailsDailyLimit"), "Must check daily limit setting");
  assert.match(source, /daily API limit reached/);
});

test("MiniTools SecurityTrails route uses safeFetchPublicUrl", () => {
  assert.ok(source.includes("securityTrailsApi"), "Must proxy through server-side function");
  assert.match(source, /securitytrails\.com/);
});

test("MiniTools security headers analyzer supports raw and URL modes", () => {
  assert.match(source, /\/minitools\/security-headers\/analyze/);
  assert.ok(source.includes("analyzeSecurityHeaders"), "Must use the shared security headers analyzer");
  assert.ok(source.includes("parseRawHeaders"), "Must parse pasted raw headers");
  assert.ok(source.includes("headersObjectFromFetchHeaders"), "Must analyze fetched response headers");
  assert.ok(source.includes("normalizeSecurityHeadersTargetUrl"), "Must normalize and validate URL inputs before fetching");
  assert.ok(source.includes("minitool_security_headers_enabled"), "Must support per-tool enablement");
});

test("MiniTools TLS check route uses public target validation and shared analyzer", () => {
  assert.match(source, /\/minitools\/tls-check\/analyze/);
  assert.ok(source.includes("analyzeTlsTarget"), "Must use the TLS MiniTool analyzer");
  assert.ok(source.includes("minitool_tls_check_enabled"), "Must support per-tool enablement");
  assert.ok(frontendSource.includes("initTlsCheck"), "Frontend must initialize the TLS Check tab");
});

test("MiniTools security header badges use supported tones and readable labels", () => {
  assert.match(frontendSource, /C:\s*"amber"/);
  assert.match(frontendSource, /warn:\s*"amber"/);
  assert.ok(frontendSource.includes("securityHeaderStatusLabel"), "Status badges must render readable labels");
  assert.ok(frontendSource.includes("minitools-security-grade-badge"), "Grade badge must use readable sizing");
});

test("MiniTools routes enforce per-tool enablement after permission check", () => {
  assert.ok(source.includes("requireMinitoolEnabled"), "Routes must use requireMinitoolEnabled for per-tool gating");
});

test("MiniTools bootstrap uses isMinitoolEnabled and computes canView from enabled tools", () => {
  assert.ok(source.includes("isMinitoolEnabled"), "Bootstrap must use isMinitoolEnabled helper");
  assert.ok(source.includes("anyEnabled"), "Bootstrap must compute anyEnabled for canView");
});
