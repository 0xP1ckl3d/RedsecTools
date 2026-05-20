const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
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
  const dailyLimit = getSecurityTrailsDailyLimit();
  const usedToday = getSecurityTrailsUsage(req.user.id);
  const tools = {
    cvss: { enabled: isMinitoolEnabled("minitool_cvss_enabled") },
    breach: { enabled: isMinitoolEnabled("minitool_breach_enabled") },
    azure: { enabled: isMinitoolEnabled("minitool_azure_enabled") },
    securitytrails: { enabled: isMinitoolEnabled("minitool_securitytrails_enabled") && apiKeyConfigured, apiKeyConfigured, dailyLimit, usedToday },
    securityHeaders: { enabled: isMinitoolEnabled("minitool_security_headers_enabled") },
    tlsCheck: { enabled: isMinitoolEnabled("minitool_tls_check_enabled") },
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

module.exports = router;
