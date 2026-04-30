"use strict";

const { spawn } = require("child_process");

const DEFAULT_MODEL = "qwen3.5:4b";
const LEGACY_DEFAULT_MODELS = new Set(["qwen2.5:3b-instruct"]);
const DEFAULT_TIMEOUT_MS = 120000;
const MODEL_PULL_STATES = new Map();
let localServeProcess = null;
let localServeStarted = false;

function getConfig() {
  const setting = (key) => {
    try {
      const { getSetting } = require("../../database");
      const value = getSetting(key);
      return value == null ? "" : String(value);
    } catch (_) {
      return "";
    }
  };
  const envBaseUrl = process.env.REDSECAI_BASE_URL || "http://127.0.0.1:11434";
  const envModel = process.env.REDSECAI_MODEL || DEFAULT_MODEL;
  const dbBaseUrl = setting("redsecai_base_url");
  const dbModel = setting("redsecai_model");
  const envUsesDockerService = /^https?:\/\/redsecai(?::\d+)?$/i.test(envBaseUrl.replace(/\/+$/, ""));
  const dbUsesLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(dbBaseUrl.replace(/\/+$/, ""));
  const baseUrl = (envUsesDockerService && dbUsesLocalhost ? envBaseUrl : (dbBaseUrl || envBaseUrl)).replace(/\/+$/, "");
  const model = (LEGACY_DEFAULT_MODELS.has(dbModel) ? envModel : (dbModel || envModel));
  const enabledRaw = setting("redsecai_enabled") || process.env.REDSECAI_ENABLED || "true";
  const autostartRaw = setting("redsecai_autostart") || process.env.REDSECAI_AUTOSTART || "";
  const autoPullRaw = setting("redsecai_auto_pull") || process.env.REDSECAI_AUTO_PULL || "true";
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
  return {
    enabled: enabledRaw !== "false",
    baseUrl,
    model,
    timeoutMs: Math.max(1000, parseInt(setting("redsecai_timeout_ms") || process.env.REDSECAI_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS),
    autostart: autostartRaw
      ? autostartRaw !== "false"
      : isLocalhost,
    autoPull: autoPullRaw !== "false",
    isLocalhost,
  };
}

function controllerWithTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function checkModelHealth() {
  const config = getConfig();
  if (!config.enabled) return { ok: false, enabled: false, model: config.model, error: "RedSecAI is disabled" };

  if (config.autostart && config.isLocalhost) {
    ensureLocalModelService().catch(() => {});
  }

  const { controller, timeout } = controllerWithTimeout(4000);
  try {
    const res = await fetch(`${config.baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { ok: false, enabled: true, model: config.model, error: `Model service returned HTTP ${res.status}` };
    const body = await res.json().catch(() => ({}));
    const models = Array.isArray(body.models) ? body.models.map((item) => item.name) : [];
    const modelReady = models.some((name) => name === config.model || name.startsWith(`${config.model}:`));
    const pullState = MODEL_PULL_STATES.get(config.model) || null;
    if (!modelReady && config.autoPull && config.isLocalhost && pullState !== "pulling") {
      ensureModelInstalled(config.model).catch(() => {});
    }
    return {
      ok: modelReady,
      enabled: true,
      model: config.model,
      availableModels: models,
      installing: pullState === "pulling" || (!modelReady && config.autoPull && config.isLocalhost),
      error: modelReady ? null : (pullState === "failed" ? "Model pull failed" : "Local model is not installed yet"),
    };
  } catch (error) {
    return { ok: false, enabled: true, model: config.model, error: error.name === "AbortError" ? "Model service timed out" : "Model service unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

async function chat(messages) {
  const config = getConfig();
  if (!config.enabled) {
    const error = new Error("RedSecAI is disabled");
    error.status = 503;
    throw error;
  }

  if (config.autostart && config.isLocalhost) {
    await ensureLocalModelService();
  }

  const { controller, timeout } = controllerWithTimeout(config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        messages,
        options: {
          temperature: 0.2,
          num_ctx: 8192,
        },
      }),
    });
    if (!res.ok) {
      const error = new Error(`RedSecAI model service returned HTTP ${res.status}`);
      error.status = 502;
      throw error;
    }
    const body = await res.json();
    return String(body?.message?.content || "").trim();
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("RedSecAI model request timed out");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function* chatStream(messages) {
  const config = getConfig();
  if (!config.enabled) {
    const error = new Error("RedSecAI is disabled");
    error.status = 503;
    throw error;
  }

  if (config.autostart && config.isLocalhost) {
    await ensureLocalModelService();
  }

  const { controller, timeout } = controllerWithTimeout(config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: true,
        messages,
        options: {
          temperature: 0.2,
          num_ctx: 8192,
        },
      }),
    });
    if (!res.ok) {
      const error = new Error(`RedSecAI model service returned HTTP ${res.status}`);
      error.status = 502;
      throw error;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        const content = payload?.message?.content;
        if (content) yield content;
        if (payload?.done) return;
      }
    }
    if (buffer.trim()) {
      const payload = JSON.parse(buffer);
      const content = payload?.message?.content;
      if (content) yield content;
    }
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("RedSecAI model request timed out");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function spawnOllama(args, options = {}) {
  return spawn("ollama", args, {
    windowsHide: true,
    stdio: options.stdio || "ignore",
    detached: !!options.detached,
  });
}

async function waitForService(baseUrl, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/tags`);
      if (res.ok) return true;
    } catch (_) {
      // Keep polling until timeout; Ollama can take a few seconds to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function ensureLocalModelService() {
  const config = getConfig();
  if (!config.enabled || !config.autostart || !config.isLocalhost) return false;

  try {
    const res = await fetch(`${config.baseUrl}/api/tags`);
    if (res.ok) return true;
  } catch (_) {
    // Start below.
  }

  if (!localServeStarted) {
    localServeStarted = true;
    localServeProcess = spawnOllama(["serve"], { detached: true });
    localServeProcess.unref();
  }

  const ready = await waitForService(config.baseUrl);
  if (ready && config.autoPull) {
    ensureModelInstalled(config.model).catch(() => {});
  }
  return ready;
}

async function ensureModelInstalled(model) {
  const config = getConfig();
  if (!config.enabled || !config.autoPull || !config.isLocalhost || !model) return false;
  if (MODEL_PULL_STATES.get(model) === "pulling") return false;

  const health = await fetch(`${config.baseUrl}/api/tags`).then((res) => res.json()).catch(() => ({}));
  const models = Array.isArray(health.models) ? health.models.map((item) => item.name) : [];
  if (models.some((name) => name === model || name.startsWith(`${model}:`))) {
    MODEL_PULL_STATES.set(model, "ready");
    return true;
  }

  MODEL_PULL_STATES.set(model, "pulling");
  await new Promise((resolve) => {
    const pull = spawnOllama(["pull", model], { stdio: "ignore" });
    pull.on("exit", (code) => {
      MODEL_PULL_STATES.set(model, code === 0 ? "ready" : "failed");
      resolve();
    });
    pull.on("error", () => {
      MODEL_PULL_STATES.set(model, "failed");
      resolve();
    });
  });

  return MODEL_PULL_STATES.get(model) === "ready";
}

module.exports = {
  DEFAULT_MODEL,
  getConfig,
  checkModelHealth,
  chat,
  chatStream,
  ensureLocalModelService,
  ensureModelInstalled,
};
