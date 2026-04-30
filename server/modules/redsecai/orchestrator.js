"use strict";

const {
  buildScopedContext,
  buildTargetedToolContext,
  compactJson,
  executeRedSecAiTool,
} = require("./context");
const provider = require("./provider");

const MAX_MODEL_TOOL_CALLS = 4;
const MAX_TOOL_ARG_CHARS = 1000;

const SYSTEM_PROMPT = `You are RedSecAI, the built-in local assistant for RedSecTools.

Security boundaries:
- You operate only for the logged-in user and only with the scoped context provided by RedSecTools APIs.
- You have access to server-executed internal tool results in TOOL_RESULTS. These results have already been fetched through the user's own RBAC-scoped APIs.
- You may also receive TARGETED_TOOL_RESULTS and MODEL_REQUESTED_TOOL_RESULTS for the user's current request. Prefer request-specific tool results over broad snapshots when answering specific questions.
- Do not say you have no access to internal tools when tool results contain successful outputs. Instead, say which scoped data is available.
- Never invent platform data. If the scoped tool results are empty, failed, or lack a requested field, say the data is not available in the current scoped tool results.
- You do not have admin scope and must not claim to perform admin actions.
- You must not access, request, infer, store, or summarize decrypted content from RedSecPaste, RedSecShare, RedSecTeam chat, or RedSecVault.
- You may help draft report text, summarize permitted threat intel, and reason about permitted calendar context.
- Stage 1 is read-only for platform actions. If the user asks you to update data, draft the exact change and tell them it needs explicit confirmation in the relevant tool.
- Do not ask users to paste passwords, recovery codes, API keys, private keys, TOTP secrets, session tokens, bearer tokens, URL fragment encryption keys, or decrypted vault content.

Be concise, practical, and transparent about limitations.`;

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

function buildToolPlannerPrompt(scopedContext) {
  return {
    role: "system",
    content: `Before answering, decide whether extra scoped internal tools are needed.

Return ONLY strict JSON in this format:
{"toolCalls":[{"tool":"tool.name","args":{"query":"short search text","limit":8}}]}

Rules:
- Use only tools listed in TOOL_MANIFEST.
- Use at most ${MAX_MODEL_TOOL_CALLS} tool calls.
- Use read/search tools only.
- Do not request admin, vault, paste, share, or chat tools.
- If the existing TOOL_RESULTS and TARGETED_TOOL_RESULTS are enough, return {"toolCalls":[]}.
- If the user asks for threat alerts about a topic, prefer threat.searchAlerts with a focused query.
- If the user asks for wiki/runbook/procedure content, prefer wiki.search with a focused query.
- If the user asks about schedule, calendar, utilisation, or project time, prefer calendar.bootstrap.
- If the user asks about reports, findings, projects, clients, or evidence, prefer reporter.projects.

Allowed tool manifest:
${compactJson(scopedContext.toolManifest, 8000)}`,
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

function sanitizeToolArgs(args = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, MAX_TOOL_ARG_CHARS);
    else if (typeof value === "number" || typeof value === "boolean") clean[key] = value;
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

async function planModelToolCalls(scopedContext, targetedContext, messages) {
  if (!scopedContext.toolManifest.length) return { calls: [], raw: "" };
  const raw = await provider.chat([
    ...buildSystemMessages(scopedContext),
    { role: "system", content: targetedContext.text },
    buildToolPlannerPrompt(scopedContext),
    ...messages,
  ]);
  const parsed = extractJsonObject(raw);
  return {
    calls: sanitizeModelToolCalls(parsed, scopedContext),
    raw,
  };
}

async function executeToolCalls(req, calls) {
  const results = [];
  for (const call of calls) {
    results.push(await executeRedSecAiTool(req, call.tool, call.args));
  }
  return results;
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

async function prepareRedSecAiTurn(req, rawMessages, page = {}) {
  const messages = normalizeMessages(rawMessages);
  if (!messages.length) {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }

  const scopedReq = req;
  const scopedContext = await buildScopedContext(scopedReq, page || {});
  const targetedContext = await buildTargetedToolContext(scopedReq, messages);
  const modelPlan = await planModelToolCalls(scopedContext, targetedContext, messages);
  const modelResults = await executeToolCalls(scopedReq, modelPlan.calls);
  const modelToolContext = {
    calls: modelPlan.calls,
    results: modelResults,
    raw: modelPlan.raw,
  };

  return {
    messages,
    scopedContext,
    targetedContext,
    modelToolContext,
    finalMessages: buildFinalMessages(scopedContext, targetedContext, modelToolContext, messages),
  };
}

async function runRedSecAiChat(req, rawMessages, page = {}) {
  const turn = await prepareRedSecAiTurn(req, rawMessages, page);
  const response = await provider.chat(turn.finalMessages);
  return {
    ...turn,
    response: response || "I could not produce a response from the local model.",
  };
}

module.exports = {
  SYSTEM_PROMPT,
  buildFinalMessages,
  buildSystemMessages,
  extractJsonObject,
  normalizeMessages,
  prepareRedSecAiTurn,
  runRedSecAiChat,
  sanitizeModelToolCalls,
};
