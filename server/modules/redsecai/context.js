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
  compactJson,
  hasAny,
  scopedApiGet,
  TOOL_ALLOWLIST,
};
