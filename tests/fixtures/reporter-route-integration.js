const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "reporter-routes", routes: ["reporter"] });
  try {
    const lead = harness.createUserWithSession({
      id: "lead",
      permissions: ["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned"],
    });
    const member = harness.createUserWithSession({
      id: "member",
      permissions: ["reporter.view", "reporter.edit_assigned"],
    });
    const outsider = harness.createUserWithSession({
      id: "outsider",
      permissions: ["reporter.view", "reporter.edit_assigned"],
    });
    const manager = harness.createUserWithSession({
      id: "manager",
      permissions: ["reporter.view", "reporter.manage_all", "reporter.manage_templates"],
    });

    const designId = harness.database.listReporterDesigns()[0]?.id;
    assert.ok(designId, "Reporter seed design should exist");

    const project = harness.database.createReporterProjectRow({
      id: "project-a",
      designId,
      title: "Project A",
      reportType: "webapp",
      status: "draft",
      createdBy: lead.id,
      members: [
        { userId: lead.id, role: "lead" },
        { userId: member.id, role: "pentester" },
      ],
    });
    assert.equal(project.id, "project-a");

    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-a", cookie: outsider.cookie })).status, 403);
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-a", cookie: member.cookie })).status, 200);
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-a", cookie: manager.cookie })).status, 200);

    const addByMember = await harness.requestJson({
      method: "POST",
      path: "/api/reporter/projects/project-a/members",
      cookie: member.cookie,
      body: { userId: outsider.id, role: "pentester" },
    });
    assert.equal(addByMember.status, 403);

    const addByLead = await harness.requestJson({
      method: "POST",
      path: "/api/reporter/projects/project-a/members",
      cookie: lead.cookie,
      body: { userId: outsider.id, role: "reviewer" },
    });
    assert.equal(addByLead.status, 200);

    const projectB = harness.database.createReporterProjectRow({
      id: "project-b",
      designId,
      title: "Project B",
      reportType: "webapp",
      status: "draft",
      createdBy: lead.id,
      members: [{ userId: lead.id, role: "lead" }],
    });
    assert.equal(projectB.id, "project-b");
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-b/notes", cookie: outsider.cookie })).status, 403);
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-b/findings", cookie: outsider.cookie })).status, 403);
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-b/evidence", cookie: outsider.cookie })).status, 403);
    assert.equal((await harness.requestJson({ path: "/api/reporter/projects/project-b/pdfs", cookie: outsider.cookie })).status, 403);

    const readonly = await harness.requestJson({
      method: "PUT",
      path: "/api/reporter/projects/project-a/readonly",
      cookie: lead.cookie,
      body: { readonly: true },
    });
    assert.equal(readonly.status, 200);
    const editReadonly = await harness.requestJson({
      method: "PUT",
      path: "/api/reporter/projects/project-a",
      cookie: lead.cookie,
      body: { title: "Project A edited" },
    });
    assert.equal(editReadonly.status, 403);

    const deleteByMember = await harness.requestJson({
      method: "DELETE",
      path: "/api/reporter/projects/project-a",
      cookie: member.cookie,
    });
    assert.equal(deleteByMember.status, 403);

    console.log(JSON.stringify({ ok: true }));
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
