"use strict";

const {
  compactJson,
  executeRedSecAiTool,
  getRedSecAiToolManifest,
  isRedSecAiToolMutating,
} = require("./context");
const { createPendingAction } = require("./actions");
const provider = require("./provider");
const { logEvent } = require("../../core/logger");

const MAX_MODEL_TOOL_CALLS = 4;
const MAX_TOOL_ARG_CHARS = 1000;
const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

const SYSTEM_PROMPT = `You are RedSecAI, the built-in local assistant for RedSecTools.

Security boundaries:
- You operate only for the logged-in user and only with the scoped context provided by RedSecTools APIs.
- You have access to server-executed internal tool results in TOOL_RESULTS. These results have already been fetched through the user's own RBAC-scoped APIs.
- You may also receive TARGETED_TOOL_RESULTS and MODEL_REQUESTED_TOOL_RESULTS for the user's current request. Prefer request-specific tool results over broad snapshots when answering specific questions.
- Do not say you have no access to internal tools when tool results contain successful outputs. Instead, say which scoped data is available.
- Never invent platform data. If the scoped tool results are empty, failed, or lack a requested field, say the data is not available in the current scoped tool results.
- Never tell the user to refresh the page, provide updated schedule data, or paste application data when a RedSecAI read/search tool exists for that domain. Tool routing must fetch the available context before the final answer.
- You do not have admin scope and must not claim to perform admin actions.
- You must not access, request, infer, store, or summarize decrypted content from RedSecPaste, RedSecShare, RedSecTeam chat, or RedSecVault.
- You may help draft report text, summarize permitted threat intel, and reason about permitted calendar context.
- Mutating platform actions are confirmation-gated. If MODEL_REQUESTED_TOOL_RESULTS contains a pending action, explain exactly what will happen and tell the user to confirm it in the action card.
- Do not ask users to paste passwords, recovery codes, API keys, private keys, TOTP secrets, session tokens, bearer tokens, URL fragment encryption keys, or decrypted vault content.

Be concise, practical, and transparent about limitations.`;

const DIRECT_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

For this turn, no RedSecTools internal tool context was requested or fetched. Answer from general model knowledge only. If the user asks for current/live facts or RedSecTools data, say that live application context is not available for this turn and ask them to make the request specific to their RedSecTools data.`;

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
  const selectedTools = new Set((targetedContext.calls || []).map((call) => call.tool));
  const selectedManifest = (toolManifest || []).filter((tool) => selectedTools.has(tool.name));
  const allowedTools = [...new Set(selectedManifest.map((tool) => tool.capability).filter(Boolean))];
  const sections = [
    `Current user: ${req.user?.username || "unknown"} (${req.user?.id || "unknown"})`,
    `Current page: ${String(page.path || req.get("referer") || "/").slice(0, 200)}`,
    `User timezone: ${String(page.timeZone || "server-local").slice(0, 80)}`,
    `Current server time: ${new Date().toISOString()}`,
    "RedSecAI tool execution is server-side allowlisted. It cannot call arbitrary routes and has no direct database handle.",
    "Only the selected tool results for this turn are included. If data is absent, say it is not available in the selected tool results.",
    "For calendar answers, use scheduleEntries from selected calendar tool results as the source of truth. Do not infer 'no meetings' from capacity stats if scheduleEntries contains entries.",
    "For 'rest of this week', answer from entries at or after the nowLabel/current time in TOOL_RESULTS and say the displayed timezone.",
    "Encrypted tools are intentionally excluded from scoped context: RedSecPaste, RedSecShare, RedSecTeam, and RedSecVault.",
    `TOOL_MANIFEST:\n${compactJson(selectedManifest)}`,
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
    "calendar.bootstrap": "Reading current calendar state",
    "calendar.entry.create": "Preparing a calendar action",
    "calendar.entry.update": "Preparing a calendar update",
    "threat.bootstrap": "Reading threat dashboard state",
    "threat.alerts": "Checking threat alerts",
    "threat.searchAlerts": "Searching threat alerts",
    "reporter.projects": "Reading Reporter projects",
    "reporter.note.create": "Preparing a Reporter note action",
    "wiki.bootstrap": "Reading wiki state",
    "wiki.search": "Searching wiki pages",
    "wiki.page.create": "Preparing a wiki page action",
    "wiki.page.update": "Preparing a wiki update action",
  };
  return labels[tool] || `Running ${tool || "selected tool"}`;
}

function emitStatus(options, status) {
  if (typeof options?.onStatus === "function") {
    options.onStatus(status);
  }
}

function buildToolPlannerPrompt(scopedContext) {
  return {
    role: "system",
    content: `Before answering, decide whether extra scoped internal tools are needed.

Return ONLY strict JSON in this format:
{"toolCalls":[{"tool":"tool.name","args":{"query":"short search text","limit":8}}]}

Rules:
- Use only tools listed in TOOL_MANIFEST.
- Use at most ${MAX_MODEL_TOOL_CALLS} tool calls.
- Read/search tools can be used immediately. Write tools can only create a pending action card for explicit user confirmation.
- Do not request admin, vault, paste, share, or chat tools.
- If the selected TARGETED_TOOL_RESULTS are enough, return {"toolCalls":[]}.
- If the user asks for threat alerts about a topic, prefer threat.searchAlerts with a focused query.
- If the user asks for wiki/runbook/procedure content, prefer wiki.search with a focused query.
- If the user asks to create/update a calendar event, use calendar.entry.create or calendar.entry.update with Unix timestamps in seconds. Otherwise prefer calendar.bootstrap.
- If the user asks about reports, findings, projects, clients, or evidence, prefer reporter.projects.
- If the user asks to create a Reporter note, use reporter.note.create.
- If the user asks to create/update wiki content, use wiki.page.create or wiki.page.update.

Allowed tool manifest:
${compactJson(scopedContext.toolManifest, 8000)}`,
  };
}

function buildToolRouterPrompt(toolManifest, messages = []) {
  return {
    role: "system",
    content: `Decide whether this RedSecAI turn needs scoped RedSecTools internal tools before answering.

Current server time: ${new Date().toISOString()}

Return ONLY strict JSON in this format:
{"useTools":false,"toolCalls":[]}

or:
{"useTools":true,"toolCalls":[{"tool":"tool.name","args":{"query":"short search text","limit":8}}]}

Rules:
- You are only routing. Do not answer the user.
- Decide from the whole recent conversation, not only the last sentence. Follow-up phrases like "check it", "is it there", "what about that", "did it work", or "no meetings?" refer to the most relevant prior RedSecTools domain/action.
- Set useTools=false only for general knowledge, broad industry questions, quick connectivity checks, writing help that does not need RedSecTools records, or prompts like "reply only true if online".
- Set useTools=true whenever the user asks about, verifies, compares, updates, or follows up on RedSecTools data and a listed tool can provide that context.
- If a relevant read/search tool exists, never route to a final answer that would say "I do not have the current context", "refresh the page", or "provide the data".
- Use only tools listed in TOOL_MANIFEST.
- Use at most ${MAX_MODEL_TOOL_CALLS} tool calls.
- Do not request admin, vault, paste, share, or chat tools.
- Read/search tools may be used immediately. Write tools create confirmation cards only.
- For calendar questions, prefer calendar.bootstrap. Include viewMode="week" or "month" and a weekStart Unix-seconds anchor when the user asks for a specific week/month; use scheduleUserId="all" only for team-wide requests.
- If tools are needed but no single focused call is obvious, set useTools=true with an empty toolCalls array.

Recent conversation:
${compactJson((messages || []).slice(-8), 6000)}

TOOL_MANIFEST:
${compactJson(toolManifest, 8000)}`,
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

function sanitizeToolArgs(args = {}, depth = 0) {
  const clean = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, MAX_TOOL_ARG_CHARS);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
    else if (value && typeof value === "object" && !Array.isArray(value) && depth < 2 && ["body", "query", "pathParams"].includes(key)) clean[key] = sanitizeToolArgs(value, depth + 1);
    else if (Array.isArray(value) && depth < 2) {
      clean[key] = value
        .slice(0, 20)
        .filter((item) => ["string", "number", "boolean"].includes(typeof item))
        .map((item) => typeof item === "string" ? item.slice(0, MAX_TOOL_ARG_CHARS) : item);
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
      args: sanitizeToolArgs(call?.args || {}),
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

function parseTimeExpression(value) {
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

function parseDurationSeconds(text) {
  const match = String(text || "").match(/\b(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|minute|minutes|min|mins)\b/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return /min/i.test(match[2]) ? Math.round(amount * 60) : Math.round(amount * 3600);
}

function getZonedToday(timeZone = null) {
  const local = getZonedDateParts(new Date(), timeZone);
  return { year: local.year, month: local.month, day: local.day };
}

function normalizeCalendarWriteCall(call, messages, page = {}) {
  if (!["calendar.entry.create", "calendar.entry.update"].includes(call.tool)) return call;
  const latest = latestUserText(messages);
  const timeZone = typeof page.timeZone === "string" ? page.timeZone.slice(0, 80) : "";
  if (!/\btoday\b/i.test(latest)) return call;
  const rangeMatch = latest.match(/\b(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  const durationMatch = latest.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  const start = parseTimeExpression(rangeMatch?.[1] || durationMatch?.[1]);
  let durationSeconds = parseDurationSeconds(latest);
  let explicitEnd = rangeMatch ? parseTimeExpression(rangeMatch[2]) : null;
  if (!start || (!explicitEnd && !durationSeconds)) return call;
  const today = getZonedToday(timeZone || null);
  const startsAt = zonedLocalToUnix(today.year, today.month, today.day, start.hour, start.minute, 0, timeZone || null);
  let endsAt = explicitEnd
    ? zonedLocalToUnix(today.year, today.month, today.day, explicitEnd.hour, explicitEnd.minute, 0, timeZone || null)
    : startsAt + durationSeconds;
  if (endsAt <= startsAt) endsAt += DAY_SECONDS;
  const args = { ...(call.args || {}) };
  const body = { ...(args.body || args) };
  body.startsAt = startsAt;
  body.endsAt = endsAt;
  body.allDay = false;
  body.timeZone = timeZone || body.timeZone || "server-local";
  return { ...call, args: { ...args, body } };
}

function getCalendarRangeForPrompt(latest, timeZone = null) {
  const now = new Date();
  const local = getZonedDateParts(now, timeZone);
  const localMidnightUtc = Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0, 0);
  const day = new Date(localMidnightUtc).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  let startLocal = new Date(localMidnightUtc + (mondayOffset * DAY_SECONDS * 1000));
  let viewMode = "week";

  if (/\bmonth\b/.test(latest)) {
    viewMode = "month";
    const monthOffset = /\bnext\s+month\b/.test(latest) ? 1 : (/\blast\s+month\b/.test(latest) ? -1 : 0);
    startLocal = new Date(Date.UTC(local.year, local.month - 1 + monthOffset, 1, 0, 0, 0, 0));
    const endLocal = new Date(Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return {
      viewMode,
      rangeStart: zonedLocalToUnix(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, startLocal.getUTCDate(), 0, 0, 0, timeZone),
      rangeEnd: zonedLocalToUnix(endLocal.getUTCFullYear(), endLocal.getUTCMonth() + 1, endLocal.getUTCDate(), 0, 0, 0, timeZone) - 1,
    };
  }

  if (/\bnext\s+week\b/.test(latest)) startLocal = new Date(startLocal.getTime() + (WEEK_SECONDS * 1000));
  if (/\blast\s+week\b/.test(latest)) startLocal = new Date(startLocal.getTime() - (WEEK_SECONDS * 1000));
  const endLocal = new Date(startLocal.getTime() + (WEEK_SECONDS * 1000));
  return {
    viewMode,
    rangeStart: zonedLocalToUnix(startLocal.getUTCFullYear(), startLocal.getUTCMonth() + 1, startLocal.getUTCDate(), 0, 0, 0, timeZone),
    rangeEnd: zonedLocalToUnix(endLocal.getUTCFullYear(), endLocal.getUTCMonth() + 1, endLocal.getUTCDate(), 0, 0, 0, timeZone) - 1,
  };
}

function normalizeCalendarToolCalls(calls, messages, page = {}) {
  const latest = latestUserText(messages).toLowerCase();
  const timeZone = typeof page.timeZone === "string" ? page.timeZone.slice(0, 80) : "";
  return (calls || []).map((call) => {
    if (call.tool !== "calendar.bootstrap") return call;
    const args = { ...(call.args || {}) };
    if (timeZone) args.timeZone = timeZone;

    const asksMonth = /\b(this|current|next|last)\s+month\b|\bmonth\b/.test(latest);
    const asksNextWeek = /\bnext\s+week\b/.test(latest);
    const asksLastWeek = /\blast\s+week\b/.test(latest);
    const asksCurrentWeek = /\b(rest of\s+)?(this|current)\s+week\b|\bmeetings?\b|\bschedule\b|\bplanned\b/.test(latest);

    if (asksMonth || asksNextWeek || asksLastWeek || asksCurrentWeek) {
      const range = getCalendarRangeForPrompt(latest, timeZone || null);
      args.viewMode = range.viewMode;
      args.weekStart = range.rangeStart;
      args.rangeStart = range.rangeStart;
      args.rangeEnd = range.rangeEnd;
    }

    return { ...call, args };
  }).map((call) => normalizeCalendarWriteCall(call, messages, page));
}

function inferMandatoryToolCalls(messages, toolManifest, page = {}) {
  const latest = latestUserText(messages);
  const lower = latest.toLowerCase();
  const hasTool = new Set((toolManifest || []).map((tool) => tool.name));
  const calls = [];
  const recentCalendarWrite = (messages || []).slice(-6).some((message) => (
    /calendar entry|blocked|confirmed pending action|action completed|successfully created|block out/i.test(String(message?.content || ""))
  ));
  if (hasTool.has("calendar.bootstrap") && (
    /\b(calendar|schedule|scheduled|meeting|meetings|planned|availability|rest of this week|this week|next week)\b/i.test(lower)
    || (recentCalendarWrite && /\b(check|verify|there|appearing|showing|see it|is it there|did it|created)\b/i.test(lower))
  )) {
    calls.push({ tool: "calendar.bootstrap", args: page?.timeZone ? { timeZone: page.timeZone } : {} });
  }
  return normalizeCalendarToolCalls(calls, messages, page);
}

async function planModelToolCalls(scopedContext, targetedContext, messages) {
  if (!scopedContext.toolManifest.length) return { calls: [], raw: "" };
  const raw = await provider.chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: targetedContext.text },
    buildToolPlannerPrompt(scopedContext),
    ...messages,
  ], { phase: "tool_planner" });
  const parsed = extractJsonObject(raw);
  return {
    calls: sanitizeModelToolCalls(parsed, scopedContext),
    raw,
  };
}

async function routeModelToolUse(req, messages, options = {}) {
  const toolManifest = getRedSecAiToolManifest(req.access);
  if (!toolManifest.length) {
    return { useTools: false, calls: [], raw: "", toolManifest };
  }
  emitStatus(options, { phase: "tool_router", label: "Deciding whether RedSecTools data is needed" });
  const raw = await provider.chat([
    { role: "system", content: SYSTEM_PROMPT },
    buildToolRouterPrompt(toolManifest, messages),
    { role: "user", content: `Route the latest user turn using the recent conversation above. Latest user turn: ${latestUserText(messages)}` },
  ], { phase: "tool_router" });
  const parsed = extractJsonObject(raw);
  const mandatoryCalls = inferMandatoryToolCalls(messages, toolManifest, options.page || {});
  if (!parsed || typeof parsed.useTools !== "boolean") {
    return { useTools: true, calls: mandatoryCalls, raw, toolManifest };
  }
  const modelCalls = normalizeCalendarToolCalls(sanitizeModelToolCalls(parsed, { toolManifest }), messages, options.page || {});
  const calls = modelCalls.length ? modelCalls : mandatoryCalls;
  return {
    useTools: parsed.useTools === true || calls.length > 0,
    calls,
    raw,
    toolManifest,
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
    finalMessages: [
      { role: "system", content: DIRECT_SYSTEM_PROMPT },
      ...messages,
    ],
    direct: true,
  };
}

async function executeToolCalls(req, calls, options = {}) {
  const results = [];
  for (const call of calls) {
    emitStatus(options, { phase: "tool_execute", label: describeToolCall(call), tool: call.tool });
    if (isRedSecAiToolMutating(call.tool)) {
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

async function buildModelRoutedToolContext(req, calls, options = {}) {
  const normalizedCalls = normalizeCalendarToolCalls(calls, options.messages || [], options.page || {});
  const results = await executeToolCalls(req, normalizedCalls, options);
  return {
    calls: normalizedCalls,
    results,
    pendingActions: results.map((result) => result.action).filter(Boolean),
    text: results.length
      ? `TARGETED_TOOL_CALLS:\n${compactJson(normalizedCalls)}\n\nTARGETED_TOOL_RESULTS:\n${compactJson(results)}`
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

async function prepareRedSecAiTurn(req, rawMessages, page = {}, options = {}) {
  const messages = normalizeMessages(rawMessages);
  if (!messages.length) {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }

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
  const targetedContext = await buildModelRoutedToolContext(scopedReq, routerPlan.calls, { ...options, messages, page });
  const scopedContext = buildScopedToolContext(scopedReq, routerPlan.toolManifest, targetedContext, page || {});
  logEvent("redsecai:turn_context_ready", req, {
    elapsedMs: Date.now() - startedAt,
    scopedContextChars: scopedContext.text.length,
    targetedContextChars: targetedContext.text.length,
    allowedTools: scopedContext.allowedTools,
    targetedTools: targetedContext.calls.map((call) => call.tool),
  });
  emitStatus(options, { phase: "tool_planner", label: "Checking whether another selected tool is needed" });
  const modelPlan = await planModelToolCalls(scopedContext, targetedContext, messages);
  logEvent("redsecai:turn_planner_ready", req, {
    elapsedMs: Date.now() - startedAt,
    plannedTools: modelPlan.calls.map((call) => call.tool),
    plannerRawChars: modelPlan.raw.length,
  });
  const normalizedModelCalls = normalizeCalendarToolCalls(modelPlan.calls, messages, page);
  const modelResults = await executeToolCalls(scopedReq, normalizedModelCalls, options);
  const modelToolContext = {
    calls: normalizedModelCalls,
    results: modelResults,
    pendingActions: modelResults.map((result) => result.action).filter(Boolean),
    raw: modelPlan.raw,
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
    finalMessages: buildFinalMessages(scopedContext, targetedContext, modelToolContext, messages),
  };
}

async function runRedSecAiChat(req, rawMessages, page = {}) {
  const turn = await prepareRedSecAiTurn(req, rawMessages, page);
  const response = await provider.chat(turn.finalMessages, { phase: "final_answer" });
  return {
    ...turn,
    response: response || "I could not produce a response from the local model.",
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
  runRedSecAiChat,
  sanitizeModelToolCalls,
};
