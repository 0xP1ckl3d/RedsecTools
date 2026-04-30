"use strict";

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { logEvent, logWarn } = require("../core/logger");
const provider = require("../modules/redsecai/provider");
const { buildScopedContext } = require("../modules/redsecai/context");

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many RedSecAI requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const SYSTEM_PROMPT = `You are RedSecAI, the built-in local assistant for RedSecTools.

Security boundaries:
- You operate only for the logged-in user and only with the scoped context provided by RedSecTools APIs.
- You have access to server-executed internal tool results in TOOL_RESULTS. These results have already been fetched through the user's own RBAC-scoped APIs.
- Do not say you have no access to internal tools when TOOL_RESULTS contains successful tool outputs. Instead, say which scoped data is available.
- Never invent platform data. If TOOL_RESULTS is empty, failed, or lacks a requested field, say the data is not available in the current scoped tool results.
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

router.get("/ai/status", requireUser, attachUserAccess, async (req, res) => {
  const health = await provider.checkModelHealth();
  res.json({
    enabled: health.enabled,
    ready: health.ok,
    model: health.model,
    installing: !!health.installing,
    error: health.error,
  });
});

router.post("/ai/chat", chatLimiter, requireUser, attachUserAccess, async (req, res) => {
  const messages = normalizeMessages(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: "Message is required" });

  try {
    const scopedContext = await buildScopedContext(req, req.body?.page || {});
    const response = await provider.chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `SERVER-EXECUTED TOOL ACCESS FOR THIS USER: ${scopedContext.allowedTools.join(", ") || "none"}\n\n${scopedContext.text}` },
      ...messages,
    ]);

    logEvent("redsecai:chat", req, {
      model: provider.getConfig().model,
      messageCount: messages.length,
      allowedTools: scopedContext.allowedTools,
    });

    res.json({
      success: true,
      message: response || "I could not produce a response from the local model.",
      allowedTools: scopedContext.allowedTools,
    });
  } catch (error) {
    logWarn("redsecai:chat_failed", { message: error.message, status: error.status || 500 });
    res.status(error.status || 500).json({ error: error.status === 503 ? error.message : "RedSecAI is unavailable" });
  }
});

module.exports = router;
