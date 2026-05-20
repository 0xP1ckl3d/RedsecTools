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

test("MiniTools DNS Intelligence route uses registry-driven server-side execution", () => {
  assert.match(source, /\/minitools\/dns-lookup/);
  assert.ok(source.includes("runDnsMiniTool"), "DNS Intelligence must execute through the shared backend registry");
  assert.ok(source.includes("publicToolRegistry"), "DNS Intelligence registry metadata must be exposed through bootstrap");
  assert.ok(source.includes("minitool_dns_lookup_enabled"), "DNS Intelligence must support per-tool enablement");
  assert.ok(source.includes("dns_lookup"), "DNS lookups must be audit logged");
  assert.ok(frontendSource.includes("initDnsLookup"), "Frontend must initialize the DNS Intelligence tab");
  assert.ok(frontendSource.includes("data-dns-option"), "Frontend must render dynamic advanced options");
  assert.ok(frontendSource.includes("showDnsLookupInfo"), "Frontend must expose per-tool information");
  assert.ok(frontendSource.includes('toolSelect.value = "security_dns_report"'), "Security DNS Report must be selected by default");
  assert.ok(frontendSource.includes("renderDnsLookupGroupedChecks"), "Frontend must render grouped check results");
});

test("MiniTools LeakRadar routes keep the API key server-side and page at 100 records", () => {
  assert.match(source, /\/minitools\/leakradar\/search/);
  assert.match(source, /\/minitools\/leakradar\/unlock/);
  assert.match(source, /\/minitools\/leakradar\/unlocked/);
  assert.ok(source.includes("getLeakRadarApiKey"), "LeakRadar must load the API key server-side");
  assert.ok(source.includes("LEAKRADAR_PAGE_SIZE"), "LeakRadar must use the shared page-size limit");
  assert.ok(source.includes("page_size: LEAKRADAR_PAGE_SIZE"), "LeakRadar must use the API-supported page_size query parameter");
  assert.ok(source.includes("body: { leak_ids: [normalizedId.leakId] }"), "LeakRadar unlock must use the API-supported leak_ids payload");
  assert.ok(source.includes("if (normalizedDomain.domain) query.search = normalizedDomain.domain"), "Unlocked history must support optional domain filtering");
  assert.ok(source.includes("filterLeakRadarItemsByDomain"), "Unlocked history must apply a server-side domain filter fallback");
  assert.ok(source.includes("sortLeakRadarItemsByMostRecent"), "Unlocked history must be ordered by most recent unlock metadata when available");
  assert.ok(source.includes("upsertLeakRadarUnlockedRecord"), "Unlocked records must be persisted in the database");
  assert.ok(source.includes("listLeakRadarUnlockedRecordsByIds"), "Searches must hydrate cached unlocked records from the database");
  assert.ok(source.includes("const sortedItems = sortLeakRadarItemsByMostRecent(envelope.items)"), "Search results must be ordered newest first before rendering");
  assert.ok(source.includes("Authorization") || source.includes("authorization"), "LeakRadar must use bearer auth server-side");
  assert.ok(source.includes("leakradar_unlock"), "Unlocks must be audited");
  assert.ok(frontendSource.includes("initLeakRadar"), "Frontend must initialize the LeakRadar tab");
  assert.ok(frontendSource.includes("Load Next Page"), "Frontend must expose upstream-aligned pagination");
  assert.ok(frontendSource.includes("data-leakradar-page"), "Frontend must expose inline LeakRadar page navigation");
  assert.ok(frontendSource.includes("updateLeakRadarUnlockedRow"), "Unlocks must update the currently displayed row");
  assert.ok(frontendSource.includes("data-leakradar-password-cell"), "LeakRadar rows must expose a compact password cell for unlock replacement");
  assert.ok(!frontendSource.includes("<th>ID</th>"), "LeakRadar rows must not render backend IDs as a visible column");
  assert.ok(frontendSource.includes("LEAKRADAR_ACCOUNT_KEYS"), "LeakRadar account cells must use account-specific fields");
  assert.ok(frontendSource.includes("username_masked"), "LeakRadar account cells must use the documented masked username before unlock");
  assert.ok(frontendSource.includes("added_at"), "LeakRadar meta cells must use the documented added_at date before unlock");
  assert.ok(frontendSource.includes("LEAKRADAR_DOMAIN_URL_KEYS"), "LeakRadar URL/domain cells must stay separate from account cells");
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
