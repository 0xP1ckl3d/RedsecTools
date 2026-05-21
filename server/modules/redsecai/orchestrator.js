"use strict";

const {
  compactJson,
  executeRedSecAiTool,
  getRedSecAiToolCatalog,
  getRedSecAiToolManifest,
  getRedSecAiActionValidationError,
  getRedSecAiSchemaValidationError,
  isRedSecAiToolMutating,
  normalizeRedSecAiToolCall,
} = require("./context");
const { createPendingAction } = require("./actions");
const provider = require("./provider");
const { logEvent } = require("../../core/logger");

const MAX_MODEL_TOOL_CALLS = 4;
const MAX_TOOL_ARG_CHARS = 1000;
const MAX_TOOL_BODY_CHARS = 60000;
const MAX_TOOL_TEXT_CHARS = 10000;
const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

const LONG_DOCUMENT_FIELDS = new Set([
  "bodyMarkdown",
  "markdown",
  "contentMarkdown",
  "pageMarkdown",
  "pageBody",
  "document",
  "documentMarkdown",
]);

const LONG_TEXT_FIELDS = new Set([
  "body",
  "content",
  "description",
  "notes",
  "note",
  "details",
  "detail",
  "text",
  "message",
  "comment",
  "comments",
  "summary",
  "narrative",
  "evidence",
  "finding",
  "findings",
  "impact",
  "remediation",
  "recommendation",
  "recommendations",
  "reproduction",
  "steps",
]);

const SHORT_BODY_FIELDS = new Set([
  "id",
  "title",
  "name",
  "slug",
  "scope",
  "type",
  "status",
  "code",
  "color",
  "clientName",
  "projectType",
  "dateIntent",
  "dateLocal",
  "date",
  "expiresAt",
  "expiresAtDateIntent",
  "expiresAtLocal",
  "startDateIntent",
  "endDateIntent",
  "dueDate",
  "dueDateIntent",
  "dueDateDateIntent",
  "dueDateLocal",
  "startLocal",
  "startTimeLocal",
  "endLocal",
  "endTimeLocal",
  "startDate",
  "endDate",
  "timeZone",
  "projectId",
  "assigneeUserId",
  "assigneeUserIds",
  "allocationMode",
  "estimatedMode",
  "parentPageId",
  "tone",
  "color",
]);

const SYSTEM_PROMPT = `You are RedSecAI, the built-in local assistant for RedSecTools.

Security boundaries:
- You operate only for the logged-in user and only with the scoped context provided by RedSecTools APIs.
- You have access to server-executed internal tool results in TOOL_RESULTS. These results have already been fetched through the user's own RBAC-scoped APIs.
- You may also receive TARGETED_TOOL_RESULTS and MODEL_REQUESTED_TOOL_RESULTS for the user's current request. Prefer request-specific tool results over broad snapshots when answering specific questions.
- Do not say you have no access to internal tools when tool results contain successful outputs. Instead, say which scoped data is available.
- Never invent platform data. If the scoped tool results are empty, failed, or lack a requested field, say the data is not available in the current scoped tool results.
- Never tell the user to refresh the page, provide updated schedule data, or paste application data when a RedSecAI read/search tool exists for that domain. Tool routing must fetch the available context before the final answer.
- Routed turns can include a scoped tool manifest so you can decide and explain which allowlisted tools are available to this user. Do not claim that RedSecAI never receives a tool list or that the platform alone chooses tools without model routing.
- You do not have admin scope and must not claim to perform admin actions.
- You must not access, request, infer, store, or summarize decrypted content from RedSecPaste, RedSecShare, RedSecTeam chat, or RedSecVault.
- You may help draft report text, summarize permitted threat intel, and reason about permitted calendar context.
- Mutating platform actions are confirmation-gated. If MODEL_REQUESTED_TOOL_RESULTS contains a pending action, explain exactly what will happen and tell the user to confirm it in the action card.
- If the user already asked RedSecAI to create, update, finish, assign, block, or add something and no pending action exists, do not pretend it was done and do not ask for another yes/no confirmation in prose. Explain which target/data was still missing or that the action tool could not be prepared.
- Do not ask users to paste passwords, recovery codes, API keys, private keys, TOTP secrets, session tokens, bearer tokens, URL fragment encryption keys, or decrypted vault content.

Be concise, practical, and transparent about limitations.`;

const DIRECT_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

For this turn, no RedSecTools internal tool context was requested or fetched. Answer from general model knowledge only. If the user asks for current/live facts or RedSecTools data, say that live application context is not available for this turn and ask them to make the request specific to their RedSecTools data.
Do not describe RedSecAI routing internals, deny that routed turns can include a scoped tool manifest, or claim that the platform chooses every tool without model routing.`;

function normalizeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-12)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 4000),
    }))
    .filter((message) => message.content.trim());
}

function buildSystemMessages(scopedContext) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "system",
      content: `SERVER-EXECUTED TOOL ACCESS FOR THIS USER: ${scopedContext.allowedTools.join(", ") || "none"}\n\n${scopedContext.text}`,
    },
  ];
}

function buildScopedToolContext(req, toolManifest, targetedContext, page = {}) {
  const selectedTools = new Set([
    ...(targetedContext.candidateToolNames || []),
    ...(targetedContext.calls || []).map((call) => call.tool),
  ]);
  const selectedManifest = (toolManifest || []).filter((tool) => selectedTools.has(tool.name));
  const allowedTools = [...new Set(selectedManifest.map((tool) => tool.capability).filter(Boolean))];
  const sections = [
    `Current user: ${req.user?.username || "unknown"} (${req.user?.id || "unknown"})`,
    `Current page: ${String(page.path || req.get("referer") || "/").slice(0, 200)}`,
    `User timezone: ${String(page.timeZone || "server-local").slice(0, 80)}`,
    `Current server time: ${new Date().toISOString()}`,
    `Current user-local date/time: ${localDateTimeLabel(page.timeZone || null)}`,
    "RedSecAI tool execution is server-side allowlisted. It cannot call arbitrary routes and has no direct database handle.",
    "Only the selected tool results for this turn are included. If data is absent, say it is not available in the selected tool results.",
    "For calendar answers, use scheduleEntries from selected calendar tool results as the source of truth. Do not infer 'no meetings' from capacity stats if scheduleEntries contains entries.",
    "For 'rest of this week', answer from entries at or after the nowLabel/current time in TOOL_RESULTS and say the displayed timezone.",
    "Encrypted tools are intentionally excluded from scoped context: RedSecPaste, RedSecShare, RedSecTeam, and RedSecVault.",
    `SELECTED_TOOLS:\n${compactJson(selectedManifest.map((tool) => ({
      name: tool.name,
      capability: tool.capability,
      confirmRequired: tool.confirmRequired,
    })))}`,
    targetedContext.text,
  ];
  return {
    allowedTools,
    toolManifest: selectedManifest,
    toolResults: targetedContext.results,
    text: sections.join("\n\n"),
  };
}

function latestUserText(messages) {
  const latest = [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message?.role !== "assistant");
  return String(latest?.content || "").trim();
}

function describeToolCall(call) {
  const tool = typeof call === "string" ? call : call?.tool;
  const labels = {
    "calendar.bootstrap": "Reading your calendar",
    "calendar.entry.create": "Drafting a calendar entry",
    "calendar.entry.update": "Drafting a calendar update",
    "calendar.project.create": "Drafting a calendar project",
    "calendar.project.update": "Drafting a project update",
    "calendar.allocation.create": "Drafting a project allocation",
    "calendar.project.schedule": "Drafting a project schedule",
    "threat.bootstrap": "Reading threat dashboard state",
    "threat.alerts": "Checking threat alerts",
    "threat.searchAlerts": "Searching threat alerts",
    "reporter.projects": "Reading Reporter projects",
    "reporter.note.create": "Drafting a Reporter note",
    "wiki.bootstrap": "Checking visible wiki pages",
    "wiki.search": "Searching the wiki for matching pages",
    "wiki.page.get": "Reading the wiki page content",
    "wiki.page.create": "Drafting a wiki page",
    "wiki.page.update": "Drafting a wiki page update",
    "users.search": "Resolving exact user IDs",
    "calendar.settings": "Reading calendar settings",
    "calendar.stats": "Reading calendar utilisation",
    "calendar.projects": "Reading calendar projects",
    "calendar.project.search": "Searching calendar projects",
    "calendar.project.get": "Reading the calendar project",
    "calendar.project.delete": "Drafting a project deletion",
    "calendar.entries": "Reading calendar entries",
    "calendar.entry.search": "Searching calendar entries",
    "calendar.entry.get": "Reading the calendar entry",
    "calendar.entry.delete": "Drafting a calendar deletion",
    "homepage.home": "Reading homepage state",
    "homepage.settings": "Reading homepage settings",
    "homepage.settings.update": "Drafting homepage settings",
    "homepage.shortcuts": "Reading homepage shortcuts",
    "homepage.shortcut.create": "Drafting a shortcut",
    "homepage.shortcut.update": "Drafting a shortcut update",
    "homepage.shortcut.delete": "Drafting a shortcut deletion",
    "homepage.shortcut.favourite": "Drafting shortcut favourites",
    "homepage.shortcuts.reorder": "Drafting shortcut order",
    "homepage.toolFavourites": "Reading tool favourites",
    "homepage.toolFavourites.update": "Drafting tool favourites",
    "homepage.bulletins": "Reading bulletins",
    "homepage.bulletin.manageList": "Reading editable bulletins",
    "homepage.bulletin.get": "Reading the bulletin",
    "homepage.bulletin.create": "Drafting a bulletin",
    "homepage.bulletin.update": "Drafting a bulletin update",
    "homepage.bulletin.delete": "Drafting a bulletin deletion",
    "wiki.page.getBySlug": "Reading the wiki page by slug",
    "wiki.preview": "Rendering wiki preview",
    "wiki.page.delete": "Drafting a wiki page deletion",
    "wiki.page.reorder": "Drafting wiki page order",
    "wiki.page.restore": "Drafting a wiki restore",
    "threat.feeds": "Reading threat feeds",
    "threat.feed.get": "Reading the threat feed",
    "threat.keywords": "Reading threat keywords",
    "threat.keyword.get": "Reading the threat keyword",
    "threat.keyword.create": "Drafting a threat keyword",
    "threat.keyword.update": "Drafting a threat keyword update",
    "threat.keyword.delete": "Drafting a threat keyword deletion",
    "threat.tags": "Reading threat tags",
    "threat.tag.create": "Drafting a threat tag",
    "threat.tag.update": "Drafting a threat tag update",
    "threat.tag.delete": "Drafting a threat tag deletion",
    "threat.keyword.tags.set": "Drafting keyword tags",
    "threat.alert.tags.set": "Drafting alert tags",
    "threat.news": "Reading threat news",
    "threat.mitre": "Reading MITRE coverage",
    "threat.alert.get": "Reading the threat alert",
    "threat.alert.update": "Drafting alert state",
    "threat.alert.delete": "Drafting alert removal",
    "threat.alerts.readAll": "Drafting alert read status",
    "threat.userNotifications": "Reading threat notifications",
    "threat.userNotification.create": "Drafting threat notifications",
    "threat.userNotification.delete": "Drafting notification removal",
    "threat.health": "Reading threat feed health",
    "threat.feedErrors": "Reading threat feed errors",
    "reporter.bootstrap": "Reading Reporter workspace",
    "reporter.stats": "Reading Reporter stats",
    "reporter.users": "Reading Reporter users",
    "reporter.project.get": "Reading Reporter project",
    "reporter.project.create": "Drafting a Reporter project",
    "reporter.project.update": "Drafting a Reporter project update",
    "reporter.project.delete": "Drafting a Reporter project deletion",
    "reporter.project.status": "Drafting project status",
    "reporter.project.archive": "Drafting project archive",
    "reporter.project.unarchive": "Drafting project unarchive",
    "reporter.project.readonly": "Drafting project lock state",
    "reporter.project.duplicate": "Drafting project duplication",
    "reporter.project.check": "Checking report readiness",
    "reporter.project.history": "Reading project history",
    "reporter.project.notes": "Reading project notes",
    "reporter.note.update": "Drafting a Reporter note update",
    "reporter.note.delete": "Drafting a Reporter note deletion",
    "reporter.project.comments": "Reading project comments",
    "reporter.comments.byTarget": "Reading target comments",
    "reporter.comment.create": "Drafting a Reporter comment",
    "reporter.comment.resolve": "Drafting comment status",
    "reporter.comment.delete": "Drafting comment deletion",
    "reporter.project.evidence": "Reading evidence metadata",
    "reporter.evidence.update": "Drafting evidence metadata",
    "reporter.evidence.delete": "Drafting evidence deletion",
    "reporter.project.members": "Reading project members",
    "reporter.member.add": "Drafting project membership",
    "reporter.member.update": "Drafting member role",
    "reporter.member.remove": "Drafting member removal",
    "reporter.project.findings": "Reading project findings",
    "reporter.finding.create": "Drafting a finding",
    "reporter.finding.fromTemplate": "Drafting a templated finding",
    "reporter.finding.get": "Reading the finding",
    "reporter.finding.update": "Drafting a finding update",
    "reporter.finding.copy": "Drafting a finding copy",
    "reporter.finding.saveTemplate": "Drafting a finding template",
    "reporter.finding.status": "Drafting finding status",
    "reporter.finding.delete": "Drafting finding deletion",
    "reporter.findings.reorder": "Drafting finding order",
    "reporter.finding.field.update": "Drafting finding field content",
    "reporter.project.sections": "Reading report sections",
    "reporter.section.create": "Drafting a report section",
    "reporter.section.get": "Reading the report section",
    "reporter.section.update": "Drafting section content",
    "reporter.section.delete": "Drafting section deletion",
    "reporter.sections.reorder": "Drafting section order",
    "reporter.templates": "Reading finding templates",
    "reporter.template.get": "Reading the finding template",
    "reporter.template.create": "Drafting a finding template",
    "reporter.template.update": "Drafting template content",
    "reporter.template.delete": "Drafting template deletion",
    "survey.list": "Reading surveys",
    "survey.get": "Reading the survey",
    "survey.create": "Drafting a survey",
    "survey.update": "Drafting survey changes",
    "survey.delete": "Drafting survey deletion",
    "survey.status": "Drafting survey status",
    "survey.questions.reorder": "Drafting question order",
    "survey.stats": "Reading survey stats",
    "survey.results": "Reading survey results",
    "survey.response.get": "Reading survey response",
    "minitools.securitytrails.lookup": "Running SecurityTrails lookup",
    "minitools.dns.lookup": "Running DNS Intelligence lookup",
    "minitools.securityHeaders.fetch": "Analyzing security headers",
    "minitools.tls.check": "Running TLS diagnostic",
  };
  if (labels[tool]) return labels[tool];
  if (tool?.startsWith("calendar.")) return "Working with calendar data";
  if (tool?.startsWith("wiki.")) return "Working with wiki data";
  if (tool?.startsWith("threat.")) return "Working with threat intelligence";
  if (tool?.startsWith("reporter.")) return "Working with Reporter data";
  if (tool?.startsWith("survey.")) return "Working with survey data";
  if (tool?.startsWith("homepage.")) return "Working with homepage data";
  if (tool?.startsWith("minitools.")) return "Running a MiniTools diagnostic";
  return `Running ${tool || "selected tool"}`;
}

function emitStatus(options, status) {
  if (typeof options?.onStatus === "function") {
    options.onStatus(status);
  }
}

function buildToolPlannerPrompt(scopedContext, options = {}) {
  const timeZone = String(options.page?.timeZone || "server-local").slice(0, 80);
  const actionReviewRules = options.actionReview ? `
Action-review mode:
- The user may already have asked RedSecAI to change RedSecTools data. If the available read/search results identify the target and the requested change can be drafted safely, return the matching write tool call now.
- Do not ask "would you like me to update/create..." when the user already requested that action. The pending action card is the confirmation step.
- If a required record ID or body is still missing, request the specific read/search tool that can obtain it. Return [] only when no listed tool can safely advance the request.` : "";
  return {
    role: "system",
    content: `Before answering, decide whether extra scoped internal tools are needed.

Current server time: ${new Date().toISOString()}
Current user timezone: ${timeZone}
Current user-local date/time: ${localDateTimeLabel(options.page?.timeZone || null)}

Return ONLY strict JSON in this format:
{"toolCalls":[{"tool":"tool.name","args":{"query":"short search text","limit":8}}]}

Rules:
- Use only tools listed in TOOL_MANIFEST.
- Use at most ${MAX_MODEL_TOOL_CALLS} tool calls.
- Read/search tools can be used immediately. Write tools can only create a pending action card for explicit user confirmation.
- Do not request admin, vault, paste, share, or chat tools.
- MiniTools tools are read-only diagnostics. Use only the listed MiniTools diagnostics for explicit security-header, TLS, DNS Intelligence, or SecurityTrails requests. Do not request LeakRadar data through RedSecAI.
- For an ordinary DNS record lookup through minitools.dns.lookup, use args.body.toolId="dns_records", args.body.target="<domain>", and args.body.options.recordType with the requested record type such as "A", "AAAA", "MX", or "TXT".
- If the user asks which tools are available or asks for the current tool list, return {"toolCalls":[]} so the final answer can describe the scoped manifest without executing unrelated tools.
- Do not invent IDs, user IDs, project IDs, design IDs, template IDs, field names, enum values, or special assignee values. Use read/search tool results to obtain exact values first.
- For named people, teams, or membership/assignment requests, use users.search or the relevant bootstrap/users tool before writing unless the exact user ID is already present in tool results.
- If the selected TARGETED_TOOL_RESULTS are enough, return {"toolCalls":[]}.
- If the user asks for threat alerts about a topic, prefer threat.searchAlerts with a focused query.
- For threat keyword/tag/user notification changes, read the current keywords/tags/notification policy first when the target ID or allowed channel is not already present.
- If the user asks for wiki/runbook/procedure content, prefer wiki.search with a focused query.
- For approximate wiki names or unfinished pages, do not ask the user for more keywords until wiki.search and wiki.bootstrap results have both been considered when those tools are available.
- For wiki updates or "finish this page" requests, never overwrite a page from title/search metadata alone. If a likely page is identified but full bodyMarkdown is not present, request wiki.page.get first. Once bodyMarkdown is available, use wiki.page.update to draft the complete updated page body.
- If the user asks to create/update/delete a calendar event, use calendar.entry.create, calendar.entry.update, or calendar.entry.delete with the structured fields in that tool's inputSchema. For local-time requests, use dateIntent, startLocal, endLocal or durationMinutes, and timeZone. Do not convert local times to UTC yourself.
- For calendar "everyone" requests, only use assigneeUserIds:["__all__"] if calendar.settings, calendar.bootstrap, or users.search exposes that as an allowed assignment value.
- If the user asks to create a calendar project, use calendar.project.create with body.name and body.startDate/body.endDate in YYYY-MM-DD format.
- If the user asks to assign, allocate, schedule, or put a project into a calendar and the project may need to be created or linked, use calendar.project.schedule. Use calendar.allocation.create only when an existing projectId is already known.
- For month/day dates without a year, resolve against the user-local date above. Use the current year when the date or range is today, future, or already underway; use next year when the entire requested date or range has already passed and the user did not ask for a past/backdated item.
- For Reporter project creation, read reporter.bootstrap first and use an actual designId from that result.
- If the user asks about reports, findings, sections, comments, members, templates, clients, or evidence metadata, use the specific Reporter read tool listed in TOOL_MANIFEST. Do not fetch evidence file downloads or exports.
- If the user asks to create/update Reporter notes, findings, sections, comments, members, evidence metadata, or templates, use the matching Reporter write tool after reading any missing project/member/template IDs.
- If the user asks about surveys or survey results, use survey.list, survey.get, survey.stats, survey.results, or survey.response.get as appropriate.
- If the user asks to create/update survey questions, use exact questionType values from the schema: short_text, long_text, single_choice, multi_choice, rating, yes_no, dropdown.
- If the user asks about homepage shortcuts, homepage settings, tool favourites, or bulletins, use the matching homepage or bulletin tool.
- For homepage shortcut creation, use homepage.shortcut.create when the user provides a shortcut title and URL. It creates a personal shortcut for the logged-in user; do not ask for a target workspace/environment unless the title or URL is missing.
- If the user asks to create/update wiki content, use wiki.page.create or wiki.page.update.
${actionReviewRules}

Allowed tool manifest:
${compactJson(scopedContext.toolManifest, 8000)}`,
  };
}

function buildToolRouterPrompt(toolCatalog, messages = [], page = {}) {
  return {
    role: "system",
    content: `Decide whether this RedSecAI turn needs scoped RedSecTools internal tools before answering.

Current server time: ${new Date().toISOString()}
Current user timezone: ${String(page.timeZone || "server-local").slice(0, 80)}
Current user-local date/time: ${localDateTimeLabel(page.timeZone || null)}

Return ONLY strict JSON in this format:
{"useTools":false,"toolCalls":[]}

or:
{"useTools":true,"intent":"read","toolCalls":[{"tool":"tool.name","args":{"query":"short search text","limit":8}}],"selectedTools":["tool.name"]}

Rules:
- You are only routing. Do not answer the user.
- Set intent to "read" for lookup/summarize/check/list questions, "write" for create/update/delete/schedule/assign/change requests, or "mixed" when both are needed.
- Decide from the whole recent conversation, not only the last sentence. Follow-up phrases like "check it", "is it there", "what about that", "did it work", or "no meetings?" refer to the most relevant prior RedSecTools domain/action.
- Set useTools=false only for general knowledge, broad industry questions, quick connectivity checks, writing help that does not need RedSecTools records, or prompts like "reply only true if online".
- Set useTools=true whenever the user asks about, verifies, compares, updates, or follows up on RedSecTools data and a listed tool can provide that context.
- If a relevant read/search tool exists, never route to a final answer that would say "I do not have the current context", "refresh the page", or "provide the data".
- Use only tools listed in TOOL_CATALOG.
- Use at most ${MAX_MODEL_TOOL_CALLS} tool calls.
- Do not request admin, vault, paste, share, or chat tools.
- MiniTools tools are read-only diagnostics. Use them only for explicit security-header, TLS, DNS Intelligence, or SecurityTrails lookup requests. Do not route LeakRadar data into RedSecAI.
- For an ordinary DNS record lookup, select minitools.dns.lookup and use body.toolId=dns_records with body.options.recordType set to the requested record type.
- Prefer read/search tools first when the request asks to find, check, verify, list, inspect, or summarize existing RedSecTools data.
- Write tools create confirmation cards only and may need a prior read/search tool to identify the target record.
- If a write action is likely but you need more schema/context, set selectedTools to include the likely write tool and the read/search tools that can identify its required IDs.
- For approximate wiki page names, unfinished drafts, runbooks, or page contents, select wiki.search.
- If tools are needed but no single focused call is obvious, select the closest read/search tool.

Recent conversation:
${compactJson((messages || []).slice(-8), 6000)}

TOOL_CATALOG:
${compactJson(compactToolCatalogForRouter(toolCatalog), 9000)}`,
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch (_) {
        return null;
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

function getToolStringLimit(toolName, key, path = []) {
  const field = String(key || "");
  const pathParts = [...path, field];
  if (pathParts.includes("query") || pathParts.includes("pathParams")) return MAX_TOOL_ARG_CHARS;
  if (LONG_DOCUMENT_FIELDS.has(field)) {
    return MAX_TOOL_BODY_CHARS;
  }
  if (LONG_TEXT_FIELDS.has(field)) {
    return MAX_TOOL_BODY_CHARS;
  }
  if (pathParts.includes("body") && !SHORT_BODY_FIELDS.has(field)) {
    return MAX_TOOL_TEXT_CHARS;
  }
  if (toolName && /\.(create|update)$/.test(toolName) && !SHORT_BODY_FIELDS.has(field)) {
    return MAX_TOOL_TEXT_CHARS;
  }
  return MAX_TOOL_ARG_CHARS;
}

function sanitizeToolArgs(args = {}, depth = 0, context = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, getToolStringLimit(context.toolName, key, context.path || []));
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
    else if (value && typeof value === "object" && !Array.isArray(value) && depth < 2 && ["body", "query", "pathParams", "options"].includes(key)) {
      clean[key] = sanitizeToolArgs(value, depth + 1, {
        ...context,
        path: [...(context.path || []), key],
      });
    }
    else if (Array.isArray(value) && depth < 2) {
      clean[key] = value
        .slice(0, 20)
        .filter((item) => ["string", "number", "boolean"].includes(typeof item))
        .map((item) => typeof item === "string" ? item.slice(0, getToolStringLimit(context.toolName, key, context.path || [])) : item);
    }
  }
  return clean;
}

function sanitizeModelToolCalls(parsed, scopedContext) {
  const manifestNames = new Set((scopedContext.toolManifest || []).map((tool) => tool.name));
  const calls = Array.isArray(parsed?.toolCalls) ? parsed.toolCalls : [];
  const seen = new Set();
  return calls
    .map((call) => ({
      tool: String(call?.tool || ""),
      args: sanitizeToolArgs(call?.args || {}, 0, { toolName: String(call?.tool || ""), path: [] }),
    }))
    .filter((call) => manifestNames.has(call.tool))
    .filter((call) => !/\b(admin|vault|paste|share|chat)\b/i.test(call.tool))
    .filter((call) => {
      const key = `${call.tool}:${JSON.stringify(call.args)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MODEL_TOOL_CALLS);
}

function tokenizeForToolRouting(value) {
  return String(value || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_.:-]{2,}/g)?.filter((token) => !new Set([
      "the", "and", "for", "with", "that", "this", "have", "what", "please",
      "there", "something", "like", "about", "into", "from", "only",
    ]).has(token)) || [];
}

function catalogSearchText(tool) {
  return [
    tool.name,
    tool.domain,
    tool.kind,
    tool.capability,
    tool.purpose,
    ...(tool.examples || []),
  ].join(" ").toLowerCase();
}

function buildToolCallFromCatalogTool(tool, latest, page = {}) {
  if (!tool?.name) return null;
  if (tool.name === "users.search") return { tool: tool.name, args: { query: latest.slice(0, 200), limit: 8 } };
  if (tool.name === "wiki.search") return { tool: tool.name, args: { query: latest.slice(0, 500) } };
  if (tool.name === "threat.searchAlerts") return { tool: tool.name, args: { query: latest.slice(0, 500), limit: 8 } };
  if (tool.name === "threat.alerts") return { tool: tool.name, args: { limit: 20 } };
  if (tool.name === "threat.bootstrap") return { tool: tool.name, args: {} };
  if (tool.name === "threat.news") return { tool: tool.name, args: { limit: 12 } };
  if (tool.name === "threat.mitre") return { tool: tool.name, args: {} };
  if (tool.name === "threat.keywords") return { tool: tool.name, args: {} };
  if (tool.name === "threat.tags") return { tool: tool.name, args: {} };
  if (tool.name === "wiki.bootstrap") return { tool: tool.name, args: {} };
  if (tool.name === "reporter.projects") return { tool: tool.name, args: {} };
  if (tool.name === "reporter.bootstrap") return { tool: tool.name, args: {} };
  if (tool.name === "reporter.users") return { tool: tool.name, args: {} };
  if (tool.name === "reporter.templates") return { tool: tool.name, args: {} };
  if (tool.name === "calendar.bootstrap") return { tool: tool.name, args: { rangeIntent: "this_week", timeZone: page.timeZone || undefined } };
  if (tool.name === "calendar.settings") return { tool: tool.name, args: { timeZone: page.timeZone || undefined } };
  if (tool.name === "calendar.projects") return { tool: tool.name, args: {} };
  if (tool.name === "calendar.project.search") return { tool: tool.name, args: { query: latest.slice(0, 200), limit: 8 } };
  if (tool.name === "calendar.entries") return { tool: tool.name, args: {} };
  if (tool.name === "calendar.entry.search") return { tool: tool.name, args: { query: latest.slice(0, 200), limit: 8 } };
  if (tool.name === "homepage.home") return { tool: tool.name, args: {} };
  if (tool.name === "homepage.shortcuts") return { tool: tool.name, args: {} };
  if (tool.name === "homepage.bulletins") return { tool: tool.name, args: { limit: 10 } };
  if (tool.name === "homepage.toolFavourites") return { tool: tool.name, args: {} };
  if (tool.name === "survey.list") return { tool: tool.name, args: {} };
  if (tool.name === "minitools.securityHeaders.fetch") {
    if (!/\bsecurity\s+headers?\b/i.test(latest)) return null;
    const target = findMiniToolDomainTarget(latest);
    return target ? { tool: tool.name, args: { body: { mode: "url", url: target } } } : null;
  }
  if (tool.name === "minitools.tls.check") {
    if (!/\btls\b/i.test(latest)) return null;
    const target = findMiniToolDomainTarget(latest) || findMiniToolIpv4Target(latest);
    return target ? { tool: tool.name, args: { body: { target, includeDns: true } } } : null;
  }
  if (tool.name === "minitools.securitytrails.lookup") {
    if (!/\bsecuritytrails|reverse\s+ip\b/i.test(latest)) return null;
    const reverseIp = /\breverse\s+ip\b/i.test(latest);
    const target = reverseIp ? findMiniToolIpv4Target(latest) : findMiniToolDomainTarget(latest);
    if (!target) return null;
    return reverseIp
      ? { tool: tool.name, args: { type: "reverse_ip", ip: target } }
      : { tool: tool.name, args: { type: /\bsubdomains?\b/i.test(latest) ? "subdomains" : "both", domain: target } };
  }
  if (tool.name === "minitools.dns.lookup") {
    if (!/\bdns\b/i.test(latest)) return null;
    const target = findMiniToolDomainTarget(latest);
    const recordType = findMiniToolDnsRecordType(latest);
    return target && recordType
      ? { tool: tool.name, args: { body: { toolId: "dns_records", target, options: { recordType } } } }
      : null;
  }
  return null;
}

const MINITOOLS_DNS_RECORD_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "SRV", "DS", "DNSKEY", "RRSIG", "PTR"]);

function findMiniToolDomainTarget(value) {
  return String(value || "").match(/\b[a-z0-9]+(?:[-.][a-z0-9]+)+\.[a-z]{2,}\b/i)?.[0] || "";
}

function findMiniToolIpv4Target(value) {
  return String(value || "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
}

function findMiniToolDnsRecordType(value) {
  const match = String(value || "").match(/\b(a{1,4}|cname|mx|txt|ns|soa|caa|srv|ds|dnskey|rrsig|ptr)\s+(?:dns\s+)?records?\b/i);
  const type = String(match?.[1] || "").toUpperCase();
  return MINITOOLS_DNS_RECORD_TYPES.has(type) ? type : "";
}

function baselineToolNamesForDomain(domain) {
  const baselines = {
    users: ["users.search"],
    calendar: ["calendar.bootstrap", "calendar.settings", "calendar.projects", "calendar.project.search", "calendar.entries", "calendar.entry.search", "users.search"],
    wiki: ["wiki.bootstrap", "wiki.search", "wiki.page.get", "wiki.page.getBySlug"],
    threat: ["threat.bootstrap", "threat.alerts", "threat.searchAlerts", "threat.keywords", "threat.tags", "threat.news", "threat.mitre"],
    reporter: ["reporter.bootstrap", "reporter.projects", "reporter.project.get", "reporter.users", "reporter.templates"],
    homepage: ["homepage.home", "homepage.shortcuts", "homepage.bulletins", "homepage.toolFavourites", "homepage.shortcut.create", "homepage.shortcut.update", "homepage.shortcut.delete", "homepage.shortcut.favourite", "homepage.shortcuts.reorder", "homepage.toolFavourites.update", "homepage.settings.update"],
    survey: ["survey.list", "survey.get", "survey.stats", "survey.results"],
    minitools: ["minitools.securitytrails.lookup", "minitools.dns.lookup", "minitools.securityHeaders.fetch", "minitools.tls.check"],
  };
  return baselines[domain] || [];
}

function expandCandidateToolNames(seedNames, toolCatalog, messages = []) {
  const available = new Map((toolCatalog || []).map((tool) => [tool.name, tool]));
  const output = new Set();
  const recentText = (messages || []).slice(-4).map((message) => message?.content || "").join("\n");
  const tokens = new Set(tokenizeForToolRouting(`${latestUserText(messages)}\n${recentText}`));
  const seedDomains = new Set();
  for (const name of seedNames || []) {
    const tool = available.get(name);
    if (!tool) continue;
    output.add(name);
    if (tool.domain) seedDomains.add(tool.domain);
  }
  for (const domain of seedDomains) {
    for (const name of baselineToolNamesForDomain(domain)) {
      if (available.has(name)) output.add(name);
    }
    for (const tool of available.values()) {
      if (tool.domain !== domain) continue;
      const haystack = catalogSearchText(tool);
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += tool.confirmRequired ? 2 : 3;
        if (tool.name.toLowerCase().includes(token)) score += 4;
      }
      if (score >= 4) output.add(tool.name);
    }
  }
  return [...output].slice(0, 36);
}

function compactToolCatalogForRouter(toolCatalog) {
  const grouped = new Map();
  for (const tool of toolCatalog || []) {
    const domain = tool.domain || "other";
    if (!grouped.has(domain)) grouped.set(domain, []);
    grouped.get(domain).push({
      name: tool.name,
      kind: tool.kind,
      confirmRequired: !!tool.confirmRequired,
      purpose: String(tool.purpose || "").slice(0, 140),
    });
  }
  return [...grouped.entries()].map(([domain, tools]) => ({
    domain,
    tools: tools.slice(0, 28),
    totalTools: tools.length,
  }));
}

function selectCatalogCandidates(toolCatalog, messages = [], page = {}) {
  const latest = latestUserText(messages);
  const conversation = (messages || []).slice(-4).map((message) => message?.content || "").join("\n");
  const tokens = new Set(tokenizeForToolRouting(`${latest}\n${conversation}`));
  if (!tokens.size) return { calls: [], candidateToolNames: [] };

  const scored = (toolCatalog || []).map((tool) => {
    const haystack = catalogSearchText(tool);
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += tool.kind === "search" ? 3 : 2;
      if (tool.name.toLowerCase().includes(token)) score += 3;
      if (tool.domain && token === tool.domain) score += 3;
    }
    return { tool, score };
  })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || (a.tool.confirmRequired === b.tool.confirmRequired ? 0 : (a.tool.confirmRequired ? 1 : -1)))
    .slice(0, MAX_MODEL_TOOL_CALLS);

  const candidateToolNames = expandCandidateToolNames(scored.map((item) => item.tool.name), toolCatalog, messages);

  const scoredForCalls = scored.some((item) => item.tool.kind === "search")
    ? scored.filter((item) => item.tool.kind === "search")
    : scored;
  const calls = scoredForCalls
    .map((item) => buildToolCallFromCatalogTool(item.tool, latest, page))
    .filter(Boolean);

  return { calls, candidateToolNames };
}

function extractSelectedToolNames(parsed, calls = []) {
  const selected = new Set(calls.map((call) => call.tool));
  const rawTools = Array.isArray(parsed?.selectedTools) ? parsed.selectedTools : [];
  for (const value of rawTools) {
    if (typeof value === "string") selected.add(value);
    else if (value?.name) selected.add(String(value.name));
    else if (value?.tool) selected.add(String(value.tool));
  }
  return [...selected].filter(Boolean);
}

function shouldUseRecoveredToolsWhenRouterDeclines(messages = []) {
  const text = `${latestUserText(messages)}\n${(messages || []).slice(-4).map((message) => message?.content || "").join("\n")}`.toLowerCase();
  return /\b(calendar|schedule|scheduled|meeting|meetings|wiki|page|runbook|threat|alert|alerts|reporter|report|finding|survey|homepage|bulletin|shortcut|project|client|evidence|minitools|securitytrails|dns|security headers?|tls)\b/.test(text)
    || /\b(no meetings|anything on|what have i got|check it|is it there|did it work)\b/.test(text);
}

function userAskedForToolInventory(messages = []) {
  const text = latestUserText(messages).toLowerCase();
  return /\b(list|show|check|tell)\b[\s\S]{0,80}\b(available|scoped|your)\s+tools?\b/.test(text)
    || /\bwhat\s+tools?\b[\s\S]{0,80}\b(available|have|list|can\s+you\s+(?:use|call))\b/.test(text)
    || /\btool\s+list\b/.test(text);
}

function inferWriteIntentFromMessages(messages = []) {
  const text = `${latestUserText(messages)}\n${(messages || []).slice(-4).map((message) => message?.content || "").join("\n")}`.toLowerCase();
  return /\b(create|add|update|edit|change|delete|remove|schedule|assign|allocate|block|finish|draft|publish|close|reopen|archive|restore|reorder|mark|set|make)\b/.test(text);
}

function getZonedDateParts(date = new Date(), timeZone = null) {
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(date);
  const value = {};
  for (const part of parts) {
    if (part.type !== "literal") value[part.type] = Number(part.value);
  }
  if (value.hour === 24) value.hour = 0;
  return value;
}

function zonedLocalToUnix(year, month, day, hour, minute, second, timeZone = null) {
  if (!timeZone) return Math.floor(new Date(year, month - 1, day, hour, minute, second, 0).getTime() / 1000);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const actual = getZonedDateParts(new Date(utcGuess), timeZone);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour || 0, actual.minute || 0, actual.second || 0, 0);
  return Math.floor((utcGuess + (desiredAsUtc - actualAsUtc)) / 1000);
}

function parseLocalTime(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["midnight", "12am", "12:00am", "00:00"].includes(raw)) return { hour: 0, minute: 0 };
  if (["noon", "midday", "12pm", "12:00pm"].includes(raw)) return { hour: 12, minute: 0 };
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour < 7) hour += 12;
  if (hour < 0 || hour > 23) return null;
  return { hour, minute };
}

function getZonedToday(timeZone = null) {
  const local = getZonedDateParts(new Date(), timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

function recentUserText(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role !== "assistant")
    .slice(-6)
    .map((message) => String(message?.content || ""))
    .join("\n");
}

function userMentionedYear(messages = [], year) {
  const text = recentUserText(messages);
  return new RegExp(`\\b${String(year).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
}

function userAskedForPastDate(messages = []) {
  const text = recentUserText(messages);
  return /\b(past|historical|backdate|backdated|back-date|back-dated)\b/i.test(text)
    || /\b(last|previous)\s+(week|month|year|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(text);
}

function parseIsoDateOnly(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    raw,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    monthText: match[2],
    dayText: match[3],
  };
}

function compareDateParts(left, right) {
  if (!left || !right) return 0;
  if (left.year !== right.year) return left.year < right.year ? -1 : 1;
  if (left.month !== right.month) return left.month < right.month ? -1 : 1;
  if (left.day !== right.day) return left.day < right.day ? -1 : 1;
  return 0;
}

function formatIsoDateOnly(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function shouldPreserveModelDateYear(page = {}, values = []) {
  if (userAskedForPastDate(page.messages || [])) return true;
  return values
    .map(parseIsoDateOnly)
    .filter(Boolean)
    .some((parts) => userMentionedYear(page.messages || [], parts.year));
}

function normalizeModelDateOnlyYear(value, page = {}, options = {}) {
  const parsed = parseIsoDateOnly(value);
  if (!parsed) return value;
  if (shouldPreserveModelDateYear(page, [parsed.raw])) return parsed.raw;
  const currentYear = getZonedToday(page.timeZone || null).year;
  const normalized = { year: parsed.year, month: parsed.month, day: parsed.day };
  if (Number.isInteger(normalized.year) && normalized.year < currentYear) {
    normalized.year = currentYear;
  }
  if (options.rollPastToNextYear) {
    const today = getZonedToday(page.timeZone || null);
    if (compareDateParts(normalized, today) < 0) normalized.year += 1;
  }
  return formatIsoDateOnly(normalized);
}

function normalizeDateIntentForUserYear(value, page = {}, options = {}) {
  return normalizeModelDateOnlyYear(value, page, options);
}

function normalizeDateRangeForUserIntent(startValue, endValue, page = {}) {
  let startDate = normalizeDateIntentForUserYear(startValue, page);
  let endDate = normalizeDateIntentForUserYear(endValue, page);
  if (shouldPreserveModelDateYear(page, [startValue, endValue])) return { startDate, endDate };

  const start = parseIsoDateOnly(startDate);
  const end = parseIsoDateOnly(endDate);
  if (start && end && compareDateParts(end, getZonedToday(page.timeZone || null)) < 0) {
    start.year += 1;
    end.year += 1;
    startDate = formatIsoDateOnly(start);
    endDate = formatIsoDateOnly(end);
  }
  return { startDate, endDate };
}

function localDateLabel(timeZone = null) {
  const today = getZonedToday(timeZone || null);
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
}

function localDateTimeLabel(timeZone = null) {
  const local = getZonedDateParts(new Date(), timeZone || null);
  return `${localDateLabel(timeZone || null)} ${String(local.hour || 0).padStart(2, "0")}:${String(local.minute || 0).padStart(2, "0")}:${String(local.second || 0).padStart(2, "0")}`;
}

function resolveDateIntent(dateIntent, timeZone = null) {
  const raw = String(dateIntent || "today").trim().toLowerCase();
  const today = getZonedToday(timeZone);
  let offset = 0;
  if (raw === "tomorrow") offset = 1;
  else if (raw === "yesterday") offset = -1;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map((part) => parseInt(part, 10));
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) return { year, month, day };
  }
  const local = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 0, 0, 0, 0));
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

function canAssignEveryone(access) {
  return !!access?.permissionSet?.has("calendar.manage");
}

function normalizeCalendarWriteCall(call, page = {}, access = null) {
  if (!["calendar.entry.create", "calendar.entry.update"].includes(call.tool)) return call;
  const args = { ...(call.args || {}) };
  const body = args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? { ...args.body }
    : {};
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  const startTimeAlias = body.startLocal || body.startTimeLocal || body.startTime;
  const endTimeAlias = body.endLocal || body.endTimeLocal || body.endTime;
  const isoStart = typeof startTimeAlias === "string"
    ? startTimeAlias.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})(?::\d{2})?$/)
    : null;
  const isoEnd = typeof endTimeAlias === "string"
    ? endTimeAlias.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2})(?::\d{2})?$/)
    : null;
  if (isoStart && !body.dateIntent && !body.dateLocal && !body.date) body.dateIntent = normalizeDateIntentForUserYear(isoStart[1], page, { rollPastToNextYear: true });
  if (isoStart) body.startLocal = isoStart[2];
  else if (startTimeAlias && !body.startLocal) body.startLocal = startTimeAlias;
  if (isoEnd) body.endLocal = isoEnd[2];
  else if (endTimeAlias && !body.endLocal) body.endLocal = endTimeAlias;

  const dateIntent = normalizeDateIntentForUserYear(body.dateIntent || body.dateLocal || body.date, page, { rollPastToNextYear: true });
  const date = resolveDateIntent(dateIntent, timeZone || null);
  const start = parseLocalTime(body.startLocal || body.startTimeLocal);
  const end = parseLocalTime(body.endLocal || body.endTimeLocal);
  const durationMinutes = Number.parseInt(body.durationMinutes, 10);

  if (timeZone) body.timeZone = timeZone;
  if (body.allDay === true && (!Number.isFinite(Number(body.startsAt)) || !Number.isFinite(Number(body.endsAt)))) {
    body.startsAt = zonedLocalToUnix(date.year, date.month, date.day, 0, 0, 0, timeZone || null);
    body.endsAt = zonedLocalToUnix(date.year, date.month, date.day, 23, 59, 0, timeZone || null);
  } else if (start) {
    body.startsAt = zonedLocalToUnix(date.year, date.month, date.day, start.hour, start.minute, 0, timeZone || null);
    if (end) {
      body.endsAt = zonedLocalToUnix(date.year, date.month, date.day, end.hour, end.minute, 0, timeZone || null);
      if (body.endsAt <= body.startsAt) body.endsAt += DAY_SECONDS;
    } else if (Number.isInteger(durationMinutes) && durationMinutes > 0) {
      body.endsAt = body.startsAt + (durationMinutes * 60);
    } else if (!Number.isFinite(Number(body.endsAt))) {
      body.endsAt = body.startsAt + (30 * 60);
    }
    body.allDay = false;
  }
  if (body.startsAt !== undefined && Number.isFinite(Number(body.startsAt))) body.startsAt = Number(body.startsAt);
  if (body.endsAt !== undefined && Number.isFinite(Number(body.endsAt))) body.endsAt = Number(body.endsAt);
  if (Number.isFinite(Number(body.startsAt)) && !Number.isFinite(Number(body.endsAt))) {
    body.endsAt = Number(body.startsAt) + (30 * 60);
  }
  if (Array.isArray(body.assigneeUserIds) && body.assigneeUserIds.includes("__all__")) {
    delete body.assigneeUserId;
  }
  for (const helperField of ["dateIntent", "dateLocal", "date", "startLocal", "startTimeLocal", "startTime", "endLocal", "endTimeLocal", "endTime", "durationMinutes"]) {
    delete body[helperField];
  }

  const normalizedArgs = {};
  if (args.pathParams && typeof args.pathParams === "object") normalizedArgs.pathParams = args.pathParams;
  return { ...call, args: { ...normalizedArgs, body } };
}

function normalizeProjectWriteCall(call, page = {}) {
  if (!["calendar.project.create", "calendar.project.update"].includes(call.tool)) return call;
  const args = { ...(call.args || {}) };
  const body = { ...(args.body || args) };
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  if (body.startDate || body.endDate) {
    const range = normalizeDateRangeForUserIntent(body.startDate, body.endDate, page);
    if (body.startDate) body.startDate = range.startDate;
    if (body.endDate) body.endDate = range.endDate;
  }

  if (body.startDate && !Number.isFinite(Number(body.startsAt))) {
    const date = resolveDateIntent(body.startDate, timeZone || null);
    body.startsAt = zonedLocalToUnix(date.year, date.month, date.day, 0, 0, 0, timeZone || null);
  }
  if (body.endDate && !Number.isFinite(Number(body.endsAt))) {
    const date = resolveDateIntent(body.endDate, timeZone || null);
    body.endsAt = zonedLocalToUnix(date.year, date.month, date.day, 23, 59, 0, timeZone || null);
  }

  delete body.startDate;
  delete body.endDate;
  return { ...call, args: { ...args, body } };
}

function normalizeAllocationWriteCall(call, page = {}, access = null) {
  if (call.tool !== "calendar.allocation.create") return call;
  const args = { ...(call.args || {}) };
  const body = { ...(args.body || args) };
  const currentUserId = page.currentUserId || null;
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);

  if (currentUserId && (body.assigneeUserId === "me" || body.assigneeUserId === "self" || body.assigneeUserId === "myself")) {
    body.assigneeUserId = currentUserId;
  }
  if (body.startDate || body.endDate) {
    const range = normalizeDateRangeForUserIntent(body.startDate, body.endDate, page);
    if (body.startDate) body.startDate = range.startDate;
    if (body.endDate) body.endDate = range.endDate;
  }

  const start = parseLocalTime(body.startLocal || body.startTimeLocal);
  const end = parseLocalTime(body.endLocal || body.endTimeLocal);
  const durationMinutes = Number.parseInt(body.durationMinutes, 10);
  if (timeZone) body.timeZone = timeZone;
  if (start) {
    const dateIntent = normalizeDateIntentForUserYear(body.dateIntent || body.dateLocal || body.date || body.startDate, page, { rollPastToNextYear: true });
    const date = resolveDateIntent(dateIntent, timeZone || null);
    body.startsAt = zonedLocalToUnix(date.year, date.month, date.day, start.hour, start.minute, 0, timeZone || null);
    if (end) {
      body.endsAt = zonedLocalToUnix(date.year, date.month, date.day, end.hour, end.minute, 0, timeZone || null);
      if (body.endsAt <= body.startsAt) body.endsAt += DAY_SECONDS;
    } else if (Number.isInteger(durationMinutes) && durationMinutes > 0) {
      body.endsAt = body.startsAt + (durationMinutes * 60);
    }
    body.allocationMode = "custom";
  }
  if (body.startsAt !== undefined && Number.isFinite(Number(body.startsAt))) body.startsAt = Number(body.startsAt);
  if (body.endsAt !== undefined && Number.isFinite(Number(body.endsAt))) body.endsAt = Number(body.endsAt);
  const keepTimeZoneForDaily = String(body.allocationMode || "daily") === "daily" && body.startDate && body.endDate && !!body.timeZone;
  for (const helperField of ["dateIntent", "dateLocal", "date", "startLocal", "startTimeLocal", "endLocal", "endTimeLocal", "durationMinutes", "timeZone"]) {
    if (helperField === "timeZone" && keepTimeZoneForDaily) continue;
    delete body[helperField];
  }

  return { ...call, args: { ...args, body } };
}

function normalizeProjectScheduleWriteCall(call, page = {}) {
  if (call.tool !== "calendar.project.schedule") return call;
  const args = { ...(call.args || {}) };
  const body = args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? { ...args.body }
    : {};
  if (body.startDate || body.endDate) {
    const range = normalizeDateRangeForUserIntent(body.startDate, body.endDate, page);
    if (body.startDate) body.startDate = range.startDate;
    if (body.endDate) body.endDate = range.endDate;
  }
  return { ...call, args: { ...args, body } };
}

function escapeHtmlForToolText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bulletinToneToStylePreset(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["red", "alert", "danger", "urgent", "critical"].includes(raw)) return "alert";
  if (["green", "success", "done", "good"].includes(raw)) return "success";
  if (["yellow", "notice", "warning", "important"].includes(raw)) return "notice";
  if (["blue", "reminder", "info"].includes(raw)) return "reminder";
  if (raw === "default") return "default";
  return null;
}

function resolveBulletinExpiry(body, page = {}) {
  if (Number.isFinite(Number(body.endsAt))) return Number(body.endsAt);
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  const natural = String(body.expiresAt || "").trim().toLowerCase();
  let dateIntent = body.expiresAtDateIntent || body.expiryDateIntent || body.dateIntent || "today";
  let localTime = body.expiresAtLocal || body.expiryLocal || "";

  if (natural) {
    if (/\btomorrow\b/.test(natural)) dateIntent = "tomorrow";
    if (/\btoday\b|\btonight\b/.test(natural)) dateIntent = "today";
    if (/\bmidnight\b/.test(natural)) localTime = "midnight";
    if (/\bend of (the )?day\b|\beod\b/.test(natural)) localTime = "23:59";
    const explicitTime = natural.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (!localTime && explicitTime) localTime = explicitTime[1];
  }

  const time = parseLocalTime(localTime || "23:59");
  if (!time) return null;
  let date = resolveDateIntent(dateIntent, timeZone || null);
  let expiry = zonedLocalToUnix(date.year, date.month, date.day, time.hour, time.minute, 0, timeZone || null);
  const now = Math.floor(Date.now() / 1000);
  if (time.hour === 0 && time.minute === 0 && (/\btonight\b/.test(natural) || expiry <= now)) {
    const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1, 0, 0, 0, 0));
    date = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
    expiry = zonedLocalToUnix(date.year, date.month, date.day, 0, 0, 0, timeZone || null);
  }
  return expiry;
}

function resolveLocalUnixFromParts({ dateIntent, localTime, natural, defaultLocalTime = "00:00", page = {} }) {
  const timeZone = String(page.timeZone || "").slice(0, 80);
  const rawNatural = String(natural || "").trim().toLowerCase();
  let resolvedDateIntent = dateIntent || "today";
  let resolvedLocalTime = localTime || "";

  if (rawNatural) {
    const isoDate = rawNatural.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoDate) resolvedDateIntent = isoDate[1];
    if (/\btomorrow\b/.test(rawNatural)) resolvedDateIntent = "tomorrow";
    if (/\btoday\b|\btonight\b/.test(rawNatural)) resolvedDateIntent = "today";
    if (/\bmidnight\b/.test(rawNatural)) resolvedLocalTime = "midnight";
    if (/\bnoon\b|\bmidday\b/.test(rawNatural)) resolvedLocalTime = "noon";
    if (/\bend of (the )?day\b|\beod\b/.test(rawNatural)) resolvedLocalTime = "23:59";
    const explicitTime = rawNatural.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (!resolvedLocalTime && explicitTime) resolvedLocalTime = explicitTime[1];
  }

  const time = parseLocalTime(resolvedLocalTime || defaultLocalTime);
  if (!time) return null;
  resolvedDateIntent = normalizeDateIntentForUserYear(resolvedDateIntent, page);
  const date = resolveDateIntent(resolvedDateIntent, timeZone || null);
  return zonedLocalToUnix(date.year, date.month, date.day, time.hour, time.minute, 0, timeZone || null);
}

function normalizeBulletinWriteCall(call, page = {}) {
  if (!["homepage.bulletin.create", "homepage.bulletin.update"].includes(call.tool)) return call;
  const args = { ...(call.args || {}) };
  const body = args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? { ...args.body }
    : {};
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  if (timeZone) body.timeZone = timeZone;

  if (!body.bodyHtml && typeof body.message === "string") {
    body.bodyHtml = `<p>${escapeHtmlForToolText(body.message)}</p>`;
    body.bodySource = body.bodySource || body.message;
  }
  if (!body.bodyHtml && typeof body.bodySource === "string") {
    body.bodyHtml = `<p>${escapeHtmlForToolText(body.bodySource)}</p>`;
  }

  const stylePreset = bulletinToneToStylePreset(body.stylePreset) || bulletinToneToStylePreset(body.tone) || bulletinToneToStylePreset(body.color);
  if (stylePreset) body.stylePreset = stylePreset;
  const expiresAt = resolveBulletinExpiry(body, page);
  if (Number.isFinite(expiresAt)) body.endsAt = expiresAt;

  for (const helperField of ["message", "tone", "color", "expiresAt", "expiresAtDateIntent", "expiryDateIntent", "expiresAtLocal", "expiryLocal", "timeZone", "dateIntent"]) {
    delete body[helperField];
  }
  return { ...call, args: { ...args, body } };
}

function normalizeSurveyWriteCall(call, page = {}) {
  if (!["survey.create", "survey.update"].includes(call.tool)) return call;
  const args = { ...(call.args || {}) };
  const body = args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? { ...args.body }
    : {};
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  const localPage = { ...page, timeZone };

  if (!Number.isFinite(Number(body.startsAt))) {
    const startsAt = resolveLocalUnixFromParts({
      dateIntent: body.startDateIntent || body.startDate || body.dateIntent,
      localTime: body.startLocal || body.startTimeLocal,
      natural: body.startsAtIntent || body.startsAtLocal,
      defaultLocalTime: "00:00",
      page: localPage,
    });
    if (Number.isFinite(startsAt)) body.startsAt = startsAt;
  } else {
    body.startsAt = Number(body.startsAt);
  }

  if (!Number.isFinite(Number(body.endsAt))) {
    const endsAt = resolveLocalUnixFromParts({
      dateIntent: body.endDateIntent || body.endDate || body.expiresAtDateIntent || body.expiresAtDate || body.dateIntent,
      localTime: body.endLocal || body.endTimeLocal || body.expiresAtLocal,
      natural: body.endsAtIntent || body.endsAtLocal || body.expiresAt,
      defaultLocalTime: "23:59",
      page: localPage,
    });
    if (Number.isFinite(endsAt)) body.endsAt = endsAt;
  } else {
    body.endsAt = Number(body.endsAt);
  }
  if (Number.isFinite(Number(body.startsAt)) && Number.isFinite(Number(body.endsAt)) && Number(body.endsAt) <= Number(body.startsAt)) {
    body.endsAt = Number(body.endsAt) + DAY_SECONDS;
  }

  for (const helperField of [
    "dateIntent",
    "startDate",
    "startDateIntent",
    "startLocal",
    "startTimeLocal",
    "startsAtIntent",
    "startsAtLocal",
    "endDate",
    "endDateIntent",
    "endLocal",
    "endTimeLocal",
    "endsAtIntent",
    "endsAtLocal",
    "expiresAt",
    "expiresAtDate",
    "expiresAtDateIntent",
    "expiresAtLocal",
    "timeZone",
  ]) {
    delete body[helperField];
  }
  return { ...call, args: { ...args, body } };
}

function normalizeReporterProjectWriteCall(call, page = {}) {
  if (!["reporter.project.create", "reporter.project.update"].includes(call.tool)) return call;
  const args = { ...(call.args || {}) };
  const body = args.body && typeof args.body === "object" && !Array.isArray(args.body)
    ? { ...args.body }
    : {};
  const timeZone = String(body.timeZone || page.timeZone || "").slice(0, 80);
  if (!Number.isFinite(Number(body.dueDate))) {
    const dueDate = resolveLocalUnixFromParts({
      dateIntent: body.dueDateDateIntent || body.dueDateIntent || body.dateIntent,
      localTime: body.dueDateLocal || body.dueTimeLocal,
      natural: body.dueDateNatural || body.dueAt,
      defaultLocalTime: "23:59",
      page: { ...page, timeZone },
    });
    if (Number.isFinite(dueDate)) body.dueDate = dueDate;
  } else {
    body.dueDate = Number(body.dueDate);
  }

  for (const helperField of ["dueDateIntent", "dueDateDateIntent", "dueDateLocal", "dueTimeLocal", "dueDateNatural", "dueAt", "dateIntent", "timeZone"]) {
    delete body[helperField];
  }
  return { ...call, args: { ...args, body } };
}

function normalizeCalendarRangeArgs(args = {}, page = {}, fields = {}) {
  const output = { ...(args || {}) };
  const startField = fields.startField || "rangeStart";
  const endField = fields.endField || "rangeEnd";
  const timeZone = String(output.timeZone || page.timeZone || "").slice(0, 80);

  if (output.rangeIntent) {
    const range = getCalendarRangeForIntent(output.rangeIntent, timeZone || null);
    if (!Number.isFinite(Number(output[startField]))) output[startField] = range.rangeStart;
    if (!Number.isFinite(Number(output[endField]))) output[endField] = range.rangeEnd;
    if (startField === "rangeStart") output.viewMode = range.viewMode;
  } else {
    const dateIntent = output.dateIntent || output.dateLocal || output.date;
    const startDateIntent = output.startDateIntent || output.startDate || dateIntent;
    const endDateIntent = output.endDateIntent || output.endDate || dateIntent || startDateIntent;
    if (!Number.isFinite(Number(output[startField])) && startDateIntent) {
      const startTime = parseLocalTime(output.startLocal || output.startTimeLocal || output.startTime || "00:00") || { hour: 0, minute: 0 };
      const date = resolveDateIntent(normalizeDateIntentForUserYear(startDateIntent, page), timeZone || null);
      output[startField] = zonedLocalToUnix(date.year, date.month, date.day, startTime.hour, startTime.minute, 0, timeZone || null);
    }
    if (!Number.isFinite(Number(output[endField])) && endDateIntent) {
      const endTime = parseLocalTime(output.endLocal || output.endTimeLocal || output.endTime || "23:59") || { hour: 23, minute: 59 };
      const date = resolveDateIntent(normalizeDateIntentForUserYear(endDateIntent, page), timeZone || null);
      output[endField] = zonedLocalToUnix(date.year, date.month, date.day, endTime.hour, endTime.minute, 0, timeZone || null);
    }
  }

  if (output[startField] !== undefined && Number.isFinite(Number(output[startField]))) output[startField] = Number(output[startField]);
  if (output[endField] !== undefined && Number.isFinite(Number(output[endField]))) output[endField] = Number(output[endField]);
  for (const helperField of [
    "rangeIntent",
    "dateIntent",
    "dateLocal",
    "date",
    "startDate",
    "startDateIntent",
    "startLocal",
    "startTimeLocal",
    "startTime",
    "endDate",
    "endDateIntent",
    "endLocal",
    "endTimeLocal",
    "endTime",
  ]) {
    delete output[helperField];
  }
  return output;
}

function getCalendarRangeForIntent(rangeIntent, timeZone = null) {
  const now = new Date();
  const local = getZonedDateParts(now, timeZone);
  const localMidnightUtc = Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0, 0);
  const day = new Date(localMidnightUtc).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  let startLocal = new Date(localMidnightUtc + (mondayOffset * DAY_SECONDS * 1000));
  let viewMode = "week";
  const intent = String(rangeIntent || "").toLowerCase();

  if (intent.endsWith("_month")) {
    viewMode = "month";
    const monthOffset = intent === "next_month" ? 1 : (intent === "last_month" ? -1 : 0);
    startLocal = new Date(Date.UTC(local.year, local.month - 1 + monthOffset, 1, 0, 0, 0, 0));
    const endLocal = new Date(Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return {
      viewMode,
      rangeStart: zonedLocalToUnix(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, startLocal.getUTCDate(), 0, 0, 0, timeZone),
      rangeEnd: zonedLocalToUnix(endLocal.getUTCFullYear(), endLocal.getUTCMonth() + 1, endLocal.getUTCDate(), 0, 0, 0, timeZone) - 1,
    };
  }

  if (intent === "next_week") startLocal = new Date(startLocal.getTime() + (WEEK_SECONDS * 1000));
  if (intent === "last_week") startLocal = new Date(startLocal.getTime() - (WEEK_SECONDS * 1000));
  const endLocal = new Date(startLocal.getTime() + (WEEK_SECONDS * 1000));
  return {
    viewMode,
    rangeStart: zonedLocalToUnix(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, startLocal.getUTCDate(), 0, 0, 0, timeZone),
    rangeEnd: zonedLocalToUnix(endLocal.getUTCFullYear(), endLocal.getUTCMonth() + 1, endLocal.getUTCDate(), 0, 0, 0, timeZone) - 1,
  };
}

function normalizeCalendarToolCalls(calls, page = {}, access = null) {
  const timeZone = typeof page.timeZone === "string" ? page.timeZone.slice(0, 80) : "";
  return (calls || []).map((call) => {
    if (["calendar.entry.create", "calendar.entry.update"].includes(call.tool)) return normalizeCalendarWriteCall(call, page, access);
    if (["calendar.project.create", "calendar.project.update"].includes(call.tool)) return normalizeProjectWriteCall(call, page);
    if (call.tool === "calendar.allocation.create") return normalizeAllocationWriteCall(call, page, access);
    if (call.tool === "calendar.project.schedule") return normalizeProjectScheduleWriteCall(call, page);
    if (["homepage.bulletin.create", "homepage.bulletin.update"].includes(call.tool)) return normalizeBulletinWriteCall(call, page);
    if (["survey.create", "survey.update"].includes(call.tool)) return normalizeSurveyWriteCall(call, page);
    if (["reporter.project.create", "reporter.project.update"].includes(call.tool)) return normalizeReporterProjectWriteCall(call, page);
    if (["calendar.entries", "calendar.entry.search"].includes(call.tool)) {
      const args = normalizeCalendarRangeArgs(call.args || {}, page, {
        startField: "startsAfter",
        endField: "endsBefore",
      });
      return { ...call, args };
    }
    if (call.tool === "calendar.stats") {
      const args = { ...(call.args || {}) };
      const anchorDate = args.anchorDate || args.anchorDateIntent;
      if (!Number.isFinite(Number(args.anchor)) && anchorDate) {
        const date = resolveDateIntent(anchorDate, timeZone || null);
        args.anchor = zonedLocalToUnix(date.year, date.month, date.day, 0, 0, 0, timeZone || null);
      }
      for (const helperField of ["anchorDate", "anchorDateIntent", "timeZone"]) delete args[helperField];
      return { ...call, args };
    }
    if (call.tool !== "calendar.bootstrap") return call;
    const args = { ...(call.args || {}) };
    if (timeZone) args.timeZone = timeZone;
    if (args.rangeIntent) {
      const range = getCalendarRangeForIntent(args.rangeIntent, timeZone || null);
      args.viewMode = range.viewMode;
      args.rangeStart = range.rangeStart;
      args.rangeEnd = range.rangeEnd;
    }
    const normalizedRange = normalizeCalendarRangeArgs(args, page, {
      startField: "rangeStart",
      endField: "rangeEnd",
    });

    return { ...call, args: normalizedRange };
  });
}

async function planModelToolCalls(scopedContext, targetedContext, messages, options = {}) {
  if (!scopedContext.toolManifest.length) return { calls: [], raw: "" };
  const raw = await provider.chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: targetedContext.text },
    buildToolPlannerPrompt(scopedContext, options),
    ...messages,
  ], { phase: "tool_planner" });
  const parsed = extractJsonObject(raw);
  return {
    calls: sanitizeModelToolCalls(parsed, scopedContext),
    raw,
  };
}

function buildActionCompilerPrompt(scopedContext, targetedContext, options = {}) {
  const timeZone = String(options.page?.timeZone || "server-local").slice(0, 80);
  const writeManifest = (scopedContext.toolManifest || [])
    .filter((tool) => tool.confirmRequired)
    .map((tool) => ({
      name: tool.name,
      capability: tool.capability,
      method: tool.method,
      path: tool.path,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  return {
    role: "system",
    content: `Compile the user's requested RedSecTools action into a valid tool call, or identify exactly what is missing.

Return ONLY strict JSON in one of these formats:
{"toolCalls":[{"tool":"tool.name","args":{"body":{}}}],"missingInfo":""}
{"toolCalls":[],"missingInfo":"Ask one concise question for the exact missing user-provided information."}

Rules:
- Use only write tools listed in WRITE_TOOL_MANIFEST.
- Create at most one pending action. Do not return multiple write calls.
- This is not a final answer. Do not include prose outside JSON.
- Do not invent IDs, user IDs, project IDs, design IDs, template IDs, field names, enum values, or special assignee values.
- If a required ID or exact allowed value is present in TARGETED/MODEL tool results, use that value exactly.
- If a required ID or exact allowed value is not present and cannot be derived from the user's own words, set missingInfo to a concise question instead of preparing an unsafe action.
- If a missing value can only come from the user, ask for it in missingInfo.
- If the user clearly asked for a create/update/delete action and all required fields are present, return the correct write tool call. The action card is the confirmation step.
- For local dates/times, use the helper fields exposed by the schema such as dateIntent/startLocal/endLocal/durationMinutes/startDate/endDate/expiresAt/dueDateIntent and include timeZone when available. Do not convert local user intent to UTC in the tool call.
- For plain text bulletin content, use body.message unless rich bodyHtml is explicitly provided.
- For bulletin colour/tone requests such as red, use body.tone or body.color so RedSecAI can normalize to the app's allowed presentation preset.
- For homepage shortcut creation, use homepage.shortcut.create with body.title and body.url. A shortcut is personal to the logged-in user; do not ask for a workspace or environment when the user supplied both title and URL.
- For calendar team-wide/everyone requests, use assigneeUserIds:["__all__"] only when selected tool results expose that assignment value or the schema explicitly says it is allowed and the user has calendar manage access in the scoped results.
- For month/day dates without a year, resolve against the user-local date below. Use the current year when the date or range is today, future, or already underway; use next year when the entire requested date or range has already passed and the user did not ask for a past/backdated item.
- If no listed write tool matches the requested action, return missingInfo explaining the unsupported action.

Current page timezone: ${timeZone}
Current server time: ${new Date().toISOString()}
Current user-local date/time: ${localDateTimeLabel(options.page?.timeZone || null)}

AVAILABLE_CONTEXT:
${targetedContext.text}

WRITE_TOOL_MANIFEST:
${compactJson(writeManifest, 14000)}`,
  };
}

async function planActionCompilerToolCalls(scopedContext, targetedContext, messages, options = {}) {
  const writeTools = (scopedContext.toolManifest || []).filter((tool) => tool.confirmRequired);
  if (!writeTools.length) return { calls: [], raw: "", missingInfo: "" };
  const raw = await provider.chat([
    { role: "system", content: SYSTEM_PROMPT },
    buildActionCompilerPrompt(scopedContext, targetedContext, options),
    ...messages,
  ], { phase: "tool_action_compiler" });
  const parsed = extractJsonObject(raw);
  return {
    calls: sanitizeModelToolCalls(parsed, scopedContext),
    raw,
    missingInfo: typeof parsed?.missingInfo === "string" ? parsed.missingInfo.trim().slice(0, 500) : "",
  };
}

async function routeModelToolUse(req, messages, options = {}) {
  const toolManifest = getRedSecAiToolManifest(req.access);
  const toolCatalog = getRedSecAiToolCatalog(req.access);
  if (!toolCatalog.length) {
    return { useTools: false, calls: [], raw: "", toolManifest, toolCatalog, candidateToolNames: [], writeIntent: false };
  }
  if (userAskedForToolInventory(messages)) {
    return {
      useTools: true,
      calls: [],
      raw: "",
      toolManifest,
      toolCatalog,
      candidateToolNames: toolManifest.map((tool) => tool.name),
      writeIntent: false,
    };
  }
  emitStatus(options, { phase: "tool_router", label: "Deciding whether RedSecTools data is needed" });
  const raw = await provider.chat([
    { role: "system", content: SYSTEM_PROMPT },
    buildToolRouterPrompt(toolCatalog, messages, options.page || {}),
    { role: "user", content: `Route the latest user turn using the recent conversation above. Latest user turn: ${latestUserText(messages)}` },
  ], { phase: "tool_router" });
  const parsed = extractJsonObject(raw);
  const recovered = selectCatalogCandidates(toolCatalog, messages, options.page || {});
  const recoveredWriteIntent = inferWriteIntentFromMessages(messages)
    && recovered.candidateToolNames.some((name) => isRedSecAiToolMutating(name));
  if (!parsed || typeof parsed.useTools !== "boolean") {
    const normalizationPage = { ...(options.page || {}), messages };
    const recoveredReadCalls = normalizeCalendarToolCalls(
      recovered.calls.filter((call) => !isRedSecAiToolMutating(call.tool)),
      normalizationPage,
      req.access
    );
    return {
      useTools: recoveredReadCalls.length > 0 || recovered.candidateToolNames.some((name) => isRedSecAiToolMutating(name)),
      calls: recoveredReadCalls,
      raw,
      toolManifest,
      toolCatalog,
      candidateToolNames: recovered.candidateToolNames,
      writeIntent: recoveredWriteIntent,
    };
  }
  const sanitizedCalls = sanitizeModelToolCalls(parsed, { toolManifest });
  let calls = sanitizedCalls.filter((call) => !isRedSecAiToolMutating(call.tool));
  const allowRecoveredContext = parsed.useTools === true || shouldUseRecoveredToolsWhenRouterDeclines(messages);
  if (!calls.length && (parsed.useTools === true || (recovered.calls.length && allowRecoveredContext))) {
    calls = recovered.calls;
  }
  calls = normalizeCalendarToolCalls(
    calls.filter((call) => !isRedSecAiToolMutating(call.tool)),
    { ...(options.page || {}), messages },
    req.access
  );
  const selectedToolNames = extractSelectedToolNames(parsed, sanitizedCalls);
  const candidateToolNames = selectedToolNames.length
    ? expandCandidateToolNames(selectedToolNames, toolCatalog, messages)
    : (allowRecoveredContext ? recovered.candidateToolNames : []);
  const parsedIntent = String(parsed.intent || "").toLowerCase();
  const writeIntent = parsedIntent === "write" || parsedIntent === "mixed"
    || sanitizedCalls.some((call) => isRedSecAiToolMutating(call.tool))
    || (inferWriteIntentFromMessages(messages) && candidateToolNames.some((name) => isRedSecAiToolMutating(name)));
  return {
    useTools: parsed.useTools === true || calls.length > 0 || (allowRecoveredContext && candidateToolNames.some((name) => isRedSecAiToolMutating(name))),
    calls,
    raw,
    toolManifest,
    toolCatalog,
    candidateToolNames,
    writeIntent,
  };
}

function prepareDirectRedSecAiTurn(rawMessages) {
  const messages = normalizeMessages(rawMessages);
  if (!messages.length) {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }
  return {
    messages,
    scopedContext: {
      allowedTools: [],
      toolManifest: [],
      toolResults: [],
      text: "TOOL_RESULTS: []",
    },
    targetedContext: {
      calls: [],
      results: [],
      text: "TARGETED_TOOL_RESULTS: []",
    },
    modelToolContext: {
      calls: [],
      results: [],
      pendingActions: [],
      raw: "",
    },
    pendingActions: [],
    writeIntent: false,
    finalMessages: [
      { role: "system", content: DIRECT_SYSTEM_PROMPT },
      ...messages,
    ],
    direct: true,
  };
}

async function executeToolCalls(req, calls, options = {}) {
  const results = [];
  for (const rawCall of calls) {
    const normalizationPage = {
      ...(options.page || {}),
      messages: options.messages || options.page?.messages || [],
    };
    const call = normalizeCalendarToolCalls(
      [normalizeRedSecAiToolCall(rawCall)],
      normalizationPage,
      req.access
    )[0];
    const rawTool = String(call?.tool || rawCall?.tool || "");
    const schemaValidationError = getRedSecAiSchemaValidationError(rawTool, call?.args || {});
    if (schemaValidationError) {
      results.push({
        tool: rawTool,
        ok: false,
        status: 400,
        args: call?.args || rawCall?.args || {},
        schemaError: true,
        error: schemaValidationError,
      });
      continue;
    }
    emitStatus(options, { phase: "tool_execute", label: describeToolCall(call), tool: call.tool });
    if (isRedSecAiToolMutating(call.tool)) {
      if (call.tool === "calendar.entry.create" && Array.isArray(call.args?.body?.assigneeUserIds) && !canAssignEveryone(req.access)) {
        results.push({
          tool: call.tool,
          ok: false,
          status: 403,
          args: call.args,
          error: "Creating calendar entries for other users requires calendar.manage",
        });
        continue;
      }
      if (call.tool === "calendar.entry.create"
        && call.args?.body?.assigneeUserId
        && call.args.body.assigneeUserId !== req.user?.id
        && !canAssignEveryone(req.access)) {
        results.push({
          tool: call.tool,
          ok: false,
          status: 403,
          args: call.args,
          error: "Assigning calendar entries to another user requires calendar.manage",
        });
        continue;
      }
      if (call.tool === "calendar.project.schedule"
        && !call.args?.body?.projectId
        && !canAssignEveryone(req.access)) {
        results.push({
          tool: call.tool,
          ok: false,
          status: 403,
          args: call.args,
          error: "Creating a project before scheduling it requires calendar.manage",
        });
        continue;
      }
      const actionValidationError = getRedSecAiActionValidationError(call.tool, call.args);
      if (actionValidationError) {
        results.push({
          tool: call.tool,
          ok: false,
          status: isClarifyingActionError(actionValidationError) ? 422 : 400,
          args: call.args,
          missingInfo: isClarifyingActionError(actionValidationError),
          error: actionValidationError,
        });
        continue;
      }
      const action = createPendingAction(req.user, call, "model");
      results.push({
        tool: call.tool,
        ok: false,
        status: 202,
        requiresConfirmation: true,
        action,
        error: "Pending user confirmation",
      });
    } else {
      results.push(await executeRedSecAiTool(req, call.tool, call.args));
    }
  }
  return results;
}

function resultListCount(result) {
  const data = result?.data || result?.body || {};
  if (Number.isFinite(Number(data.count))) return Number(data.count);
  if (Array.isArray(data.results)) return data.results.length;
  if (Array.isArray(data.alerts)) return data.alerts.length;
  if (Array.isArray(data.scheduleEntries)) return data.scheduleEntries.length;
  return null;
}

function planEvidenceFallbackCalls(calls, results, candidateToolNames = []) {
  const executed = new Set((calls || []).map((call) => call.tool));
  const candidates = new Set(candidateToolNames || []);
  const fallbackCalls = [];
  const wikiSearches = (results || []).filter((result) => result?.tool === "wiki.search");
  const wikiSearchWasEmpty = wikiSearches.length > 0
    && wikiSearches.every((result) => result.ok !== false && resultListCount(result) === 0);

  if (wikiSearchWasEmpty && candidates.has("wiki.bootstrap") && !executed.has("wiki.bootstrap")) {
    fallbackCalls.push({ tool: "wiki.bootstrap", args: {} });
  }

  return fallbackCalls.slice(0, MAX_MODEL_TOOL_CALLS);
}

function buildToolResultsText(label, calls, results) {
  return results.length
    ? `${label}_CALLS:\n${compactJson(calls)}\n\n${label}_RESULTS:\n${compactJson(results)}`
    : `${label}_RESULTS: []`;
}

function toolCallKey(call) {
  return `${call?.tool || ""}:${JSON.stringify(call?.args || {})}`;
}

function filterNewToolCalls(calls, existingCalls, remaining) {
  const seen = new Set((existingCalls || []).map(toolCallKey));
  return (calls || [])
    .filter((call) => {
      const key = toolCallKey(call);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, remaining));
}

function shouldRunFollowUpPlanner(scopedContext, calls, results) {
  if (!scopedContext.toolManifest.some((tool) => tool.confirmRequired)) return false;
  if (!(calls || []).some((call) => !isRedSecAiToolMutating(call.tool))) return false;
  if ((results || []).some((result) => result?.requiresConfirmation || result?.action)) return false;
  return (results || []).some((result) => result?.ok === true);
}

function hasPendingActionResult(results = []) {
  return results.some((result) => result?.requiresConfirmation || result?.action);
}

function hasSuccessfulToolResult(results = []) {
  return results.some((result) => result?.ok === true);
}

function hasInvalidMutatingToolResult(results = []) {
  return results.some((result) => isRedSecAiToolMutating(result?.tool) && result?.ok === false && result?.status === 400);
}

function hasPermissionToolError(results = []) {
  return results.some((result) => result?.ok === false && Number(result.status) === 403);
}

function shouldRunActionReviewPlanner(scopedContext, targetedContext, calls, results) {
  if (!scopedContext.toolManifest.some((tool) => tool.confirmRequired)) return false;
  if (hasPendingActionResult([...(targetedContext.results || []), ...(results || [])])) return false;
  const combinedResults = [...(targetedContext.results || []), ...(results || [])];
  if (!hasSuccessfulToolResult(combinedResults) && !hasInvalidMutatingToolResult(combinedResults)) return false;
  return (calls || []).length === 0 || !(calls || []).some((call) => isRedSecAiToolMutating(call.tool));
}

function shouldRunActionCompiler(scopedContext, targetedContext, calls, results, writeIntent = false) {
  if (!writeIntent) return false;
  if (!scopedContext.toolManifest.some((tool) => tool.confirmRequired)) return false;
  const combinedResults = [...(targetedContext.results || []), ...(results || [])];
  if (hasPendingActionResult(combinedResults)) return false;
  if (combinedResults.some((result) => result?.missingInfo)) return false;
  if (hasPermissionToolError(combinedResults)) return false;
  const selectedWriteTools = new Set((scopedContext.toolManifest || [])
    .filter((tool) => tool.confirmRequired)
    .map((tool) => tool.name));
  if (!selectedWriteTools.size) return false;
  if ((calls || []).some((call) => selectedWriteTools.has(call.tool))) return true;
  return (targetedContext.candidateToolNames || []).some((name) => selectedWriteTools.has(name));
}

function buildMissingInfoResult(toolName, message) {
  return {
    tool: toolName || "redsecai.action",
    ok: false,
    status: 422,
    missingInfo: true,
    error: String(message || "I need one more detail before I can prepare that action.").trim(),
  };
}

function isClarifyingActionError(message) {
  return /\b(required|requires|missing|must|invalid|before|after|end date|start date|valid start|valid end|not found|choose|confirm)\b/i.test(String(message || ""));
}

function describePlannerStep(scopedContext, targetedContext, messages, options = {}) {
  const names = new Set([
    ...(scopedContext.toolManifest || []).map((tool) => tool.name),
    ...(targetedContext.candidateToolNames || []),
    ...(targetedContext.calls || []).map((call) => call.tool),
  ]);
  const executed = new Set((targetedContext.calls || []).map((call) => call.tool));

  if (options.actionReview && names.has("wiki.page.update")) return "Resolving the requested wiki update";
  if (options.actionReview && names.has("wiki.page.create")) return "Resolving the requested wiki draft";
  if (options.actionReview && (names.has("calendar.entry.create") || names.has("calendar.entry.update"))) return "Resolving the requested calendar action";
  if (options.actionReview && (names.has("calendar.project.create") || names.has("calendar.project.update"))) return "Resolving the requested project action";
  if (options.actionReview && names.has("calendar.allocation.create")) return "Resolving the requested project allocation";
  if (options.actionReview && names.has("calendar.project.schedule")) return "Resolving the requested project schedule";
  if (options.actionReview && names.has("reporter.note.create")) return "Resolving the requested Reporter note";
  if (options.actionReview && [...names].some((name) => name.startsWith("reporter.") && isRedSecAiToolMutating(name))) return "Resolving the requested Reporter action";
  if (options.actionReview && [...names].some((name) => name.startsWith("survey.") && isRedSecAiToolMutating(name))) return "Resolving the requested survey action";
  if (options.actionReview && [...names].some((name) => name.startsWith("homepage.") && isRedSecAiToolMutating(name))) return "Resolving the requested homepage action";
  if (options.actionReview && [...names].some((name) => name.startsWith("threat.") && isRedSecAiToolMutating(name))) return "Resolving the requested threat action";
  if (names.has("wiki.page.update") && options.followUp) return "Preparing the wiki page update";
  if (names.has("wiki.page.update") && (executed.has("wiki.search") || executed.has("wiki.bootstrap"))) {
    return "Resolving the matching wiki page";
  }
  if (names.has("wiki.page.create")) return "Preparing a wiki draft";
  if (names.has("calendar.entry.create") || names.has("calendar.entry.update")) return "Resolving calendar action details";
  if (names.has("calendar.project.create") || names.has("calendar.project.update")) return "Resolving project action details";
  if (names.has("calendar.allocation.create")) return "Resolving project allocation details";
  if (names.has("calendar.project.schedule")) return "Resolving project schedule details";
  if (names.has("reporter.note.create")) return "Resolving Reporter note details";
  if ([...names].some((name) => name.startsWith("reporter.") && isRedSecAiToolMutating(name))) return "Resolving Reporter action details";
  if ([...names].some((name) => name.startsWith("survey.") && isRedSecAiToolMutating(name))) return "Resolving survey action details";
  if ([...names].some((name) => name.startsWith("homepage.") && isRedSecAiToolMutating(name))) return "Resolving homepage action details";
  if ([...names].some((name) => name.startsWith("threat.") && isRedSecAiToolMutating(name))) return "Resolving threat action details";
  if (names.has("threat.searchAlerts") || names.has("threat.alerts")) return "Reviewing threat intelligence results";
  if (names.has("reporter.projects")) return "Reviewing Reporter project results";
  if ([...names].some((name) => name.startsWith("survey."))) return "Reviewing survey results";
  if ([...names].some((name) => name.startsWith("homepage."))) return "Reviewing homepage results";
  if (latestUserText(messages)) return "Planning the next RedSecTools step";
  return "Reviewing scoped tool results";
}

async function buildModelRoutedToolContext(req, calls, options = {}) {
  let allCalls = [...calls];
  let results = await executeToolCalls(req, calls, options);
  const fallbackCalls = planEvidenceFallbackCalls(allCalls, results, options.candidateToolNames);
  if (fallbackCalls.length) {
    const fallbackResults = await executeToolCalls(req, fallbackCalls, options);
    allCalls = [...allCalls, ...fallbackCalls];
    results = [...results, ...fallbackResults];
  }
  return {
    calls: allCalls,
    results,
    pendingActions: results.map((result) => result.action).filter(Boolean),
    candidateToolNames: options.candidateToolNames || allCalls.map((call) => call.tool),
    text: results.length
      ? buildToolResultsText("TARGETED_TOOL", allCalls, results)
      : "TARGETED_TOOL_RESULTS: []",
  };
}

function buildFinalMessages(scopedContext, targetedContext, modelToolContext, messages) {
  return [
    ...buildSystemMessages(scopedContext),
    { role: "system", content: targetedContext.text },
    {
      role: "system",
      content: modelToolContext.results.length
        ? `MODEL_REQUESTED_TOOL_CALLS:\n${compactJson(modelToolContext.calls)}\n\nMODEL_REQUESTED_TOOL_RESULTS:\n${compactJson(modelToolContext.results)}`
        : "MODEL_REQUESTED_TOOL_RESULTS: []",
    },
    ...messages,
  ];
}

function collectToolErrors(turn) {
  return [
    ...(turn?.targetedContext?.results || []),
    ...(turn?.modelToolContext?.results || []),
  ]
    .filter((result) => result && result.ok === false && !result.requiresConfirmation && !result.action)
    .map(friendlyToolError);
}

function collectBlockingToolResults(turn) {
  return [
    ...(turn?.targetedContext?.results || []),
    ...(turn?.modelToolContext?.results || []),
  ].filter((result) => result && result.ok === false && !result.requiresConfirmation && !result.action);
}

function friendlyToolError(result) {
  const tool = result?.tool || "RedSecAI tool";
  const raw = String(result?.error || result?.body?.error || `HTTP ${result?.status || 400}`);
  if (result?.schemaError || /does not match RedSecAI schema/i.test(raw)) {
    return `${tool}: I could not build a valid tool request from the available details. I need the missing or corrected target/details before I can prepare an action card.`;
  }
  if (Number(result?.status) === 403) {
    return `${tool}: your current permissions do not allow that action.`;
  }
  return `${tool}: ${raw}`;
}

function collectMissingInfo(turn) {
  return [
    ...(turn?.targetedContext?.results || []),
    ...(turn?.modelToolContext?.results || []),
  ]
    .filter((result) => result?.missingInfo && result?.error)
    .map((result) => String(result.error).trim())
    .filter(Boolean);
}

function buildDeterministicTurnResponse(turn) {
  const pendingActions = (turn?.pendingActions || []).filter((action) => action?.id);
  if (pendingActions.length) return buildPendingActionResponse(pendingActions);

  const missingInfo = collectMissingInfo(turn);
  if (missingInfo.length) {
    return `I need one more detail before I can prepare that action: ${missingInfo[0]}`;
  }

  const blocking = collectBlockingToolResults(turn);
  const writeRelatedBlocking = blocking.filter((result) => isRedSecAiToolMutating(result.tool) || result.schemaError);
  if (turn?.writeIntent && writeRelatedBlocking.length) {
    return `I could not prepare the requested action.\n\n${writeRelatedBlocking.slice(0, 3).map(friendlyToolError).join("\n")}`;
  }
  if (turn?.writeIntent && !(turn?.pendingActions || []).length) {
    return "I could not prepare the requested action because no valid write tool call was produced. I need the exact target and required details before I can create an action card.";
  }
  return "";
}

function buildPendingActionResponse(actions = []) {
  const live = (actions || []).filter((action) => action?.id);
  if (!live.length) return "";
  if (live.length === 1) {
    return `I prepared the requested action: ${live[0].summary || live[0].tool}.\n\nConfirm the action card to apply it.`;
  }
  const lines = live.map((action) => `- ${action.summary || action.tool}`);
  return `I prepared ${live.length} requested actions:\n${lines.join("\n")}\n\nConfirm the action cards to apply them.`;
}

function guardRedSecAiFinalResponse(response, turn) {
  const pendingActions = (turn?.pendingActions || []).filter((action) => action?.id);
  if (pendingActions.length) return buildPendingActionResponse(pendingActions);

  const text = String(response || "").trim();
  const claimsActionCard = /\b(confirm|review|use|click)\b[\s\S]{0,80}\b(action\s+card|card)\b/i.test(text)
    || /\b(action\s+card|pending\s+action)\b[\s\S]{0,80}\b(confirm|apply|complete)\b/i.test(text);
  const claimsPreparedMutation = /\b(?:I\s+)?(?:have\s+)?prepared\b[\s\S]{0,100}\b(?:action|card|update|create|creation|change|changes|edit|edits)\b/i.test(text);
  const claimsConfirmation = /\bConfirmed pending action\b/i.test(text)
    || /\b(?:successfully|now)\s+(?:created|updated|modified|deleted|applied|confirmed)\b/i.test(text);

  if (claimsActionCard || claimsPreparedMutation || claimsConfirmation) {
    const missingInfo = collectMissingInfo(turn);
    if (missingInfo.length) {
      return `I need one more detail before I can prepare that action: ${missingInfo[0]}`;
    }
    const errors = collectToolErrors(turn);
    if (errors.length) {
      return `I could not prepare or execute the requested action.\n\n${errors.slice(0, 3).join("\n")}`;
    }
    return "No RedSecAI action is currently pending for this turn, and nothing has been applied. I need to prepare a valid action card before it can be confirmed.";
  }

  const missingInfo = collectMissingInfo(turn);
  if (missingInfo.length && (!text || /no\s+redsecai\s+action\s+is\s+currently\s+pending/i.test(text))) {
    return `I need one more detail before I can prepare that action: ${missingInfo[0]}`;
  }

  return text || "I could not produce a response from the local model.";
}

async function prepareRedSecAiTurn(req, rawMessages, page = {}, options = {}) {
  const messages = normalizeMessages(rawMessages);
  if (!messages.length) {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }

  page = { ...page, currentUserId: req.user?.id || null, messages };

  const startedAt = Date.now();
  const routerPlan = await routeModelToolUse(req, messages, { ...options, page });
  logEvent("redsecai:turn_router_ready", req, {
    elapsedMs: Date.now() - startedAt,
    useTools: routerPlan.useTools,
    routedTools: routerPlan.calls.map((call) => call.tool),
    routerRawChars: routerPlan.raw.length,
  });

  if (!routerPlan.useTools) {
    emitStatus(options, { phase: "direct_answer", label: "Answering directly" });
    return prepareDirectRedSecAiTurn(messages);
  }

  const scopedReq = req;
  const targetedContext = await buildModelRoutedToolContext(scopedReq, routerPlan.calls, {
    ...options,
    messages,
    page,
    candidateToolNames: routerPlan.candidateToolNames,
  });
  const scopedContext = buildScopedToolContext(scopedReq, routerPlan.toolManifest, targetedContext, page || {});
  logEvent("redsecai:turn_context_ready", req, {
    elapsedMs: Date.now() - startedAt,
    scopedContextChars: scopedContext.text.length,
    targetedContextChars: targetedContext.text.length,
    allowedTools: scopedContext.allowedTools,
    targetedTools: targetedContext.calls.map((call) => call.tool),
  });
  emitStatus(options, { phase: "tool_planner", label: describePlannerStep(scopedContext, targetedContext, messages) });
  const modelPlan = await planModelToolCalls(scopedContext, targetedContext, messages, { page });
  logEvent("redsecai:turn_planner_ready", req, {
    elapsedMs: Date.now() - startedAt,
    plannedTools: modelPlan.calls.map((call) => call.tool),
    plannerRawChars: modelPlan.raw.length,
  });
  let normalizedModelCalls = modelPlan.calls;
  let modelResults = await executeToolCalls(scopedReq, normalizedModelCalls, { ...options, page, messages });
  const modelPlanRaws = [modelPlan.raw].filter(Boolean);

  if (shouldRunFollowUpPlanner(scopedContext, normalizedModelCalls, modelResults)) {
    const plannerContext = {
      ...targetedContext,
      calls: [...targetedContext.calls, ...normalizedModelCalls],
      results: [...targetedContext.results, ...modelResults],
      text: [
        targetedContext.text,
        buildToolResultsText("MODEL_REQUESTED_TOOL", normalizedModelCalls, modelResults),
      ].join("\n\n"),
    };
    emitStatus(options, { phase: "tool_planner", label: describePlannerStep(scopedContext, plannerContext, messages, { followUp: true }) });
    const followUpPlan = await planModelToolCalls(scopedContext, plannerContext, messages, { page, followUp: true });
    modelPlanRaws.push(followUpPlan.raw);
    const remaining = MAX_MODEL_TOOL_CALLS - normalizedModelCalls.length;
    const followUpCalls = filterNewToolCalls(
      followUpPlan.calls,
      normalizedModelCalls,
      remaining
    );
    logEvent("redsecai:turn_followup_planner_ready", req, {
      elapsedMs: Date.now() - startedAt,
      plannedTools: followUpCalls.map((call) => call.tool),
      plannerRawChars: followUpPlan.raw.length,
    });
    if (followUpCalls.length) {
      const followUpResults = await executeToolCalls(scopedReq, followUpCalls, { ...options, page, messages });
      normalizedModelCalls = [...normalizedModelCalls, ...followUpCalls];
      modelResults = [...modelResults, ...followUpResults];
    }
  }

  if (shouldRunActionReviewPlanner(scopedContext, targetedContext, normalizedModelCalls, modelResults)) {
    const actionReviewContext = {
      ...targetedContext,
      calls: [...targetedContext.calls, ...normalizedModelCalls],
      results: [...targetedContext.results, ...modelResults],
      text: [
        targetedContext.text,
        buildToolResultsText("MODEL_REQUESTED_TOOL", normalizedModelCalls, modelResults),
      ].join("\n\n"),
    };
    emitStatus(options, { phase: "tool_planner", label: describePlannerStep(scopedContext, actionReviewContext, messages, { actionReview: true }) });
    const actionReviewPlan = await planModelToolCalls(scopedContext, actionReviewContext, messages, { actionReview: true, page });
    modelPlanRaws.push(actionReviewPlan.raw);
    const remaining = MAX_MODEL_TOOL_CALLS - normalizedModelCalls.length;
    const actionReviewCalls = filterNewToolCalls(
      actionReviewPlan.calls,
      normalizedModelCalls,
      remaining
    );
    logEvent("redsecai:turn_action_review_ready", req, {
      elapsedMs: Date.now() - startedAt,
      plannedTools: actionReviewCalls.map((call) => call.tool),
      plannerRawChars: actionReviewPlan.raw.length,
    });
    if (actionReviewCalls.length) {
      const actionReviewResults = await executeToolCalls(scopedReq, actionReviewCalls, { ...options, page, messages });
      normalizedModelCalls = [...normalizedModelCalls, ...actionReviewCalls];
      modelResults = [...modelResults, ...actionReviewResults];
    }
  }

  if (shouldRunActionCompiler(scopedContext, targetedContext, normalizedModelCalls, modelResults, routerPlan.writeIntent)) {
    const actionCompilerContext = {
      ...targetedContext,
      calls: [...targetedContext.calls, ...normalizedModelCalls],
      results: [...targetedContext.results, ...modelResults],
      text: [
        targetedContext.text,
        buildToolResultsText("MODEL_REQUESTED_TOOL", normalizedModelCalls, modelResults),
      ].join("\n\n"),
    };
    emitStatus(options, { phase: "tool_action_compiler", label: "Preparing the action card" });
    const actionCompilerPlan = await planActionCompilerToolCalls(scopedContext, actionCompilerContext, messages, { page });
    modelPlanRaws.push(actionCompilerPlan.raw);
    const remaining = MAX_MODEL_TOOL_CALLS - normalizedModelCalls.length;
    const actionCompilerCalls = filterNewToolCalls(
      actionCompilerPlan.calls,
      normalizedModelCalls,
      remaining
    );
    logEvent("redsecai:turn_action_compiler_ready", req, {
      elapsedMs: Date.now() - startedAt,
      plannedTools: actionCompilerCalls.map((call) => call.tool),
      missingInfo: actionCompilerPlan.missingInfo || "",
      compilerRawChars: actionCompilerPlan.raw.length,
    });
    if (actionCompilerCalls.length) {
      const actionCompilerResults = await executeToolCalls(scopedReq, actionCompilerCalls, { ...options, page, messages });
      normalizedModelCalls = [...normalizedModelCalls, ...actionCompilerCalls];
      modelResults = [...modelResults, ...actionCompilerResults];
    } else if (actionCompilerPlan.missingInfo) {
      const writeTool = (scopedContext.toolManifest || []).find((tool) => tool.confirmRequired)?.name;
      modelResults = [...modelResults, buildMissingInfoResult(writeTool, actionCompilerPlan.missingInfo)];
    }
  }

  const modelToolContext = {
    calls: normalizedModelCalls,
    results: modelResults,
    pendingActions: modelResults.map((result) => result.action).filter(Boolean),
    raw: modelPlanRaws.join("\n"),
  };
  const pendingActions = [
    ...(targetedContext.pendingActions || []),
    ...(modelToolContext.pendingActions || []),
  ];

  return {
    messages,
    scopedContext,
    targetedContext,
    modelToolContext,
    pendingActions,
    writeIntent: !!routerPlan.writeIntent,
    finalMessages: buildFinalMessages(scopedContext, targetedContext, modelToolContext, messages),
  };
}

async function runRedSecAiChat(req, rawMessages, page = {}) {
  const turn = await prepareRedSecAiTurn(req, rawMessages, page);
  const deterministicResponse = buildDeterministicTurnResponse(turn);
  if (deterministicResponse) {
    return {
      ...turn,
      response: deterministicResponse,
    };
  }
  const rawResponse = await provider.chat(turn.finalMessages, { phase: "final_answer" });
  const response = guardRedSecAiFinalResponse(rawResponse, turn);
  return {
    ...turn,
    response,
  };
}

module.exports = {
  SYSTEM_PROMPT,
  buildFinalMessages,
  buildSystemMessages,
  routeModelToolUse,
  extractJsonObject,
  normalizeMessages,
  prepareRedSecAiTurn,
  guardRedSecAiFinalResponse,
  runRedSecAiChat,
  sanitizeModelToolCalls,
  buildDeterministicTurnResponse,
};
