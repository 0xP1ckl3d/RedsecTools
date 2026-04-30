const test = require("node:test");
const assert = require("node:assert/strict");

const { compactJson, hasAny } = require("../server/modules/redsecai/context");
const { getConfig } = require("../server/modules/redsecai/provider");
const { extractJsonObject, sanitizeModelToolCalls } = require("../server/modules/redsecai/orchestrator");

test("RedSecAI permission helper accepts only explicit scoped permissions", () => {
  assert.equal(hasAny({ permissionSet: new Set(["calendar.view"]) }, ["calendar.view", "calendar.manage"]), true);
  assert.equal(hasAny({ permissionSet: new Set(["admin.manage"]) }, ["calendar.view", "calendar.manage"]), false);
  assert.equal(hasAny(null, ["calendar.view"]), false);
});

test("RedSecAI context compaction truncates oversized scoped API payloads", () => {
  const compacted = compactJson({ content: "a".repeat(100) }, 40);
  assert.ok(compacted.length <= 55);
  assert.ok(compacted.includes("[truncated]"));
});

test("RedSecAI exposes a clear scoped tool manifest", () => {
  const { TOOL_ALLOWLIST } = require("../server/modules/redsecai/context");
  assert.ok(TOOL_ALLOWLIST["calendar.bootstrap"].description.includes("calendar"));
  assert.equal(TOOL_ALLOWLIST["calendar.bootstrap"].capability, "calendar.read");
  assert.equal(TOOL_ALLOWLIST["threat.alerts"].capability, "threat.read");
  assert.equal(TOOL_ALLOWLIST["reporter.projects"].capability, "reporter.read");
  assert.equal(TOOL_ALLOWLIST["wiki.bootstrap"].capability, "wiki.read");
  assert.equal(TOOL_ALLOWLIST["vault.entries"], undefined);
});

test("RedSecAI derives targeted tools without granting encrypted/admin access", () => {
  const { deriveRedSecAiToolCalls } = require("../server/modules/redsecai/context");
  const access = {
    permissionSet: new Set(["threat.view", "wiki.view", "calendar.view", "reporter.view"]),
  };
  const calls = deriveRedSecAiToolCalls("Find relevant CVE-2026-12345 threat alerts and any wiki runbook", access);
  assert.ok(calls.some((call) => call.tool === "threat.searchAlerts"));
  assert.ok(calls.some((call) => call.tool === "wiki.search"));
  assert.ok(!calls.some((call) => call.tool.includes("vault") || call.tool.includes("admin")));
});

test("RedSecAI targeted tools require RBAC", () => {
  const { deriveRedSecAiToolCalls } = require("../server/modules/redsecai/context");
  const calls = deriveRedSecAiToolCalls("Find relevant threat alerts about ransomware", {
    permissionSet: new Set(["wiki.view"]),
  });
  assert.equal(calls.some((call) => call.tool === "threat.searchAlerts"), false);
});

test("RedSecAI provider config uses safe local defaults", () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalSettings = {
    redsecai_enabled: getSetting("redsecai_enabled"),
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
    redsecai_timeout_ms: getSetting("redsecai_timeout_ms"),
    redsecai_autostart: getSetting("redsecai_autostart"),
    redsecai_auto_pull: getSetting("redsecai_auto_pull"),
  };
  const originalBaseUrl = process.env.REDSECAI_BASE_URL;
  const originalModel = process.env.REDSECAI_MODEL;
  const originalEnabled = process.env.REDSECAI_ENABLED;
  delete process.env.REDSECAI_BASE_URL;
  delete process.env.REDSECAI_MODEL;
  delete process.env.REDSECAI_ENABLED;

  try {
    setSetting("redsecai_enabled", "true");
    setSetting("redsecai_base_url", "http://127.0.0.1:11434");
    setSetting("redsecai_model", "qwen3.5:4b");
    setSetting("redsecai_timeout_ms", "120000");
    setSetting("redsecai_autostart", "true");
    setSetting("redsecai_auto_pull", "true");
    const config = getConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.baseUrl, "http://127.0.0.1:11434");
    assert.equal(config.model, "qwen3.5:4b");
  } finally {
    if (originalBaseUrl === undefined) delete process.env.REDSECAI_BASE_URL;
    else process.env.REDSECAI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.REDSECAI_MODEL;
    else process.env.REDSECAI_MODEL = originalModel;
    if (originalEnabled === undefined) delete process.env.REDSECAI_ENABLED;
    else process.env.REDSECAI_ENABLED = originalEnabled;
    for (const [key, value] of Object.entries(originalSettings)) {
      setSetting(key, value || "");
    }
  }
});

test("RedSecAI provider prefers Docker service URL over stale localhost DB URL", () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalSettings = {
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
  };
  const originalBaseUrl = process.env.REDSECAI_BASE_URL;
  const originalModel = process.env.REDSECAI_MODEL;

  try {
    process.env.REDSECAI_BASE_URL = "http://redsecai:11434";
    process.env.REDSECAI_MODEL = "qwen3.5:4b";
    setSetting("redsecai_base_url", "http://127.0.0.1:11434");
    setSetting("redsecai_model", "qwen2.5:3b-instruct");

    const config = getConfig();
    assert.equal(config.baseUrl, "http://redsecai:11434");
    assert.equal(config.model, "qwen3.5:4b");
  } finally {
    if (originalBaseUrl === undefined) delete process.env.REDSECAI_BASE_URL;
    else process.env.REDSECAI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.REDSECAI_MODEL;
    else process.env.REDSECAI_MODEL = originalModel;
    for (const [key, value] of Object.entries(originalSettings)) {
      setSetting(key, value || "");
    }
  }
});

test("RedSecAI extracts strict JSON tool plans from small local models", () => {
  assert.deepEqual(extractJsonObject('```json\n{"toolCalls":[{"tool":"wiki.search","args":{"query":"vpn"}}]}\n```'), {
    toolCalls: [{ tool: "wiki.search", args: { query: "vpn" } }],
  });
  assert.equal(extractJsonObject("not json"), null);
});

test("RedSecAI sanitizes model-planned tools against manifest and encrypted scopes", () => {
  const scopedContext = {
    toolManifest: [
      { name: "threat.searchAlerts" },
      { name: "wiki.search" },
    ],
  };
  const calls = sanitizeModelToolCalls({
    toolCalls: [
      { tool: "threat.searchAlerts", args: { query: "CVE-2026-12345", limit: 99, badKey: { nested: true } } },
      { tool: "vault.entries", args: {} },
      { tool: "admin.users", args: {} },
      { tool: "wiki.search", args: { query: "a".repeat(1500) } },
    ],
  }, scopedContext);

  assert.deepEqual(calls.map((call) => call.tool), ["threat.searchAlerts", "wiki.search"]);
  assert.equal(calls[0].args.query, "CVE-2026-12345");
  assert.equal(calls[0].args.limit, 99);
  assert.equal(calls[0].args.badKey, undefined);
  assert.equal(calls[1].args.query.length, 1000);
});
