"use strict";

const { URLSearchParams } = require("url");

const MAX_CONTEXT_CHARS = 12000;

const TOOL_INPUT_SCHEMAS = Object.freeze({
  "calendar.bootstrap": {
    type: "object",
    properties: {
      rangeIntent: { enum: ["this_week", "next_week", "last_week", "this_month", "next_month", "last_month"] },
      viewMode: { enum: ["week", "month"] },
      rangeStart: { type: "integer", description: "Optional explicit Unix seconds range start." },
      rangeEnd: { type: "integer", description: "Optional explicit Unix seconds range end." },
      scheduleUserId: { type: "string", description: "Use all only for team-wide requests." },
      timeZone: { type: "string", description: "IANA timezone supplied by the browser." },
    },
  },
  "calendar.entry.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          type: { enum: ["task", "assignment", "meeting", "leave", "personal_leave", "annual_leave", "public_holiday", "reminder", "project"] },
          dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD in the user's local timezone." },
          startLocal: { type: "string", description: "Local time such as 15:00 or 3:00 PM." },
          endLocal: { type: "string", description: "Local time such as 16:00 or 4:00 PM." },
          durationMinutes: { type: "integer" },
          timeZone: { type: "string" },
          startsAt: { type: "integer", description: "Unix seconds; optional when dateIntent/startLocal are supplied." },
          endsAt: { type: "integer", description: "Unix seconds; optional when dateIntent/startLocal plus endLocal/durationMinutes are supplied." },
          allDay: { type: "boolean" },
          status: { enum: ["scheduled", "tentative"] },
          projectId: { type: "string" },
          assigneeUserId: { type: "string" },
        },
        required: ["title"],
      },
    },
    required: ["body"],
  },
  "calendar.entry.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: { type: "object", description: "Same calendar entry fields as calendar.entry.create." },
    },
    required: ["pathParams", "body"],
  },
});

const TOOL_ALLOWLIST = Object.freeze({
  "calendar.bootstrap": {
    method: "GET",
    path: "/api/calendar/bootstrap",
    permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"],
    capability: "calendar.read",
    description: "Read permitted calendar schedule entries, team/project scope, and calendar stats. Use rangeIntent for relative ranges instead of guessing dates.",
  },
  "calendar.entry.create": {
    method: "POST",
    path: "/api/calendar/entries",
    permissionsAny: ["calendar.create", "calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Create a calendar entry after explicit user confirmation. Prefer body.dateIntent plus body.startLocal and body.endLocal or body.durationMinutes for local-time requests.",
  },
  "calendar.entry.update": {
    method: "PUT",
    path: "/api/calendar/entries/:id",
    permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Update a calendar entry visible/editable to the logged-in user after explicit user confirmation. Requires path id and changed entry fields.",
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
  "reporter.note.create": {
    method: "POST",
    path: "/api/reporter/projects/:projectId/notes",
    permissionsAny: ["reporter.edit_own", "reporter.edit_assigned", "reporter.manage_all"],
    capability: "reporter.write",
    confirmRequired: true,
    description: "Create a Reporter project note after explicit user confirmation. Requires projectId, title, and content.",
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
  "wiki.page.create": {
    method: "POST",
    path: "/api/wiki/pages",
    permissionsAny: ["wiki.create_personal", "wiki.create_team", "wiki.manage"],
    capability: "wiki.write",
    confirmRequired: true,
    description: "Create a personal or team wiki page after explicit user confirmation. Body supports scope, title, slug, bodyMarkdown, and parentPageId.",
  },
  "wiki.page.update": {
    method: "PUT",
    path: "/api/wiki/pages/:id",
    permissionsAny: ["wiki.create_personal", "wiki.edit_team", "wiki.manage"],
    capability: "wiki.write",
    confirmRequired: true,
    description: "Update a wiki page editable by the logged-in user after explicit user confirmation. Requires path id and page fields.",
  },
});

function hasAny(access, permissions) {
  return permissions.some((permission) => access?.permissionSet?.has(permission));
}

function getRedSecAiToolManifest(access) {
  return Object.entries(TOOL_ALLOWLIST)
    .filter(([, tool]) => hasAny(access, tool.permissionsAny))
    .map(([name, tool]) => ({
      name,
      capability: tool.capability,
      method: tool.method,
      path: tool.path,
      confirmRequired: !!tool.confirmRequired,
      description: tool.description,
      inputSchema: TOOL_INPUT_SCHEMAS[name] || null,
    }));
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

function buildToolPath(tool, args = {}) {
  let path = tool.path;
  const pathParams = args.pathParams && typeof args.pathParams === "object" ? args.pathParams : args;
  path = path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(String(pathParams[key] || "")));
  if (path.includes("/:") || /\/$/.test(path.replace(/\/api\/$/, ""))) {
    return null;
  }
  return path;
}

async function scopedApiRequest(req, toolName, args = {}) {
  const tool = TOOL_ALLOWLIST[toolName];
  if (!tool) return { ok: false, status: 403, error: "Tool is not allowlisted for RedSecAI" };
  if (tool.method === "VIRTUAL") return { ok: false, status: 400, error: "Virtual RedSecAI tools must be executed through executeRedSecAiTool" };
  if (!hasAny(req.access, tool.permissionsAny)) return { ok: false, status: 403, error: "User RBAC denied RedSecAI tool access" };

  const path = buildToolPath(tool, args);
  if (!path) return { ok: false, status: 400, error: "Required RedSecAI tool path parameter is missing" };
  const params = new URLSearchParams();
  const query = args.query && typeof args.query === "object" ? args.query : (tool.method === "GET" ? args : {});
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const url = `${getInternalOrigin(req)}${path}${params.toString() ? `?${params.toString()}` : ""}`;
  const headers = {
    cookie: req.headers.cookie || "",
    accept: "application/json",
    "user-agent": "RedSecAI scoped internal tool",
  };
  const init = { method: tool.method, headers };
  if (tool.method !== "GET") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(args.body && typeof args.body === "object" ? args.body : args);
  }
  const res = await fetch(url, {
    ...init,
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.json().catch(() => null) };
  return { ok: true, status: res.status, body: await res.json().catch(() => null) };
}

async function scopedApiGet(req, toolName, query = {}) {
  return scopedApiRequest(req, toolName, { query });
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

function isRedSecAiToolMutating(toolName) {
  const tool = TOOL_ALLOWLIST[toolName];
  return !!tool && tool.confirmRequired === true;
}

function sanitizeTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string" || timeZone.length > 80) return null;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone }).format(new Date());
    return timeZone;
  } catch (_) {
    return null;
  }
}

function formatAiDateTime(unix, options = {}) {
  const value = Number(unix);
  if (!Number.isFinite(value) || value <= 0) return null;
  const timeZone = sanitizeTimeZone(options.timeZone);
  const formatOptions = options.dateOnly
    ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
  if (timeZone) formatOptions.timeZone = timeZone;
  return new Date(value * 1000).toLocaleString("en-AU", formatOptions);
}

function summarizeCalendarEntryForAi(entry, usersById, projectsById, options = {}) {
  const assigneeId = entry?.assigneeUserId || entry?.ownerId || entry?.calendarUserId || null;
  const project = entry?.projectId ? projectsById.get(entry.projectId) : null;
  const startLabel = formatAiDateTime(entry?.startsAt, { dateOnly: !!entry?.allDay, timeZone: options.timeZone });
  const endLabel = formatAiDateTime(entry?.endsAt, { dateOnly: !!entry?.allDay, timeZone: options.timeZone });
  return {
    id: entry?.id,
    title: entry?.title || "Untitled calendar entry",
    type: entry?.type || null,
    status: entry?.status || null,
    plannedStatus: entry?.plannedStatus || null,
    allDay: !!entry?.allDay,
    startsAt: entry?.startsAt || null,
    endsAt: entry?.endsAt || null,
    startLabel,
    endLabel,
    timeLabel: entry?.allDay ? `All day: ${startLabel || "unknown date"}` : `${startLabel || "unknown start"} to ${endLabel || "unknown end"}`,
    assigneeUserId: assigneeId,
    assigneeUsername: usersById.get(assigneeId)?.username || null,
    projectId: entry?.projectId || null,
    projectName: project?.name || project?.title || null,
    scheduledHours: entry?.scheduledHours ?? null,
    description: entry?.description || null,
  };
}

function summarizeCalendarBootstrap(toolName, result, options = {}) {
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  const body = result.body || {};
  const timeZone = sanitizeTimeZone(options.timeZone);
  const usersById = new Map((body.availableUsers || []).map((user) => [user.id, user]));
  if (body.selectedUser?.id && body.selectedUser?.username) usersById.set(body.selectedUser.id, body.selectedUser);
  const projectsById = new Map((body.projects || []).map((project) => [project.id, project]));
  return {
    tool: toolName,
    ok: true,
    status: result.status,
    data: {
      scheduleView: body.scheduleView || null,
      scheduleLabel: body.scheduleLabel || null,
      timeZone: timeZone || "server-local",
      nowLabel: formatAiDateTime(Math.floor(Date.now() / 1000), { timeZone }),
      range: {
        startsAt: body.weekStart || null,
        endsAt: body.weekEnd || null,
        startLabel: formatAiDateTime(body.weekStart, { dateOnly: true, timeZone }),
        endLabel: formatAiDateTime(body.weekEnd, { dateOnly: true, timeZone }),
      },
      selectedUser: body.selectedUser || null,
      entryCount: Array.isArray(body.scheduleEntries) ? body.scheduleEntries.length : 0,
      scheduleEntries: (body.scheduleEntries || [])
        .slice(0, 50)
        .map((entry) => summarizeCalendarEntryForAi(entry, usersById, projectsById, { timeZone })),
      overviewStats: body.overviewStats?.summary || body.overviewStats || null,
      capabilities: body.capabilities || null,
    },
  };
}

async function executeRedSecAiTool(req, toolName, args = {}, options = {}) {
  if (!TOOL_ALLOWLIST[toolName]) {
    return { tool: toolName, ok: false, status: 403, error: "Tool is not allowlisted for RedSecAI" };
  }
  if (isRedSecAiToolMutating(toolName) && !options.confirmed) {
    return {
      tool: toolName,
      ok: false,
      status: 409,
      requiresConfirmation: true,
      args,
      error: "This RedSecAI tool requires explicit user confirmation",
    };
  }
  if (toolName === "threat.searchAlerts") return searchThreatAlerts(req, args);
  if (toolName === "wiki.search") return searchWiki(req, args);
  const result = await scopedApiRequest(req, toolName, args);
  return summarizeResult(toolName, result, args);
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

function summarizeResult(toolName, result, options = {}) {
  if (toolName === "calendar.bootstrap") {
    return summarizeCalendarBootstrap(toolName, result, options);
  }
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
    "Write-capable tools require explicit in-browser confirmation before execution. RedSecAI can draft the action, but the user must confirm it.",
    "The TOOL_RESULTS block below is the only platform data RedSecAI may treat as factual. If a value is absent, say it is not available in the scoped tool results.",
  ];

  const allowedTools = [];
  const toolResults = [];
  const toolManifest = getRedSecAiToolManifest(req.access);

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
  getRedSecAiToolManifest,
  hasAny,
  isRedSecAiToolMutating,
  scopedApiRequest,
  scopedApiGet,
  TOOL_ALLOWLIST,
};
