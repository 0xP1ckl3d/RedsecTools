const assert = require("node:assert/strict");
const { createRouteHarness, signedCookieValue } = require("../helpers/route-harness");

(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password";
  const harness = await createRouteHarness({ name: "minitools-admin", routes: ["minitools", "admin", "auth"] });
  try {
    const admin = harness.createUserWithSession({ id: "admin1", username: "admin1", roleId: "admin" });
    const adminSessionId = "minitools-admin-session";
    harness.database.createAdminSession({
      id: adminSessionId,
      userId: admin.id,
      linkedSessionId: admin.sessionId,
      expiresIn: 3600,
      ipAddress: "127.0.0.1",
      userAgent: "route-harness",
    });
    const adminCookie = `redsec_admin=${encodeURIComponent(signedCookieValue(adminSessionId, harness.cookieSecret))}`;
    const cookie = `${admin.cookie}; ${adminCookie}`;

    const defaults = await harness.requestJson({
      path: "/admin/api/settings/minitools",
      cookie,
    });
    assert.strictEqual(defaults.status, 200);
    assert.strictEqual(defaults.body.cvss, true);
    assert.strictEqual(defaults.body.breach, true);
    assert.strictEqual(defaults.body.azure, true);
    assert.strictEqual(defaults.body.securitytrails, true);
    assert.strictEqual(defaults.body.securityHeaders, true);
    assert.strictEqual(defaults.body.tlsCheck, true);
    assert.strictEqual(defaults.body.leakradar, true);

    const postRes = await harness.requestJson({
      method: "POST",
      path: "/admin/api/settings/minitools",
      cookie,
      body: {
        cvssEnabled: true,
        breachEnabled: false,
        azureEnabled: true,
        securitytrailsEnabled: false,
        securityHeadersEnabled: false,
        tlsCheckEnabled: false,
        leakradarEnabled: false,
      },
    });
    assert.strictEqual(postRes.status, 200);

    const updated = await harness.requestJson({
      path: "/admin/api/settings/minitools",
      cookie,
    });
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.body.cvss, true);
    assert.strictEqual(updated.body.breach, false);
    assert.strictEqual(updated.body.azure, true);
    assert.strictEqual(updated.body.securitytrails, false);
    assert.strictEqual(updated.body.securityHeaders, false);
    assert.strictEqual(updated.body.tlsCheck, false);
    assert.strictEqual(updated.body.leakradar, false);

    const leakRadarSettings = await harness.requestJson({
      method: "POST",
      path: "/admin/api/settings/leakradar",
      cookie,
      body: { apiKey: "lr_test_token_123456789" },
    });
    assert.strictEqual(leakRadarSettings.status, 200);
    assert.strictEqual(leakRadarSettings.body.apiKeyConfigured, true);
    const storedLeakRadarKey = harness.database.getSetting("leakradar_api_key_encrypted");
    assert.notStrictEqual(storedLeakRadarKey, "lr_test_token_123456789");
    assert.strictEqual(harness.database.decryptValue(storedLeakRadarKey), "lr_test_token_123456789");

    const leakRadarGet = await harness.requestJson({
      path: "/admin/api/settings/leakradar",
      cookie,
    });
    assert.strictEqual(leakRadarGet.status, 200);
    assert.strictEqual(leakRadarGet.body.apiKeyConfigured, true);
    assert.strictEqual(leakRadarGet.body.apiKeyPreview, "lr_t...6789");

    const user = harness.createUserWithSession({ id: "user1", username: "user1", permissions: ["minitools.view"] });
    harness.database.setSetting("minitool_breach_enabled", "false");
    harness.database.setSetting("minitool_azure_enabled", "false");
    harness.database.setSetting("minitool_security_headers_enabled", "false");
    harness.database.setSetting("minitool_tls_check_enabled", "false");
    harness.database.setSetting("minitool_leakradar_enabled", "false");

    const bootstrap = await harness.requestJson({
      path: "/api/minitools/bootstrap",
      cookie: user.cookie,
    });
    assert.strictEqual(bootstrap.status, 200);
    assert.strictEqual(bootstrap.body.tools.cvss.enabled, true);
    assert.strictEqual(bootstrap.body.tools.breach.enabled, false);
    assert.strictEqual(bootstrap.body.tools.azure.enabled, false);
    assert.strictEqual(bootstrap.body.tools.securitytrails.enabled, false);
    assert.strictEqual(bootstrap.body.tools.securityHeaders.enabled, false);
    assert.strictEqual(bootstrap.body.tools.tlsCheck.enabled, false);
    assert.strictEqual(bootstrap.body.tools.leakradar.enabled, false);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
