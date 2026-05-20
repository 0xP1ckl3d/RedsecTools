const assert = require("node:assert/strict");
const { createRouteHarness, signedCookieValue } = require("../helpers/route-harness");

(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password";
  const harness = await createRouteHarness({ name: "admin-openapi-route", routes: ["admin", "auth"] });
  try {
    const user = harness.createUserWithSession({
      id: "admin-openapi-user",
      username: "admin-openapi-user",
      permissions: ["admin.access"],
    });
    const adminSessionId = "admin-openapi-session";
    harness.database.createAdminSession({
      id: adminSessionId,
      userId: user.id,
      linkedSessionId: user.sessionId,
      expiresIn: 3600,
      ipAddress: "127.0.0.1",
      userAgent: "route-harness",
    });
    const adminCookie = `redsec_admin=${encodeURIComponent(signedCookieValue(adminSessionId, harness.cookieSecret))}`;
    const cookie = `${user.cookie}; ${adminCookie}`;
    let res = await harness.requestJson({ path: "/admin/openapi", cookie });
    assert.equal(res.status, 404);
    assert.match(res.text, /OpenAPI publishing is disabled/);

    harness.database.setSetting("openapi_enabled", "true");

    res = await harness.requestJson({ path: "/admin/openapi", cookie });
    assert.equal(res.status, 200);
    assert.match(res.text, /swagger-ui-bundle\.js/);
    assert.match(res.text, /RedSecTools API Docs/);
    assert.match(res.text, /\/admin\/openapi\/controls\.css/);
    assert.doesNotMatch(res.text, /\/css\/style\.css/);
    assert.match(res.text, /Override cookies with Swagger Authorize/);
    assert.doesNotMatch(res.text, /swagger-cookie-override/);

    res = await harness.requestJson({ path: "/admin/openapi/controls.css", cookie });
    assert.equal(res.status, 200);
    assert.match(res.text, /redsec-swagger-auth-panel/);
    assert.doesNotMatch(res.text, /--bg-page|--text-primary|--accent/);

    res = await harness.requestJson({ path: "/admin/openapi/init.js", cookie });
    assert.equal(res.status, 200);
    assert.match(res.text, /\/admin\/api\/openapi\.json/);
    assert.match(res.text, /\/admin\/openapi\/proxy/);
    assert.match(res.text, /cookieMode/);
    assert.doesNotMatch(res.text, /cookieOverride/);
    assert.doesNotMatch(res.text, /X-RedSec-Swagger-Auth-Mode/);

    res = await harness.requestJson({
      method: "POST",
      path: "/admin/openapi/proxy",
      cookie,
      body: {
        method: "GET",
        target: "/admin/api/auth-status",
        headers: { accept: "application/json" },
        cookieMode: "current",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);

    res = await harness.requestJson({
      method: "POST",
      path: "/admin/openapi/proxy",
      cookie,
      body: {
        method: "GET",
        target: "/admin/api/auth-status",
        headers: { accept: "application/json", authorization: "Bearer ignored-in-none-mode" },
        cookieMode: "none",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);

    res = await harness.requestJson({
      method: "POST",
      path: "/admin/openapi/proxy",
      cookie,
      body: {
        method: "GET",
        target: "/api/auth/me",
        headers: { accept: "application/json", authorization: "Bearer authorize-mode-token" },
        cookieMode: "authorize",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);

    harness.database.setSetting("service_accounts_enabled", "true");
    res = await harness.requestJson({ path: "/admin/api/service-accounts/scopes", cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.scopes.includes("audit.read"));
    assert.ok(res.body.scopeDefinitions.some((definition) => definition.key === "audit.read"));

    res = await harness.requestJson({
      method: "POST",
      path: "/admin/api/service-accounts",
      cookie,
      body: {
        name: "Editable API account",
        description: "created by admin fixture",
        scopes: ["audit.read"],
        enabled: true,
      },
    });
    assert.equal(res.status, 201);
    const serviceAccountId = res.body.serviceAccount.id;
    assert.deepEqual(res.body.serviceAccount.scopes, ["audit.read"]);

    res = await harness.requestJson({
      method: "PUT",
      path: `/admin/api/service-accounts/${serviceAccountId}`,
      cookie,
      body: {
        name: "Editable API account",
        description: "scope changed by admin fixture",
        scopes: ["deployment.read", "wiki.view"],
        enabled: true,
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.serviceAccount.scopes, ["deployment.read", "wiki.view"]);

    res = await harness.requestJson({ path: "/admin/api/openapi.json", cookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.servers, [{ url: "/", description: "Current RedSecTools origin" }]);
    assert.ok(res.body.paths["/admin/openapi"]);
    assert.ok(res.body.paths["/admin/api/settings/minitools"]);
    assert.ok(res.body.paths["/admin/api/settings/securitytrails"]);
    assert.ok(res.body.paths["/admin/api/settings/leakradar"]);
    assert.ok(res.body.paths["/api/minitools/tls-check/analyze"]);
    assert.ok(res.body.paths["/api/minitools/leakradar/search"]);
    assert.ok(res.body.paths["/api/minitools/leakradar/unlock"]);
    assert.ok(res.body.paths["/api/minitools/leakradar/unlocked"]);
    assert.ok(res.body.paths["/admin/api/service-accounts"]);
    assert.ok(res.body.paths["/admin/api/webhooks"]);
    assert.ok(res.body.paths["/api/v1/engage/opportunities"]);
    assert.ok(res.body.paths["/api/v1/reporter/projects/{id}"]);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
