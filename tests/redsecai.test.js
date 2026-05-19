const test = require("node:test");
const assert = require("node:assert/strict");

const { compactJson, executeRedSecAiTool, hasAny } = require("../server/modules/redsecai/context");
const { checkModelHealth, classifyEndpoint, getConfig, isCloudModel, runDiagnostics } = require("../server/modules/redsecai/provider");
const { extractJsonObject, guardRedSecAiFinalResponse, sanitizeModelToolCalls } = require("../server/modules/redsecai/orchestrator");

async function withMockedDate(isoString, fn) {
  const RealDate = global.Date;
  const fixedMs = RealDate.parse(isoString);
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length) return new RealDate(...args);
      return new RealDate(fixedMs);
    }

    static now() {
      return fixedMs;
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }
  global.Date = MockDate;
  try {
    return await fn();
  } finally {
    global.Date = RealDate;
  }
}

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
  assert.equal(TOOL_ALLOWLIST["engage.dashboard.summary"].capability, "engage.read");
  assert.equal(TOOL_ALLOWLIST["engage.engagement.update_status"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["wiki.bootstrap"].capability, "wiki.read");
  assert.equal(TOOL_ALLOWLIST["wiki.page.get"].capability, "wiki.read");
  assert.equal(TOOL_ALLOWLIST["wiki.page.create"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["vault.entries"], undefined);
  assert.ok(Object.keys(TOOL_ALLOWLIST).every((name) => !/^(vault|paste|share|chat)\./.test(name)));
});

test("Every RedSecAI allowlisted tool has a strict input schema", () => {
  const {
    getRedSecAiSchemaValidationError,
    TOOL_ALLOWLIST,
    TOOL_INPUT_SCHEMAS,
  } = require("../server/modules/redsecai/context");
  const sampleForSchema = (schema) => {
    if (!schema) return {};
    if (schema.enum) return schema.enum[0];
    if (schema.type === "string") return "value";
    if (schema.type === "integer") return 1;
    if (schema.type === "number") return 1;
    if (schema.type === "boolean") return true;
    if (schema.type === "array") return [];
    if (schema.type === "object") {
      const output = {};
      for (const key of schema.required || []) {
        output[key] = sampleForSchema(schema.properties?.[key] || { type: "string" });
      }
      return output;
    }
    return {};
  };

  for (const toolName of Object.keys(TOOL_ALLOWLIST)) {
    assert.ok(TOOL_INPUT_SCHEMAS[toolName], `${toolName} is missing an input schema`);
    const validArgs = sampleForSchema(TOOL_INPUT_SCHEMAS[toolName]);
    assert.equal(getRedSecAiSchemaValidationError(toolName, validArgs), null, `${toolName} valid args should pass schema`);
    assert.match(
      getRedSecAiSchemaValidationError(toolName, { ...validArgs, madeUpField: "nope" }),
      /not a valid field/,
      `${toolName} should reject unknown top-level fields`
    );
  }
});

test("Every RedSecAI allowlisted tool has governance metadata and excludes encrypted products", () => {
  const {
    getRedSecAiToolGovernanceMatrix,
    getRedSecAiToolManifest,
    TOOL_ALLOWLIST,
  } = require("../server/modules/redsecai/context");
  const { findEncryptedRedSecAiTools } = require("../server/modules/redsecai/governance");
  const matrix = getRedSecAiToolGovernanceMatrix();
  assert.deepEqual(findEncryptedRedSecAiTools(TOOL_ALLOWLIST), []);

  for (const [name, tool] of Object.entries(TOOL_ALLOWLIST)) {
    assert.ok(matrix[name], `${name} missing governance`);
    assert.ok(matrix[name].domain, `${name} missing domain`);
    assert.ok(matrix[name].dataClass, `${name} missing data class`);
    assert.equal(matrix[name].confirmRequired, !!tool.confirmRequired, `${name} confirmation mismatch`);
    if (tool.confirmRequired) assert.match(matrix[name].riskLevel, /^(medium|high)$/);
  }

  const manifest = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["wiki.view", "wiki.edit_team"]),
  }, ["wiki.page.update"]);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].governance.confirmRequired, true);
  assert.equal(manifest[0].governance.domain, "wiki");
});

test("RedSecAI endpoint classifier distinguishes local, internal, external, and cloud modes", () => {
  assert.equal(classifyEndpoint("http://127.0.0.1:11434", "qwen3.5:4b").processingMode, "local-ollama-local-model");
  assert.equal(classifyEndpoint("http://redsecai:11434", "gemma4:31b-cloud").processingMode, "internal-ollama-cloud-model");
  assert.equal(classifyEndpoint("https://ai.example.com", "qwen3.5:4b").processingMode, "external-ollama-endpoint");
  const cloud = classifyEndpoint("http://redsecai:11434", "kimi-k2.5:cloud");
  assert.equal(cloud.endpointRisk, "elevated");
  assert.ok(cloud.endpointWarnings.some((warning) => warning.includes("Cloud models")));
});

test("RedSecAI WebSocket origin checks allow same-origin/trusted and reject cross-site origins", () => {
  const { isAllowedWebSocketOrigin } = require("../server/core/security/ws-origin");
  assert.equal(isAllowedWebSocketOrigin({
    headers: { origin: "https://tools.example.com", host: "tools.example.com" },
  }), true);
  assert.equal(isAllowedWebSocketOrigin({
    headers: { origin: "https://tools.example.com", host: "internal:3000", "x-forwarded-host": "tools.example.com" },
  }), true);
  assert.equal(isAllowedWebSocketOrigin({
    headers: { origin: "https://trusted.example.com", host: "tools.example.com" },
  }, { trustedOrigins: ["https://trusted.example.com"] }), true);
  assert.equal(isAllowedWebSocketOrigin({
    headers: { origin: "https://evil.example.com", host: "tools.example.com" },
  }, { trustedOrigins: ["https://trusted.example.com"] }), false);
});

test("CSP keeps RedSecAI WebSocket same-origin instead of allowing arbitrary ws origins", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../server/index.js"), "utf8");
  const connectSrcLine = source.split(/\r?\n/).find((line) => line.includes("connectSrc"));
  assert.ok(connectSrcLine.includes("\"'self'\""));
  assert.equal(connectSrcLine.includes("\"ws:\""), false);
  assert.equal(connectSrcLine.includes("\"wss:\""), false);
});

test("RedSecAI keeps /ai as the canonical page without stale /ai/about links", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(root, "public/ai/about.html")), false);
  const files = [
    "server/index.js",
    "public/js/redsecai.js",
    "public/js/burger-menu.js",
    "README.md",
    "docs/api/README.md",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(source.includes("/ai/about"), false, `${file} should not link to stale /ai/about`);
  }
  const aiScript = fs.readFileSync(path.join(root, "public/js/redsecai.js"), "utf8");
  assert.ok(aiScript.includes("/ai?view=about"), "RedSecAI widget should link to the canonical AI page about view");
});

test("RedSecAI pending actions use configurable expiry, shorten high-impact actions, and stay user-scoped", () => {
  const {
    cancelPendingAction,
    createPendingAction,
    getRedSecAiActionTtlMs,
    listPendingActionsForUser,
  } = require("../server/modules/redsecai/actions");

  const normalTtl = getRedSecAiActionTtlMs("wiki.page.update");
  const highRiskTtl = getRedSecAiActionTtlMs("reporter.project.delete");
  assert.ok(normalTtl >= 5 * 60 * 1000);
  assert.ok(highRiskTtl <= 30 * 60 * 1000);
  assert.ok(highRiskTtl <= normalTtl);

  const action = createPendingAction({ id: "scope-user-a", username: "alice" }, {
    tool: "wiki.page.update",
    args: { pathParams: { id: "page-123" }, body: { title: "Updated" } },
  });
  assert.ok(listPendingActionsForUser("scope-user-a").some((item) => item.id === action.id));
  assert.equal(listPendingActionsForUser("scope-user-b").some((item) => item.id === action.id), false);
  assert.throws(
    () => cancelPendingAction({ user: { id: "scope-user-b" } }, action.id),
    /not found or expired/
  );
  cancelPendingAction({ user: { id: "scope-user-a" } }, action.id);
});

test("RedSecAI expired pending actions are not returned after refresh/resume", () => {
  const {
    createPendingAction,
    listPendingActionsForUser,
  } = require("../server/modules/redsecai/actions");
  const realNow = Date.now;
  try {
    Date.now = () => realNow() - (3 * 60 * 60 * 1000);
    const action = createPendingAction({ id: "expired-user", username: "alice" }, {
      tool: "wiki.page.update",
      args: { pathParams: { id: "page-expired" }, body: { title: "Expired" } },
    });
    Date.now = realNow;
    assert.equal(listPendingActionsForUser("expired-user").some((item) => item.id === action.id), false);
  } finally {
    Date.now = realNow;
  }
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

test("RedSecAI exposes Engage tools with engagement governance and confirmation requirements", () => {
  const { getRedSecAiToolManifest, getRedSecAiToolGovernanceMatrix } = require("../server/modules/redsecai/context");
  const manifest = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["engage.view_team", "engage.edit_engagement", "engage.manage_qa"]),
  });
  const names = new Set(manifest.map((tool) => tool.name));
  assert.ok(names.has("engage.dashboard.summary"));
  assert.ok(names.has("engage.engagement.update_status"));
  assert.ok(names.has("engage.qa.assign"));
  assert.equal(manifest.find((tool) => tool.name === "engage.engagement.update_status").confirmRequired, true);
  assert.equal(getRedSecAiToolGovernanceMatrix()["engage.dashboard.summary"].dataClass, "engagement_operations");
});

test("RedSecAI exposes broad non-encrypted tool coverage without encrypted product tools", () => {
  const { getRedSecAiToolManifest } = require("../server/modules/redsecai/context");
  const manifest = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set([
      "bulletin.view",
      "bulletin.create",
      "calendar.view",
      "calendar.create",
      "calendar.view_team",
      "calendar.manage",
      "survey.create",
      "survey.manage_any",
      "survey.view_results_any",
      "threat.view",
      "wiki.view",
      "wiki.create_team",
      "wiki.edit_team",
      "reporter.view",
      "reporter.create",
      "reporter.edit_own",
      "reporter.edit_assigned",
      "reporter.manage_templates",
      "reporter.manage_all",
      "engage.view_team",
      "engage.edit_engagement",
      "engage.manage_qa",
    ]),
  });
  const names = new Set(manifest.map((tool) => tool.name));
  for (const expected of [
    "users.search",
    "calendar.project.search",
    "calendar.entry.search",
    "homepage.bulletin.create",
    "wiki.page.restore",
    "threat.keyword.create",
    "reporter.finding.create",
    "reporter.member.add",
    "engage.dashboard.summary",
    "engage.engagement.update_status",
    "engage.qa.assign",
    "survey.create",
  ]) {
    assert.ok(names.has(expected), `${expected} should be available`);
  }
  assert.ok([...names].every((name) => !/^(vault|paste|share|chat)\./.test(name)));
});

test("RedSecAI resolver tools return backend-provided IDs instead of guessed aliases", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/api/calendar/bootstrap")) {
        return new Response(JSON.stringify({
          currentUserId: "u1",
          capabilities: { canAssignOthers: true },
          availableUsers: [
            { id: "u1", username: "0xP1ckl3d", roleName: "Lead" },
            { id: "u2", username: "analyst", roleName: "Member" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (text.includes("/api/calendar/projects")) {
        return new Response(JSON.stringify({
          projects: [
            { id: "p1", name: "CV web app test", clientName: "CV", status: "active" },
            { id: "p2", name: "Internal Ops", clientName: "RedSec", status: "active" },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected URL ${text}`);
    };

    const req = {
      user: { id: "u1", username: "0xP1ckl3d" },
      access: {
        userId: "u1",
        permissionSet: new Set(["calendar.view", "calendar.view_team", "calendar.manage"]),
      },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    };
    const users = await executeRedSecAiTool(req, "users.search", { query: "everyone", domain: "calendar" });
    assert.equal(users.ok, true);
    assert.deepEqual(users.data.users.find((user) => user.id === "__all__").assignmentValues.assigneeUserIds, ["__all__"]);

    const projects = await executeRedSecAiTool(req, "calendar.project.search", { query: "CV web app", limit: 5 });
    assert.equal(projects.ok, true);
    assert.equal(projects.data.projects[0].id, "p1");
  } finally {
    global.fetch = originalFetch;
  }
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
      assert.ok(joined.includes("TOOL_CATALOG"));
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
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI recovers fuzzy wiki lookup through catalog discovery", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      assert.equal(options.phase, "tool_router");
      const joined = messages.map((message) => message.content).join("\n");
      assert.ok(joined.includes("TOOL_CATALOG"));
      assert.ok(!joined.includes("inputSchema"));
      return JSON.stringify({ useTools: false, toolCalls: [] });
    };
    const routed = await orchestrator.routeModelToolUse({
      access: { permissionSet: new Set(["wiki.view", "wiki.edit_team"]) },
    }, [{
      role: "user",
      content: "There is a wiki page about web app pentests, not the exact name, find it and finish it as its unfinished",
    }]);

    assert.equal(routed.useTools, true);
    assert.deepEqual(routed.calls.map((call) => call.tool), ["wiki.search"]);
    assert.ok(routed.candidateToolNames.includes("wiki.page.update"));
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI deepens empty wiki search before drafting a page update", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  const fetchedUrls = [];
  const statuses = [];
  let plannerCalls = 0;

  try {
    provider.chat = async (messages, options = {}) => {
      const joined = messages.map((message) => message.content).join("\n");
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          toolCalls: [{ tool: "wiki.search", args: { query: "web app pentests unfinished" } }],
        });
      }
      if (options.phase === "tool_planner") {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          assert.ok(joined.includes("wiki.bootstrap"));
          assert.ok(joined.includes("Web Application Pentest Notes"));
          return JSON.stringify({
            toolCalls: [{ tool: "wiki.page.get", args: { pathParams: { id: "p1" } } }],
          });
        }
        assert.ok(joined.includes("MODEL_REQUESTED_TOOL_RESULTS"));
        assert.ok(joined.includes("TODO: finish exploitation notes"));
        return JSON.stringify({
          toolCalls: [{
            tool: "wiki.page.update",
            args: {
              pathParams: { id: "p1" },
              body: {
                title: "Web Application Pentest Notes",
                bodyMarkdown: "# Web Application Pentest Notes\n\nCompleted exploitation notes.",
              },
            },
          }],
        });
      }
      throw new Error(`Unexpected model phase ${options.phase}`);
    };

    global.fetch = async (url) => {
      const text = String(url);
      fetchedUrls.push(text);
      if (text.includes("/api/wiki/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (text.includes("/api/wiki/bootstrap")) {
        return new Response(JSON.stringify({
          currentUserId: "u1",
          currentUsername: "alice",
          capabilities: { canUseWiki: true, canEditTeam: true },
          teamPages: [{
            id: "p1",
            title: "Web Application Pentest Notes",
            slug: "web-application-pentest-notes",
            scope: "team",
            excerpt: "TODO: finish exploitation notes",
            updatedAt: 1778100000,
          }],
          personalPages: [],
          recentPages: [{
            id: "p1",
            title: "Web Application Pentest Notes",
            slug: "web-application-pentest-notes",
            scope: "team",
            excerpt: "TODO: finish exploitation notes",
            updatedAt: 1778100000,
          }],
          selectedPage: null,
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (text.includes("/api/wiki/pages/p1")) {
        return new Response(JSON.stringify({
          page: {
            id: "p1",
            title: "Web Application Pentest Notes",
            slug: "web-application-pentest-notes",
            scope: "team",
            bodyMarkdown: "# Web Application Pentest Notes\n\nTODO: finish exploitation notes",
            excerpt: "TODO: finish exploitation notes",
            updatedAt: 1778100000,
          },
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected url" }), { status: 404, headers: { "content-type": "application/json" } });
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "u1", username: "alice" },
      access: { permissionSet: new Set(["wiki.view", "wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/wiki",
    }, [{
      role: "user",
      content: "There is a wiki page about web apps, that is not the exact name, find it and finish it as its unfinished",
    }], { path: "/wiki" }, {
      onStatus: (status) => statuses.push(status.label),
    });

    assert.deepEqual(turn.targetedContext.calls.map((call) => call.tool), ["wiki.search", "wiki.bootstrap"]);
    assert.deepEqual(turn.modelToolContext.calls.map((call) => call.tool), ["wiki.page.get", "wiki.page.update"]);
    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].tool, "wiki.page.update");
    assert.equal(plannerCalls, 2);
    assert.ok(fetchedUrls.some((url) => url.includes("/api/wiki/search")));
    assert.ok(fetchedUrls.some((url) => url.includes("/api/wiki/bootstrap")));
    assert.ok(fetchedUrls.some((url) => url.includes("/api/wiki/pages/p1")));
    assert.ok(statuses.includes("Searching the wiki for matching pages"));
    assert.ok(statuses.includes("Checking visible wiki pages"));
    assert.ok(statuses.includes("Reading the wiki page content"));
    assert.ok(statuses.includes("Drafting a wiki page update"));
    assert.equal(statuses.includes("Checking whether another selected tool is needed"), false);
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
  }
});

test("RedSecAI action review converts read context into the requested wiki update", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  const statuses = [];
  let plannerCalls = 0;

  try {
    provider.chat = async (messages, options = {}) => {
      const joined = messages.map((message) => message.content).join("\n");
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          toolCalls: [{ tool: "wiki.search", args: { query: "Web App Checklist" } }],
        });
      }
      if (options.phase === "tool_planner") {
        plannerCalls += 1;
        if (plannerCalls === 1) {
          return JSON.stringify({
            toolCalls: [{ tool: "wiki.page.get", args: { pathParams: { id: "page-1" } } }],
          });
        }
        if (plannerCalls === 2) return JSON.stringify({ toolCalls: [] });
        assert.ok(joined.includes("Action-review mode"));
        assert.ok(joined.includes("The pending action card is the confirmation step"));
        return JSON.stringify({
          toolCalls: [{
            tool: "wiki.page.update",
            args: {
              pathParams: { id: "page-1" },
              body: {
                title: "Web App Checklist",
                bodyMarkdown: "# Web App Checklist\n\nCompleted checklist.",
              },
            },
          }],
        });
      }
      throw new Error(`Unexpected model phase ${options.phase}`);
    };

    global.fetch = async (url) => {
      const text = String(url);
      if (text.includes("/api/wiki/search")) {
        return new Response(JSON.stringify({
          results: [{
            id: "page-1",
            title: "Web App Checklist",
            slug: "web-app-checklist",
            scope: "team",
            excerpt: "Business Logic Vulnerabilities TODO",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (text.includes("/api/wiki/pages/page-1")) {
        return new Response(JSON.stringify({
          page: {
            id: "page-1",
            title: "Web App Checklist",
            slug: "web-app-checklist",
            scope: "team",
            bodyMarkdown: "# Web App Checklist\n\nBusiness Logic Vulnerabilities\n\nTODO",
            excerpt: "Business Logic Vulnerabilities TODO",
          },
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected url" }), { status: 404, headers: { "content-type": "application/json" } });
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "u1", username: "alice" },
      access: { permissionSet: new Set(["wiki.view", "wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/wiki",
    }, [{
      role: "user",
      content: "ffs its called Web App Checklist, update it",
    }], { path: "/wiki" }, {
      onStatus: (status) => statuses.push(status.label),
    });

    assert.equal(plannerCalls, 3);
    assert.deepEqual(turn.modelToolContext.calls.map((call) => call.tool), ["wiki.page.get", "wiki.page.update"]);
    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].args.pathParams.id, "page-1");
    assert.ok(statuses.includes("Resolving the requested wiki update"));
    assert.ok(statuses.includes("Drafting a wiki page update"));
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
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

test("RedSecAI calendar range normalization does not leak non-schema weekStart args", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          toolCalls: [{ tool: "calendar.bootstrap", args: { rangeIntent: "this_week" } }],
        });
      }
      if (options.phase === "tool_planner") return JSON.stringify({ toolCalls: [] });
      return "";
    };
    global.fetch = async (url) => {
      const text = String(url);
      assert.ok(text.includes("/api/calendar/bootstrap"));
      assert.equal(text.includes("weekStart="), false);
      assert.ok(text.includes("rangeStart="));
      assert.ok(text.includes("rangeEnd="));
      return new Response(JSON.stringify({
        scheduleView: "week",
        weekStart: 1777899600,
        weekEnd: 1778504399,
        selectedUser: { id: "u1", username: "alice" },
        availableUsers: [{ id: "u1", username: "alice" }],
        scheduleEntries: [],
        projects: [],
        overviewStats: {},
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "u1", username: "alice" },
      access: { permissionSet: new Set(["calendar.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "What have I got on this week?" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });
    assert.equal(turn.targetedContext.results[0].ok, true);
  } finally {
    provider.chat = originalChat;
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

test("RedSecAI final response only mentions action cards when one exists", () => {
  const unsafe = guardRedSecAiFinalResponse("Please confirm the action in the card to apply these changes.", {
    pendingActions: [],
    targetedContext: { results: [] },
    modelToolContext: { results: [] },
  });
  assert.ok(!/confirm.*card/i.test(unsafe));
  assert.match(unsafe, /No RedSecAI action is currently pending/i);

  const safe = guardRedSecAiFinalResponse("Please confirm the action in the card.", {
    pendingActions: [{ id: "a1", summary: "Update wiki page p1", tool: "wiki.page.update" }],
    targetedContext: { results: [] },
    modelToolContext: { results: [] },
  });
  assert.match(safe, /Update wiki page p1/);
  assert.match(safe, /Confirm the action card/i);
});

test("RedSecAI sanitizes model-planned tools against manifest and encrypted scopes", () => {
  const scopedContext = {
    toolManifest: [
      { name: "threat.searchAlerts" },
      { name: "wiki.search" },
      { name: "wiki.page.update" },
      { name: "calendar.entry.create" },
    ],
  };
  const longWikiBody = "# Web App Checklist\n\n" + "A".repeat(2500);
  const calls = sanitizeModelToolCalls({
    toolCalls: [
      { tool: "threat.searchAlerts", args: { query: "CVE-2026-12345", limit: 99, badKey: { nested: true } } },
      { tool: "calendar.entry.create", args: { body: { title: "Standup", startsAt: 1770000000, assigneeUserIds: ["u1", "u2"] } } },
      { tool: "vault.entries", args: {} },
      { tool: "admin.users", args: {} },
      { tool: "wiki.search", args: { query: "a".repeat(1500) } },
      { tool: "wiki.page.update", args: { pathParams: { id: "p1" }, body: { bodyMarkdown: longWikiBody } } },
    ],
  }, scopedContext);

  assert.deepEqual(calls.map((call) => call.tool), ["threat.searchAlerts", "calendar.entry.create", "wiki.search", "wiki.page.update"]);
  assert.equal(calls[0].args.query, "CVE-2026-12345");
  assert.equal(calls[0].args.limit, 99);
  assert.equal(calls[0].args.badKey, undefined);
  assert.equal(calls[1].args.body.title, "Standup");
  assert.deepEqual(calls[1].args.body.assigneeUserIds, ["u1", "u2"]);
  assert.equal(calls[2].args.query.length, 1000);
  assert.equal(calls[3].args.body.bodyMarkdown, longWikiBody);
});

test("RedSecAI sanitizer preserves long narrative body fields across write tools", () => {
  const longText = "Long narrative ".repeat(180);
  const scopedContext = {
    toolManifest: [
      { name: "calendar.entry.create" },
      { name: "calendar.project.create" },
      { name: "reporter.note.create" },
      { name: "wiki.page.update" },
    ],
  };
  const calls = sanitizeModelToolCalls({
    toolCalls: [
      {
        tool: "calendar.entry.create",
        args: { body: { title: "Brief title ".repeat(120), description: longText } },
      },
      {
        tool: "calendar.project.create",
        args: { body: { name: "Project ".repeat(180), notes: longText, description: longText } },
      },
      {
        tool: "reporter.note.create",
        args: { pathParams: { projectId: "rp1" }, body: { title: "Note", content: longText } },
      },
      {
        tool: "wiki.page.update",
        args: { pathParams: { id: "w1" }, body: { bodyMarkdown: longText } },
      },
    ],
  }, scopedContext);

  assert.equal(calls[0].args.body.title.length, 1000);
  assert.equal(calls[0].args.body.description, longText);
  assert.equal(calls[1].args.body.name.length, 1000);
  assert.equal(calls[1].args.body.notes, longText);
  assert.equal(calls[1].args.body.description, longText);
  assert.equal(calls[2].args.body.content, longText);
  assert.equal(calls[3].args.body.bodyMarkdown, longText);
});

test("RedSecAI write schemas expose local time helper fields where the app needs dates", () => {
  const { TOOL_INPUT_SCHEMAS } = require("../server/modules/redsecai/context");
  const schemaBody = (toolName) => TOOL_INPUT_SCHEMAS[toolName]?.properties?.body?.properties || {};

  assert.ok(schemaBody("calendar.entry.create").dateIntent);
  assert.ok(schemaBody("calendar.entry.create").startLocal);
  assert.ok(schemaBody("calendar.entry.create").durationMinutes);
  assert.ok(schemaBody("calendar.allocation.create").dateIntent);
  assert.ok(schemaBody("calendar.allocation.create").startLocal);
  assert.ok(schemaBody("homepage.bulletin.create").message);
  assert.ok(schemaBody("homepage.bulletin.create").expiresAt);
  assert.ok(schemaBody("homepage.bulletin.create").tone);
  assert.ok(schemaBody("survey.create").startDate);
  assert.ok(schemaBody("survey.create").expiresAt);
  assert.ok(schemaBody("reporter.project.create").dueDateIntent);
  assert.ok(schemaBody("reporter.project.create").dueDateLocal);
});

test("RedSecAI compiles selected write intent into a bulletin action instead of falling through", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["homepage.bulletin.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({ toolCalls: [] });
      }
      if (options.phase === "tool_action_compiler") {
        const joined = messages.map((message) => message.content).join("\n");
        assert.ok(joined.includes("WRITE_TOOL_MANIFEST"));
        assert.ok(joined.includes("homepage.bulletin.create"));
        return JSON.stringify({
          toolCalls: [{
            tool: "homepage.bulletin.create",
            args: {
              body: {
                title: "Happy Friday",
                message: "Happy Friday",
                tone: "red",
                expiresAt: "midnight tonight",
                timeZone: "Australia/Sydney",
              },
            },
          }],
          missingInfo: "",
        });
      }
      return "";
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "bulletin-user", username: "alice" },
      access: { userId: "bulletin-user", permissionSet: new Set(["bulletin.create", "bulletin.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/",
    }, [{ role: "user", content: 'Create a bulletin to Say "Happy Friday". Make it Red, and it expires at Midnight tonight' }], {
      path: "/",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].tool, "homepage.bulletin.create");
    const body = turn.pendingActions[0].args.body;
    assert.equal(body.title, "Happy Friday");
    assert.equal(body.bodyHtml, "<p>Happy Friday</p>");
    assert.equal(body.bodySource, "Happy Friday");
    assert.equal(body.stylePreset, "alert");
    assert.equal(Number.isFinite(body.endsAt), true);
    assert.equal(body.message, undefined);
    assert.equal(body.expiresAt, undefined);
    assert.equal(body.timeZone, undefined);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI recovers homepage shortcut write intent and prepares a shortcut action", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({ useTools: false, intent: "read", toolCalls: [] });
      }
      if (options.phase === "tool_planner") return JSON.stringify({ toolCalls: [] });
      if (options.phase === "tool_action_compiler") {
        const joined = messages.map((message) => message.content).join("\n");
        assert.ok(joined.includes("homepage.shortcut.create"));
        return JSON.stringify({
          toolCalls: [{
            tool: "homepage.shortcut.create",
            args: {
              body: {
                title: "Admin Panel",
                url: "http://localhost:3000/admin",
              },
            },
          }],
          missingInfo: "",
        });
      }
      return "";
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "shortcut-user", username: "alice" },
      access: { userId: "shortcut-user", permissionSet: new Set() },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/",
    }, [{ role: "user", content: 'Create a new homepage shorctut for "Admin Panel" that links to http://localhost:3000/admin.' }], {
      path: "/",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].tool, "homepage.shortcut.create");
    assert.equal(turn.pendingActions[0].args.body.title, "Admin Panel");
    assert.equal(turn.pendingActions[0].args.body.url, "http://localhost:3000/admin");
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI validates shortcut action payloads before creating cards", () => {
  const { getRedSecAiActionValidationError } = require("../server/modules/redsecai/context");

  assert.equal(getRedSecAiActionValidationError("homepage.shortcut.create", {
    body: { title: "Admin Panel", url: "http://localhost:3000/admin" },
  }), null);
  assert.match(getRedSecAiActionValidationError("homepage.shortcut.create", {
    body: { title: "Admin Panel", url: "localhost:3000/admin" },
  }), /must start with/i);
});

test("RedSecAI action compiler falls back to a missing-info question when a write cannot be safely prepared", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["homepage.bulletin.update"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") return JSON.stringify({ toolCalls: [] });
      if (options.phase === "tool_action_compiler") {
        return JSON.stringify({
          toolCalls: [],
          missingInfo: "Which bulletin should I update?",
        });
      }
      return "";
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "bulletin-missing-user", username: "alice" },
      access: { userId: "bulletin-missing-user", permissionSet: new Set(["bulletin.create", "bulletin.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/",
    }, [{ role: "user", content: "Make the bulletin red" }], {
      path: "/",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 0);
    assert.equal(turn.modelToolContext.results.at(-1).missingInfo, true);
    const guarded = orchestrator.guardRedSecAiFinalResponse("Please confirm the action in the card.", turn);
    assert.match(guarded, /Which bulletin should I update/i);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI recovers write intent from recent conversation follow-ups before answering", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({ useTools: false, intent: "read", toolCalls: [] });
      }
      if (options.phase === "tool_planner") return JSON.stringify({ toolCalls: [] });
      if (options.phase === "tool_action_compiler") {
        return JSON.stringify({
          toolCalls: [{
            tool: "homepage.bulletin.create",
            args: {
              body: {
                title: "Happy Friday",
                message: "Happy Friday",
                tone: "red",
                expiresAt: "midnight tonight",
              },
            },
          }],
        });
      }
      throw new Error(`Unexpected model phase ${options.phase}`);
    };

    const turn = await orchestrator.runRedSecAiChat({
      user: { id: "bulletin-followup-user", username: "alice" },
      access: { userId: "bulletin-followup-user", permissionSet: new Set(["bulletin.create", "bulletin.view"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/",
    }, [
      { role: "user", content: 'Create a bulletin to Say "Happy Friday". Make it Red, and it expires at Midnight tonight' },
      { role: "assistant", content: "No RedSecAI action is currently pending for this turn, and nothing has been applied." },
      { role: "user", content: "Yes, obviously do it" },
    ], {
      path: "/",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].tool, "homepage.bulletin.create");
    assert.match(turn.response, /Create bulletin "Happy Friday"/);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI asks for clarification instead of creating projects with reversed date ranges", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          intent: "write",
          selectedTools: ["calendar.project.schedule"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.project.schedule",
            args: {
              body: {
                projectName: "coast entertainment",
                startDate: "2026-05-18",
                endDate: "2026-05-17",
                billableRate: 2500,
              },
            },
          }],
        });
      }
      throw new Error(`Unexpected model phase ${options.phase}`);
    };

    const turn = await orchestrator.runRedSecAiChat({
      user: { id: "project-clarify-user", username: "alice" },
      access: { userId: "project-clarify-user", permissionSet: new Set(["calendar.create", "calendar.manage"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: 'Create a new project called "coast entertainment" it runs from 18-17 May. Assign the time to me at daily rates of 2500' }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 0);
    assert.match(turn.response, /endDate is before startDate|confirm the intended date range/i);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI mutating tools create confirmation-gated pending actions", async () => {
  const { cancelPendingAction, createPendingAction, filterPendingActionsForUser, listPendingActionsForUser } = require("../server/modules/redsecai/actions");
  const action = createPendingAction({ id: "user-a", username: "alice" }, {
    tool: "wiki.page.create",
    args: { body: { scope: "personal", title: "AI Draft", bodyMarkdown: "draft" } },
  }, "test");
  assert.equal(action.tool, "wiki.page.create");
  assert.equal(action.summary, 'Create personal wiki page "AI Draft"');
  assert.ok(listPendingActionsForUser("user-a").some((item) => item.id === action.id));
  assert.equal(listPendingActionsForUser("user-b").some((item) => item.id === action.id), false);
  assert.deepEqual(filterPendingActionsForUser("user-a", [action]).map((item) => item.id), [action.id]);
  const rejected = cancelPendingAction({ user: { id: "user-a", username: "alice" } }, action.id);
  assert.equal(rejected.id, action.id);
  assert.equal(listPendingActionsForUser("user-a").some((item) => item.id === action.id), false);
  assert.deepEqual(filterPendingActionsForUser("user-a", [action]), []);
});

test("RedSecAI confirms pending actions only with canonical path params", async () => {
  const { confirmPendingAction, createPendingAction } = require("../server/modules/redsecai/actions");
  const originalFetch = global.fetch;
  const fetched = [];
  try {
    global.fetch = async (url, init = {}) => {
      fetched.push({ url: String(url), method: init.method });
      if (init.method === "GET") {
        assert.ok(String(url).endsWith("/api/wiki/pages/page-1"));
        return new Response(JSON.stringify({
          page: { id: "page-1", title: "Web App Checklist", slug: "web-app-checklist", bodyMarkdown: "todo" },
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.ok(String(url).endsWith("/api/wiki/pages/page-1"));
      assert.equal(init.method, "PUT");
      const body = JSON.parse(init.body);
      assert.equal(body.title, "Web App Checklist");
      assert.equal(body.bodyMarkdown, "done");
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const action = createPendingAction({ id: "user-path", username: "alice" }, {
      tool: "wiki.page.update",
      args: {
        pathParams: { id: "page-1" },
        body: { title: "Web App Checklist", bodyMarkdown: "done" },
      },
    }, "test");

    assert.equal(action.args.pathParams.id, "page-1");
    const confirmed = await confirmPendingAction({
      user: { id: "user-path", username: "alice" },
      access: { permissionSet: new Set(["wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, action.id);
    assert.equal(confirmed.result.ok, true);
    assert.deepEqual(fetched.map((item) => item.method), ["GET", "PUT"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("RedSecAI pending actions survive module reload before confirmation", async () => {
  const actionsPath = require.resolve("../server/modules/redsecai/actions");
  const originalFetch = global.fetch;
  try {
    let actions = require(actionsPath);
    global.fetch = async (url, init = {}) => {
      if (init.method === "GET") {
        return new Response(JSON.stringify({
          page: { id: "persist-page", title: "Persisted Action", slug: "persisted-action", bodyMarkdown: "before" },
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(init.method, "PUT");
      assert.ok(String(url).endsWith("/api/wiki/pages/persist-page"));
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const action = actions.createPendingAction({ id: "persist-user", username: "alice" }, {
      tool: "wiki.page.update",
      args: {
        pathParams: { id: "persist-page" },
        body: { title: "Persisted Action", bodyMarkdown: "after" },
      },
    }, "test");
    assert.ok(actions.listPendingActionsForUser("persist-user").some((item) => item.id === action.id));

    delete require.cache[actionsPath];
    actions = require(actionsPath);
    assert.ok(actions.listPendingActionsForUser("persist-user").some((item) => item.id === action.id));
    const confirmed = await actions.confirmPendingAction({
      user: { id: "persist-user", username: "alice" },
      access: { permissionSet: new Set(["wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, action.id);
    assert.equal(confirmed.result.ok, true);
    assert.equal(actions.listPendingActionsForUser("persist-user").some((item) => item.id === action.id), false);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[actionsPath];
    require(actionsPath);
  }
});

test("RedSecAI wiki update requires canonical body fields and rejects no-op confirmations", async () => {
  const { confirmPendingAction, createPendingAction } = require("../server/modules/redsecai/actions");
  const originalFetch = global.fetch;
  const fetched = [];
  try {
    global.fetch = async (url, init = {}) => {
      fetched.push({ url: String(url), method: init.method, body: init.body || "" });
      if (init.method === "GET") {
        return new Response(JSON.stringify({
          page: { id: "page-alias", title: "Web App Checklist", slug: "web-app-checklist", bodyMarkdown: "old body" },
          revisions: [],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init.method === "PUT") {
        const body = JSON.parse(init.body);
        assert.equal(body.bodyMarkdown, "new body");
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    };

    const action = createPendingAction({ id: "user-alias", username: "alice" }, {
      tool: "wiki.page.update",
      args: {
        pathParams: { id: "page-alias" },
        body: { title: "Web App Checklist", bodyMarkdown: "new body" },
      },
    }, "test");
    assert.equal(action.args.pathParams.id, "page-alias");
    assert.equal(action.args.body.bodyMarkdown, "new body");
    const confirmed = await confirmPendingAction({
      user: { id: "user-alias", username: "alice" },
      access: { permissionSet: new Set(["wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, action.id);
    assert.equal(confirmed.result.ok, true);
    assert.deepEqual(fetched.map((item) => item.method), ["GET", "PUT"]);

    fetched.splice(0);
    const noop = createPendingAction({ id: "user-alias", username: "alice" }, {
      tool: "wiki.page.update",
      args: {
        pathParams: { id: "page-alias" },
        body: { title: "Web App Checklist", bodyMarkdown: "old body" },
      },
    }, "test");
    const noopConfirmed = await confirmPendingAction({
      user: { id: "user-alias", username: "alice" },
      access: { permissionSet: new Set(["wiki.edit_team"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, noop.id);
    assert.equal(noopConfirmed.result.ok, false);
    assert.match(noopConfirmed.result.error, /did not change/i);
    assert.deepEqual(fetched.map((item) => item.method), ["GET"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("RedSecAI normalizes simple calendar write times to the user timezone", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["calendar.entry.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.entry.create",
            args: { body: { title: "Blocked", dateIntent: "today", startLocal: "15:00", endLocal: "16:00" } },
          }],
        });
      }
      return "";
    };
    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "tz-user", username: "alice" },
      access: { permissionSet: new Set(["calendar.create"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "Block out my calendar from 3pm to 4pm today" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 1);
    assert.equal(turn.pendingActions[0].tool, "calendar.entry.create");
    const body = turn.pendingActions[0].args.body;
    assert.equal(body.timeZone, "Australia/Sydney");
    assert.equal(body.endsAt - body.startsAt, 3600);
    assert.notEqual(body.startsAt, 0);
    assert.equal(body.dateIntent, undefined);
    assert.equal(body.startLocal, undefined);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI normalizes structured duration calendar writes without regex prompt triggers", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["calendar.entry.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.entry.create",
            args: { body: { title: "Blocked", dateIntent: "today", startLocal: "15:00", durationMinutes: 60 } },
          }],
        });
      }
      return "";
    };
    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "tz-user-2", username: "alice" },
      access: { permissionSet: new Set(["calendar.create"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "Block out 1-hour for me from 3pm" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });

    const body = turn.pendingActions[0].args.body;
    assert.equal(body.timeZone, "Australia/Sydney");
    assert.equal(body.endsAt - body.startsAt, 3600);
    assert.notEqual(body.startsAt, 0);
    assert.equal(body.durationMinutes, undefined);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI normalizes all-day calendar writes before creating pending actions", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["calendar.entry.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.entry.create",
            args: { body: { title: "Public Holiday", type: "public_holiday", dateIntent: "2026-06-08", allDay: true, assigneeUserIds: ["__all__"] } },
          }],
        });
      }
      return "";
    };
    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "holiday-user", username: "alice" },
      access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "Add a public holiday for everyone on the 8th of June" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });

    const body = turn.pendingActions[0].args.body;
    assert.equal(body.allDay, true);
    assert.equal(body.timeZone, "Australia/Sydney");
    assert.equal(Number.isFinite(body.startsAt), true);
    assert.equal(Number.isFinite(body.endsAt), true);
    assert.ok(body.endsAt > body.startsAt);
    assert.deepEqual(body.assigneeUserIds, ["__all__"]);
    assert.equal(body.dateIntent, undefined);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI only creates everyone calendar actions for calendar managers", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["calendar.entry.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.entry.create",
            args: { body: { title: "Public Holiday", type: "public_holiday", dateIntent: "2026-06-08", allDay: true, assigneeUserIds: ["__all__"] } },
          }],
        });
      }
      return "";
    };
    const limitedTurn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "calendar-create-user", username: "alice" },
      access: { permissionSet: new Set(["calendar.create"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "Add a public holiday for everyone on the 8th of June" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });
    assert.equal(limitedTurn.pendingActions.length, 0);
    assert.match(limitedTurn.modelToolContext.results[0].error, /requires calendar\.manage/i);

    const managerTurn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "calendar-manager", username: "alice" },
      access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [{ role: "user", content: "Add a public holiday for everyone on the 8th of June" }], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });
    assert.deepEqual(managerTurn.pendingActions[0].args.body.assigneeUserIds, ["__all__"]);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI rejects guessed calendar audience fields before creating action cards", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      if (options.phase === "tool_router") {
        return JSON.stringify({
          useTools: true,
          selectedTools: ["calendar.entry.create"],
          toolCalls: [],
        });
      }
      if (options.phase === "tool_planner") {
        return JSON.stringify({
          toolCalls: [{
            tool: "calendar.entry.create",
            args: {
              title: "Team Meeting",
              startTime: "2026-05-08T09:30:00",
              description: "Team meeting scheduled via RedSecAI",
              attendees: "everyone",
              body: {
                title: "Team Meeting",
                startTime: "2026-05-08T09:30:00",
                description: "Team meeting scheduled via RedSecAI",
                attendees: "everyone",
                timeZone: "Australia/Sydney",
              },
            },
          }],
        });
      }
      return "";
    };

    const turn = await orchestrator.prepareRedSecAiTurn({
      user: { id: "calendar-manager-2", username: "alice" },
      access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
      get: () => "/calendar",
    }, [
      { role: "user", content: "do I have anything on tomorrow?" },
      { role: "assistant", content: "You have no entries scheduled for tomorrow." },
      { role: "user", content: "Great, schedule a team meeting for 9:30am. Make sure its in everyones calendar" },
    ], {
      path: "/calendar",
      timeZone: "Australia/Sydney",
    });

    assert.equal(turn.pendingActions.length, 0);
    assert.match(turn.modelToolContext.results[0].error, /does not match RedSecAI schema/i);
    assert.match(turn.modelToolContext.results[0].error, /attendees/i);
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI calendar create skips duplicate assignees on confirmation", async () => {
  const { confirmPendingAction, createPendingAction } = require("../server/modules/redsecai/actions");
  const originalFetch = global.fetch;
  const fetched = [];
  try {
    global.fetch = async (url, init = {}) => {
      fetched.push({ url: String(url), method: init.method, body: init.body || "" });
      if (init.method === "GET" && String(url).includes("/api/calendar/bootstrap")) {
        return new Response(JSON.stringify({
          capabilities: { canAssignOthers: true },
          currentUserId: "u1",
          availableUsers: [
            { id: "u1", username: "alice" },
            { id: "u2", username: "bob" },
          ],
          scheduleEntries: [{
            id: "existing",
            title: "Team Meeting",
            type: "meeting",
            startsAt: 1778203800,
            endsAt: 1778205600,
            assigneeUserId: "u1",
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (init.method === "POST" && String(url).includes("/api/calendar/entries")) {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.assigneeUserIds, ["u2"]);
        return new Response(JSON.stringify({
          success: true,
          createdCount: 1,
          entries: [{ id: "new-u2", ...body, assigneeUserId: "u2" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "unexpected request" }), { status: 404, headers: { "content-type": "application/json" } });
    };

    const action = createPendingAction({ id: "u1", username: "alice" }, {
      tool: "calendar.entry.create",
      args: {
        body: {
          title: "Team Meeting",
          type: "meeting",
          startsAt: 1778203800,
          endsAt: 1778205600,
          assigneeUserIds: ["__all__"],
          timeZone: "Australia/Sydney",
        },
      },
    }, "test");

    const confirmed = await confirmPendingAction({
      user: { id: "u1", username: "alice" },
      access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
      headers: { cookie: "redsec_session=s%3Atest.sig" },
    }, action.id);
    assert.equal(confirmed.result.ok, true);
    assert.deepEqual(confirmed.result.data.redsecAiDuplicatePreflight.skippedAssigneeUserIds, ["u1"]);
    assert.deepEqual(confirmed.result.data.redsecAiDuplicatePreflight.createdAssigneeUserIds, ["u2"]);
    assert.deepEqual(fetched.map((item) => item.method), ["GET", "POST"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("RedSecAI schedules a named calendar project and allocation in one confirmed action", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const { confirmPendingAction } = require("../server/modules/redsecai/actions");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  const requests = [];
  try {
    await withMockedDate("2026-04-20T02:00:00.000Z", async () => {
      provider.chat = async (messages, options = {}) => {
        if (options.phase === "tool_router") {
          return JSON.stringify({
            useTools: true,
            selectedTools: ["calendar.project.schedule"],
            toolCalls: [],
          });
        }
        if (options.phase === "tool_planner") {
          return JSON.stringify({
            toolCalls: [{
              tool: "calendar.project.schedule",
              args: {
                body: {
                  projectName: "CV web app test",
                  startDate: "2026-05-04",
                  endDate: "2026-05-13",
                  title: "CV web app test",
                  billableRate: 2500,
                },
              },
            }],
          });
        }
        return "";
      };
      global.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
        if (init.method === "POST" && String(url).includes("/api/calendar/projects")) {
          assert.equal(requests.at(-1).body.name, "CV web app test");
          assert.equal(requests.at(-1).body.billableRate, 2500);
          return new Response(JSON.stringify({
            success: true,
            project: { id: "project-cv", name: "CV web app test" },
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (init.method === "POST" && String(url).includes("/api/calendar/allocations")) {
          const body = requests.at(-1).body;
          assert.equal(body.projectId, "project-cv");
          assert.equal(body.startDate, "2026-05-04");
          assert.equal(body.endDate, "2026-05-13");
          assert.equal(body.allocationMode, "daily");
          return new Response(JSON.stringify({ success: true, createdCount: 8 }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "unexpected request" }), { status: 404, headers: { "content-type": "application/json" } });
      };

      const req = {
        user: { id: "project-user", username: "alice" },
        access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
        headers: { cookie: "redsec_session=s%3Atest.sig" },
        get: () => "/calendar",
      };
      const turn = await orchestrator.prepareRedSecAiTurn(req, [
        { role: "user", content: "Assign the CV web app test project to me and put it in my calendar" },
        { role: "user", content: "Runs from 4 May - 13 May" },
      ], {
        path: "/calendar",
        timeZone: "Australia/Sydney",
      });

      assert.equal(turn.pendingActions.length, 1);
      assert.equal(turn.pendingActions[0].tool, "calendar.project.schedule");
      assert.equal(turn.pendingActions[0].args.body.projectName, "CV web app test");

      const confirmed = await confirmPendingAction(req, turn.pendingActions[0].id);
      assert.equal(confirmed.result.ok, true);
      assert.deepEqual(requests.filter((request) => request.method === "POST").map((request) => request.method), ["POST", "POST"]);
    });
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
  }
});

test("RedSecAI corrects model-invented past years for yearless project allocations", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  try {
    await withMockedDate("2026-05-08T02:00:00.000Z", async () => {
      provider.chat = async (messages, options = {}) => {
        if (options.phase === "tool_router") {
          return JSON.stringify({
            useTools: true,
            intent: "write",
            selectedTools: ["calendar.allocation.create"],
            toolCalls: [],
          });
        }
        if (options.phase === "tool_planner") {
          assert.ok(messages.some((message) => String(message.content).includes("Current user-local date/time: 2026-05-08")));
          return JSON.stringify({
            toolCalls: [{
              tool: "calendar.allocation.create",
              args: {
                body: {
                  projectId: "project-cv",
                  allocationMode: "daily",
                  startDate: "2025-05-18",
                  endDate: "2025-05-27",
                  hoursPerDay: 8,
                  workdaysOnly: true,
                },
              },
            }],
          });
        }
        return "";
      };
      global.fetch = async () => new Response(JSON.stringify({ success: true, projects: [], results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const turn = await orchestrator.prepareRedSecAiTurn({
        user: { id: "u1", username: "alice" },
        access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
        headers: { cookie: "redsec_session=s%3Atest.sig" },
        get: () => "/calendar",
      }, [
        { role: "user", content: "The project dates are 18-27 May" },
        { role: "user", content: "Ok, now last step, put the dates in my calendar against the project" },
      ], {
        path: "/calendar",
        timeZone: "Australia/Sydney",
      });

      assert.equal(turn.pendingActions.length, 1);
      assert.equal(turn.pendingActions[0].tool, "calendar.allocation.create");
      assert.equal(turn.pendingActions[0].args.body.startDate, "2026-05-18");
      assert.equal(turn.pendingActions[0].args.body.endDate, "2026-05-27");
    });
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
  }
});

test("RedSecAI rolls elapsed yearless allocation ranges into next year", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  const originalFetch = global.fetch;
  try {
    await withMockedDate("2026-05-08T02:00:00.000Z", async () => {
      provider.chat = async (messages, options = {}) => {
        if (options.phase === "tool_router") {
          return JSON.stringify({
            useTools: true,
            intent: "write",
            selectedTools: ["calendar.allocation.create"],
            toolCalls: [],
          });
        }
        if (options.phase === "tool_planner") {
          return JSON.stringify({
            toolCalls: [{
              tool: "calendar.allocation.create",
              args: {
                body: {
                  projectId: "project-jan",
                  allocationMode: "daily",
                  startDate: "2026-01-12",
                  endDate: "2026-01-16",
                  hoursPerDay: 8,
                  workdaysOnly: true,
                },
              },
            }],
          });
        }
        return "";
      };
      global.fetch = async () => new Response(JSON.stringify({ success: true, projects: [], results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const turn = await orchestrator.prepareRedSecAiTurn({
        user: { id: "u1", username: "alice" },
        access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
        headers: { cookie: "redsec_session=s%3Atest.sig" },
        get: () => "/calendar",
      }, [
        { role: "user", content: "Put the project in my calendar for January" },
      ], {
        path: "/calendar",
        timeZone: "Australia/Sydney",
      });

      assert.equal(turn.pendingActions.length, 1);
      assert.equal(turn.pendingActions[0].args.body.startDate, "2027-01-12");
      assert.equal(turn.pendingActions[0].args.body.endDate, "2027-01-16");
    });
  } finally {
    provider.chat = originalChat;
    global.fetch = originalFetch;
  }
});

test("RedSecAI preserves explicit user-supplied past years", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    await withMockedDate("2026-05-08T02:00:00.000Z", async () => {
      provider.chat = async (messages, options = {}) => {
        if (options.phase === "tool_router") {
          return JSON.stringify({
            useTools: true,
            intent: "write",
            selectedTools: ["calendar.allocation.create"],
            toolCalls: [],
          });
        }
        if (options.phase === "tool_planner") {
          return JSON.stringify({
            toolCalls: [{
              tool: "calendar.allocation.create",
              args: {
                body: {
                  projectId: "project-history",
                  allocationMode: "daily",
                  startDate: "2025-05-18",
                  endDate: "2025-05-27",
                  hoursPerDay: 8,
                  workdaysOnly: true,
                },
              },
            }],
          });
        }
        return "";
      };

      const turn = await orchestrator.prepareRedSecAiTurn({
        user: { id: "u1", username: "alice" },
        access: { permissionSet: new Set(["calendar.create", "calendar.manage"]) },
        get: () => "/calendar",
      }, [
        { role: "user", content: "Backdate this allocation to 18-27 May 2025" },
      ], {
        path: "/calendar",
        timeZone: "Australia/Sydney",
      });

      assert.equal(turn.pendingActions.length, 1);
      assert.equal(turn.pendingActions[0].args.body.startDate, "2025-05-18");
      assert.equal(turn.pendingActions[0].args.body.endDate, "2025-05-27");
    });
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI verifies calendar after calendar write follow-ups", async () => {
  const provider = require("../server/modules/redsecai/provider");
  const orchestrator = require("../server/modules/redsecai/orchestrator");
  const originalChat = provider.chat;
  try {
    provider.chat = async (messages, options = {}) => {
      assert.equal(options.phase, "tool_router");
      const joined = messages.map((message) => message.content).join("\n");
      assert.ok(joined.includes("Confirmed pending action"));
      assert.ok(joined.includes("Latest user turn"));
      return JSON.stringify({
        useTools: true,
        toolCalls: [{ tool: "calendar.bootstrap", args: { rangeIntent: "this_week" } }],
      });
    };
    const routed = await orchestrator.routeModelToolUse({
      access: { permissionSet: new Set(["calendar.view"]) },
    }, [
      { role: "user", content: "Please block out 1 hour from 3pm today" },
      { role: "assistant", content: "Confirmed pending action: Create calendar entry \"Blocked Time\"" },
      { role: "user", content: "I dont see it in there, please check its there" },
    ], { page: { timeZone: "Australia/Sydney" } });

    assert.equal(routed.useTools, true);
    assert.deepEqual(routed.calls.map((call) => call.tool), ["calendar.bootstrap"]);
    assert.equal(routed.calls[0].args.timeZone, "Australia/Sydney");
  } finally {
    provider.chat = originalChat;
  }
});

test("RedSecAI Engage tools require Engage permission and hide commercial fields", () => {
  const { getRedSecAiToolManifest, TOOL_ALLOWLIST } = require("../server/modules/redsecai/context");

  const noEngage = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["calendar.view", "reporter.view"]),
  });
  assert.ok(!noEngage.some((t) => t.name.startsWith("engage.")));

  const withEngage = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["engage.view_team"]),
  });
  assert.ok(withEngage.some((t) => t.name === "engage.dashboard.summary"));

  assert.ok(TOOL_ALLOWLIST["engage.opportunities.search"].description.includes("Commercial fields remain hidden"));
  assert.ok(TOOL_ALLOWLIST["engage.opportunity.get"].description.includes("Commercial fields remain hidden"));
});

test("RedSecAI Engage write tools are confirmation-gated", () => {
  const { TOOL_ALLOWLIST } = require("../server/modules/redsecai/context");

  assert.equal(TOOL_ALLOWLIST["engage.note.create"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["engage.engagement.update_status"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["engage.qa.request"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["engage.qa.assign"].confirmRequired, true);
});

test("RedSecAI cannot change commercial values or set won/lost/rejected opportunity stages in v1", () => {
  const { TOOL_ALLOWLIST, TOOL_INPUT_SCHEMAS, getRedSecAiSchemaValidationError } = require("../server/modules/redsecai/context");

  const engageToolNames = Object.keys(TOOL_ALLOWLIST).filter((n) => n.startsWith("engage."));
  assert.ok(!engageToolNames.some((n) => n.includes("commercial")));
  assert.ok(!engageToolNames.some((n) => n.includes("billing")));

  for (const name of engageToolNames) {
    const schema = TOOL_INPUT_SCHEMAS[name];
    if (!schema) continue;
    const bodyProps = schema.properties?.body?.properties;
    if (!bodyProps) continue;
    assert.equal(bodyProps.commercialValue, undefined, `${name} should not accept commercialValue`);
    assert.equal(bodyProps.estimatedValue, undefined, `${name} should not accept estimatedValue`);
    assert.equal(bodyProps.billableRate, undefined, `${name} should not accept billableRate`);
  }

  const stageEnum = TOOL_INPUT_SCHEMAS["engage.opportunity.update_stage"].properties.body.properties.stage.enum;
  assert.ok(!stageEnum.includes("won"));
  assert.ok(!stageEnum.includes("lost"));
  assert.ok(!stageEnum.includes("rejected"));

  const wonError = getRedSecAiSchemaValidationError("engage.opportunity.update_stage", {
    pathParams: { id: "opp-1" },
    body: { stage: "won" },
  });
  assert.ok(wonError);
  assert.match(wonError, /must be one of/i);
});

test("RedSecAI Engage link tools require appropriate access and are confirmation-gated", () => {
  const { getRedSecAiToolManifest, TOOL_ALLOWLIST } = require("../server/modules/redsecai/context");

  assert.equal(TOOL_ALLOWLIST["engage.link.reporter_document"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["engage.link.reporter_project"].confirmRequired, true);
  assert.equal(TOOL_ALLOWLIST["engage.link.calendar_project"].confirmRequired, true);

  const viewerOnly = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["engage.view_own"]),
  });
  assert.ok(!viewerOnly.some((t) => t.name === "engage.link.reporter_project"));
  assert.ok(!viewerOnly.some((t) => t.name === "engage.link.calendar_project"));
  assert.ok(!viewerOnly.some((t) => t.name === "engage.link.reporter_document"));

  const editor = getRedSecAiToolManifest({
    userId: "u1",
    permissionSet: new Set(["engage.view_team", "engage.edit_engagement", "engage.edit_opportunity"]),
  });
  assert.ok(editor.some((t) => t.name === "engage.link.reporter_project"));
  assert.ok(editor.some((t) => t.name === "engage.link.reporter_document"));
  assert.ok(editor.some((t) => t.name === "engage.link.calendar_project"));
});
