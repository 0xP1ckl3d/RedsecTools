const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "service-account-route", routes: ["integrations"] });
  try {
    const { createPlainApiToken, hashApiToken, tokenDisplayPrefix } = require("../../server/middleware/service-auth");
    harness.database.setSetting("service_accounts_enabled", "true");
    const account = harness.database.createServiceAccount({
      name: "CI integration",
      scopes: ["audit.read"],
      enabled: true,
      createdBy: "admin",
    });
    const token = createPlainApiToken();
    harness.database.createServiceAccountToken({
      serviceAccountId: account.id,
      tokenHash: hashApiToken(token),
      label: "test",
      prefix: tokenDisplayPrefix(token),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      createdBy: "admin",
    });

    const ok = await harness.requestJson({
      path: "/api/v1/audit-events",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);
    assert.equal(Array.isArray(ok.body.events), true);

    const missingScope = await harness.requestJson({
      path: "/api/v1/deployment/counts",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(missingScope.status, 403);

    harness.database.setSetting("service_accounts_enabled", "false");
    const disabled = await harness.requestJson({
      path: "/api/v1/audit-events",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(disabled.status, 404);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
