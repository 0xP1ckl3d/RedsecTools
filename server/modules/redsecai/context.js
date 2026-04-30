"use strict";

const { URLSearchParams } = require("url");

const MAX_CONTEXT_CHARS = 12000;

const TOOL_ALLOWLIST = Object.freeze({
  "calendar.bootstrap": {
    method: "GET",
    path: "/api/calendar/bootstrap",
    permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"],
    capability: "calendar.read",
    description: "Read the logged-in user's permitted calendar schedule, team/project scope, and calendar stats.",
  },
  "threat.bootstrap": {
    method: "GET",
    path: "/api/threat/bootstrap",
    permissionsAny: ["threat.view", "threat.manage"],
    capability: "threat.read",
    description: "Read the logged-in user's permitted threat-intel dashboard summary.",
  },
  "threat.alerts": {
    method: "GET",
    path: "/api/threat/alerts",
    permissionsAny: ["threat.view", "threat.manage"],
    capability: "threat.read",
    description: "Read the logged-in user's permitted threat-intel alerts.",
  },
  "threat.searchAlerts": {
    method: "VIRTUAL",
    path: "/api/threat/alerts",
    permissionsAny: ["threat.view", "threat.manage"],
    capability: "threat.search",
    description: "Search and rank threat alerts visible to the logged-in user by keyword, IOC, CVE, feed, tag, context, and headline.",
  },
  "reporter.projects": {
    method: "GET",
    path: "/api/reporter/projects",
    permissionsAny: ["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"],
    capability: "reporter.read",
    description: "Read report projects visible to the logged-in user through Reporter project membership and RBAC.",
  },
  "wiki.bootstrap": {
    method: "GET",
    path: "/api/wiki/bootstrap",
    permissionsAny: ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"],
    capability: "wiki.read",
    description: "Read wiki bootstrap metadata and recent pages visible to the logged-in user.",
  },
  "wiki.search": {
    method: "GET",
    path: "/api/wiki/search",
    permissionsAny: ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"],
    capability: "wiki.search",
    description: "Search wiki pages visible to the logged-in user by query.",
  },
});

function hasAny(access, permissions) {
  return permissions.some((permission) => access?.permissionSet?.has(permission));
}

function compactJson(value, maxChars = MAX_CONTEXT_CHARS) {
  const text = JSON.stringify(value, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function getInternalOrigin(req) {
  if (process.env.REDSECAI_INTERNAL_ORIGIN) {
    return process.env.REDSECAI_INTERNAL_ORIGIN.replace(/\/+$/, "");
  }
  const port = parseInt(process.env.PORT, 10) || 3000;
  return `http://127.0.0.1:${port}`;
}

async function scopedApiGet(req, toolName, query = {}) {
  const tool = TOOL_ALLOWLIST[toolName];
  if (!tool) return { ok: false, status: 403, error: "Tool is not allowlisted for RedSecAI" };
  if (tool.method === "VIRTUAL") return { ok: false, status: 400, error: "Virtual RedSecAI tools must be executed through executeRedSecAiTool" };
  if (!hasAny(req.access, tool.permissionsAny)) return { ok: false, status: 403, error: "User RBAC denied RedSecAI tool access" };

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const url = `${getInternalOrigin(req)}${tool.path}${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    method: tool.method,
    headers: {
      cookie: req.headers.cookie || "",
      accept: "application/json",
      "user-agent": "RedSecAI scoped internal tool",
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, body: await res.json().catch(() => null) };
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase();
}

function uniqueTerms(value) {
  const text = normalizeSearchText(value);
  const cves = text.match(/\bcve-\d{4}-\d{4,7}\b/g) || [];
  const hashes = text.match(/\b[a-f0-9]{32,64}\b/g) || [];
  const ips = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  const words = text
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9_.:-]+/i)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3)
    .filter((term) => !new Set([
      "find", "show", "search", "about", "alert", "alerts", "threat", "threats",
      "intel", "intelligence", "relevant", "related", "recent", "latest", "for",
      "the", "and", "with", "that", "this", "please",
    ]).has(term));
  return [...new Set([...cves, ...hashes, ...ips, ...words])].slice(0, 12);
}

function alertCorpus(alert) {
  const iocs = alert?.iocs && typeof alert.iocs === "object"
    ? Object.values(alert.iocs).flat().join(" ")
    : "";
  const keywords = Array.isArray(alert?.keywords)
    ? alert.keywords.map((item) => item?.keyword || item?.matchedText || "").join(" ")
    : "";
  return normalizeSearchText([
    alert?.id,
    alert?.feedName,
    alert?.feedType,
    alert?.keywordText,
    alert?.matchedText,
    alert?.matchedContent,
    alert?.context,
    alert?.articleUrl,
    alert?.criticality,
    keywords,
    iocs,
    JSON.stringify(alert?.apiMetadata || {}),
  ].join("\n"));
}

function scoreThreatAlert(alert, terms) {
  if (!terms.length) return 1;
  const corpus = alertCorpus(alert);
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    const needle = normalizeSearchText(term);
    if (corpus.includes(needle)) score += needle.startsWith("cve-") ? 8 : 3;
    if (normalizeSearchText(alert?.keywordText).includes(needle)) score += 3;
    if (normalizeSearchText(alert?.matchedContent).includes(needle)) score += 2;
  }
  const criticalityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  score += criticalityWeight[alert?.criticality] || 0;
  score += Math.min(3, Math.max(0, (alert?.triggeredAt || alert?.createdAt || 0) / Math.floor(Date.now() / 1000)));
  return score;
}

function simplifyThreatAlert(alert) {
  return {
    id: alert.id,
    feedName: alert.feedName || null,
    criticality: alert.criticality || null,
    isRead: !!alert.isRead,
    keywordText: alert.keywordText || null,
    matchedContent: alert.matchedContent || null,
    context: String(alert.context || "").slice(0, 500),
    articleUrl: alert.articleUrl || null,
    triggeredAt: alert.triggeredAt || alert.createdAt || null,
    keywords: Array.isArray(alert.keywords) ? alert.keywords.slice(0, 8) : [],
    iocs: alert.iocs || {},
    mitre: Array.isArray(alert.mitre) ? alert.mitre.slice(0, 8) : [],
  };
}

async function searchThreatAlerts(req, args = {}) {
  const query = String(args.query || "").slice(0, 500);
  const terms = uniqueTerms(query);
  const limit = Math.min(20, Math.max(1, parseInt(args.limit, 10) || 8));
  const fetchLimit = Math.min(300, Math.max(50, limit * 30));
  const apiQuery = {
    limit: fetchLimit,
    hours: args.hours,
    criticality: args.criticality,
    isRead: args.isRead,
  };
  const result = await scopedApiGet(req, "threat.alerts", apiQuery);
  if (!result.ok) return summarizeResult("threat.searchAlerts", result);
  const alerts = Array.isArray(result.body?.alerts) ? result.body.alerts : [];
  const ranked = alerts
    .map((alert) => ({ alert, score: scoreThreatAlert(alert, terms) }))
    .filter((item) => !terms.length || item.score > 0)
    .sort((a, b) => b.score - a.score || (b.alert.triggeredAt || 0) - (a.alert.triggeredAt || 0))
    .slice(0, limit)
    .map((item) => ({ score: item.score, ...simplifyThreatAlert(item.alert) }));

  return {
    tool: "threat.searchAlerts",
    ok: true,
    status: 200,
    query: { query, terms, limit, apiQuery },
    data: {
      count: ranked.length,
      searchedAlerts: alerts.length,
      alerts: ranked,
    },
  };
}

async function searchWiki(req, args = {}) {
  const query = String(args.query || "").trim().slice(0, 200);
  if (!query) {
    return { tool: "wiki.search", ok: false, status: 400, error: "Wiki search query is required" };
  }
  const result = await scopedApiGet(req, "wiki.search", { q: query });
  return {
    ...summarizeResult("wiki.search", result),
    query: { query },
  };
}

async function executeRedSecAiTool(req, toolName, args = {}) {
  if (!TOOL_ALLOWLIST[toolName]) {
    return { tool: toolName, ok: false, status: 403, error: "Tool is not allowlisted for RedSecAI" };
  }
  if (toolName === "threat.searchAlerts") return searchThreatAlerts(req, args);
  if (toolName === "wiki.search") return searchWiki(req, args);
  const result = await scopedApiGet(req, toolName, args);
  return summarizeResult(toolName, result);
}

function deriveRedSecAiToolCalls(message, access) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const calls = [];
  if (hasAny(access, ["threat.view", "threat.manage"]) && (
    /\b(alert|alerts|threat|ioc|iocs|cve-|malware|ransom|phish|exploit|vulnerab|mitre)\b/i.test(lower)
  )) {
    calls.push({ tool: "threat.searchAlerts", args: { query: text, limit: 8 } });
  }
  if (hasAny(access, ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"]) && (
    /\b(wiki|page|runbook|docs?|procedure|playbook|knowledge)\b/i.test(lower)
  )) {
    calls.push({ tool: "wiki.search", args: { query: text.replace(/\b(wiki|page|runbook|docs?|procedure|playbook|knowledge)\b/gi, " ").trim() || text } });
  }
  if (hasAny(access, ["calendar.view", "calendar.view_team", "calendar.manage"]) && (
    /\b(calendar|schedule|scheduled|meeting|availability|project time|utili[sz]ation)\b/i.test(lower)
  )) {
    calls.push({ tool: "calendar.bootstrap", args: { viewMode: "week", scheduleUserId: hasAny(access, ["calendar.view_team", "calendar.manage"]) ? "all" : undefined } });
  }
  if (hasAny(access, ["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"]) && (
    /\b(report|reporter|finding|findings|project|client|evidence|cvss)\b/i.test(lower)
  )) {
    calls.push({ tool: "reporter.projects", args: {} });
  }
  return calls.slice(0, 4);
}

async function buildTargetedToolContext(req, messages = []) {
  const latestUser = [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message?.role !== "assistant");
  const calls = deriveRedSecAiToolCalls(latestUser?.content || "", req.access);
  const results = [];
  for (const call of calls) {
    results.push(await executeRedSecAiTool(req, call.tool, call.args));
  }
  return {
    calls,
    results,
    text: results.length
      ? `TARGETED_TOOL_CALLS:\n${compactJson(calls)}\n\nTARGETED_TOOL_RESULTS:\n${compactJson(results)}`
      : "TARGETED_TOOL_RESULTS: []",
  };
}

function summarizeResult(toolName, result) {
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  return { tool: toolName, ok: true, status: result.status, data: result.body };
}

function redactEncryptedToolNames() {
  return [
    "RedSecAI must not access or ask users to paste decrypted vault secrets, paste/share contents, or RedSecTeam messages.",
    "Encrypted tools are intentionally excluded from scoped context: RedSecPaste, RedSecShare, RedSecTeam, and RedSecVault.",
  ];
}

async function buildScopedContext(req, page = {}) {
  const sections = [
    `Current user: ${req.user?.username || "unknown"} (${req.user?.id || "unknown"})`,
    `Current page: ${String(page.path || req.get("referer") || "/").slice(0, 200)}`,
    ...redactEncryptedToolNames(),
    "RedSecAI tool execution is server-side allowlisted. It cannot call arbitrary routes and has no direct database handle.",
    "The TOOL_RESULTS block below is the only platform data RedSecAI may treat as factual. If a value is absent, say it is not available in the scoped tool results.",
  ];

  const allowedTools = [];
  const toolResults = [];
  const toolManifest = Object.entries(TOOL_ALLOWLIST)
    .filter(([, tool]) => hasAny(req.access, tool.permissionsAny))
    .map(([name, tool]) => ({
      name,
      capability: tool.capability,
      method: tool.method,
      path: tool.path,
      description: tool.description,
    }));

  if (hasAny(req.access, ["calendar.view", "calendar.view_team", "calendar.manage"])) {
    allowedTools.push("calendar.read");
    const calendarQuery = {
      viewMode: "week",
    };
    if (hasAny(req.access, ["calendar.view_team", "calendar.manage"])) {
      calendarQuery.scheduleUserId = "all";
    }
    const calendar = await scopedApiGet(req, "calendar.bootstrap", calendarQuery);
    toolResults.push({
      ...summarizeResult("calendar.bootstrap", calendar),
      query: calendarQuery,
    });
    if (calendar.ok) {
      sections.push(`Scoped calendar snapshot:\n${compactJson({
        capabilities: calendar.body?.capabilities,
        selectedUser: calendar.body?.selectedUser,
        scheduleLabel: calendar.body?.scheduleLabel,
        scheduleEntries: (calendar.body?.scheduleEntries || []).slice(0, 25),
        projects: (calendar.body?.projects || []).slice(0, 25),
        overviewStats: calendar.body?.overviewStats?.summary,
      })}`);
    } else {
      sections.push(`Scoped calendar snapshot unavailable: HTTP ${calendar.status}`);
    }
  }

  if (hasAny(req.access, ["threat.view", "threat.manage"])) {
    allowedTools.push("threat.read");
    const bootstrap = await scopedApiGet(req, "threat.bootstrap");
    const alerts = await scopedApiGet(req, "threat.alerts", { limit: 10 });
    toolResults.push(summarizeResult("threat.bootstrap", bootstrap));
    toolResults.push({
      ...summarizeResult("threat.alerts", alerts),
      query: { limit: 10 },
    });
    sections.push(`Scoped threat intelligence snapshot:\n${compactJson({
      stats: bootstrap.ok ? bootstrap.body?.stats : null,
      recentAlerts: alerts.ok ? alerts.body?.alerts : [],
    })}`);
  }

  if (hasAny(req.access, ["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"])) {
    allowedTools.push("reporter.read", "reporter.draft");
    const projects = await scopedApiGet(req, "reporter.projects");
    toolResults.push(summarizeResult("reporter.projects", projects));
    sections.push(`Scoped Reporter snapshot:\n${compactJson({
      projects: projects.ok ? (projects.body?.projects || []).slice(0, 20) : [],
    })}`);
    sections.push("Reporter write scope: RedSecAI may help draft report prose. Stage 1 does not mutate Reporter records automatically.");
  }

  if (hasAny(req.access, ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"])) {
    allowedTools.push("wiki.read");
    const wiki = await scopedApiGet(req, "wiki.bootstrap");
    toolResults.push(summarizeResult("wiki.bootstrap", wiki));
    sections.push(`Scoped Wiki search snapshot:\n${compactJson({
      recentPages: wiki.ok ? (wiki.body?.recentPages || []).slice(0, 10) : [],
      selectedPage: wiki.ok ? wiki.body?.selectedPage || null : null,
      capabilities: wiki.ok ? wiki.body?.capabilities || null : null,
    })}`);
  }

  sections.push(`TOOL_MANIFEST:\n${compactJson(toolManifest)}`);
  sections.push(`TOOL_RESULTS:\n${compactJson(toolResults)}`);

  return {
    allowedTools: [...new Set(allowedTools)],
    toolManifest,
    toolResults,
    text: sections.join("\n\n"),
  };
}

module.exports = {
  buildScopedContext,
  buildTargetedToolContext,
  compactJson,
  deriveRedSecAiToolCalls,
  executeRedSecAiTool,
  hasAny,
  scopedApiGet,
  TOOL_ALLOWLIST,
};
