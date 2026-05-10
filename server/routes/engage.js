const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { hasPermission } = require("../access");
const {
  createEngageClient, getEngageClientById, listEngageClients, updateEngageClient, archiveEngageClient,
  createEngageContact, getEngageContactById, updateEngageContact, archiveEngageContact,
  createEngageOpportunity, getEngageOpportunityById, listEngageOpportunities, listEngageOpportunitiesByClient, updateEngageOpportunity, updateEngageOpportunityStage,
  createEngageEngagement, getEngageEngagementById, listEngageEngagements, listEngageEngagementsByUser, listEngageEngagementsByClient,
  updateEngageEngagement, updateEngageEngagementStatus, archiveEngageEngagement,
  createEngageMember, listEngageMembersByEngagement, updateEngageMember, deleteEngageMember,
  createEngageQaReview, getEngageQaReviewById, updateEngageQaReview, listEngageQaReviewsByStatus, listEngageQaReviewsByAssignee,
  listEngageQaReviewsByEngagementEnriched, listEngageQaReviewsByStatusEnriched, listEngageQaReviewsByAssigneeEnriched, listAllEngageQaReviewsEnriched,
  createEngageNote, listEngageNotesByEntity,
  createEngageActivity, listEngageActivityByEntity,
  getEngageDashboardStats, getEngageMyWork, getEngageRecentActivity, getEngageRecentlyUpdated,
  getEngageUtilisationSummary, getEngageEngagementsWithoutTesters,
  getUnreadNotificationCount,
  listEngageContactsByClient,
  listUsers,
  listUsersByPermission,
  createAuditEvent,
} = require("../database");
const { createNotification } = require("../core/notifications");
const { logEvent } = require("../core/logger");

const ENG_STATUS_LABELS = {
  draft: "Draft", contract_signed: "Contract Signed", scheduled: "Scheduled",
  testing_not_started: "Testing Not Started", testing_in_progress: "Testing In Progress",
  testing_blocked: "Blocked", testing_complete: "Testing Complete",
  reporting_in_progress: "Reporting", ready_for_qa: "Ready for QA",
  qa_assigned: "QA Assigned", qa_in_progress: "QA In Progress",
  qa_changes_required: "QA Changes Required", qa_ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered", retest_pending: "Retest Pending",
  post_engagement_followup: "Follow-up", closed: "Closed", cancelled: "Cancelled",
};

const router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const COMMERCIAL_FIELDS = new Set(["estimated_value", "quoted_value", "commercial_value", "probability_percent"]);

function canSeeCommercials(req) {
  const set = req.access?.permissionSet;
  return set && (set.has("engage.manage_commercials") || set.has("engage.manage_all"));
}

function stripCommercialFields(record) {
  if (!record) return record;
  const stripped = { ...record };
  for (const key of COMMERCIAL_FIELDS) {
    if (key in stripped) stripped[key] = null;
  }
  return stripped;
}

function maybeStripCommercials(req, record) {
  if (!record) return record;
  return canSeeCommercials(req) ? record : stripCommercialFields(record);
}

function canViewEngage(req) {
  const set = req.access?.permissionSet;
  return set && (set.has("engage.view_own") || set.has("engage.view_team") || set.has("engage.view_all") || set.has("engage.manage_all"));
}

function canViewAll(req) {
  const set = req.access?.permissionSet;
  return set && (set.has("engage.view_team") || set.has("engage.view_all") || set.has("engage.manage_all"));
}

function canAccessEngagement(req, engagement) {
  if (!engagement) return false;
  if (canViewAll(req)) return true;
  if (engagement.created_by === req.user?.id) return true;
  if (engagement.engagement_manager_user_id === req.user?.id) return true;
  if (engagement.technical_lead_user_id === req.user?.id) return true;
  return listEngageMembersByEngagement(engagement.id).some((member) => member.user_id === req.user?.id);
}

function auditEngage(req, { action, targetType, targetId = null, outcome = "success", metadata = {} }) {
  try {
    createAuditEvent({
      actorUserId: req.user?.id || null,
      actorUsername: req.user?.username || null,
      actorType: req.user?.id ? "user" : "system",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "engage",
      action,
      targetType,
      targetId,
      outcome,
      metadata,
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
}

// ============================================================
// Dashboard and Statistics
// ============================================================

router.get("/engage/bootstrap", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const capabilities = {
      canViewAll: canViewAll(req),
      canSeeCommercials: canSeeCommercials(req),
      canCreateClient: req.access.permissionSet.has("engage.create_client") || req.access.permissionSet.has("engage.manage_all"),
      canCreateOpportunity: req.access.permissionSet.has("engage.create_opportunity") || req.access.permissionSet.has("engage.manage_all"),
      canCreateEngagement: req.access.permissionSet.has("engage.create_engagement") || req.access.permissionSet.has("engage.manage_all"),
      canAssignTeam: req.access.permissionSet.has("engage.assign_team") || req.access.permissionSet.has("engage.manage_all"),
      canManageQa: req.access.permissionSet.has("engage.manage_qa") || req.access.permissionSet.has("engage.manage_all"),
      canPerformQa: req.access.permissionSet.has("engage.perform_qa") || req.access.permissionSet.has("engage.manage_all"),
      canManageAll: req.access.permissionSet.has("engage.manage_all"),
    };

    const myWork = getEngageMyWork(req.user.id);
    const stats = getEngageDashboardStats();

    if (!canSeeCommercials(req)) {
      stats.pipelineValue = null;
      stats.weightedPipelineValue = null;
    }

    res.status(200).json({
      user: { id: req.user.id, username: req.user.username },
      capabilities,
      stats,
      myWork: {
        engagements: myWork.myEngagements.map((e) => maybeStripCommercials(req, e)),
        qaReviews: myWork.myQa,
      },
      recentActivity: canViewAll(req) ? getEngageRecentActivity() : [],
      notificationsSummary: { unreadCount: getUnreadNotificationCount(req.user.id) },
    });
  } catch {
    res.status(500).json({ error: "Failed to load bootstrap data." });
  }
});

router.get("/engage/dashboard", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const stats = getEngageDashboardStats();
    if (!canSeeCommercials(req)) {
      stats.pipelineValue = null;
      stats.weightedPipelineValue = null;
    }
    res.status(200).json({ stats });
  } catch {
    res.status(500).json({ error: "Failed to load dashboard." });
  }
});

router.get("/engage/pipeline-stats", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const stats = getEngageDashboardStats();
    res.status(200).json({
      pipelineValue: canSeeCommercials(req) ? stats.pipelineValue : null,
      weightedPipelineValue: canSeeCommercials(req) ? stats.weightedPipelineValue : null,
      openOpportunities: stats.openOpportunities,
      wonThisMonth: stats.wonThisMonth,
      lostThisMonth: stats.lostThisMonth,
      stageDistribution: stats.oppStageDistribution,
    });
  } catch {
    res.status(500).json({ error: "Failed to load pipeline stats." });
  }
});

router.get("/engage/status-summary", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const stats = getEngageDashboardStats();
    res.status(200).json({
      activeEngagements: stats.activeEngagements,
      scheduledEngagements: stats.scheduledEngagements,
      testingInProgress: stats.testingInProgress,
      reportingInProgress: stats.reportingInProgress,
      waitingForQA: stats.waitingForQA,
      qaInProgress: stats.qaInProgress,
      qaChangesRequired: stats.qaChangesRequired,
      readyForDelivery: stats.readyForDelivery,
      blockedEngagements: stats.blockedEngagements,
      overdueEngagements: stats.overdueEngagements,
      statusDistribution: stats.engStatusDistribution,
      blockedList: canViewAll(req) ? stats.blockedList : [],
      overdueList: canViewAll(req) ? stats.overdueList : [],
    });
  } catch {
    res.status(500).json({ error: "Failed to load status summary." });
  }
});

router.get("/engage/utilisation", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90);
    const utilisation = getEngageUtilisationSummary(days);
    const hoursPerDay = 8;
    const nowMs = Date.now();
    const endMs = nowMs + days * 86400000;
    let workingDays = 0;
    const cur = new Date(nowMs);
    cur.setHours(0, 0, 0, 0);
    const endDate = new Date(endMs);
    while (cur <= endDate) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) workingDays++;
      cur.setDate(cur.getDate() + 1);
    }
    const totalAvailableHours = workingDays * hoursPerDay;

    const enriched = utilisation.map((u) => ({
      ...u,
      available_hours: totalAvailableHours,
      utilisation_percent: totalAvailableHours > 0 ? Math.round((u.booked_hours / totalAvailableHours) * 100) : 0,
      is_overallocated: u.booked_hours > totalAvailableHours,
    }));

    const isManager = canViewAll(req);
    const filtered = isManager ? enriched : enriched.filter((u) => u.assignee_user_id === req.user.id);
    const overallocated = filtered.filter((u) => u.is_overallocated);
    const availableSoon = filtered.filter((u) => u.utilisation_percent < 50).sort((a, b) => a.utilisation_percent - b.utilisation_percent);

    const noTesters = isManager ? getEngageEngagementsWithoutTesters() : [];
    res.status(200).json({
      utilisation: filtered,
      engagementsWithoutTesters: noTesters,
      days,
      workingDays,
      totalAvailableHours,
      overallocated,
      availableSoon,
      isManager,
    });
  } catch {
    res.status(500).json({ error: "Failed to load utilisation." });
  }
});

// ============================================================
// Clients
// ============================================================

router.get("/engage/clients", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const clients = listEngageClients(limit, offset);
    res.status(200).json({ clients: clients.map((c) => maybeStripCommercials(req, c)) });
  } catch {
    res.status(500).json({ error: "Failed to list clients." });
  }
});

router.post("/engage/clients", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_client") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { name, displayName, industry, website, accountOwnerUserId, status, notes } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return res.status(400).json({ error: "Client name is required." });
    }
    const client = createEngageClient({
      name: name.trim(),
      displayName, industry, website, accountOwnerUserId, status, notes,
      createdBy: req.user.id,
    });
    createEngageActivity({
      entityType: "client", entityId: client.id, action: "created",
      userId: req.user.id, username: req.user.username, details: { name: client.name },
    });
    auditEngage(req, { action: "client_created", targetType: "engage_client", targetId: client.id, metadata: { name: client.name } });
    res.status(201).json({ client });
  } catch {
    res.status(500).json({ error: "Failed to create client." });
  }
});

router.get("/engage/clients/:id", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const client = getEngageClientById(req.params.id);
    if (!client || client.archived_at) return res.status(404).json({ error: "Client not found." });
    res.status(200).json({ client: maybeStripCommercials(req, client) });
  } catch {
    res.status(500).json({ error: "Failed to get client." });
  }
});

router.put("/engage/clients/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_client") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageClientById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Client not found." });
    const { name, displayName, industry, website, accountOwnerUserId, status, notes, defaultBillingContactId, defaultTechnicalContactId } = req.body;
    if (name !== undefined && (typeof name !== "string" || name.trim().length < 1)) {
      return res.status(400).json({ error: "Client name must not be empty." });
    }
    const client = updateEngageClient({
      id: req.params.id,
      name: name !== undefined ? name.trim() : existing.name,
      displayName: displayName !== undefined ? displayName : existing.display_name,
      industry: industry !== undefined ? industry : existing.industry,
      website: website !== undefined ? website : existing.website,
      accountOwnerUserId: accountOwnerUserId !== undefined ? accountOwnerUserId : existing.account_owner_user_id,
      status: status !== undefined ? status : existing.status,
      notes: notes !== undefined ? notes : existing.notes,
      defaultBillingContactId: defaultBillingContactId !== undefined ? defaultBillingContactId : existing.default_billing_contact_id,
      defaultTechnicalContactId: defaultTechnicalContactId !== undefined ? defaultTechnicalContactId : existing.default_technical_contact_id,
    });
    createEngageActivity({
      entityType: "client", entityId: client.id, action: "updated",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "client_updated", targetType: "engage_client", targetId: client.id, metadata: { changedFields: Object.keys(req.body || {}) } });
    res.status(200).json({ client });
  } catch {
    res.status(500).json({ error: "Failed to update client." });
  }
});

router.post("/engage/clients/:id/archive", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const archived = archiveEngageClient(req.params.id);
    if (!archived) return res.status(404).json({ error: "Client not found." });
    createEngageActivity({
      entityType: "client", entityId: req.params.id, action: "archived",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "client_archived", targetType: "engage_client", targetId: req.params.id });
    res.status(200).json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to archive client." });
  }
});

router.get("/engage/clients/:id/detail", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const client = getEngageClientById(req.params.id);
    if (!client || client.archived_at) return res.status(404).json({ error: "Client not found." });
    const contacts = listEngageContactsByClient(req.params.id);
    const opportunities = listEngageOpportunitiesByClient(req.params.id).map((o) => maybeStripCommercials(req, o));
    const engagements = listEngageEngagementsByClient(req.params.id).map((e) => maybeStripCommercials(req, e));
    const notes = listEngageNotesByEntity("client", req.params.id);
    const activity = listEngageActivityByEntity("client", req.params.id, 20);
    res.status(200).json({
      client: maybeStripCommercials(req, client),
      contacts,
      opportunities,
      engagements,
      notes,
      activity,
    });
  } catch {
    res.status(500).json({ error: "Failed to load client detail." });
  }
});

// ============================================================
// Client Contacts
// ============================================================

router.get("/engage/clients/:id/contacts", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const client = getEngageClientById(req.params.id);
    if (!client || client.archived_at) return res.status(404).json({ error: "Client not found." });
    const contacts = listEngageContactsByClient(req.params.id);
    res.status(200).json({ contacts });
  } catch {
    res.status(500).json({ error: "Failed to list contacts." });
  }
});

router.post("/engage/clients/:id/contacts", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_client") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const client = getEngageClientById(req.params.id);
    if (!client || client.archived_at) return res.status(404).json({ error: "Client not found." });
    const { name, title, email, phone, contactType, isPrimary, notes } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return res.status(400).json({ error: "Contact name is required." });
    }
    const contact = createEngageContact({
      clientId: req.params.id, name: name.trim(), title, email, phone, contactType, isPrimary, notes,
    });
    res.status(201).json({ contact });
  } catch {
    res.status(500).json({ error: "Failed to create contact." });
  }
});

router.put("/engage/contacts/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_client") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageContactById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Contact not found." });
    const { name, title, email, phone, contactType, isPrimary, notes } = req.body;
    const contact = updateEngageContact({
      id: req.params.id,
      name: name !== undefined ? name.trim() : existing.name,
      title: title !== undefined ? title : existing.title,
      email: email !== undefined ? email : existing.email,
      phone: phone !== undefined ? phone : existing.phone,
      contactType: contactType !== undefined ? contactType : existing.contact_type,
      isPrimary: isPrimary !== undefined ? isPrimary : existing.is_primary,
      notes: notes !== undefined ? notes : existing.notes,
    });
    res.status(200).json({ contact });
  } catch {
    res.status(500).json({ error: "Failed to update contact." });
  }
});

router.post("/engage/contacts/:id/archive", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const archived = archiveEngageContact(req.params.id);
    if (!archived) return res.status(404).json({ error: "Contact not found." });
    res.status(200).json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to archive contact." });
  }
});

// ============================================================
// Opportunities
// ============================================================

router.get("/engage/opportunities", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const clientId = req.query.clientId;
    let opportunities;
    if (clientId) {
      opportunities = listEngageOpportunitiesByClient(clientId);
    } else {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      opportunities = listEngageOpportunities(limit, offset);
    }
    res.status(200).json({ opportunities: opportunities.map((o) => maybeStripCommercials(req, o)) });
  } catch {
    res.status(500).json({ error: "Failed to list opportunities." });
  }
});

router.post("/engage/opportunities", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { clientId, title, opportunityType, stage, estimatedValue, quotedValue, estimatedDays,
      probabilityPercent, expectedStartDate, expectedDecisionDate, ownerUserId, notes } = req.body;
    if (!clientId || typeof clientId !== "string") return res.status(400).json({ error: "clientId is required." });
    if (!title || typeof title !== "string" || title.trim().length < 1) return res.status(400).json({ error: "Title is required." });
    const client = getEngageClientById(clientId);
    if (!client || client.archived_at) return res.status(400).json({ error: "Client not found." });
    const opportunity = createEngageOpportunity({
      clientId, title: title.trim(), opportunityType, stage, estimatedValue, quotedValue,
      estimatedDays, probabilityPercent, expectedStartDate, expectedDecisionDate,
      ownerUserId: ownerUserId || req.user.id, createdBy: req.user.id, notes,
    });
    createEngageActivity({
      entityType: "opportunity", entityId: opportunity.id, action: "created",
      userId: req.user.id, username: req.user.username, details: { title: opportunity.title },
    });
    auditEngage(req, { action: "opportunity_created", targetType: "engage_opportunity", targetId: opportunity.id, metadata: { title: opportunity.title, clientId } });
    res.status(201).json({ opportunity: maybeStripCommercials(req, opportunity) });
  } catch {
    res.status(500).json({ error: "Failed to create opportunity." });
  }
});

router.get("/engage/opportunities/:id", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const opp = getEngageOpportunityById(req.params.id);
    if (!opp) return res.status(404).json({ error: "Opportunity not found." });
    res.status(200).json({ opportunity: maybeStripCommercials(req, opp) });
  } catch {
    res.status(500).json({ error: "Failed to get opportunity." });
  }
});

router.put("/engage/opportunities/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });
    const body = req.body;
    const opportunity = updateEngageOpportunity({
      id: req.params.id,
      title: body.title !== undefined ? body.title.trim() : existing.title,
      opportunityType: body.opportunityType !== undefined ? body.opportunityType : existing.opportunity_type,
      stage: body.stage !== undefined ? body.stage : existing.stage,
      estimatedValue: body.estimatedValue !== undefined ? body.estimatedValue : existing.estimated_value,
      quotedValue: body.quotedValue !== undefined ? body.quotedValue : existing.quoted_value,
      estimatedDays: body.estimatedDays !== undefined ? body.estimatedDays : existing.estimated_days,
      probabilityPercent: body.probabilityPercent !== undefined ? body.probabilityPercent : existing.probability_percent,
      expectedStartDate: body.expectedStartDate !== undefined ? body.expectedStartDate : existing.expected_start_date,
      expectedDecisionDate: body.expectedDecisionDate !== undefined ? body.expectedDecisionDate : existing.expected_decision_date,
      proposalReporterDocId: body.proposalReporterDocId !== undefined ? body.proposalReporterDocId : existing.proposal_reporter_doc_id,
      proposalPdfGenerationId: body.proposalPdfGenerationId !== undefined ? body.proposalPdfGenerationId : existing.proposal_pdf_generation_id,
      ownerUserId: body.ownerUserId !== undefined ? body.ownerUserId : existing.owner_user_id,
      lostReason: body.lostReason !== undefined ? body.lostReason : existing.lost_reason,
      rejectedReason: body.rejectedReason !== undefined ? body.rejectedReason : existing.rejected_reason,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    });
    createEngageActivity({
      entityType: "opportunity", entityId: opportunity.id, action: "updated",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "opportunity_updated", targetType: "engage_opportunity", targetId: opportunity.id, metadata: { changedFields: Object.keys(body || {}) } });
    if (body.ownerUserId && body.ownerUserId !== existing.owner_user_id) {
      createNotification({
        userId: body.ownerUserId, category: "engage", action: "opportunity_assigned",
        title: "Opportunity assigned",
        body: `You were assigned opportunity "${opportunity.title}"`,
        linkUrl: "/engage", entityType: "opportunity", entityId: opportunity.id,
        severity: "info",
      });
    }
    res.status(200).json({ opportunity: maybeStripCommercials(req, opportunity) });
  } catch {
    res.status(500).json({ error: "Failed to update opportunity." });
  }
});

router.post("/engage/opportunities/:id/stage", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { stage } = req.body;
    if (!stage) return res.status(400).json({ error: "Stage is required." });
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });
    const opportunity = updateEngageOpportunityStage(req.params.id, stage);
    createEngageActivity({
      entityType: "opportunity", entityId: req.params.id, action: "stage_changed",
      userId: req.user.id, username: req.user.username,
      details: { from: existing.stage, to: stage },
    });
    auditEngage(req, { action: "opportunity_stage_changed", targetType: "engage_opportunity", targetId: req.params.id, metadata: { from: existing.stage, to: stage } });
    res.status(200).json({ opportunity: maybeStripCommercials(req, opportunity) });
  } catch {
    res.status(500).json({ error: "Failed to update stage." });
  }
});

// ============================================================
// Engagements
// ============================================================

router.get("/engage/engagements", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const clientId = req.query.clientId;
    let engagements;
    if (clientId) {
      engagements = listEngageEngagementsByClient(clientId);
    } else if (canViewAll(req)) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      engagements = listEngageEngagements(limit, offset);
    } else {
      engagements = listEngageEngagementsByUser(req.user.id);
    }
    res.status(200).json({ engagements: engagements.map((e) => maybeStripCommercials(req, e)) });
  } catch {
    res.status(500).json({ error: "Failed to list engagements." });
  }
});

router.post("/engage/engagements", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { clientId, opportunityId, title, engagementType, status, priority, commercialValue,
      estimatedDays, scheduledStartDate, scheduledEndDate,
      engagementManagerUserId, technicalLeadUserId, highLevelScopeSummary, notes } = req.body;
    if (!clientId) return res.status(400).json({ error: "clientId is required." });
    if (!title || typeof title !== "string" || title.trim().length < 1) return res.status(400).json({ error: "Title is required." });
    const client = getEngageClientById(clientId);
    if (!client || client.archived_at) return res.status(400).json({ error: "Client not found." });
    const engagement = createEngageEngagement({
      clientId, opportunityId, title: title.trim(), engagementType, status, priority,
      commercialValue, estimatedDays, scheduledStartDate, scheduledEndDate,
      engagementManagerUserId: engagementManagerUserId || req.user.id,
      technicalLeadUserId, highLevelScopeSummary, notes, createdBy: req.user.id,
    });
    createEngageActivity({
      entityType: "engagement", entityId: engagement.id, action: "created",
      userId: req.user.id, username: req.user.username, details: { title: engagement.title },
    });
    auditEngage(req, { action: "engagement_created", targetType: "engage_engagement", targetId: engagement.id, metadata: { title: engagement.title, clientId } });
    res.status(201).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to create engagement." });
  }
});

router.get("/engage/engagements/:id", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to get engagement." });
  }
});

router.put("/engage/engagements/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const body = req.body;
    const engagement = updateEngageEngagement({
      id: req.params.id,
      title: body.title !== undefined ? body.title.trim() : existing.title,
      engagementType: body.engagementType !== undefined ? body.engagementType : existing.engagement_type,
      status: body.status !== undefined ? body.status : existing.status,
      priority: body.priority !== undefined ? body.priority : existing.priority,
      commercialValue: body.commercialValue !== undefined ? body.commercialValue : existing.commercial_value,
      estimatedDays: body.estimatedDays !== undefined ? body.estimatedDays : existing.estimated_days,
      scheduledStartDate: body.scheduledStartDate !== undefined ? body.scheduledStartDate : existing.scheduled_start_date,
      scheduledEndDate: body.scheduledEndDate !== undefined ? body.scheduledEndDate : existing.scheduled_end_date,
      actualStartDate: body.actualStartDate !== undefined ? body.actualStartDate : existing.actual_start_date,
      actualEndDate: body.actualEndDate !== undefined ? body.actualEndDate : existing.actual_end_date,
      engagementManagerUserId: body.engagementManagerUserId !== undefined ? body.engagementManagerUserId : existing.engagement_manager_user_id,
      technicalLeadUserId: body.technicalLeadUserId !== undefined ? body.technicalLeadUserId : existing.technical_lead_user_id,
      redseccalProjectId: body.redseccalProjectId !== undefined ? body.redseccalProjectId : existing.redseccal_project_id,
      redsecReporterProjectId: body.redsecReporterProjectId !== undefined ? body.redsecReporterProjectId : existing.redsec_reporter_project_id,
      proposalReporterDocId: body.proposalReporterDocId !== undefined ? body.proposalReporterDocId : existing.proposal_reporter_doc_id,
      deliveryReporterProjectId: body.deliveryReporterProjectId !== undefined ? body.deliveryReporterProjectId : existing.delivery_reporter_project_id,
      highLevelScopeSummary: body.highLevelScopeSummary !== undefined ? body.highLevelScopeSummary : existing.high_level_scope_summary,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    });
    createEngageActivity({
      entityType: "engagement", entityId: engagement.id, action: "updated",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "engagement_updated", targetType: "engage_engagement", targetId: engagement.id, metadata: { changedFields: Object.keys(body || {}) } });
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to update engagement." });
  }
});

router.post("/engage/engagements/:id/status", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required." });
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const engagement = updateEngageEngagementStatus(req.params.id, status);
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "status_changed",
      userId: req.user.id, username: req.user.username,
      details: { from: existing.status, to: status },
    });
    auditEngage(req, { action: "engagement_status_changed", targetType: "engage_engagement", targetId: req.params.id, metadata: { from: existing.status, to: status } });
    const notifyUserIds = [existing.engagement_manager_user_id, existing.technical_lead_user_id].filter(Boolean);
    const blockedStatuses = new Set(["testing_blocked", "qa_changes_required"]);
    for (const uid of notifyUserIds) {
      createNotification({
        userId: uid, category: "engage", action: "engagement_status_changed",
        title: "Engagement status updated",
        body: `${existing.title} moved to ${ENG_STATUS_LABELS[status] || status}`,
        linkUrl: `/engage`, entityType: "engagement", entityId: req.params.id,
        severity: blockedStatuses.has(status) ? "warning" : "info",
      });
    }
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to update status." });
  }
});

router.post("/engage/engagements/:id/archive", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const archived = archiveEngageEngagement(req.params.id);
    if (!archived) return res.status(404).json({ error: "Engagement not found." });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "archived",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "engagement_archived", targetType: "engage_engagement", targetId: req.params.id });
    res.status(200).json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to archive engagement." });
  }
});

router.get("/engage/engagements/:id/detail", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const team = listEngageMembersByEngagement(req.params.id);
    const activity = listEngageActivityByEntity("engagement", req.params.id, 30);
    const notes = listEngageNotesByEntity("engagement", req.params.id);
    const qaReviews = listEngageQaReviewsByEngagementEnriched(req.params.id);
    res.status(200).json({
      engagement: maybeStripCommercials(req, engagement),
      team,
      activity,
      notes,
      qaReviews,
    });
  } catch {
    res.status(500).json({ error: "Failed to load engagement detail." });
  }
});

router.get("/engage/users", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const users = listUsers(1, 200).users || [];
    res.status(200).json({ users: users.map((u) => ({ id: u.id, username: u.username })) });
  } catch {
    res.status(500).json({ error: "Failed to list users." });
  }
});

// ============================================================
// Team Members
// ============================================================

router.get("/engage/engagements/:id/team", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const members = listEngageMembersByEngagement(req.params.id);
    res.status(200).json({ members });
  } catch {
    res.status(500).json({ error: "Failed to list team." });
  }
});

router.post("/engage/engagements/:id/team", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.assign_team") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const { userId, role, isPrimary } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required." });
    const member = createEngageMember({ engagementId: req.params.id, userId, role, isPrimary });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "member_added",
      userId: req.user.id, username: req.user.username, details: { memberUserId: userId, role },
    });
    auditEngage(req, { action: "team_member_added", targetType: "engage_engagement", targetId: req.params.id, metadata: { memberUserId: userId, role } });
    createNotification({
      userId, category: "engage", action: "engagement_assigned",
      title: "Assigned to engagement",
      body: `You were added to "${engagement.title}" as ${role}`,
      linkUrl: "/engage", entityType: "engagement", entityId: req.params.id,
      severity: "info",
    });
    res.status(201).json({ member });
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "User is already a team member." });
    }
    res.status(500).json({ error: "Failed to add team member." });
  }
});

router.put("/engage/engagements/:id/team/:memberId", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.assign_team") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const { role, isPrimary } = req.body;
    const member = updateEngageMember({ id: req.params.memberId, engagementId: req.params.id, role, isPrimary });
    if (!member) return res.status(404).json({ error: "Team member not found." });
    auditEngage(req, { action: "team_member_updated", targetType: "engage_engagement", targetId: req.params.id, metadata: { memberId: req.params.memberId, role, isPrimary } });
    res.status(200).json({ member });
  } catch {
    res.status(500).json({ error: "Failed to update team member." });
  }
});

router.delete("/engage/engagements/:id/team/:memberId", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.assign_team") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const deleted = deleteEngageMember(req.params.memberId);
    if (!deleted) return res.status(404).json({ error: "Team member not found." });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "member_removed",
      userId: req.user.id, username: req.user.username, details: { memberId: req.params.memberId },
    });
    auditEngage(req, { action: "team_member_removed", targetType: "engage_engagement", targetId: req.params.id, metadata: { memberId: req.params.memberId } });
    res.status(200).json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to remove team member." });
  }
});

// ============================================================
// QA Reviews
// ============================================================

router.get("/engage/qa", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const { status, assignee } = req.query;
    let reviews;
    if (status === "all") {
      reviews = listAllEngageQaReviewsEnriched();
    } else if (status) {
      reviews = listEngageQaReviewsByStatusEnriched(status);
    } else if (assignee) {
      reviews = listEngageQaReviewsByAssigneeEnriched(assignee);
    } else {
      reviews = listEngageQaReviewsByStatusEnriched("ready_for_qa");
    }
    res.status(200).json({ reviews });
  } catch {
    res.status(500).json({ error: "Failed to list QA reviews." });
  }
});

router.post("/engage/engagements/:id/qa/request", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const { reporterProjectId, reportLink, shareLink, qaNotes } = req.body;
    const review = createEngageQaReview({
      engagementId: req.params.id, reporterProjectId, status: "ready_for_qa", reportLink, shareLink,
      qaNotes: qaNotes || "",
    });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "qa_requested",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "qa_requested", targetType: "engage_engagement", targetId: req.params.id, metadata: { qaReviewId: review.id, reporterProjectId: reporterProjectId || null } });
    const managers = listUsersByPermission("engage.manage_qa");
    const notified = new Set();
    for (const mgr of managers) {
      if (mgr.id === req.user.id || notified.has(mgr.id)) continue;
      notified.add(mgr.id);
      createNotification({
        userId: mgr.id, category: "engage", action: "qa_requested",
        title: "QA review requested",
        body: `QA requested for "${engagement.title}"`,
        linkUrl: "/engage", entityType: "engagement", entityId: req.params.id,
        severity: "info",
      });
    }
    res.status(201).json({ review });
  } catch {
    res.status(500).json({ error: "Failed to request QA." });
  }
});

router.post("/engage/engagements/:id/qa/assign", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.manage_qa") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const { assignedToUserId, qaReviewId } = req.body;
    if (!assignedToUserId) return res.status(400).json({ error: "assignedToUserId is required." });
    const existingReview = qaReviewId ? getEngageQaReviewById(qaReviewId) : null;
    if (existingReview) {
      const review = updateEngageQaReview({
        id: qaReviewId, status: "assigned", assignedToUserId,
      });
      createEngageActivity({
        entityType: "engagement", entityId: req.params.id, action: "qa_assigned",
        userId: req.user.id, username: req.user.username, details: { assignedToUserId },
      });
      auditEngage(req, { action: "qa_assigned", targetType: "engage_qa_review", targetId: qaReviewId, metadata: { engagementId: req.params.id, assignedToUserId } });
      createNotification({
        userId: assignedToUserId, category: "engage", action: "qa_assigned",
        title: "QA review assigned",
        body: `You were assigned a QA review for "${engagement.title}"`,
        linkUrl: "/engage", entityType: "engagement", entityId: req.params.id,
        severity: "info",
      });
      res.status(200).json({ review });
    } else {
      const review = createEngageQaReview({
        engagementId: req.params.id, assignedByUserId: req.user.id,
        assignedToUserId, status: "assigned",
      });
      createEngageActivity({
        entityType: "engagement", entityId: req.params.id, action: "qa_assigned",
        userId: req.user.id, username: req.user.username, details: { assignedToUserId },
      });
      auditEngage(req, { action: "qa_assigned", targetType: "engage_qa_review", targetId: review.id, metadata: { engagementId: req.params.id, assignedToUserId } });
      createNotification({
        userId: assignedToUserId, category: "engage", action: "qa_assigned",
        title: "QA review assigned",
        body: `You were assigned a QA review for "${engagement.title}"`,
        linkUrl: "/engage", entityType: "engagement", entityId: req.params.id,
        severity: "info",
      });
      res.status(201).json({ review });
    }
  } catch {
    res.status(500).json({ error: "Failed to assign QA." });
  }
});

router.post("/engage/qa/:id/status", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.perform_qa") && !set.has("engage.manage_qa") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageQaReviewById(req.params.id);
    if (!existing) return res.status(404).json({ error: "QA review not found." });
    const { status, qaNotes, reportLink, shareLink } = req.body;
    if (!status) return res.status(400).json({ error: "Status is required." });
    const completedStatuses = new Set(["ready_for_delivery", "delivered", "cancelled"]);
    const completedAt = completedStatuses.has(status) ? Math.floor(Date.now() / 1000) : null;
    const review = updateEngageQaReview({
      id: req.params.id, status, qaNotes, reportLink, shareLink, completedAt,
    });
    createEngageActivity({
      entityType: "engagement", entityId: existing.engagement_id, action: "qa_status_changed",
      userId: req.user.id, username: req.user.username,
      details: { from: existing.status, to: status },
    });
    auditEngage(req, { action: "qa_status_changed", targetType: "engage_qa_review", targetId: req.params.id, metadata: { engagementId: existing.engagement_id, from: existing.status, to: status } });
    const eng = getEngageEngagementById(existing.engagement_id);
    const notifyTargets = new Set();
    if (existing.assigned_to_user_id && existing.assigned_to_user_id !== req.user.id) notifyTargets.add(existing.assigned_to_user_id);
    if (eng && eng.engagement_manager_user_id && eng.engagement_manager_user_id !== req.user.id) notifyTargets.add(eng.engagement_manager_user_id);
    const warningStatuses = new Set(["requires_more_work"]);
    for (const uid of notifyTargets) {
      createNotification({
        userId: uid, category: "engage", action: "qa_status_changed",
        title: "QA status updated",
        body: `QA for "${eng ? eng.title : "engagement"}" changed to ${status.replace(/_/g, " ")}`,
        linkUrl: "/engage", entityType: "engagement", entityId: existing.engagement_id,
        severity: warningStatuses.has(status) ? "warning" : "info",
      });
    }
    res.status(200).json({ review });
  } catch {
    res.status(500).json({ error: "Failed to update QA status." });
  }
});

// ============================================================
// Notes and Activity
// ============================================================

router.get("/engage/engagements/:id/activity", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const activity = listEngageActivityByEntity("engagement", req.params.id, 50);
    const notes = listEngageNotesByEntity("engagement", req.params.id);
    res.status(200).json({ activity, notes });
  } catch {
    res.status(500).json({ error: "Failed to get activity." });
  }
});

router.post("/engage/engagements/:id/notes", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canAccessEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length < 1) {
      return res.status(400).json({ error: "Content is required." });
    }
    const note = createEngageNote({
      entityType: "engagement", entityId: req.params.id,
      userId: req.user.id, content: content.trim(),
    });
    res.status(201).json({ note });
  } catch {
    res.status(500).json({ error: "Failed to create note." });
  }
});

router.post("/engage/opportunities/:id/notes", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const opp = getEngageOpportunityById(req.params.id);
    if (!opp) return res.status(404).json({ error: "Opportunity not found." });
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length < 1) {
      return res.status(400).json({ error: "Content is required." });
    }
    const note = createEngageNote({
      entityType: "opportunity", entityId: req.params.id,
      userId: req.user.id, content: content.trim(),
    });
    res.status(201).json({ note });
  } catch {
    res.status(500).json({ error: "Failed to create note." });
  }
});

router.post("/engage/clients/:id/notes", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  try {
    const client = getEngageClientById(req.params.id);
    if (!client || client.archived_at) return res.status(404).json({ error: "Client not found." });
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length < 1) {
      return res.status(400).json({ error: "Content is required." });
    }
    const note = createEngageNote({
      entityType: "client", entityId: req.params.id,
      userId: req.user.id, content: content.trim(),
    });
    res.status(201).json({ note });
  } catch {
    res.status(500).json({ error: "Failed to create note." });
  }
});

// ============================================================
// Linking and Conversion Endpoints
// ============================================================

router.post("/engage/opportunities/:id/link-proposal", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });
    const { proposalReporterDocId, proposalPdfGenerationId } = req.body;
    if (!proposalReporterDocId && !proposalPdfGenerationId) {
      return res.status(400).json({ error: "proposalReporterDocId or proposalPdfGenerationId is required." });
    }
    const opportunity = updateEngageOpportunity({
      id: req.params.id,
      title: existing.title, opportunityType: existing.opportunity_type, stage: existing.stage,
      estimatedValue: existing.estimated_value, quotedValue: existing.quoted_value,
      estimatedDays: existing.estimated_days, probabilityPercent: existing.probability_percent,
      expectedStartDate: existing.expected_start_date, expectedDecisionDate: existing.expected_decision_date,
      proposalReporterDocId: proposalReporterDocId || existing.proposal_reporter_doc_id,
      proposalPdfGenerationId: proposalPdfGenerationId || existing.proposal_pdf_generation_id,
      ownerUserId: existing.owner_user_id, lostReason: existing.lost_reason,
      rejectedReason: existing.rejected_reason, notes: existing.notes,
    });
    createEngageActivity({
      entityType: "opportunity", entityId: req.params.id, action: "proposal_linked",
      userId: req.user.id, username: req.user.username,
      details: { proposalReporterDocId, proposalPdfGenerationId },
    });
    auditEngage(req, { action: "proposal_linked", targetType: "engage_opportunity", targetId: req.params.id, metadata: { proposalReporterDocId, proposalPdfGenerationId } });
    res.status(200).json({ opportunity: maybeStripCommercials(req, opportunity) });
  } catch {
    res.status(500).json({ error: "Failed to link proposal." });
  }
});

router.post("/engage/opportunities/:id/convert-to-engagement", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });
    if (existing.stage !== "won") {
      return res.status(400).json({ error: "Only won opportunities can be converted to engagements." });
    }
    const { title, engagementType, priority, commercialValue, estimatedDays,
      scheduledStartDate, scheduledEndDate, engagementManagerUserId, technicalLeadUserId,
      highLevelScopeSummary } = req.body;
    const engagement = createEngageEngagement({
      clientId: existing.client_id,
      opportunityId: existing.id,
      title: title || existing.title,
      engagementType: engagementType || (() => { try { const a = JSON.parse(existing.opportunity_type); return Array.isArray(a) ? a[0] : "custom"; } catch { return existing.opportunity_type || "custom"; } })(),
      status: "draft",
      priority: priority || "normal",
      commercialValue: commercialValue ?? existing.quoted_value,
      estimatedDays: estimatedDays ?? existing.estimated_days,
      scheduledStartDate, scheduledEndDate,
      engagementManagerUserId: engagementManagerUserId || existing.owner_user_id,
      technicalLeadUserId,
      highLevelScopeSummary: highLevelScopeSummary || "",
      notes: `Converted from opportunity: ${existing.title}`,
      createdBy: req.user.id,
    });
    createEngageActivity({
      entityType: "opportunity", entityId: existing.id, action: "converted_to_engagement",
      userId: req.user.id, username: req.user.username,
      details: { engagementId: engagement.id },
    });
    createEngageActivity({
      entityType: "engagement", entityId: engagement.id, action: "created_from_opportunity",
      userId: req.user.id, username: req.user.username,
      details: { opportunityId: existing.id, title: existing.title },
    });
    auditEngage(req, { action: "opportunity_converted_to_engagement", targetType: "engage_opportunity", targetId: existing.id, metadata: { engagementId: engagement.id } });
    res.status(201).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to convert opportunity." });
  }
});

router.post("/engage/engagements/:id/link-calendar", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const { redseccalProjectId } = req.body;
    if (!redseccalProjectId) return res.status(400).json({ error: "redseccalProjectId is required." });
    const engagement = updateEngageEngagement({
      id: req.params.id, title: existing.title, engagementType: existing.engagement_type,
      status: existing.status, priority: existing.priority, commercialValue: existing.commercial_value,
      estimatedDays: existing.estimated_days, scheduledStartDate: existing.scheduled_start_date,
      scheduledEndDate: existing.scheduled_end_date, actualStartDate: existing.actual_start_date,
      actualEndDate: existing.actual_end_date,
      engagementManagerUserId: existing.engagement_manager_user_id,
      technicalLeadUserId: existing.technical_lead_user_id,
      redseccalProjectId,
      redsecReporterProjectId: existing.redsec_reporter_project_id,
      proposalReporterDocId: existing.proposal_reporter_doc_id,
      deliveryReporterProjectId: existing.delivery_reporter_project_id,
      highLevelScopeSummary: existing.high_level_scope_summary, notes: existing.notes,
    });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "calendar_linked",
      userId: req.user.id, username: req.user.username,
      details: { redseccalProjectId },
    });
    auditEngage(req, { action: "calendar_project_linked", targetType: "engage_engagement", targetId: req.params.id, metadata: { redseccalProjectId } });
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to link calendar project." });
  }
});

router.post("/engage/engagements/:id/link-reporter", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    const { redsecReporterProjectId, proposalReporterDocId, deliveryReporterProjectId } = req.body;
    if (!redsecReporterProjectId && !proposalReporterDocId && !deliveryReporterProjectId) {
      return res.status(400).json({ error: "At least one Reporter link field is required." });
    }
    const engagement = updateEngageEngagement({
      id: req.params.id, title: existing.title, engagementType: existing.engagement_type,
      status: existing.status, priority: existing.priority, commercialValue: existing.commercial_value,
      estimatedDays: existing.estimated_days, scheduledStartDate: existing.scheduled_start_date,
      scheduledEndDate: existing.scheduled_end_date, actualStartDate: existing.actual_start_date,
      actualEndDate: existing.actual_end_date,
      engagementManagerUserId: existing.engagement_manager_user_id,
      technicalLeadUserId: existing.technical_lead_user_id,
      redseccalProjectId: existing.redseccal_project_id,
      redsecReporterProjectId: redsecReporterProjectId || existing.redsec_reporter_project_id,
      proposalReporterDocId: proposalReporterDocId || existing.proposal_reporter_doc_id,
      deliveryReporterProjectId: deliveryReporterProjectId || existing.delivery_reporter_project_id,
      highLevelScopeSummary: existing.high_level_scope_summary, notes: existing.notes,
    });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "reporter_linked",
      userId: req.user.id, username: req.user.username,
      details: { redsecReporterProjectId, proposalReporterDocId, deliveryReporterProjectId },
    });
    auditEngage(req, { action: "reporter_project_linked", targetType: "engage_engagement", targetId: req.params.id, metadata: { redsecReporterProjectId, proposalReporterDocId, deliveryReporterProjectId } });
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to link Reporter project." });
  }
});

router.put("/engage/qa/:id", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.manage_qa") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageQaReviewById(req.params.id);
    if (!existing) return res.status(404).json({ error: "QA review not found." });
    const { status, qaNotes, reportLink, shareLink, assignedToUserId } = req.body;
    const completedStatuses = new Set(["ready_for_delivery", "delivered", "cancelled"]);
    const completedAt = status && completedStatuses.has(status) ? Math.floor(Date.now() / 1000) : existing.completed_at;
    const review = updateEngageQaReview({
      id: req.params.id,
      status: status || existing.status,
      qaNotes: qaNotes !== undefined ? qaNotes : existing.qa_notes,
      reportLink: reportLink !== undefined ? reportLink : existing.report_link,
      shareLink: shareLink !== undefined ? shareLink : existing.share_link,
      assignedToUserId: assignedToUserId || existing.assigned_to_user_id,
      completedAt,
    });
    createEngageActivity({
      entityType: "engagement", entityId: existing.engagement_id, action: "qa_updated",
      userId: req.user.id, username: req.user.username,
    });
    auditEngage(req, { action: "qa_updated", targetType: "engage_qa_review", targetId: req.params.id, metadata: { engagementId: existing.engagement_id, changedFields: Object.keys(req.body || {}) } });
    res.status(200).json({ review });
  } catch {
    res.status(500).json({ error: "Failed to update QA review." });
  }
});

module.exports = router;
