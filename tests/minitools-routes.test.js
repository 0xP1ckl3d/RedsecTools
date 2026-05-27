const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../server/routes/minitools.js"), "utf8");
const frontendSource = fs.readFileSync(path.join(__dirname, "../public/js/minitools.js"), "utf8");
const frontendPageSource = fs.readFileSync(path.join(__dirname, "../public/minitools/index.html"), "utf8");
const adminRouteSource = fs.readFileSync(path.join(__dirname, "../server/routes/admin.js"), "utf8");
const adminFrontendSource = fs.readFileSync(path.join(__dirname, "../public/js/admin.js"), "utf8");
const notificationFrontendSource = fs.readFileSync(path.join(__dirname, "../public/js/notifications.js"), "utf8");

test("MiniTools routes enforce authentication and access attachment on all endpoints", () => {
  for (const line of source.split(/\r?\n/).filter((item) => /router\.(get|post)\("\/minitools\//.test(item))) {
    assert.ok(line.includes("requireUser"), `Missing requireUser: ${line}`);
    assert.ok(line.includes("attachUserAccess"), `Missing attachUserAccess: ${line}`);
  }
});

test("MiniTools exposes an About tab with per-tool hidden usage panels", () => {
  assert.ok(frontendPageSource.includes('data-minitools-view="about"'), "MiniTools sidebar/mobile nav must expose About");
  assert.match(frontendPageSource, /<div class="sidebar-divider"><\/div>\s*<nav class="sidebar-nav">\s*<button type="button" class="sidebar-nav-item" data-minitools-view="about"/, "MiniTools About must be separated from tool tabs by a sidebar divider");
  assert.ok(frontendSource.includes("initAboutTabs"), "Frontend must initialize MiniTools About subtabs");
  assert.ok(frontendSource.includes("data-minitools-about-tab"), "Frontend should switch About tool tabs using data attributes");

  const expectedTools = [
    "cyberchef",
    "jwt-analyzer",
    "header-analyzer",
    "cvss",
    "lol-lookup",
    "security-headers",
    "tls-check",
    "dns-lookup",
    "api-analyzer",
    "secrets-detector",
    "azure",
    "securitytrails",
    "breach",
    "leakradar",
    "callback",
  ];

  for (const tool of expectedTools) {
    assert.ok(frontendPageSource.includes(`data-minitools-about-tab="${tool}"`), `Missing About tab for ${tool}`);
    assert.ok(frontendPageSource.includes(`data-minitools-about-panel="${tool}"`), `Missing About panel for ${tool}`);
  }

  assert.ok(frontendPageSource.includes("Header Analyzer is for raw email headers"), "Header Analyzer About content must describe the actual email-header tool");
  assert.ok(frontendPageSource.includes("HMAC tokens with a shared secret"), "JWT Analyzer About content must cover local signature verification");
  assert.ok(frontendPageSource.includes("PEM or JWK public keys"), "JWT Analyzer About content must cover asymmetric key verification");
  assert.ok(frontendPageSource.includes("Cloudflare as the default"), "DNS Intelligence About content must document the default public resolver");
  assert.ok(frontendPageSource.includes("FTP 21, SSH 22"), "DNS Intelligence About content must document fixed light-port scope");
  assert.ok(frontendPageSource.includes("OpenAPI, Swagger, or Postman JSON/YAML"), "API Analyzer About content must document supported definition types");
  assert.ok(frontendPageSource.includes("Uploaded definitions are limited to 5 MB"), "API Analyzer About content must document upload limits");
  assert.ok(frontendPageSource.includes("Scanning runs in the browser"), "Secrets Detector About content must document browser-only scanning");
  assert.ok(frontendPageSource.includes("Full secret values can be displayed"), "Secrets Detector About content must warn about sensitive output handling");
  assert.ok(frontendPageSource.includes("Reverse IP"), "SecurityTrails About content must include reverse IP mode");
  assert.ok(frontendPageSource.includes("Results load 100 records at a time"), "LeakRadar About content must document pagination");
  assert.ok(frontendPageSource.includes("stored in the database"), "LeakRadar About content must document unlocked-record persistence");
  assert.ok(frontendPageSource.includes("WebSocket updates"), "Callback About content must document live callback capture");
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
  assert.ok(source.includes('lookupType === "reverse_ip"'), "SecurityTrails must support reverse IP mode");
  assert.ok(source.includes("filter: { ipv4: normalizedIp.ip }"), "Reverse IP mode must use the SecurityTrails IPv4 filter API");
  assert.ok(fs.readFileSync(path.join(__dirname, "../public/minitools/index.html"), "utf8").includes('data-st-type="reverse_ip"'), "Frontend must expose reverse IP mode");
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
  assert.ok(frontendSource.includes("Next Page"), "Frontend must expose upstream-aligned pagination");
  assert.ok(frontendSource.includes("data-leakradar-page"), "Frontend must expose inline LeakRadar page navigation");
  assert.ok(frontendSource.includes("updateLeakRadarUnlockedRow"), "Unlocks must update the currently displayed row");
  assert.ok(frontendSource.includes("data-leakradar-password-cell"), "LeakRadar rows must expose a compact password cell for unlock replacement");
  assert.ok(frontendSource.includes("data-leakradar-account-cell"), "Unlocks must hydrate the currently displayed account cell");
  assert.ok(!frontendSource.includes("<th>ID</th>"), "LeakRadar rows must not render backend IDs as a visible column");
  assert.ok(frontendSource.includes("LEAKRADAR_ACCOUNT_KEYS"), "LeakRadar account cells must use account-specific fields");
  assert.ok(frontendSource.includes("username_masked"), "LeakRadar account cells must use the documented masked username before unlock");
  assert.ok(frontendSource.includes("added_at"), "LeakRadar meta cells must use the documented added_at date before unlock");
  assert.ok(frontendSource.includes("LEAKRADAR_DOMAIN_URL_KEYS"), "LeakRadar URL/domain cells must stay separate from account cells");
});

test("MiniTools LOL Lookup queries local cached datasets and exposes dataset status", () => {
  assert.match(source, /\/minitools\/lol-lookup\/status/);
  assert.match(source, /\/minitools\/lol-lookup\/search/);
  assert.match(source, /\/minitools\/lol-lookup\/entries\/:id/);
  assert.ok(source.includes("searchLolLookup"), "LOL Lookup search must use the local cached index service");
  assert.ok(source.includes("getLolLookupStatus"), "LOL Lookup must expose source freshness from the local cache");
  assert.ok(source.includes("minitool_lol_lookup_enabled"), "LOL Lookup must support per-tool enablement");
  assert.ok(frontendSource.includes("initLolLookup"), "Frontend must initialize the LOL Lookup tab");
  assert.ok(frontendSource.includes("lolLookupFunctionFacets"), "LOL Lookup function filters must come from locally indexed dataset facets");
  assert.ok(!frontendPageSource.includes('id="lol-lookup-platform"'), "LOL Lookup must not duplicate dataset selection with a platform filter");
  assert.ok(!frontendPageSource.includes('<option value="execute">Execute / command</option>'), "LOL Lookup must not hardcode mixed function filters");
  assert.ok(frontendSource.includes("data-lol-lookup-copy"), "Frontend must expose copy buttons for source payload examples");
});

test("LOL Lookup manual refresh completion reaches Admin through notifications WebSocket events", () => {
  assert.ok(adminRouteSource.includes('action: failures.length ? "lol_lookup_sync_failed" : "lol_lookup_sync_complete"'), "Manual refresh must notify the requesting admin after queued sync");
  assert.ok(notificationFrontendSource.includes('"redsec:notification"'), "Notification WebSocket client must surface received notifications to the page");
  assert.ok(adminFrontendSource.includes('"lol_lookup_sync_complete"'), "Admin panel must react to successful refresh notifications");
  assert.ok(adminFrontendSource.includes('"lol_lookup_sync_failed"'), "Admin panel must react to failed refresh notifications");
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
