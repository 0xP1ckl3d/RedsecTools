"use strict";

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { logEvent, logWarn } = require("../core/logger");
const provider = require("../modules/redsecai/provider");
const { normalizeMessages, runRedSecAiChat } = require("../modules/redsecai/orchestrator");

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: "Too many RedSecAI requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
    const turn = await runRedSecAiChat(req, messages, req.body?.page || {});

    logEvent("redsecai:chat", req, {
      model: provider.getConfig().model,
      messageCount: messages.length,
      allowedTools: turn.scopedContext.allowedTools,
      targetedTools: turn.targetedContext.calls.map((call) => call.tool),
      modelRequestedTools: turn.modelToolContext.calls.map((call) => call.tool),
    });

    res.json({
      success: true,
      message: turn.response,
      allowedTools: turn.scopedContext.allowedTools,
      targetedTools: turn.targetedContext.calls.map((call) => call.tool),
      modelRequestedTools: turn.modelToolContext.calls.map((call) => call.tool),
    });
  } catch (error) {
    logWarn("redsecai:chat_failed", { message: error.message, status: error.status || 500 });
    res.status(error.status || 500).json({ error: error.status === 503 ? error.message : "RedSecAI is unavailable" });
  }
});

module.exports = router;
