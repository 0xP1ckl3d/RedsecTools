"use strict";

const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { logEvent, logWarn } = require("../core/logger");
const provider = require("../modules/redsecai/provider");
const { normalizeMessages, runRedSecAiChat } = require("../modules/redsecai/orchestrator");
const { cancelPendingAction, confirmPendingAction, listPendingActionsForUser } = require("../modules/redsecai/actions");

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
    cloudModel: !!health.cloudModel,
    baseUrl: health.baseUrl,
    timeoutMs: health.timeoutMs,
    numCtx: health.numCtx,
    installing: !!health.installing,
    error: health.error,
    pendingActions: listPendingActionsForUser(req.user.id),
  });
});

router.post("/ai/actions/:id/confirm", chatLimiter, requireUser, attachUserAccess, async (req, res) => {
  try {
    const confirmed = await confirmPendingAction(req, req.params.id);
    logEvent("redsecai:action_confirmed", req, {
      tool: confirmed.action.tool,
      status: confirmed.result.status,
      ok: confirmed.result.ok,
    });
    res.status(confirmed.result.ok ? 200 : confirmed.result.status || 400).json({
      success: !!confirmed.result.ok,
      action: confirmed.action,
      result: confirmed.result,
      error: confirmed.result.ok ? undefined : (confirmed.result.error || confirmed.result.body?.error || "RedSecAI action failed"),
    });
  } catch (error) {
    logWarn("redsecai:action_confirm_failed", { message: error.message, status: error.status || 500 });
    res.status(error.status || 500).json({ error: error.message || "RedSecAI action could not be confirmed" });
  }
});

router.post("/ai/actions/:id/reject", chatLimiter, requireUser, attachUserAccess, async (req, res) => {
  try {
    const action = cancelPendingAction(req, req.params.id);
    logEvent("redsecai:action_rejected", req, {
      tool: action.tool,
    });
    res.json({ success: true, action });
  } catch (error) {
    logWarn("redsecai:action_reject_failed", { message: error.message, status: error.status || 500 });
    res.status(error.status || 500).json({ error: error.message || "RedSecAI action could not be rejected" });
  }
});

router.post("/ai/chat", chatLimiter, requireUser, attachUserAccess, async (req, res) => {
  const messages = normalizeMessages(req.body?.messages);
  if (!messages.length) return res.status(400).json({ error: "Message is required" });

  try {
    const page = {
      ...(req.body?.page || {}),
      timeZone: req.body?.page?.timeZone || req.cookies?.redsec_tz || "",
    };
    const turn = await runRedSecAiChat(req, messages, page);

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
      pendingActions: turn.pendingActions || [],
    });
  } catch (error) {
    logWarn("redsecai:chat_failed", { message: error.message, status: error.status || 500, details: error.details || null });
    res.status(error.status || 500).json({
      error: error.status === 503 || error.status === 504 ? error.message : "RedSecAI is unavailable",
      details: error.details || undefined,
    });
  }
});

module.exports = router;
