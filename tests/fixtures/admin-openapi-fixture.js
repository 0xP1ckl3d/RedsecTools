const assert = require("node:assert/strict");
const { createRouteHarness, signedCookieValue } = require("../helpers/route-harness");

(async () => {
  process.env.ADMIN_PASSWORD = "test-admin-password";
  const harness = await createRouteHarness({ name: "admin-openapi-route", routes: ["admin"] });
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

    res = await harness.requestJson({ path: "/admin/openapi/init.js", cookie });
    assert.equal(res.status, 200);
    assert.match(res.text, /\/admin\/api\/openapi\.json/);
    assert.match(res.text, /credentials = "same-origin"/);

    res = await harness.requestJson({ path: "/admin/api/openapi.json", cookie });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.servers, [{ url: "/", description: "Current RedSecTools origin" }]);
    assert.ok(res.body.paths["/admin/openapi"]);
    assert.ok(res.body.paths["/admin/api/service-accounts"]);
    assert.ok(res.body.paths["/admin/api/webhooks"]);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
