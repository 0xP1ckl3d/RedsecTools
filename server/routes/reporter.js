const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const { createNotification } = require("../core/notifications");
const {
  createReporterDesignRow,
  getReporterDesignById,
  listReporterDesigns,
  updateReporterDesignRow,
  deleteReporterDesignById,
  createReporterProjectRow,
  getReporterProjectById,
  listReporterProjects,
  updateReporterProjectRow,
  updateReporterProjectStatus,
  archiveReporterProjectRow,
  setReporterProjectReadonly,
  deleteReporterProjectById,
  duplicateReporterProject,
  addReporterProjectMember,
  listReporterProjectMembers,
  updateReporterProjectMemberRoleRow,
  removeReporterProjectMemberRow,
  isReporterProjectMemberRow,
  createReporterFindingRow,
  getReporterFindingByIdRow,
  listReporterFindingsByProject,
  updateReporterFindingRow,
  updateReporterFindingStatusRow,
  deleteReporterFindingById,
  copyReporterFinding,
  reorderReporterFindingsRow,
  setReporterFindingFieldRow,
  createReporterSectionRow,
  getReporterSectionByIdRow,
  listReporterSectionsByProject,
  updateReporterSectionRow,
  deleteReporterSectionById,
  reorderReporterSectionsRow,
  createReporterFindingTemplateRow,
  getReporterFindingTemplateByIdRow,
  listReporterFindingTemplates,
  updateReporterFindingTemplateRow,
  deleteReporterFindingTemplateById,
  getReporterGlobalStats,
  getReporterProjectStats,
  createAuditEvent,
  createReporterPdfGenerationRow,
  updateReporterPdfGenerationRow,
  getReporterPdfGenerationById,
  listReporterPdfGenerationsByProject,
  deleteReporterPdfGenerationById,
  createReporterNoteRow,
  getReporterNoteById,
  listReporterNotesByProject,
  updateReporterNoteRow,
  deleteReporterNoteById,
  createReporterCommentRow,
  getReporterCommentById,
  listReporterCommentsByProject,
  listReporterCommentsByTarget,
  resolveReporterCommentRow,
  deleteReporterCommentById,
  createReporterHistoryRow,
  listReporterHistoryByProject,
  createReporterEvidenceRow,
  getReporterEvidenceById,
  listReporterEvidenceByProject,
  updateReporterEvidenceRow,
  deleteReporterEvidenceById,
  createReporterImportJobRow,
  updateReporterImportJobRow,
  listReporterImportJobsByProject,
  incrementReporterTemplateUsage,
  listUsers,
  getUserByUsername,
  getEngageEngagementByReporterProject,
  getEngageOpportunityById,
  getReporterProposalById,
  listReporterProposals,
  createReporterProposalRow,
  updateReporterProposalRow,
  updateReporterProposalStatus,
  archiveReporterProposalRow,
  unarchiveReporterProposalRow,
  listReporterProposalSections,
  getReporterProposalSectionById,
  createReporterProposalSectionRow,
  updateReporterProposalSectionRow,
  deleteReporterProposalSectionById,
  reorderReporterProposalSectionsRow,
  createReporterProposalGenerationRow,
  updateReporterProposalGenerationRow,
  getReporterProposalGenerationById,
  listReporterProposalGenerations,
  deleteReporterProposalGenerationById,
  listReporterProposalTemplates,
  getReporterProposalTemplateById,
  createReporterProposalTemplate,
  updateReporterProposalTemplate,
  archiveReporterProposalTemplate,
  duplicateReporterProposalTemplate,
  listReporterProposalTemplateSections,
  createReporterProposalTemplateSection,
  updateReporterProposalTemplateSection,
  deleteReporterProposalTemplateSection,
  listReporterTestTypeTemplates,
  listAllReporterTestTypeTemplates,
  getReporterTestTypeTemplateById,
  getReporterTestTypeTemplateByType,
  createReporterTestTypeTemplate,
  updateReporterTestTypeTemplate,
  archiveReporterTestTypeTemplate,
  duplicateReporterTestTypeTemplate,
} = require("../database");
const {
  REPORTER_PDF_DIR,
  ensureReporterPdfDir,
  renderReportHtml,
  renderPdfBuffer,
  defaultHtmlTemplate,
  defaultCssTemplate,
  renderProposalDocumentHtml,
  defaultProposalHtmlTemplate,
  defaultProposalCssTemplate,
} = require("../reporter-render-service");
const { renderMarkdownToHtml } = require("../wiki-render");
const { logEvent, redactObject } = require("../core/logger");

const router = Router();
const REPORTER_EVIDENCE_DIR = path.join(__dirname, "..", "..", "data", "reporter-evidence");
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function auditReporter(req, { action, targetType = "reporter_project", targetId = null, outcome = "success", metadata = {} }) {
  try {
    createAuditEvent({
      actorUserId: req.access?.userId || req.user?.id || null,
      actorUsername: req.access?.username || req.user?.username || null,
      actorType: req.access?.userId || req.user?.id ? "user" : "system",
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "reporter",
      action,
      targetType,
      targetId,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch (error) {
    logEvent("audit:write_failed", req, { action, error: error.message });
  }
}

// --- Permission helpers ---

function getCapabilities(req) {
  const set = req.access.permissionSet;
  return {
    canView: set.has("reporter.view"),
    canCreate: set.has("reporter.create"),
    canEditOwn: set.has("reporter.edit_own"),
    canEditAssigned: set.has("reporter.edit_assigned"),
    canReview: set.has("reporter.review"),
    canApprove: set.has("reporter.approve"),
    canManageTemplates: set.has("reporter.manage_templates"),
    canManageAll: set.has("reporter.manage_all"),
  };
}

function canViewReporter(req, res, next) {
  const caps = getCapabilities(req);
  if (!caps.canView) return res.status(403).json({ error: "Reporter access denied" });
  next();
}

function canCreateReporter(req, res, next) {
  const caps = getCapabilities(req);
  if (!caps.canCreate && !caps.canManageAll) return res.status(403).json({ error: "Cannot create projects" });
  next();
}

function canManageTemplates(req, res, next) {
  const caps = getCapabilities(req);
  if (!caps.canManageTemplates && !caps.canManageAll) return res.status(403).json({ error: "Cannot manage templates" });
  next();
}

async function loadProjectForEdit(req, projectId) {
  const project = getReporterProjectById(projectId);
  if (!project) return null;
  const caps = getCapabilities(req);
  if (caps.canManageAll) return project;
  const membership = listReporterProjectMembers(projectId).find((member) => member.userId === req.access.userId);
  if (!membership) return null;
  if (membership.role === "lead") return project;
  if (project.createdBy === req.access.userId && caps.canEditOwn) return project;
  if (caps.canEditAssigned) return project;
  return null;
}

function canAccessProject(req, project) {
  const caps = getCapabilities(req);
  if (caps.canManageAll) return true;
  return isReporterProjectMemberRow(project.id, req.access.userId);
}

function canDeleteOwnedReporterItem(req, item) {
  const caps = getCapabilities(req);
  return caps.canManageAll || item.createdBy === req.access.userId;
}

function buildVisibleReporterStats(projects) {
  const stats = {
    totalProjects: 0,
    archivedProjects: 0,
    totalFindings: 0,
    criticalFindings: 0,
    highFindings: 0,
    totalTemplates: listReporterFindingTemplates().length,
    totalDesigns: listReporterDesigns().length,
  };
  for (const project of projects) {
    const archived = project.isArchived || project.status === "archived";
    if (archived) {
      stats.archivedProjects++;
      continue;
    }
    stats.totalProjects++;
    const projectStats = getReporterProjectStats(project.id);
    stats.totalFindings += projectStats.findings || 0;
    stats.criticalFindings += projectStats.bySeverity?.critical || 0;
    stats.highFindings += projectStats.bySeverity?.high || 0;
  }
  return stats;
}

function buildProjectRenderInput(projectId) {
  const project = getReporterProjectById(projectId);
  if (!project) return null;
  const design = getReporterDesignById(project.designId);
  const members = listReporterProjectMembers(projectId);
  const sections = listReporterSectionsByProject(projectId);
  const findings = listReporterFindingsByProject(projectId).map((finding) => getReporterFindingByIdRow(finding.id));
  const evidence = listReporterEvidenceByProject(projectId);
  const stats = getReporterProjectStats(projectId);
  return { project, design, members, sections, findings, evidence, stats };
}

function ensureReporterEvidenceDir() {
  fs.mkdirSync(REPORTER_EVIDENCE_DIR, { recursive: true });
}

function safeDownloadName(value, fallback = "report") {
  return String(value || fallback).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || fallback;
}

function cvssLevelFromScore(score) {
  if (score == null) return "info";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

function normalizeSectionDefinitions(definitions) {
  if (!Array.isArray(definitions)) return [];
  return definitions.map((section, index) => {
    const id = String(section.id || section.name || section.sectionType || `section_${index + 1}`);
    const label = String(section.label || section.title || id.replace(/_/g, " "));
    return {
      id,
      label,
      content: String(section.content || section.default || section.defaultContent || ""),
      orderIndex: Number.isFinite(Number(section.orderIndex)) ? Number(section.orderIndex) : index,
    };
  }).filter((section) => section.id && section.label);
}

function setEmbeddablePdfPreviewHeaders(res, filename = "preview.pdf") {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeDownloadName(filename, "preview.pdf")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
}

function setEmbeddableHtmlPreviewHeaders(res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
}

function applyRenderOptions(input, options = {}) {
  if (!input?.project) return input;
  const versionNumber = String(options.versionNumber || "").trim();
  if (versionNumber) {
    input.project = {
      ...input.project,
      version: versionNumber,
      projectMetadata: { ...(input.project.projectMetadata || {}), report_version: versionNumber },
    };
  }
  return input;
}

function sendTempPdfPreview(req, res, pdf, filenameBase) {
  ensureReporterPdfDir();
  const safeBase = safeDownloadName(filenameBase, "preview");
  const safeUser = safeDownloadName(req.access?.userId || "user", "user");
  const filePath = path.join(REPORTER_PDF_DIR, `preview-${safeBase}-${safeUser}.pdf`);
  fs.writeFileSync(filePath, pdf);
  setEmbeddablePdfPreviewHeaders(res, `${safeBase}.pdf`);
  res.sendFile(filePath);
}

function recordReporterHistory(projectId, targetType, targetId, snapshot, changeSummary, userId, versionNumber = 1) {
  try {
    createReporterHistoryRow({ projectId, targetType, targetId, snapshot, changeSummary, createdBy: userId, versionNumber });
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", msg: "reporter_history_write_failed", projectId, targetType, targetId, error: err.message }));
  }
}

function validateReporterTarget(targetType, targetId, projectId) {
  if (targetType === "project") return targetId === projectId;
  if (targetType === "finding") {
    const finding = getReporterFindingByIdRow(targetId);
    return !!finding && finding.projectId === projectId;
  }
  if (targetType === "section") {
    const section = getReporterSectionByIdRow(targetId);
    return !!section && section.projectId === projectId;
  }
  if (targetType === "note") {
    const note = getReporterNoteById(targetId);
    return !!note && note.projectId === projectId;
  }
  return false;
}

const VALID_SEVERITIES = ["critical", "high", "medium", "low", "info"];
const VALID_PROJECT_STATUSES = ["draft", "in_progress", "in_review", "approved", "delivered", "archived"];
const VALID_FINDING_STATUSES = ["draft", "ready_for_review", "changes_requested", "approved", "client_ready", "retest", "closed"];
const VALID_MEMBER_ROLES = ["lead", "pentester", "reviewer"];
const VALID_REPORT_TYPES = ["internal", "external", "webapp", "cloud", "build", "redteam", "wireless", "config", "custom"];
const VALID_SECTION_TYPES = ["executive_summary", "scope", "methodology", "findings_overview", "recommendations", "appendix", "custom"];
const VALID_COMMENT_TARGETS = ["project", "finding", "section", "note"];
const VALID_EVIDENCE_TYPES = ["file", "screenshot", "asset", "scan", "appendix"];
const VALID_REDACTION_STATUSES = ["not_required", "pending", "redacted", "approved"];

function parseCvssScore(vector) {
  const raw = String(vector || "").trim();
  if (!raw.startsWith("CVSS:4.0/") && !raw.startsWith("CVSS:3.1/") && !raw.startsWith("CVSS:3.0/")) return null;
  const metrics = {};
  for (const part of raw.split("/").slice(1)) {
    const [key, val] = part.split(":");
    if (key && val) metrics[key] = val;
  }
  if (raw.startsWith("CVSS:4.0/")) return parseCvss40Score(metrics);
  const required = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"];
  if (!required.every((key) => metrics[key])) return null;
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const ui = { N: 0.85, R: 0.62 }[metrics.UI];
  const scopeChanged = metrics.S === "C";
  const pr = scopeChanged
    ? { N: 0.85, L: 0.68, H: 0.5 }[metrics.PR]
    : { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR];
  const c = { H: 0.56, L: 0.22, N: 0 }[metrics.C];
  const i = { H: 0.56, L: 0.22, N: 0 }[metrics.I];
  const a = { H: 0.56, L: 0.22, N: 0 }[metrics.A];
  if ([av, ac, pr, ui, c, i, a].some((value) => value === undefined)) return null;
  const iss = 1 - ((1 - c) * (1 - i) * (1 - a));
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const baseScore = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return Math.ceil(baseScore * 10) / 10;
}

function parseCvss40Score(metrics) {
  const required = ["AV", "AC", "AT", "PR", "UI", "VC", "VI", "VA", "SC", "SI", "SA"];
  if (!required.every((key) => metrics[key])) return null;
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const at = { N: 0.85, P: 0.62 }[metrics.AT];
  const pr = { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR];
  const ui = { N: 0.85, P: 0.62, A: 0.45 }[metrics.UI];
  const impactMap = { H: 0.56, L: 0.22, N: 0 };
  const impacts = ["VC", "VI", "VA", "SC", "SI", "SA"].map((key) => impactMap[metrics[key]]);
  if ([av, ac, at, pr, ui, ...impacts].some((value) => value === undefined)) return null;
  const iss = 1 - impacts.reduce((acc, value) => acc * (1 - value), 1);
  const impact = 6.42 * iss;
  const exploitability = 8.22 * av * ac * at * pr * ui;
  if (impact <= 0) return 0;
  return Math.ceil(Math.min(impact + exploitability, 10) * 10) / 10;
}

router.post("/reporter/cvss/parse", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const vector = String(req.body?.vector || "").trim();
  const score = parseCvssScore(vector);
  res.json({ vector, score, severity: cvssLevelFromScore(score), valid: score !== null });
});

// --- Bootstrap ---

router.get("/reporter/bootstrap", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const caps = getCapabilities(req);
  const projects = listReporterProjects(req.access.userId, caps.canManageAll);
  const stats = caps.canManageAll ? getReporterGlobalStats() : buildVisibleReporterStats(projects);
  const designs = listReporterDesigns();
  const templates = listReporterFindingTemplates();

  res.json({
    currentUserId: req.access.userId,
    currentUsername: req.access.username,
    capabilities: caps,
    stats,
    projects: projects.filter((p) => !p.isArchived || caps.canManageAll),
    designs,
    templates,
  });
});

router.get("/reporter/users", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const result = listUsers(1, 500);
  res.json({
    users: (result.users || [])
      .filter((user) => !user.suspended)
      .map((user) => ({ id: user.id, username: user.username, email: user.email })),
  });
});

router.post("/reporter/markdown-preview", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const markdown = typeof req.body?.markdown === "string" ? req.body.markdown : "";
  res.json({ html: renderMarkdownToHtml(markdown) });
});

// --- Designs ---

router.get("/reporter/designs", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  res.json(listReporterDesigns());
});

router.get("/reporter/designs/:id", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found" });
  res.json({
    ...design,
    htmlTemplate: design.htmlTemplate || defaultHtmlTemplate(),
    cssTemplate: design.cssTemplate || defaultCssTemplate(),
  });
});

function buildDesignPreviewInput(design, username) {
  return {
    project: {
      id: "preview-project",
      title: `${design.name} Preview`,
      reportType: design.reportType,
      status: "draft",
      version: 1,
      clientName: "Preview Client",
      projectMetadata: {},
    },
    design,
    members: [{ username, role: "lead" }],
    sections: [
      { id: "preview-summary", title: "Executive Summary", sectionType: "executive_summary", content: "This preview uses sample content so you can validate the report layout.", orderIndex: 0, isIncluded: true },
      { id: "preview-scope", title: "Scope", sectionType: "scope", content: "- Web application\n- External perimeter\n- Authentication workflows", orderIndex: 1, isIncluded: true },
    ],
    findings: [
      {
        id: "preview-finding",
        title: "Example SQL Injection",
        category: "Injection",
        severity: "high",
        cvssVector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
        cvssScore: 9.8,
        status: "approved",
        isIncluded: true,
        fields: {
          description: "The application concatenates user input into a SQL query.",
          attack_scenario: "An attacker can extract sensitive records by modifying query parameters.",
          remediation: "Use parameterized queries and centralized input validation.",
          references: "- OWASP SQL Injection\n- CWE-89",
          affected_components: "Web application",
        },
      },
    ],
    evidence: [{ filename: "request-response.txt", caption: "Captured proof of concept request", evidenceType: "file", redactionStatus: "approved", sizeBytes: 2048 }],
    stats: { findings: 1, sections: 2, bySeverity: { high: 1 } },
  };
}

router.get("/reporter/designs/:id/preview", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found" });
  try {
    const sampleInput = buildDesignPreviewInput(design, req.access.username);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(renderReportHtml(sampleInput, { cssHref: `/api/reporter/designs/${encodeURIComponent(design.id)}/preview.css` }));
  } catch (err) {
    res.status(500).json({ error: "Failed to render design preview" });
  }
});

router.get("/reporter/designs/:id/preview.pdf", requireUser, attachUserAccess, canViewReporter, async (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found" });
  try {
    const html = renderReportHtml(buildDesignPreviewInput(design, req.access.username));
    const pdf = await renderPdfBuffer(html, { timeoutMs: parseInt(process.env.REPORTER_PDF_TIMEOUT_MS, 10) || undefined });
    sendTempPdfPreview(req, res, pdf, `${design.name || "design"}-preview`);
  } catch (err) {
    res.status(500).json({ error: "Failed to render design PDF preview" });
  }
});

router.get("/reporter/designs/:id/preview.css", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).type("text/plain").send("Design not found");
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(design.cssTemplate || defaultCssTemplate());
});

router.post("/reporter/designs", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { name, description, reportType, htmlTemplate, cssTemplate, fieldDefinitions, sectionDefinitions, findingFieldDefinitions, findingOrderingRule, findingGroupingRule } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Design name is required" });
  const type = VALID_REPORT_TYPES.includes(reportType) ? reportType : "custom";
  try {
    const row = createReporterDesignRow({
      name: String(name).trim(),
      description: String(description || "").trim(),
      reportType: type,
      htmlTemplate: htmlTemplate || defaultHtmlTemplate(),
      cssTemplate: cssTemplate || defaultCssTemplate(),
      fieldDefinitions: Array.isArray(fieldDefinitions) ? fieldDefinitions : [],
      sectionDefinitions: Array.isArray(sectionDefinitions) ? sectionDefinitions : [],
      findingFieldDefinitions: Array.isArray(findingFieldDefinitions) ? findingFieldDefinitions : [],
      findingOrderingRule: findingOrderingRule || "severity_desc",
      findingGroupingRule: findingGroupingRule || null,
      createdBy: req.access.userId,
    });
    res.json({ success: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create design" });
  }
});

router.post("/reporter/designs/:id/duplicate", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const source = getReporterDesignById(req.params.id);
  if (!source) return res.status(404).json({ error: "Design not found" });
  const name = String(req.body?.name || `${source.name} Copy`).trim();
  try {
    const row = createReporterDesignRow({
      name,
      description: source.description,
      reportType: source.reportType,
      htmlTemplate: source.htmlTemplate || defaultHtmlTemplate(),
      cssTemplate: source.cssTemplate || defaultCssTemplate(),
      fieldDefinitions: source.fieldDefinitions,
      sectionDefinitions: source.sectionDefinitions,
      findingFieldDefinitions: source.findingFieldDefinitions,
      findingOrderingRule: source.findingOrderingRule || "severity_desc",
      findingGroupingRule: source.findingGroupingRule || null,
      createdBy: req.access.userId,
    });
    res.json({ success: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to duplicate design" });
  }
});

router.put("/reporter/designs/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found" });
  if (design.isBuiltin) return res.status(403).json({ error: "Cannot modify built-in designs" });
  const { name, description, reportType, htmlTemplate, cssTemplate, fieldDefinitions, sectionDefinitions, findingFieldDefinitions, findingOrderingRule, findingGroupingRule } = req.body;
  try {
    updateReporterDesignRow(req.params.id, {
      name: name !== undefined ? String(name).trim() : design.name,
      description: description !== undefined ? String(description).trim() : design.description,
      reportType: VALID_REPORT_TYPES.includes(reportType) ? reportType : design.reportType,
      htmlTemplate: htmlTemplate !== undefined ? String(htmlTemplate) : design.htmlTemplate,
      cssTemplate: cssTemplate !== undefined ? String(cssTemplate) : design.cssTemplate,
      fieldDefinitions: Array.isArray(fieldDefinitions) ? fieldDefinitions : design.fieldDefinitions,
      sectionDefinitions: Array.isArray(sectionDefinitions) ? sectionDefinitions : design.sectionDefinitions,
      findingFieldDefinitions: Array.isArray(findingFieldDefinitions) ? findingFieldDefinitions : design.findingFieldDefinitions,
      findingOrderingRule: findingOrderingRule || design.findingOrderingRule,
      findingGroupingRule: findingGroupingRule !== undefined ? findingGroupingRule : design.findingGroupingRule,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update design" });
  }
});

router.delete("/reporter/designs/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const design = getReporterDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found" });
  if (design.isBuiltin) return res.status(403).json({ error: "Cannot delete built-in designs" });
  const ok = deleteReporterDesignById(req.params.id);
  if (!ok) return res.status(404).json({ error: "Design not found or built-in" });
  res.json({ success: true });
});

// --- Projects ---

router.get("/reporter/projects", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const caps = getCapabilities(req);
  const projects = listReporterProjects(req.access.userId, caps.canManageAll);
  res.json(projects);
});

router.post("/reporter/projects", writeLimiter, requireUser, attachUserAccess, canCreateReporter, (req, res) => {
  const { designId, title, clientName, dueDate, members, tags } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Project title is required" });
  if (!designId) return res.status(400).json({ error: "Design ID is required" });
  const design = getReporterDesignById(designId);
  if (!design) return res.status(400).json({ error: "Design not found" });
  try {
    const memberList = [{ userId: req.access.userId, role: "lead" }];
    if (Array.isArray(members)) {
      for (const m of members) {
        if (m.userId && m.userId !== req.access.userId && VALID_MEMBER_ROLES.includes(m.role)) {
          memberList.push({ userId: m.userId, role: m.role });
        }
      }
    }
    const row = createReporterProjectRow({
      designId,
      title: String(title).trim(),
      reportType: design.reportType,
      clientName: String(clientName || "").trim(),
      dueDate: dueDate ? parseInt(dueDate, 10) || null : null,
      members: memberList,
      createdBy: req.access.userId,
      projectType: design.projectType || "report", // compatibility: column retained but proposals now use reporter_proposals table
      testTypes: Array.isArray(req.body.testTypes) ? req.body.testTypes : [],
    });
    for (const section of normalizeSectionDefinitions(design.sectionDefinitions)) {
      createReporterSectionRow({
        projectId: row.id,
        title: section.label,
        sectionType: VALID_SECTION_TYPES.includes(section.id) ? section.id : "custom",
        content: section.content,
        orderIndex: section.orderIndex,
        createdBy: req.access.userId,
      });
    }
    if (Array.isArray(tags) && tags.length) {
      updateReporterProjectRow(row.id, { title: row.title, clientName: row.clientName, tags });
    }
    recordReporterHistory(row.id, "project", row.id, row, "Project created", req.access.userId, row.version || 1);
    auditReporter(req, {
      action: "project_create",
      targetId: row.id,
      metadata: { title: row.title, reportType: row.reportType, memberCount: memberList.length },
    });
    res.json({ success: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.get("/reporter/projects/:id", requireUser, attachUserAccess, canViewReporter, async (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  const members = listReporterProjectMembers(req.params.id);
  const stats = getReporterProjectStats(req.params.id);
  const design = getReporterDesignById(project.designId);
  const engageLink = getEngageEngagementByReporterProject(req.params.id);
  res.json({ project, members, ...stats, design: design ? { id: design.id, name: design.name, findingFieldDefinitions: design.findingFieldDefinitions } : null, engageEngagement: engageLink || null });
});

router.put("/reporter/projects/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  if (project.readonly) return res.status(403).json({ error: "Project is readonly" });
  const { title, clientName, projectMetadata, dueDate, tags, overrideFindingOrder } = req.body;
  try {
    const updated = updateReporterProjectRow(req.params.id, {
      title: title !== undefined ? String(title).trim() : project.title,
      clientName: clientName !== undefined ? String(clientName).trim() : project.clientName,
      projectMetadata: projectMetadata !== undefined ? projectMetadata : project.projectMetadata,
      dueDate: dueDate !== undefined ? (parseInt(dueDate, 10) || null) : project.dueDate,
      tags: tags !== undefined ? tags : project.tags,
      overrideFindingOrder: overrideFindingOrder !== undefined ? overrideFindingOrder : project.overrideFindingOrder,
    });
    recordReporterHistory(req.params.id, "project", req.params.id, updated, "Project updated", req.access.userId, updated.version || project.version || 1);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/reporter/projects/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const caps = getCapabilities(req);
  const isLead = listReporterProjectMembers(req.params.id).some((member) => member.userId === req.access.userId && member.role === "lead");
  if (!caps.canManageAll && !(isLead && project.status === "draft" && caps.canEditOwn)) {
    return res.status(403).json({ error: "Cannot delete this project" });
  }
  for (const evidence of listReporterEvidenceByProject(req.params.id)) {
    const resolvedDir = path.resolve(REPORTER_EVIDENCE_DIR);
    const resolvedFile = path.resolve(REPORTER_EVIDENCE_DIR, evidence.storedFilename);
    if (resolvedFile.startsWith(resolvedDir + path.sep) && fs.existsSync(resolvedFile)) fs.unlinkSync(resolvedFile);
  }
  for (const pdf of listReporterPdfGenerationsByProject(req.params.id)) {
    if (!pdf.filePath) continue;
    const resolvedDir = path.resolve(REPORTER_PDF_DIR);
    const resolvedFile = path.resolve(pdf.filePath);
    if (resolvedFile.startsWith(resolvedDir + path.sep) && fs.existsSync(resolvedFile)) fs.unlinkSync(resolvedFile);
  }
  deleteReporterProjectById(req.params.id);
  auditReporter(req, {
    action: "project_delete",
    targetId: req.params.id,
    metadata: { title: project.title, status: project.status },
  });
  res.json({ success: true });
});

router.put("/reporter/projects/:id/status", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const { status } = req.body;
  if (!VALID_PROJECT_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const updated = updateReporterProjectStatus(req.params.id, status);
  recordReporterHistory(req.params.id, "project", req.params.id, updated || { ...project, status }, `Project status changed to ${status}`, req.access.userId, updated?.version || project.version || 1);
  auditReporter(req, {
    action: "project_status_change",
    targetId: req.params.id,
    metadata: { from: project.status, to: status },
  });
  if (["in_review", "approved"].includes(status)) {
    const notifyMembers = listReporterProjectMembers(req.params.id);
    for (const m of notifyMembers) {
      if (m.userId === req.access.userId) continue;
      createNotification({
        userId: m.userId, category: "reporter", action: "project_status_changed",
        title: status === "in_review" ? "Report sent for review" : "Report approved",
        body: `"${project.title}" is now ${status.replace(/_/g, " ")}`,
        linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
      });
    }
  }
  res.json({ success: true });
});

router.post("/reporter/projects/:id/archive", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  archiveReporterProjectRow(req.params.id, true);
  auditReporter(req, { action: "project_archive", targetId: req.params.id, metadata: { title: project.title } });
  res.json({ success: true });
});

router.post("/reporter/projects/:id/unarchive", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  archiveReporterProjectRow(req.params.id, false);
  auditReporter(req, { action: "project_unarchive", targetId: req.params.id, metadata: { title: project.title } });
  res.json({ success: true });
});

router.put("/reporter/projects/:id/readonly", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const caps = getCapabilities(req);
  const isLead = listReporterProjectMembers(req.params.id).some((member) => member.userId === req.access.userId && member.role === "lead");
  if (!caps.canManageAll && !(isLead && caps.canEditOwn)) {
    return res.status(403).json({ error: "Cannot change readonly status" });
  }
  const { readonly } = req.body;
  if (typeof readonly !== "boolean") return res.status(400).json({ error: "readonly must be boolean" });
  setReporterProjectReadonly(req.params.id, readonly);
  recordReporterHistory(req.params.id, "project", req.params.id, project, readonly ? "Project locked (readonly)" : "Project unlocked", req.access.userId);
  auditReporter(req, {
    action: "project_readonly_change",
    targetId: req.params.id,
    metadata: { readonly: !!readonly, title: project.title },
  });
  res.json({ success: true });
});

router.post("/reporter/projects/:id/duplicate", writeLimiter, requireUser, attachUserAccess, canCreateReporter, async (req, res) => {
  const source = getReporterProjectById(req.params.id);
  if (!source) return res.status(404).json({ error: "Source project not found" });
  if (!canAccessProject(req, source)) return res.status(403).json({ error: "Cannot duplicate this project" });
  const { title } = req.body;
  const dup = duplicateReporterProject(req.params.id, title, req.access.userId);
  if (!dup) return res.status(500).json({ error: "Failed to duplicate project" });
  res.json({ success: true, id: dup.id });
});

// --- Rendering / PDF ---

router.get("/reporter/projects/:id/render-preview", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const input = buildProjectRenderInput(req.params.id);
  if (!input) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, input.project)) return res.status(403).json({ error: "Not a project member" });
  try {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(renderReportHtml(input, { cssHref: `/api/reporter/projects/${encodeURIComponent(req.params.id)}/render-preview.css` }));
  } catch (err) {
    res.status(500).json({ error: "Failed to render preview" });
  }
});

router.get("/reporter/projects/:id/render-preview.pdf", requireUser, attachUserAccess, canViewReporter, async (req, res) => {
  const input = buildProjectRenderInput(req.params.id);
  if (!input) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, input.project)) return res.status(403).json({ error: "Not a project member" });
  try {
    const html = renderReportHtml(applyRenderOptions(input, { versionNumber: req.query.version }));
    const pdf = await renderPdfBuffer(html, { timeoutMs: parseInt(process.env.REPORTER_PDF_TIMEOUT_MS, 10) || undefined });
    sendTempPdfPreview(req, res, pdf, `${input.project.title || "project"}-preview`);
  } catch (err) {
    res.status(500).json({ error: "Failed to render PDF preview" });
  }
});

router.get("/reporter/projects/:id/render-preview.css", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).type("text/plain").send("Project not found");
  if (!canAccessProject(req, project)) return res.status(403).type("text/plain").send("Not a project member");
  const design = getReporterDesignById(project.designId);
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(design?.cssTemplate || defaultCssTemplate());
});

router.get("/reporter/projects/:id/pdfs", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterPdfGenerationsByProject(req.params.id));
});

router.post("/reporter/projects/:id/render-pdf", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });

  const generation = createReporterPdfGenerationRow({
    projectId: req.params.id,
    status: "pending",
    renderOptions: req.body?.options || {},
    generatedBy: req.access.userId,
  });

  try {
    const input = buildProjectRenderInput(req.params.id);
    applyRenderOptions(input, req.body?.options || {});
    const html = renderReportHtml(input);
    const pdf = await renderPdfBuffer(html, { timeoutMs: parseInt(process.env.REPORTER_PDF_TIMEOUT_MS, 10) || undefined });
    ensureReporterPdfDir();
    const filename = `${generation.id}.pdf`;
    const filePath = path.join(REPORTER_PDF_DIR, filename);
    fs.writeFileSync(filePath, pdf);
    const updated = updateReporterPdfGenerationRow(generation.id, {
      filePath,
      fileSize: pdf.length,
      status: "complete",
      errorMessage: null,
      renderOptions: req.body?.options || {},
    });
    auditReporter(req, {
      action: "pdf_generate",
      targetType: "reporter_pdf",
      targetId: generation.id,
      metadata: { projectId: req.params.id, fileSize: pdf.length },
    });
    createNotification({
      userId: req.access.userId, category: "reporter", action: "pdf_generation_complete",
      title: "Report PDF generated",
      body: `PDF for "${project.title}" is ready`,
      linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
      severity: "success",
    });
    res.json({ success: true, generation: updated });
  } catch (err) {
    const failed = updateReporterPdfGenerationRow(generation.id, {
      filePath: "",
      fileSize: null,
      status: "failed",
      errorMessage: err.message || "PDF rendering failed",
      renderOptions: req.body?.options || {},
    });
    createNotification({
      userId: req.access.userId, category: "reporter", action: "pdf_generation_failed",
      title: "Report PDF generation failed",
      body: `PDF for "${project.title}" failed: ${(err.message || "").substring(0, 100)}`,
      linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
      severity: "critical",
    });
    res.status(500).json({ error: failed.errorMessage, generation: failed });
  }
});

router.get("/reporter/projects/:id/check", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const input = buildProjectRenderInput(req.params.id);
  if (!input) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, input.project)) return res.status(403).json({ error: "Not a project member" });

  const messages = [];
  const todoPattern = /\b(TODO|ToDo|TO-DO|To-Do)\b/gi;
  if (!input.project.title) messages.push({ level: "error", location: "project.title", message: "Project title is required." });
  if (!input.design) messages.push({ level: "error", location: "project.design", message: "Report design is missing." });
  if (!input.sections.length) messages.push({ level: "warning", location: "sections", message: "Report has no sections." });
  if (!input.findings.length) messages.push({ level: "warning", location: "findings", message: "Report has no findings." });
  for (const section of input.sections) {
    if (section.isIncluded !== false) {
      if (!String(section.content || "").trim()) {
        messages.push({ level: "warning", location: `section:${section.id}`, message: `Section "${section.title}" has no content.` });
      } else if (todoPattern.test(section.content)) {
        messages.push({ level: "warning", location: `section:${section.id}`, message: `Section "${section.title}" contains unresolved TODO markers.` });
      }
    }
  }
  for (const finding of input.findings) {
    if (finding.isIncluded === false) continue;
    if (!VALID_FINDING_STATUSES.includes(finding.status)) {
      messages.push({ level: "error", location: `finding:${finding.id}`, message: `Finding "${finding.title}" has an invalid status.` });
    }
    if (finding.status === "draft") {
      messages.push({ level: "warning", location: `finding:${finding.id}`, message: `Finding "${finding.title}" is still in draft.` });
    }
    const fields = finding.fields || {};
    if (!String(fields.description || "").trim()) {
      messages.push({ level: "warning", location: `finding:${finding.id}`, message: `Finding "${finding.title}" has no description.` });
    }
    if (!String(fields.remediation || "").trim()) {
      messages.push({ level: "warning", location: `finding:${finding.id}`, message: `Finding "${finding.title}" has no remediation.` });
    }
    for (const [name, value] of Object.entries(fields)) {
      if (typeof value === "string" && todoPattern.test(value)) {
        messages.push({ level: "warning", location: `finding:${finding.id}.${name}`, message: `Finding "${finding.title}" field "${name}" contains unresolved TODO markers.` });
        todoPattern.lastIndex = 0;
      }
    }
  }
  res.json({ ok: !messages.some((m) => m.level === "error"), messages });
});

router.post("/reporter/projects/:id/md2html", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const input = buildProjectRenderInput(req.params.id);
  if (!input) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, input.project)) return res.status(403).json({ error: "Not a project member" });
  const sections = input.sections.map((section) => ({ id: section.id, html: renderMarkdownToHtml(section.content || "") }));
  const findings = input.findings.map((finding) => ({
    id: finding.id,
    fields: Object.fromEntries(Object.entries(finding.fields || {}).map(([name, value]) => [name, renderMarkdownToHtml(value || "")])),
  }));
  res.json({ sections, findings });
});

router.get("/reporter/pdfs/:id/download", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const generation = getReporterPdfGenerationById(req.params.id);
  if (!generation) return res.status(404).json({ error: "PDF not found" });
  const project = getReporterProjectById(generation.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  if (generation.status !== "complete" || !generation.filePath) {
    return res.status(404).json({ error: "PDF is not ready" });
  }

  const resolvedDir = path.resolve(REPORTER_PDF_DIR);
  const resolvedFile = path.resolve(generation.filePath);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) || !fs.existsSync(resolvedFile)) {
    return res.status(404).json({ error: "PDF file missing" });
  }

  const version = generation.renderOptions?.versionNumber ? `-v${generation.renderOptions.versionNumber}` : "";
  const filenameBase = `${String(project.title || "report").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "report"}${version}`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  auditReporter(req, {
    action: "pdf_download",
    targetType: "reporter_pdf",
    targetId: generation.id,
    metadata: { projectId: project.id, filename: `${filenameBase}.pdf` },
  });
  fs.createReadStream(resolvedFile).pipe(res);
});

router.delete("/reporter/pdfs/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const generation = getReporterPdfGenerationById(req.params.id);
  if (!generation) return res.status(404).json({ error: "PDF not found" });
  const project = await loadProjectForEdit(req, generation.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  if (generation.filePath) {
    const resolvedDir = path.resolve(REPORTER_PDF_DIR);
    const resolvedFile = path.resolve(generation.filePath);
    if (resolvedFile.startsWith(resolvedDir + path.sep) && fs.existsSync(resolvedFile)) {
      fs.unlinkSync(resolvedFile);
    }
  }
  deleteReporterPdfGenerationById(req.params.id);
  recordReporterHistory(generation.projectId, "project", generation.projectId, generation, "PDF version deleted", req.access.userId);
  res.json({ success: true });
});

// --- Project Notes / Comments / Evidence / History / Archives ---

router.get("/reporter/projects/:id/notes", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterNotesByProject(req.params.id));
});

router.post("/reporter/projects/:id/notes", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const note = createReporterNoteRow({
    projectId: req.params.id,
    title: String(req.body.title || "Untitled Note").trim() || "Untitled Note",
    content: String(req.body.content || ""),
    orderIndex: parseInt(req.body.orderIndex, 10) || 0,
    createdBy: req.access.userId,
  });
  recordReporterHistory(req.params.id, "note", note.id, note, "Note created", req.access.userId);
  res.json({ success: true, note });
});

router.put("/reporter/notes/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const note = getReporterNoteById(req.params.id);
  if (!note) return res.status(404).json({ error: "Note not found" });
  const project = await loadProjectForEdit(req, note.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const updated = updateReporterNoteRow(req.params.id, {
    title: req.body.title !== undefined ? String(req.body.title).trim() : note.title,
    content: req.body.content !== undefined ? String(req.body.content) : note.content,
    orderIndex: req.body.orderIndex !== undefined ? parseInt(req.body.orderIndex, 10) || 0 : note.orderIndex,
  });
  recordReporterHistory(note.projectId, "note", note.id, updated, "Note updated", req.access.userId);
  res.json({ success: true, note: updated });
});

router.delete("/reporter/notes/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const note = getReporterNoteById(req.params.id);
  if (!note) return res.status(404).json({ error: "Note not found" });
  const project = await loadProjectForEdit(req, note.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  if (!canDeleteOwnedReporterItem(req, note)) return res.status(403).json({ error: "Only the note creator or a Reporter manager can delete this note" });
  deleteReporterNoteById(req.params.id);
  recordReporterHistory(note.projectId, "note", note.id, note, "Note deleted", req.access.userId);
  res.json({ success: true });
});

router.get("/reporter/projects/:id/comments", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterCommentsByProject(req.params.id));
});

router.get("/reporter/comments/:targetType/:targetId", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const { targetType, targetId } = req.params;
  if (!VALID_COMMENT_TARGETS.includes(targetType)) return res.status(400).json({ error: "Invalid target type" });
  let project = null;
  if (targetType === "project") project = getReporterProjectById(targetId);
  if (targetType === "finding") {
    const finding = getReporterFindingByIdRow(targetId);
    if (finding) project = getReporterProjectById(finding.projectId);
  }
  if (targetType === "section") {
    const section = getReporterSectionByIdRow(targetId);
    if (section) project = getReporterProjectById(section.projectId);
  }
  if (targetType === "note") {
    const note = getReporterNoteById(targetId);
    if (note) project = getReporterProjectById(note.projectId);
  }
  if (!project) return res.status(404).json({ error: "Comment target not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  const comments = listReporterCommentsByTarget(targetType, targetId);
  res.json(comments);
});

router.post("/reporter/projects/:id/comments", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const targetType = String(req.body.targetType || "project");
  const targetId = String(req.body.targetId || req.params.id);
  const content = String(req.body.content || "").trim();
  if (!VALID_COMMENT_TARGETS.includes(targetType)) return res.status(400).json({ error: "Invalid target type" });
  if (!content) return res.status(400).json({ error: "Comment is required" });
  if (!validateReporterTarget(targetType, targetId, req.params.id)) return res.status(400).json({ error: "Comment target is not part of this project" });
  const id = createReporterCommentRow({ projectId: req.params.id, targetType, targetId, content, createdBy: req.access.userId });
  const comment = getReporterCommentById(id);
  recordReporterHistory(req.params.id, targetType, targetId, comment, "Comment added", req.access.userId);
  const mentionMatches = content.match(/@(\w[\w.-]*)/g);
  if (mentionMatches) {
    const seen = new Set();
    for (const match of mentionMatches) {
      const username = match.substring(1);
      if (seen.has(username.toLowerCase())) continue;
      seen.add(username.toLowerCase());
      const user = getUserByUsername(username);
      if (user && user.id !== req.access.userId) {
        createNotification({
          userId: user.id, category: "reporter", action: "comment_mention",
          title: "Mentioned in a comment",
          body: `You were mentioned in "${project.title}"`,
          linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
        });
      }
    }
  }
  res.json({ success: true, comment });
});

router.put("/reporter/comments/:id/resolve", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const comment = getReporterCommentById(req.params.id);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  const project = await loadProjectForEdit(req, comment.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const isResolved = req.body.isResolved !== false;
  resolveReporterCommentRow(req.params.id, isResolved);
  recordReporterHistory(comment.projectId, comment.targetType, comment.targetId, { ...comment, isResolved }, isResolved ? "Comment resolved" : "Comment reopened", req.access.userId);
  res.json({ success: true });
});

router.delete("/reporter/comments/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const comment = getReporterCommentById(req.params.id);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  const project = await loadProjectForEdit(req, comment.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  if (!canDeleteOwnedReporterItem(req, comment)) return res.status(403).json({ error: "Only the comment creator or a Reporter manager can delete this comment" });
  deleteReporterCommentById(req.params.id);
  recordReporterHistory(comment.projectId, comment.targetType, comment.targetId, comment, "Comment deleted", req.access.userId);
  res.json({ success: true });
});

router.get("/reporter/projects/:id/history", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterHistoryByProject(req.params.id));
});

router.get("/reporter/projects/:id/evidence", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterEvidenceByProject(req.params.id));
});

router.post("/reporter/projects/:id/evidence", writeLimiter, requireUser, attachUserAccess, evidenceUpload.single("file"), async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  if (!req.file) return res.status(400).json({ error: "File is required" });
  const findingId = req.body.findingId || null;
  const sectionId = req.body.sectionId || null;
  if (findingId && !validateReporterTarget("finding", findingId, req.params.id)) return res.status(400).json({ error: "Finding is not part of this project" });
  if (sectionId && !validateReporterTarget("section", sectionId, req.params.id)) return res.status(400).json({ error: "Section is not part of this project" });

  ensureReporterEvidenceDir();
  const storedFilename = `${crypto.randomBytes(16).toString("hex")}-${safeDownloadName(req.file.originalname, "evidence")}`;
  const fullPath = path.join(REPORTER_EVIDENCE_DIR, storedFilename);
  fs.writeFileSync(fullPath, req.file.buffer);
  const evidence = createReporterEvidenceRow({
    projectId: req.params.id,
    findingId,
    sectionId,
    filename: req.file.originalname,
    storedFilename,
    mimeType: req.file.mimetype || "application/octet-stream",
    sizeBytes: req.file.size,
    caption: String(req.body.caption || ""),
    evidenceType: VALID_EVIDENCE_TYPES.includes(req.body.evidenceType) ? req.body.evidenceType : "file",
    redactionStatus: VALID_REDACTION_STATUSES.includes(req.body.redactionStatus) ? req.body.redactionStatus : "not_required",
    createdBy: req.access.userId,
  });
  recordReporterHistory(req.params.id, "evidence", evidence.id, evidence, "Evidence uploaded", req.access.userId);
  res.json({ success: true, evidence });
});

router.put("/reporter/evidence/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const evidence = getReporterEvidenceById(req.params.id);
  if (!evidence) return res.status(404).json({ error: "Evidence not found" });
  const project = await loadProjectForEdit(req, evidence.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const findingId = req.body.findingId || null;
  const sectionId = req.body.sectionId || null;
  if (findingId && !validateReporterTarget("finding", findingId, evidence.projectId)) return res.status(400).json({ error: "Finding is not part of this project" });
  if (sectionId && !validateReporterTarget("section", sectionId, evidence.projectId)) return res.status(400).json({ error: "Section is not part of this project" });
  const updated = updateReporterEvidenceRow(req.params.id, {
    findingId,
    sectionId,
    caption: req.body.caption !== undefined ? String(req.body.caption) : evidence.caption,
    evidenceType: VALID_EVIDENCE_TYPES.includes(req.body.evidenceType) ? req.body.evidenceType : evidence.evidenceType,
    redactionStatus: VALID_REDACTION_STATUSES.includes(req.body.redactionStatus) ? req.body.redactionStatus : evidence.redactionStatus,
  });
  recordReporterHistory(evidence.projectId, "evidence", evidence.id, updated, "Evidence updated", req.access.userId);
  res.json({ success: true, evidence: updated });
});

router.get("/reporter/evidence/:id/download", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const evidence = getReporterEvidenceById(req.params.id);
  if (!evidence) return res.status(404).json({ error: "Evidence not found" });
  const project = getReporterProjectById(evidence.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  const resolvedDir = path.resolve(REPORTER_EVIDENCE_DIR);
  const resolvedFile = path.resolve(REPORTER_EVIDENCE_DIR, evidence.storedFilename);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) || !fs.existsSync(resolvedFile)) return res.status(404).json({ error: "Evidence file missing" });
  res.setHeader("Content-Type", evidence.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName(evidence.filename, "evidence")}"`);
  fs.createReadStream(resolvedFile).pipe(res);
});

router.delete("/reporter/evidence/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const evidence = getReporterEvidenceById(req.params.id);
  if (!evidence) return res.status(404).json({ error: "Evidence not found" });
  const project = await loadProjectForEdit(req, evidence.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const resolvedDir = path.resolve(REPORTER_EVIDENCE_DIR);
  const resolvedFile = path.resolve(REPORTER_EVIDENCE_DIR, evidence.storedFilename);
  if (resolvedFile.startsWith(resolvedDir + path.sep) && fs.existsSync(resolvedFile)) fs.unlinkSync(resolvedFile);
  deleteReporterEvidenceById(req.params.id);
  recordReporterHistory(evidence.projectId, "evidence", evidence.id, evidence, "Evidence deleted", req.access.userId);
  res.json({ success: true });
});

router.get("/reporter/projects/:id/import-jobs", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterImportJobsByProject(req.params.id));
});

router.get("/reporter/projects/:id/export", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const input = buildProjectRenderInput(req.params.id);
  if (!input) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, input.project)) return res.status(403).json({ error: "Not a project member" });
  const notes = listReporterNotesByProject(req.params.id);
  const comments = listReporterCommentsByProject(req.params.id);
  const history = listReporterHistoryByProject(req.params.id);
  const pdfs = listReporterPdfGenerationsByProject(req.params.id);
  const evidence = input.evidence.map((item) => {
    const resolvedDir = path.resolve(REPORTER_EVIDENCE_DIR);
    const resolvedFile = path.resolve(REPORTER_EVIDENCE_DIR, item.storedFilename);
    const embedded = resolvedFile.startsWith(resolvedDir + path.sep) && fs.existsSync(resolvedFile)
      ? fs.readFileSync(resolvedFile).toString("base64")
      : null;
    return { ...item, fileBase64: embedded };
  });
  const archive = {
    format: "redsecreporter-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: input.project,
    design: input.design,
    members: input.members,
    sections: input.sections,
    findings: input.findings,
    notes,
    comments,
    evidence,
    history,
    pdfs: pdfs.map((pdf) => ({ ...pdf, filePath: undefined })),
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${safeDownloadName(input.project.title, "report-project")}.redsecreporter.json"`);
  res.send(JSON.stringify(archive, null, 2));
});

router.post("/reporter/import", writeLimiter, requireUser, attachUserAccess, canCreateReporter, evidenceUpload.single("archive"), (req, res) => {
  let archive;
  try {
    const raw = req.file ? req.file.buffer.toString("utf8") : JSON.stringify(req.body || {});
    archive = JSON.parse(raw);
  } catch (err) {
    return res.status(400).json({ error: "Import archive must be valid JSON" });
  }
  if (archive?.format !== "redsecreporter-project" || !archive.project) {
    return res.status(400).json({ error: "Unsupported reporter archive" });
  }

  let jobId = null;
  try {
    const sourceDesign = archive.design || {};
    const caps = getCapabilities(req);
    let design;
    if (caps.canManageTemplates || caps.canManageAll) {
      design = createReporterDesignRow({
        name: `${sourceDesign.name || archive.project.title || "Imported Design"} (Imported)`,
        description: sourceDesign.description || "",
        reportType: VALID_REPORT_TYPES.includes(sourceDesign.reportType) ? sourceDesign.reportType : "custom",
        htmlTemplate: sourceDesign.htmlTemplate || defaultHtmlTemplate(),
        cssTemplate: sourceDesign.cssTemplate || defaultCssTemplate(),
        fieldDefinitions: Array.isArray(sourceDesign.fieldDefinitions) ? sourceDesign.fieldDefinitions : [],
        sectionDefinitions: Array.isArray(sourceDesign.sectionDefinitions) ? sourceDesign.sectionDefinitions : [],
        findingFieldDefinitions: Array.isArray(sourceDesign.findingFieldDefinitions) ? sourceDesign.findingFieldDefinitions : [],
        findingOrderingRule: sourceDesign.findingOrderingRule || "severity_desc",
        findingGroupingRule: sourceDesign.findingGroupingRule || null,
        createdBy: req.access.userId,
      });
    } else {
      const designs = listReporterDesigns();
      design = designs.find((d) => d.reportType === (sourceDesign.reportType || "custom")) || designs[0];
      if (!design) return res.status(400).json({ error: "No design available for import. Contact an admin." });
    }
    const project = createReporterProjectRow({
      designId: design.id,
      title: `${archive.project.title || "Imported Project"} (Imported)`,
      reportType: design.reportType,
      clientName: archive.project.clientName || "",
      projectMetadata: archive.project.projectMetadata || {},
      dueDate: archive.project.dueDate || null,
      sourceProjectId: archive.project.id || null,
      members: [{ userId: req.access.userId, role: "lead" }],
      createdBy: req.access.userId,
    });
    jobId = createReporterImportJobRow({
      projectId: project.id,
      importType: "redsecreporter-project",
      status: "running",
      sourceFile: req.file?.originalname || "request-body.json",
      createdBy: req.access.userId,
    });

    const importedFindings = {};
    for (const finding of Array.isArray(archive.findings) ? archive.findings : []) {
      const row = createReporterFindingRow({
        projectId: project.id,
        templateId: null,
        title: finding.title || "Imported Finding",
        category: finding.category || "",
        severity: VALID_SEVERITIES.includes(finding.severity) ? finding.severity : "info",
        cvssVector: finding.cvssVector || "",
        cvssScore: finding.cvssScore || parseCvssScore(finding.cvssVector || ""),
        fields: finding.fields || {},
        createdBy: req.access.userId,
      });
      importedFindings[finding.id] = row.id;
    }
    const importedSections = {};
    for (const section of Array.isArray(archive.sections) ? archive.sections : []) {
      const row = createReporterSectionRow({
        projectId: project.id,
        title: section.title || "Imported Section",
        sectionType: VALID_SECTION_TYPES.includes(section.sectionType) ? section.sectionType : "custom",
        content: section.content || "",
        orderIndex: section.orderIndex || 0,
        createdBy: req.access.userId,
      });
      importedSections[section.id] = row.id;
    }
    for (const note of Array.isArray(archive.notes) ? archive.notes : []) {
      createReporterNoteRow({
        projectId: project.id,
        title: note.title || "Imported Note",
        content: note.content || "",
        orderIndex: note.orderIndex || 0,
        createdBy: req.access.userId,
      });
    }
    ensureReporterEvidenceDir();
    let evidenceCount = 0;
    for (const evidence of Array.isArray(archive.evidence) ? archive.evidence : []) {
      if (!evidence.fileBase64) continue;
      const buffer = Buffer.from(evidence.fileBase64, "base64");
      const storedFilename = `${crypto.randomBytes(16).toString("hex")}-${safeDownloadName(evidence.filename, "evidence")}`;
      fs.writeFileSync(path.join(REPORTER_EVIDENCE_DIR, storedFilename), buffer);
      createReporterEvidenceRow({
        projectId: project.id,
        findingId: evidence.findingId ? importedFindings[evidence.findingId] || null : null,
        sectionId: evidence.sectionId ? importedSections[evidence.sectionId] || null : null,
        filename: evidence.filename || "evidence.bin",
        storedFilename,
        mimeType: evidence.mimeType || "application/octet-stream",
        sizeBytes: buffer.length,
        caption: evidence.caption || "",
        evidenceType: VALID_EVIDENCE_TYPES.includes(evidence.evidenceType) ? evidence.evidenceType : "file",
        redactionStatus: VALID_REDACTION_STATUSES.includes(evidence.redactionStatus) ? evidence.redactionStatus : "not_required",
        createdBy: req.access.userId,
      });
      evidenceCount++;
    }
    const resultSummary = {
      findings: Object.keys(importedFindings).length,
      sections: Object.keys(importedSections).length,
      notes: Array.isArray(archive.notes) ? archive.notes.length : 0,
      evidence: evidenceCount,
    };
    updateReporterImportJobRow(jobId, { status: "complete", resultSummary, errorMessage: null });
    recordReporterHistory(project.id, "project", project.id, { archiveVersion: archive.version, resultSummary }, "Project imported", req.access.userId);
    res.json({ success: true, projectId: project.id, designId: design.id, resultSummary });
  } catch (err) {
    if (jobId) updateReporterImportJobRow(jobId, { status: "failed", resultSummary: {}, errorMessage: err.message });
    res.status(500).json({ error: "Failed to import reporter archive" });
  }
});

// --- Project Members ---

router.get("/reporter/projects/:id/members", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterProjectMembers(req.params.id));
});

router.post("/reporter/projects/:id/members", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const caps = getCapabilities(req);
  const members = listReporterProjectMembers(req.params.id);
  const requesterMember = members.find((m) => m.userId === req.access.userId);
  const isLead = requesterMember?.role === "lead" || caps.canManageAll;
  if (!isLead) return res.status(403).json({ error: "Only project leads can add members" });
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ error: "User ID is required" });
  const r = VALID_MEMBER_ROLES.includes(role) ? role : "pentester";
  try {
    addReporterProjectMember(req.params.id, userId, r);
    auditReporter(req, {
      action: "project_member_add",
      targetId: req.params.id,
      metadata: { userId, role: r },
    });
    if (userId !== req.access.userId) {
      createNotification({
        userId, category: "reporter", action: "project_member_added",
        title: "Added to report project",
        body: `You were added to "${project.title}" as ${r}`,
        linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.put("/reporter/projects/:id/members/:userId", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const caps = getCapabilities(req);
  const members = listReporterProjectMembers(req.params.id);
  const requesterMember = members.find((m) => m.userId === req.access.userId);
  const isLead = requesterMember?.role === "lead" || caps.canManageAll;
  if (!isLead) return res.status(403).json({ error: "Only project leads can change roles" });
  const { role } = req.body;
  if (!VALID_MEMBER_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  updateReporterProjectMemberRoleRow(req.params.id, req.params.userId, role);
  auditReporter(req, {
    action: "project_member_update",
    targetId: req.params.id,
    metadata: { userId: req.params.userId, role },
  });
  if (req.params.userId !== req.access.userId) {
    createNotification({
      userId: req.params.userId, category: "reporter", action: "project_member_role_changed",
      title: "Role changed on report project",
      body: `Your role on "${project.title}" was changed to ${role}`,
      linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
    });
  }
  res.json({ success: true });
});

router.delete("/reporter/projects/:id/members/:userId", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  if (req.params.userId === project.createdBy) return res.status(403).json({ error: "Cannot remove project creator" });
  const caps = getCapabilities(req);
  const members = listReporterProjectMembers(req.params.id);
  const requesterMember = members.find((m) => m.userId === req.access.userId);
  const isLead = requesterMember?.role === "lead" || caps.canManageAll;
  if (!isLead) return res.status(403).json({ error: "Only project leads can remove members" });
  removeReporterProjectMemberRow(req.params.id, req.params.userId);
  auditReporter(req, {
    action: "project_member_remove",
    targetId: req.params.id,
    metadata: { userId: req.params.userId },
  });
  if (req.params.userId !== req.access.userId) {
    createNotification({
      userId: req.params.userId, category: "reporter", action: "project_member_removed",
      title: "Removed from report project",
      body: `You were removed from "${project.title}"`,
      linkUrl: "/reporter", entityType: "reporter_project", entityId: req.params.id,
    });
  }
  res.json({ success: true });
});

// --- Findings ---

router.get("/reporter/projects/:projectId/findings", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterFindingsByProject(req.params.projectId));
});

router.post("/reporter/projects/:projectId/findings", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const { title, category, severity, cvssVector, fields } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Finding title is required" });
  const sev = VALID_SEVERITIES.includes(severity) ? severity : "info";
  const cvssScore = parseCvssScore(cvssVector);
  const effectiveSeverity = cvssScore !== null ? cvssLevelFromScore(cvssScore) : sev;
  try {
    const finding = createReporterFindingRow({
      projectId: req.params.projectId,
      title: String(title).trim(),
      category: String(category || "").trim(),
      severity: effectiveSeverity,
      cvssVector: cvssVector || "",
      cvssScore,
      createdBy: req.access.userId,
      fields: fields && typeof fields === "object" ? fields : {},
    });
    recordReporterHistory(req.params.projectId, "finding", finding.id, finding, "Finding created", req.access.userId);
    res.json({ success: true, id: finding.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create finding" });
  }
});

router.post("/reporter/projects/:projectId/findings/from-template/:templateId", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const template = getReporterFindingTemplateByIdRow(req.params.templateId);
  if (!template) return res.status(404).json({ error: "Template not found" });
  try {
    const fields = {};
    if (template.fields) {
      for (const f of template.fields) {
        if (f.language === "en") fields[f.fieldName] = f.fieldValue;
      }
    }
    const cvssScore = parseCvssScore(template.cvssVector);
    const finding = createReporterFindingRow({
      projectId: req.params.projectId,
      templateId: template.id,
      title: template.title,
      category: template.category,
      severity: cvssScore !== null ? cvssLevelFromScore(cvssScore) : template.severity,
      cvssVector: template.cvssVector,
      cvssScore,
      createdBy: req.access.userId,
      fields,
    });
    incrementReporterTemplateUsage(template.id);
    recordReporterHistory(req.params.projectId, "finding", finding.id, finding, `Finding created from template ${template.title}`, req.access.userId);
    res.json({ success: true, id: finding.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create finding from template" });
  }
});

router.get("/reporter/findings/:id", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = getReporterProjectById(finding.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(finding);
});

router.put("/reporter/findings/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = await loadProjectForEdit(req, finding.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  if (project.readonly) return res.status(403).json({ error: "Project is readonly" });
  const { title, category, severity, cvssVector, status, isIncluded, assigneeId } = req.body;
  const sev = VALID_SEVERITIES.includes(severity) ? severity : finding.severity;
  const cvssScore = cvssVector !== undefined ? parseCvssScore(cvssVector) : finding.cvssScore;
  const effectiveSeverity = cvssVector !== undefined && cvssScore !== null ? cvssLevelFromScore(cvssScore) : sev;
  const updated = updateReporterFindingRow(req.params.id, {
    title: title !== undefined ? String(title).trim() : finding.title,
    category: category !== undefined ? String(category).trim() : finding.category,
    severity: effectiveSeverity,
    cvssVector: cvssVector !== undefined ? cvssVector : finding.cvssVector,
    cvssScore,
    status: VALID_FINDING_STATUSES.includes(status) ? status : finding.status,
    isIncluded: isIncluded !== undefined ? isIncluded : finding.isIncluded,
    assigneeId: assigneeId !== undefined ? (assigneeId || null) : finding.assigneeId,
    updatedBy: req.access.userId,
  });
  recordReporterHistory(finding.projectId, "finding", req.params.id, updated || { ...finding, ...req.body }, "Finding updated", req.access.userId);
  res.json({ success: true });
});

router.post("/reporter/findings/:id/copy", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = await loadProjectForEdit(req, finding.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  if (project.readonly) return res.status(403).json({ error: "Project is readonly" });
  try {
    const copied = copyReporterFinding(req.params.id, req.access.userId);
    if (!copied) return res.status(500).json({ error: "Failed to copy finding" });
    recordReporterHistory(finding.projectId, "finding", copied.id, copied, `Finding copied from "${finding.title}"`, req.access.userId);
    res.json({ success: true, id: copied.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to copy finding" });
  }
});

router.post("/reporter/findings/:id/save-template", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const caps = getCapabilities(req);
  if (!caps.canManageTemplates && !caps.canManageAll) return res.status(403).json({ error: "Cannot manage templates" });
  try {
    const template = createReporterFindingTemplateRow({
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      cvssVector: finding.cvssVector,
      tags: "",
      isBuiltin: false,
      createdBy: req.access.userId,
      fields: finding.fields || {},
    });
    res.json({ success: true, id: template.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to save as template" });
  }
});

router.put("/reporter/findings/:id/status", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = await loadProjectForEdit(req, finding.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const { status } = req.body;
  if (!VALID_FINDING_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const updated = updateReporterFindingStatusRow(req.params.id, status, req.access.userId);
  recordReporterHistory(finding.projectId, "finding", req.params.id, updated || { ...finding, status }, `Finding status changed to ${status}`, req.access.userId);
  if (["changes_requested", "approved"].includes(status)) {
    const notifyMembers = listReporterProjectMembers(finding.projectId);
    for (const m of notifyMembers) {
      if (m.userId === req.access.userId) continue;
      createNotification({
        userId: m.userId, category: "reporter", action: "finding_status_changed",
        title: status === "changes_requested" ? "Finding needs changes" : "Finding approved",
        body: `A finding in "${project.title}" was marked ${status.replace(/_/g, " ")}`,
        linkUrl: "/reporter", entityType: "reporter_project", entityId: finding.projectId,
        severity: status === "changes_requested" ? "warning" : "info",
      });
    }
  }
  res.json({ success: true });
});

router.delete("/reporter/findings/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = await loadProjectForEdit(req, finding.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  deleteReporterFindingById(req.params.id);
  res.json({ success: true });
});

router.put("/reporter/projects/:projectId/findings/reorder", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });
  reorderReporterFindingsRow(req.params.projectId, orderedIds);
  res.json({ success: true });
});

router.put("/reporter/findings/:id/fields/:fieldName", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const finding = getReporterFindingByIdRow(req.params.id);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  const project = await loadProjectForEdit(req, finding.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const { fieldValue } = req.body;
  const fieldName = req.params.fieldName;
  if (!fieldName || !/^[a-z_][a-z0-9_]{0,63}$/i.test(fieldName)) return res.status(400).json({ error: "Invalid field name" });
  setReporterFindingFieldRow(req.params.id, fieldName, String(fieldValue || ""));
  recordReporterHistory(finding.projectId, "finding", req.params.id, { fieldName, fieldValue: String(fieldValue || "") }, `Finding field ${fieldName} updated`, req.access.userId);
  res.json({ success: true });
});

// --- Sections ---

router.get("/reporter/projects/:projectId/sections", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const project = getReporterProjectById(req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(listReporterSectionsByProject(req.params.projectId));
});

router.post("/reporter/projects/:projectId/sections", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const { title, sectionType, content, orderIndex } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Section title is required" });
  const type = VALID_SECTION_TYPES.includes(sectionType) ? sectionType : "custom";
  try {
    const section = createReporterSectionRow({
      projectId: req.params.projectId,
      title: String(title).trim(),
      sectionType: type,
      content: String(content || ""),
      orderIndex: parseInt(orderIndex, 10) || 0,
      createdBy: req.access.userId,
    });
    recordReporterHistory(req.params.projectId, "section", section.id, section, "Section created", req.access.userId);
    res.json({ success: true, id: section.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create section" });
  }
});

router.get("/reporter/sections/:id", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const section = getReporterSectionByIdRow(req.params.id);
  if (!section) return res.status(404).json({ error: "Section not found" });
  const project = getReporterProjectById(section.projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (!canAccessProject(req, project)) return res.status(403).json({ error: "Not a project member" });
  res.json(section);
});

router.put("/reporter/sections/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const section = getReporterSectionByIdRow(req.params.id);
  if (!section) return res.status(404).json({ error: "Section not found" });
  const project = await loadProjectForEdit(req, section.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  const { title, content, isIncluded } = req.body;
  const updated = updateReporterSectionRow(req.params.id, {
    title: title !== undefined ? String(title).trim() : section.title,
    content: content !== undefined ? String(content) : section.content,
    isIncluded: isIncluded !== undefined ? isIncluded : section.isIncluded,
    updatedBy: req.access.userId,
  });
  recordReporterHistory(section.projectId, "section", req.params.id, updated || { ...section, ...req.body }, "Section updated", req.access.userId);
  res.json({ success: true });
});

router.delete("/reporter/sections/:id", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const section = getReporterSectionByIdRow(req.params.id);
  if (!section) return res.status(404).json({ error: "Section not found" });
  const project = await loadProjectForEdit(req, section.projectId);
  if (!project) return res.status(403).json({ error: "No edit access" });
  deleteReporterSectionById(req.params.id);
  res.json({ success: true });
});

router.put("/reporter/projects/:projectId/sections/reorder", writeLimiter, requireUser, attachUserAccess, async (req, res) => {
  const project = await loadProjectForEdit(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "Project not found or no edit access" });
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds must be an array" });
  reorderReporterSectionsRow(req.params.projectId, orderedIds);
  res.json({ success: true });
});

// --- Finding Templates ---

router.get("/reporter/templates", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  res.json(listReporterFindingTemplates());
});

router.get("/reporter/templates/:id", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const template = getReporterFindingTemplateByIdRow(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  res.json(template);
});

router.get("/reporter/users", requireUser, attachUserAccess, canViewReporter, (req, res) => {
  const caps = getCapabilities(req);
  if (!caps.canCreate && !caps.canEditAssigned && !caps.canManageAll) return res.status(403).json({ error: "Cannot list users for project membership" });
  const data = listUsers(1, 500);
  res.json(data.users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    suspended: user.suspended,
  })));
});

router.post("/reporter/templates", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { title, category, severity, cvssVector, tags, fields } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Template title is required" });
  const sev = VALID_SEVERITIES.includes(severity) ? severity : "medium";
  const cvssScore = parseCvssScore(cvssVector);
  const effectiveSeverity = cvssScore !== null ? cvssLevelFromScore(cvssScore) : sev;
  try {
    const row = createReporterFindingTemplateRow({
      title: String(title).trim(),
      category: String(category || "").trim(),
      severity: effectiveSeverity,
      cvssVector: cvssVector || "",
      tags: Array.isArray(tags) ? tags : [],
      fields: Array.isArray(fields) ? fields : [],
      createdBy: req.access.userId,
    });
    res.json({ success: true, id: row.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.put("/reporter/templates/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const template = getReporterFindingTemplateByIdRow(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  if (template.isBuiltin) return res.status(403).json({ error: "Cannot modify built-in templates" });
  const { title, category, severity, cvssVector, tags, fields } = req.body;
  const sev = VALID_SEVERITIES.includes(severity) ? severity : template.severity;
  const nextCvssVector = cvssVector !== undefined ? cvssVector : template.cvssVector;
  const cvssScore = parseCvssScore(nextCvssVector);
  const effectiveSeverity = cvssScore !== null ? cvssLevelFromScore(cvssScore) : sev;
  try {
    updateReporterFindingTemplateRow(req.params.id, {
      title: title !== undefined ? String(title).trim() : template.title,
      category: category !== undefined ? String(category).trim() : template.category,
      severity: effectiveSeverity,
      cvssVector: nextCvssVector,
      tags: Array.isArray(tags) ? tags : template.tags,
      fields: Array.isArray(fields) ? fields : undefined,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/reporter/templates/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const template = getReporterFindingTemplateByIdRow(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  if (template.isBuiltin) return res.status(403).json({ error: "Cannot delete built-in templates" });
  deleteReporterFindingTemplateById(req.params.id);
  res.json({ success: true });
});

// ============================================================
// Reporter Proposals
// ============================================================

const PROPOSAL_PDF_DIR = path.join(__dirname, "..", "..", "data", "reporter-proposals");
const VALID_PROPOSAL_STATUSES = ["draft", "in_review", "changes_required", "approved", "sent", "accepted", "rejected", "archived"];
const VALID_TEST_TYPES = ["internal", "external", "webapp", "cloud", "build_review", "red_team", "wireless", "configuration_review", "assumed_breach", "custom"];

function getWriteupField(writeup, camelName, snakeName) {
  return writeup?.[camelName] || writeup?.[snakeName] || "";
}

function buildProposalServiceWriteup(writeup) {
  if (!writeup) return "";
  const parts = [
    `### ${writeup.name || writeup.testType || writeup.test_type || "Security Assessment"}`,
    getWriteupField(writeup, "description", "description"),
    "#### Methodology",
    getWriteupField(writeup, "methodologyWriteup", "methodology_writeup") || getWriteupField(writeup, "methodology", "methodology"),
    "#### Scope Guidance",
    getWriteupField(writeup, "scopeGuidance", "scope_guidance") || getWriteupField(writeup, "scope", "scope"),
    "#### Deliverables",
    getWriteupField(writeup, "deliverables", "deliverables"),
  ].filter((part) => String(part || "").trim());
  return parts.join("\n\n");
}

function buildProposalSectionsFromTemplate(templateSections, selectedTypes) {
  const sections = [];
  let orderIdx = 0;

  for (const ts of templateSections) {
    const content = ts.content || "";
    if (content.includes("{{test_type_inserts}}")) {
      let combined = content.replace("{{test_type_inserts}}", "");
      for (const tt of selectedTypes) {
        const writeup = getReporterTestTypeTemplateByType(tt);
        if (writeup) combined += `\n\n${buildProposalServiceWriteup(writeup)}\n`;
      }
      sections.push({ title: ts.title, sectionType: ts.section_type, content: combined.trim(), orderIndex: orderIdx++, isIncluded: true, isGenerated: true });
    } else if (content.includes("{{client_requirements_insert}}")) {
      const reqs = selectedTypes.map((tt) => {
        const w = getReporterTestTypeTemplateByType(tt);
        const requirements = getWriteupField(w, "clientRequirements", "client_requirements");
        return w && requirements ? `- **${w.name}:** ${requirements}` : null;
      }).filter(Boolean).join("\n");
      sections.push({ title: ts.title, sectionType: ts.section_type, content: content.replace("{{client_requirements_insert}}", reqs).trim(), orderIndex: orderIdx++, isIncluded: true, isGenerated: true });
    } else if (content.includes("{{consultant_requirements_insert}}")) {
      const reqs = selectedTypes.map((tt) => {
        const w = getReporterTestTypeTemplateByType(tt);
        const requirements = getWriteupField(w, "consultantRequirements", "consultant_requirements");
        return w && requirements ? `- **${w.name}:** ${requirements}` : null;
      }).filter(Boolean).join("\n");
      sections.push({ title: ts.title, sectionType: ts.section_type, content: content.replace("{{consultant_requirements_insert}}", reqs).trim(), orderIndex: orderIdx++, isIncluded: true, isGenerated: true });
    } else {
      sections.push({ title: ts.title, sectionType: ts.section_type, content, orderIndex: orderIdx++, isIncluded: true, isGenerated: false });
    }
  }

  return sections;
}

function syncProposalGeneratedSections(proposal, selectedTypes, actorUserId) {
  const template = proposal.templateId ? getReporterProposalTemplateById(proposal.templateId) : getReporterProposalTemplateById("builtin-proposal-default");
  if (!template) return;
  const templateSections = listReporterProposalTemplateSections(template.id);
  const generatedSections = buildProposalSectionsFromTemplate(templateSections, selectedTypes).filter((section) => section.isGenerated);
  if (!generatedSections.length) return;
  const existingSections = listReporterProposalSections(proposal.id);
  for (const generated of generatedSections) {
    const existing = existingSections.find((section) => section.title === generated.title);
    if (existing) {
      updateReporterProposalSectionRow(existing.id, {
        title: existing.title,
        content: generated.content,
        isIncluded: existing.isIncluded,
      });
    } else {
      createReporterProposalSectionRow({
        proposalId: proposal.id,
        title: generated.title,
        sectionType: generated.sectionType || "markdown",
        content: generated.content,
        orderIndex: generated.orderIndex,
        createdBy: actorUserId,
      });
    }
  }
}

function ensureProposalPdfDir() {
  if (!fs.existsSync(PROPOSAL_PDF_DIR)) fs.mkdirSync(PROPOSAL_PDF_DIR, { recursive: true });
}

function getProposalCapabilities(req) {
  const caps = getCapabilities(req);
  return {
    canView: caps.canView,
    canCreate: caps.canCreate,
    canManage: caps.canManageTemplates,
  };
}

function canViewProposals(req, res, next) {
  const caps = getProposalCapabilities(req);
  if (!caps.canView) return res.status(403).json({ error: "Reporter access required" });
  next();
}

function canCreateProposals(req, res, next) {
  const caps = getProposalCapabilities(req);
  if (!caps.canCreate) return res.status(403).json({ error: "Reporter create permission required" });
  next();
}

// List proposals
router.get("/reporter/proposals", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  let proposals = listReporterProposals();
  if (req.query.filter === "active") {
    proposals = proposals.filter((proposal) => !proposal.archivedAt && proposal.status !== "archived");
  } else if (req.query.filter === "archived") {
    proposals = proposals.filter((proposal) => proposal.archivedAt || proposal.status === "archived");
  }
  const caps = getProposalCapabilities(req);
  res.json({ proposals, capabilities: caps });
});

// List proposal templates
router.get("/reporter/proposals/templates", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const templates = listReporterProposalTemplates();
  const enriched = templates.map((t) => ({
    ...t,
    sections: listReporterProposalTemplateSections(t.id),
  }));
  res.json({ templates: enriched });
});

// List test type write-ups
router.get("/reporter/proposals/test-types", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const types = listReporterTestTypeTemplates();
  res.json({ testTypes: types });
});

// Create proposal
router.post("/reporter/proposals", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const { templateId, title, clientName, testTypes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });

  const selectedTypes = Array.isArray(testTypes) ? testTypes.filter((t) => VALID_TEST_TYPES.includes(t)) : [];

  // Load template sections
  const template = templateId ? getReporterProposalTemplateById(templateId) : getReporterProposalTemplateById("builtin-proposal-default");
  const templateSections = template ? listReporterProposalTemplateSections(template.id) : [];
  const sections = buildProposalSectionsFromTemplate(templateSections, selectedTypes);

  const proposal = createReporterProposalRow({
    templateId: template ? template.id : null,
    title: title.trim(),
    clientName: clientName || "",
    preparedByUserId: req.access.userId,
    testTypes: selectedTypes,
    createdBy: req.access.userId,
    sections,
  });

  auditReporter(req, { action: "proposal_create", targetType: "reporter_proposal", targetId: proposal.id, metadata: { title: proposal.title } });
  res.status(201).json({ proposal });
});

// Get proposal detail
router.get("/reporter/proposals/:id", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const sections = listReporterProposalSections(proposal.id);
  const generations = listReporterProposalGenerations(proposal.id);
  const caps = getProposalCapabilities(req);
  const engageOpp = proposal.opportunityId ? getEngageOpportunityById(proposal.opportunityId) : null;
  res.json({ proposal, sections, generations, capabilities: caps, engageOpportunity: engageOpp ? { id: engageOpp.id, title: engageOpp.title, stage: engageOpp.stage, clientName: engageOpp.client_name || "" } : null });
});

// Update proposal metadata
router.put("/reporter/proposals/:id", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  if (proposal.archivedAt) return res.status(400).json({ error: "Archived proposals cannot be edited" });

  const payload = {};
  const allowedFields = ["title", "clientName", "clientId", "primaryContactName", "primaryContactEmail", "preparedForName", "preparedForEmail", "preparedByUserId", "proposalType", "testTypes", "proposalMetadata", "validUntil", "estimatedDays", "quotedValue"];
  for (const f of allowedFields) {
    if (req.body[f] !== undefined) payload[f] = req.body[f];
  }

  if (payload.testTypes) {
    payload.testTypes = payload.testTypes.filter((t) => VALID_TEST_TYPES.includes(t));
  }

  const updated = updateReporterProposalRow(proposal.id, payload);
  if (payload.testTypes) {
    syncProposalGeneratedSections(updated, payload.testTypes, req.access.userId);
  }
  auditReporter(req, { action: "proposal_update", targetType: "reporter_proposal", targetId: proposal.id });
  res.json({ proposal: updated });
});

// Update proposal status
router.put("/reporter/proposals/:id/status", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });

  const { status } = req.body;
  if (!VALID_PROPOSAL_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const updated = updateReporterProposalStatus(proposal.id, status);
  auditReporter(req, { action: "proposal_status", targetType: "reporter_proposal", targetId: proposal.id, metadata: { status } });
  res.json({ proposal: updated });
});

// Archive proposal
router.post("/reporter/proposals/:id/archive", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const updated = archiveReporterProposalRow(proposal.id);
  auditReporter(req, { action: "proposal_archive", targetType: "reporter_proposal", targetId: proposal.id });
  res.json({ proposal: updated });
});

// Unarchive proposal
router.post("/reporter/proposals/:id/unarchive", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  const updated = unarchiveReporterProposalRow(proposal.id);
  auditReporter(req, { action: "proposal_unarchive", targetType: "reporter_proposal", targetId: proposal.id });
  res.json({ proposal: updated });
});

// List proposal sections
router.get("/reporter/proposals/:id/sections", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  res.json({ sections: listReporterProposalSections(proposal.id) });
});

// Create proposal section
router.post("/reporter/proposals/:id/sections", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  if (proposal.archivedAt) return res.status(400).json({ error: "Archived proposals cannot be edited" });

  const { title, sectionType, content, orderIndex } = req.body;
  if (!title) return res.status(400).json({ error: "Section title is required" });

  const section = createReporterProposalSectionRow({
    proposalId: proposal.id,
    title,
    sectionType: sectionType || "markdown",
    content: content || "",
    orderIndex: orderIndex != null ? orderIndex : 999,
    createdBy: req.access.userId,
  });
  res.status(201).json({ section });
});

// Update proposal section
router.put("/reporter/proposals/sections/:sectionId", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const section = getReporterProposalSectionById(req.params.sectionId);
  if (!section) return res.status(404).json({ error: "Section not found" });

  const proposal = getReporterProposalById(section.proposalId);
  if (!proposal || proposal.archivedAt) return res.status(400).json({ error: "Cannot edit archived proposal" });

  const updated = updateReporterProposalSectionRow(section.id, {
    title: req.body.title,
    content: req.body.content,
    isIncluded: req.body.isIncluded,
  });
  res.json({ section: updated });
});

// Delete proposal section
router.delete("/reporter/proposals/sections/:sectionId", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const section = getReporterProposalSectionById(req.params.sectionId);
  if (!section) return res.status(404).json({ error: "Section not found" });

  const proposal = getReporterProposalById(section.proposalId);
  if (!proposal || proposal.archivedAt) return res.status(400).json({ error: "Cannot edit archived proposal" });

  deleteReporterProposalSectionById(section.id);
  res.json({ success: true });
});

// Reorder proposal sections
router.put("/reporter/proposals/:id/sections/reorder", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });

  const { sectionIds } = req.body;
  if (!Array.isArray(sectionIds)) return res.status(400).json({ error: "sectionIds array required" });

  reorderReporterProposalSectionsRow(proposal.id, sectionIds);
  res.json({ success: true });
});

// List proposal generations
router.get("/reporter/proposals/:id/generations", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  res.json({ generations: listReporterProposalGenerations(proposal.id) });
});

// Generate proposal PDF
router.post("/reporter/proposals/:id/render-pdf", writeLimiter, requireUser, attachUserAccess, canCreateProposals, async (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });

  ensureProposalPdfDir();

  const sections = listReporterProposalSections(proposal.id);
  const version = (await listReporterProposalGenerations(proposal.id)).length + 1;
  const filename = `proposal-${proposal.id.substring(0, 8)}-v${version}.pdf`;
  const filePath = path.join(PROPOSAL_PDF_DIR, filename);

  const generation = createReporterProposalGenerationRow({
    proposalId: proposal.id,
    filename,
    filePath,
    version,
    status: "pending",
    createdBy: req.access.userId,
  });

  res.json({ generation });

  // Async PDF generation
  try {
    const template = proposal.templateId ? getReporterProposalTemplateById(proposal.templateId) : null;
    const testTypes = (proposal.testTypes || []).map((tt) => getReporterTestTypeTemplateByType(tt) || { test_type: tt, name: tt });

    const html = renderProposalDocumentHtml({ proposal, template, sections, testTypes });
    const pdfBuffer = await renderPdfBuffer(html, {
      headerTemplate: '<div class="reporter-pdf-header">RedSec Proposal</div>',
    });

    fs.writeFileSync(filePath, pdfBuffer);
    updateReporterProposalGenerationRow(generation.id, {
      status: "completed",
      filePath,
      completedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    updateReporterProposalGenerationRow(generation.id, {
      status: "failed",
      errorMessage: err.message || "PDF generation failed",
    });
    createNotification({
      userId: req.access.userId,
      category: "reporter",
      action: "proposal_pdf_failed",
      title: "Proposal PDF generation failed",
      body: `Failed to generate PDF for "${proposal.title}"`,
      entityType: "reporter_proposal",
      entityId: proposal.id,
      severity: "critical",
    });
  }
});

// Download proposal PDF
router.get("/reporter/proposals/generations/:generationId/download", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const gen = getReporterProposalGenerationById(req.params.generationId);
  if (!gen) return res.status(404).json({ error: "Generation not found" });
  if (!gen.file_path || !fs.existsSync(gen.file_path)) return res.status(404).json({ error: "PDF file not found" });

  res.download(gen.file_path, gen.filename || "proposal.pdf");
});

// Delete proposal PDF generation
router.delete("/reporter/proposals/generations/:generationId", writeLimiter, requireUser, attachUserAccess, canCreateProposals, (req, res) => {
  const gen = getReporterProposalGenerationById(req.params.generationId);
  if (!gen) return res.status(404).json({ error: "Generation not found" });

  if (gen.file_path && fs.existsSync(gen.file_path)) {
    try { fs.unlinkSync(gen.file_path); } catch {}
  }
  deleteReporterProposalGenerationById(gen.id);
  res.json({ success: true });
});

// Proposal preview
router.get("/reporter/proposals/:id/preview", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });

  const sections = listReporterProposalSections(proposal.id);
  const template = proposal.templateId ? getReporterProposalTemplateById(proposal.templateId) : null;
  const testTypes = (proposal.testTypes || []).map((tt) => getReporterTestTypeTemplateByType(tt) || { test_type: tt, name: tt });

  try {
    const html = renderProposalDocumentHtml(
      { proposal, template, sections, testTypes },
      { cssHref: `/api/reporter/proposal-templates/${encodeURIComponent(template?.id || "default")}/preview.css` },
    );
    setEmbeddableHtmlPreviewHeaders(res);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: "Failed to render proposal preview" });
  }
});

router.get("/reporter/proposals/:id/preview.pdf", requireUser, attachUserAccess, canViewProposals, async (req, res) => {
  const proposal = getReporterProposalById(req.params.id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });

  const sections = listReporterProposalSections(proposal.id);
  const template = proposal.templateId ? getReporterProposalTemplateById(proposal.templateId) : null;
  const testTypes = (proposal.testTypes || []).map((tt) => getReporterTestTypeTemplateByType(tt) || { test_type: tt, name: tt });

  try {
    const html = renderProposalDocumentHtml({ proposal, template, sections, testTypes });
    const pdf = await renderPdfBuffer(html, {
      headerTemplate: '<div class="reporter-pdf-header">RedSec Proposal</div>',
      timeoutMs: parseInt(process.env.REPORTER_PDF_TIMEOUT_MS, 10) || undefined,
    });
    sendTempPdfPreview(req, res, pdf, `${proposal.title || "proposal"}-preview`);
  } catch (err) {
    res.status(500).json({ error: "Failed to render proposal PDF preview" });
  }
});

// --- Stats ---

router.get("/reporter/stats", requireUser, attachUserAccess, (req, res) => {
  const caps = getCapabilities(req);
  if (!caps.canManageAll) return res.status(403).json({ error: "Admin access required" });
  res.json(getReporterGlobalStats());
});

// ============================================================
// Proposal Template Management
// ============================================================

router.get("/reporter/proposal-templates", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const templates = listReporterProposalTemplates();
  res.json({ templates });
});

router.get("/reporter/proposal-templates/:id", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const template = getReporterProposalTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  const sections = listReporterProposalTemplateSections(req.params.id);
  res.json({ template, sections });
});

router.post("/reporter/proposal-templates", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { name, description, templateType } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  const id = crypto.randomBytes(16).toString("base64url");
  const template = createReporterProposalTemplate({
    id,
    name: name.trim(),
    description: description || "",
    templateType: templateType || "security_assessment",
    htmlTemplate: "",
    cssTemplate: "",
    metadataSchema: "{}",
    sortOrder: 100,
    createdBy: req.user.id,
  });
  res.status(201).json({ template });
});

router.put("/reporter/proposal-templates/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const existing = getReporterProposalTemplateById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Template not found" });
  if (existing.is_builtin) return res.status(403).json({ error: "Built-in templates cannot be edited" });
  const { name, description, templateType, htmlTemplate, cssTemplate } = req.body;
  const template = updateReporterProposalTemplate({
    id: req.params.id,
    name: name || existing.name,
    description: description ?? existing.description,
    templateType: templateType || existing.template_type,
    htmlTemplate: htmlTemplate ?? existing.html_template,
    cssTemplate: cssTemplate ?? existing.css_template,
    metadataSchema: existing.metadata_schema,
  });
  res.json({ template });
});

router.post("/reporter/proposal-templates/:id/duplicate", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const newId = crypto.randomBytes(16).toString("base64url");
  const template = duplicateReporterProposalTemplate(req.params.id, newId, req.user.id);
  if (!template) return res.status(404).json({ error: "Source template not found" });
  res.status(201).json({ template });
});

router.post("/reporter/proposal-templates/:id/archive", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const existing = getReporterProposalTemplateById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Template not found" });
  if (existing.is_builtin) return res.status(403).json({ error: "Built-in templates cannot be archived" });
  archiveReporterProposalTemplate(req.params.id);
  res.json({ success: true });
});

// Proposal template sections
router.get("/reporter/proposal-templates/:id/sections", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const sections = listReporterProposalTemplateSections(req.params.id);
  res.json({ sections });
});

router.post("/reporter/proposal-templates/:id/sections", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { title, sectionType, content, isRequired } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Section title is required" });
  const existing = listReporterProposalTemplateSections(req.params.id);
  const id = crypto.randomBytes(16).toString("base64url");
  const section = createReporterProposalTemplateSection({
    id,
    templateId: req.params.id,
    title: title.trim(),
    sectionType: sectionType || "markdown",
    content: content || "",
    orderIndex: existing.length,
    isRequired: isRequired ? 1 : 0,
  });
  res.status(201).json({ section });
});

router.put("/reporter/proposal-template-sections/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { title, sectionType, content, orderIndex, isRequired } = req.body;
  const section = updateReporterProposalTemplateSection({
    id: req.params.id,
    title,
    sectionType,
    content,
    orderIndex,
    isRequired: isRequired ? 1 : 0,
  });
  if (!section) return res.status(404).json({ error: "Section not found" });
  res.json({ section });
});

router.delete("/reporter/proposal-template-sections/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  deleteReporterProposalTemplateSection(req.params.id);
  res.json({ success: true });
});

router.post("/reporter/proposal-templates/:id/sections/reorder", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: "orderedIds array required" });
  const sections = listReporterProposalTemplateSections(req.params.id);
  for (let i = 0; i < orderedIds.length; i++) {
    const s = sections.find((s) => s.id === orderedIds[i]);
    if (s) {
      updateReporterProposalTemplateSection({
        id: s.id,
        title: s.title,
        sectionType: s.section_type,
        content: s.content,
        orderIndex: i,
        isRequired: s.is_required,
      });
    }
  }
  res.json({ success: true });
});

// ============================================================
// Test Type Write-up Management
// ============================================================

router.get("/reporter/test-type-writeups", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const writeups = listReporterTestTypeTemplates();
  res.json({ writeups });
});

router.get("/reporter/test-type-writeups/:id", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const writeup = getReporterTestTypeTemplateById(req.params.id);
  if (!writeup) return res.status(404).json({ error: "Write-up not found" });
  res.json({ writeup });
});

router.post("/reporter/test-type-writeups", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const { testType, name, description, methodologyWriteup, scopeGuidance, deliverables, clientRequirements, consultantRequirements, assumptions, restrictions } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (!testType || !testType.trim()) return res.status(400).json({ error: "Test type is required" });
  const id = crypto.randomBytes(16).toString("base64url");
  const allWriteups = listAllReporterTestTypeTemplates();
  const writeup = createReporterTestTypeTemplate({
    id,
    testType: testType.trim(),
    name: name.trim(),
    description: description || "",
    methodologyWriteup: methodologyWriteup || "",
    scopeGuidance: scopeGuidance || "",
    deliverables: deliverables || "",
    clientRequirements: clientRequirements || "",
    consultantRequirements: consultantRequirements || "",
    assumptions: assumptions || "",
    restrictions: restrictions || "",
    sortOrder: allWriteups.length,
  });
  res.status(201).json({ writeup });
});

router.put("/reporter/test-type-writeups/:id", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const existing = getReporterTestTypeTemplateById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Write-up not found" });
  const { name, description, methodologyWriteup, scopeGuidance, deliverables, clientRequirements, consultantRequirements, assumptions, restrictions } = req.body;
  const writeup = updateReporterTestTypeTemplate({
    id: req.params.id,
    name: name || existing.name,
    description: description ?? existing.description,
    methodologyWriteup: methodologyWriteup ?? existing.methodology_writeup,
    scopeGuidance: scopeGuidance ?? existing.scope_guidance,
    deliverables: deliverables ?? existing.deliverables,
    clientRequirements: clientRequirements ?? existing.client_requirements,
    consultantRequirements: consultantRequirements ?? existing.consultant_requirements,
    assumptions: assumptions ?? existing.assumptions,
    restrictions: restrictions ?? existing.restrictions,
  });
  res.json({ writeup });
});

router.post("/reporter/test-type-writeups/:id/duplicate", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const newId = crypto.randomBytes(16).toString("base64url");
  const writeup = duplicateReporterTestTypeTemplate(req.params.id, newId);
  if (!writeup) return res.status(404).json({ error: "Source write-up not found" });
  res.status(201).json({ writeup });
});

router.post("/reporter/test-type-writeups/:id/archive", writeLimiter, requireUser, attachUserAccess, canManageTemplates, (req, res) => {
  const existing = getReporterTestTypeTemplateById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Write-up not found" });
  if (existing.is_builtin) return res.status(403).json({ error: "Built-in write-ups cannot be archived" });
  archiveReporterTestTypeTemplate(req.params.id);
  res.json({ success: true });
});

// --- Proposal Template Preview ---

function buildProposalTemplatePreviewInput(template) {
  const templateSections = listReporterProposalTemplateSections(template.id);
  return {
    proposal: {
      id: "preview-proposal",
      title: (template.name || "Proposal") + " — Preview",
      clientName: "Preview Client Pty Ltd",
      primaryContactName: "Jane Smith",
      primaryContactEmail: "jane@preview.client",
      preparedForName: "Preview Client",
      preparedForEmail: "info@preview.client",
      preparedByUsername: "Consultant",
      proposalType: template.template_type || "security_assessment",
      testTypes: ["external", "webapp"],
      quotedValue: 25000,
      estimatedDays: 10,
      validUntil: null,
      status: "draft",
      createdAt: Math.floor(Date.now() / 1000),
    },
    template,
    sections: templateSections.map((s, i) => ({
      title: s.title,
      content: s.content || "Sample content for " + s.title + ".",
      isIncluded: true,
      sectionType: s.section_type || "markdown",
      orderIndex: i,
    })),
    testTypes: [
      { test_type: "external", name: "External Penetration Testing", methodology_writeup: "External penetration testing simulates an attack from outside the network perimeter.", scope_guidance: "All externally accessible IP ranges and domains.", deliverables: "Vulnerability report with evidence and remediation guidance." },
      { test_type: "webapp", name: "Web Application Penetration Testing", methodology_writeup: "OWASP Testing Guide methodology for web application security.", scope_guidance: "All in-scope web applications and APIs.", deliverables: "OWASP-mapped findings with proof-of-concept and remediation." },
    ],
  };
}

router.get("/reporter/proposal-templates/:id/preview", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const template = getReporterProposalTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  try {
    const html = renderProposalDocumentHtml(buildProposalTemplatePreviewInput(template), {
      cssHref: `/api/reporter/proposal-templates/${encodeURIComponent(template.id)}/preview.css`,
    });
    setEmbeddableHtmlPreviewHeaders(res);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: "Failed to render proposal template preview" });
  }
});

router.get("/reporter/proposal-templates/:id/preview.pdf", requireUser, attachUserAccess, canViewProposals, async (req, res) => {
  const template = getReporterProposalTemplateById(req.params.id);
  if (!template) return res.status(404).json({ error: "Template not found" });
  try {
    const html = renderProposalDocumentHtml(buildProposalTemplatePreviewInput(template));
    const pdf = await renderPdfBuffer(html, {
      headerTemplate: '<div class="reporter-pdf-header">RedSec Proposal</div>',
    });
    sendTempPdfPreview(req, res, pdf, template.name || "proposal-template");
  } catch (err) {
    res.status(500).json({ error: "Failed to render proposal template PDF preview" });
  }
});

router.get("/reporter/proposal-templates/:id/preview.css", requireUser, attachUserAccess, canViewProposals, (req, res) => {
  const template = getReporterProposalTemplateById(req.params.id);
  if (!template) return res.status(404).type("text/plain").send("Template not found");
  res.setHeader("Content-Type", "text/css; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(template.css_template || defaultProposalCssTemplate());
});

module.exports = router;
