const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireServiceAccount } = require("../middleware/service-auth");
const { hasServiceScope } = require("../core/integrations/service-account-scopes");
const {
  listAuditEvents,
  getDeploymentCounts,
  listThreatAlerts,
  listThreatFeeds,
  listThreatKeywords,
  listCalendarProjects,
  listCalendarEntries,
  listAllSurveys,
  getSurveyById,
  getSurveyQuestions,
  getSurveyResults,
  getSurveyStats,
  listWikiPages,
  getWikiPageById,
  listReporterProjects,
  getReporterProjectById,
  listReporterProjectMembers,
  listReporterFindingsByProject,
  listReporterSectionsByProject,
  listEngageClients,
  getEngageClientById,
  listEngageOpportunities,
  getEngageOpportunityById,
  listEngageEngagements,
  getEngageEngagementById,
  listPlatformWebhooks,
  listPlatformWebhookDeliveries,
} = require("../database");

const router = Router();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "API rate limit exceeded", code: "rate_limited", retryAfterSeconds: 60 },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use("/v1", apiLimiter);

function pageParams(query, { defaultLimit = 100, maxLimit = 500 } = {}) {
  return {
    limit: Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit)),
    offset: Math.max(0, parseInt(query.offset, 10) || 0),
  };
}

function hasScope(req, scopes) {
  return hasServiceScope(req.serviceAccount?.scopes || [], scopes);
}

function requireServicePermission(scopes) {
  return requireServiceAccount(scopes);
}

function stripEngageCommercialFields(record, allowed) {
  if (!record || allowed) return record;
  const clone = { ...record };
  for (const key of [
    "estimated_value",
    "quoted_value",
    "commercial_value",
    "probability_percent",
    "billing_rate",
    "weighted_value",
  ]) {
    if (Object.prototype.hasOwnProperty.call(clone, key)) clone[key] = null;
  }
  return clone;
}

function serviceAccountMeta(req) {
  return {
    id: req.serviceAccount.id,
    name: req.serviceAccount.name,
    scopes: req.serviceAccount.scopes,
  };
}

router.get("/v1/me", requireServiceAccount([]), (req, res) => {
  res.json({
    actorType: "service_account",
    ...serviceAccountMeta(req),
  });
});

router.get("/v1/deployment/counts", requireServiceAccount(["deployment.read"]), (req, res) => {
  res.json({ counts: getDeploymentCounts() });
});

router.get("/v1/audit-events", requireServiceAccount(["audit.read"]), (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  res.json(listAuditEvents({
    limit,
    offset,
    category: typeof req.query.category === "string" && req.query.category ? req.query.category : null,
    action: typeof req.query.action === "string" && req.query.action ? req.query.action : null,
    outcome: typeof req.query.outcome === "string" && req.query.outcome ? req.query.outcome : null,
    targetType: typeof req.query.targetType === "string" && req.query.targetType ? req.query.targetType : null,
    targetId: typeof req.query.targetId === "string" && req.query.targetId ? req.query.targetId : null,
  }));
});

router.get("/v1/threat/alerts", requireServicePermission(["threat.view", "threat.manage", "threat.read"]), (req, res) => {
  const filters = {
    limit: Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100)),
    offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
    isRead: req.query.unreadOnly === "true" ? false : undefined,
  };
  res.json({ alerts: listThreatAlerts(filters) });
});

router.get("/v1/threat/feeds", requireServicePermission(["threat.view", "threat.manage", "threat.read"]), (req, res) => {
  res.json({ feeds: listThreatFeeds(req.query.enabledOnly === "true") });
});

router.get("/v1/threat/keywords", requireServicePermission(["threat.view", "threat.manage", "threat.read"]), (req, res) => {
  res.json({ keywords: listThreatKeywords(req.query.enabledOnly === "true") });
});

router.get("/v1/calendar/projects", requireServicePermission(["calendar.view_team", "calendar.manage"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const projects = listCalendarProjects();
  res.json({ projects: projects.slice(offset, offset + limit), total: projects.length, limit, offset });
});

router.get("/v1/calendar/entries", requireServicePermission(["calendar.view_team", "calendar.manage"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const entries = listCalendarEntries({
    projectId: typeof req.query.projectId === "string" ? req.query.projectId : null,
    startsAfter: req.query.startsAfter ? parseInt(req.query.startsAfter, 10) || 0 : 0,
    endsBefore: req.query.endsBefore ? parseInt(req.query.endsBefore, 10) || 0 : undefined,
  });
  res.json({ entries: entries.slice(offset, offset + limit), total: entries.length, limit, offset });
});

router.get("/v1/surveys", requireServicePermission(["survey.manage_any", "survey.view_results_any"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const surveys = listAllSurveys();
  res.json({ surveys: surveys.slice(offset, offset + limit), total: surveys.length, limit, offset });
});

router.get("/v1/surveys/:id", requireServicePermission(["survey.manage_any", "survey.view_results_any"]), (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found", code: "not_found" });
  res.json({ survey, questions: getSurveyQuestions(survey.id), stats: getSurveyStats(survey.id) });
});

router.get("/v1/surveys/:id/results", requireServicePermission(["survey.manage_any", "survey.view_results_any"]), (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found", code: "not_found" });
  res.json({ survey, ...getSurveyResults(survey.id) });
});

router.get("/v1/wiki/pages", requireServicePermission(["wiki.view", "wiki.manage"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const scope = ["team", "personal"].includes(req.query.scope) ? req.query.scope : "";
  const pages = listWikiPages({ scope });
  res.json({ pages: pages.slice(offset, offset + limit), total: pages.length, limit, offset });
});

router.get("/v1/wiki/pages/:id", requireServicePermission(["wiki.view", "wiki.manage"]), (req, res) => {
  const page = getWikiPageById(req.params.id);
  if (!page) return res.status(404).json({ error: "Wiki page not found", code: "not_found" });
  if (page.scope === "personal" && !hasScope(req, "wiki.manage")) {
    return res.status(403).json({ error: "Insufficient API token scope", code: "insufficient_scope", requiredScopes: ["wiki.manage"] });
  }
  res.json({ page });
});

router.get("/v1/reporter/projects", requireServicePermission(["reporter.manage_all"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const projects = listReporterProjects(null, true);
  res.json({ projects: projects.slice(offset, offset + limit), total: projects.length, limit, offset });
});

router.get("/v1/reporter/projects/:id", requireServicePermission(["reporter.manage_all"]), (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Reporter project not found", code: "not_found" });
  res.json({
    project,
    members: listReporterProjectMembers(project.id),
    findings: listReporterFindingsByProject(project.id),
    sections: listReporterSectionsByProject(project.id),
  });
});

router.get("/v1/engage/clients", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  res.json({ clients: listEngageClients(limit, offset), limit, offset });
});

router.get("/v1/engage/clients/:id", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const client = getEngageClientById(req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found", code: "not_found" });
  res.json({ client });
});

router.get("/v1/engage/opportunities", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const canSeeCommercials = hasScope(req, ["engage.manage_commercials", "engage.view_all", "engage.manage_all"]);
  res.json({ opportunities: listEngageOpportunities(limit, offset).map((row) => stripEngageCommercialFields(row, canSeeCommercials)), limit, offset });
});

router.get("/v1/engage/opportunities/:id", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const opportunity = getEngageOpportunityById(req.params.id);
  if (!opportunity) return res.status(404).json({ error: "Opportunity not found", code: "not_found" });
  const canSeeCommercials = hasScope(req, ["engage.manage_commercials", "engage.view_all", "engage.manage_all"]);
  res.json({ opportunity: stripEngageCommercialFields(opportunity, canSeeCommercials) });
});

router.get("/v1/engage/engagements", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const { limit, offset } = pageParams(req.query);
  const canSeeCommercials = hasScope(req, ["engage.manage_commercials", "engage.view_all", "engage.manage_all"]);
  res.json({ engagements: listEngageEngagements(limit, offset).map((row) => stripEngageCommercialFields(row, canSeeCommercials)), limit, offset });
});

router.get("/v1/engage/engagements/:id", requireServicePermission(["engage.view_team", "engage.view_all", "engage.manage_all"]), (req, res) => {
  const engagement = getEngageEngagementById(req.params.id);
  if (!engagement) return res.status(404).json({ error: "Engagement not found", code: "not_found" });
  const canSeeCommercials = hasScope(req, ["engage.manage_commercials", "engage.view_all", "engage.manage_all"]);
  res.json({ engagement: stripEngageCommercialFields(engagement, canSeeCommercials) });
});

router.get("/v1/webhooks", requireServicePermission(["webhooks.manage"]), (req, res) => {
  res.json({ webhooks: listPlatformWebhooks() });
});

router.get("/v1/webhooks/:id/deliveries", requireServicePermission(["webhooks.manage"]), (req, res) => {
  const { limit } = pageParams(req.query, { defaultLimit: 50, maxLimit: 200 });
  res.json({ deliveries: listPlatformWebhookDeliveries(req.params.id, limit), limit });
});

module.exports = router;
