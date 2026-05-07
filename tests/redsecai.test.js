const test = require("node:test");
const assert = require("node:assert/strict");

const { compactJson, executeRedSecAiTool, hasAny } = require("../server/modules/redsecai/context");
const { checkModelHealth, getConfig, isCloudModel, runDiagnostics } = require("../server/modules/redsecai/provider");
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
  assert.equal(TOOL_ALLOWLIST["calendar.entry.create"].capability, "calendar.write");
  assert.equal(TOOL_ALLOWLIST["calendar.entry.create"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["threat.alerts"].capability, "threat.read");
  assert.equal(TOOL_ALLOWLIST["reporter.projects"].capability, "reporter.read");
  assert.equal(TOOL_ALLOWLIST["reporter.note.create"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["wiki.bootstrap"].capability, "wiki.read");
  assert.equal(TOOL_ALLOWLIST["wiki.page.create"].confirmRequired, true);
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

test("RedSecAI routes tool use with a lightweight model decision", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const req = {
    access: { permissionSet: new Set(["threat.view", "calendar.view"]) },
  };

  try {
    provider.chat = async (messages, options = {}) => {
      assert.equal(options.phase, "tool_router");
      const joined = messages.map((message) => message.content).join("\n");
      assert.ok(joined.includes("TOOL_MANIFEST"));
      assert.ok(!joined.includes("Scoped threat intelligence snapshot"));
      return JSON.stringify({ useTools: false, toolCalls: [] });
    };
    const direct = await orchestrator.routeModelToolUse(req, [{ role: "user", content: "Reply only true if online" }]);
    assert.equal(direct.useTools, false);
    assert.deepEqual(direct.calls, []);

    provider.chat = async () => JSON.stringify({
      useTools: true,
      toolCalls: [{ tool: "threat.searchAlerts", args: { query: "ransomware", limit: 4 } }],
    });
    const routed = await orchestrator.routeModelToolUse(req, [{ role: "user", content: "Summarise my current threat alerts about ransomware" }]);
    assert.equal(routed.useTools, true);
    assert.deepEqual(routed.calls.map((call) => call.tool), ["threat.searchAlerts"]);

    provider.chat = async () => JSON.stringify({ useTools: false, toolCalls: [] });
    const calendar = await orchestrator.routeModelToolUse(req, [{ role: "user", content: "No meetings?" }], { page: { timeZone: "Australia/Sydney" } });
    assert.equal(calendar.useTools, true);
    assert.deepEqual(calendar.calls.map((call) => call.tool), ["calendar.bootstrap"]);
    assert.equal(calendar.calls[0].args.viewMode, "week");
    assert.equal(calendar.calls[0].args.timeZone, "Australia/Sydney");
    assert.equal(Number.isFinite(calendar.calls[0].args.weekStart), true);
    assert.equal(Number.isFinite(calendar.calls[0].args.rangeStart), true);
    assert.equal(Number.isFinite(calendar.calls[0].args.rangeEnd), true);
    assert.equal(calendar.calls[0].args.weekStart, calendar.calls[0].args.rangeStart);
    assert.ok(calendar.calls[0].args.rangeEnd > calendar.calls[0].args.rangeStart);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI scoped turns include only model-selected tool results", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  const fetchedUrls = [];

  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          toolCalls: [{ tool: "threat.searchAlerts", args: { query: "ransomware", limit: 4 } }],
        });
      }
      if (options.phase === "tool_planner") return JSON.stringify({ toolCalls: [] });
      throw new Error(`Unexpected model phase ${options.phase}`);
    };
    global.fetch = async (url) => {
      fetchedUrls.push(String(url));
      return new Response(JSON.stringify({ alerts: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "u1", username: "alice" },
      access: { permissionSet: new Set(["threat.view", "calendar.view", "wiki.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/threat",
    }, [{ role: "user", content: "Summarise my current threat alerts about ransomware" }], { path: "/threat" });

    assert.equal(turn.direct, undefined);
    assert.deepEqual(turn.targetedContext.calls.map((call) => call.tool), ["threat.searchAlerts"]);
    assert.equal(fetchedUrls.length, 1);
    assert.ok(fetchedUrls[0].includes("/api/threat/alerts"));
    assert.equal(turn.scopedContext.text.includes("Scoped calendar snapshot"), false);
    assert.equal(turn.scopedContext.text.includes("Scoped Wiki search snapshot"), false);
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
  }
});

test("RedSecAI calendar tool summarizes meeting times for the model", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      assert.ok(String(url).includes("/api/calendar/bootstrap"));
      return new Response(JSON.stringify({
        scheduleView: "week",
        scheduleLabel: "4 May to 10 May",
        weekStart: 1777899600,
        weekEnd: 1778504399,
        selectedUser: { id: "u1", username: "0xP1ckl3d" },
        availableUsers: [{ id: "u1", username: "0xP1ckl3d" }],
        projects: [{ id: "p1", name: "Internal Ops" }],
        scheduleEntries: [{
          id: "e1",
          title: "Team Meeting",
          type: "meeting",
          status: "scheduled",
          plannedStatus: "scheduled",
          startsAt: Math.floor(Date.UTC(2026, 4, 7, 1, 0, 0) / 1000),
          endsAt: Math.floor(Date.UTC(2026, 4, 7, 1, 30, 0) / 1000),
          allDay: false,
          assigneeUserId: "u1",
          projectId: "p1",
          scheduledHours: 0.5,
        }],
        overviewStats: { summary: { scheduledHours: 0.5 } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await executeRedSecAiTool({
      access: { permissionSet: new Set(["calendar.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, "calendar.bootstrap", { viewMode: "week", timeZone: "Australia/Sydney" });

    assert.equal(result.ok, true);
    assert.equal(result.data.entryCount, 1);
    assert.equal(result.data.scheduleEntries[0].title, "Team Meeting");
    assert.equal(result.data.scheduleEntries[0].assigneeUsername, "0xP1ckl3d");
    assert.equal(result.data.scheduleEntries[0].projectName, "Internal Ops");
    assert.equal(result.data.timeZone, "Australia/Sydney");
    assert.match(result.data.scheduleEntries[0].timeLabel, /to/);
    assert.match(result.data.scheduleEntries[0].timeLabel, /11:00\s*am/i);
    assert.match(result.data.scheduleEntries[0].timeLabel, /2026|May/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("RedSecAI provider config uses safe local defaults", () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalSettings = {
    redsecai_enabled: getSetting("redsecai_enabled"),
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
    redsecai_timeout_ms: getSetting("redsecai_timeout_ms"),
    redsecai_num_ctx: getSetting("redsecai_num_ctx"),
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
    setSetting("redsecai_num_ctx", "2048");
    setSetting("redsecai_autostart", "true");
    setSetting("redsecai_auto_pull", "true");
    const config = getConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.baseUrl, "http://127.0.0.1:11434");
    assert.equal(config.model, "qwen3.5:4b");
    assert.equal(config.timeoutMs, 120000);
    assert.equal(config.numCtx, 2048);
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

test("RedSecAI reports cloud models as unavailable until Ollama exposes them", async () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalFetch = global.fetch;
  const originalSettings = {
    redsecai_enabled: getSetting("redsecai_enabled"),
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
    redsecai_auto_pull: getSetting("redsecai_auto_pull"),
  };
  const originalBaseUrl = process.env.REDSECAI_BASE_URL;
  const originalModel = process.env.REDSECAI_MODEL;

  try {
    process.env.REDSECAI_BASE_URL = "http://redsecai:11434";
    process.env.REDSECAI_MODEL = "qwen3.5:4b";
    setSetting("redsecai_enabled", "true");
    setSetting("redsecai_base_url", "http://redsecai:11434");
    setSetting("redsecai_model", "kimi-k2.5:cloud");
    setSetting("redsecai_auto_pull", "true");
    global.fetch = async (url) => {
      assert.ok(String(url).endsWith("/api/tags"));
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    };

    const config = getConfig();
    const health = await checkModelHealth();
    assert.equal(isCloudModel("kimi-k2.5:cloud"), true);
    assert.equal(isCloudModel("gemma4:31b-cloud"), true);
    assert.equal(isCloudModel("qwen3.5:4b"), false);
    assert.equal(config.model, "kimi-k2.5:cloud");
    assert.equal(config.cloudModel, true);
    assert.equal(health.ok, false);
    assert.equal(health.cloudModel, true);
    assert.equal(health.installing, false);
    assert.match(health.error, /Cloud model is not available/);
  } finally {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.REDSECAI_BASE_URL;
    else process.env.REDSECAI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.REDSECAI_MODEL;
    else process.env.REDSECAI_MODEL = originalModel;
    for (const [key, value] of Object.entries(originalSettings)) {
      setSetting(key, value || "");
    }
  }
});

test("RedSecAI reports cloud models ready when Ollama lists them", async () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalFetch = global.fetch;
  const originalSettings = {
    redsecai_enabled: getSetting("redsecai_enabled"),
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
  };
  const originalBaseUrl = process.env.REDSECAI_BASE_URL;
  const originalModel = process.env.REDSECAI_MODEL;

  try {
    process.env.REDSECAI_BASE_URL = "http://redsecai:11434";
    process.env.REDSECAI_MODEL = "qwen3.5:4b";
    setSetting("redsecai_enabled", "true");
    setSetting("redsecai_base_url", "http://redsecai:11434");
    setSetting("redsecai_model", "kimi-k2.5:cloud");
    global.fetch = async (url) => {
      assert.ok(String(url).endsWith("/api/tags"));
      return new Response(JSON.stringify({ models: [{ name: "kimi-k2.5:cloud" }] }), { status: 200 });
    };

    const health = await checkModelHealth();
    assert.equal(health.ok, true);
    assert.equal(health.cloudModel, true);
    assert.equal(health.error, null);
  } finally {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.REDSECAI_BASE_URL;
    else process.env.REDSECAI_BASE_URL = originalBaseUrl;
    if (originalModel === undefined) delete process.env.REDSECAI_MODEL;
    else process.env.REDSECAI_MODEL = originalModel;
    for (const [key, value] of Object.entries(originalSettings)) {
      setSetting(key, value || "");
    }
  }
});

test("RedSecAI diagnostics returns configured endpoint and isolated probe results", async () => {
  const { getSetting, setSetting } = require("../server/database");
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.REDSECAI_BASE_URL;
  const originalModel = process.env.REDSECAI_MODEL;
  const originalSettings = {
    redsecai_base_url: getSetting("redsecai_base_url"),
    redsecai_model: getSetting("redsecai_model"),
  };
  process.env.REDSECAI_BASE_URL = "http://redsecai:11434";
  process.env.REDSECAI_MODEL = "qwen3.5:4b";
  setSetting("redsecai_base_url", "http://redsecai:11434");
  setSetting("redsecai_model", "qwen3.5:4b");
  global.fetch = async (url) => {
    if (String(url).endsWith("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen3.5:4b" }] }), { status: 200 });
    }
    if (String(url).endsWith("/api/generate")) {
      return new Response(JSON.stringify({ response: "pong", done: true }), { status: 200 });
    }
    if (String(url).endsWith("/api/chat")) {
      return new Response(JSON.stringify({ message: { content: "pong" }, done: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const diagnostics = await runDiagnostics(5000);
    assert.equal(diagnostics.config.baseUrl, "http://redsecai:11434");
    assert.equal(diagnostics.health.ok, true);
    assert.equal(diagnostics.probes.generate.ok, true);
    assert.equal(diagnostics.probes.chat.ok, true);
  } finally {
    global.fetch = originalFetch;
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
      { name: "calendar.entry.create" },
    ],
  };
  const calls = sanitizeModelToolCalls({
    toolCalls: [
      { tool: "threat.searchAlerts", args: { query: "CVE-2026-12345", limit: 99, badKey: { nested: true } } },
      { tool: "calendar.entry.create", args: { body: { title: "Standup", startsAt: 1770000000, assigneeUserIds: ["u1", "u2"] } } },
      { tool: "vault.entries", args: {} },
      { tool: "admin.users", args: {} },
      { tool: "wiki.search", args: { query: "a".repeat(1500) } },
    ],
  }, scopedContext);

  assert.deepEqual(calls.map((call) => call.tool), ["threat.searchAlerts", "calendar.entry.create", "wiki.search"]);
  assert.equal(calls[0].args.query, "CVE-2026-12345");
  assert.equal(calls[0].args.limit, 99);
  assert.equal(calls[0].args.badKey, undefined);
  assert.equal(calls[1].args.body.title, "Standup");
  assert.deepEqual(calls[1].args.body.assigneeUserIds, ["u1", "u2"]);
  assert.equal(calls[2].args.query.length, 1000);
});

test("RedSecAI mutating tools create confirmation-gated pending actions", async () => {
  const { createPendingAction, listPendingActionsForUser } = require("../server/modules/redsecai/actions");
  const action = createPendingAction({ id: "user-a", username: "alice" }, {
    tool: "wiki.page.create",
    args: { body: { scope: "personal", title: "AI Draft", bodyMarkdown: "draft" } },
  }, "test");
  assert.equal(action.tool, "wiki.page.create");
  assert.equal(action.summary, 'Create personal wiki page "AI Draft"');
  assert.ok(listPendingActionsForUser("user-a").some((item) => item.id === action.id));
  assert.equal(listPendingActionsForUser("user-b").some((item) => item.id === action.id), false);
});
