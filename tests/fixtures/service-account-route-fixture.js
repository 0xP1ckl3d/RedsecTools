const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "service-account-route", routes: ["integrations"] });
  try {
    const { createPlainApiToken, hashApiToken, tokenDisplayPrefix } = require("../../server/middleware/service-auth");
    harness.database.setSetting("service_accounts_enabled", "true");
    function createToken(scopes, name = "CI integration") {
      const account = harness.database.createServiceAccount({
        name,
        scopes,
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
      return token;
    }

    const user = harness.createUserWithSession({
      id: "svc-user",
      username: "svc-user",
      permissions: ["calendar.manage", "wiki.manage", "reporter.manage_all", "engage.view_team"],
    });
    const auditToken = createToken(["audit.read"]);

    const ok = await harness.requestJson({
      path: "/api/v1/audit-events",
      headers: { authorization: `Bearer ${auditToken}` },
    });
    assert.equal(ok.status, 200);
    assert.equal(Array.isArray(ok.body.events), true);

    const missingScope = await harness.requestJson({
      path: "/api/v1/deployment/counts",
      headers: { authorization: `Bearer ${auditToken}` },
    });
    assert.equal(missingScope.status, 403);
    assert.equal(missingScope.body.code, "insufficient_scope");

    harness.database.createCalendarProject({ name: "API Calendar", createdBy: user.id });
    harness.database.createSurvey({
      id: "survey-api",
      title: "API Survey",
      ownerId: user.id,
      responseMode: "internal",
      status: "published",
    });
    harness.database.createWikiPage({
      id: "wiki-api",
      slug: "api-page",
      title: "API Page",
      bodyMarkdown: "API",
      bodyHtml: "<p>API</p>",
      scope: "team",
      authorId: user.id,
    });
    const design = harness.database.createReporterDesignRow({
      id: "reporter-design-api",
      name: "API Design",
      createdBy: user.id,
    });
    harness.database.createReporterProjectRow({
      id: "reporter-api",
      designId: design.id,
      title: "API Reporter",
      reportType: "webapp",
      createdBy: user.id,
      members: [{ userId: user.id, role: "lead" }],
    });
    const client = harness.database.createEngageClient({ name: "API Client", createdBy: user.id });
    harness.database.createEngageOpportunity({
      id: "opp-api",
      clientId: client.id,
      title: "API Opportunity",
      estimatedValue: 12345,
      createdBy: user.id,
    });
    harness.database.createEngageEngagement({
      id: "eng-api",
      clientId: client.id,
      title: "API Engagement",
      commercialValue: 54321,
      createdBy: user.id,
    });

    const broadReadToken = createToken([
      "calendar.view_team",
      "survey.view_results_any",
      "wiki.view",
      "reporter.manage_all",
      "engage.view_team",
      "threat.view",
    ], "CI broad reader");

    for (const path of [
      "/api/v1/calendar/projects",
      "/api/v1/surveys",
      "/api/v1/surveys/survey-api",
      "/api/v1/wiki/pages",
      "/api/v1/wiki/pages/wiki-api",
      "/api/v1/reporter/projects",
      "/api/v1/reporter/projects/reporter-api",
      "/api/v1/engage/clients",
      "/api/v1/engage/clients/" + client.id,
      "/api/v1/engage/opportunities",
      "/api/v1/engage/opportunities/opp-api",
      "/api/v1/engage/engagements",
      "/api/v1/engage/engagements/eng-api",
      "/api/v1/threat/feeds",
      "/api/v1/threat/keywords",
    ]) {
      const res = await harness.requestJson({
        path,
        headers: { authorization: `Bearer ${broadReadToken}` },
      });
      assert.equal(res.status, 200, path);
    }

    const redactedOpportunity = await harness.requestJson({
      path: "/api/v1/engage/opportunities/opp-api",
      headers: { authorization: `Bearer ${broadReadToken}` },
    });
    assert.equal(redactedOpportunity.body.opportunity.estimated_value, null);

    const commercialToken = createToken(["engage.view_team", "engage.manage_commercials"], "CI commercial reader");
    const commercialOpportunity = await harness.requestJson({
      path: "/api/v1/engage/opportunities/opp-api",
      headers: { authorization: `Bearer ${commercialToken}` },
    });
    assert.equal(commercialOpportunity.status, 200);
    assert.equal(commercialOpportunity.body.opportunity.estimated_value, 12345);

    harness.database.setSetting("service_accounts_enabled", "false");
    const disabled = await harness.requestJson({
      path: "/api/v1/audit-events",
      headers: { authorization: `Bearer ${auditToken}` },
    });
    assert.equal(disabled.status, 404);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
