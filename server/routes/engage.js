const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { hasPermission } = require("../access");
const {
  createEngageClient, getEngageClientById, listEngageClients, updateEngageClient, archiveEngageClient,
  createEngageContact, getEngageContactById, updateEngageContact, archiveEngageContact,
  createEngageOpportunity, getEngageOpportunityById, listEngageOpportunities, listEngageOpportunitiesByClient, updateEngageOpportunity, updateEngageOpportunityStage,
  linkEngageOpportunityProposal,
  listOppProposalLinks,
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
  getSetting,
} = require("../database");
const {
  getReporterProposalById,
  listReporterProposals,
  createReporterProposalRow,
  listReporterProposalTemplates,
  getReporterProposalTemplateById,
  listReporterProposalTemplateSections,
  getReporterTestTypeTemplateByType,
  listReporterProjects,
  listCalendarProjects,
  getReporterProjectById,
  listReporterPdfGenerationsByProject,
  getCalendarProjectById,
  createReporterProjectRow,
  listReporterDesigns,
  createCalendarProject,
  createCalendarEntry,
  getEngageEngagementByCalendarProject,
} = require("../database");
const { createNotification } = require("../core/notifications");
const { logEvent } = require("../core/logger");

const ENG_STATUS_LABELS = {
  draft: "Draft", contract_signed: "Contract Signed", scheduled: "Scheduled",
  testing_not_started: "Testing Not Started", testing_in_progress: "Testing In Progress",
  testing_blocked: "Blocked", testing_complete: "Testing Complete",
  reporting_in_progress: "Reporting", ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered", retest_pending: "Retest Pending",
  post_engagement_followup: "Follow-up", closed: "Closed", cancelled: "Cancelled",
};
const ENG_CONTROL_STATUSES = new Set(Object.keys(ENG_STATUS_LABELS));

const router = Router();
const DAY_SECONDS = 24 * 60 * 60;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseClockTimeToMinutes(value, fallback) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return (hours * 60) + minutes;
}

function getEngageCalendarSettings() {
  const parsed = Number.parseFloat(getSetting("calendar_daily_hours"));
  const dailyHours = !Number.isFinite(parsed) ? 7.6 : clamp(Number(parsed.toFixed(2)), 1, 24);
  const workdayStart = String(getSetting("calendar_workday_start") || "08:30");
  const workdayEnd = String(getSetting("calendar_workday_end") || "17:30");
  const workdays = String(getSetting("calendar_workdays") || "1,2,3,4,5")
    .split(",")
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const workdayStartMinutes = parseClockTimeToMinutes(workdayStart, 8 * 60 + 30);
  const workdayEndMinutes = parseClockTimeToMinutes(workdayEnd, 17 * 60 + 30);
  const workdaySpanHours = Math.max(1, Number((((workdayEndMinutes - workdayStartMinutes) || (9 * 60)) / 60).toFixed(2)));
  return {
    dailyHours,
    workdayStartMinutes,
    workdaySpanHours,
    workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
  };
}

function parseDateInputParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

function getClientOffsetMinutes(tzOffsetMinutes) {
  return Number.isFinite(tzOffsetMinutes) ? Number(tzOffsetMinutes) : -new Date().getTimezoneOffset();
}

function formatDateInputParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getOffsetMinutesForTimeZone(timeZone, dateValue) {
  if (!timeZone || typeof timeZone !== "string") return undefined;
  const parts = parseDateInputParts(dateValue);
  if (!parts) return undefined;
  try {
    const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
    const zonedParts = new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(utcNoon).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    const zonedAsUtc = Date.UTC(
      Number(zonedParts.year),
      Number(zonedParts.month) - 1,
      Number(zonedParts.day),
      Number(zonedParts.hour),
      Number(zonedParts.minute),
      Number(zonedParts.second),
      0,
    );
    return Math.round((zonedAsUtc - utcNoon.getTime()) / 60000);
  } catch (_) {
    return undefined;
  }
}

function wallClockUnix(parts, minutesOfDay, tzOffsetMinutes, timeZone) {
  const safeMinutes = Number.isFinite(minutesOfDay) ? minutesOfDay : 0;
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  const effectiveOffset = getOffsetMinutesForTimeZone(timeZone, formatDateInputParts(parts));
  const offsetMs = getClientOffsetMinutes(Number.isFinite(effectiveOffset) ? effectiveOffset : tzOffsetMinutes) * 60 * 1000;
  return Math.floor((Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0) - offsetMs) / 1000);
}

function parseDateRangeToUnix(startDate, endDate, tzOffsetMinutes, timeZone) {
  const startParts = parseDateInputParts(startDate);
  const endParts = parseDateInputParts(endDate);
  if (!startParts || !endParts) return null;
  const startsAt = wallClockUnix(startParts, 0, tzOffsetMinutes, timeZone);
  const endsAt = wallClockUnix(endParts, (23 * 60) + 59, tzOffsetMinutes, timeZone);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) return null;
  return { startsAt, endsAt };
}

function buildDailyAllocationSegments(startsAt, endsAt, hoursPerDay, workdaysOnly, settings, tzOffsetMinutes, timeZone) {
  const tzMs = getClientOffsetMinutes(tzOffsetMinutes) * 60 * 1000;
  const start = new Date((startsAt * 1000) + tzMs);
  const end = new Date((endsAt * 1000) + tzMs);
  const segments = [];
  const clampedHours = clamp(Number(hoursPerDay || 0), 0.5, settings.dailyHours);
  const segmentSpanHours = clamp(Number(((clampedHours / settings.dailyHours) * settings.workdaySpanHours).toFixed(2)), 0.5, 24);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  for (let cursorMs = startDay; cursorMs <= endDay; cursorMs += DAY_SECONDS * 1000) {
    const cursor = new Date(cursorMs);
    if (workdaysOnly && !settings.workdays.includes(cursor.getUTCDay())) continue;
    const parts = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
    };
    const segmentStart = wallClockUnix(parts, settings.workdayStartMinutes, tzOffsetMinutes, timeZone);
    const segmentEnd = segmentStart + Math.round(segmentSpanHours * 60 * 60);
    segments.push({
      startsAt: segmentStart,
      endsAt: segmentEnd,
      scheduledHours: clampedHours,
    });
  }
  return segments;
}

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

function canWriteEngagement(req, engagement) {
  if (!engagement) return false;
  if (req.access?.permissionSet?.has("engage.manage_all")) return true;
  return canAccessEngagement(req, engagement);
}

function activeQaBlocksRequest(review) {
  return review && ["ready_for_qa", "assigned", "reviewing"].includes(review.status);
}

function isQaTerminalStatus(status) {
  return ["requires_more_work", "ready_for_delivery", "cancelled"].includes(status);
}

function mapQaTerminalStatusToEngagementStatus(status) {
  return {
    requires_more_work: "reporting_in_progress",
    ready_for_delivery: "ready_for_delivery",
    cancelled: "reporting_in_progress",
  }[status] || null;
}

function getActiveQaReviewForEngagement(engagementId) {
  return listEngageQaReviewsByEngagementEnriched(engagementId).find((review) => activeQaBlocksRequest(review)) || null;
}

function filterQaReviewsForUser(req, reviews) {
  if (req.access?.permissionSet?.has("engage.manage_all") || req.access?.permissionSet?.has("engage.manage_qa") || req.access?.permissionSet?.has("engage.view_all")) {
    return reviews;
  }
  return reviews.filter((review) => {
    if (review.assigned_to_user_id === req.user?.id) return true;
    const engagement = getEngageEngagementById(review.engagement_id);
    return canAccessEngagement(req, engagement);
  });
}

function sortQaReviews(reviews) {
  return reviews.slice().sort((a, b) => {
    const aUnassigned = a.assigned_to_user_id ? 1 : 0;
    const bUnassigned = b.assigned_to_user_id ? 1 : 0;
    if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned;
    return (b.created_at || 0) - (a.created_at || 0);
  });
}

function listLatestQaReviews() {
  const latest = [];
  const seen = new Set();
  for (const review of listAllEngageQaReviewsEnriched()) {
    if (seen.has(review.engagement_id)) continue;
    seen.add(review.engagement_id);
    latest.push(review);
  }
  return latest;
}

function listVisibleQaQueue(req) {
  const queue = listLatestQaReviews().filter((review) => activeQaBlocksRequest(review));
  return sortQaReviews(filterQaReviewsForUser(req, queue));
}

function listVisibleQaAttention(req) {
  const attention = listLatestQaReviews().filter((review) =>
    review.status === "requires_more_work" || (activeQaBlocksRequest(review) && !review.assigned_to_user_id)
  );
  return sortQaReviews(filterQaReviewsForUser(req, attention));
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
      canEditEngagement: req.access.permissionSet.has("engage.edit_engagement") || req.access.permissionSet.has("engage.manage_all"),
      canAssignTeam: req.access.permissionSet.has("engage.assign_team") || req.access.permissionSet.has("engage.manage_all"),
      canManageQa: req.access.permissionSet.has("engage.manage_qa") || req.access.permissionSet.has("engage.manage_all"),
      canPerformQa: req.access.permissionSet.has("engage.perform_qa") || req.access.permissionSet.has("engage.manage_all"),
      canManageAll: req.access.permissionSet.has("engage.manage_all"),
    };

    const myWork = getEngageMyWork(req.user.id);
    const stats = getEngageDashboardStats();
    const visibleQaQueue = listVisibleQaQueue(req);
    const visibleQaAttention = listVisibleQaAttention(req);

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
      dashboardQaReviews: visibleQaQueue.slice(0, 8),
      dashboardAttentionQaReviews: visibleQaAttention.slice(0, 8),
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
      userId: req.user.id, username: req.user.username, details: { name: client.display_name || client.name },
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
      userId: req.user.id, username: req.user.username, details: { name: archived.display_name || archived.name },
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
// Cross-tool: Reporter Proposals (search for pickers)
// ============================================================

router.get("/engage/reporter/proposals", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  if (!req.access.permissionSet.has("reporter.view") && !req.access.permissionSet.has("reporter.manage_all")) return res.status(403).json({ error: "Forbidden." });
  try {
    const query = (req.query.query || "").toLowerCase();
    let proposals = listReporterProposals();
    proposals = proposals.filter((p) => !p.archivedAt);
    if (query) {
      proposals = proposals.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(query) ||
          (p.clientName || "").toLowerCase().includes(query)
      );
    }
    const results = proposals.slice(0, 20).map((p) => ({
      id: p.id,
      title: p.title,
      clientName: p.clientName,
      status: p.status,
      testTypes: p.testTypes,
      updatedAt: p.updatedAt,
    }));
    res.json({ proposals: results });
  } catch {
    res.status(500).json({ error: "Failed to search proposals." });
  }
});

router.get("/engage/reporter/projects", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  if (!req.access.permissionSet.has("reporter.view") && !req.access.permissionSet.has("reporter.manage_all")) return res.status(403).json({ error: "Forbidden." });
  try {
    const query = (req.query.query || "").toLowerCase();
    const canManageReporter = req.access.permissionSet.has("reporter.manage_all");
    let projects = listReporterProjects(req.user.id, canManageReporter);
    projects = projects.filter((p) => !p.isArchived);
    if (query) {
      projects = projects.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(query) ||
          (p.clientName || "").toLowerCase().includes(query)
      );
    }
    const results = projects.slice(0, 20).map((p) => ({
      id: p.id,
      title: p.title,
      clientName: p.clientName,
      status: p.status,
      reportType: p.reportType,
      testTypes: p.testTypes,
      dueDate: p.dueDate,
      updatedAt: p.updatedAt,
    }));
    res.json({ projects: results });
  } catch {
    res.status(500).json({ error: "Failed to search Reporter projects." });
  }
});

router.get("/engage/calendar/projects", readLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!canViewEngage(req)) return res.status(403).json({ error: "Forbidden." });
  if (!req.access.permissionSet.has("calendar.view") && !req.access.permissionSet.has("calendar.manage")) return res.status(403).json({ error: "Forbidden." });
  try {
    const query = (req.query.query || "").toLowerCase();
    let projects = listCalendarProjects();
    if (query) {
      projects = projects.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(query) ||
          (p.client_name || "").toLowerCase().includes(query)
      );
    }
    const results = projects.slice(0, 20).map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.client_name || "",
      status: p.status,
      startDate: p.start_date,
      endDate: p.end_date,
      estimatedHours: p.estimated_hours,
    }));
    res.json({ projects: results });
  } catch {
    res.status(500).json({ error: "Failed to search Calendar projects." });
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
    const notes = listEngageNotesByEntity("opportunity", req.params.id);
    const linkedProposalIds = listOppProposalLinks(req.params.id);
    res.status(200).json({ opportunity: maybeStripCommercials(req, opp), notes, linkedProposalIds });
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
      userId: req.user.id, username: req.user.username, details: { title: opportunity.title, clientId: opportunity.client_id },
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
      details: { title: existing.title, clientId: existing.client_id, from: existing.stage, to: stage },
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
      const clientEngagements = listEngageEngagementsByClient(clientId);
      engagements = canViewAll(req) ? clientEngagements : clientEngagements.filter((e) => canAccessEngagement(req, e));
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
      engagementManagerUserId, technicalLeadUserId, highLevelScopeSummary, notes, teamMembers } = req.body;
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
    const requestedMembers = Array.isArray(teamMembers) ? teamMembers : [];
    const memberMap = new Map();
    memberMap.set(req.user.id, { userId: req.user.id, role: "manager", isPrimary: true });
    if (engagementManagerUserId) memberMap.set(engagementManagerUserId, { userId: engagementManagerUserId, role: "manager", isPrimary: true });
    if (technicalLeadUserId) memberMap.set(technicalLeadUserId, { userId: technicalLeadUserId, role: "technical_lead", isPrimary: false });
    for (const member of requestedMembers) {
      if (!member?.userId) continue;
      memberMap.set(member.userId, {
        userId: member.userId,
        role: member.role || "tester",
        isPrimary: !!member.isPrimary,
      });
    }
    for (const member of memberMap.values()) {
      try {
        createEngageMember({ engagementId: engagement.id, ...member });
      } catch {
        // Duplicate members are harmless during auto-assignment.
      }
    }
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

    const linkedReporterProject = engagement.redsec_reporter_project_id ? getReporterProjectById(engagement.redsec_reporter_project_id) : null;
    const linkedCalendarProject = engagement.redseccal_project_id ? getCalendarProjectById(engagement.redseccal_project_id) : null;

    res.status(200).json({
      engagement: maybeStripCommercials(req, engagement),
      linkedReporterProject: linkedReporterProject ? { id: linkedReporterProject.id, title: linkedReporterProject.title, status: linkedReporterProject.status, clientName: linkedReporterProject.clientName, testTypes: linkedReporterProject.testTypes } : null,
      linkedCalendarProject: linkedCalendarProject ? {
        id: linkedCalendarProject.id,
        name: linkedCalendarProject.name,
        code: linkedCalendarProject.code,
        status: linkedCalendarProject.status,
        clientName: linkedCalendarProject.clientName,
        startsAt: linkedCalendarProject.startsAt,
        endsAt: linkedCalendarProject.endsAt,
        estimatedMode: linkedCalendarProject.estimatedMode,
        estimatedValue: linkedCalendarProject.estimatedValue,
        estimatedHours: linkedCalendarProject.estimatedHours,
        billableRate: linkedCalendarProject.billableRate,
      } : null,
    });
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
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });
    const body = req.body;
    if (body.status !== undefined && !ENG_CONTROL_STATUSES.has(body.status)) {
      return res.status(400).json({ error: "Invalid engagement status." });
    }
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
      userId: req.user.id, username: req.user.username, details: { title: engagement.title, clientId: engagement.client_id },
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
    if (!ENG_CONTROL_STATUSES.has(status)) return res.status(400).json({ error: "Invalid engagement status." });
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });
    const activeQa = getActiveQaReviewForEngagement(req.params.id);
    if (activeQa) {
      return res.status(409).json({ error: "Engagement status is controlled by the active QA review until QA reaches an outcome." });
    }
    const engagement = updateEngageEngagementStatus(req.params.id, status);
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "status_changed",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, from: existing.status, to: status },
    });
    auditEngage(req, { action: "engagement_status_changed", targetType: "engage_engagement", targetId: req.params.id, metadata: { from: existing.status, to: status } });
    const notifyUserIds = [existing.engagement_manager_user_id, existing.technical_lead_user_id].filter(Boolean);
    const blockedStatuses = new Set(["testing_blocked"]);
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
      userId: req.user.id, username: req.user.username, details: { title: archived.title },
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
    const activeQaReview = qaReviews.find((review) => activeQaBlocksRequest(review)) || null;
    const linkedReporterProject = engagement.redsec_reporter_project_id ? getReporterProjectById(engagement.redsec_reporter_project_id) : null;
    const linkedCalendarProject = engagement.redseccal_project_id ? getCalendarProjectById(engagement.redseccal_project_id) : null;
    const reporterPdfs = linkedReporterProject ? listReporterPdfGenerationsByProject(linkedReporterProject.id).filter((pdf) => pdf.status === "complete") : [];
    const latestReporterPdf = reporterPdfs[0] || null;
    res.status(200).json({
      engagement: maybeStripCommercials(req, engagement),
      team,
      activity,
      notes,
      qaReviews,
      activeQaReview,
      linkedReporterProject: linkedReporterProject ? { id: linkedReporterProject.id, title: linkedReporterProject.title, status: linkedReporterProject.status, clientName: linkedReporterProject.clientName, testTypes: linkedReporterProject.testTypes } : null,
      linkedCalendarProject: linkedCalendarProject ? {
        id: linkedCalendarProject.id,
        name: linkedCalendarProject.name,
        code: linkedCalendarProject.code,
        status: linkedCalendarProject.status,
        clientName: linkedCalendarProject.clientName,
        startsAt: linkedCalendarProject.startsAt,
        endsAt: linkedCalendarProject.endsAt,
        estimatedMode: linkedCalendarProject.estimatedMode,
        estimatedValue: linkedCalendarProject.estimatedValue,
        estimatedHours: linkedCalendarProject.estimatedHours,
        billableRate: linkedCalendarProject.billableRate,
      } : null,
      latestReporterPdf: latestReporterPdf ? { id: latestReporterPdf.id, downloadUrl: `/api/reporter/pdfs/${latestReporterPdf.id}/download`, createdAt: latestReporterPdf.createdAt } : null,
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
    if (!canWriteEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const { userId, role, isPrimary } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required." });
    const member = createEngageMember({ engagementId: req.params.id, userId, role, isPrimary });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "member_added",
      userId: req.user.id, username: req.user.username, details: { title: engagement.title, memberUserId: userId, role },
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
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
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
    const engagement = getEngageEngagementById(req.params.id);
    if (!engagement || engagement.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, engagement)) return res.status(403).json({ error: "Forbidden." });
    const deleted = deleteEngageMember(req.params.memberId);
    if (!deleted) return res.status(404).json({ error: "Team member not found." });
    const eng = getEngageEngagementById(req.params.id);
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "member_removed",
      userId: req.user.id, username: req.user.username, details: { title: eng?.title, memberId: req.params.memberId },
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
    if (status === "queue") {
      reviews = listVisibleQaQueue(req);
    } else if (status === "completed") {
      reviews = listAllEngageQaReviewsEnriched().filter((r) => isQaTerminalStatus(r.status));
    } else if (status === "all") {
      reviews = listAllEngageQaReviewsEnriched();
    } else if (status) {
      reviews = listEngageQaReviewsByStatusEnriched(status);
    } else if (assignee) {
      reviews = listEngageQaReviewsByAssigneeEnriched(assignee);
    } else {
      reviews = listVisibleQaQueue(req);
    }
    res.status(200).json({ reviews: Array.isArray(reviews) && (status === "queue" || (!status && !assignee)) ? reviews : sortQaReviews(filterQaReviewsForUser(req, reviews)) });
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
    const existingReviews = listEngageQaReviewsByEngagementEnriched(req.params.id);
    const latestReview = existingReviews[0];
    if (activeQaBlocksRequest(latestReview)) {
      return res.status(409).json({ error: "QA has already been requested for this engagement." });
    }
    const review = createEngageQaReview({
      engagementId: req.params.id, reporterProjectId, assignedByUserId: req.user.id,
      status: "ready_for_qa", reportLink, shareLink,
      qaNotes: qaNotes || "",
    });
    createEngageActivity({
      entityType: "engagement", entityId: req.params.id, action: "qa_requested",
      userId: req.user.id, username: req.user.username, details: { title: engagement.title },
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
        userId: req.user.id, username: req.user.username, details: { title: engagement.title, assignedToUserId },
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
        userId: req.user.id, username: req.user.username, details: { title: engagement.title, assignedToUserId },
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
    const allowedStatuses = new Set(["ready_for_qa", "assigned", "reviewing", "requires_more_work", "ready_for_delivery", "cancelled"]);
    if (!allowedStatuses.has(status)) return res.status(400).json({ error: "Invalid QA status." });
    const completedAt = isQaTerminalStatus(status) ? Math.floor(Date.now() / 1000) : null;
    const review = updateEngageQaReview({
      id: req.params.id, status, qaNotes, reportLink, shareLink, completedAt,
    });
    const engagementStatus = mapQaTerminalStatusToEngagementStatus(status);
    if (engagementStatus) updateEngageEngagementStatus(existing.engagement_id, engagementStatus);
    createEngageActivity({
      entityType: "engagement", entityId: existing.engagement_id, action: "qa_status_changed",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, from: existing.status, to: status },
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
    const { reporterProposalId, proposalReporterDocId, proposalPdfGenerationId } = req.body;
    if (!reporterProposalId && !proposalReporterDocId && !proposalPdfGenerationId) {
      return res.status(400).json({ error: "reporterProposalId, proposalReporterDocId, or proposalPdfGenerationId is required." });
    }

    if (reporterProposalId) {
      const proposal = getReporterProposalById(reporterProposalId);
      if (!proposal) return res.status(404).json({ error: "Reporter proposal not found." });
      const opportunity = linkEngageOpportunityProposal(req.params.id, reporterProposalId);
      createEngageActivity({
        entityType: "opportunity", entityId: req.params.id, action: "proposal_linked",
        userId: req.user.id, username: req.user.username,
        details: { title: existing.title, clientId: existing.client_id, reporterProposalId, proposalTitle: proposal.title },
      });
      auditEngage(req, { action: "proposal_linked", targetType: "engage_opportunity", targetId: req.params.id, metadata: { reporterProposalId } });
      return res.status(200).json({ opportunity: maybeStripCommercials(req, opportunity) });
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
      details: { title: existing.title, clientId: existing.client_id, proposalReporterDocId, proposalPdfGenerationId },
    });
    auditEngage(req, { action: "proposal_linked", targetType: "engage_opportunity", targetId: req.params.id, metadata: { proposalReporterDocId, proposalPdfGenerationId } });
    res.status(200).json({ opportunity: maybeStripCommercials(req, opportunity) });
  } catch {
    res.status(500).json({ error: "Failed to link proposal." });
  }
});

const VALID_TEST_TYPES = ["internal", "external", "webapp", "cloud", "build_review", "red_team", "wireless", "configuration_review", "assumed_breach", "custom"];

function getProposalWriteupField(writeup, camelName, snakeName) {
  return writeup?.[camelName] || writeup?.[snakeName] || "";
}

function buildEngageProposalServiceWriteup(writeup) {
  if (!writeup) return "";
  return [
    `### ${writeup.name || writeup.testType || writeup.test_type || "Security Assessment"}`,
    getProposalWriteupField(writeup, "description", "description"),
    "#### Methodology",
    getProposalWriteupField(writeup, "methodologyWriteup", "methodology_writeup") || getProposalWriteupField(writeup, "methodology", "methodology"),
    "#### Scope Guidance",
    getProposalWriteupField(writeup, "scopeGuidance", "scope_guidance") || getProposalWriteupField(writeup, "scope", "scope"),
    "#### Deliverables",
    getProposalWriteupField(writeup, "deliverables", "deliverables"),
  ].filter((part) => String(part || "").trim()).join("\n\n");
}

function buildEngageProposalSections(templateSections, selectedTypes) {
  const sections = [];
  let orderIdx = 0;
  for (const ts of templateSections) {
    const content = ts.content || "";
    if (content.includes("{{test_type_inserts}}")) {
      let combined = content.replace("{{test_type_inserts}}", "");
      for (const tt of selectedTypes) {
        const writeup = getReporterTestTypeTemplateByType(tt);
        if (writeup) combined += `\n\n${buildEngageProposalServiceWriteup(writeup)}\n`;
      }
      sections.push({ title: ts.title, sectionType: ts.section_type, content: combined.trim(), orderIndex: orderIdx++, isIncluded: true });
    } else if (content.includes("{{client_requirements_insert}}")) {
      const reqs = selectedTypes.map((tt) => {
        const w = getReporterTestTypeTemplateByType(tt);
        const requirements = getProposalWriteupField(w, "clientRequirements", "client_requirements");
        return w && requirements ? `- **${w.name}:** ${requirements}` : null;
      }).filter(Boolean).join("\n");
      sections.push({ title: ts.title, sectionType: ts.section_type, content: content.replace("{{client_requirements_insert}}", reqs).trim(), orderIndex: orderIdx++, isIncluded: true });
    } else if (content.includes("{{consultant_requirements_insert}}")) {
      const reqs = selectedTypes.map((tt) => {
        const w = getReporterTestTypeTemplateByType(tt);
        const requirements = getProposalWriteupField(w, "consultantRequirements", "consultant_requirements");
        return w && requirements ? `- **${w.name}:** ${requirements}` : null;
      }).filter(Boolean).join("\n");
      sections.push({ title: ts.title, sectionType: ts.section_type, content: content.replace("{{consultant_requirements_insert}}", reqs).trim(), orderIndex: orderIdx++, isIncluded: true });
    } else {
      sections.push({ title: ts.title, sectionType: ts.section_type, content, orderIndex: orderIdx++, isIncluded: true });
    }
  }
  return sections;
}

router.post("/engage/opportunities/:id/create-proposal", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });

    const { title, testTypes } = req.body;
    const proposalTitle = (title || existing.title + " - Proposal").trim();
    if (!proposalTitle) return res.status(400).json({ error: "Title is required." });

    const selectedTypes = Array.isArray(testTypes) ? testTypes.filter((t) => VALID_TEST_TYPES.includes(t)) : [];

    const template = getReporterProposalTemplateById("builtin-proposal-default");
    const templateSections = template ? listReporterProposalTemplateSections(template.id) : [];

    const sections = buildEngageProposalSections(templateSections, selectedTypes);

    const proposal = createReporterProposalRow({
      templateId: template ? template.id : null,
      title: proposalTitle,
      clientName: existing.client_name || "",
      clientId: existing.client_id,
      opportunityId: existing.id,
      testTypes: selectedTypes,
      estimatedDays: existing.estimated_days,
      quotedValue: existing.quoted_value,
      createdBy: req.user.id,
      sections,
    });

    linkEngageOpportunityProposal(existing.id, proposal.id);

    createEngageActivity({
      entityType: "opportunity", entityId: existing.id, action: "proposal_created",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, proposalId: proposal.id, proposalTitle: proposal.title },
    });
    auditEngage(req, { action: "proposal_created", targetType: "engage_opportunity", targetId: existing.id, metadata: { proposalId: proposal.id } });

    res.status(201).json({ proposal });
  } catch (err) {
    res.status(500).json({ error: "Failed to create proposal." });
  }
});

router.post("/engage/opportunities/:id/generate-proposal-pdf", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.edit_opportunity") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageOpportunityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Opportunity not found." });
    if (!existing.reporter_proposal_id) return res.status(400).json({ error: "No proposal linked to this opportunity." });

    const proposal = getReporterProposalById(existing.reporter_proposal_id);
    if (!proposal) return res.status(404).json({ error: "Linked proposal not found." });

    res.json({ redirectUrl: `/reporter/?proposalId=${proposal.id}`, proposalId: proposal.id });
  } catch {
    res.status(500).json({ error: "Failed to generate proposal PDF." });
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
    const convertedMembers = new Map();
    convertedMembers.set(req.user.id, { userId: req.user.id, role: "manager", isPrimary: true });
    if (engagement.engagement_manager_user_id) convertedMembers.set(engagement.engagement_manager_user_id, { userId: engagement.engagement_manager_user_id, role: "manager", isPrimary: true });
    if (engagement.technical_lead_user_id) convertedMembers.set(engagement.technical_lead_user_id, { userId: engagement.technical_lead_user_id, role: "technical_lead", isPrimary: false });
    for (const member of convertedMembers.values()) {
      try {
        createEngageMember({ engagementId: engagement.id, ...member });
      } catch {
        // Duplicate members are harmless during conversion.
      }
    }
    createEngageActivity({
      entityType: "opportunity", entityId: existing.id, action: "converted_to_engagement",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, engagementId: engagement.id },
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
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });
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
      details: { title: engagement.title, clientId: engagement.client_id, redseccalProjectId },
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
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });
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
      details: { title: engagement.title, clientId: engagement.client_id, redsecReporterProjectId, proposalReporterDocId, deliveryReporterProjectId },
    });
    auditEngage(req, { action: "reporter_project_linked", targetType: "engage_engagement", targetId: req.params.id, metadata: { redsecReporterProjectId, proposalReporterDocId, deliveryReporterProjectId } });
    res.status(200).json({ engagement: maybeStripCommercials(req, engagement) });
  } catch {
    res.status(500).json({ error: "Failed to link Reporter project." });
  }
});

const ROLE_MAP = { technical_lead: "lead", manager: "reviewer", tester: "pentester", qa_reviewer: "reviewer", observer: "reviewer" };

router.post("/engage/engagements/:id/create-reporter-project", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });

    const { designId, title } = req.body;
    const designs = listReporterDesigns();
    const design = designId ? designs.find((d) => d.id === designId) : designs[0];
    if (!design) return res.status(400).json({ error: "No report design available." });

    const oppTypes = existing.engagement_type ? JSON.parse(existing.engagement_type) : [];
    const projectTitle = (title || existing.title + " - Report").trim();

    const members = listEngageMembersByEngagement(existing.id);
    const projectMembers = members.map((m) => ({
      userId: m.user_id,
      role: ROLE_MAP[m.role] || "pentester",
    }));
    const creatorMember = projectMembers.find((m) => m.userId === req.user.id);
    if (creatorMember) {
      creatorMember.role = "lead";
    } else {
      projectMembers.push({ userId: req.user.id, role: "lead" });
    }

    const project = createReporterProjectRow({
      designId: design.id,
      title: projectTitle,
      reportType: oppTypes[0] || "custom",
      clientName: existing.client_display_name || existing.client_name || "",
      testTypes: oppTypes,
      dueDate: existing.scheduled_end_date || null,
      createdBy: req.user.id,
      members: projectMembers,
    });

    updateEngageEngagement({
      id: existing.id, title: existing.title, engagementType: existing.engagement_type,
      status: existing.status, priority: existing.priority, commercialValue: existing.commercial_value,
      estimatedDays: existing.estimated_days, scheduledStartDate: existing.scheduled_start_date,
      scheduledEndDate: existing.scheduled_end_date, actualStartDate: existing.actual_start_date,
      actualEndDate: existing.actual_end_date,
      engagementManagerUserId: existing.engagement_manager_user_id,
      technicalLeadUserId: existing.technical_lead_user_id,
      redseccalProjectId: existing.redseccal_project_id,
      redsecReporterProjectId: project.id,
      proposalReporterDocId: existing.proposal_reporter_doc_id,
      deliveryReporterProjectId: existing.delivery_reporter_project_id,
      highLevelScopeSummary: existing.high_level_scope_summary, notes: existing.notes,
    });

    createEngageActivity({
      entityType: "engagement", entityId: existing.id, action: "reporter_project_created",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, projectId: project.id, projectTitle: project.title },
    });
    auditEngage(req, { action: "reporter_project_created", targetType: "engage_engagement", targetId: existing.id, metadata: { projectId: project.id } });
    res.status(201).json({ project });
  } catch (err) {
    res.status(500).json({ error: "Failed to create Reporter project." });
  }
});

router.post("/engage/engagements/:id/create-calendar-project", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });

    const { name, code, estimatedDays, billableRate } = req.body;
    const projectName = (name || existing.title).trim();
    if (!projectName) return res.status(400).json({ error: "Name is required." });

    const oppTypes = existing.engagement_type ? JSON.parse(existing.engagement_type) : [];
    const effectiveEstimatedDays = Number.isFinite(Number(estimatedDays)) ? Number(estimatedDays) : Number(existing.estimated_days || 0);
    const effectiveBillableRate = Number.isFinite(Number(billableRate)) ? Number(billableRate) : (
      existing.commercial_value && effectiveEstimatedDays > 0 ? Number((Number(existing.commercial_value) / effectiveEstimatedDays).toFixed(2)) : 0
    );

    const project = createCalendarProject({
      id: crypto.randomBytes(16).toString("base64url"),
      code: (code || projectName).trim().slice(0, 40),
      name: projectName,
      clientName: existing.client_display_name || existing.client_name || "",
      projectType: oppTypes.join(", "),
      description: existing.high_level_scope_summary || "",
      status: "active",
      startsAt: existing.scheduled_start_date ? Math.floor(new Date(existing.scheduled_start_date).getTime() / 1000) : null,
      endsAt: existing.scheduled_end_date ? Math.floor(new Date(existing.scheduled_end_date).getTime() / 1000) : null,
      estimatedMode: "days",
      estimatedValue: effectiveEstimatedDays,
      estimatedHours: effectiveEstimatedDays ? Math.round(effectiveEstimatedDays * 7.5) : 0,
      billableRate: effectiveBillableRate,
      notes: existing.notes || `Created from Engage engagement: ${existing.title}`,
      createdBy: req.user.id,
    });
    updateEngageEngagement({
      id: existing.id, title: existing.title, engagementType: existing.engagement_type,
      status: existing.status, priority: existing.priority, commercialValue: existing.commercial_value,
      estimatedDays: existing.estimated_days, scheduledStartDate: existing.scheduled_start_date,
      scheduledEndDate: existing.scheduled_end_date, actualStartDate: existing.actual_start_date,
      actualEndDate: existing.actual_end_date,
      engagementManagerUserId: existing.engagement_manager_user_id,
      technicalLeadUserId: existing.technical_lead_user_id,
      redseccalProjectId: project.id,
      redsecReporterProjectId: existing.redsec_reporter_project_id,
      proposalReporterDocId: existing.proposal_reporter_doc_id,
      deliveryReporterProjectId: existing.delivery_reporter_project_id,
      highLevelScopeSummary: existing.high_level_scope_summary, notes: existing.notes,
    });

    createEngageActivity({
      entityType: "engagement", entityId: existing.id, action: "calendar_project_created",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, calendarProjectId: project.id, name: projectName },
    });
    auditEngage(req, { action: "calendar_project_created", targetType: "engage_engagement", targetId: existing.id, metadata: { calendarProjectId: project.id } });
    res.status(201).json({ project });
  } catch (err) {
    logEvent("engage:create_calendar_project_failed", req, { error: err.message });
    res.status(500).json({ error: "Failed to create Calendar project." });
  }
});

router.post("/engage/engagements/:id/calendar-allocations", writeLimiter, requireUser, attachUserAccess, (req, res) => {
  const set = req.access.permissionSet;
  if (!set.has("engage.create_engagement") && !set.has("engage.manage_all")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  try {
    const existing = getEngageEngagementById(req.params.id);
    if (!existing || existing.archived_at) return res.status(404).json({ error: "Engagement not found." });
    if (!canWriteEngagement(req, existing)) return res.status(403).json({ error: "Forbidden." });
    if (!existing.redseccal_project_id) return res.status(400).json({ error: "No Calendar project linked." });

    const { assigneeUserIds, startDate, endDate, hoursPerDay, title, workdaysOnly } = req.body;
    if (!Array.isArray(assigneeUserIds) || !assigneeUserIds.length) return res.status(400).json({ error: "assigneeUserIds array is required." });
    if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required." });

    const settings = getEngageCalendarSettings();
    const timeZone = typeof req.body?.timeZone === "string" ? req.body.timeZone.slice(0, 80) : "";
    const tzOffsetMinutes = typeof req.body?.tzOffsetMinutes === "number"
      ? req.body.tzOffsetMinutes
      : getOffsetMinutesForTimeZone(timeZone, startDate);
    const dateRange = parseDateRangeToUnix(startDate, endDate, tzOffsetMinutes, timeZone);
    if (!dateRange) return res.status(400).json({ error: "Choose a valid allocation date range." });
    const hpd = parseFloat(hoursPerDay) || settings.dailyHours;
    const segments = buildDailyAllocationSegments(dateRange.startsAt, dateRange.endsAt, hpd, workdaysOnly !== false, settings, tzOffsetMinutes, timeZone);
    if (!segments.length) return res.status(400).json({ error: "No allocation days were generated for that range." });

    const entries = [];
    for (const userId of assigneeUserIds) {
      for (const segment of segments) {
        const entry = createCalendarEntry({
          id: crypto.randomBytes(16).toString("base64url"),
          type: "assignment",
          projectId: existing.redseccal_project_id,
          title: title || existing.title,
          description: `Created from Engage engagement: ${existing.title}`,
          ownerId: req.user.id,
          startsAt: segment.startsAt,
          endsAt: segment.endsAt,
          assigneeUserId: userId,
          scheduledHours: segment.scheduledHours,
          allDay: false,
          status: "scheduled",
        });
        entries.push(entry);
      }
      createNotification({
        userId,
        category: "calendar",
        action: "engage_allocation_created",
        title: "Calendar allocation created",
        body: `${title || existing.title} was scheduled for you`,
        linkUrl: `/calendar/?view=projects&projectId=${encodeURIComponent(existing.redseccal_project_id)}`,
        entityType: "calendar_project",
        entityId: existing.redseccal_project_id,
        severity: "info",
      });
    }

    createEngageActivity({
      entityType: "engagement", entityId: existing.id, action: "allocations_created",
      userId: req.user.id, username: req.user.username,
      details: { title: existing.title, clientId: existing.client_id, assigneeCount: assigneeUserIds.length, startDate, endDate },
    });
    auditEngage(req, { action: "calendar_allocations_created", targetType: "engage_engagement", targetId: existing.id, metadata: { count: entries.length } });
    res.status(201).json({ created: entries.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to create allocations." });
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
    const allowedStatuses = new Set(["ready_for_qa", "assigned", "reviewing", "requires_more_work", "ready_for_delivery", "cancelled"]);
    if (status && !allowedStatuses.has(status)) return res.status(400).json({ error: "Invalid QA status." });
    const completedAt = status
      ? (isQaTerminalStatus(status) ? Math.floor(Date.now() / 1000) : null)
      : existing.completed_at;
    const review = updateEngageQaReview({
      id: req.params.id,
      status: status || existing.status,
      qaNotes: qaNotes !== undefined ? qaNotes : existing.qa_notes,
      reportLink: reportLink !== undefined ? reportLink : existing.report_link,
      shareLink: shareLink !== undefined ? shareLink : existing.share_link,
      assignedToUserId: assignedToUserId || existing.assigned_to_user_id,
      completedAt,
    });
    if (status) {
      const engagementStatus = mapQaTerminalStatusToEngagementStatus(status);
      if (engagementStatus) updateEngageEngagementStatus(existing.engagement_id, engagementStatus);
    }
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
