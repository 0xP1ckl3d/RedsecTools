"use strict";

const { URLSearchParams } = require("url");
const {
  EXTRA_TOOL_ALLOWLIST,
  EXTRA_TOOL_DISCOVERY,
  EXTRA_TOOL_INPUT_SCHEMAS,
  EXTRA_TOOL_PATH_PARAM_ALIASES,
} = require("./tool-definitions");

const MAX_CONTEXT_CHARS = 12000;

const TOOL_INPUT_SCHEMAS = Object.freeze({
  "calendar.bootstrap": {
    type: "object",
    properties: {
      rangeIntent: { enum: ["this_week", "next_week", "last_week", "this_month", "next_month", "last_month"] },
      viewMode: { enum: ["week", "month"] },
      rangeStart: { type: "integer", description: "Optional explicit Unix seconds range start." },
      rangeEnd: { type: "integer", description: "Optional explicit Unix seconds range end." },
      dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for a single-day range." },
      startDate: { type: "string", description: "YYYY-MM-DD local range start date." },
      startDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range start date." },
      endDate: { type: "string", description: "YYYY-MM-DD local range end date." },
      endDateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD local range end date." },
      startLocal: { type: "string", description: "Local range start time. Defaults to 00:00." },
      endLocal: { type: "string", description: "Local range end time. Defaults to 23:59." },
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
          allDay: { type: "boolean", description: "For date-only entries, provide allDay=true plus dateIntent; RedSecAI will resolve the local day range." },
          status: { enum: ["scheduled", "tentative"] },
          projectId: { type: "string" },
          assigneeUserId: { type: "string" },
          assigneeUserIds: { type: "array", description: "Use [\"__all__\"] only when the user asks to create the entry for everyone." },
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
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          type: { enum: ["task", "assignment", "meeting", "leave", "personal_leave", "annual_leave", "public_holiday", "reminder", "project"] },
          dateIntent: { type: "string" },
          startLocal: { type: "string" },
          endLocal: { type: "string" },
          durationMinutes: { type: "integer" },
          timeZone: { type: "string" },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          allDay: { type: "boolean" },
          status: { enum: ["scheduled", "tentative", "complete", "cancelled"] },
          projectId: { type: "string" },
          assigneeUserId: { type: "string" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "calendar.project.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name (required)." },
          code: { type: "string", description: "Short project code." },
          clientName: { type: "string", description: "Client name." },
          projectType: { type: "string", description: "Type of project (e.g. pentest, assessment)." },
          description: { type: "string" },
          color: { type: "string" },
          status: { enum: ["active", "proposed", "on_hold", "complete", "archived"] },
          startDate: { type: "string", description: "YYYY-MM-DD project start date. Use this instead of startsAt." },
          endDate: { type: "string", description: "YYYY-MM-DD project end date. Use this instead of endsAt." },
          startsAt: { type: "integer", description: "Unix seconds; set automatically from startDate." },
          endsAt: { type: "integer", description: "Unix seconds; set automatically from endDate." },
          estimatedMode: { enum: ["hours", "days"] },
          estimatedValue: { type: "number", description: "Estimated hours or days (depending on estimatedMode)." },
          billableRate: { type: "number", description: "Daily billing rate." },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
    required: ["body"],
  },
  "calendar.project.update": {
    type: "object",
    properties: {
      pathParams: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          code: { type: "string" },
          clientName: { type: "string" },
          projectType: { type: "string" },
          description: { type: "string" },
          color: { type: "string" },
          status: { enum: ["active", "proposed", "on_hold", "complete", "archived"] },
          startDate: { type: "string" },
          endDate: { type: "string" },
          startsAt: { type: "integer" },
          endsAt: { type: "integer" },
          estimatedMode: { enum: ["hours", "days"] },
          estimatedValue: { type: "number" },
          billableRate: { type: "number" },
          notes: { type: "string" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  "calendar.allocation.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "ID of an existing calendar project (required)." },
          assigneeUserId: { type: "string", description: "User ID to assign. Use the user's actual ID or omit to self-assign." },
          title: { type: "string", description: "Override entry title. Defaults to project name." },
          description: { type: "string" },
          allocationMode: { enum: ["daily", "custom"], description: "daily creates one entry per workday; custom creates a single entry." },
          startDate: { type: "string", description: "YYYY-MM-DD for daily allocation start." },
          endDate: { type: "string", description: "YYYY-MM-DD for daily allocation end." },
          hoursPerDay: { type: "number", description: "Hours per day for daily allocation mode." },
          workdaysOnly: { type: "boolean", description: "Only allocate on workdays (default true)." },
          dateIntent: { type: "string", description: "today, tomorrow, or YYYY-MM-DD for a custom single-block allocation." },
          startLocal: { type: "string", description: "Local start time for a custom allocation, such as 15:00 or 3:00 PM." },
          startTimeLocal: { type: "string", description: "Local start time for a custom allocation, such as 15:00 or 3:00 PM." },
          endLocal: { type: "string", description: "Local end time for a custom allocation, such as 16:00 or 4:00 PM." },
          endTimeLocal: { type: "string", description: "Local end time for a custom allocation, such as 16:00 or 4:00 PM." },
          durationMinutes: { type: "integer", description: "Duration for a custom allocation when endLocal is omitted." },
          timeZone: { type: "string", description: "IANA timezone supplied by the browser." },
          startsAt: { type: "integer", description: "Unix seconds for custom mode." },
          endsAt: { type: "integer", description: "Unix seconds for custom mode." },
          allDay: { type: "boolean" },
          status: { enum: ["scheduled", "tentative"] },
        },
        required: ["projectId"],
      },
    },
    required: ["body"],
  },
  "calendar.project.schedule": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Existing calendar project ID, when already known." },
          projectName: { type: "string", description: "Project name to create when projectId is not known." },
          projectDescription: { type: "string" },
          clientName: { type: "string" },
          projectType: { type: "string" },
          code: { type: "string" },
          color: { type: "string" },
          startDate: { type: "string", description: "YYYY-MM-DD allocation start date." },
          endDate: { type: "string", description: "YYYY-MM-DD allocation end date." },
          assigneeUserId: { type: "string", description: "User ID to assign. Omit to assign the logged-in user." },
          title: { type: "string", description: "Calendar entry title override." },
          description: { type: "string" },
          hoursPerDay: { type: "number" },
          workdaysOnly: { type: "boolean" },
          estimatedMode: { enum: ["hours", "days"] },
          estimatedValue: { type: "number" },
          billableRate: { type: "number" },
          notes: { type: "string" },
          status: { enum: ["scheduled", "tentative"] },
        },
        required: ["startDate", "endDate"],
      },
    },
    required: ["body"],
  },
  "wiki.page.get": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { id: { type: "string", description: "Wiki page ID returned by wiki.search or wiki.bootstrap." } },
        required: ["id"],
      },
    },
    required: ["pathParams"],
  },
  "threat.bootstrap": {
    type: "object",
    properties: {},
  },
  "threat.alerts": {
    type: "object",
    properties: {
      limit: { type: "integer" },
      offset: { type: "integer" },
      hours: { type: "integer" },
      criticality: { enum: ["low", "medium", "high", "critical"] },
      isRead: { type: "boolean" },
      feedId: { type: "string" },
      tagId: { type: "string" },
    },
  },
  "threat.searchAlerts": {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
      hours: { type: "integer" },
      criticality: { enum: ["low", "medium", "high", "critical"] },
      isRead: { type: "boolean" },
    },
    required: ["query"],
  },
  "reporter.projects": {
    type: "object",
    properties: {},
  },
  "reporter.note.create": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { projectId: { type: "string", description: "Reporter project ID returned by reporter.projects." } },
        required: ["projectId"],
      },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          orderIndex: { type: "integer" },
        },
        required: ["title", "content"],
      },
    },
    required: ["pathParams", "body"],
  },
  "wiki.bootstrap": {
    type: "object",
    properties: {},
  },
  "wiki.search": {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
  "wiki.page.create": {
    type: "object",
    properties: {
      body: {
        type: "object",
        properties: {
          scope: { enum: ["team", "personal"] },
          title: { type: "string" },
          slug: { type: "string" },
          bodyMarkdown: { type: "string" },
          parentPageId: { type: "string" },
          sortOrder: { type: "integer" },
        },
        required: ["title"],
      },
    },
    required: ["body"],
  },
  "wiki.page.update": {
    type: "object",
    properties: {
      pathParams: {
        type: "object",
        properties: { id: { type: "string", description: "Wiki page ID returned by wiki.search or wiki.bootstrap." } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          slug: { type: "string" },
          bodyMarkdown: { type: "string" },
          parentPageId: { type: "string" },
          sortOrder: { type: "integer" },
        },
      },
    },
    required: ["pathParams", "body"],
  },
  ...EXTRA_TOOL_INPUT_SCHEMAS,
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
    description: "Create a calendar entry after explicit user confirmation. Prefer body.dateIntent plus body.startLocal and body.endLocal or body.durationMinutes for local-time requests. For all-day entries, use body.allDay=true plus body.dateIntent. For team-wide entries, use body.assigneeUserIds=[\"__all__\"].",
  },
  "calendar.entry.update": {
    method: "PUT",
    path: "/api/calendar/entries/:id",
    permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Update a calendar entry visible/editable to the logged-in user after explicit user confirmation. Requires path id and changed entry fields.",
  },
  "calendar.project.create": {
    method: "POST",
    path: "/api/calendar/projects",
    permissionsAny: ["calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Create a calendar project (engagement, work stream, or client project) after explicit user confirmation. A project is a container for scheduled work — use calendar.allocation.create to assign users to it after it exists. Provide name and optionally startDate/endDate in YYYY-MM-DD format, client, estimated hours/days, and billing rate.",
  },
  "calendar.project.update": {
    method: "PUT",
    path: "/api/calendar/projects/:id",
    permissionsAny: ["calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Update a calendar project after explicit user confirmation. Requires path id and changed project fields.",
  },
  "calendar.allocation.create": {
    method: "POST",
    path: "/api/calendar/allocations",
    permissionsAny: ["calendar.create", "calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Create calendar allocation entries assigning a user to an existing project after explicit user confirmation. Requires an existing projectId. Use daily mode with startDate/endDate (YYYY-MM-DD) for date-range allocations. Use custom mode with startsAt/endsAt for a single block. Omit assigneeUserId to self-assign.",
  },
  "calendar.project.schedule": {
    method: "VIRTUAL",
    path: "/api/calendar/project-schedule",
    permissionsAny: ["calendar.create", "calendar.manage"],
    capability: "calendar.write",
    confirmRequired: true,
    description: "Create or link a calendar project and create allocation calendar entries for it in one confirmed RedSecAI action. Use this for requests like assign a named project to me and put it in my calendar. Provide either body.projectId for an existing project or body.projectName for a new project, plus body.startDate and body.endDate.",
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
  "wiki.page.get": {
    method: "GET",
    path: "/api/wiki/pages/:id",
    permissionsAny: ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"],
    capability: "wiki.read",
    description: "Read one visible wiki page by ID, including bodyMarkdown, before drafting an update to that page.",
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
  ...EXTRA_TOOL_ALLOWLIST,
});

const TOOL_DISCOVERY = Object.freeze({
  "calendar.bootstrap": {
    domain: "calendar",
    kind: "read",
    purpose: "Read schedule entries, meetings, availability, projects, leave, holidays, and calendar stats for a time range.",
    examples: ["what meetings do I have this week", "check my calendar", "what is scheduled next month"],
  },
  "calendar.entry.create": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare a new meeting, task, reminder, leave, public holiday, or time block for user confirmation.",
    examples: ["block out 3pm today", "add a public holiday for everyone", "create a reminder tomorrow"],
  },
  "calendar.entry.update": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare changes to an existing calendar entry after locating or receiving its ID.",
    examples: ["move that meeting", "update the calendar entry", "change the reminder title"],
  },
  "calendar.project.create": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare a new calendar project or engagement container for user confirmation.",
    examples: ["create a project for ACME pentest", "add an engagement next week"],
  },
  "calendar.project.update": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare changes to an existing calendar project after locating or receiving its ID.",
    examples: ["update that project", "change the project dates"],
  },
  "calendar.allocation.create": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare project allocation entries assigning a user to an existing project.",
    examples: ["assign Brad to that project next week", "allocate two hours per day"],
  },
  "calendar.project.schedule": {
    domain: "calendar",
    kind: "write",
    purpose: "Prepare a single confirmed action that creates or links a project and places the allocation into the calendar.",
    examples: ["assign CV web app test to me from 4 May to 13 May", "put this project in my calendar", "schedule the project for me"],
  },
  "threat.bootstrap": {
    domain: "threat",
    kind: "read",
    purpose: "Read threat dashboard counts, feed state, and overall threat-intel status.",
    examples: ["summarise current threat landscape", "show threat dashboard status"],
  },
  "threat.alerts": {
    domain: "threat",
    kind: "read",
    purpose: "Read current threat alerts with filters such as criticality, read status, feed, or timeframe.",
    examples: ["latest high alerts", "unread critical alerts"],
  },
  "threat.searchAlerts": {
    domain: "threat",
    kind: "search",
    purpose: "Search visible threat alerts by topic, malware, CVE, IOC, feed, tag, headline, or context.",
    examples: ["find ransomware alerts", "search for CVE-2026-12345", "alerts about phishing"],
  },
  "reporter.projects": {
    domain: "reporter",
    kind: "read",
    purpose: "Read visible Reporter projects, clients, reports, findings, evidence, and review status.",
    examples: ["what reports are active", "show projects for this client", "summarise findings"],
  },
  "reporter.note.create": {
    domain: "reporter",
    kind: "write",
    purpose: "Prepare a Reporter project note after the target project is known.",
    examples: ["add a note to that report", "create a project note"],
  },
  "wiki.bootstrap": {
    domain: "wiki",
    kind: "read",
    purpose: "Read wiki metadata, page tree, recent pages, selected page, and wiki capabilities.",
    examples: ["show recent wiki pages", "open wiki state"],
  },
  "wiki.search": {
    domain: "wiki",
    kind: "search",
    purpose: "Search visible wiki pages by approximate title, topic, body text, notes, runbook, draft, unfinished work, or procedure.",
    examples: ["find the web app pentest page", "search wiki for VPN runbook", "find unfinished wiki draft"],
  },
  "wiki.page.get": {
    domain: "wiki",
    kind: "read",
    purpose: "Read the full bodyMarkdown for a specific visible wiki page before drafting an update.",
    examples: ["read the matching wiki page", "load that runbook before updating it"],
  },
  "wiki.page.create": {
    domain: "wiki",
    kind: "write",
    purpose: "Prepare a new team or personal wiki page for user confirmation.",
    examples: ["create a wiki page", "draft a runbook"],
  },
  "wiki.page.update": {
    domain: "wiki",
    kind: "write",
    purpose: "Prepare edits to an existing wiki page after search or page context identifies the page.",
    examples: ["finish that unfinished wiki page", "update the runbook", "add content to the page"],
  },
  ...EXTRA_TOOL_DISCOVERY,
});

const TOOL_PATH_PARAM_ALIASES = Object.freeze({
  "calendar.entry.update": { id: ["entryId", "calendarEntryId"] },
  "calendar.project.update": { id: ["projectId", "calendarProjectId"] },
  "reporter.note.create": { projectId: ["id", "reporterProjectId"] },
  "wiki.page.get": { id: ["pageId", "wikiPageId"] },
  "wiki.page.update": { id: ["pageId", "wikiPageId"] },
  ...EXTRA_TOOL_PATH_PARAM_ALIASES,
});

function hasAny(access, permissions) {
  return permissions.some((permission) => access?.permissionSet?.has(permission));
}

function hasToolAccess(access, tool) {
  if (!tool) return false;
  if (tool.allowAuthenticated) return !!access?.userId;
  return hasAny(access, tool.permissionsAny || []);
}

function getRedSecAiToolManifest(access, selectedNames = null) {
  const selected = selectedNames ? new Set(selectedNames) : null;
  return Object.entries(TOOL_ALLOWLIST)
    .filter(([, tool]) => hasToolAccess(access, tool))
    .filter(([name]) => !selected || selected.has(name))
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

function getRedSecAiToolCatalog(access, selectedNames = null) {
  const selected = selectedNames ? new Set(selectedNames) : null;
  return Object.entries(TOOL_ALLOWLIST)
    .filter(([, tool]) => hasToolAccess(access, tool))
    .filter(([name]) => !selected || selected.has(name))
    .map(([name, tool]) => {
      const discovery = TOOL_DISCOVERY[name] || {};
      return {
        name,
        domain: discovery.domain || name.split(".")[0],
        kind: discovery.kind || (tool.confirmRequired ? "write" : "read"),
        capability: tool.capability,
        confirmRequired: !!tool.confirmRequired,
        purpose: discovery.purpose || tool.description,
        examples: discovery.examples || [],
      };
    });
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

function getToolPathParamNames(tool) {
  return [...String(tool?.path || "").matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

function getNestedObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstStringField(sources, fields) {
  for (const source of sources) {
    for (const field of fields) {
      const value = source?.[field];
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
    }
  }
  return undefined;
}

function normalizeWikiBody(toolName, args = {}) {
  if (!["wiki.page.create", "wiki.page.update"].includes(toolName)) return args;
  const bodySources = [
    getNestedObject(args.body),
    getNestedObject(args),
  ];
  const body = { ...getNestedObject(args.body) };

  if (typeof args.body === "string") body.bodyMarkdown = args.body;
  if (typeof body.body === "string") body.bodyMarkdown = body.body;

  const title = firstStringField(bodySources, ["title", "pageTitle", "name"]);
  const slug = firstStringField(bodySources, ["slug", "pageSlug"]);
  const scope = firstStringField(bodySources, ["scope"]);
  const parentPageId = firstStringField(bodySources, ["parentPageId", "parentId"]);
  const bodyMarkdown = firstStringField(bodySources, [
    "bodyMarkdown",
    "markdown",
    "contentMarkdown",
    "pageMarkdown",
    "content",
    "pageBody",
    "text",
    "body",
  ]);

  if (title !== undefined) body.title = title;
  if (slug !== undefined) body.slug = slug;
  if (scope !== undefined) body.scope = scope;
  if (parentPageId !== undefined) body.parentPageId = parentPageId;
  if (bodyMarkdown !== undefined) body.bodyMarkdown = bodyMarkdown;
  if (args.sortOrder !== undefined && body.sortOrder === undefined) body.sortOrder = args.sortOrder;

  for (const alias of ["markdown", "contentMarkdown", "pageMarkdown", "content", "pageBody", "text", "body", "pageTitle", "name", "pageSlug", "parentId"]) {
    if (alias !== "bodyMarkdown") delete body[alias];
  }

  const normalizedArgs = { ...args, body };
  for (const alias of ["title", "pageTitle", "name", "slug", "pageSlug", "scope", "parentPageId", "parentId", "bodyMarkdown", "markdown", "contentMarkdown", "pageMarkdown", "content", "pageBody", "text"]) {
    delete normalizedArgs[alias];
  }
  return normalizedArgs;
}

function findPathParamValue(toolName, args, key) {
  const aliases = [key, ...(TOOL_PATH_PARAM_ALIASES[toolName]?.[key] || [])];
  const sources = [
    getNestedObject(args.pathParams),
    getNestedObject(args.params),
    getNestedObject(args),
  ];
  for (const source of sources) {
    for (const alias of aliases) {
      if (source[alias] !== undefined && source[alias] !== null && String(source[alias]).trim() !== "") {
        return String(source[alias]).trim();
      }
    }
  }
  return "";
}

function normalizeRedSecAiToolArgs(toolName, args = {}) {
  const tool = TOOL_ALLOWLIST[toolName];
  const cleanArgs = getNestedObject(args);
  if (!tool) return { ...cleanArgs };
  const paramNames = getToolPathParamNames(tool);
  let normalized = { ...cleanArgs };
  if (!paramNames.length) return normalizeWikiBody(toolName, normalized);
  const pathParams = { ...getNestedObject(cleanArgs.pathParams) };
  for (const key of paramNames) {
    const value = findPathParamValue(toolName, cleanArgs, key);
    if (value) pathParams[key] = value;
  }
  normalized = { ...cleanArgs, pathParams };
  return normalizeWikiBody(toolName, normalized);
}

function normalizeRedSecAiToolCall(call = {}) {
  return {
    tool: String(call.tool || ""),
    args: normalizeRedSecAiToolArgs(String(call.tool || ""), call.args || {}),
  };
}

function schemaTypeName(schema) {
  if (!schema) return "any";
  if (schema.enum) return "enum";
  return schema.type || "any";
}

function valueMatchesSchemaType(value, schema) {
  if (!schema || schema.enum) return true;
  if (schema.type === "object") return value && typeof value === "object" && !Array.isArray(value);
  if (schema.type === "array") return Array.isArray(value);
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "integer") return Number.isInteger(value);
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "boolean") return typeof value === "boolean";
  return true;
}

function validateValueAgainstSchema(value, schema, path = [], errors = []) {
  if (!schema) return errors;
  const label = path.join(".") || "args";
  if (!valueMatchesSchemaType(value, schema)) {
    errors.push(`${label} must be ${schemaTypeName(schema)}`);
    return errors;
  }
  if (schema.enum && value !== undefined && !schema.enum.includes(value)) {
    errors.push(`${label} must be one of: ${schema.enum.join(", ")}`);
    return errors;
  }
  if (schema.type !== "object" || !value || typeof value !== "object" || Array.isArray(value)) {
    return errors;
  }

  const properties = schema.properties || {};
  const allowed = new Set(Object.keys(properties));
  for (const key of schema.required || []) {
    if (value[key] === undefined || value[key] === null || value[key] === "") {
      errors.push(`${[...path, key].join(".")} is required`);
    }
  }
  for (const [key, childValue] of Object.entries(value)) {
    if (!allowed.has(key) && !schema.additionalProperties) {
      errors.push(`${[...path, key].join(".")} is not a valid field`);
      continue;
    }
    if (!allowed.has(key) && schema.additionalProperties) continue;
    validateValueAgainstSchema(childValue, properties[key], [...path, key], errors);
  }
  return errors;
}

function getRedSecAiSchemaValidationErrors(toolName, args = {}) {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  if (!schema) return [];
  return validateValueAgainstSchema(getNestedObject(args), schema);
}

function getRedSecAiSchemaValidationError(toolName, args = {}) {
  const errors = getRedSecAiSchemaValidationErrors(toolName, args);
  if (!errors.length) return null;
  return `Tool call does not match RedSecAI schema for ${toolName}: ${errors.slice(0, 8).join("; ")}`;
}

function getMissingRedSecAiPathParams(toolName, args = {}) {
  const tool = TOOL_ALLOWLIST[toolName];
  if (!tool) return [];
  const normalized = normalizeRedSecAiToolArgs(toolName, args);
  const pathParams = getNestedObject(normalized.pathParams);
  return getToolPathParamNames(tool).filter((key) => !pathParams[key]);
}

function compareIsoDates(startDate, endDate) {
  const start = String(startDate || "").trim();
  const end = String(endDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  if (end < start) return -1;
  if (end > start) return 1;
  return 0;
}

function getRedSecAiActionValidationError(toolName, args = {}) {
  const normalized = normalizeRedSecAiToolArgs(toolName, args);
  const schemaValidationError = getRedSecAiSchemaValidationError(toolName, normalized);
  if (schemaValidationError) return schemaValidationError;
  const missingPathParams = getMissingRedSecAiPathParams(toolName, normalized);
  if (missingPathParams.length) {
    return `Required RedSecAI tool path parameter is missing: ${missingPathParams.join(", ")}`;
  }
  const body = getNestedObject(normalized.body);
  if (toolName === "wiki.page.update") {
    const changedFields = ["title", "slug", "bodyMarkdown", "parentPageId", "sortOrder"]
      .filter((field) => body[field] !== undefined);
    if (!changedFields.length) return "Wiki update did not include any page fields to change";
    if (body.bodyMarkdown !== undefined && !String(body.bodyMarkdown).trim()) {
      return "Wiki update bodyMarkdown cannot be empty";
    }
  }
  if (toolName === "wiki.page.create") {
    if (!String(body.title || "").trim()) return "Wiki page creation requires a title";
    if (body.bodyMarkdown !== undefined && !String(body.bodyMarkdown).trim()) {
      return "Wiki page bodyMarkdown cannot be empty";
    }
  }
  if (toolName === "homepage.shortcut.create") {
    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();
    if (!title) return "Shortcut creation requires a title";
    if (title.length > 100) return "Shortcut title must be 100 characters or less";
    if (!url) return "Shortcut creation requires a URL";
    if (url.length > 500) return "Shortcut URL must be 500 characters or less";
    if (!url.startsWith("/") && !/^https?:\/\//i.test(url)) {
      return "Shortcut URL must start with /, http://, or https://";
    }
  }
  if (toolName === "calendar.entry.create") {
    if (!String(body.title || "").trim()) return "Calendar entry creation requires a title";
    const startsAt = Number(body.startsAt);
    const endsAt = Number(body.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
      return "Calendar entry creation requires a valid start and end time";
    }
    if (Array.isArray(body.assigneeUserIds) && body.assigneeUserIds.includes("__all__") && !body.assigneeUserIds.every((id) => id === "__all__")) {
      return "Calendar entry creation cannot mix __all__ with specific assignee IDs";
    }
  }
  if (toolName === "calendar.project.schedule") {
    if (!String(body.projectId || "").trim() && !String(body.projectName || "").trim()) {
      return "Project scheduling requires either projectId or projectName";
    }
    if (!String(body.startDate || "").trim() || !String(body.endDate || "").trim()) {
      return "Project scheduling requires startDate and endDate in YYYY-MM-DD format";
    }
    if (compareIsoDates(body.startDate, body.endDate) === -1) {
      return "Project scheduling endDate is before startDate; ask the user to confirm the intended date range";
    }
  }
  if (toolName === "calendar.allocation.create") {
    if (!String(body.projectId || "").trim()) return "Project allocation requires projectId";
    if (String(body.allocationMode || "daily") === "daily") {
      if (!String(body.startDate || "").trim() || !String(body.endDate || "").trim()) {
        return "Project allocation requires startDate and endDate in YYYY-MM-DD format";
      }
      if (compareIsoDates(body.startDate, body.endDate) === -1) {
        return "Project allocation endDate is before startDate; ask the user to confirm the intended date range";
      }
    } else {
      const startsAt = Number(body.startsAt);
      const endsAt = Number(body.endsAt);
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
        return "Project allocation requires a valid start and end time";
      }
    }
  }
  if (["calendar.project.create", "calendar.project.update"].includes(toolName)) {
    if (toolName === "calendar.project.create" && !String(body.name || "").trim()) return "Calendar project creation requires a name";
    const startsAt = Number(body.startsAt);
    const endsAt = Number(body.endsAt);
    if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt < startsAt) {
      return "Project end date is before the start date; ask the user to confirm the intended date range";
    }
  }
  return null;
}

function buildToolPath(toolName, tool, args = {}) {
  let path = tool.path;
  const normalizedArgs = normalizeRedSecAiToolArgs(toolName, args);
  const pathParams = getNestedObject(normalizedArgs.pathParams);
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
  if (!hasToolAccess(req.access, tool)) return { ok: false, status: 403, error: "User RBAC denied RedSecAI tool access" };

  const normalizedArgs = normalizeRedSecAiToolArgs(toolName, args);
  const path = buildToolPath(toolName, tool, normalizedArgs);
  if (!path) return { ok: false, status: 400, error: "Required RedSecAI tool path parameter is missing" };
  const params = new URLSearchParams();
  const query = normalizedArgs.query && typeof normalizedArgs.query === "object"
    ? normalizedArgs.query
    : (tool.method === "GET"
      ? Object.fromEntries(Object.entries(normalizedArgs || {}).filter(([key]) => !["pathParams", "params", "body"].includes(key)))
      : {});
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
    init.body = JSON.stringify(normalizedArgs.body && typeof normalizedArgs.body === "object" ? normalizedArgs.body : normalizedArgs);
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

function getArrayFromBody(body, keys = []) {
  if (Array.isArray(body)) return body;
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function textMatchesQuery(value, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText(value).includes(needle);
}

function objectSearchCorpus(item, fields) {
  return fields.map((field) => item?.[field]).filter((value) => value !== undefined && value !== null).join(" ");
}

async function searchUsers(req, args = {}) {
  const query = String(args.query || "").trim().slice(0, 200);
  const domain = String(args.domain || "all");
  const limit = Math.min(50, Math.max(1, parseInt(args.limit, 10) || 10));
  const users = [];
  const seen = new Set();
  const addUser = (user, source) => {
    if (!user?.id || seen.has(user.id)) return;
    seen.add(user.id);
    users.push({
      id: user.id,
      username: user.username || user.name || null,
      email: user.email || null,
      roleName: user.roleName || user.role || null,
      source,
      assignmentValues: source === "calendar" ? {
        assigneeUserId: user.id,
        assigneeUserIds: [user.id],
      } : null,
    });
  };

  if (domain !== "reporter" && hasAny(req.access, ["calendar.view", "calendar.view_team", "calendar.manage"])) {
    const calendar = await scopedApiGet(req, "calendar.bootstrap", { viewMode: "week", scheduleUserId: hasAny(req.access, ["calendar.view_team", "calendar.manage"]) ? "all" : undefined });
    const availableUsers = Array.isArray(calendar.body?.availableUsers) ? calendar.body.availableUsers : [];
    availableUsers.forEach((user) => addUser(user, "calendar"));
    if (calendar.body?.capabilities?.canAssignOthers) {
      users.push({
        id: "__all__",
        username: "All team members",
        source: "calendar",
        assignmentValues: { assigneeUserIds: ["__all__"] },
        description: "Use only for calendar.entry.create when the user explicitly asks to add the entry for everyone.",
      });
    }
  }

  if (domain !== "calendar" && hasAny(req.access, ["reporter.create", "reporter.edit_assigned", "reporter.manage_all"])) {
    const reporter = await scopedApiGet(req, "reporter.users");
    getArrayFromBody(reporter.body, ["users"]).forEach((user) => addUser(user, "reporter"));
  }

  const filtered = users
    .filter((user) => textMatchesQuery([user.id, user.username, user.email, user.roleName, user.description].join(" "), query))
    .slice(0, limit);

  return {
    tool: "users.search",
    ok: true,
    status: 200,
    query: { query, domain, limit },
    data: {
      count: filtered.length,
      users: filtered,
    },
  };
}

async function listCalendarProjectsForAi(req) {
  const result = await scopedApiGet(req, "calendar.projects");
  return { result, projects: getArrayFromBody(result.body, ["projects"]) };
}

async function searchCalendarProjects(req, args = {}) {
  const query = String(args.query || "").trim().slice(0, 200);
  const limit = Math.min(50, Math.max(1, parseInt(args.limit, 10) || 10));
  const { result, projects } = await listCalendarProjectsForAi(req);
  if (!result.ok) return summarizeResult("calendar.project.search", result, args);
  const matches = projects
    .filter((project) => textMatchesQuery(objectSearchCorpus(project, ["id", "name", "title", "code", "clientName", "projectType", "description", "status"]), query))
    .slice(0, limit);
  return {
    tool: "calendar.project.search",
    ok: true,
    status: 200,
    query: { query, limit },
    data: { count: matches.length, projects: matches },
  };
}

async function getCalendarProject(req, args = {}) {
  const id = String(args.id || args.pathParams?.id || "").trim();
  const { result, projects } = await listCalendarProjectsForAi(req);
  if (!result.ok) return summarizeResult("calendar.project.get", result, args);
  const project = projects.find((item) => item.id === id) || null;
  return project
    ? { tool: "calendar.project.get", ok: true, status: 200, data: { project } }
    : { tool: "calendar.project.get", ok: false, status: 404, error: "Calendar project not found" };
}

async function searchCalendarEntries(req, args = {}) {
  const query = String(args.query || "").trim().slice(0, 200);
  const limit = Math.min(50, Math.max(1, parseInt(args.limit, 10) || 10));
  const apiQuery = {
    startsAfter: args.startsAfter,
    endsBefore: args.endsBefore,
    scope: args.scope,
  };
  const result = await scopedApiGet(req, "calendar.entries", apiQuery);
  if (!result.ok) return summarizeResult("calendar.entry.search", result, args);
  const entries = getArrayFromBody(result.body, ["entries"]);
  const matches = entries
    .filter((entry) => textMatchesQuery(objectSearchCorpus(entry, ["id", "title", "description", "type", "status", "projectId", "assigneeUserId"]), query))
    .slice(0, limit);
  return {
    tool: "calendar.entry.search",
    ok: true,
    status: 200,
    query: { query, limit, apiQuery },
    data: { count: matches.length, entries: matches },
  };
}

async function getCalendarEntry(req, args = {}) {
  const id = String(args.id || args.pathParams?.id || "").trim();
  const result = await scopedApiGet(req, "calendar.entries", { startsAfter: 0, endsBefore: 4102444800, scope: args.scope });
  if (!result.ok) return summarizeResult("calendar.entry.get", result, args);
  const entry = getArrayFromBody(result.body, ["entries"]).find((item) => item.id === id) || null;
  return entry
    ? { tool: "calendar.entry.get", ok: true, status: 200, data: { entry } }
    : { tool: "calendar.entry.get", ok: false, status: 404, error: "Calendar entry not found" };
}

async function getCalendarSettingsForAi(req, args = {}) {
  const result = await scopedApiGet(req, "calendar.bootstrap", {
    viewMode: "week",
    scheduleUserId: hasAny(req.access, ["calendar.view_team", "calendar.manage"]) ? "all" : undefined,
    timeZone: args.timeZone,
  });
  if (!result.ok) return summarizeResult("calendar.settings", result, args);
  const body = result.body || {};
  return {
    tool: "calendar.settings",
    ok: true,
    status: result.status,
    data: {
      settings: body.settings || null,
      capabilities: body.capabilities || null,
      currentUserId: body.currentUserId || null,
      availableUsers: body.availableUsers || [],
      allowedCalendarAssignmentValues: body.capabilities?.canAssignOthers
        ? { everyone: { field: "assigneeUserIds", value: ["__all__"] } }
        : { self: { field: "assigneeUserId", value: body.currentUserId || null } },
    },
  };
}

function summarizeWikiPageMetadata(page, options = {}) {
  if (!page || typeof page !== "object") return null;
  const excerpt = String(page.excerpt || page.bodyMarkdown || "").replace(/\s+/g, " ").trim();
  const summary = {
    id: page.id,
    title: page.title || null,
    slug: page.slug || null,
    scope: page.scope || null,
    parentPageId: page.parentPageId || null,
    ownerUsername: page.ownerUsername || null,
    authorUsername: page.authorUsername || null,
    lastEditorUsername: page.lastEditorUsername || null,
    excerpt: excerpt.slice(0, options.excerptChars || 320),
    updatedAt: page.updatedAt || null,
  };
  if (options.includeBody) {
    const bodyMarkdown = String(page.bodyMarkdown || "");
    summary.bodyMarkdown = bodyMarkdown.slice(0, options.bodyChars || 8000);
    summary.bodyChars = bodyMarkdown.length;
  }
  return summary;
}

function summarizeWikiSearch(toolName, result) {
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  const results = Array.isArray(result.body?.results) ? result.body.results : [];
  return {
    tool: toolName,
    ok: true,
    status: result.status,
    data: {
      count: results.length,
      results: results.slice(0, 20).map((page) => summarizeWikiPageMetadata(page)).filter(Boolean),
    },
  };
}

function summarizeWikiBootstrap(toolName, result) {
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  const body = result.body || {};
  const teamPages = Array.isArray(body.teamPages) ? body.teamPages : [];
  const personalPages = Array.isArray(body.personalPages) ? body.personalPages : [];
  const recentPages = Array.isArray(body.recentPages) ? body.recentPages : [];
  return {
    tool: toolName,
    ok: true,
    status: result.status,
    data: {
      currentUserId: body.currentUserId || null,
      currentUsername: body.currentUsername || null,
      capabilities: body.capabilities || null,
      stats: body.stats || null,
      pageCounts: {
        team: teamPages.length,
        personal: personalPages.length,
        recent: recentPages.length,
      },
      teamPages: teamPages.slice(0, 60).map((page) => summarizeWikiPageMetadata(page)).filter(Boolean),
      personalPages: personalPages.slice(0, 60).map((page) => summarizeWikiPageMetadata(page)).filter(Boolean),
      recentPages: recentPages.slice(0, 20).map((page) => summarizeWikiPageMetadata(page)).filter(Boolean),
      selectedPage: summarizeWikiPageMetadata(body.selectedPage),
      revisionCount: Array.isArray(body.revisions) ? body.revisions.length : 0,
    },
  };
}

function summarizeWikiPageGet(toolName, result) {
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  const page = result.body?.page || null;
  return {
    tool: toolName,
    ok: true,
    status: result.status,
    data: {
      page: summarizeWikiPageMetadata(page, { includeBody: true }),
      revisions: Array.isArray(result.body?.revisions)
        ? result.body.revisions.slice(0, 5).map((revision) => ({
          id: revision.id,
          title: revision.title || null,
          authorUsername: revision.authorUsername || null,
          createdAt: revision.createdAt || null,
          excerpt: String(revision.excerpt || revision.bodyMarkdown || "").replace(/\s+/g, " ").trim().slice(0, 240),
        }))
        : [],
    },
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
      availableUsers: (body.availableUsers || []).slice(0, 100).map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role || null,
      })),
      allowedCalendarAssignmentValues: body.capabilities?.canAssignOthers
        ? { everyone: { field: "assigneeUserIds", value: ["__all__"] } }
        : { self: { field: "assigneeUserId", value: body.currentUserId || body.selectedUser?.id || null } },
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
  const schemaArgs = options.confirmed ? normalizeRedSecAiToolArgs(toolName, args) : getNestedObject(args);
  const schemaValidationError = getRedSecAiSchemaValidationError(toolName, schemaArgs);
  if (schemaValidationError) {
    return { tool: toolName, ok: false, status: 400, args: schemaArgs, error: schemaValidationError };
  }
  const normalizedArgs = normalizeRedSecAiToolArgs(toolName, args);
  if (isRedSecAiToolMutating(toolName) && !options.confirmed) {
    return {
      tool: toolName,
      ok: false,
      status: 409,
      requiresConfirmation: true,
      args: normalizedArgs,
      error: "This RedSecAI tool requires explicit user confirmation",
    };
  }
  const validationError = isRedSecAiToolMutating(toolName)
    ? getRedSecAiActionValidationError(toolName, normalizedArgs)
    : null;
  if (validationError) {
    return { tool: toolName, ok: false, status: 400, args: normalizedArgs, error: validationError };
  }
  if (toolName === "threat.searchAlerts") return searchThreatAlerts(req, normalizedArgs);
  if (toolName === "wiki.search") return searchWiki(req, normalizedArgs);
  if (toolName === "users.search") return searchUsers(req, normalizedArgs);
  if (toolName === "calendar.settings") return getCalendarSettingsForAi(req, normalizedArgs);
  if (toolName === "calendar.project.search") return searchCalendarProjects(req, normalizedArgs);
  if (toolName === "calendar.project.get") return getCalendarProject(req, normalizedArgs);
  if (toolName === "calendar.entry.search") return searchCalendarEntries(req, normalizedArgs);
  if (toolName === "calendar.entry.get") return getCalendarEntry(req, normalizedArgs);
  if (toolName === "calendar.entry.create" && options.confirmed) return executeCalendarEntryCreate(req, normalizedArgs);
  if (toolName === "calendar.project.schedule" && options.confirmed) return executeCalendarProjectSchedule(req, normalizedArgs);
  if (toolName === "wiki.page.update" && options.confirmed) return executeWikiPageUpdate(req, normalizedArgs);
  const result = await scopedApiRequest(req, toolName, normalizedArgs);
  return summarizeResult(toolName, result, normalizedArgs);
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
  if (hasAny(access, ["survey.create", "survey.manage_any", "survey.view_results_any"]) && (
    /\b(survey|poll|questionnaire|responses?|results?)\b/i.test(lower)
  )) {
    calls.push({ tool: "survey.list", args: {} });
  }
  if (access?.userId && /\b(homepage|shortcut|shortcuts|favourite|favorite)\b/i.test(lower)) {
    calls.push({ tool: "homepage.shortcuts", args: {} });
  }
  if (hasAny(access, ["bulletin.view", "bulletin.create", "bulletin.edit_any", "bulletin.pin", "bulletin.manage"]) && (
    /\b(bulletin|announcement)\b/i.test(lower)
  )) {
    calls.push({ tool: "homepage.bulletins", args: { limit: 10 } });
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
  if (toolName === "wiki.search") {
    return summarizeWikiSearch(toolName, result);
  }
  if (toolName === "wiki.bootstrap") {
    return summarizeWikiBootstrap(toolName, result);
  }
  if (toolName === "wiki.page.get" || toolName === "wiki.page.getBySlug") {
    return summarizeWikiPageGet(toolName, result);
  }
  if (!result.ok) {
    return { tool: toolName, ok: false, status: result.status, error: result.error || `HTTP ${result.status}` };
  }
  return { tool: toolName, ok: true, status: result.status, data: compactToolResultData(result.body) };
}

function compactToolResultData(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 8000 ? `${value.slice(0, 8000)}\n...[truncated]` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, depth === 0 ? 60 : 30).map((item) => compactToolResultData(item, depth + 1));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      output[key] = compactToolResultData(child, depth + 1);
      output[`${key}Count`] = child.length;
    } else if (child && typeof child === "object") {
      output[key] = depth >= 3 ? "[object omitted]" : compactToolResultData(child, depth + 1);
    } else {
      output[key] = compactToolResultData(child, depth + 1);
    }
  }
  return output;
}

function sameCalendarEntry(entry, body) {
  if (!entry || !body) return false;
  const titleA = String(entry.title || "").trim().toLowerCase();
  const titleB = String(body.title || "").trim().toLowerCase();
  const typeA = String(entry.type || "");
  const typeB = String(body.type || "");
  return titleA === titleB
    && Number(entry.startsAt) === Number(body.startsAt)
    && Number(entry.endsAt) === Number(body.endsAt)
    && (!typeA || !typeB || typeA === typeB);
}

async function executeCalendarEntryCreate(req, args = {}) {
  const body = getNestedObject(args.body);
  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  const preflight = await scopedApiRequest(req, "calendar.bootstrap", {
    viewMode: "week",
    scheduleUserId: Array.isArray(body.assigneeUserIds) ? "all" : (body.assigneeUserId || req.user?.id || ""),
    rangeStart: Number.isFinite(startsAt) ? Math.max(0, startsAt - 60) : undefined,
    rangeEnd: Number.isFinite(endsAt) ? endsAt + 60 : undefined,
    timeZone: body.timeZone,
  });
  if (!preflight.ok) {
    return {
      tool: "calendar.entry.create",
      ok: false,
      status: preflight.status || 400,
      error: "Could not preflight calendar for duplicate entries before creating the action",
    };
  }

  const availableUsers = Array.isArray(preflight.body?.availableUsers) ? preflight.body.availableUsers : [];
  const requestedAssignees = Array.isArray(body.assigneeUserIds)
    ? (body.assigneeUserIds.includes("__all__") ? availableUsers.map((user) => user.id) : body.assigneeUserIds)
    : [body.assigneeUserId || req.user?.id].filter(Boolean);
  const uniqueAssignees = [...new Set(requestedAssignees.map((id) => String(id || "").trim()).filter(Boolean))];
  const existingEntries = Array.isArray(preflight.body?.scheduleEntries) ? preflight.body.scheduleEntries : [];
  const duplicateAssignees = new Set(
    existingEntries
      .filter((entry) => sameCalendarEntry(entry, body))
      .map((entry) => entry.assigneeUserId || entry.ownerId || entry.calendarUserId)
      .filter(Boolean)
  );
  const assigneesToCreate = uniqueAssignees.filter((id) => !duplicateAssignees.has(id));

  if (!assigneesToCreate.length) {
    return {
      tool: "calendar.entry.create",
      ok: false,
      status: 409,
      args,
      error: "Matching calendar entry already exists for the requested assignee(s); no duplicate was created",
      data: { skippedAssigneeUserIds: uniqueAssignees },
    };
  }

  const createBody = { ...body };
  if (Array.isArray(body.assigneeUserIds)) {
    createBody.assigneeUserIds = assigneesToCreate;
  } else if (body.assigneeUserId) {
    createBody.assigneeUserId = assigneesToCreate[0];
  }
  const result = await scopedApiRequest(req, "calendar.entry.create", { body: createBody });
  const summary = summarizeResult("calendar.entry.create", result, args);
  if (summary.ok) {
    summary.data = {
      ...(summary.data || {}),
      redsecAiDuplicatePreflight: {
        requestedAssigneeUserIds: uniqueAssignees,
        skippedAssigneeUserIds: [...duplicateAssignees].filter((id) => uniqueAssignees.includes(id)),
        createdAssigneeUserIds: assigneesToCreate,
      },
    };
  }
  return summary;
}

async function executeCalendarProjectSchedule(req, args = {}) {
  const body = getNestedObject(args.body);
  let projectId = String(body.projectId || "").trim();
  let project = null;
  const projectName = String(body.projectName || "").trim();

  if (!projectId) {
    if (!hasAny(req.access, ["calendar.manage"])) {
      return {
        tool: "calendar.project.schedule",
        ok: false,
        status: 403,
        args,
        error: "Creating a calendar project before scheduling it requires calendar.manage",
      };
    }
    const projectBody = {
      name: projectName,
      description: String(body.projectDescription || body.description || "").trim(),
      clientName: body.clientName,
      projectType: body.projectType,
      code: body.code,
      color: body.color,
      estimatedMode: body.estimatedMode,
      estimatedValue: body.estimatedValue,
      billableRate: body.billableRate,
      notes: body.notes,
      startsAt: 0,
      endsAt: 0,
      status: "active",
    };
    for (const [key, value] of Object.entries(projectBody)) {
      if (value === undefined || value === null || value === "") delete projectBody[key];
    }
    const projectResult = await scopedApiRequest(req, "calendar.project.create", { body: projectBody });
    if (!projectResult.ok) {
      return summarizeResult("calendar.project.schedule", projectResult, args);
    }
    project = projectResult.body?.project || null;
    projectId = String(project?.id || "").trim();
    if (!projectId) {
      return {
        tool: "calendar.project.schedule",
        ok: false,
        status: 502,
        args,
        error: "Calendar project was created but no project ID was returned",
      };
    }
  }

  const allocationBody = {
    projectId,
    allocationMode: "daily",
    startDate: body.startDate,
    endDate: body.endDate,
    title: body.title || projectName || undefined,
    description: body.description || body.projectDescription || undefined,
    hoursPerDay: body.hoursPerDay,
    workdaysOnly: body.workdaysOnly,
    status: body.status || "scheduled",
  };
  if (body.assigneeUserId) allocationBody.assigneeUserId = body.assigneeUserId;
  for (const [key, value] of Object.entries(allocationBody)) {
    if (value === undefined || value === null || value === "") delete allocationBody[key];
  }

  const allocationResult = await scopedApiRequest(req, "calendar.allocation.create", { body: allocationBody });
  const summary = summarizeResult("calendar.project.schedule", allocationResult, args);
  if (summary.ok) {
    summary.data = {
      ...(summary.data || {}),
      project: project || { id: projectId },
      allocation: summary.data || null,
    };
  }
  return summary;
}

async function executeWikiPageUpdate(req, args = {}) {
  const current = await scopedApiRequest(req, "wiki.page.get", { pathParams: args.pathParams });
  if (!current.ok) {
    return summarizeResult("wiki.page.update", current, args);
  }
  const page = current.body?.page || {};
  const body = getNestedObject(args.body);
  const changedFields = [];
  if (body.title !== undefined && String(body.title) !== String(page.title || "")) changedFields.push("title");
  if (body.slug !== undefined && String(body.slug) !== String(page.slug || "")) changedFields.push("slug");
  if (body.bodyMarkdown !== undefined && String(body.bodyMarkdown) !== String(page.bodyMarkdown || "")) changedFields.push("bodyMarkdown");
  if (body.parentPageId !== undefined && String(body.parentPageId || "") !== String(page.parentPageId || "")) changedFields.push("parentPageId");
  if (body.sortOrder !== undefined && Number(body.sortOrder) !== Number(page.sortOrder || 0)) changedFields.push("sortOrder");

  if (!changedFields.length) {
    return {
      tool: "wiki.page.update",
      ok: false,
      status: 400,
      args,
      error: "Wiki update did not change the page content or metadata",
    };
  }

  const result = await scopedApiRequest(req, "wiki.page.update", args);
  const summary = summarizeResult("wiki.page.update", result, args);
  if (summary.ok) summary.changedFields = changedFields;
  return summary;
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
  getRedSecAiToolCatalog,
  getRedSecAiToolManifest,
  getRedSecAiActionValidationError,
  getRedSecAiSchemaValidationError,
  getRedSecAiSchemaValidationErrors,
  getMissingRedSecAiPathParams,
  hasAny,
  isRedSecAiToolMutating,
  normalizeRedSecAiToolArgs,
  normalizeRedSecAiToolCall,
  scopedApiRequest,
  scopedApiGet,
  TOOL_DISCOVERY,
  TOOL_INPUT_SCHEMAS,
  TOOL_ALLOWLIST,
};
