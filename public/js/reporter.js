import { showConfirmModal, showAlertModal } from "./confirm-modal.js";
import "./burger-menu.js";
import "./theme.js";

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatDateTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function safeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

let _markdownPreviewCache = new Map();
async function renderMarkdownPreview(markdown, targetEl) {
  if (!targetEl) return;
  if (!markdown.trim()) { targetEl.innerHTML = '<span class="text-muted text-sm">No content</span>'; return; }
  const cacheKey = markdown;
  if (_markdownPreviewCache.has(cacheKey)) {
    targetEl.innerHTML = _markdownPreviewCache.get(cacheKey);
    return;
  }
  try {
    const res = await fetch("/api/reporter/markdown-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    const data = await res.json();
    let html = data.html || "";
    // Highlight TODO markers
    html = html.replace(/\b(TODO|ToDo|TO-DO|To-Do)\b/g, '<span class="todo-marker">$&</span>');
    _markdownPreviewCache.set(cacheKey, html);
    if (_markdownPreviewCache.size > 200) {
      const first = _markdownPreviewCache.keys().next().value;
      _markdownPreviewCache.delete(first);
    }
    targetEl.innerHTML = html;
  } catch {
    targetEl.innerHTML = '<span class="text-muted text-sm">Preview unavailable</span>';
  }
}

function markdownToolbarHtml(targetId, options = {}) {
  const evidenceButton = options.evidence
    ? `<button type="button" class="reporter-md-tool" data-md-tool="evidence" data-md-target="${safeAttr(targetId)}" title="Evidence">Evidence</button>`
    : "";
  return `
    <div class="reporter-md-toolbar" data-md-toolbar="${safeAttr(targetId)}">
      <button type="button" class="reporter-md-tool" data-md-tool="bold" data-md-target="${safeAttr(targetId)}" title="Bold">B</button>
      <button type="button" class="reporter-md-tool" data-md-tool="italic" data-md-target="${safeAttr(targetId)}" title="Italic">I</button>
      <button type="button" class="reporter-md-tool" data-md-tool="heading" data-md-target="${safeAttr(targetId)}" title="Heading">H</button>
      <button type="button" class="reporter-md-tool" data-md-tool="ul" data-md-target="${safeAttr(targetId)}" title="Bullet list">UL</button>
      <button type="button" class="reporter-md-tool" data-md-tool="ol" data-md-target="${safeAttr(targetId)}" title="Numbered list">OL</button>
      <button type="button" class="reporter-md-tool" data-md-tool="quote" data-md-target="${safeAttr(targetId)}" title="Quote">Quote</button>
      <button type="button" class="reporter-md-tool" data-md-tool="inline-code" data-md-target="${safeAttr(targetId)}" title="Inline code">Code</button>
      <button type="button" class="reporter-md-tool" data-md-tool="code-block" data-md-target="${safeAttr(targetId)}" title="Preformatted block">Pre</button>
      <button type="button" class="reporter-md-tool" data-md-tool="table" data-md-target="${safeAttr(targetId)}" title="Table">Table</button>
      <button type="button" class="reporter-md-tool" data-md-tool="link" data-md-target="${safeAttr(targetId)}" title="Link">Link</button>
      ${evidenceButton}
    </div>
  `;
}

function bindMarkdownToolbars(root = document) {
  root.querySelectorAll("[data-md-tool]").forEach((btn) => {
    if (btn.dataset.bound === "true") return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => applyMarkdownTool(btn.dataset.mdTarget, btn.dataset.mdTool));
  });
}

function replaceTextareaSelection(textarea, before, after = "", placeholder = "text") {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const selected = textarea.value.slice(start, end) || placeholder;
  textarea.setRangeText(`${before}${selected}${after}`, start, end, "select");
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function prefixSelectedLines(textarea, prefixer) {
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  const value = textarea.value;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const block = value.slice(lineStart, lineEnd) || "text";
  const lines = block.split("\n").map((line, index) => prefixer(line, index));
  textarea.setRangeText(lines.join("\n"), lineStart, lineEnd, "select");
  textarea.focus();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function applyMarkdownTool(targetId, tool) {
  const textarea = document.getElementById(targetId);
  if (!textarea) return;
  if (tool === "bold") return replaceTextareaSelection(textarea, "**", "**", "bold text");
  if (tool === "italic") return replaceTextareaSelection(textarea, "*", "*", "italic text");
  if (tool === "heading") return prefixSelectedLines(textarea, (line) => `## ${line.replace(/^#+\s*/, "") || "Heading"}`);
  if (tool === "ul") return prefixSelectedLines(textarea, (line) => `- ${line.replace(/^[-*+]\s+/, "") || "Item"}`);
  if (tool === "ol") return prefixSelectedLines(textarea, (line, index) => `${index + 1}. ${line.replace(/^\d+\.\s+/, "") || "Item"}`);
  if (tool === "quote") return prefixSelectedLines(textarea, (line) => `> ${line.replace(/^>\s*/, "") || "Quote"}`);
  if (tool === "inline-code") return replaceTextareaSelection(textarea, "`", "`", "code");
  if (tool === "code-block") return replaceTextareaSelection(textarea, "```\n", "\n```", "preformatted text");
  if (tool === "table") return replaceTextareaSelection(textarea, "", "", "| Column | Value |\n| --- | --- |\n| Example | Text |");
  if (tool === "link") return replaceTextareaSelection(textarea, "[", "](https://example.com)", "link text");
  if (tool === "evidence") {
    const fieldName = textarea.dataset.inlineField || textarea.dataset.findingField || "";
    openEvidenceInserter(textarea, fieldName);
  }
}

async function api(path, options = {}) {
  const res = await fetch("/api/reporter" + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function severityBadge(severity) {
  const colors = { critical: "badge-red", high: "badge-amber", medium: "badge-amber", low: "badge-blue", info: "badge-gray" };
  return `<span class="badge ${colors[severity] || "badge-gray"}">${escapeHtml(severity)}</span>`;
}

function statusBadge(status) {
  const colors = {
    draft: "badge-gray", in_progress: "badge-blue", in_review: "badge-purple",
    approved: "badge-green", delivered: "badge-green", archived: "badge-gray",
    ready_for_review: "badge-purple", changes_requested: "badge-amber",
    client_ready: "badge-green", retest: "badge-blue", closed: "badge-gray",
    pending: "badge-amber", complete: "badge-green", failed: "badge-red",
  };
  return `<span class="badge ${colors[status] || "badge-gray"}">${escapeHtml(status.replace(/_/g, " "))}</span>`;
}

function setStatusBadgeElement(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const colors = {
    draft: "badge-gray", in_progress: "badge-blue", in_review: "badge-purple",
    approved: "badge-green", delivered: "badge-green", archived: "badge-gray",
    ready_for_review: "badge-purple", changes_requested: "badge-amber",
    client_ready: "badge-green", retest: "badge-blue", closed: "badge-gray",
    pending: "badge-amber", complete: "badge-green", failed: "badge-red",
  };
  el.className = `badge ${colors[status] || "badge-gray"}`;
  el.textContent = String(status || "").replace(/_/g, " ");
}

function roleBadge(role) {
  const colors = { lead: "badge-red", pentester: "badge-blue", reviewer: "badge-purple" };
  return `<span class="badge ${colors[role] || "badge-gray"}">${escapeHtml(role)}</span>`;
}

const VALID_SEVERITIES = ["critical", "high", "medium", "low", "info"];
const VALID_REPORT_TYPES = ["internal", "external", "webapp", "cloud", "build", "redteam", "wireless", "config", "custom"];
const VALID_PROJECT_STATUSES = ["draft", "in_progress", "in_review", "approved", "delivered"];
const VALID_SECTION_TYPES = ["executive_summary", "scope", "methodology", "findings_overview", "recommendations", "appendix", "custom"];
const VALID_MEMBER_ROLES = ["lead", "pentester", "reviewer"];
const VALID_FINDING_STATUSES = ["draft", "ready_for_review", "changes_requested", "approved", "client_ready", "retest", "closed"];

// --- State ---

const state = {
  currentView: "dashboard",
  currentUserId: null,
  currentUsername: null,
  capabilities: {},
  stats: {},
  projects: [],
  designs: [],
  templates: [],
  selectedProjectId: null,
  selectedProject: null,
  selectedDesignId: null,
  selectedDesign: null,
  selectedTemplateId: null,
  selectedTemplate: null,
  projectMembers: [],
  projectFindings: [],
  projectSections: [],
  projectPdfs: [],
  projectEvidence: [],
  projectNotes: [],
  projectComments: [],
  projectHistory: [],
  projectDesign: null,
  projectStats: null,
  projectFilter: "active",
  projectSearch: "",
  templateSearch: "",
  // Builder state
  editorItemType: null,   // "finding" | "section" | "meta" | null
  editorItemId: null,     // finding/section/meta-panel id
  editorMetaPanel: null,  // which meta panel is shown
  previewVisible: false,
  treeSearch: "",
  editingNoteId: null,
  // Proposal templates state
  ptTab: "templates",
  proposalTemplates: [],
  testTypeWriteups: [],
  selectedPtId: null,
  selectedPt: null,
  selectedWriteupId: null,
  selectedWriteup: null,
};

function canDeleteReporterItem(item) {
  return !!(state.capabilities?.canManageAll || item?.createdBy === state.currentUserId);
}

// --- Init ---

async function init() {
  initSidebarCollapse();

  try {
    const data = await api("/bootstrap");
    state.currentUserId = data.currentUserId;
    state.currentUsername = data.currentUsername;
    state.capabilities = data.capabilities;
    state.stats = data.stats;
    state.projects = data.projects || [];
    state.designs = data.designs || [];
    state.templates = data.templates || [];
  } catch (err) {
    document.getElementById("reporter-dash-recent-projects").innerHTML = `<p class="text-sm text-error">Failed to load: ${escapeHtml(err.message)}</p>`;
    return;
  }

  showCapableButtons();
  renderDashboard();
  bindNavigation();
  window.ReporterProposals?.init(state.capabilities);
  if (new URLSearchParams(window.location.search).get("view") === "about") {
    setCurrentView("about");
  }
  bindModals();
  bindBuilder();
}

function showCapableButtons() {
  const c = state.capabilities;
  toggleClass("reporter-dash-new-project-btn", "hidden", !(c.canCreate || c.canManageAll));
  toggleClass("reporter-new-project-btn", "hidden", !(c.canCreate || c.canManageAll));
  toggleClass("reporter-import-project-btn", "hidden", !(c.canCreate || c.canManageAll));
  toggleClass("reporter-new-design-btn", "hidden", !(c.canManageTemplates || c.canManageAll));
  toggleClass("reporter-new-template-btn", "hidden", !(c.canManageTemplates || c.canManageAll));
  toggleClass("reporter-new-pt-btn", "hidden", !(c.canManageTemplates || c.canManageAll));
  toggleClass("reporter-new-writeup-btn", "hidden", !(c.canManageTemplates || c.canManageAll));
}

function toggleClass(id, cls, add) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle(cls, add);
}

// --- Navigation ---

function bindNavigation() {
  document.querySelectorAll("[data-reporter-view]").forEach((btn) => {
    btn.addEventListener("click", () => setCurrentView(btn.dataset.reporterView));
  });

  document.getElementById("reporter-dash-new-project-btn")?.addEventListener("click", () => openCreateProjectModal());
  document.getElementById("reporter-new-project-btn")?.addEventListener("click", () => openCreateProjectModal());
  document.getElementById("reporter-import-project-btn")?.addEventListener("click", () => openImportProjectModal());
  document.getElementById("reporter-new-design-btn")?.addEventListener("click", () => openCreateDesignModal());
  document.getElementById("reporter-new-template-btn")?.addEventListener("click", () => openCreateTemplateModal());
  document.getElementById("reporter-design-back-btn")?.addEventListener("click", () => setCurrentView("designs"));
  document.getElementById("reporter-design-save-btn")?.addEventListener("click", () => saveDesignEditor());
  document.getElementById("reporter-design-preview-btn")?.addEventListener("click", () => previewDesignEditor());
  document.getElementById("reporter-design-duplicate-btn")?.addEventListener("click", () => duplicateSelectedDesign());
  document.getElementById("reporter-template-back-btn")?.addEventListener("click", () => setCurrentView("templates"));
  document.getElementById("reporter-template-save-btn")?.addEventListener("click", () => saveTemplateEditor());
  document.getElementById("reporter-template-cvss-builder")?.addEventListener("click", () => openCvssBuilder("reporter-template-editor-cvss", "reporter-template-cvss-score"));
  document.getElementById("reporter-template-editor-cvss")?.addEventListener("input", (e) => {
    updateCvssScoreDisplay(e.target, document.getElementById("reporter-template-cvss-score"), document.getElementById("reporter-template-editor-severity"));
  });
  document.getElementById("reporter-project-back-btn")?.addEventListener("click", () => setCurrentView("projects"));

  document.getElementById("reporter-projects-search")?.addEventListener("input", (e) => {
    state.projectSearch = e.target.value;
    renderProjectsList();
  });
  document.getElementById("reporter-projects-filter")?.addEventListener("change", (e) => {
    state.projectFilter = e.target.value;
    renderProjectsList();
  });
  document.getElementById("reporter-templates-search")?.addEventListener("input", (e) => {
    state.templateSearch = e.target.value;
    renderTemplatesList();
  });

  // Proposal Templates tab switching
  document.querySelectorAll("[data-pt-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.ptTab = btn.dataset.ptTab;
      updatePtTabs();
    });
  });
  document.getElementById("reporter-new-pt-btn")?.addEventListener("click", () => openCreateProposalTemplateModal());
  document.getElementById("reporter-new-writeup-btn")?.addEventListener("click", () => openCreateWriteupModal());
  document.getElementById("reporter-pt-back-btn")?.addEventListener("click", () => setCurrentView("proposal-templates"));
  document.getElementById("reporter-pt-save-btn")?.addEventListener("click", () => saveProposalTemplateFull());
  document.getElementById("reporter-pt-preview-btn")?.addEventListener("click", () => previewProposalTemplate());
  document.getElementById("reporter-pt-add-section-btn")?.addEventListener("click", () => addProposalTemplateSection());
  document.getElementById("reporter-writeup-back-btn")?.addEventListener("click", () => setCurrentView("proposal-templates"));
  document.getElementById("reporter-writeup-save-btn")?.addEventListener("click", () => saveWriteupDetail());
}

function initSidebarCollapse() {
  document.getElementById("reporter-sidebar-collapse-btn")?.addEventListener("click", () => {
    document.getElementById("reporter-sidebar")?.classList.toggle("collapsed");
  });
}

function setCurrentView(view) {
  state.currentView = view;
  document.querySelectorAll(".reporter-view").forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(`reporter-view-${view}`);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll("[data-reporter-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.reporterView === view);
  });

  if (view === "dashboard") renderDashboard();
  if (view === "projects") renderProjectsList();
  if (view === "designs") renderDesignsList();
  if (view === "templates") renderTemplatesList();
  if (view === "proposals") window.ReporterProposals?.showListView();
  if (view === "proposal-templates") renderProposalTemplatesView();
  if (view === "engagement-templates") { /* static empty state, no render needed */ }
}

// --- Dashboard ---

function renderDashboard() {
  const s = state.stats;
  setText("reporter-dash-projects", s.totalProjects || 0);
  setText("reporter-dash-critical", s.criticalFindings || 0);

  const container = document.getElementById("reporter-dash-recent-projects");
  const active = state.projects.filter((p) => !p.isArchived).slice(0, 5);
  if (!active.length) {
    container.innerHTML = `<p class="text-sm text-muted">No reports yet. Create one to get started.</p>`;
  } else {
  container.innerHTML = active.map((p) => `
    <div class="reporter-list-item" data-reporter-action="open-project" data-project-id="${escapeHtml(p.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(p.title)}</strong>
        <span class="text-sm text-muted ml-2">${escapeHtml(p.clientName || "")}</span>
      </div>
      <div class="flex items-center gap-2">
        ${statusBadge(p.status)}
        <span class="text-sm text-muted">${formatDateTime(p.updatedAt)}</span>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-reporter-action='open-project']").forEach((el) => {
    el.addEventListener("click", () => openProject(el.dataset.projectId));
  });
  }

  renderDashboardProposals();
}

// --- Projects List ---

function renderProjectsList() {
  const container = document.getElementById("reporter-projects-list");
  let list = [...state.projects];

  if (state.projectFilter === "active") list = list.filter((p) => !p.isArchived);
  else if (state.projectFilter === "archived") list = list.filter((p) => p.isArchived);

  if (state.projectSearch) {
    const q = state.projectSearch.toLowerCase();
    list = list.filter((p) => p.title.toLowerCase().includes(q) || (p.clientName || "").toLowerCase().includes(q));
  }

  if (!list.length) {
    container.innerHTML = `<p class="text-sm text-muted">No reports found.</p>`;
    return;
  }

  container.innerHTML = list.map((p) => `
    <div class="reporter-list-item" data-reporter-action="open-project" data-project-id="${escapeHtml(p.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(p.title)}</strong>
        <span class="text-sm text-muted ml-2">${escapeHtml(p.clientName || "")}</span>
        ${p.isArchived ? '<span class="badge badge-gray ml-2">Archived</span>' : ""}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">${escapeHtml(p.designName || "")}</span>
        ${statusBadge(p.status)}
        <span class="text-sm text-muted">${escapeHtml(p.creatorUsername || "")}</span>
        <span class="text-sm text-muted">${formatDateTime(p.updatedAt)}</span>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-reporter-action='open-project']").forEach((el) => {
    el.addEventListener("click", () => openProject(el.dataset.projectId));
  });
}

// --- Project Detail (Split-pane Builder) ---

async function openProject(projectId) {
  try {
    const data = await api(`/projects/${projectId}`);
    state.selectedProjectId = projectId;
    state.selectedProject = data.project;
    state.projectMembers = data.members || [];
    state.projectDesign = data.design || null;
    state.projectStats = { findings: data.findings || 0, sections: data.sections || 0, bySeverity: data.bySeverity || {} };
    state.engageEngagement = data.engageEngagement || null;
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
    return;
  }

  state.editorItemType = null;
  state.editorItemId = null;
  state.editorMetaPanel = null;
  state.previewVisible = false;

  setCurrentView("project-detail");
  renderProjectHeader();
  loadProjectData();
}

async function loadProjectData() {
  await Promise.all([
    loadProjectFindings(),
    loadProjectSections(),
  ]);
  renderTree();
  loadProjectEvidence();
  loadProjectNotes();
  loadProjectComments();
  loadProjectHistory();
  loadProjectPdfs();
  showOverview();
}

function bindBuilder() {
  bindMarkdownToolbars(document);

  // Tree search
  document.getElementById("reporter-tree-search")?.addEventListener("input", (e) => {
    state.treeSearch = e.target.value.toLowerCase();
    renderTree();
  });

  // Tree add button
  document.getElementById("reporter-tree-add-btn")?.addEventListener("click", () => openTreeAddMenu());

  // Meta buttons
  document.querySelectorAll("[data-reporter-meta]").forEach((btn) => {
    btn.addEventListener("click", () => showMetaPanel(btn.dataset.reporterMeta));
  });

  // Inline save buttons
  document.getElementById("reporter-inline-save-finding")?.addEventListener("click", () => saveInlineFinding());
  document.getElementById("reporter-inline-delete-finding")?.addEventListener("click", () => deleteInlineFinding());
  document.getElementById("reporter-inline-copy-finding")?.addEventListener("click", () => copyCurrentFinding());
  document.getElementById("reporter-inline-save-template")?.addEventListener("click", () => saveCurrentFindingAsTemplate());
  document.getElementById("reporter-inline-add-finding-comment")?.addEventListener("click", () => showTargetCommentComposer("finding", state.editorItemId));
  document.getElementById("reporter-inline-save-section")?.addEventListener("click", () => saveInlineSection());
  document.getElementById("reporter-inline-add-section-comment")?.addEventListener("click", () => showTargetCommentComposer("section", state.editorItemId));
  document.getElementById("reporter-inline-delete-section")?.addEventListener("click", () => deleteInlineSection());
  document.getElementById("reporter-inline-cvss-builder")?.addEventListener("click", () => openCvssBuilder("reporter-inline-cvss", "reporter-inline-cvss-score", "reporter-inline-severity"));

  // Preview toggle
  document.getElementById("reporter-toggle-preview-btn")?.addEventListener("click", () => togglePreview());
  document.getElementById("reporter-close-preview-btn")?.addEventListener("click", () => togglePreview());
  document.getElementById("reporter-refresh-pdfs-btn")?.addEventListener("click", () => loadProjectPdfs());

  // CVSS live score
  document.getElementById("reporter-inline-cvss")?.addEventListener("input", () => updateCvssPreview());

  // Evidence upload
  document.getElementById("reporter-upload-evidence-btn")?.addEventListener("click", () => uploadProjectEvidence());

  // Meta panel buttons that need data loading
  document.getElementById("reporter-add-member-btn")?.addEventListener("click", () => openAddMemberModal());
  document.getElementById("reporter-add-note-btn")?.addEventListener("click", () => {
    state.editingNoteId = null;
    renderProjectNotes();
    document.getElementById("reporter-note-title")?.focus();
  });
  document.getElementById("reporter-add-comment-btn")?.addEventListener("click", () => {
    renderProjectComments();
    document.getElementById("reporter-comment-content")?.focus();
  });
}

// --- Tree Navigation ---

function renderTree() {
  renderTreeSections();
  renderTreeFindings();
}

function renderTreeSections() {
  const container = document.getElementById("reporter-tree-sections");
  if (!container) return;
  let sections = state.projectSections || [];
  if (state.treeSearch) {
    sections = sections.filter((s) => s.title.toLowerCase().includes(state.treeSearch));
  }
  if (!sections.length) {
    container.innerHTML = `<div class="text-sm text-muted reporter-tree-empty">No sections</div>`;
    return;
  }
  container.innerHTML = sections.map((s) => `
    <div class="reporter-tree-item ${state.editorItemType === "section" && state.editorItemId === s.id ? "active" : ""} ${s.isIncluded === false ? "reporter-tree-item-excluded" : ""}"
         data-tree-type="section" data-tree-id="${escapeHtml(s.id)}">
      <span class="reporter-tree-badge reporter-tree-badge-section">${escapeHtml((s.sectionType || "custom").slice(0, 3))}</span>
      <span class="reporter-tree-item-title">${escapeHtml(s.title)}</span>
    </div>
  `).join("");
  container.querySelectorAll("[data-tree-type='section']").forEach((el) => {
    el.addEventListener("click", () => selectSection(el.dataset.treeId));
  });
}

function renderTreeFindings() {
  const container = document.getElementById("reporter-tree-findings");
  if (!container) return;
  let findings = state.projectFindings || [];
  if (state.treeSearch) {
    findings = findings.filter((f) => f.title.toLowerCase().includes(state.treeSearch));
  }
  if (!findings.length) {
    container.innerHTML = `<div class="text-sm text-muted reporter-tree-empty">No findings</div>`;
    return;
  }
  container.innerHTML = findings.map((f) => {
    const sev = (f.severity || "info").toLowerCase();
    const assignee = f.assigneeUsername ? `<span class="text-muted reporter-tree-assignee">${escapeHtml(f.assigneeUsername)}</span>` : "";
    return `
      <div class="reporter-tree-item ${state.editorItemType === "finding" && state.editorItemId === f.id ? "active" : ""}"
           data-tree-type="finding" data-tree-id="${escapeHtml(f.id)}">
        <span class="reporter-tree-badge reporter-tree-badge-${sev}">${sev.slice(0, 1).toUpperCase()}</span>
        <span class="reporter-tree-item-title">${escapeHtml(f.title)}</span>
        ${assignee}
      </div>
    `;
  }).join("");
  container.querySelectorAll("[data-tree-type='finding']").forEach((el) => {
    el.addEventListener("click", () => selectFinding(el.dataset.treeId));
  });
}

function openTreeAddMenu() {
  // Show a quick add menu via modal-like approach
  const items = [
    { label: "New Finding", action: () => openCreateFindingModal() },
    { label: "From Template", action: () => openFromTemplateModal() },
    { label: "New Section", action: () => openCreateSectionModal() },
  ];
  // Simple prompt via showAlertModal with action buttons
  showTreeAddMenu(items);
}

function showTreeAddMenu(items) {
  // Reuse the modal for a quick menu
  openModal("Add Item", items.map((item, i) => `<button type="button" class="btn-secondary w-full mb-2" data-tree-add-action="${i}">${escapeHtml(item.label)}</button>`).join(""), null, "Cancel");
  items.forEach((item, i) => {
    const btn = document.querySelector(`[data-tree-add-action="${i}"]`);
    if (btn) btn.addEventListener("click", () => { closeModal(); item.action(); });
  });
}

// --- Editor Panels ---

function hideAllEditorPanels() {
  ["reporter-editor-overview", "reporter-editor-finding", "reporter-editor-section", "reporter-editor-meta"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });
  // Clear active from meta buttons
  document.querySelectorAll("[data-reporter-meta]").forEach((btn) => btn.classList.remove("active"));
  document.querySelectorAll(".reporter-tree-item").forEach((el) => el.classList.remove("active"));
}

function showOverview() {
  hideAllEditorPanels();
  state.editorItemType = null;
  state.editorItemId = null;
  const overview = document.getElementById("reporter-editor-overview");
  if (overview) overview.classList.remove("hidden");

  // Render stats in overview
  const statsContainer = document.getElementById("reporter-editor-overview-stats");
  if (statsContainer && state.projectStats) {
    const s = state.projectStats;
    const bs = s.bySeverity || {};
    let engageHtml = "";
    if (state.engageEngagement) {
      const eng = state.engageEngagement;
      engageHtml = `<div class="card mt-3"><div class="card-header"><h3 class="font-semibold">Engage Engagement</h3></div>
        <div class="p-3"><a href="/engage/" class="text-accent" target="_blank">${escapeHtml(eng.title)}</a> — ${escapeHtml(eng.status)} — ${escapeHtml(eng.client_name || "")}</div></div>`;
    }
    statsContainer.innerHTML = `
      <div class="stat-card"><div class="stat-value">${state.projectFindings.length}</div><div class="stat-label">Findings</div></div>
      <div class="stat-card"><div class="stat-value">${bs.critical || 0}</div><div class="stat-label">Critical</div></div>
      <div class="stat-card"><div class="stat-value">${bs.high || 0}</div><div class="stat-label">High</div></div>
      <div class="stat-card"><div class="stat-value">${state.projectSections.length}</div><div class="stat-label">Sections</div></div>
      ${engageHtml}
    `;
  }
}

async function selectFinding(findingId) {
  hideAllEditorPanels();
  state.editorItemType = "finding";
  state.editorItemId = findingId;

  // Highlight in tree
  const treeItem = document.querySelector(`[data-tree-type="finding"][data-tree-id="${findingId}"]`);
  if (treeItem) treeItem.classList.add("active");

  // Load full finding
  let finding;
  try {
    finding = await api(`/findings/${findingId}`);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
    return;
  }
  state.currentEditingFinding = finding;

  // Show finding editor
  const panel = document.getElementById("reporter-editor-finding");
  if (panel) panel.classList.remove("hidden");

  // Populate toolbar
  const severitySelect = document.getElementById("reporter-inline-severity");
  if (severitySelect) {
    severitySelect.innerHTML = VALID_SEVERITIES.map((s) => `<option value="${s}" ${finding.severity === s ? "selected" : ""}>${s}</option>`).join("");
  }
  const statusSelect = document.getElementById("reporter-inline-status");
  if (statusSelect) {
    statusSelect.innerHTML = VALID_FINDING_STATUSES.map((s) => `<option value="${s}" ${finding.status === s ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("");
  }

  // Assignee
  const assigneeSelect = document.getElementById("reporter-inline-assignee");
  if (assigneeSelect) {
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>` + (state.projectMembers || []).map((m) =>
      `<option value="${escapeHtml(m.userId)}" ${finding.assigneeId === m.userId ? "selected" : ""}>${escapeHtml(m.username)}</option>`
    ).join("");
  }

  const cvssInput = document.getElementById("reporter-inline-cvss");
  if (cvssInput) cvssInput.value = finding.cvssVector || "";
  updateCvssPreview();

  // Title
  const titleInput = document.getElementById("reporter-inline-finding-title");
  if (titleInput) titleInput.value = finding.title || "";

  // Fields with side-by-side markdown preview
  const fieldDefs = getActiveFindingFieldDefinitions();
  const fields = finding.fields || {};
  const fieldsContainer = document.getElementById("reporter-inline-finding-fields");
  if (fieldsContainer) {
    fieldsContainer.innerHTML = fieldDefs.map((field) => {
      const name = normalizeFieldName(field.name || field.fieldName);
      const label = field.label || field.name || field.fieldName;
      const value = fields[name] || "";
      if (name === "affected_components") {
        return renderAffectedComponentsField({
          id: `reporter-inline-field-${name}`,
          name,
          label,
          value,
          fieldAttr: "data-inline-field",
        });
      }
      const isMarkdown = (field.type || "markdown") === "markdown";
      if (isMarkdown) {
        return renderMarkdownSplitField({
          id: `reporter-inline-field-${name}`,
          name,
          label,
          value,
          fieldAttr: "data-inline-field",
          evidence: true,
        });
      }
      return `
        <div class="reporter-finding-field">
          <div class="reporter-finding-field-label">${escapeHtml(label)}</div>
          <textarea id="reporter-inline-field-${escapeHtml(name)}" class="input-field w-full" data-inline-field="${escapeHtml(name)}" rows="4">${escapeHtml(value)}</textarea>
        </div>
      `;
    }).join("");

    bindMarkdownPreviews(fieldsContainer);
    bindAffectedComponentPickers(fieldsContainer);
  }
  renderTargetComments("finding", findingId);
}

function openEvidenceInserter(triggerEl, fieldName) {
  // Remove any existing dropdown
  const existing = document.querySelector(".reporter-evidence-dropdown");
  if (existing) existing.remove();

  const textarea = triggerEl?.tagName === "TEXTAREA"
    ? triggerEl
    : document.querySelector(`[data-inline-field="${fieldName}"]`);
  if (!textarea) return;

  const evidence = state.projectEvidence || [];
  if (!evidence.length) {
    showAlertModal({ title: "No Evidence", message: "Upload evidence first via the Evidence panel." });
    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "reporter-evidence-dropdown";
  dropdown.innerHTML = evidence.map((item) => {
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(item.filename || "");
    const action = isImage ? "image" : "link";
    return `<button type="button" class="reporter-evidence-dropdown-item" data-ev-id="${escapeHtml(item.id)}" data-ev-action="${action}" data-ev-name="${escapeHtml(item.filename)}">${isImage ? "Image" : "File"}: ${escapeHtml(item.filename)}${item.caption ? ` - ${escapeHtml(item.caption)}` : ""}</button>`;
  }).join("");

  triggerEl.parentElement.appendChild(dropdown);

  const close = (e) => {
    if (!dropdown.contains(e.target) && e.target !== triggerEl) {
      dropdown.remove();
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 0);

  dropdown.querySelectorAll("[data-ev-action]").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.evAction;
      const name = item.dataset.evName;
      const url = `/api/reporter/evidence/${item.dataset.evId}/download`;
      let insertion;
      if (action === "image") {
        insertion = `![${name}](${url})`;
      } else {
        insertion = `[${name}](${url})`;
      }
      const start = textarea.selectionStart;
      textarea.setRangeText(insertion, start, start, "end");
      textarea.focus();
      // Trigger preview update
      textarea.dispatchEvent(new Event("input"));
      dropdown.remove();
      document.removeEventListener("click", close);
    });
  });
}

function updateCvssPreview() {
  const input = document.getElementById("reporter-inline-cvss");
  const scoreEl = document.getElementById("reporter-inline-cvss-score");
  if (!input || !scoreEl) return;
  updateCvssScoreDisplay(input, scoreEl, document.getElementById("reporter-inline-severity"));
}

function cvssSeverity(score) {
  if (score == null) return "info";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

function parseCvssMetrics(vector) {
  const parts = String(vector || "").trim().split("/");
  if (!/^CVSS:(3\.[01]|4\.0)$/.test(parts[0])) return null;
  const metrics = {};
  metrics.version = parts[0].replace("CVSS:", "");
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(":");
    if (key && value) metrics[key] = value;
  }
  return metrics;
}

function calculateCvssScore(vector) {
  const metrics = parseCvssMetrics(vector);
  if (!metrics) return null;
  if (metrics.version === "4.0") return calculateCvss40Score(metrics);
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const ui = { N: 0.85, R: 0.62 }[metrics.UI];
  const s = metrics.S;
  const c = { H: 0.56, L: 0.22, N: 0 }[metrics.C];
  const i = { H: 0.56, L: 0.22, N: 0 }[metrics.I];
  const a = { H: 0.56, L: 0.22, N: 0 }[metrics.A];
  if ([av, ac, ui, c, i, a].some((v) => v == null) || !["U", "C"].includes(s)) return null;
  const pr = s === "U"
    ? { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR]
    : { N: 0.85, L: 0.68, H: 0.50 }[metrics.PR];
  if (pr == null) return null;
  const iss = 1 - ((1 - c) * (1 - i) * (1 - a));
  const impact = s === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const raw = s === "U" ? impact + exploitability : 1.08 * (impact + exploitability);
  return Math.min(Math.ceil(Math.min(raw, 10) * 10) / 10, 10);
}

function calculateCvss40Score(metrics) {
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const at = { N: 0.85, P: 0.62 }[metrics.AT];
  const pr = { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR];
  const ui = { N: 0.85, P: 0.62, A: 0.45 }[metrics.UI];
  const impactMetric = { H: 0.56, L: 0.22, N: 0 };
  const impacts = ["VC", "VI", "VA", "SC", "SI", "SA"].map((key) => impactMetric[metrics[key]]);
  if ([av, ac, at, pr, ui, ...impacts].some((value) => value == null)) return null;
  const iss = 1 - impacts.reduce((acc, value) => acc * (1 - value), 1);
  const impact = 6.42 * iss;
  const exploitability = 8.22 * av * ac * at * pr * ui;
  if (impact <= 0) return 0;
  return Math.min(Math.ceil(Math.min(impact + exploitability, 10) * 10) / 10, 10);
}

function updateCvssScoreDisplay(inputEl, scoreEl, severitySelect = null) {
  if (!inputEl || !scoreEl) return;
  const vector = inputEl.value.trim();
  if (!vector) {
    scoreEl.textContent = "";
    return;
  }
  const score = calculateCvssScore(vector);
  if (score == null) {
    scoreEl.textContent = "Invalid CVSS vector";
    scoreEl.className = "text-sm text-error";
    return;
  }
  const severity = cvssSeverity(score);
  scoreEl.textContent = `${score.toFixed(1)} ${severity}`;
  scoreEl.className = `text-sm reporter-cvss-score-${severity}`;
  if (severitySelect) severitySelect.value = severity;
}

function openCvssBuilder(targetInputId, scoreTargetId, severitySelectId = null) {
  const target = document.getElementById(targetInputId);
  const current = parseCvssMetrics(target?.value) || {};
  openModal("CVSS Editor", `
    ${cvssBuilderHtml(current)}
    <div id="cvss-builder-result" class="reporter-cvss-builder-result"></div>
  `, async () => {
    const vector = buildCvssVectorFromScope(document);
    if (target) target.value = vector;
    const scoreTarget = document.getElementById(scoreTargetId);
    const severitySelect = severitySelectId ? document.getElementById(severitySelectId) : null;
    updateCvssScoreDisplay(target, scoreTarget, severitySelect);
    closeModal();
  }, "Apply");
  document.getElementById("reporter-modal-card")?.classList.add("reporter-modal-wide");
  const update = () => {
    const vector = buildCvssVectorFromScope(document);
    const score = calculateCvssScore(vector);
    updateCvssBuilderScorebox(document, score);
    const result = document.getElementById("cvss-builder-result");
    if (result) result.textContent = `${vector} - ${score == null ? "invalid" : `${score.toFixed(1)} ${cvssSeverity(score)}`}`;
  };
  bindCvssBuilder(document, update);
  update();
}

function cvssBuilderHtml(current = {}) {
  const sectionHtml = (title, groups) => `
    <section class="reporter-cvss-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="reporter-cvss-section-grid">
        ${groups.map(([key, label, values]) => `
          <div class="reporter-cvss-metric">
            <div class="reporter-cvss-metric-label">${escapeHtml(label)}</div>
            <div class="reporter-cvss-options" data-cvss-group="${safeAttr(key)}">
              ${values.map(([value, optionLabel]) => {
                const isActive = (current[key] || values[0][0]) === value;
                return `<button type="button" class="reporter-cvss-option${isActive ? " active" : ""}" data-cvss-metric="${safeAttr(key)}" data-cvss-value="${safeAttr(value)}">${escapeHtml(optionLabel)} (${escapeHtml(value)})</button>`;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
  const version = current.version === "4.0" ? "4.0" : "3.1";
  return `
    <div class="reporter-cvss-editor">
      <div class="reporter-cvss-editor-head">
        <div class="reporter-cvss-version-tabs">
          <button type="button" class="reporter-cvss-version-tab ${version === "4.0" ? "active" : ""}" data-cvss-version="4.0">CVSS:4.0</button>
          <button type="button" class="reporter-cvss-version-tab ${version === "3.1" ? "active" : ""}" data-cvss-version="3.1">CVSS:3.1</button>
        </div>
        <div class="reporter-cvss-scorebox" data-cvss-scorebox>
          <div class="reporter-cvss-scorebox-score">-</div>
          <div class="reporter-cvss-scorebox-level">Not rated</div>
        </div>
      </div>
      <div class="reporter-cvss-title" data-cvss-title>CVSS:${version} Editor</div>
      <div data-cvss-pane="3.1" class="${version === "3.1" ? "" : "hidden"}">
        ${sectionHtml("Base Score", [
          ["AV", "Attack Vector", [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]]],
          ["S", "Scope", [["U", "Unchanged"], ["C", "Changed"]]],
          ["AC", "Attack Complexity", [["L", "Low"], ["H", "High"]]],
          ["C", "Confidentiality", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["PR", "Privileges Required", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["I", "Integrity", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["UI", "User Interaction", [["N", "None"], ["R", "Required"]]],
          ["A", "Availability", [["N", "None"], ["L", "Low"], ["H", "High"]]],
        ])}
        ${sectionHtml("Temporal Score", [
          ["E", "Exploit Code Maturity", [["X", "Not Defined"], ["U", "Unproven"], ["P", "Proof-of-Concept"], ["F", "Functional"], ["H", "High"]]],
          ["RL", "Remediation Level", [["X", "Not Defined"], ["O", "Official Fix"], ["T", "Temporary Fix"], ["W", "Workaround"], ["U", "Unavailable"]]],
          ["RC", "Report Confidence", [["X", "Not Defined"], ["U", "Unknown"], ["R", "Reasonable"], ["C", "Confirmed"]]],
        ])}
        ${sectionHtml("Environmental Score", [
          ["CR", "Confidentiality Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["IR", "Integrity Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["AR", "Availability Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
        ])}
      </div>
      <div data-cvss-pane="4.0" class="${version === "4.0" ? "" : "hidden"}">
        ${sectionHtml("Base Score", [
          ["AV", "Attack Vector", [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]]],
          ["AC", "Attack Complexity", [["L", "Low"], ["H", "High"]]],
          ["AT", "Attack Requirements", [["N", "None"], ["P", "Present"]]],
          ["PR", "Privileges Required", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["UI", "User Interaction", [["N", "None"], ["P", "Passive"], ["A", "Active"]]],
          ["VC", "Vulnerable System Confidentiality", [["H", "High"], ["L", "Low"], ["N", "None"]]],
          ["VI", "Vulnerable System Integrity", [["H", "High"], ["L", "Low"], ["N", "None"]]],
          ["VA", "Vulnerable System Availability", [["H", "High"], ["L", "Low"], ["N", "None"]]],
          ["SC", "Subsequent System Confidentiality", [["H", "High"], ["L", "Low"], ["N", "None"]]],
          ["SI", "Subsequent System Integrity", [["H", "High"], ["L", "Low"], ["N", "None"]]],
          ["SA", "Subsequent System Availability", [["H", "High"], ["L", "Low"], ["N", "None"]]],
        ])}
        ${sectionHtml("Threat Score", [
          ["E", "Exploit Maturity", [["X", "Not Defined"], ["A", "Attacked"], ["P", "Proof-of-Concept"], ["U", "Unreported"]]],
        ])}
        ${sectionHtml("Environmental Score", [
          ["CR", "Confidentiality Requirement", [["X", "Not Defined"], ["H", "High"], ["M", "Medium"], ["L", "Low"]]],
          ["IR", "Integrity Requirement", [["X", "Not Defined"], ["H", "High"], ["M", "Medium"], ["L", "Low"]]],
          ["AR", "Availability Requirement", [["X", "Not Defined"], ["H", "High"], ["M", "Medium"], ["L", "Low"]]],
        ])}
      </div>
    </div>
  `;
}

function bindCvssBuilder(scope, update) {
  scope.querySelectorAll("[data-cvss-version]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const version = btn.dataset.cvssVersion;
      scope.querySelectorAll("[data-cvss-version]").forEach((tab) => tab.classList.toggle("active", tab === btn));
      scope.querySelectorAll("[data-cvss-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.cvssPane !== version));
      const title = scope.querySelector("[data-cvss-title]");
      if (title) title.textContent = `CVSS:${version} Editor`;
      update();
    });
  });
  scope.querySelectorAll("[data-cvss-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest("[data-cvss-group]");
      if (group) {
        group.querySelectorAll("[data-cvss-metric]").forEach((option) => option.classList.remove("active"));
      }
      btn.classList.add("active");
      update();
    });
  });
}

function updateCvssBuilderScorebox(scope, score) {
  const box = scope.querySelector("[data-cvss-scorebox]");
  if (!box) return;
  const severity = cvssSeverity(score);
  box.className = `reporter-cvss-scorebox reporter-cvss-score-${severity}`;
  const scoreEl = box.querySelector(".reporter-cvss-scorebox-score");
  const levelEl = box.querySelector(".reporter-cvss-scorebox-level");
  if (scoreEl) scoreEl.textContent = score == null ? "-" : score.toFixed(1);
  if (levelEl) levelEl.textContent = score == null ? "Invalid" : severity;
}

function openInlineCvssBuilder(panelId, targetInputId, scoreTargetId, severitySelectId = null) {
  const panel = document.getElementById(panelId);
  const target = document.getElementById(targetInputId);
  if (!panel || !target) return;
  const current = parseCvssMetrics(target.value) || {};
  panel.innerHTML = `
    ${cvssBuilderHtml(current)}
    <div id="${safeAttr(panelId)}-result" class="reporter-cvss-builder-result"></div>
    <button type="button" id="${safeAttr(panelId)}-apply" class="btn-primary text-sm mt-3">Apply CVSS</button>
  `;
  panel.classList.remove("hidden");
  const update = () => {
    const vector = buildCvssVectorFromScope(panel);
    const score = calculateCvssScore(vector);
    updateCvssBuilderScorebox(panel, score);
    const result = document.getElementById(`${panelId}-result`);
    if (result) result.textContent = `${vector} - ${score == null ? "invalid" : `${score.toFixed(1)} ${cvssSeverity(score)}`}`;
  };
  bindCvssBuilder(panel, update);
  document.getElementById(`${panelId}-apply`)?.addEventListener("click", () => {
    target.value = buildCvssVectorFromScope(panel);
    updateCvssScoreDisplay(target, document.getElementById(scoreTargetId), severitySelectId ? document.getElementById(severitySelectId) : null);
    panel.classList.add("hidden");
  });
  update();
}

function buildCvssVectorFromScope(scope) {
  const values = {};
  const version = scope.querySelector("[data-cvss-version].active")?.dataset.cvssVersion || "3.1";
  const pane = scope.querySelector(`[data-cvss-pane="${version}"]`) || scope;
  pane.querySelectorAll("[data-cvss-metric].active").forEach((option) => { values[option.dataset.cvssMetric] = option.dataset.cvssValue; });
  if (version === "4.0") {
    const base = `CVSS:4.0/AV:${values.AV}/AC:${values.AC}/AT:${values.AT}/PR:${values.PR}/UI:${values.UI}/VC:${values.VC}/VI:${values.VI}/VA:${values.VA}/SC:${values.SC}/SI:${values.SI}/SA:${values.SA}`;
    const optional = ["E", "CR", "IR", "AR"]
      .filter((key) => values[key] && values[key] !== "X")
      .map((key) => `${key}:${values[key]}`);
    return [base, ...optional].join("/");
  }
  const base = `CVSS:3.1/AV:${values.AV}/AC:${values.AC}/PR:${values.PR}/UI:${values.UI}/S:${values.S}/C:${values.C}/I:${values.I}/A:${values.A}`;
  const optional = ["E", "RL", "RC", "CR", "IR", "AR"]
    .filter((key) => values[key] && values[key] !== "X")
    .map((key) => `${key}:${values[key]}`);
  return [base, ...optional].join("/");
}

async function saveInlineFinding() {
  const finding = state.currentEditingFinding;
  if (!finding) return;

  const title = document.getElementById("reporter-inline-finding-title")?.value.trim();
  if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }

  try {
    await api(`/findings/${finding.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        severity: document.getElementById("reporter-inline-severity")?.value || finding.severity,
        status: document.getElementById("reporter-inline-status")?.value || finding.status,
        cvssVector: document.getElementById("reporter-inline-cvss")?.value.trim() || "",
        category: finding.category || "",
        assigneeId: document.getElementById("reporter-inline-assignee")?.value || null,
      }),
    });

    // Save fields
    const fieldEls = document.querySelectorAll("[data-inline-field]");
    for (const el of fieldEls) {
      const name = el.dataset.inlineField;
      const value = el.value;
      const original = finding.fields?.[name] || "";
      if (value !== original) {
        await api(`/findings/${finding.id}/fields/${name}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldValue: value }),
        });
      }
    }

    await loadProjectFindings();
    renderTree();
    // Re-select the finding to refresh data
    selectFinding(finding.id);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

async function deleteInlineFinding() {
  const finding = state.currentEditingFinding;
  if (!finding) return;
  if (await showConfirmModal({ title: "Delete Finding?", message: "This finding will be permanently removed.", confirmLabel: "Delete", danger: true })) {
    try {
      await api(`/findings/${finding.id}`, { method: "DELETE" });
      await loadProjectFindings();
      renderTree();
      showOverview();
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  }
}

async function copyCurrentFinding() {
  const finding = state.currentEditingFinding;
  if (!finding) return;
  try {
    const data = await api(`/findings/${finding.id}/copy`, { method: "POST" });
    await loadProjectFindings();
    renderTree();
    selectFinding(data.id);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

async function saveCurrentFindingAsTemplate() {
  const finding = state.currentEditingFinding;
  if (!finding) return;
  if (await showConfirmModal({ title: "Save as Template?", message: `Create a reusable template from "${finding.title}"?`, confirmLabel: "Save" })) {
    try {
      await api(`/findings/${finding.id}/save-template`, { method: "POST" });
      await showAlertModal({ title: "Template Created", message: "Finding has been saved as a reusable template." });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  }
}

function selectSection(sectionId) {
  hideAllEditorPanels();
  state.editorItemType = "section";
  state.editorItemId = sectionId;

  // Highlight in tree
  const treeItem = document.querySelector(`[data-tree-type="section"][data-tree-id="${sectionId}"]`);
  if (treeItem) treeItem.classList.add("active");

  const section = state.projectSections.find((s) => s.id === sectionId);
  if (!section) return;

  // Show section editor
  const panel = document.getElementById("reporter-editor-section");
  if (panel) panel.classList.remove("hidden");

  // Populate
  const titleInput = document.getElementById("reporter-inline-section-title");
  if (titleInput) titleInput.value = section.title || "";

  const typeBadge = document.getElementById("reporter-inline-section-type");
  if (typeBadge) typeBadge.textContent = (section.sectionType || "custom").replace(/_/g, " ");

  const includedCheck = document.getElementById("reporter-inline-section-included");
  if (includedCheck) includedCheck.checked = section.isIncluded !== false;

  const contentArea = document.getElementById("reporter-inline-section-content");
  if (contentArea) {
    contentArea.value = section.content || "";
    const previewEl = document.getElementById("reporter-section-content-preview");
    if (previewEl) {
      renderMarkdownPreview(section.content || "", previewEl);
      contentArea.oninput = debounce(() => renderMarkdownPreview(contentArea.value, previewEl), 300);
    }
  }
  renderTargetComments("section", sectionId);
}

async function saveInlineSection() {
  const sectionId = state.editorItemId;
  if (!sectionId) return;

  const title = document.getElementById("reporter-inline-section-title")?.value.trim();
  if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }

  try {
    await api(`/sections/${sectionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content: document.getElementById("reporter-inline-section-content")?.value || "",
        isIncluded: document.getElementById("reporter-inline-section-included")?.checked !== false,
      }),
    });
    await loadProjectSections();
    renderTree();
    selectSection(sectionId);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

async function deleteInlineSection() {
  const sectionId = state.editorItemId;
  if (!sectionId) return;
  if (await showConfirmModal({ title: "Delete Section?", message: "This section will be permanently removed.", confirmLabel: "Delete", danger: true })) {
    try {
      await api(`/sections/${sectionId}`, { method: "DELETE" });
      await loadProjectSections();
      renderTree();
      showOverview();
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  }
}

function showMetaPanel(panelName) {
  hideAllEditorPanels();
  state.editorItemType = "meta";
  state.editorMetaPanel = panelName;

  // Highlight meta button
  document.querySelectorAll("[data-reporter-meta]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.reporterMeta === panelName);
  });

  const metaPanel = document.getElementById("reporter-editor-meta");
  if (metaPanel) metaPanel.classList.remove("hidden");

  // Show the right sub-panel
  ["members", "evidence", "notes", "comments", "history", "pdfs"].forEach((name) => {
    const el = document.getElementById(`reporter-meta-${name}`);
    if (el) el.classList.toggle("hidden", name !== panelName);
  });

  // Load data for the panel
  switch (panelName) {
    case "members": renderProjectMembers(); break;
    case "evidence": loadProjectEvidence(); break;
    case "notes": loadProjectNotes(); break;
    case "comments": loadProjectComments(); break;
    case "history": loadProjectHistory(); break;
    case "pdfs": loadProjectPdfs(); break;
  }
}

// --- Preview ---

function togglePreview() {
  state.previewVisible = !state.previewVisible;
  const previewPanel = document.getElementById("reporter-builder-preview");
  const toggleBtn = document.getElementById("reporter-toggle-preview-btn");
  if (previewPanel) previewPanel.classList.toggle("hidden", !state.previewVisible);
  if (toggleBtn) toggleBtn.classList.toggle("hidden", state.previewVisible);

  if (state.previewVisible && state.selectedProjectId) {
    const iframe = document.getElementById("reporter-preview-iframe");
    if (iframe) iframe.src = `/api/reporter/projects/${state.selectedProjectId}/render-preview.pdf?t=${Date.now()}`;
  }
}

// --- Project Header ---

function renderProjectHeader() {
  const p = state.selectedProject;
  setText("reporter-project-title", p.title);
  setStatusBadgeElement("reporter-project-status-badge", p.status);
  const meta = document.getElementById("reporter-project-meta");
  const parts = [];
  if (p.clientName) parts.push(`Client: ${p.clientName}`);
  if (p.designName) parts.push(`Design: ${p.designName}`);
  if (p.dueDate) parts.push(`Due: ${formatDateTime(p.dueDate)}`);
  if (p.readonly) parts.push("READONLY");
  if (p.tags && p.tags.length) parts.push(p.tags.map((t) => `#${t}`).join(" "));
  parts.push(`Created by ${p.creatorUsername || "unknown"}`);
  meta.textContent = parts.join(" | ");

  const actions = document.getElementById("reporter-project-actions");
  const canEdit = state.capabilities.canEditAssigned || state.capabilities.canEditOwn || state.capabilities.canManageAll;
  let html = `<div class="reporter-project-actionbar">`;
  html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="preview-report">Preview</button>`;
  if (canEdit) {
    html += `<button type="button" class="btn-primary text-sm" data-reporter-action="generate-pdf">Generate PDF</button>`;
  }
  html += `<details class="reporter-action-menu"><summary class="btn-secondary text-sm">Actions</summary><div class="reporter-action-menu-panel">`;
  html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="check-report">Check</button>`;
  html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="export-project">Export</button>`;
  if (canEdit) {
    if (p.readonly) {
      html += `<span class="badge badge-amber text-sm">Read Only</span>`;
      html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="unlock-project">Unlock</button>`;
    } else {
      html += `<select id="reporter-project-status-select" class="input-field text-sm">
        ${VALID_PROJECT_STATUSES.map((s) => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s.replace(/_/g, " ")}</option>`).join("")}
      </select>`;
      html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="lock-project">Lock</button>`;
    }
    if (!p.isArchived) {
      html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="archive-project">Archive</button>`;
    } else {
      html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="unarchive-project">Unarchive</button>`;
    }
    html += `<button type="button" class="btn-secondary text-sm" data-reporter-action="duplicate-project">Duplicate</button>`;
  }
  if (state.capabilities.canManageAll || (p.createdBy === state.currentUserId && state.capabilities.canEditOwn && p.status === "draft")) {
    html += `<button type="button" class="btn-danger text-sm" data-reporter-action="delete-project">Delete</button>`;
  }
  html += `</div></details></div>`;
  actions.innerHTML = html;

  const statusSelect = document.getElementById("reporter-project-status-select");
  if (statusSelect) {
    statusSelect.addEventListener("change", async () => {
      try {
        await api(`/projects/${p.id}/status`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: statusSelect.value }) });
        state.selectedProject.status = statusSelect.value;
        setStatusBadgeElement("reporter-project-status-badge", statusSelect.value);
      } catch (err) {
        await showAlertModal({ title: "Error", message: err.message });
      }
    });
  }
  actions.querySelector("[data-reporter-action='preview-report']")?.addEventListener("click", () => {
    window.open(`/api/reporter/projects/${p.id}/render-preview.pdf`, "_blank", "noopener");
  });
  actions.querySelector("[data-reporter-action='check-report']")?.addEventListener("click", async () => {
    await checkProjectReport(p.id);
  });
  actions.querySelector("[data-reporter-action='export-project']")?.addEventListener("click", () => {
    window.location.href = `/api/reporter/projects/${p.id}/export`;
  });
  actions.querySelector("[data-reporter-action='generate-pdf']")?.addEventListener("click", async () => {
    openGeneratePdfModal(p.id);
  });
  actions.querySelector("[data-reporter-action='lock-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Lock Project?", message: "This will make the project readonly. No further edits will be allowed until unlocked.", confirmLabel: "Lock" })) {
      try { await api(`/projects/${p.id}/readonly`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ readonly: true }) }); openProject(p.id); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
  actions.querySelector("[data-reporter-action='unlock-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Unlock Project?", message: "This will allow project edits again.", confirmLabel: "Unlock" })) {
      try { await api(`/projects/${p.id}/readonly`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ readonly: false }) }); openProject(p.id); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
  actions.querySelector("[data-reporter-action='archive-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Archive Project?", message: "Archived projects are hidden from the active project list.", confirmLabel: "Archive" })) {
      try { await api(`/projects/${p.id}/archive`, { method: "POST" }); openProject(p.id); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
  actions.querySelector("[data-reporter-action='unarchive-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Unarchive Project?", message: "This project will return to the active project list.", confirmLabel: "Unarchive" })) {
      try { await api(`/projects/${p.id}/unarchive`, { method: "POST" }); openProject(p.id); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
  actions.querySelector("[data-reporter-action='duplicate-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Duplicate Project?", message: "This will clone the project, members, sections, and findings into a new draft.", confirmLabel: "Duplicate" })) {
      try { const d = await api(`/projects/${p.id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }); await refreshProjects(); openProject(d.id); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
  actions.querySelector("[data-reporter-action='delete-project']")?.addEventListener("click", async () => {
    if (await showConfirmModal({ title: "Delete Project?", message: "This will permanently delete this project and all its findings and sections.", confirmLabel: "Delete", danger: true })) {
      try { await api(`/projects/${p.id}`, { method: "DELETE" }); await refreshProjects(); setCurrentView("projects"); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    }
  });
}

async function checkProjectReport(projectId) {
  try {
    const result = await api(`/projects/${projectId}/check`);
    const messages = result.messages || [];
    const body = messages.length ? messages.map((m) => `${m.level.toUpperCase()}: ${m.message}`).join("\n") : "No report issues found.";
    await showAlertModal({ title: result.ok ? "Report Check Passed" : "Report Check", message: body });
  } catch (err) {
    await showAlertModal({ title: "Check Failed", message: err.message });
  }
}

function openGeneratePdfModal(projectId) {
  const version = state.selectedProject?.version || 1;
  openModal("Generate PDF", `
    <label class="block text-sm text-muted mb-1" for="modal-pdf-version">Report Version</label>
    <input type="text" id="modal-pdf-version" class="input-field w-full" value="${escapeHtml(version)}" placeholder="1.0">
  `, async () => {
    const versionNumber = document.getElementById("modal-pdf-version")?.value.trim() || String(version);
    closeModal();
    await generateReportPdf(projectId, { versionNumber });
  }, "Generate");
}

async function generateReportPdf(projectId, options = {}) {
  const button = document.querySelector("[data-reporter-action='generate-pdf']");
  const previous = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Generating..."; }
  try {
    const data = await api(`/projects/${projectId}/render-pdf`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ options }),
    });
    await loadProjectPdfs();
    await showAlertModal({ title: "PDF Ready", message: "The report PDF has been generated." });
    window.location.href = `/api/reporter/pdfs/${data.generation.id}/download`;
  } catch (err) {
    await showAlertModal({ title: "PDF Failed", message: err.message });
  } finally {
    if (button) { button.disabled = false; button.textContent = previous || "Generate PDF"; }
  }
}

// --- Project Data Loading ---

async function loadProjectFindings() {
  try {
    state.projectFindings = await api(`/projects/${state.selectedProjectId}/findings`);
  } catch { state.projectFindings = []; }
}

async function loadProjectSections() {
  try {
    state.projectSections = await api(`/projects/${state.selectedProjectId}/sections`);
  } catch { state.projectSections = []; }
}

async function loadProjectPdfs() {
  const container = document.getElementById("reporter-pdf-list");
  if (!state.selectedProjectId || !container) return;
  try {
    state.projectPdfs = await api(`/projects/${state.selectedProjectId}/pdfs`);
  } catch { state.projectPdfs = []; }
  renderProjectPdfs();
}

function renderProjectPdfs() {
  const container = document.getElementById("reporter-pdf-list");
  if (!container) return;
  const pdfs = state.projectPdfs || [];
  if (!pdfs.length) {
    container.innerHTML = `<p class="text-sm text-muted">No PDFs generated yet.</p>`;
    return;
  }
  container.innerHTML = pdfs.map((pdf) => `
    <div class="reporter-list-item">
      <div class="reporter-list-item-main">
        ${statusBadge(pdf.status)}
        ${pdf.renderOptions?.versionNumber ? `<span class="badge badge-gray">v${escapeHtml(pdf.renderOptions.versionNumber)}</span>` : ""}
        <span class="text-sm text-muted">${formatDateTime(pdf.createdAt)}</span>
        ${pdf.fileSize ? `<span class="text-sm text-muted">${Math.round(pdf.fileSize / 1024)} KB</span>` : ""}
        ${pdf.errorMessage ? `<span class="text-sm text-error">${escapeHtml(pdf.errorMessage)}</span>` : ""}
      </div>
      <div class="flex items-center gap-2">
        ${pdf.status === "complete" ? `<a class="btn-secondary text-sm" href="/api/reporter/pdfs/${escapeHtml(pdf.id)}/download">Download</a>` : ""}
        <button type="button" class="btn-danger text-sm" data-reporter-action="delete-pdf" data-pdf-id="${escapeHtml(pdf.id)}">Delete</button>
      </div>
    </div>
  `).join("");
  container.querySelectorAll("[data-reporter-action='delete-pdf']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (await showConfirmModal({ title: "Delete PDF Version?", message: "This generated PDF version will be permanently removed.", confirmLabel: "Delete", danger: true })) {
        try { await api(`/pdfs/${btn.dataset.pdfId}`, { method: "DELETE" }); await loadProjectPdfs(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

function renderEvidenceFindingOptions() {
  const select = document.getElementById("reporter-evidence-finding");
  if (!select) return;
  select.innerHTML = `<option value="">Project-level evidence</option>` + (state.projectFindings || []).map((f) => (
    `<option value="${escapeHtml(f.id)}">${escapeHtml(f.title)}</option>`
  )).join("");
}

async function loadProjectEvidence() {
  try { state.projectEvidence = await api(`/projects/${state.selectedProjectId}/evidence`); } catch { state.projectEvidence = []; }
  renderProjectEvidence();
  renderEvidenceFindingOptions();
}

function renderProjectEvidence() {
  const container = document.getElementById("reporter-evidence-list");
  if (!container) return;
  const evidence = state.projectEvidence || [];
  if (!evidence.length) {
    container.innerHTML = `<p class="text-sm text-muted">No evidence uploaded.</p>`;
    return;
  }
  container.innerHTML = evidence.map((item) => {
    const finding = state.projectFindings.find((f) => f.id === item.findingId);
    return `
      <div class="reporter-list-item">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(item.filename)}</strong>
          ${item.caption ? `<span class="text-sm text-muted ml-2">${escapeHtml(item.caption)}</span>` : ""}
          ${finding ? `<span class="badge badge-gray ml-2">${escapeHtml(finding.title)}</span>` : ""}
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">${Math.round((item.sizeBytes || 0) / 1024)} KB</span>
          <a class="btn-secondary text-sm" href="/api/reporter/evidence/${escapeHtml(item.id)}/download">Download</a>
          <button type="button" class="btn-danger text-sm" data-reporter-action="delete-evidence" data-evidence-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
  container.querySelectorAll("[data-reporter-action='delete-evidence']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (await showConfirmModal({ title: "Delete Evidence?", message: "This evidence file will be removed.", confirmLabel: "Delete", danger: true })) {
        try { await api(`/evidence/${btn.dataset.evidenceId}`, { method: "DELETE" }); loadProjectEvidence(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

async function uploadProjectEvidence() {
  const fileInput = document.getElementById("reporter-evidence-file");
  if (!fileInput?.files.length) { await showAlertModal({ title: "Validation", message: "Choose an evidence file first." }); return; }
  const form = new FormData();
  form.append("file", fileInput.files[0]);
  form.append("caption", document.getElementById("reporter-evidence-caption")?.value.trim() || "");
  const findingId = document.getElementById("reporter-evidence-finding")?.value;
  if (findingId) form.append("findingId", findingId);
  try {
    await api(`/projects/${state.selectedProjectId}/evidence`, { method: "POST", body: form });
    fileInput.value = "";
    const captionEl = document.getElementById("reporter-evidence-caption");
    if (captionEl) captionEl.value = "";
    await loadProjectEvidence();
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

async function loadProjectNotes() {
  try { state.projectNotes = await api(`/projects/${state.selectedProjectId}/notes`); } catch { state.projectNotes = []; }
  renderProjectNotes();
}

function renderProjectNotes() {
  const container = document.getElementById("reporter-notes-list");
  if (!container) return;
  const notes = state.projectNotes || [];
  const editing = notes.find((note) => note.id === state.editingNoteId) || null;
  container.innerHTML = `
    <div class="reporter-inline-composer">
      <label class="block text-sm text-muted mb-1" for="reporter-note-title">Title</label>
      <input type="text" id="reporter-note-title" class="input-field w-full" value="${escapeHtml(editing?.title || "")}" placeholder="Testing notes">
      ${renderMarkdownSplitField({ id: "reporter-note-content", name: "note-content", label: "Note", value: editing?.content || "", fieldAttr: "data-note-field" })}
      <div class="flex gap-2 flex-wrap">
        <button type="button" id="reporter-save-note-btn" class="btn-primary text-sm">${editing ? "Update Note" : "Add Note"}</button>
        ${editing ? '<button type="button" id="reporter-cancel-note-edit-btn" class="btn-secondary text-sm">Cancel</button>' : ""}
      </div>
    </div>
    ${notes.length ? notes.map((note) => `
    <div class="reporter-list-item" data-reporter-action="edit-note" data-note-id="${escapeHtml(note.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(note.title)}</strong>
        <span class="text-sm text-muted ml-2">${escapeHtml(note.username || "unknown")} · ${formatDateTime(note.updatedAt || note.createdAt)}</span>
        <textarea class="hidden" data-note-preview-source data-preview-for="note-${escapeHtml(note.id)}">${escapeHtml(note.content || "")}</textarea>
        <div class="reporter-comment-preview reporter-note-preview" data-preview-for="note-${escapeHtml(note.id)}"></div>
      </div>
      <div class="flex items-center gap-2">
        ${canDeleteReporterItem(note) ? `<button type="button" class="btn-danger text-sm" data-reporter-action="delete-note" data-note-id="${escapeHtml(note.id)}">Delete</button>` : ""}
      </div>
    </div>
    `).join("") : `<p class="text-sm text-muted">No notes yet.</p>`}
  `;
  bindMarkdownPreviews(container);
  bindMarkdownPreviews(container, "[data-note-preview-source]");
  document.getElementById("reporter-save-note-btn")?.addEventListener("click", () => saveInlineNote());
  document.getElementById("reporter-cancel-note-edit-btn")?.addEventListener("click", () => {
    state.editingNoteId = null;
    renderProjectNotes();
  });
  container.querySelectorAll("[data-reporter-action='edit-note']").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-reporter-action='delete-note']")) return;
      state.editingNoteId = el.dataset.noteId;
      renderProjectNotes();
    });
  });
  container.querySelectorAll("[data-reporter-action='delete-note']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await showConfirmModal({ title: "Delete Note?", message: "This note will be permanently removed.", confirmLabel: "Delete", danger: true })) {
        try { await api(`/notes/${btn.dataset.noteId}`, { method: "DELETE" }); loadProjectNotes(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

async function saveInlineNote() {
  const title = document.getElementById("reporter-note-title")?.value.trim() || "Untitled Note";
  const content = document.getElementById("reporter-note-content")?.value || "";
  try {
    if (state.editingNoteId) {
      await api(`/notes/${state.editingNoteId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
    } else {
      await api(`/projects/${state.selectedProjectId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
    }
    state.editingNoteId = null;
    await loadProjectNotes();
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

async function loadProjectComments() {
  try { state.projectComments = await api(`/projects/${state.selectedProjectId}/comments`); } catch { state.projectComments = []; }
  renderProjectComments();
}

function targetCommentContainerId(targetType) {
  if (targetType === "finding") return "reporter-inline-finding-comments";
  if (targetType === "section") return "reporter-inline-section-comments";
  return "";
}

async function renderTargetComments(targetType, targetId, options = {}) {
  const container = document.getElementById(targetCommentContainerId(targetType));
  if (!container || !targetId) return;
  let comments = [];
  try { comments = await api(`/comments/${targetType}/${targetId}`); } catch { comments = []; }
  const showComposer = options.showComposer === true;
  container.innerHTML = `
    <div class="reporter-target-comments-header">
      <h3 class="font-semibold">Comments</h3>
      <button type="button" class="btn-secondary text-sm" data-target-comment-add="${escapeHtml(targetType)}">Add Comment</button>
    </div>
    ${showComposer ? renderTargetCommentComposer(targetType, targetId) : ""}
    <div class="reporter-target-comment-list">
      ${comments.length ? comments.map((comment) => renderCommentCard(comment, { targetLabel: false })).join("") : `<p class="text-sm text-muted">No comments for this ${escapeHtml(targetType)}.</p>`}
    </div>
  `;
  container.querySelector("[data-target-comment-add]")?.addEventListener("click", () => showTargetCommentComposer(targetType, targetId));
  bindTargetCommentComposer(container, targetType, targetId);
  bindCommentCardActions(container);
  bindMarkdownPreviews(container);
  bindMarkdownPreviews(container, "[data-comment-preview-source]");
}

function renderTargetCommentComposer(targetType, targetId) {
  const id = `target-comment-${targetType}-${targetId}`;
  return `
    <div class="reporter-inline-composer">
      ${renderMarkdownSplitField({ id, name: id, label: "Comment", value: "", fieldAttr: "data-target-comment-field" })}
      <div class="flex gap-2 flex-wrap">
        <button type="button" class="btn-primary text-sm" data-target-comment-save="${safeAttr(id)}">Add Comment</button>
        <button type="button" class="btn-secondary text-sm" data-target-comment-cancel="${safeAttr(id)}">Cancel</button>
      </div>
    </div>
  `;
}

function showTargetCommentComposer(targetType, targetId) {
  if (!targetId) return;
  renderTargetComments(targetType, targetId, { showComposer: true });
}

function bindTargetCommentComposer(root, targetType, targetId) {
  const textarea = root.querySelector("[data-target-comment-field]");
  root.querySelector("[data-target-comment-save]")?.addEventListener("click", async () => {
    const content = textarea?.value.trim() || "";
    if (!content) { await showAlertModal({ title: "Validation", message: "Comment is required." }); return; }
    try {
      await api(`/projects/${state.selectedProjectId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, content }) });
      await loadProjectComments();
      await renderTargetComments(targetType, targetId);
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  });
  root.querySelector("[data-target-comment-cancel]")?.addEventListener("click", () => renderTargetComments(targetType, targetId));
}

function renderCommentCard(comment, options = {}) {
  const targetLabel = options.targetLabel === false ? "" : `<strong class="ml-2">${escapeHtml(comment.targetType)}</strong>`;
  const deleteButton = canDeleteReporterItem(comment)
    ? `<button type="button" class="btn-danger text-sm" data-reporter-action="delete-comment" data-comment-id="${escapeHtml(comment.id)}">Delete</button>`
    : "";
  return `
    <div class="reporter-list-item reporter-comment-card">
      <div class="reporter-list-item-main">
        ${comment.isResolved ? '<span class="badge badge-green">resolved</span>' : '<span class="badge badge-amber">open</span>'}
        ${targetLabel}
        <span class="text-sm text-muted ml-2">${escapeHtml(comment.username || "unknown")} · ${formatDateTime(comment.createdAt)}</span>
        <textarea class="hidden" data-comment-preview-source data-preview-for="comment-${escapeHtml(comment.id)}">${escapeHtml(comment.content || "")}</textarea>
        <div class="reporter-comment-preview" data-preview-for="comment-${escapeHtml(comment.id)}"></div>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="btn-secondary text-sm" data-reporter-action="toggle-comment" data-comment-id="${escapeHtml(comment.id)}" data-resolved="${comment.isResolved ? "true" : "false"}">${comment.isResolved ? "Reopen" : "Resolve"}</button>
        ${deleteButton}
      </div>
    </div>
  `;
}

function bindCommentCardActions(root = document) {
  root.querySelectorAll("[data-reporter-action='toggle-comment']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/comments/${btn.dataset.commentId}/resolve`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isResolved: btn.dataset.resolved !== "true" }) });
        await loadProjectComments();
        if (state.editorItemType === "finding" || state.editorItemType === "section") await renderTargetComments(state.editorItemType, state.editorItemId);
      } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    });
  });
  root.querySelectorAll("[data-reporter-action='delete-comment']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (await showConfirmModal({ title: "Delete Comment?", message: "This comment will be permanently removed.", confirmLabel: "Delete", danger: true })) {
        try {
          await api(`/comments/${btn.dataset.commentId}`, { method: "DELETE" });
          await loadProjectComments();
          if (state.editorItemType === "finding" || state.editorItemType === "section") await renderTargetComments(state.editorItemType, state.editorItemId);
        } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

function renderProjectComments() {
  const container = document.getElementById("reporter-comments-list");
  if (!container) return;
  const comments = state.projectComments || [];
  const targetOptions = [
    `<option value="project:${escapeHtml(state.selectedProjectId)}">Project</option>`,
    ...(state.projectFindings || []).map((finding) => `<option value="finding:${escapeHtml(finding.id)}">Finding: ${escapeHtml(finding.title)}</option>`),
    ...(state.projectSections || []).map((section) => `<option value="section:${escapeHtml(section.id)}">Section: ${escapeHtml(section.title)}</option>`),
    ...(state.projectNotes || []).map((note) => `<option value="note:${escapeHtml(note.id)}">Note: ${escapeHtml(note.title)}</option>`),
  ].join("");
  container.innerHTML = `
    <div class="reporter-inline-composer">
      <label class="block text-sm text-muted mb-1" for="reporter-comment-target">Target</label>
      <select id="reporter-comment-target" class="input-field w-full">${targetOptions}</select>
      ${renderMarkdownSplitField({ id: "reporter-comment-content", name: "comment-content", label: "Comment", value: "", fieldAttr: "data-comment-field" })}
      <button type="button" id="reporter-save-comment-btn" class="btn-primary text-sm">Add Comment</button>
    </div>
    ${comments.length ? comments.map((comment) => renderCommentCard(comment)).join("") : `<p class="text-sm text-muted">No comments yet.</p>`}
  `;
  bindMarkdownPreviews(container);
  document.getElementById("reporter-save-comment-btn")?.addEventListener("click", () => saveInlineComment());
  bindCommentCardActions(container);
  bindMarkdownPreviews(container, "[data-comment-preview-source]");
}

async function saveInlineComment() {
  const content = document.getElementById("reporter-comment-content")?.value.trim() || "";
  if (!content) { await showAlertModal({ title: "Validation", message: "Comment is required." }); return; }
  const [targetType, targetId] = (document.getElementById("reporter-comment-target")?.value || `project:${state.selectedProjectId}`).split(":");
  try {
    await api(`/projects/${state.selectedProjectId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, content }) });
    await loadProjectComments();
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

async function loadProjectHistory() {
  try { state.projectHistory = await api(`/projects/${state.selectedProjectId}/history`); } catch { state.projectHistory = []; }
  renderProjectHistory();
}

function renderProjectHistory() {
  const container = document.getElementById("reporter-history-list");
  if (!container) return;
  const history = state.projectHistory || [];
  if (!history.length) {
    container.innerHTML = `<p class="text-sm text-muted">No history recorded yet.</p>`;
    return;
  }
  container.innerHTML = history.map((item) => `
    <div class="reporter-list-item">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(item.changeSummary || "Change recorded")}</strong>
        <span class="badge badge-gray ml-2">${escapeHtml(item.targetType)}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">${escapeHtml(item.username || "unknown")}</span>
        <span class="text-sm text-muted">${formatDateTime(item.createdAt)}</span>
      </div>
    </div>
  `).join("");
}

function renderProjectMembers() {
  const container = document.getElementById("reporter-members-list");
  if (!container) return;
  const members = state.projectMembers;
  if (!members.length) {
    container.innerHTML = `<p class="text-sm text-muted">No members.</p>`;
    return;
  }
  container.innerHTML = members.map((m) => `
    <div class="reporter-list-item">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(m.username)}</strong>
        ${roleBadge(m.role)}
      </div>
      <div class="flex items-center gap-2">
        ${state.capabilities.canManageAll || state.capabilities.canEditAssigned ? `
          <select class="input-field text-sm" data-reporter-action="change-role" data-user-id="${escapeHtml(m.userId)}">
            ${VALID_MEMBER_ROLES.map((r) => `<option value="${r}" ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}
          </select>
          <button type="button" class="btn-danger text-sm" data-reporter-action="remove-member" data-user-id="${escapeHtml(m.userId)}">Remove</button>
        ` : ""}
      </div>
    </div>
  `).join("");
  container.querySelectorAll("[data-reporter-action='change-role']").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try { await api(`/projects/${state.selectedProjectId}/members/${sel.dataset.userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: sel.value }) }); state.projectMembers = state.projectMembers.map((m) => m.userId === sel.dataset.userId ? { ...m, role: sel.value } : m); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
    });
  });
  container.querySelectorAll("[data-reporter-action='remove-member']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (await showConfirmModal({ title: "Remove Member?", message: "Remove this member from the project?", confirmLabel: "Remove", danger: true })) {
        try { await api(`/projects/${state.selectedProjectId}/members/${btn.dataset.userId}`, { method: "DELETE" }); state.projectMembers = state.projectMembers.filter((m) => m.userId !== btn.dataset.userId); renderProjectMembers(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

// --- Designs ---

function renderDesignsList() {
  const container = document.getElementById("reporter-designs-list");
  const designs = state.designs;
  if (!designs.length) {
    container.innerHTML = `<p class="text-sm text-muted">No designs yet. Create one to define report layouts.</p>`;
    return;
  }
  container.innerHTML = designs.map((d) => `
    <div class="reporter-list-item" data-reporter-action="edit-design" data-design-id="${escapeHtml(d.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(d.name)}</strong>
        <span class="badge badge-gray ml-2">${escapeHtml(d.reportType)}</span>
        ${d.isBuiltin ? '<span class="badge badge-blue ml-2">Built-in</span>' : ""}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted">${d.findingFieldDefinitions?.length || 0} finding fields</span>
        <span class="text-sm text-muted">${d.sectionDefinitions?.length || 0} sections</span>
        ${(state.capabilities.canManageTemplates || state.capabilities.canManageAll) && !d.isBuiltin ? `<button type="button" class="btn-danger text-sm" data-reporter-action="delete-design" data-design-id="${escapeHtml(d.id)}">Delete</button>` : ""}
      </div>
    </div>
  `).join("");
  container.querySelectorAll("[data-reporter-action='edit-design']").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-reporter-action='delete-design']")) return;
      openDesignEditor(el.dataset.designId);
    });
  });
  container.querySelectorAll("[data-reporter-action='delete-design']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await showConfirmModal({ title: "Delete Design?", message: "This design will be permanently removed.", confirmLabel: "Delete", danger: true })) {
        try { await api(`/designs/${btn.dataset.designId}`, { method: "DELETE" }); state.designs = state.designs.filter((d) => d.id !== btn.dataset.designId); renderDesignsList(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

async function openDesignEditor(designId) {
  let design;
  try { design = await api(`/designs/${designId}`); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); return; }
  state.selectedDesignId = designId;
  state.selectedDesign = design;
  setCurrentView("design-editor");
  renderDesignEditor();
}

function renderDesignEditor() {
  const d = state.selectedDesign;
  if (!d) return;
  setText("reporter-design-editor-title", d.name);
  setText("reporter-design-editor-meta", d.isBuiltin ? "Built-in design. Duplicate to customise." : "Edit template source, style, and field definitions.");
  const typeBadge = document.getElementById("reporter-design-editor-type");
  if (typeBadge) { typeBadge.textContent = d.reportType || "custom"; typeBadge.className = "badge badge-gray"; }
  const typeSelect = document.getElementById("reporter-design-editor-report-type");
  if (typeSelect) typeSelect.innerHTML = VALID_REPORT_TYPES.map((type) => `<option value="${type}" ${d.reportType === type ? "selected" : ""}>${type}</option>`).join("");
  const nameInput = document.getElementById("reporter-design-editor-name");
  if (nameInput) nameInput.value = d.name || "";
  const descInput = document.getElementById("reporter-design-editor-description");
  if (descInput) descInput.value = d.description || "";
  const htmlInput = document.getElementById("reporter-design-editor-html");
  if (htmlInput) htmlInput.value = d.htmlTemplate || "";
  const cssInput = document.getElementById("reporter-design-editor-css");
  if (cssInput) cssInput.value = d.cssTemplate || "";
  const fieldsInput = document.getElementById("reporter-design-editor-fields");
  if (fieldsInput) fieldsInput.value = JSON.stringify(d.findingFieldDefinitions || defaultFindingFields(), null, 2);
  const sectionsInput = document.getElementById("reporter-design-editor-sections");
  if (sectionsInput) sectionsInput.value = JSON.stringify(d.sectionDefinitions || defaultSectionDefinitions(), null, 2);
  const saveBtn = document.getElementById("reporter-design-save-btn");
  if (saveBtn) saveBtn.disabled = !!d.isBuiltin || !(state.capabilities.canManageTemplates || state.capabilities.canManageAll);
  const duplicateBtn = document.getElementById("reporter-design-duplicate-btn");
  if (duplicateBtn) duplicateBtn.classList.toggle("hidden", !(state.capabilities.canManageTemplates || state.capabilities.canManageAll));
  updateDesignPreviewIframe();
}

async function duplicateSelectedDesign() {
  const d = state.selectedDesign;
  if (!d) return;
  const name = `${d.name} Copy`;
  if (!await showConfirmModal({ title: "Duplicate Design?", message: `Create a custom editable copy of "${d.name}"?`, confirmLabel: "Duplicate" })) return;
  try {
    const created = await api(`/designs/${d.id}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    state.designs = await api("/designs");
    openDesignEditor(created.id);
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

async function saveDesignEditor(options = {}) {
  const d = state.selectedDesign;
  if (!d) return;
  const name = document.getElementById("reporter-design-editor-name")?.value.trim();
  if (!name) { await showAlertModal({ title: "Validation", message: "Name is required." }); return false; }
  try {
    await api(`/designs/${d.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        reportType: document.getElementById("reporter-design-editor-report-type")?.value,
        description: document.getElementById("reporter-design-editor-description")?.value.trim(),
        htmlTemplate: document.getElementById("reporter-design-editor-html")?.value,
        cssTemplate: document.getElementById("reporter-design-editor-css")?.value,
        findingFieldDefinitions: parseJsonInput("reporter-design-editor-fields", d.findingFieldDefinitions || defaultFindingFields()),
        sectionDefinitions: parseJsonInput("reporter-design-editor-sections", d.sectionDefinitions || defaultSectionDefinitions()),
      }),
    });
    state.designs = await api("/designs");
    state.selectedDesign = await api(`/designs/${d.id}`);
    renderDesignEditor();
    if (!options.quiet) await showAlertModal({ title: "Saved", message: "Report design saved." });
    return true;
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); return false; }
}

async function previewDesignEditor() {
  const d = state.selectedDesign;
  if (!d) return;
  if (!d.isBuiltin && (state.capabilities.canManageTemplates || state.capabilities.canManageAll)) {
    const saved = await saveDesignEditor({ quiet: true });
    if (!saved) return;
  }
  updateDesignPreviewIframe();
}

function updateDesignPreviewIframe() {
  const iframe = document.getElementById("reporter-design-preview-iframe");
  const d = state.selectedDesign;
  if (!iframe || !d) return;
  iframe.src = `/api/reporter/designs/${encodeURIComponent(d.id)}/preview.pdf?t=${Date.now()}`;
}

// --- Templates ---

function renderTemplatesList() {
  const container = document.getElementById("reporter-templates-list");
  let list = [...state.templates];
  if (state.templateSearch) {
    const q = state.templateSearch.toLowerCase();
    list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q));
  }
  if (!list.length) { container.innerHTML = `<p class="text-sm text-muted">No finding templates found.</p>`; return; }
  container.innerHTML = list.map((t) => `
    <div class="reporter-list-item" data-reporter-action="edit-template" data-template-id="${escapeHtml(t.id)}">
      <div class="reporter-list-item-main">
        ${severityBadge(t.severity)}
        <strong class="ml-2">${escapeHtml(t.title)}</strong>
        ${t.category ? `<span class="text-sm text-muted ml-2">${escapeHtml(t.category)}</span>` : ""}
      </div>
      <div class="flex items-center gap-2">
        ${(t.tags || []).map((tag) => `<span class="badge badge-gray">${escapeHtml(tag)}</span>`).join("")}
        <span class="text-sm text-muted">Used ${t.usageCount}x</span>
        ${(state.capabilities.canManageTemplates || state.capabilities.canManageAll) && !t.isBuiltin ? `<button type="button" class="btn-danger text-sm" data-reporter-action="delete-template" data-template-id="${escapeHtml(t.id)}">Delete</button>` : ""}
      </div>
    </div>
  `).join("");
  container.querySelectorAll("[data-reporter-action='edit-template']").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-reporter-action='delete-template']")) return;
      openTemplateEditor(el.dataset.templateId);
    });
  });
  container.querySelectorAll("[data-reporter-action='delete-template']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (await showConfirmModal({ title: "Delete Template?", message: "This template will be permanently removed.", confirmLabel: "Delete", danger: true })) {
        try { await api(`/templates/${btn.dataset.templateId}`, { method: "DELETE" }); state.templates = state.templates.filter((t) => t.id !== btn.dataset.templateId); renderTemplatesList(); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
      }
    });
  });
}

async function openTemplateEditor(templateId) {
  let template;
  try { template = await api(`/templates/${templateId}`); } catch (err) { await showAlertModal({ title: "Error", message: err.message }); return; }
  state.selectedTemplateId = templateId;
  state.selectedTemplate = template;
  setCurrentView("template-editor");
  renderTemplateEditor();
}

function renderTemplateEditor() {
  const t = state.selectedTemplate;
  if (!t) return;
  setText("reporter-template-editor-title", t.title || "Template Editor");
  setText("reporter-template-editor-meta", t.isBuiltin ? "Built-in template." : `Used ${t.usageCount || 0} times.`);
  setStatusBadgeElement("reporter-template-editor-severity-badge", t.severity || "info");
  const nameInput = document.getElementById("reporter-template-editor-name");
  if (nameInput) nameInput.value = t.title || "";
  const catInput = document.getElementById("reporter-template-editor-category");
  if (catInput) catInput.value = t.category || "";
  const cvssInput = document.getElementById("reporter-template-editor-cvss");
  if (cvssInput) cvssInput.value = t.cvssVector || "";
  const tagsInput = document.getElementById("reporter-template-editor-tags");
  if (tagsInput) tagsInput.value = (t.tags || []).join(", ");
  const sevSelect = document.getElementById("reporter-template-editor-severity");
  if (sevSelect) sevSelect.innerHTML = VALID_SEVERITIES.map((severity) => `<option value="${severity}" ${t.severity === severity ? "selected" : ""}>${severity}</option>`).join("");
  updateCvssScoreDisplay(cvssInput, document.getElementById("reporter-template-cvss-score"), sevSelect);
  const values = Object.fromEntries((t.fields || []).filter((field) => field.language === "en").map((field) => [field.fieldName, field.fieldValue]));
  const fieldsContainer = document.getElementById("reporter-template-editor-fields");
  if (fieldsContainer) {
    fieldsContainer.innerHTML = renderFindingFieldInputs("reporter-template-editor-field", values, defaultFindingFields(), { scopeComponents: false });
    bindMarkdownPreviews(fieldsContainer);
  }
  const saveBtn = document.getElementById("reporter-template-save-btn");
  if (saveBtn) saveBtn.disabled = !!t.isBuiltin || !(state.capabilities.canManageTemplates || state.capabilities.canManageAll);
}

async function saveTemplateEditor() {
  const t = state.selectedTemplate;
  if (!t) return;
  const title = document.getElementById("reporter-template-editor-name")?.value.trim();
  if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
  try {
    const fields = Object.entries(readFindingFieldValues("reporter-template-editor-field")).map(([fieldName, fieldValue]) => ({ fieldName, fieldValue, language: "en" }));
    await api(`/templates/${t.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category: document.getElementById("reporter-template-editor-category")?.value.trim(),
        severity: document.getElementById("reporter-template-editor-severity")?.value,
        cvssVector: document.getElementById("reporter-template-editor-cvss")?.value.trim(),
        tags: (document.getElementById("reporter-template-editor-tags")?.value || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        fields,
      }),
    });
    state.templates = await api("/templates");
    state.selectedTemplate = await api(`/templates/${t.id}`);
    renderTemplateEditor();
    await showAlertModal({ title: "Saved", message: "Finding template saved." });
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

// --- Modals ---

function bindModals() {
  document.getElementById("reporter-modal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("reporter-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "reporter-modal") closeModal();
  });
}

function openModal(title, bodyHtml, onConfirm, confirmLabel = "Save") {
  document.getElementById("reporter-modal-card")?.classList.remove("reporter-modal-wide");
  setText("reporter-modal-title", title);
  document.getElementById("reporter-modal-body").innerHTML = bodyHtml;
  const confirmBtn = document.getElementById("reporter-modal-confirm");
  confirmBtn.textContent = confirmLabel;
  confirmBtn.onclick = onConfirm;
  document.getElementById("reporter-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("reporter-modal").classList.add("hidden");
  document.getElementById("reporter-modal-card")?.classList.remove("reporter-modal-wide");
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function normalizeFieldName(name) {
  return String(name || "").trim().replace(/[^a-z0-9_]/gi, "_").replace(/^_+/, "").slice(0, 64);
}

function getActiveFindingFieldDefinitions() {
  const defs = state.projectDesign?.findingFieldDefinitions;
  if (Array.isArray(defs) && defs.length) {
    return defs.map((field) => ({
      name: normalizeFieldName(field.name || field.fieldName),
      label: field.label || field.name || field.fieldName,
      type: field.type || "markdown",
    })).filter((field) => field.name);
  }
  return defaultFindingFields();
}

function getScopeComponents() {
  const scopeSections = (state.projectSections || []).filter((section) => section.sectionType === "scope" && section.isIncluded !== false);
  const components = [];
  const seen = new Set();
  for (const section of scopeSections) {
    const lines = String(section.content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      let value = line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^#+\s+/, "")
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .trim();
      if (value.includes("|")) {
        value = value.split("|").map((part) => part.trim()).filter(Boolean)[0] || value;
      }
      value = value.replace(/\*\*/g, "").replace(/`/g, "").trim();
      if (!value || /^[-:]+$/.test(value)) continue;
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        components.push(value);
      }
    }
  }
  return components;
}

function renderFindingFieldInputs(prefix, values = {}, definitions = defaultFindingFields(), options = {}) {
  return definitions.map((field) => {
    const name = normalizeFieldName(field.name || field.fieldName);
    const label = field.label || field.name || field.fieldName;
    const value = values[name] || "";
    const id = `${prefix}-${name}`;
    if (name === "affected_components" && options.scopeComponents !== false) {
      return renderAffectedComponentsField({ id, name, label, value, fieldAttr: "data-finding-field" });
    }
    const isMarkdown = (field.type || "markdown") === "markdown";
    if (isMarkdown) return renderMarkdownSplitField({ id, name, label, value, fieldAttr: "data-finding-field" });
    return `
      <div class="reporter-finding-field">
        <label class="reporter-finding-field-label" for="${safeAttr(id)}">${escapeHtml(label)}</label>
        <textarea id="${safeAttr(id)}" data-finding-field="${escapeHtml(name)}" class="input-field w-full" rows="4">${escapeHtml(value)}</textarea>
      </div>
    `;
  }).join("");
}

function renderAffectedComponentsField({ id, name, label, value, fieldAttr = "data-inline-field" }) {
  const components = getScopeComponents();
  if (!components.length) {
    return `
      <div class="reporter-finding-field">
        <label class="reporter-finding-field-label" for="${safeAttr(id)}">${escapeHtml(label)}</label>
        <textarea id="${safeAttr(id)}" ${fieldAttr}="${escapeHtml(name)}" class="input-field w-full" rows="4">${escapeHtml(value || "")}</textarea>
      </div>
    `;
  }
  const selected = new Set(String(value || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean));
  const selectedLower = new Set(Array.from(selected).map((item) => item.toLowerCase()));
  const componentSet = new Set(components.map((item) => item.toLowerCase()));
  const customValues = Array.from(selected).filter((item) => !componentSet.has(item.toLowerCase())).join("\n");
  return `
    <div class="reporter-finding-field">
      <label class="reporter-finding-field-label" for="${safeAttr(id)}">${escapeHtml(label)}</label>
      <textarea id="${safeAttr(id)}" ${fieldAttr}="${escapeHtml(name)}" class="hidden" data-component-hidden="${safeAttr(id)}">${escapeHtml(value || "")}</textarea>
      <div class="reporter-component-picker" data-component-picker="${safeAttr(id)}">
        <div class="reporter-component-picker-grid">
          ${components.map((component) => `
            <label class="reporter-component-option">
              <input type="checkbox" data-component-option="${safeAttr(id)}" value="${safeAttr(component)}" ${selectedLower.has(component.toLowerCase()) ? "checked" : ""}>
              <span>${escapeHtml(component)}</span>
            </label>
          `).join("")}
        </div>
        <label class="block text-sm text-muted mb-1 mt-3" for="${safeAttr(id)}-custom">Additional components</label>
        <textarea id="${safeAttr(id)}-custom" class="input-field w-full" data-component-free="${safeAttr(id)}" rows="2">${escapeHtml(customValues)}</textarea>
      </div>
    </div>
  `;
}

function renderMarkdownSplitField({ id, name, label, value, fieldAttr = "data-inline-field", evidence = false }) {
  return `
    <div class="reporter-finding-field">
      <label class="reporter-finding-field-label" for="${safeAttr(id)}">${escapeHtml(label)}</label>
      <div class="reporter-finding-field-split">
        <div class="reporter-finding-field-edit">
          ${markdownToolbarHtml(id, { evidence })}
          <textarea id="${safeAttr(id)}" class="input-field w-full" ${fieldAttr}="${escapeHtml(name)}" data-markdown-preview="true" rows="10">${escapeHtml(value || "")}</textarea>
        </div>
        <div class="reporter-finding-field-preview" data-preview-for="${escapeHtml(name)}"></div>
      </div>
    </div>
  `;
}

function bindMarkdownPreviews(root, selector = "[data-markdown-preview]") {
  root.querySelectorAll(selector).forEach((textarea) => {
    const name = textarea.dataset.previewFor || textarea.dataset.inlineField || textarea.dataset.findingField || textarea.dataset.noteField || textarea.dataset.commentField || textarea.dataset.targetCommentField || textarea.id;
    const previewEl = Array.from(root.querySelectorAll("[data-preview-for]")).find((el) => el !== textarea && el.dataset.previewFor === name);
    if (previewEl) {
      renderMarkdownPreview(textarea.value, previewEl);
      textarea.addEventListener("input", debounce(() => renderMarkdownPreview(textarea.value, previewEl), 300));
    }
  });
  bindMarkdownToolbars(root);
}

function bindAffectedComponentPickers(root = document) {
  const sync = (id) => {
    const hidden = root.querySelector(`[data-component-hidden="${id}"]`) || document.querySelector(`[data-component-hidden="${id}"]`);
    if (!hidden) return;
    const selected = Array.from((root || document).querySelectorAll(`[data-component-option="${id}"]:checked`)).map((input) => input.value);
    const free = ((root || document).querySelector(`[data-component-free="${id}"]`)?.value || "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    const values = Array.from(new Set([...selected, ...free]));
    hidden.value = values.join("\n");
  };
  root.querySelectorAll("[data-component-hidden]").forEach((hidden) => {
    const id = hidden.dataset.componentHidden;
    root.querySelectorAll(`[data-component-option="${id}"]`).forEach((input) => input.addEventListener("change", () => sync(id)));
    root.querySelector(`[data-component-free="${id}"]`)?.addEventListener("input", () => sync(id));
    sync(id);
  });
}

function readFindingFieldValues(prefix) {
  const values = {};
  document.querySelectorAll(`[id^="${prefix}-"][data-finding-field]`).forEach((el) => {
    const name = el.dataset.findingField;
    if (name) values[name] = el.value;
  });
  return values;
}

function parseJsonInput(id, fallback) {
  const value = document.getElementById(id)?.value.trim();
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// --- Create Modals ---

function openCreateProjectModal() {
  const designOptions = state.designs.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} (${escapeHtml(d.reportType)})</option>`).join("");
  openModal("New Project", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-project-title" class="input-field w-full" placeholder="ACME Corp External Pentest">
    <label class="block text-sm text-muted mb-1 mt-3">Design *</label>
    <select id="modal-project-design" class="input-field w-full">${designOptions}</select>
    <label class="block text-sm text-muted mb-1 mt-3">Client Name</label>
    <input type="text" id="modal-project-client" class="input-field w-full" placeholder="ACME Corp">
    <label class="block text-sm text-muted mb-1 mt-3">Tags (comma-separated)</label>
    <input type="text" id="modal-project-tags" class="input-field w-full" placeholder="webapp, external, 2025">
    <label class="block text-sm text-muted mb-1 mt-3">Due Date</label>
    <input type="date" id="modal-project-due" class="input-field w-full">
  `, saveNewProject, "Create");
}

async function saveNewProject() {
  const title = document.getElementById("modal-project-title").value.trim();
  const designId = document.getElementById("modal-project-design").value;
  if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
  if (!designId) { await showAlertModal({ title: "Validation", message: "Design is required." }); return; }
  try {
    const tagsRaw = (document.getElementById("modal-project-tags")?.value || "").split(",").map((t) => t.trim()).filter(Boolean);
    const payload = { designId, title, clientName: document.getElementById("modal-project-client").value.trim(), tags: tagsRaw, dueDate: document.getElementById("modal-project-due").value ? Math.floor(new Date(document.getElementById("modal-project-due").value).getTime() / 1000) : null };
    const res = await api("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    closeModal();
    await refreshProjects();
    openProject(res.id);
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

function openImportProjectModal() {
  openModal("Import Project", `
    <label class="block text-sm text-muted mb-1">RedSecReporter Archive</label>
    <input type="file" id="modal-import-archive" class="input-field w-full" accept=".json,.redsecreporter">
  `, async () => {
    const input = document.getElementById("modal-import-archive");
    if (!input.files.length) { await showAlertModal({ title: "Validation", message: "Choose an archive file." }); return; }
    const form = new FormData();
    form.append("archive", input.files[0]);
    try {
      const data = await api("/import", { method: "POST", body: form });
      closeModal();
      await refreshProjects();
      await showAlertModal({ title: "Import Complete", message: `Imported ${data.resultSummary.findings || 0} findings and ${data.resultSummary.sections || 0} sections.` });
      openProject(data.projectId);
    } catch (err) { await showAlertModal({ title: "Import Failed", message: err.message }); }
  }, "Import");
}

function openCreateNoteModal() {
  openModal("New Note", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-note-title" class="input-field w-full" placeholder="Testing notes">
    <label class="block text-sm text-muted mb-1 mt-3">Content</label>
    <textarea id="modal-note-content" class="input-field w-full" rows="8"></textarea>
  `, async () => {
    const title = document.getElementById("modal-note-title").value.trim();
    if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api(`/projects/${state.selectedProjectId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content: document.getElementById("modal-note-content").value }) });
      closeModal();
      loadProjectNotes();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  }, "Create");
}

function openEditNoteModal(noteId) {
  const note = state.projectNotes.find((n) => n.id === noteId);
  if (!note) return;
  openModal("Edit Note", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-note-title" class="input-field w-full" value="${escapeHtml(note.title)}">
    <label class="block text-sm text-muted mb-1 mt-3">Content</label>
    <textarea id="modal-note-content" class="input-field w-full" rows="8">${escapeHtml(note.content || "")}</textarea>
  `, async () => {
    const title = document.getElementById("modal-note-title").value.trim();
    if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api(`/notes/${noteId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content: document.getElementById("modal-note-content").value, orderIndex: note.orderIndex }) });
      closeModal();
      loadProjectNotes();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  });
}

function openCreateCommentModal() {
  const findingOptions = state.projectFindings.map((f) => `<option value="finding:${escapeHtml(f.id)}">Finding: ${escapeHtml(f.title)}</option>`).join("");
  const sectionOptions = state.projectSections.map((s) => `<option value="section:${escapeHtml(s.id)}">Section: ${escapeHtml(s.title)}</option>`).join("");
  const noteOptions = state.projectNotes.map((n) => `<option value="note:${escapeHtml(n.id)}">Note: ${escapeHtml(n.title)}</option>`).join("");
  openModal("New Comment", `
    <label class="block text-sm text-muted mb-1">Target</label>
    <select id="modal-comment-target" class="input-field w-full">
      <option value="project:${escapeHtml(state.selectedProjectId)}">Project</option>
      ${findingOptions}${sectionOptions}${noteOptions}
    </select>
    <label class="block text-sm text-muted mb-1 mt-3">Comment *</label>
    <textarea id="modal-comment-content" class="input-field w-full" rows="5"></textarea>
  `, async () => {
    const content = document.getElementById("modal-comment-content").value.trim();
    if (!content) { await showAlertModal({ title: "Validation", message: "Comment is required." }); return; }
    const [targetType, targetId] = document.getElementById("modal-comment-target").value.split(":");
    try {
      await api(`/projects/${state.selectedProjectId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, content }) });
      closeModal();
      loadProjectComments();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  }, "Comment");
}

function openCreateDesignModal() {
  openModal("New Design", `
    <label class="block text-sm text-muted mb-1">Name *</label>
    <input type="text" id="modal-design-name" class="input-field w-full" placeholder="External Pentest Report">
    <label class="block text-sm text-muted mb-1 mt-3">Report Type</label>
    <select id="modal-design-type" class="input-field w-full">${VALID_REPORT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
    <label class="block text-sm text-muted mb-1 mt-3">Description</label>
    <textarea id="modal-design-desc" class="input-field w-full" rows="3" placeholder="Description of this report design..."></textarea>
  `, saveNewDesign, "Create");
}

async function saveNewDesign() {
  const name = document.getElementById("modal-design-name").value.trim();
  if (!name) { await showAlertModal({ title: "Validation", message: "Name is required." }); return; }
  try {
    const created = await api("/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, reportType: document.getElementById("modal-design-type").value, description: document.getElementById("modal-design-desc").value.trim(), findingFieldDefinitions: defaultFindingFields(), sectionDefinitions: defaultSectionDefinitions() }) });
    closeModal();
    state.designs = await api("/designs");
    openDesignEditor(created.id);
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

function openCreateTemplateModal() {
  openModal("New Finding Template", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-tpl-title" class="input-field w-full" placeholder="SQL Injection">
    <label class="block text-sm text-muted mb-1 mt-3">Category</label>
    <input type="text" id="modal-tpl-category" class="input-field w-full" placeholder="Injection">
    <label class="block text-sm text-muted mb-1 mt-3">Severity</label>
    <select id="modal-tpl-severity" class="input-field w-full">${VALID_SEVERITIES.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
    <label class="block text-sm text-muted mb-1 mt-3">CVSS Vector</label>
    <div class="reporter-cvss-row">
      <input type="text" id="modal-tpl-cvss" class="input-field w-full" placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H">
      <button type="button" id="modal-tpl-cvss-builder" class="btn-secondary text-sm">CVSS Editor</button>
    </div>
    <div id="modal-tpl-cvss-score" class="text-sm text-muted mt-1"></div>
    <div id="modal-tpl-cvss-builder-panel" class="reporter-inline-cvss-builder hidden mt-3"></div>
    <label class="block text-sm text-muted mb-1 mt-3">Tags (comma separated)</label>
    <input type="text" id="modal-tpl-tags" class="input-field w-full" placeholder="owasp, injection, web">
    <label class="block text-sm text-muted mb-1 mt-3">Description</label>
    <textarea id="modal-tpl-description" class="input-field w-full" rows="3"></textarea>
    <label class="block text-sm text-muted mb-1 mt-3">Remediation</label>
    <textarea id="modal-tpl-remediation" class="input-field w-full" rows="3"></textarea>
    <label class="block text-sm text-muted mb-1 mt-3">References</label>
    <textarea id="modal-tpl-references" class="input-field w-full" rows="3"></textarea>
  `, saveNewTemplate, "Create");
  const cvssInput = document.getElementById("modal-tpl-cvss");
  const scoreEl = document.getElementById("modal-tpl-cvss-score");
  const sevSelect = document.getElementById("modal-tpl-severity");
  document.getElementById("modal-tpl-cvss-builder")?.addEventListener("click", () => openInlineCvssBuilder("modal-tpl-cvss-builder-panel", "modal-tpl-cvss", "modal-tpl-cvss-score", "modal-tpl-severity"));
  cvssInput?.addEventListener("input", () => updateCvssScoreDisplay(cvssInput, scoreEl, sevSelect));
}

async function saveNewTemplate() {
  const title = document.getElementById("modal-tpl-title").value.trim();
  if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
  const fields = [];
  const desc = document.getElementById("modal-tpl-description").value.trim();
  const rem = document.getElementById("modal-tpl-remediation").value.trim();
  const refs = document.getElementById("modal-tpl-references").value.trim();
  if (desc) fields.push({ fieldName: "description", fieldValue: desc, language: "en" });
  if (rem) fields.push({ fieldName: "remediation", fieldValue: rem, language: "en" });
  if (refs) fields.push({ fieldName: "references", fieldValue: refs, language: "en" });
  try {
    const created = await api("/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, category: document.getElementById("modal-tpl-category").value.trim(), severity: document.getElementById("modal-tpl-severity").value, cvssVector: document.getElementById("modal-tpl-cvss").value.trim(), tags: document.getElementById("modal-tpl-tags").value.split(",").map((t) => t.trim()).filter(Boolean), fields }) });
    closeModal();
    state.templates = await api("/templates");
    openTemplateEditor(created.id);
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

function openCreateFindingModal() {
  const fieldDefs = getActiveFindingFieldDefinitions();
  openModal("New Finding", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-finding-title" class="input-field w-full" placeholder="SQL Injection in Login Form">
    <label class="block text-sm text-muted mb-1 mt-3">Category</label>
    <input type="text" id="modal-finding-category" class="input-field w-full" placeholder="Injection">
    <label class="block text-sm text-muted mb-1 mt-3">Severity</label>
    <select id="modal-finding-severity" class="input-field w-full">${VALID_SEVERITIES.map((s) => `<option value="${s}" ${s === "medium" ? "selected" : ""}>${s}</option>`).join("")}</select>
    <label class="block text-sm text-muted mb-1 mt-3">CVSS Vector</label>
    <div class="reporter-cvss-row">
      <input type="text" id="modal-finding-cvss" class="input-field w-full" placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H">
      <button type="button" id="modal-finding-cvss-builder" class="btn-secondary text-sm">CVSS Editor</button>
    </div>
    <div id="modal-finding-cvss-score" class="text-sm text-muted mt-1"></div>
    <div id="modal-finding-cvss-builder-panel" class="reporter-inline-cvss-builder hidden mt-3"></div>
    ${renderFindingFieldInputs("modal-finding-field", {}, fieldDefs)}
  `, async () => {
    const title = document.getElementById("modal-finding-title").value.trim();
    if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api(`/projects/${state.selectedProjectId}/findings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, category: document.getElementById("modal-finding-category").value.trim(), severity: document.getElementById("modal-finding-severity").value, cvssVector: document.getElementById("modal-finding-cvss").value.trim(), fields: readFindingFieldValues("modal-finding-field") }) });
      closeModal();
      await loadProjectFindings();
      renderTree();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  });
  const modalBody = document.getElementById("reporter-modal-body");
  if (modalBody) {
    bindMarkdownPreviews(modalBody);
    bindAffectedComponentPickers(modalBody);
  }
  const cvssInput = document.getElementById("modal-finding-cvss");
  const scoreEl = document.getElementById("modal-finding-cvss-score");
  const sevSelect = document.getElementById("modal-finding-severity");
  document.getElementById("modal-finding-cvss-builder")?.addEventListener("click", () => openInlineCvssBuilder("modal-finding-cvss-builder-panel", "modal-finding-cvss", "modal-finding-cvss-score", "modal-finding-severity"));
  cvssInput?.addEventListener("input", () => updateCvssScoreDisplay(cvssInput, scoreEl, sevSelect));
}

function openFromTemplateModal() {
  const templates = state.templates;
  if (!templates.length) { showAlertModal({ title: "No Templates", message: "Create finding templates first." }); return; }
  openModal("Add Finding from Template", `
    <label class="block text-sm text-muted mb-1">Search Templates</label>
    <input type="text" id="modal-template-search" class="input-field w-full" placeholder="Search title, category, tag, or severity">
    <div id="modal-template-list" class="reporter-template-picker-list"></div>
  `, closeModal, "Close");

  const listEl = document.getElementById("modal-template-list");
  const searchEl = document.getElementById("modal-template-search");
  const renderTemplateChoices = () => {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const filtered = templates.filter((t) => {
      const haystack = [
        t.title,
        t.category,
        t.severity,
        ...(Array.isArray(t.tags) ? t.tags : []),
      ].join(" ").toLowerCase();
      return !q || haystack.includes(q);
    });
    if (!listEl) return;
    listEl.innerHTML = filtered.length ? filtered.map((t) => `
      <button type="button" class="reporter-template-picker-item" data-template-choice="${safeAttr(t.id)}">
        <span>
          <span class="reporter-template-picker-title">${escapeHtml(t.title)}</span>
          <span class="reporter-template-picker-meta">${escapeHtml(t.category || "Uncategorised")} - ${escapeHtml(t.severity || "info")}${Array.isArray(t.tags) && t.tags.length ? ` - ${t.tags.map(escapeHtml).join(", ")}` : ""}</span>
        </span>
        ${severityBadge(t.severity || "info")}
      </button>
    `).join("") : `<p class="text-sm text-muted">No matching templates.</p>`;
    listEl.querySelectorAll("[data-template-choice]").forEach((btn) => {
      btn.addEventListener("click", () => createFindingFromTemplate(btn.dataset.templateChoice));
    });
  };
  searchEl?.addEventListener("input", renderTemplateChoices);
  renderTemplateChoices();
}

async function createFindingFromTemplate(templateId) {
  if (!templateId) return;
  try {
    await api(`/projects/${state.selectedProjectId}/findings/from-template/${templateId}`, { method: "POST" });
    closeModal();
    await loadProjectFindings();
    renderTree();
  } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
}

function openCreateSectionModal() {
  openModal("New Section", `
    <label class="block text-sm text-muted mb-1">Title *</label>
    <input type="text" id="modal-section-title" class="input-field w-full" placeholder="Executive Summary">
    <label class="block text-sm text-muted mb-1 mt-3">Type</label>
    <select id="modal-section-type" class="input-field w-full">${VALID_SECTION_TYPES.map((t) => `<option value="${t}">${t.replace(/_/g, " ")}</option>`).join("")}</select>
  `, async () => {
    const title = document.getElementById("modal-section-title").value.trim();
    if (!title) { await showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api(`/projects/${state.selectedProjectId}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, sectionType: document.getElementById("modal-section-type").value }) });
      closeModal();
      await loadProjectSections();
      renderTree();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  });
}

async function openAddMemberModal() {
  let users;
  try { users = await api("/users"); } catch { users = []; }
  const existingIds = new Set(state.projectMembers.map((m) => m.userId));
  const available = Array.isArray(users) ? users.filter((user) => !existingIds.has(user.id) && !user.suspended) : [];
  openModal("Add Member", `
    <label class="block text-sm text-muted mb-1">Select User</label>
    <select id="modal-member-user" class="input-field w-full">
      <option value="">Choose a user...</option>
      ${available.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username || user.email || user.id)}</option>`).join("")}
    </select>
    <label class="block text-sm text-muted mb-1 mt-3">Role</label>
    <select id="modal-member-role" class="input-field w-full">${VALID_MEMBER_ROLES.map((r) => `<option value="${r}">${r}</option>`).join("")}</select>
  `, async () => {
    const userId = document.getElementById("modal-member-user").value;
    if (!userId) { await showAlertModal({ title: "Validation", message: "Select a user." }); return; }
    try {
      await api(`/projects/${state.selectedProjectId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role: document.getElementById("modal-member-role").value }) });
      closeModal();
      state.projectMembers = await api(`/projects/${state.selectedProjectId}/members`);
      renderProjectMembers();
    } catch (err) { await showAlertModal({ title: "Error", message: err.message }); }
  });
}

// --- Defaults ---

function defaultFindingFields() {
  return [
    { name: "description", label: "Description", type: "markdown" },
    { name: "attack_scenario", label: "Attack Scenario", type: "markdown" },
    { name: "remediation", label: "Remediation", type: "markdown" },
    { name: "references", label: "References", type: "markdown" },
  ];
}

function defaultSectionDefinitions() {
  return [
    { id: "executive_summary", label: "Executive Summary" },
    { id: "scope", label: "Scope" },
    { id: "recommendations", label: "Recommendations" },
  ];
}

// --- Refresh ---

async function refreshProjects() {
  try { state.projects = await api("/projects"); } catch { /* keep existing */ }
}

// --- Dashboard Proposals ---

async function renderDashboardProposals() {
  try {
    const data = await api("/proposals?filter=active");
    const proposals = data.proposals || data || [];
    setText("reporter-dash-proposals", proposals.length);

    const inReview = state.projects.filter((p) => p.status === "in_review" && !p.isArchived).length;
    setText("reporter-dash-in-review", inReview);

    const propContainer = document.getElementById("reporter-dash-recent-proposals");
    if (!propContainer) return;
    if (!proposals.length) {
      propContainer.innerHTML = `<p class="text-sm text-muted">No proposals yet.</p>`;
      return;
    }
    propContainer.innerHTML = proposals.slice(0, 5).map((p) => `
      <div class="reporter-list-item" data-reporter-action="open-proposal" data-proposal-id="${escapeHtml(p.id)}">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(p.title)}</strong>
          <span class="text-sm text-muted ml-2">${escapeHtml(p.clientName || "")}</span>
        </div>
        <div class="flex items-center gap-2">
          ${statusBadge(p.status)}
          <span class="text-sm text-muted">${formatDateTime(p.updatedAt)}</span>
        </div>
      </div>
    `).join("");
    propContainer.querySelectorAll("[data-reporter-action='open-proposal']").forEach((el) => {
      el.addEventListener("click", () => window.ReporterProposals?.openProposal(el.dataset.proposalId));
    });
  } catch {
    setText("reporter-dash-proposals", 0);
  }
}

// --- Proposal Templates ---

function updatePtTabs() {
  document.querySelectorAll("[data-pt-tab]").forEach((btn) => {
    const isActive = btn.dataset.ptTab === state.ptTab;
    btn.className = `btn-${isActive ? "primary" : "secondary"} text-sm`;
  });
  const templatesPanel = document.getElementById("reporter-pt-templates-panel");
  const writeupsPanel = document.getElementById("reporter-pt-writeups-panel");
  const newPtBtn = document.getElementById("reporter-new-pt-btn");
  const newWriteupBtn = document.getElementById("reporter-new-writeup-btn");
  if (templatesPanel) templatesPanel.classList.toggle("hidden", state.ptTab !== "templates");
  if (writeupsPanel) writeupsPanel.classList.toggle("hidden", state.ptTab !== "writeups");
  if (newPtBtn) newPtBtn.classList.toggle("hidden", state.ptTab !== "templates" || !(state.capabilities.canManageTemplates || state.capabilities.canManageAll));
  if (newWriteupBtn) newWriteupBtn.classList.toggle("hidden", state.ptTab !== "writeups" || !(state.capabilities.canManageTemplates || state.capabilities.canManageAll));
}

async function renderProposalTemplatesView() {
  updatePtTabs();
  if (state.ptTab === "templates") renderProposalTemplatesList();
  else renderWriteupsList();
}

async function renderProposalTemplatesList() {
  const container = document.getElementById("reporter-pt-list");
  if (!container) return;
  try {
    const data = await api("/proposal-templates");
    state.proposalTemplates = data.templates || data || [];
  } catch {
    state.proposalTemplates = [];
  }
  if (!state.proposalTemplates.length) {
    container.innerHTML = `<p class="text-sm text-muted">No proposal templates yet.</p>`;
    return;
  }
  container.innerHTML = state.proposalTemplates.map((t) => `
    <div class="reporter-list-item" data-pt-action="open" data-pt-id="${escapeHtml(t.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="badge ${t.is_builtin ? "badge-blue" : "badge-gray"} ml-2">${t.is_builtin ? "Built-in" : "Custom"}</span>
        ${t.description ? `<span class="text-sm text-muted ml-2">${escapeHtml(t.description)}</span>` : ""}
      </div>
      <span class="text-sm text-muted">${formatDateTime(t.updatedAt || t.createdAt)}</span>
    </div>
  `).join("");
  container.querySelectorAll("[data-pt-action='open']").forEach((el) => {
    el.addEventListener("click", () => openProposalTemplateDetail(el.dataset.ptId));
  });
}

async function renderWriteupsList() {
  const container = document.getElementById("reporter-writeups-list");
  if (!container) return;
  try {
    const data = await api("/test-type-writeups");
    state.testTypeWriteups = data.writeups || data || [];
  } catch {
    state.testTypeWriteups = [];
  }
  if (!state.testTypeWriteups.length) {
    container.innerHTML = `<p class="text-sm text-muted">No test type write-ups yet.</p>`;
    return;
  }
  container.innerHTML = state.testTypeWriteups.map((w) => `
    <div class="reporter-list-item" data-writeup-action="open" data-writeup-id="${escapeHtml(w.id)}">
      <div class="reporter-list-item-main">
        <strong>${escapeHtml(w.name)}</strong>
        <span class="badge badge-blue ml-2">${escapeHtml(w.testType)}</span>
        <span class="badge ${w.is_builtin ? "badge-blue" : "badge-gray"} ml-1">${w.is_builtin ? "Built-in" : "Custom"}</span>
      </div>
      <span class="text-sm text-muted">${formatDateTime(w.updatedAt || w.createdAt)}</span>
    </div>
  `).join("");
  container.querySelectorAll("[data-writeup-action='open']").forEach((el) => {
    el.addEventListener("click", () => openWriteupDetail(el.dataset.writeupId));
  });
}

async function openProposalTemplateDetail(id) {
  try {
    const data = await api("/proposal-templates/" + id);
    state.selectedPt = data.template || data;
    state.selectedPtId = id;
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to load template: " + err.message });
    return;
  }
  const t = state.selectedPt;
  setText("reporter-pt-detail-title", t.name);
  const typeBadge = document.getElementById("reporter-pt-detail-type-badge");
  if (typeBadge) {
    typeBadge.textContent = t.is_builtin ? "Built-in" : "Custom";
    typeBadge.className = `badge ${t.is_builtin ? "badge-blue" : "badge-gray"}`;
  }
  const meta = document.getElementById("reporter-pt-detail-meta");
  if (meta) meta.textContent = t.description || "No description";

  const actionsEl = document.getElementById("reporter-pt-detail-actions");
  if (actionsEl) {
    let html = "";
    if (t.is_builtin) {
      html = `<button type="button" class="btn-secondary text-sm" id="reporter-pt-duplicate-btn">Duplicate</button>`;
    } else {
      html = `<button type="button" class="btn-secondary text-sm" id="reporter-pt-archive-btn">Archive</button>`;
    }
    actionsEl.innerHTML = html;
    document.getElementById("reporter-pt-duplicate-btn")?.addEventListener("click", () => duplicateProposalTemplate(id));
    document.getElementById("reporter-pt-archive-btn")?.addEventListener("click", () => archiveProposalTemplate(id));
  }

  const nameInput = document.getElementById("reporter-pt-edit-name");
  const descInput = document.getElementById("reporter-pt-edit-description");
  const htmlInput = document.getElementById("reporter-pt-edit-html");
  const cssInput = document.getElementById("reporter-pt-edit-css");
  if (nameInput) { nameInput.value = t.name || ""; nameInput.disabled = t.is_builtin; }
  if (descInput) { descInput.value = t.description || ""; descInput.disabled = t.is_builtin; }
  if (htmlInput) { htmlInput.value = t.html_template || ""; htmlInput.disabled = t.is_builtin; }
  if (cssInput) { cssInput.value = t.css_template || ""; cssInput.disabled = t.is_builtin; }

  const saveBtn = document.getElementById("reporter-pt-save-btn");
  if (saveBtn) saveBtn.disabled = !!t.is_builtin;

  renderPtSections(t.sections || []);
  setCurrentView("proposal-template-detail");
  updateProposalTemplatePreviewIframe();
}

function renderPtSections(sections) {
  const container = document.getElementById("reporter-pt-sections-list");
  if (!container) return;
  if (!sections.length) {
    container.innerHTML = `<p class="text-sm text-muted">No sections. Click Add Section to create one.</p>`;
    return;
  }
  container.innerHTML = sections.map((s, i) => `
    <div class="reporter-list-item">
      <div class="reporter-list-item-main">
        <span class="text-sm text-muted mr-2">${i + 1}.</span>
        <strong>${escapeHtml(s.title)}</strong>
        ${s.type ? `<span class="badge badge-gray ml-2">${escapeHtml(s.type)}</span>` : ""}
      </div>
      <div class="flex gap-1">
        <button type="button" class="btn-secondary text-sm" data-pt-section-action="edit" data-pt-section-id="${escapeHtml(s.id)}">Edit</button>
        <button type="button" class="btn-danger text-sm" data-pt-section-action="delete" data-pt-section-id="${escapeHtml(s.id)}">Delete</button>
      </div>
    </div>
  `).join("");
  container.querySelectorAll("[data-pt-section-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => editPtSection(btn.dataset.ptSectionId));
  });
  container.querySelectorAll("[data-pt-section-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => deletePtSection(btn.dataset.ptSectionId));
  });
}

function editPtSection(sectionId) {
  const section = (state.selectedPt?.sections || []).find((s) => s.id === sectionId);
  if (!section) return;
  const bodyHtml = `
      <div class="space-y-3">
        <div>
          <label class="block text-sm text-muted mb-1">Title</label>
          <input type="text" id="reporter-pt-modal-section-title" class="input-field w-full" value="${safeAttr(section.title)}">
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Type</label>
          <select id="reporter-pt-modal-section-type" class="input-field w-full">
            <option value="custom" ${section.type === "custom" ? "selected" : ""}>Custom</option>
            <option value="executive_summary" ${section.type === "executive_summary" ? "selected" : ""}>Executive Summary</option>
            <option value="scope" ${section.type === "scope" ? "selected" : ""}>Scope</option>
            <option value="methodology" ${section.type === "methodology" ? "selected" : ""}>Methodology</option>
            <option value="findings_overview" ${section.type === "findings_overview" ? "selected" : ""}>Findings Overview</option>
            <option value="recommendations" ${section.type === "recommendations" ? "selected" : ""}>Recommendations</option>
            <option value="appendix" ${section.type === "appendix" ? "selected" : ""}>Appendix</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Content (markdown)</label>
          <textarea id="reporter-pt-modal-section-content" class="input-field w-full" rows="10">${escapeHtml(section.content || "")}</textarea>
        </div>
      </div>
    `;
  window.ReporterModal?.open("Edit Section", bodyHtml, async () => {
    const title = document.getElementById("reporter-pt-modal-section-title")?.value?.trim();
    const type = document.getElementById("reporter-pt-modal-section-type")?.value;
    const content = document.getElementById("reporter-pt-modal-section-content")?.value || "";
    if (!title) { showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api("/proposal-template-sections/" + sectionId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type, content }),
      });
      document.getElementById("reporter-modal")?.classList.add("hidden");
      await openProposalTemplateDetail(state.selectedPtId);
    } catch (err) {
      showAlertModal({ title: "Error", message: err.message });
    }
  }, "Save");
}

async function deletePtSection(sectionId) {
  const confirmed = await showConfirmModal({ title: "Delete Section", message: "This cannot be undone.", danger: true });
  if (!confirmed) return;
  try {
    await api("/proposal-template-sections/" + sectionId, { method: "DELETE" });
    await openProposalTemplateDetail(state.selectedPtId);
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to delete section: " + err.message });
  }
}

async function addProposalTemplateSection() {
  const bodyHtml = `
      <div class="space-y-3">
        <div>
          <label class="block text-sm text-muted mb-1">Title</label>
          <input type="text" id="reporter-pt-modal-section-title" class="input-field w-full">
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Type</label>
          <select id="reporter-pt-modal-section-type" class="input-field w-full">
            <option value="custom">Custom</option>
            <option value="executive_summary">Executive Summary</option>
            <option value="scope">Scope</option>
            <option value="methodology">Methodology</option>
            <option value="findings_overview">Findings Overview</option>
            <option value="recommendations">Recommendations</option>
            <option value="appendix">Appendix</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Content (markdown)</label>
          <textarea id="reporter-pt-modal-section-content" class="input-field w-full" rows="10"></textarea>
        </div>
      </div>
    `;
  window.ReporterModal?.open("Add Section", bodyHtml, async () => {
    const title = document.getElementById("reporter-pt-modal-section-title")?.value?.trim();
    const type = document.getElementById("reporter-pt-modal-section-type")?.value;
    const content = document.getElementById("reporter-pt-modal-section-content")?.value || "";
    if (!title) { showAlertModal({ title: "Validation", message: "Title is required." }); return; }
    try {
      await api("/proposal-templates/" + state.selectedPtId + "/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type, content }),
      });
      document.getElementById("reporter-modal")?.classList.add("hidden");
      await openProposalTemplateDetail(state.selectedPtId);
    } catch (err) {
      showAlertModal({ title: "Error", message: err.message });
    }
  }, "Add");
}

async function saveProposalTemplateFull(options = {}) {
  const name = document.getElementById("reporter-pt-edit-name")?.value?.trim();
  const description = document.getElementById("reporter-pt-edit-description")?.value?.trim();
  const htmlTemplate = document.getElementById("reporter-pt-edit-html")?.value;
  const cssTemplate = document.getElementById("reporter-pt-edit-css")?.value;
  if (!name) { showAlertModal({ title: "Validation", message: "Name is required." }); return false; }
  try {
    await api("/proposal-templates/" + state.selectedPtId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, htmlTemplate, cssTemplate }),
    });
    await openProposalTemplateDetail(state.selectedPtId);
    return true;
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to save: " + err.message });
    return false;
  }
}

async function previewProposalTemplate() {
  const t = state.selectedPt;
  if (!t) return;
  if (!t.is_builtin && (state.capabilities.canManageTemplates || state.capabilities.canManageAll)) {
    const saved = await saveProposalTemplateFull({ quiet: true });
    if (!saved) return;
  }
  updateProposalTemplatePreviewIframe();
}

function updateProposalTemplatePreviewIframe() {
  const iframe = document.getElementById("reporter-pt-preview-iframe");
  const t = state.selectedPt;
  if (!iframe || !t) return;
  iframe.src = `/api/reporter/proposal-templates/${encodeURIComponent(t.id)}/preview.pdf?t=${Date.now()}`;
}

async function duplicateProposalTemplate(id) {
  try {
    await api("/proposal-templates/" + id + "/duplicate", { method: "POST" });
    setCurrentView("proposal-templates");
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to duplicate: " + err.message });
  }
}

async function archiveProposalTemplate(id) {
  const confirmed = await showConfirmModal({ title: "Archive Template", message: "It will no longer appear in the active list." });
  if (!confirmed) return;
  try {
    await api("/proposal-templates/" + id + "/archive", { method: "POST" });
    setCurrentView("proposal-templates");
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to archive: " + err.message });
  }
}

function openCreateProposalTemplateModal() {
  const bodyHtml = `
      <div class="space-y-3">
        <div>
          <label class="block text-sm text-muted mb-1">Name</label>
          <input type="text" id="reporter-pt-modal-name" class="input-field w-full">
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Description</label>
          <textarea id="reporter-pt-modal-description" class="input-field w-full" rows="3"></textarea>
        </div>
      </div>
    `;
  window.ReporterModal?.open("New Proposal Template", bodyHtml, async () => {
    const name = document.getElementById("reporter-pt-modal-name")?.value?.trim();
    const description = document.getElementById("reporter-pt-modal-description")?.value?.trim();
    if (!name) { showAlertModal({ title: "Validation", message: "Name is required." }); return; }
    try {
      const result = await api("/proposal-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      document.getElementById("reporter-modal")?.classList.add("hidden");
      const newId = result.template?.id || result.id;
      if (newId) openProposalTemplateDetail(newId);
      else setCurrentView("proposal-templates");
    } catch (err) {
      showAlertModal({ title: "Error", message: err.message });
    }
  }, "Create");
}

// --- Test Type Write-ups Detail ---

async function openWriteupDetail(id) {
  try {
    const data = await api("/test-type-writeups/" + id);
    state.selectedWriteup = data.writeup || data;
    state.selectedWriteupId = id;
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to load write-up: " + err.message });
    return;
  }
  const w = state.selectedWriteup;
  setText("reporter-writeup-detail-title", w.name);
  const typeBadge = document.getElementById("reporter-writeup-detail-type-badge");
  if (typeBadge) {
    typeBadge.textContent = w.is_builtin ? "Built-in" : "Custom";
    typeBadge.className = `badge ${w.is_builtin ? "badge-blue" : "badge-gray"}`;
  }
  const meta = document.getElementById("reporter-writeup-detail-meta");
  if (meta) meta.textContent = `Test Type: ${w.testType || "-"}`;

  const actionsEl = document.getElementById("reporter-writeup-detail-actions");
  if (actionsEl) {
    let html = "";
    if (w.is_builtin) {
      html = `<button type="button" class="btn-secondary text-sm" id="reporter-writeup-duplicate-btn">Duplicate</button>`;
    } else {
      html = `<button type="button" class="btn-secondary text-sm" id="reporter-writeup-archive-btn">Archive</button>`;
    }
    actionsEl.innerHTML = html;
    document.getElementById("reporter-writeup-duplicate-btn")?.addEventListener("click", () => duplicateWriteup(id));
    document.getElementById("reporter-writeup-archive-btn")?.addEventListener("click", () => archiveWriteup(id));
  }

  const typeInput = document.getElementById("reporter-writeup-edit-type");
  const nameInput = document.getElementById("reporter-writeup-edit-name");
  const methodInput = document.getElementById("reporter-writeup-edit-methodology");
  const scopeInput = document.getElementById("reporter-writeup-edit-scope");
  const delivInput = document.getElementById("reporter-writeup-edit-deliverables");
  if (typeInput) { typeInput.value = w.testType || ""; typeInput.disabled = w.is_builtin; }
  if (nameInput) { nameInput.value = w.name || ""; nameInput.disabled = w.is_builtin; }
  if (methodInput) { methodInput.value = w.methodology || ""; methodInput.disabled = w.is_builtin; }
  if (scopeInput) { scopeInput.value = w.scope || ""; scopeInput.disabled = w.is_builtin; }
  if (delivInput) { delivInput.value = w.deliverables || ""; delivInput.disabled = w.is_builtin; }

  setCurrentView("writeup-detail");
}

async function saveWriteupDetail() {
  const w = state.selectedWriteup;
  if (w?.is_builtin) { showAlertModal({ title: "Not Allowed", message: "Built-in write-ups cannot be edited." }); return; }
  const testType = document.getElementById("reporter-writeup-edit-type")?.value?.trim();
  const name = document.getElementById("reporter-writeup-edit-name")?.value?.trim();
  const methodology = document.getElementById("reporter-writeup-edit-methodology")?.value || "";
  const scope = document.getElementById("reporter-writeup-edit-scope")?.value || "";
  const deliverables = document.getElementById("reporter-writeup-edit-deliverables")?.value || "";
  if (!testType || !name) { showAlertModal({ title: "Validation", message: "Test type and name are required." }); return; }
  try {
    await api("/test-type-writeups/" + state.selectedWriteupId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testType, name, methodology, scope, deliverables }),
    });
    await openWriteupDetail(state.selectedWriteupId);
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to save: " + err.message });
  }
}

async function duplicateWriteup(id) {
  try {
    await api("/test-type-writeups/" + id + "/duplicate", { method: "POST" });
    setCurrentView("proposal-templates");
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to duplicate: " + err.message });
  }
}

async function archiveWriteup(id) {
  const confirmed = await showConfirmModal({ title: "Archive Write-up", message: "It will no longer appear in the active list." });
  if (!confirmed) return;
  try {
    await api("/test-type-writeups/" + id + "/archive", { method: "POST" });
    setCurrentView("proposal-templates");
  } catch (err) {
    showAlertModal({ title: "Error", message: "Failed to archive: " + err.message });
  }
}

function openCreateWriteupModal() {
  const bodyHtml = `
      <div class="space-y-3">
        <div>
          <label class="block text-sm text-muted mb-1">Test Type</label>
          <input type="text" id="reporter-writeup-modal-type" class="input-field w-full" placeholder="e.g. webapp, internal, external">
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Name</label>
          <input type="text" id="reporter-writeup-modal-name" class="input-field w-full">
        </div>
      </div>
    `;
  window.ReporterModal?.open("New Test Type Write-up", bodyHtml, async () => {
    const testType = document.getElementById("reporter-writeup-modal-type")?.value?.trim();
    const name = document.getElementById("reporter-writeup-modal-name")?.value?.trim();
    if (!testType || !name) { showAlertModal({ title: "Validation", message: "Test type and name are required." }); return; }
    try {
      const result = await api("/test-type-writeups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testType, name }),
      });
      document.getElementById("reporter-modal")?.classList.add("hidden");
      const newId = result.writeup?.id || result.id;
      if (newId) openWriteupDetail(newId);
      else setCurrentView("proposal-templates");
    } catch (err) {
      showAlertModal({ title: "Error", message: err.message });
    }
  }, "Create");
}

// --- Boot ---

init();
