const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "redsecai-routes", routes: ["redsecai", "homepage", "engage"] });
  try {
    const provider = require("../../server/modules/redsecai/provider");
    provider.checkModelHealth = async () => ({
      enabled: true,
      ok: true,
      model: "qwen3.5:4b",
      baseUrl: "http://127.0.0.1:11434",
      timeoutMs: 120000,
      numCtx: 4096,
      cloudModel: false,
      processingMode: "local-ollama-local-model",
      endpointRisk: "local",
      endpointWarnings: [],
      availableModels: ["qwen3.5:4b"],
    });
    provider.chat = async (_messages, options = {}) => {
      if (options.phase === "tool_router") return JSON.stringify({ useTools: false, toolCalls: [] });
      return "route ok";
    };

    const user = harness.createUserWithSession({ id: "ai-user", permissions: ["wiki.view"] });
    const other = harness.createUserWithSession({ id: "other-user", permissions: ["wiki.view"] });
    const engageManager = harness.createUserWithSession({
      id: "ai-engage-manager",
      username: "engage-manager",
      permissions: ["engage.view_team", "engage.create_client", "engage.create_engagement", "engage.edit_engagement"],
    });

    const status = await harness.requestJson({ path: "/api/ai/status", cookie: user.cookie });
    assert.equal(status.status, 200);
    assert.equal(status.body.ready, true);
    assert.equal(status.body.processingMode, "local-ollama-local-model");

    const chat = await harness.requestJson({
      method: "POST",
      path: "/api/ai/chat",
      cookie: user.cookie,
      body: { messages: [{ role: "user", content: "Reply with route ok" }], page: { path: "/ai", timeZone: "Australia/Sydney" } },
    });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.message, "route ok");

    const { createPendingAction } = require("../../server/modules/redsecai/actions");
    const created = createPendingAction(user, {
      tool: "homepage.shortcut.create",
      args: { body: { title: "Admin Panel", url: "/admin", icon: "A" } },
    });
    const crossConfirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${created.id}/confirm`,
      cookie: other.cookie,
    });
    assert.equal(crossConfirm.status, 404);

    const confirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${created.id}/confirm`,
      cookie: user.cookie,
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.success, true);
    assert.equal(confirm.body.result.ok, true);

    const rejectable = createPendingAction(user, {
      tool: "homepage.shortcut.create",
      args: { body: { title: "Docs", url: "/wiki", icon: "D" } },
    });
    const crossReject = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${rejectable.id}/reject`,
      cookie: other.cookie,
    });
    assert.equal(crossReject.status, 404);
    const reject = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${rejectable.id}/reject`,
      cookie: user.cookie,
    });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.success, true);

    const invalid = createPendingAction(user, {
      tool: "homepage.shortcut.create",
      args: { body: { title: "Missing URL" } },
    });
    const invalidConfirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${invalid.id}/confirm`,
      cookie: user.cookie,
    });
    assert.equal(invalidConfirm.status, 400);
    assert.match(invalidConfirm.body.error, /failed|required|schema|URL/i);

    const realNow = Date.now;
    Date.now = () => realNow() - (3 * 60 * 60 * 1000);
    const expired = createPendingAction(user, {
      tool: "homepage.shortcut.create",
      args: { body: { title: "Expired", url: "/expired", icon: "E" } },
    });
    Date.now = realNow;
    const expiredConfirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${expired.id}/confirm`,
      cookie: user.cookie,
    });
    assert.equal(expiredConfirm.status, 404);

    const reporterDenied = createPendingAction(user, {
      tool: "reporter.project.delete",
      args: { pathParams: { id: "project-1" } },
    });
    const reporterConfirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${reporterDenied.id}/confirm`,
      cookie: user.cookie,
    });
    assert.equal(reporterConfirm.status, 403);
    assert.equal(reporterConfirm.body.success, false);

    const client = await harness.requestJson({
      method: "POST",
      path: "/api/engage/clients",
      cookie: engageManager.cookie,
      body: { name: "AI Client" },
    });
    assert.equal(client.status, 201);
    const engagement = await harness.requestJson({
      method: "POST",
      path: "/api/engage/engagements",
      cookie: engageManager.cookie,
      body: { clientId: client.body.client.id, title: "AI Review Engagement" },
    });
    assert.equal(engagement.status, 201);
    const engageAction = createPendingAction(engageManager, {
      tool: "engage.engagement.update_status",
      args: {
        pathParams: { id: engagement.body.engagement.id },
        body: { status: "testing_in_progress" },
      },
    });
    const engageConfirm = await harness.requestJson({
      method: "POST",
      path: `/api/ai/actions/${engageAction.id}/confirm`,
      cookie: engageManager.cookie,
    });
    assert.equal(engageConfirm.status, 200);
    assert.equal(engageConfirm.body.success, true);
    assert.equal(engageConfirm.body.result.data.engagement.status, "testing_in_progress");

    console.log(JSON.stringify({ ok: true }));
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
