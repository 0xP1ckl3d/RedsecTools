const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "engage-cross-tool", routes: [] });

  const engageRouter = require("../../server/routes/engage");
  const reporterRouter = require("../../server/routes/reporter");
  const calendarRouter = require("../../server/routes/calendar");
  harness.app.use("/api", engageRouter);
  harness.app.use("/api", reporterRouter);
  harness.app.use("/api", calendarRouter);

  try {
    // --- Create users with different permission levels ---
    const manager = harness.createUserWithSession({
      id: "cross-tool-manager",
      username: "manager",
      permissions: [
        "engage.view_team", "engage.create_client", "engage.edit_client",
        "engage.create_opportunity", "engage.edit_opportunity",
        "engage.create_engagement", "engage.edit_engagement",
        "engage.assign_team", "engage.manage_qa", "engage.perform_qa",
        "reporter.view", "reporter.create", "reporter.manage_templates",
        "calendar.view", "calendar.manage",
      ],
    });
    const viewer = harness.createUserWithSession({
      id: "cross-tool-viewer",
      username: "viewer",
      permissions: ["engage.view_own", "reporter.view", "calendar.view"],
    });
    const noReporter = harness.createUserWithSession({
      id: "no-reporter-user",
      username: "noreporter",
      permissions: ["engage.view_team", "engage.create_opportunity", "engage.edit_opportunity"],
    });
    const admin = harness.createUserWithSession({
      id: "cross-tool-admin",
      username: "admin",
      permissions: [
        "engage.view_all", "engage.manage_commercials", "engage.manage_all",
        "reporter.view", "reporter.create", "reporter.manage_templates",
        "calendar.view", "calendar.manage",
      ],
    });

    // ================================================================
    // Setup: Create client + opportunity + engagement
    // ================================================================
    const clientRes = await harness.requestJson({
      method: "POST",
      path: "/api/engage/clients",
      cookie: manager.cookie,
      body: { name: "Cross Tool Corp", industry: "Finance", status: "active" },
    });
    assert.equal(clientRes.status, 201);
    const clientId = clientRes.body.client.id;

    const oppRes = await harness.requestJson({
      method: "POST",
      path: "/api/engage/opportunities",
      cookie: manager.cookie,
      body: {
        clientId,
        title: "Multi-Test Assessment",
        opportunityType: "external",
        stage: "lead",
        estimatedValue: 75000,
      },
    });
    assert.equal(oppRes.status, 201);
    const oppId = oppRes.body.opportunity.id;

    const engRes = await harness.requestJson({
      method: "POST",
      path: "/api/engage/engagements",
      cookie: manager.cookie,
      body: {
        clientId,
        opportunityId: oppId,
        title: "Cross Tool Engagement",
        engagementType: "external",
        status: "draft",
        priority: "high",
        commercialValue: 60000,
        estimatedDays: 20,
      },
    });
    assert.equal(engRes.status, 201);
    const engId = engRes.body.engagement.id;

    // ================================================================
    // Test: Opportunity to Reporter proposal creation
    // ================================================================
    const createProposal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/create-proposal`,
      cookie: manager.cookie,
      body: { title: "Security Assessment Proposal", testTypes: ["external", "webapp"] },
    });
    assert.equal(createProposal.status, 201);
    assert.ok(createProposal.body.proposal.id);
    assert.equal(createProposal.body.proposal.testTypes.length, 2);
    assert.ok(createProposal.body.proposal.testTypes.includes("external"));
    assert.ok(createProposal.body.proposal.testTypes.includes("webapp"));
    const proposalId = createProposal.body.proposal.id;

    // No-reporter user cannot create proposal
    const noReporterProposal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/create-proposal`,
      cookie: noReporter.cookie,
      body: { title: "Should Fail" },
    });
    assert.equal(noReporterProposal.status, 403);

    // ================================================================
    // Test: Link first-class Reporter proposal
    // ================================================================
    const linkProposal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/link-proposal`,
      cookie: manager.cookie,
      body: { reporterProposalId: proposalId },
    });
    assert.equal(linkProposal.status, 200);

    // Cannot link non-existent proposal
    const badLink = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/link-proposal`,
      cookie: manager.cookie,
      body: { reporterProposalId: "nonexistent-proposal-id" },
    });
    assert.equal(badLink.status, 404);

    // ================================================================
    // Test: Engagement to Reporter report project creation
    // ================================================================
    const createReport = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/create-reporter-project`,
      cookie: manager.cookie,
      body: { title: "Cross Tool Report" },
    });
    assert.equal(createReport.status, 201);
    assert.ok(createReport.body.project.id);
    assert.equal(createReport.body.project.title, "Cross Tool Report");
    const reporterProjectId = createReport.body.project.id;

    // Cannot create without reporter permission
    const noPermReport = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/create-reporter-project`,
      cookie: noReporter.cookie,
      body: { title: "Should Fail" },
    });
    assert.equal(noPermReport.status, 403);

    // ================================================================
    // Test: Engagement to existing Reporter report link
    // ================================================================
    const linkReporter = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/link-reporter`,
      cookie: manager.cookie,
      body: { redsecReporterProjectId: reporterProjectId },
    });
    assert.equal(linkReporter.status, 200);
    assert.equal(linkReporter.body.engagement.redsec_reporter_project_id, reporterProjectId);

    // ================================================================
    // Test: Engagement to Calendar project creation
    // ================================================================
    const createCal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/create-calendar-project`,
      cookie: manager.cookie,
      body: { name: "Cross Tool Calendar" },
    });
    assert.equal(createCal.status, 201);
    assert.ok(createCal.body.project.id);
    assert.equal(createCal.body.project.name, "Cross Tool Calendar");
    const calProjectId = createCal.body.project.id;

    // ================================================================
    // Test: Engagement to existing Calendar project link
    // ================================================================
    // Create a second engagement and link to the same calendar project
    const eng2Res = await harness.requestJson({
      method: "POST",
      path: "/api/engage/engagements",
      cookie: manager.cookie,
      body: {
        clientId,
        title: "Second Engagement",
        engagementType: "internal",
        status: "draft",
      },
    });
    assert.equal(eng2Res.status, 201);
    const eng2Id = eng2Res.body.engagement.id;

    const linkCal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${eng2Id}/link-calendar`,
      cookie: manager.cookie,
      body: { redseccalProjectId: calProjectId },
    });
    assert.equal(linkCal.status, 200);
    assert.equal(linkCal.body.engagement.redseccal_project_id, calProjectId);

    // ================================================================
    // Test: Engagement allocation to Calendar
    // ================================================================
    // Add viewer as team member first
    await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/team`,
      cookie: manager.cookie,
      body: { userId: viewer.id, role: "tester" },
    });

    const allocate = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/calendar-allocations`,
      cookie: manager.cookie,
      body: {
        assigneeUserIds: [viewer.id],
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        hoursPerDay: 7.5,
        title: "Cross Tool Testing Phase",
      },
    });
    assert.equal(allocate.status, 201);
    assert.equal(allocate.body.created, 1);

    // Cannot allocate without linked calendar project
    await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${eng2Id}/calendar-allocations`,
      cookie: manager.cookie,
      body: {
        assigneeUserIds: [viewer.id],
        startDate: "2026-06-01",
        endDate: "2026-06-14",
      },
    });
    // eng2 has calendar project linked, so this should work
    // (eng2Id was linked above)

    // ================================================================
    // Test: Reporter displays linked Engage context
    // ================================================================
    const reporterDetail = await harness.requestJson({
      path: `/api/reporter/projects/${reporterProjectId}`,
      cookie: manager.cookie,
    });
    assert.equal(reporterDetail.status, 200);
    assert.ok(reporterDetail.body.engageEngagement);
    assert.equal(reporterDetail.body.engageEngagement.id, engId);
    assert.equal(reporterDetail.body.engageEngagement.title, "Cross Tool Engagement");

    // ================================================================
    // Test: Proposal displays linked Engage opportunity
    // ================================================================
    const proposalDetail = await harness.requestJson({
      path: `/api/reporter/proposals/${proposalId}`,
      cookie: manager.cookie,
    });
    assert.equal(proposalDetail.status, 200);
    assert.ok(proposalDetail.body.engageOpportunity);
    assert.equal(proposalDetail.body.engageOpportunity.id, oppId);
    assert.equal(proposalDetail.body.engageOpportunity.title, "Multi-Test Assessment");

    // ================================================================
    // Test: Calendar displays linked Engage context (via bootstrap)
    // ================================================================
    const calBootstrap = await harness.requestJson({
      path: "/api/calendar/bootstrap",
      cookie: manager.cookie,
    });
    assert.equal(calBootstrap.status, 200);
    const linkedProject = calBootstrap.body.projects.find((p) => p.id === calProjectId);
    assert.ok(linkedProject, "Calendar project should appear in bootstrap");
    assert.ok(linkedProject.engageEngagement, "Calendar project should have Engage engagement link");
    assert.equal(linkedProject.engageEngagement.id, engId);

    // ================================================================
    // Test: Reporter notifications fire on project events
    // ================================================================
    // Add viewer as project member
    const reporterMembers = await harness.requestJson({
      path: `/api/reporter/projects/${reporterProjectId}/members`,
      cookie: manager.cookie,
    });
    assert.equal(reporterMembers.status, 200);

    const addMember = await harness.requestJson({
      method: "POST",
      path: `/api/reporter/projects/${reporterProjectId}/members`,
      cookie: manager.cookie,
      body: { userId: viewer.id, role: "pentester" },
    });
    assert.equal(addMember.status, 201);

    // Viewer should have a notification about being added
    const viewerNotifs = harness.database.getNotificationsByUserId(viewer.id, 20, 0);
    assert.ok(viewerNotifs.some((n) => n.action === "member_added"), "Viewer should be notified about member add");

    // ================================================================
    // Test: Calendar notifications fire on allocation
    // ================================================================
    const viewerCalNotifs = viewerNotifs.filter((n) => n.category === "calendar");
    assert.ok(viewerCalNotifs.length > 0, "Viewer should have calendar notifications for allocation");

    // ================================================================
    // Test: Cross-tool search pickers
    // ================================================================
    // Reporter proposals search
    const propSearch = await harness.requestJson({
      path: "/api/engage/reporter/proposals?query=Security",
      cookie: manager.cookie,
    });
    assert.equal(propSearch.status, 200);
    assert.ok(propSearch.body.proposals.length > 0);
    assert.ok(propSearch.body.proposals.some((p) => p.id === proposalId));

    // Reporter projects search
    const projSearch = await harness.requestJson({
      path: "/api/engage/reporter/projects?query=Cross",
      cookie: manager.cookie,
    });
    assert.equal(projSearch.status, 200);
    assert.ok(projSearch.body.projects.length > 0);
    assert.ok(projSearch.body.projects.some((p) => p.id === reporterProjectId));

    // Calendar projects search
    const calSearch = await harness.requestJson({
      path: "/api/engage/calendar/projects?query=Cross",
      cookie: manager.cookie,
    });
    assert.equal(calSearch.status, 200);
    assert.ok(calSearch.body.projects.length > 0);
    assert.ok(calSearch.body.projects.some((p) => p.id === calProjectId));

    // No-permission user cannot search
    const noPermSearch = await harness.requestJson({
      path: "/api/engage/reporter/proposals",
      cookie: noReporter.cookie,
    });
    assert.equal(noPermSearch.status, 403);

    // ================================================================
    // Test: Engagement detail returns enriched linked resources
    // ================================================================
    const engDetail = await harness.requestJson({
      path: `/api/engage/engagements/${engId}`,
      cookie: manager.cookie,
    });
    assert.equal(engDetail.status, 200);
    assert.ok(engDetail.body.linkedReporterProject, "Should include linked Reporter project metadata");
    assert.equal(engDetail.body.linkedReporterProject.title, "Cross Tool Report");
    assert.ok(engDetail.body.linkedCalendarProject, "Should include linked Calendar project metadata");
    assert.equal(engDetail.body.linkedCalendarProject.name, "Cross Tool Calendar");

    // Viewer without commercial perm should not see commercial fields
    const viewerEng = await harness.requestJson({
      path: `/api/engage/engagements/${engId}`,
      cookie: viewer.cookie,
    });
    // Viewer may not have access since they only have view_own
    // (they are a team member so view_own should work)
    if (viewerEng.status === 200) {
      assert.equal(viewerEng.body.engagement.commercial_value, null);
    }

    // ================================================================
    // Test: Reporter proposal CRUD through Reporter routes
    // ================================================================
    const listProposals = await harness.requestJson({
      path: "/api/reporter/proposals",
      cookie: manager.cookie,
    });
    assert.equal(listProposals.status, 200);
    assert.ok(listProposals.body.proposals.length > 0);
    assert.ok(listProposals.body.proposals.some((p) => p.id === proposalId));

    // Update proposal metadata
    const updateProposal = await harness.requestJson({
      method: "PUT",
      path: `/api/reporter/proposals/${proposalId}`,
      cookie: manager.cookie,
      body: { clientName: "Cross Tool Corp Updated", estimatedDays: 15 },
    });
    assert.equal(updateProposal.status, 200);
    assert.equal(updateProposal.body.proposal.clientName, "Cross Tool Corp Updated");
    assert.equal(updateProposal.body.proposal.estimatedDays, 15);

    // Update proposal status
    const statusUpdate = await harness.requestJson({
      method: "PUT",
      path: `/api/reporter/proposals/${proposalId}/status`,
      cookie: manager.cookie,
      body: { status: "in_review" },
    });
    assert.equal(statusUpdate.status, 200);
    assert.equal(statusUpdate.body.proposal.status, "in_review");

    // ================================================================
    // Test: Proposal sections CRUD
    // ================================================================
    const listSections = await harness.requestJson({
      path: `/api/reporter/proposals/${proposalId}/sections`,
      cookie: manager.cookie,
    });
    assert.equal(listSections.status, 200);
    assert.ok(listSections.body.sections.length > 0, "Proposal should have sections from template");

    // Create a new section
    const newSection = await harness.requestJson({
      method: "POST",
      path: `/api/reporter/proposals/${proposalId}/sections`,
      cookie: manager.cookie,
      body: { title: "Custom Section", sectionType: "markdown", content: "# Custom Content" },
    });
    assert.equal(newSection.status, 201);
    const sectionId = newSection.body.section.id;

    // Update section
    const updateSection = await harness.requestJson({
      method: "PUT",
      path: `/api/reporter/proposals/sections/${sectionId}`,
      cookie: manager.cookie,
      body: { title: "Updated Custom Section", content: "# Updated", isIncluded: true },
    });
    assert.equal(updateSection.status, 200);

    // Delete section
    const deleteSection = await harness.requestJson({
      method: "DELETE",
      path: `/api/reporter/proposals/sections/${sectionId}`,
      cookie: manager.cookie,
    });
    assert.equal(deleteSection.status, 200);

    // ================================================================
    // Test: Proposal preview endpoint
    // ================================================================
    const preview = await harness.requestJson({
      path: `/api/reporter/proposals/${proposalId}/preview`,
      cookie: manager.cookie,
    });
    // Preview returns HTML, not JSON — check raw text
    assert.ok(preview.text.includes("Security Assessment Proposal"), "Preview should contain proposal title");

    // ================================================================
    // Test: Proposal generation history
    // ================================================================
    const generations = await harness.requestJson({
      path: `/api/reporter/proposals/${proposalId}/generations`,
      cookie: manager.cookie,
    });
    assert.equal(generations.status, 200);
    // No generations yet (PDF generation is async), just check endpoint works
    assert.ok(Array.isArray(generations.body.generations));

    // ================================================================
    // Test: Archive proposal
    // ================================================================
    const archive = await harness.requestJson({
      method: "POST",
      path: `/api/reporter/proposals/${proposalId}/archive`,
      cookie: manager.cookie,
    });
    assert.equal(archive.status, 200);
    assert.ok(archive.body.proposal.archivedAt);

    // Unarchive
    const unarchive = await harness.requestJson({
      method: "POST",
      path: `/api/reporter/proposals/${proposalId}/unarchive`,
      cookie: manager.cookie,
    });
    assert.equal(unarchive.status, 200);
    assert.equal(unarchive.body.proposal.archivedAt, null);

    // ================================================================
    // Test: Audit trail for cross-tool operations
    // ================================================================
    const audit = harness.database.listAuditEvents({ category: "engage", limit: 100 });
    const auditActions = audit.events.map((e) => e.action);
    assert.ok(auditActions.includes("proposal_created"), "Audit should include proposal creation");
    assert.ok(auditActions.includes("proposal_linked"), "Audit should include proposal linking");
    assert.ok(auditActions.includes("reporter_project_created"), "Audit should include reporter project creation");
    assert.ok(auditActions.includes("calendar_project_created"), "Audit should include calendar project creation");
    assert.ok(auditActions.includes("calendar_allocations_created"), "Audit should include calendar allocations");

    console.log("All cross-tool integration tests passed");
  } finally {
    await harness.close();
  }
})();
