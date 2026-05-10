const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "engage-routes", routes: [] });

  const engageRouter = require("../../server/routes/engage");
  harness.app.use("/api", engageRouter);

  try {
    // --- Create users with different permission levels ---
    const viewer = harness.createUserWithSession({
      id: "engage-viewer",
      username: "viewer",
      permissions: ["engage.view_own"],
    });
    const member = harness.createUserWithSession({
      id: "engage-member",
      username: "member",
      permissions: ["engage.view_own", "engage.perform_qa"],
    });
    const manager = harness.createUserWithSession({
      id: "engage-manager",
      username: "manager",
      permissions: [
        "engage.view_team", "engage.create_client", "engage.edit_client",
        "engage.create_opportunity", "engage.edit_opportunity",
        "engage.create_engagement", "engage.edit_engagement",
        "engage.assign_team", "engage.manage_qa", "engage.perform_qa",
      ],
    });
    const admin = harness.createUserWithSession({
      id: "engage-admin",
      username: "admin",
      permissions: ["engage.view_all", "engage.manage_commercials", "engage.manage_all"],
    });
    const noPerms = harness.createUserWithSession({
      id: "no-engage-perms",
      username: "nope",
      permissions: ["wiki.view"],
    });

    // ================================================================
    // Test: No permissions = 403 on all endpoints
    // ================================================================
    const noAccess = await harness.requestJson({ path: "/api/engage/clients", cookie: noPerms.cookie });
    assert.equal(noAccess.status, 403);

    const noEngAccess = await harness.requestJson({ path: "/api/engage/engagements", cookie: noPerms.cookie });
    assert.equal(noEngAccess.status, 403);

    // ================================================================
    // Test: Create client (manager only)
    // ================================================================
    const createClientRes = await harness.requestJson({
      method: "POST",
      path: "/api/engage/clients",
      cookie: manager.cookie,
      body: { name: "Acme Corp", industry: "Technology", website: "https://acme.test", status: "prospect" },
    });
    assert.equal(createClientRes.status, 201);
    assert.ok(createClientRes.body.client.id);
    assert.equal(createClientRes.body.client.name, "Acme Corp");
    assert.equal(createClientRes.body.client.industry, "Technology");
    assert.equal(createClientRes.body.client.status, "prospect");
    const clientId = createClientRes.body.client.id;

    // Viewer cannot create client
    const viewerCreate = await harness.requestJson({
      method: "POST",
      path: "/api/engage/clients",
      cookie: viewer.cookie,
      body: { name: "Fail Corp" },
    });
    assert.equal(viewerCreate.status, 403);

    // Name validation
    const noName = await harness.requestJson({
      method: "POST",
      path: "/api/engage/clients",
      cookie: manager.cookie,
      body: { industry: "Test" },
    });
    assert.equal(noName.status, 400);

    // ================================================================
    // Test: Get client
    // ================================================================
    const getClient = await harness.requestJson({
      path: `/api/engage/clients/${clientId}`,
      cookie: viewer.cookie,
    });
    assert.equal(getClient.status, 200);
    assert.equal(getClient.body.client.name, "Acme Corp");

    // ================================================================
    // Test: Update client
    // ================================================================
    const updateClient = await harness.requestJson({
      method: "PUT",
      path: `/api/engage/clients/${clientId}`,
      cookie: manager.cookie,
      body: { name: "Acme Corp Updated", status: "active" },
    });
    assert.equal(updateClient.status, 200);
    assert.equal(updateClient.body.client.name, "Acme Corp Updated");
    assert.equal(updateClient.body.client.status, "active");

    // ================================================================
    // Test: List clients
    // ================================================================
    const listClients = await harness.requestJson({
      path: "/api/engage/clients",
      cookie: viewer.cookie,
    });
    assert.equal(listClients.status, 200);
    assert.equal(listClients.body.clients.length, 1);

    // ================================================================
    // Test: Create client contacts
    // ================================================================
    const createContact = await harness.requestJson({
      method: "POST",
      path: `/api/engage/clients/${clientId}/contacts`,
      cookie: manager.cookie,
      body: { name: "Jane Doe", email: "jane@acme.test", contactType: "technical", isPrimary: true },
    });
    assert.equal(createContact.status, 201);
    assert.equal(createContact.body.contact.name, "Jane Doe");
    assert.equal(createContact.body.contact.contact_type, "technical");
    const contactId = createContact.body.contact.id;

    // List contacts
    const listContacts = await harness.requestJson({
      path: `/api/engage/clients/${clientId}/contacts`,
      cookie: viewer.cookie,
    });
    assert.equal(listContacts.status, 200);
    assert.equal(listContacts.body.contacts.length, 1);

    // Update contact
    const updateContact = await harness.requestJson({
      method: "PUT",
      path: `/api/engage/contacts/${contactId}`,
      cookie: manager.cookie,
      body: { name: "Jane Smith", email: "jane@acme.test" },
    });
    assert.equal(updateContact.status, 200);
    assert.equal(updateContact.body.contact.name, "Jane Smith");

    // ================================================================
    // Test: Create opportunity
    // ================================================================
    const createOpp = await harness.requestJson({
      method: "POST",
      path: "/api/engage/opportunities",
      cookie: manager.cookie,
      body: {
        clientId,
        title: "External Pentest Q2",
        opportunityType: "external",
        stage: "lead",
        estimatedValue: 50000,
        quotedValue: 45000,
        probabilityPercent: 30,
      },
    });
    assert.equal(createOpp.status, 201);
    assert.equal(createOpp.body.opportunity.title, "External Pentest Q2");
    assert.equal(createOpp.body.opportunity.opportunity_type, "[\"external\"]");
    const oppId = createOpp.body.opportunity.id;

    // ================================================================
    // Test: Commercial field gating
    // ================================================================
    // Manager (no manage_commercials) should NOT see estimated_value
    const managerOpp = await harness.requestJson({
      path: `/api/engage/opportunities/${oppId}`,
      cookie: manager.cookie,
    });
    assert.equal(managerOpp.status, 200);
    assert.equal(managerOpp.body.opportunity.estimated_value, null);
    assert.equal(managerOpp.body.opportunity.quoted_value, null);

    // Admin (has manage_commercials) SHOULD see estimated_value
    const adminOpp = await harness.requestJson({
      path: `/api/engage/opportunities/${oppId}`,
      cookie: admin.cookie,
    });
    assert.equal(adminOpp.status, 200);
    assert.equal(adminOpp.body.opportunity.estimated_value, 50000);
    assert.equal(adminOpp.body.opportunity.quoted_value, 45000);

    // ================================================================
    // Test: Update opportunity stage
    // ================================================================
    const stageUpdate = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/stage`,
      cookie: manager.cookie,
      body: { stage: "proposal_sent" },
    });
    assert.equal(stageUpdate.status, 200);
    assert.equal(stageUpdate.body.opportunity.stage, "proposal_sent");

    // Mark as won
    const wonOpp = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/stage`,
      cookie: manager.cookie,
      body: { stage: "won" },
    });
    assert.equal(wonOpp.status, 200);
    assert.equal(wonOpp.body.opportunity.stage, "won");
    assert.ok(wonOpp.body.opportunity.closed_at);

    const linkProposal = await harness.requestJson({
      method: "POST",
      path: `/api/engage/opportunities/${oppId}/link-proposal`,
      cookie: manager.cookie,
      body: { proposalReporterDocId: "proposal-project-1" },
    });
    assert.equal(linkProposal.status, 200);
    assert.equal(linkProposal.body.opportunity.proposal_reporter_doc_id, "proposal-project-1");

    // ================================================================
    // Test: Create engagement
    // ================================================================
    const createEng = await harness.requestJson({
      method: "POST",
      path: "/api/engage/engagements",
      cookie: manager.cookie,
      body: {
        clientId,
        opportunityId: oppId,
        title: "Acme External Pentest",
        engagementType: "external",
        status: "draft",
        priority: "high",
        commercialValue: 45000,
        estimatedDays: 15,
        highLevelScopeSummary: "External web application penetration test for the customer portal.",
      },
    });
    assert.equal(createEng.status, 201);
    assert.equal(createEng.body.engagement.title, "Acme External Pentest");
    assert.equal(createEng.body.engagement.priority, "high");
    const engId = createEng.body.engagement.id;

    // Commercial gating on engagements
    const managerEng = await harness.requestJson({
      path: `/api/engage/engagements/${engId}`,
      cookie: manager.cookie,
    });
    assert.equal(managerEng.body.engagement.commercial_value, null);

    const adminEng = await harness.requestJson({
      path: `/api/engage/engagements/${engId}`,
      cookie: admin.cookie,
    });
    assert.equal(adminEng.body.engagement.commercial_value, 45000);

    // ================================================================
    // Test: List engagements — manager sees all, viewer only sees own
    // ================================================================
    const managerList = await harness.requestJson({
      path: "/api/engage/engagements",
      cookie: manager.cookie,
    });
    assert.equal(managerList.status, 200);
    assert.equal(managerList.body.engagements.length, 1);

    // Viewer with view_own only sees engagements where they are a member
    const viewerList = await harness.requestJson({
      path: "/api/engage/engagements",
      cookie: viewer.cookie,
    });
    assert.equal(viewerList.status, 200);
    assert.equal(viewerList.body.engagements.length, 0);

    // ================================================================
    // Test: Team management
    // ================================================================
    const addMember = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/team`,
      cookie: manager.cookie,
      body: { userId: viewer.id, role: "tester" },
    });
    assert.equal(addMember.status, 201);
    assert.equal(addMember.body.member.user_id, viewer.id);
    assert.equal(addMember.body.member.role, "tester");
    const memberId = addMember.body.member.id;

    // List team
    const teamList = await harness.requestJson({
      path: `/api/engage/engagements/${engId}/team`,
      cookie: viewer.cookie,
    });
    assert.equal(teamList.status, 200);
    assert.equal(teamList.body.members.length, 1);

    // Now viewer should see the engagement (view_own + team member)
    const viewerEngList = await harness.requestJson({
      path: "/api/engage/engagements",
      cookie: viewer.cookie,
    });
    assert.equal(viewerEngList.status, 200);
    assert.equal(viewerEngList.body.engagements.length, 1);

    // Update member role
    const updateMember = await harness.requestJson({
      method: "PUT",
      path: `/api/engage/engagements/${engId}/team/${memberId}`,
      cookie: manager.cookie,
      body: { role: "technical_lead", isPrimary: true },
    });
    assert.equal(updateMember.status, 200);

    // Duplicate member should fail
    const dupMember = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/team`,
      cookie: manager.cookie,
      body: { userId: viewer.id, role: "tester" },
    });
    assert.equal(dupMember.status, 409);

    // Remove member
    const removeMember = await harness.requestJson({
      method: "DELETE",
      path: `/api/engage/engagements/${engId}/team/${memberId}`,
      cookie: manager.cookie,
    });
    assert.equal(removeMember.status, 200);

    // ================================================================
    // Test: Engagement status workflow
    // ================================================================
    const statusUpdate = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/status`,
      cookie: manager.cookie,
      body: { status: "scheduled" },
    });
    assert.equal(statusUpdate.status, 200);
    assert.equal(statusUpdate.body.engagement.status, "scheduled");

    const statusToTesting = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/status`,
      cookie: manager.cookie,
      body: { status: "testing_in_progress" },
    });
    assert.equal(statusToTesting.body.engagement.status, "testing_in_progress");

    const linkCalendar = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/link-calendar`,
      cookie: manager.cookie,
      body: { redseccalProjectId: "calendar-project-1" },
    });
    assert.equal(linkCalendar.status, 200);
    assert.equal(linkCalendar.body.engagement.redseccal_project_id, "calendar-project-1");

    const linkReporter = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/link-reporter`,
      cookie: manager.cookie,
      body: { redsecReporterProjectId: "reporter-project-1", deliveryReporterProjectId: "reporter-delivery-1" },
    });
    assert.equal(linkReporter.status, 200);
    assert.equal(linkReporter.body.engagement.redsec_reporter_project_id, "reporter-project-1");

    // ================================================================
    // Test: QA workflow
    // ================================================================
    const requestQa = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/qa/request`,
      cookie: manager.cookie,
      body: { reportLink: "/reporter/projects/abc" },
    });
    assert.equal(requestQa.status, 201);
    assert.equal(requestQa.body.review.status, "ready_for_qa");
    const qaId = requestQa.body.review.id;

    // Assign QA
    const assignQa = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/qa/assign`,
      cookie: manager.cookie,
      body: { assignedToUserId: member.id, qaReviewId: qaId },
    });
    assert.equal(assignQa.status, 200);
    assert.equal(assignQa.body.review.status, "assigned");
    assert.equal(assignQa.body.review.assigned_to_user_id, member.id);

    // QA status update (member has perform_qa)
    const qaStatus = await harness.requestJson({
      method: "POST",
      path: `/api/engage/qa/${qaId}/status`,
      cookie: member.cookie,
      body: { status: "reviewing" },
    });
    assert.equal(qaStatus.status, 200);
    assert.equal(qaStatus.body.review.status, "reviewing");

    // QA complete
    const qaComplete = await harness.requestJson({
      method: "POST",
      path: `/api/engage/qa/${qaId}/status`,
      cookie: member.cookie,
      body: { status: "ready_for_delivery", qaNotes: "Report looks good." },
    });
    assert.equal(qaComplete.status, 200);
    assert.equal(qaComplete.body.review.status, "ready_for_delivery");
    assert.ok(qaComplete.body.review.completed_at);

    const memberNotifications = harness.database.getNotificationsByUserId(member.id, 20, 0);
    assert.ok(memberNotifications.some((n) => n.action === "qa_assigned"));

    // ================================================================
    // Test: Notes
    // ================================================================
    const createNote = await harness.requestJson({
      method: "POST",
      path: `/api/engage/engagements/${engId}/notes`,
      cookie: manager.cookie,
      body: { content: "Initial scoping meeting completed." },
    });
    assert.equal(createNote.status, 201);
    assert.equal(createNote.body.note.content, "Initial scoping meeting completed.");

    // ================================================================
    // Test: Activity log
    // ================================================================
    const activity = await harness.requestJson({
      path: `/api/engage/engagements/${engId}/activity`,
      cookie: manager.cookie,
    });
    assert.equal(activity.status, 200);
    assert.ok(activity.body.activity.length > 0);
    const actions = activity.body.activity.map((a) => a.action);
    assert.ok(actions.includes("created"));
    assert.ok(actions.includes("status_changed"));
    assert.ok(actions.includes("qa_requested"));
    assert.ok(actions.includes("qa_assigned"));

    const audit = harness.database.listAuditEvents({ category: "engage", limit: 100 });
    const auditActions = audit.events.map((event) => event.action);
    assert.ok(auditActions.includes("opportunity_stage_changed"));
    assert.ok(auditActions.includes("proposal_linked"));
    assert.ok(auditActions.includes("calendar_project_linked"));
    assert.ok(auditActions.includes("reporter_project_linked"));
    assert.ok(auditActions.includes("qa_status_changed"));

    // ================================================================
    // Test: Archive client (admin only)
    // ================================================================
    const viewerArchive = await harness.requestJson({
      method: "POST",
      path: `/api/engage/clients/${clientId}/archive`,
      cookie: viewer.cookie,
    });
    assert.equal(viewerArchive.status, 403);

    // ================================================================
    // Test: 404 for nonexistent resources
    // ================================================================
    const notFound = await harness.requestJson({
      path: "/api/engage/clients/nonexistent",
      cookie: manager.cookie,
    });
    assert.equal(notFound.status, 404);

    // ================================================================
    // Test: Unauthenticated access is rejected
    // ================================================================
    const unauth = await harness.requestJson({ path: "/api/engage/clients" });
    assert.equal(unauth.status, 401);

    console.log("All Engage integration tests passed");
  } finally {
    await harness.close();
  }
})();
