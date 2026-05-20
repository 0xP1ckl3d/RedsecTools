const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { logEvent, redactObject } = require("../core/logger");
const {
  safeFetchPublicUrl,
  readResponseTextWithLimit,
} = require("../core/security/safe-fetch");
const {
  analyzeSecurityHeaders,
  headersObjectFromFetchHeaders,
  parseRawHeaders,
} = require("../core/minitools/security-headers");
const { normalizeSecurityHeadersTargetUrl } = require("../core/minitools/security-headers-url");
const { analyzeTlsTarget } = require("../core/minitools/tls-check");
const {
  LEAKRADAR_PAGE_SIZE,
  normalizeLeakRadarDomain,
  normalizeLeakRadarSearchType,
  normalizeLeakRadarPage,
  normalizeLeakRadarLeakId,
  buildLeakRadarEnvelope,
  filterLeakRadarItemsByDomain,
  sortLeakRadarItemsByMostRecent,
} = require("../core/minitools/leakradar");
const {
  publicToolRegistry,
  runDnsMiniTool,
} = require("../core/minitools/dns-lookup");

const router = Router();

function isMinitoolEnabled(key) {
  const { getSetting } = require("../database");
  return getSetting(key) !== "false";
}

function requireMinitoolEnabled(key) {
  return (req, res, next) => {
    if (!isMinitoolEnabled(key)) {
      return res.status(403).json({ error: "This mini tool is currently disabled." });
    }
    next();
  };
}

const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const breachLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Breach lookup rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const azureLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "Azure lookup rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const securityTrailsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "SecurityTrails lookup rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const securityHeadersLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Security headers analysis rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const tlsCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "TLS check rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const leakRadarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "LeakRadar lookup rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const leakRadarUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: "LeakRadar unlock rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const dnsLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "DNS Intelligence rate limit reached. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function canViewMiniTools(req, res, next) {
  if (!req.access?.permissionSet?.has("minitools.view")) {
    return res.status(403).json({ error: "MiniTools access denied" });
  }
  next();
}

// --- Per-user daily SecurityTrails quota tracking ---

function getSecurityTrailsUsage(userId) {
  const { getSetting } = require("../database");
  const today = new Date().toISOString().slice(0, 10);
  const key = `securitytrails_usage:${userId}:${today}`;
  return parseInt(getSetting(key), 10) || 0;
}

function incrementSecurityTrailsUsage(userId) {
  const { getSetting, setSetting } = require("../database");
  const today = new Date().toISOString().slice(0, 10);
  const key = `securitytrails_usage:${userId}:${today}`;
  const current = parseInt(getSetting(key), 10) || 0;
  setSetting(key, String(current + 1));
}

function getSecurityTrailsDailyLimit() {
  const { getSetting } = require("../database");
  return parseInt(getSetting("securitytrails_daily_limit"), 10) || 50;
}

function getSecurityTrailsApiKey() {
  const { getSetting } = require("../database");
  return (getSetting("securitytrails_api_key") || "").trim();
}

function getLeakRadarApiKey() {
  const { getSetting, decryptValue } = require("../database");
  const encrypted = getSetting("leakradar_api_key_encrypted") || "";
  const legacy = getSetting("leakradar_api_key") || "";
  return (decryptValue(encrypted || legacy) || "").trim();
}

function auditMiniTool(req, { action, targetType = "minitool", targetId = null, outcome = "success", metadata = {} }) {
  try {
    const { createAuditEvent } = require("../database");
    createAuditEvent({
      actorUserId: req.user?.id || null,
      actorUsername: req.user?.username || null,
      actorType: req.user ? "user" : "anonymous",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "minitools",
      action,
      targetType,
      targetId,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
}

async function fetchSecurityHeaders(targetUrl) {
  const fetchOptions = {
    headers: { "user-agent": "RedSecTools-MiniTools/1.0" },
    timeoutMs: 8000,
  };
  const headResult = await safeFetchPublicUrl(targetUrl, {
    ...fetchOptions,
    method: "HEAD",
  });
  if (![405, 501].includes(headResult.response.status)) {
    return headResult;
  }
  const getResult = await safeFetchPublicUrl(targetUrl, {
    ...fetchOptions,
    method: "GET",
  });
  try {
    await getResult.response.body?.cancel?.();
  } catch (_) {
    // Headers are all this tool needs; body cancellation is best effort.
  }
  return getResult;
}

// --- Routes ---

router.get("/minitools/bootstrap", readLimiter, requireUser, attachUserAccess, canViewMiniTools, (req, res) => {
  const apiKeyConfigured = getSecurityTrailsApiKey().length > 0;
  const leakRadarApiKeyConfigured = getLeakRadarApiKey().length > 0;
  const dailyLimit = getSecurityTrailsDailyLimit();
  const usedToday = getSecurityTrailsUsage(req.user.id);
  const tools = {
    cvss: { enabled: isMinitoolEnabled("minitool_cvss_enabled") },
    breach: { enabled: isMinitoolEnabled("minitool_breach_enabled") },
    azure: { enabled: isMinitoolEnabled("minitool_azure_enabled") },
    securitytrails: { enabled: isMinitoolEnabled("minitool_securitytrails_enabled") && apiKeyConfigured, apiKeyConfigured, dailyLimit, usedToday },
    securityHeaders: { enabled: isMinitoolEnabled("minitool_security_headers_enabled") },
    tlsCheck: { enabled: isMinitoolEnabled("minitool_tls_check_enabled") },
    dnsLookup: { enabled: isMinitoolEnabled("minitool_dns_lookup_enabled"), tools: publicToolRegistry() },
    leakradar: { enabled: isMinitoolEnabled("minitool_leakradar_enabled") && leakRadarApiKeyConfigured, apiKeyConfigured: leakRadarApiKeyConfigured, pageSize: LEAKRADAR_PAGE_SIZE },
    cyberchef: { enabled: isMinitoolEnabled("minitool_cyberchef_enabled") },
  };
  const anyEnabled = Object.values(tools).some((t) => t.enabled);
  res.json({
    canView: anyEnabled,
    tools,
  });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;

router.get("/minitools/breach-check", breachLookupLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_breach_enabled"), async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Valid email address required" });
  }
  try {
    const checkUrl = `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}?include_details=true`;
    const { response: checkResp } = await safeFetchPublicUrl(checkUrl);
    const checkText = await readResponseTextWithLimit(checkResp);
    let checkData = null;
    try { checkData = JSON.parse(checkText); } catch (_) { /* non-JSON */ }

    let analyticsData = null;
    try {
      const analyticsUrl = `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`;
      const { response: analyticsResp } = await safeFetchPublicUrl(analyticsUrl);
      const analyticsText = await readResponseTextWithLimit(analyticsResp);
      analyticsData = JSON.parse(analyticsText);
    } catch (_) { /* analytics best-effort */ }

    res.json({ breaches: checkData, analytics: analyticsData });
  } catch (err) {
    res.status(502).json({ error: "Failed to reach breach lookup service", detail: err.message });
  }
});

router.get("/minitools/azure-tenant", azureLookupLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_azure_enabled"), async (req, res) => {
  const domain = String(req.query.domain || "").trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return res.status(400).json({ error: "Valid domain required" });
  }
  try {
    const azureUrl = `https://azmap.dev/api/tenant?domain=${encodeURIComponent(domain)}&extract=true`;
    const { response } = await safeFetchPublicUrl(azureUrl);
    const text = await readResponseTextWithLimit(response);
    let data = null;
    try { data = JSON.parse(text); } catch (_) {
      return res.json({ raw: text.substring(0, 10000), format: "raw" });
    }
    if (data && typeof data === "object") {
      res.json({ data, format: "structured" });
    } else {
      res.json({ raw: JSON.stringify(data).substring(0, 10000), format: "unknown" });
    }
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Azure mapping service", detail: err.message });
  }
});

router.post("/minitools/security-headers/analyze", securityHeadersLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_security_headers_enabled"), async (req, res) => {
  const mode = String(req.body?.mode || "raw").trim().toLowerCase();
  if (mode === "raw") {
    const rawHeaders = String(req.body?.rawHeaders || "");
    if (!rawHeaders.trim()) return res.status(400).json({ error: "Raw response headers are required" });
    if (rawHeaders.length > 20000) return res.status(400).json({ error: "Raw headers must be 20KB or less" });
    const parsed = parseRawHeaders(rawHeaders);
    return res.json({
      mode,
      source: "raw",
      analysis: analyzeSecurityHeaders(parsed),
    });
  }

  if (mode !== "url") {
    return res.status(400).json({ error: "Invalid mode. Use 'raw' or 'url'." });
  }

  const normalizedTarget = normalizeSecurityHeadersTargetUrl(req.body?.url);
  if (!normalizedTarget.ok) return res.status(400).json({ error: normalizedTarget.error });

  try {
    const { response, finalUrl } = await fetchSecurityHeaders(normalizedTarget.url);
    return res.json({
      mode,
      source: finalUrl,
      status: response.status,
      analysis: analyzeSecurityHeaders(headersObjectFromFetchHeaders(response.headers)),
    });
  } catch (err) {
    return res.status(502).json({ error: "Failed to fetch target headers", detail: err.message });
  }
});

router.post("/minitools/tls-check/analyze", tlsCheckLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_tls_check_enabled"), async (req, res) => {
  const target = String(req.body?.target || "").trim();
  if (!target) return res.status(400).json({ error: "Target is required" });
  const includeDns = !!req.body?.includeDns;
  const includeCt = !!req.body?.includeCt;
  const includeCiphers = !!req.body?.includeCiphers;
  const timeoutMs = Math.min(Math.max(parseInt(req.body?.timeoutMs, 10) || 6000, 2000), 15000);

  try {
    const result = await analyzeTlsTarget(target, { includeDns, includeCt, includeCiphers, timeoutMs });
    if (!result.success && result.error && !result.certificate) {
      return res.status(502).json(result);
    }
    return res.json(result);
  } catch (err) {
    const message = err.message || "TLS analysis failed";
    if (/Invalid URL|Only HTTP|credentials|Localhost|metadata|Private|reserved|not allowed|required|supported|Port/i.test(message)) {
      return res.status(400).json({ success: false, error: message });
    }
    return res.status(502).json({ success: false, error: message });
  }
});

router.post("/minitools/dns-lookup", dnsLookupLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_dns_lookup_enabled"), async (req, res) => {
  const started = Date.now();
  const result = await runDnsMiniTool({
    toolId: req.body?.toolId,
    target: req.body?.target,
    options: req.body?.options || {},
    userId: req.user?.id || null,
  });
  const body = result.body || {};
  auditMiniTool(req, {
    action: "dns_lookup",
    targetType: "dns_lookup",
    targetId: body.toolId || req.body?.toolId || null,
    outcome: result.statusCode >= 400 ? "failure" : "success",
    metadata: {
      toolId: body.toolId || req.body?.toolId || null,
      target: body.target || req.body?.target || null,
      status: body.status || null,
      durationMs: body.meta?.durationMs || Date.now() - started,
    },
  });
  return res.status(result.statusCode).json(body);
});

// --- SecurityTrails proxy ---

async function securityTrailsApi(endpointPath) {
  const apiKey = getSecurityTrailsApiKey();
  if (!apiKey) return { error: "No API key configured" };

  const url = `https://api.securitytrails.com/v1${endpointPath}`;
  const { response } = await safeFetchPublicUrl(url, {
    headers: { APIKEY: apiKey },
  });
  const text = await readResponseTextWithLimit(response);
  try {
    return { data: JSON.parse(text) };
  } catch (_) {
    return { raw: text.substring(0, 10000), format: "raw" };
  }
}

router.get("/minitools/securitytrails/lookup", securityTrailsLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_securitytrails_enabled"), async (req, res) => {
  const apiKey = getSecurityTrailsApiKey();
  if (!apiKey) {
    return res.status(403).json({ error: "SecurityTrails API key not configured. Ask an admin to configure it in Admin > Tools > SecurityTrails." });
  }

  const dailyLimit = getSecurityTrailsDailyLimit();
  const domain = String(req.query.domain || "").trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return res.status(400).json({ error: "Valid domain required" });
  }

  const lookupType = String(req.query.type || "both").toLowerCase();
  const fetchDetails = lookupType === "details" || lookupType === "both";
  const fetchSubdomains = lookupType === "subdomains" || lookupType === "both";
  const queryCount = (fetchDetails ? 1 : 0) + (fetchSubdomains ? 1 : 0);
  if (queryCount === 0) {
    return res.status(400).json({ error: "Invalid type. Use 'details', 'subdomains', or 'both'." });
  }

  const usedToday = getSecurityTrailsUsage(req.user.id);
  if (usedToday + queryCount > dailyLimit) {
    return res.status(429).json({ error: `User daily API limit reached (${usedToday}/${dailyLimit}). Requesting ${queryCount} queries would exceed quota. Resets at midnight UTC.` });
  }

  try {
    let details = null;
    let subdomains = null;

    const tasks = [];
    if (fetchDetails) {
      tasks.push(securityTrailsApi(`/domain/${encodeURIComponent(domain)}`).then((r) => { details = r; }));
    }
    if (fetchSubdomains) {
      tasks.push(securityTrailsApi(`/domain/${encodeURIComponent(domain)}/subdomains`).then((r) => { subdomains = r; }));
    }
    await Promise.all(tasks);

    if (fetchDetails && details?.error) {
      return res.status(502).json({ error: details.error });
    }
    if (fetchSubdomains && subdomains?.error) {
      return res.status(502).json({ error: subdomains.error });
    }

    for (let i = 0; i < queryCount; i++) {
      incrementSecurityTrailsUsage(req.user.id);
    }

    res.json({
      details: details?.data || null,
      subdomains: subdomains?.data || null,
      quota: { used: usedToday + queryCount, limit: dailyLimit },
    });
  } catch (err) {
    res.status(502).json({ error: "Failed to reach SecurityTrails API", detail: err.message });
  }
});

// --- LeakRadar proxy ---

async function leakRadarApi(endpointPath, { method = "GET", query = {}, body = null } = {}) {
  const apiKey = getLeakRadarApiKey();
  if (!apiKey) return { error: "LeakRadar API key not configured" };

  const url = new URL(`https://api.leakradar.io${endpointPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const headers = {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    "user-agent": "RedSecTools-MiniTools/1.0",
  };
  const options = { method, headers, timeoutMs: 12000, maxRedirects: 0 };
  if (body !== null) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const { response } = await safeFetchPublicUrl(url.href, options);
  const text = await readResponseTextWithLimit(response, 2 * 1024 * 1024);
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = { raw: text.substring(0, 10000), format: "raw" };
    }
  }
  return { status: response.status, ok: response.ok, data: payload || {} };
}

function sendLeakRadarUpstreamError(res, result) {
  const data = result?.data || {};
  const detail = data.error || data.message || data.detail || data.raw || "LeakRadar API request failed";
  const status = result?.status === 401 || result?.status === 403 ? 502 : result?.status || 502;
  return res.status(status).json({
    error: "LeakRadar API request failed",
    status: result?.status || null,
    detail,
  });
}

function leakRadarItemsFromPayload(payload, leakId = null) {
  const envelope = buildLeakRadarEnvelope(payload || {}, { page: 1, limit: LEAKRADAR_PAGE_SIZE });
  if (envelope.items.length) return envelope.items;
  if (payload && typeof payload === "object") return [leakId ? { id: leakId, ...payload } : payload];
  return leakId ? [{ id: leakId }] : [];
}

function cacheLeakRadarUnlockedItems(items, domain, unlockedBy) {
  const { upsertLeakRadarUnlockedRecord } = require("../database");
  const cached = {};
  for (const item of Array.isArray(items) ? items : []) {
    const leakId = normalizeLeakRadarLeakId(item?.id || item?.leak_id || item?.leakId || item?.uuid || item?._id || item?.hash);
    if (!leakId.ok) continue;
    const record = upsertLeakRadarUnlockedRecord({
      leakId: leakId.leakId,
      domain,
      payload: item,
      unlockedBy,
    });
    if (record?.payload) cached[leakId.leakId] = record.payload;
  }
  return cached;
}

function cachedLeakRadarUnlockedById(items) {
  const { listLeakRadarUnlockedRecordsByIds } = require("../database");
  const ids = (Array.isArray(items) ? items : [])
    .map((item) => item?.id || item?.leak_id || item?.leakId || item?.uuid || item?._id || item?.hash)
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  return listLeakRadarUnlockedRecordsByIds(ids);
}

router.get("/minitools/leakradar/search", leakRadarLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_leakradar_enabled"), async (req, res) => {
  if (!getLeakRadarApiKey()) {
    return res.status(403).json({ error: "LeakRadar API key not configured. Ask an admin to configure it in Admin > Tools > LeakRadar." });
  }
  const normalizedDomain = normalizeLeakRadarDomain(req.query.domain);
  if (!normalizedDomain.ok) return res.status(400).json({ error: normalizedDomain.error });
  const normalizedType = normalizeLeakRadarSearchType(req.query.type);
  if (!normalizedType.ok) return res.status(400).json({ error: normalizedType.error });
  const page = normalizeLeakRadarPage(req.query.page);

  try {
    const result = await leakRadarApi(`/search/domain/${encodeURIComponent(normalizedDomain.domain)}/${normalizedType.type}`, {
      query: { page, page_size: LEAKRADAR_PAGE_SIZE },
    });
    if (result.error) return res.status(403).json({ error: result.error });
    if (!result.ok) return sendLeakRadarUpstreamError(res, result);
    const envelope = buildLeakRadarEnvelope(result.data, { page, limit: LEAKRADAR_PAGE_SIZE });
    const sortedItems = sortLeakRadarItemsByMostRecent(envelope.items);
    return res.json({
      domain: normalizedDomain.domain,
      type: normalizedType.type,
      ...envelope,
      items: sortedItems,
      unlockedById: cachedLeakRadarUnlockedById(sortedItems),
    });
  } catch (err) {
    return res.status(502).json({ error: "Failed to reach LeakRadar API", detail: err.message });
  }
});

router.post("/minitools/leakradar/unlock", leakRadarUnlockLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_leakradar_enabled"), async (req, res) => {
  if (!getLeakRadarApiKey()) {
    return res.status(403).json({ error: "LeakRadar API key not configured. Ask an admin to configure it in Admin > Tools > LeakRadar." });
  }
  const normalizedId = normalizeLeakRadarLeakId(req.body?.leakId || req.body?.id);
  if (!normalizedId.ok) return res.status(400).json({ error: normalizedId.error });
  const normalizedDomain = req.body?.domain ? normalizeLeakRadarDomain(req.body.domain) : null;
  if (normalizedDomain && !normalizedDomain.ok) return res.status(400).json({ error: normalizedDomain.error });

  try {
    const result = await leakRadarApi("/unlock", {
      method: "POST",
      body: { leak_ids: [normalizedId.leakId] },
    });
    if (result.error) return res.status(403).json({ error: result.error });
    if (!result.ok) {
      auditMiniTool(req, {
        action: "leakradar_unlock",
        targetType: "leakradar_leak",
        targetId: normalizedId.leakId,
        outcome: "failure",
        metadata: { status: result.status },
      });
      return sendLeakRadarUpstreamError(res, result);
    }
    const unlockedItems = leakRadarItemsFromPayload(result.data, normalizedId.leakId);
    const unlockedById = cacheLeakRadarUnlockedItems(unlockedItems, normalizedDomain?.domain || "", req.user?.id || null);
    auditMiniTool(req, {
      action: "leakradar_unlock",
      targetType: "leakradar_leak",
      targetId: normalizedId.leakId,
      metadata: { status: result.status },
    });
    return res.json({ success: true, leakId: normalizedId.leakId, data: result.data, unlockedRecord: unlockedById[normalizedId.leakId] || null });
  } catch (err) {
    auditMiniTool(req, {
      action: "leakradar_unlock",
      targetType: "leakradar_leak",
      targetId: normalizedId.leakId,
      outcome: "failure",
      metadata: { error: err.message },
    });
    return res.status(502).json({ error: "Failed to reach LeakRadar API", detail: err.message });
  }
});

router.get("/minitools/leakradar/unlocked", leakRadarLimiter, requireUser, attachUserAccess, canViewMiniTools, requireMinitoolEnabled("minitool_leakradar_enabled"), async (req, res) => {
  if (!getLeakRadarApiKey()) {
    return res.status(403).json({ error: "LeakRadar API key not configured. Ask an admin to configure it in Admin > Tools > LeakRadar." });
  }
  const hasDomainFilter = String(req.query.domain || "").trim() !== "";
  const normalizedDomain = hasDomainFilter ? normalizeLeakRadarDomain(req.query.domain) : { ok: true, domain: "" };
  if (!normalizedDomain.ok) return res.status(400).json({ error: normalizedDomain.error });
  const page = normalizeLeakRadarPage(req.query.page);

  try {
    const query = { page, page_size: LEAKRADAR_PAGE_SIZE };
    if (normalizedDomain.domain) query.search = normalizedDomain.domain;
    const result = await leakRadarApi("/profile/unlocked/advanced", {
      query,
    });
    if (result.error) return res.status(403).json({ error: result.error });
    if (!result.ok) return sendLeakRadarUpstreamError(res, result);
    const envelope = buildLeakRadarEnvelope(result.data, { page, limit: LEAKRADAR_PAGE_SIZE });
    const filteredItems = sortLeakRadarItemsByMostRecent(filterLeakRadarItemsByDomain(envelope.items, normalizedDomain.domain));
    const unlockedById = cacheLeakRadarUnlockedItems(filteredItems, normalizedDomain.domain, req.user?.id || null);
    return res.json({
      domain: normalizedDomain.domain,
      type: "unlocked",
      ...envelope,
      items: filteredItems,
      unlockedById,
      filterApplied: normalizedDomain.domain ? "search" : "none",
    });
  } catch (err) {
    return res.status(502).json({ error: "Failed to reach LeakRadar API", detail: err.message });
  }
});

module.exports = router;
