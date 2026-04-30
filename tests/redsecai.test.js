const test = require("node:test");
const assert = require("node:assert/strict");

const { compactJson, hasAny } = require("../server/modules/redsecai/context");
const { getConfig } = require("../server/modules/redsecai/provider");

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
