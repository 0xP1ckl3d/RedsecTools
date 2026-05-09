"use strict";

const { spawn } = require("child_process");
const net = require("net");
const { logEvent, logWarn } = require("../../core/logger");

const DEFAULT_MODEL = "qwen3.5:4b";
const LEGACY_DEFAULT_MODELS = new Set(["qwen2.5:3b-instruct"]);
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_NUM_CTX = 4096;
const MODEL_PULL_STATES = new Map();
let localServeProcess = null;
let localServeStarted = false;

function isCloudModel(model) {
  return typeof model === "string" && /(?:^|[:-])cloud$/i.test(model.trim());
}

function hasLocalModel(models, model) {
  return models.some((name) => name === model || name.startsWith(`${model}:`));
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "").split(".").map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || a === 0
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function classifyEndpoint(baseUrl, model) {
  let url;
  try {
    url = new URL(String(baseUrl || ""));
  } catch (_) {
    return {
      processingMode: "unknown",
      endpointRisk: "unknown",
      endpointWarnings: ["RedSecAI endpoint is not a valid http(s) origin."],
      endpointHost: "",
    };
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const cloudModel = isCloudModel(model);
  const local = hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1";
  const privateIp = net.isIP(hostname) === 4 && isPrivateIpv4(hostname);
  const privateIpv6 = net.isIP(hostname) === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80"));
  const internalName = !hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan");
  const internal = !local && (privateIp || privateIpv6 || internalName);
  const external = !local && !internal;

  const warnings = [];
  if (cloudModel) {
    warnings.push("Cloud models send prompt context and selected tool results through the configured Ollama service to the cloud provider.");
  }
  if (external) {
    warnings.push("This RedSecAI endpoint is not local or private-network scoped. Treat it as an external AI processor.");
  }

  return {
    processingMode: local
      ? (cloudModel ? "local-ollama-cloud-model" : "local-ollama-local-model")
      : internal
        ? (cloudModel ? "internal-ollama-cloud-model" : "internal-ollama-local-model")
        : (cloudModel ? "external-cloud-model" : "external-ollama-endpoint"),
    endpointRisk: external || cloudModel ? "elevated" : "local",
    endpointWarnings: warnings,
    endpointHost: hostname,
  };
}

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
  const cloudModel = isCloudModel(model);
  const enabledRaw = setting("redsecai_enabled") || process.env.REDSECAI_ENABLED || "true";
  const autostartRaw = setting("redsecai_autostart") || process.env.REDSECAI_AUTOSTART || "";
  const autoPullRaw = setting("redsecai_auto_pull") || process.env.REDSECAI_AUTO_PULL || "true";
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
  const endpoint = classifyEndpoint(baseUrl, model);
  return {
    enabled: enabledRaw !== "false",
    baseUrl,
    model,
    cloudModel,
    timeoutMs: Math.max(1000, parseInt(setting("redsecai_timeout_ms") || process.env.REDSECAI_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS),
    numCtx: Math.max(1024, parseInt(setting("redsecai_num_ctx") || process.env.REDSECAI_NUM_CTX || String(DEFAULT_NUM_CTX), 10) || DEFAULT_NUM_CTX),
    autostart: autostartRaw
      ? autostartRaw !== "false"
      : isLocalhost,
    autoPull: autoPullRaw !== "false",
    isLocalhost,
    ...endpoint,
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
    const modelReady = hasLocalModel(models, config.model);
    const pullState = MODEL_PULL_STATES.get(config.model) || null;
    if (!modelReady && config.autoPull && config.isLocalhost && pullState !== "pulling") {
      ensureModelInstalled(config.model).catch(() => {});
    }
    const installing = pullState === "pulling" || (!modelReady && config.autoPull && config.isLocalhost);
    const missingModelError = config.cloudModel
      ? `Cloud model is not available through this Ollama service yet. Sign in to Ollama and pull ${config.model}, then rerun diagnostics.`
      : "Local model is not installed yet";
    return {
      ok: modelReady,
      enabled: true,
      model: config.model,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      numCtx: config.numCtx,
      cloudModel: config.cloudModel,
      processingMode: config.processingMode,
      endpointRisk: config.endpointRisk,
      endpointWarnings: config.endpointWarnings,
      availableModels: models,
      installing,
      error: modelReady ? null : (pullState === "failed" ? "Model pull failed" : missingModelError),
    };
  } catch (error) {
    return {
      ok: false,
      enabled: true,
      model: config.model,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      numCtx: config.numCtx,
      cloudModel: config.cloudModel,
      processingMode: config.processingMode,
      endpointRisk: config.endpointRisk,
      endpointWarnings: config.endpointWarnings,
      error: error.name === "AbortError" ? "Model service timed out" : "Model service unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function redsecAiRequestError(message, status, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function summarizeRequest(config, messages, phase, startedAt, extra = {}) {
  return {
    phase: phase || "chat",
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    numCtx: config.numCtx,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    requestBytes: Buffer.byteLength(JSON.stringify(messages || []), "utf8"),
    elapsedMs: Date.now() - startedAt,
    ...extra,
  };
}

async function chat(messages, options = {}) {
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
  const startedAt = Date.now();
  const phase = options.phase || "chat";
  logEvent("redsecai:model_request_start", null, summarizeRequest(config, messages, phase, startedAt));
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
          num_ctx: config.numCtx,
        },
      }),
    });
    if (!res.ok) {
      const bodyPreview = (await res.text().catch(() => "")).slice(0, 1200);
      throw redsecAiRequestError(`RedSecAI model service returned HTTP ${res.status}`, 502, {
        httpStatus: res.status,
        bodyPreview,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: config.timeoutMs,
        model: config.model,
        baseUrl: config.baseUrl,
        phase,
      });
    }
    const body = await res.json();
    const content = String(body?.message?.content || "").trim();
    logEvent("redsecai:model_request_done", null, summarizeRequest(config, messages, phase, startedAt, {
      responseChars: content.length,
      doneReason: body?.done_reason || null,
    }));
    return content;
  } catch (error) {
    if (error.name === "AbortError") {
      throw redsecAiRequestError(`RedSecAI model request timed out after ${Math.round(config.timeoutMs / 1000)}s`, 504, {
        elapsedMs: Date.now() - startedAt,
        timeoutMs: config.timeoutMs,
        model: config.model,
        baseUrl: config.baseUrl,
        numCtx: config.numCtx,
        phase,
      });
    }
    logWarn("redsecai:model_request_failed", summarizeRequest(config, messages, phase, startedAt, {
      message: error.message,
      status: error.status || null,
    }));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function* chatStream(messages, options = {}) {
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
  const startedAt = Date.now();
  const phase = options.phase || "chat_stream";
  let responseChars = 0;
  logEvent("redsecai:model_request_start", null, summarizeRequest(config, messages, phase, startedAt, { stream: true }));
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
          num_ctx: config.numCtx,
        },
      }),
    });
    if (!res.ok) {
      const bodyPreview = (await res.text().catch(() => "")).slice(0, 1200);
      throw redsecAiRequestError(`RedSecAI model service returned HTTP ${res.status}`, 502, {
        httpStatus: res.status,
        bodyPreview,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: config.timeoutMs,
        model: config.model,
        baseUrl: config.baseUrl,
        phase,
      });
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
        if (content) {
          responseChars += content.length;
          yield content;
        }
        if (payload?.done) {
          logEvent("redsecai:model_request_done", null, summarizeRequest(config, messages, phase, startedAt, {
            stream: true,
            responseChars,
            doneReason: payload?.done_reason || null,
          }));
          return;
        }
      }
    }
    if (buffer.trim()) {
      const payload = JSON.parse(buffer);
      const content = payload?.message?.content;
      if (content) {
        responseChars += content.length;
        yield content;
      }
    }
    logEvent("redsecai:model_request_done", null, summarizeRequest(config, messages, phase, startedAt, {
      stream: true,
      responseChars,
    }));
  } catch (error) {
    if (error.name === "AbortError") {
      throw redsecAiRequestError(`RedSecAI model request timed out after ${Math.round(config.timeoutMs / 1000)}s`, 504, {
        elapsedMs: Date.now() - startedAt,
        timeoutMs: config.timeoutMs,
        model: config.model,
        baseUrl: config.baseUrl,
        numCtx: config.numCtx,
        phase,
      });
    }
    logWarn("redsecai:model_request_failed", summarizeRequest(config, messages, phase, startedAt, {
      stream: true,
      responseChars,
      message: error.message,
      status: error.status || null,
    }));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postOllamaJson(path, body, timeoutMs) {
  const config = getConfig();
  const { controller, timeout } = controllerWithTimeout(timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      bodyPreview: text.slice(0, 1200),
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? 504 : 0,
      elapsedMs: Date.now() - startedAt,
      error: error.name === "AbortError" ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runDiagnostics(timeoutMs = 60000) {
  const config = getConfig();
  const health = await checkModelHealth();
  const generate = await postOllamaJson("/api/generate", {
    model: config.model,
    prompt: "Reply with only: pong",
    stream: false,
  }, timeoutMs);
  const chatProbe = await postOllamaJson("/api/chat", {
    model: config.model,
    stream: false,
    messages: [{ role: "user", content: "Reply with only: pong" }],
    options: {
      temperature: 0.2,
      num_ctx: config.numCtx,
    },
  }, timeoutMs);

  return {
    config: {
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      model: config.model,
      cloudModel: config.cloudModel,
      timeoutMs: config.timeoutMs,
      numCtx: config.numCtx,
      autostart: config.autostart,
      autoPull: config.autoPull,
      processingMode: config.processingMode,
      endpointRisk: config.endpointRisk,
      endpointWarnings: config.endpointWarnings,
    },
    health,
    probes: {
      generate,
      chat: chatProbe,
    },
  };
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
  if (hasLocalModel(models, model)) {
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
  classifyEndpoint,
  isCloudModel,
  getConfig,
  checkModelHealth,
  chat,
  chatStream,
  runDiagnostics,
  ensureLocalModelService,
  ensureModelInstalled,
};
