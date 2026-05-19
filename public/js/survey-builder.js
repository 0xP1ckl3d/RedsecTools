import { showConfirmModal, showAlertModal } from "./confirm-modal.js";
import { escapeHtml, stateBlock } from "./ui-components.js";

// RedSecTools — Survey Builder

const QUESTION_TYPES = [
  { value: "short_text", label: "Short Text" },
  { value: "long_text", label: "Long Text" },
  { value: "single_choice", label: "Single Choice" },
  { value: "multi_choice", label: "Multiple Choice" },
  { value: "rating", label: "Rating (1-10)" },
  { value: "yes_no", label: "Yes / No" },
  { value: "dropdown", label: "Dropdown" },
];

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ============================================================
// State
// ============================================================

const state = {
  surveys: [],
  currentFilter: "all",
  selectedSurveyId: "",
  selectedSurvey: null,
  questions: [],
  dirty: false,
  // Time picker state
  activeTimeFieldId: null,
  activeTimeView: "hour",
  pendingTimeValue: null,
};

function getEffectiveSurveyStatus(survey, now = Math.floor(Date.now() / 1000)) {
  if (!survey) return "draft";
  if (survey.status === "published" && survey.endsAt && survey.endsAt <= now) {
    return "ended";
  }
  return survey.status || "draft";
}

function isSelectedSurveyReadOnly() {
  return getEffectiveSurveyStatus(state.selectedSurvey) === "closed";
}

function upsertSurveyInState(survey) {
  if (!survey) return;
  const index = state.surveys.findIndex((item) => item.id === survey.id);
  if (index === -1) {
    state.surveys.unshift({ ...survey });
    return;
  }
  state.surveys[index] = { ...state.surveys[index], ...survey };
}

function getFilteredSurveys() {
  if (state.currentFilter === "all") return state.surveys;
  return state.surveys.filter((survey) => {
    const status = getEffectiveSurveyStatus(survey);
    if (state.currentFilter === "closed") {
      return status === "ended" || status === "closed";
    }
    return status === state.currentFilter;
  });
}

async function refreshSelectedSurveyFromServer() {
  if (!state.selectedSurveyId) return null;
  const data = await fetchJson("/api/survey/" + state.selectedSurveyId);
  state.selectedSurvey = data.survey;
  state.questions = data.questions || [];
  upsertSurveyInState(data.survey);
  return data;
}

function renderSurveyPanels({ builder = true, meta = true, list = true, stats = true } = {}) {
  if (builder) renderBuilder();
  if (meta) renderMetaPanel();
  if (list) renderSurveyList();
  if (stats) updateSidebarStats();
}

function refreshTimeSensitiveSurveyUi() {
  const hasTimedSurvey = state.surveys.some((survey) => survey.endsAt && ["published", "ended"].includes(getEffectiveSurveyStatus(survey)));
  if (!hasTimedSurvey && !(state.selectedSurvey && state.selectedSurvey.endsAt)) return;
  renderSurveyPanels({ builder: false, meta: true, list: true, stats: true });
}

// ============================================================
// Survey List
// ============================================================

async function loadSurveyList() {
  try {
    const data = await fetchJson("/api/survey/list");
    state.surveys = data.surveys || [];
    renderSurveyList();
    updateSidebarStats();
  } catch (err) {
    document.getElementById("survey-list-body").textContent = err.message;
  }
}

function renderSurveyList() {
  const body = document.getElementById("survey-list-body");
  const filtered = getFilteredSurveys();

  if (filtered.length === 0) {
    body.innerHTML = stateBlock("No surveys found.");
    return;
  }

  // Group by status
  const groups = { published: [], draft: [], ended: [], closed: [] };
  for (const s of filtered) {
    const key = getEffectiveSurveyStatus(s);
    groups[key].push(s);
  }

  let html = "";
  const labels = { published: "Active", draft: "Drafts", ended: "Ended", closed: "Closed" };

  if (state.currentFilter === "all") {
    for (const [key, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      html += '<div class="wiki-sidebar-kicker survey-list-group-label">' + labels[key] + "</div>";
      html += items.map(renderSurveyListItem).join("");
    }
  } else {
    html += filtered.map(renderSurveyListItem).join("");
  }

  body.innerHTML = html;

  body.querySelectorAll(".survey-list-item").forEach((el) => {
    el.addEventListener("click", () => selectSurvey(el.dataset.id));
  });
}

function renderSurveyListItem(s) {
  const active = s.id === state.selectedSurveyId ? " active" : "";
  const badge = renderStatusBadge(getEffectiveSurveyStatus(s));
  return (
    '<button type="button" class="survey-list-item' + active + '" data-id="' + escapeHtml(s.id) + '">' +
      '<span class="survey-list-item-title">' + escapeHtml(s.title) + '</span>' +
      '<span class="survey-list-item-meta">' + badge + '</span>' +
    "</button>"
  );
}

function renderStatusBadge(status) {
  const normalized = status === "published" || status === "draft" || status === "ended" ? status : "closed";
  const cls = "status-" + normalized;
  const label = normalized === "published"
    ? "Active"
    : normalized === "draft"
      ? "Draft"
      : normalized === "ended"
        ? "Ended"
        : "Closed";
  return '<span class="survey-status-badge ' + cls + '">' + label + "</span>";
}

function updateSidebarStats() {
  const total = state.surveys.length;
  const active = state.surveys.filter((s) => getEffectiveSurveyStatus(s) === "published").length;
  const el = (id) => document.getElementById(id);
  if (el("survey-stat-total")) el("survey-stat-total").textContent = total;
  if (el("survey-stat-active")) el("survey-stat-active").textContent = active;
}

// ============================================================
// View Filtering
// ============================================================

function setCurrentView(view) {
  state.currentFilter = view;

  document.querySelectorAll("[data-survey-view]").forEach((btn) => {
    const isActive = btn.dataset.surveyView === view;
    btn.classList.toggle("active", isActive);
  });

  const isAbout = view === "about";
  const aboutSection = document.getElementById("survey-view-about");
  if (aboutSection) aboutSection.classList.toggle("hidden", !isAbout);

  const toolbarCard = document.querySelector(".wiki-toolbar-card");
  const mainGrid = document.querySelector(".wiki-main-grid");
  if (toolbarCard) toolbarCard.classList.toggle("hidden", isAbout);
  if (mainGrid) mainGrid.classList.toggle("hidden", isAbout);

  if (isAbout) return;

  const labels = { all: "All Surveys", published: "Active Surveys", draft: "Draft Surveys", closed: "Ended & Closed Surveys" };
  const descs = {
    all: "Create, edit, and publish surveys with tokenized response links.",
    published: "Surveys currently accepting responses.",
    draft: "Surveys in progress. Edit and publish when ready.",
    closed: "Surveys that have expired, ended, or been manually closed.",
  };
  const kicker = document.getElementById("survey-toolbar-kicker");
  const heading = document.getElementById("survey-toolbar-heading");
  const desc = document.getElementById("survey-toolbar-description");
  if (kicker) kicker.textContent = "Survey Builder";
  if (heading) heading.textContent = labels[view] || "All Surveys";
  if (desc) desc.textContent = descs[view] || "";

  renderSurveyList();
}

// ============================================================
// Select & Load Survey
// ============================================================

async function selectSurvey(id) {
  if (state.dirty) {
    const ok = await showConfirmModal({ title: "Unsaved Changes", message: "You have unsaved changes. Discard them?", confirmLabel: "Discard", danger: true });
    if (!ok) return;
  }
  state.selectedSurveyId = id;
  state.dirty = false;

  try {
    const data = await fetchJson("/api/survey/" + id);
    state.selectedSurvey = data.survey;
    state.questions = data.questions || [];
    upsertSurveyInState(data.survey);
    renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    syncUrl();
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

// ============================================================
// Builder — Center Column
// ============================================================

function renderBuilder() {
  const body = document.getElementById("survey-builder-body");
  const title = document.getElementById("survey-builder-title");
  const subtitle = document.getElementById("survey-builder-subtitle");
  const resultsBtn = document.getElementById("survey-results-btn");

  if (!state.selectedSurvey) {
    title.textContent = "Select a survey";
    subtitle.textContent = "Choose a survey from the list or create a new one.";
    body.innerHTML = stateBlock("No survey selected.");
    if (resultsBtn) resultsBtn.classList.add("hidden");
    return;
  }

  const s = state.selectedSurvey;
  const isReadOnly = isSelectedSurveyReadOnly();
  title.textContent = s.title || "Untitled Survey";
  subtitle.textContent = isReadOnly
    ? "This survey is closed and read-only. Clone it from the settings panel to make changes."
    : (s.description || "Edit your survey below.");
  if (resultsBtn) resultsBtn.classList.remove("hidden");

  let html = "";

  // Title + description editors
  html += '<div class="grid gap-3">';
  html += '<input id="builder-title" class="input-field" placeholder="Survey title" value="' + escapeHtml(s.title) + '"' + (isReadOnly ? " disabled" : "") + '>';
  html += '<textarea id="builder-description" class="input-field survey-builder-description" placeholder="Description (optional)"' + (isReadOnly ? " disabled" : "") + '>' + escapeHtml(s.description) + '</textarea>';
  html += "</div>";

  // Questions
  html += '<div id="builder-questions" class="grid gap-3">';
  state.questions.forEach((q, i) => {
    html += renderQuestionCard(q, i, isReadOnly);
  });
  html += "</div>";

  if (isReadOnly) {
    html += '<div class="survey-builder-readonly-note">Closed surveys cannot be edited. Clone this survey to create a new draft.</div>';
  } else {
    html += '<div class="survey-question-palette">';
    html += '<div class="survey-meta-label">Question Types</div>';
    html += '<div class="survey-add-question-grid">';
    QUESTION_TYPES.forEach((t) => {
      html += '<button type="button" class="survey-add-question-btn" data-qtype="' + t.value + '">' + escapeHtml(t.label) + "</button>";
    });
    html += "</div>";
    html += "</div>";

    // Save button
    html += '<div class="flex gap-2">';
    html += '<button type="button" id="builder-save-btn" class="btn-primary flex-1">Save Survey</button>';
    html += "</div>";
    html += '<p id="builder-msg" class="text-sm hidden"></p>';
  }

  body.innerHTML = html;

  // Attach handlers
  attachBuilderHandlers();
}

function renderQuestionCard(q, index, isReadOnly) {
  const hasOptions = ["single_choice", "multi_choice", "dropdown"].includes(q.questionType);

  let optionsHtml = "";
  if (hasOptions) {
    optionsHtml = '<div class="survey-question-options">';
    (q.options || []).forEach((opt, oi) => {
      optionsHtml += '<div class="survey-question-option-row">';
      optionsHtml += '<input class="input-field" data-option-index="' + oi + '" value="' + escapeHtml(opt) + '" placeholder="Option ' + (oi + 1) + '"' + (isReadOnly ? " disabled" : "") + '>';
      if (!isReadOnly) {
        optionsHtml += '<button type="button" data-remove-option="' + oi + '" title="Remove">&times;</button>';
      }
      optionsHtml += "</div>";
    });
    if (!isReadOnly) {
      optionsHtml += '<button type="button" class="btn-secondary text-xs" data-add-option>Add Option</button>';
    }
    optionsHtml += "</div>";
  }

  return (
    '<div class="survey-question-card' + (isReadOnly ? " survey-question-card-readonly" : "") + '" draggable="' + (isReadOnly ? "false" : "true") + '" data-question-id="' + escapeHtml(q.id) + '" data-question-index="' + index + '">' +
      '<div class="survey-question-header">' +
        '<span class="text-xs text-muted font-semibold">Q' + (index + 1) + "</span>" +
        '<label class="survey-question-required-toggle"><input type="checkbox" data-required' + (q.isRequired ? " checked" : "") + (isReadOnly ? " disabled" : "") + "> Required</label>" +
        (!isReadOnly ? '<button type="button" class="survey-question-delete" data-delete-question title="Remove question">&times;</button>' : "") +
      "</div>" +
      '<div class="survey-question-content">' +
        '<input class="input-field" data-question-text placeholder="Question text" value="' + escapeHtml(q.questionText) + '"' + (isReadOnly ? " disabled" : "") + '>' +
        '<select class="input-field" data-question-type' + (isReadOnly ? " disabled" : "") + '>' +
          QUESTION_TYPES.map((t) => '<option value="' + t.value + '"' + (t.value === q.questionType ? " selected" : "") + ">" + escapeHtml(t.label) + "</option>").join("") +
        "</select>" +
        optionsHtml +
      "</div>" +
    "</div>"
  );
}

function attachBuilderHandlers() {
  const body = document.getElementById("survey-builder-body");
  const isReadOnly = isSelectedSurveyReadOnly();

  // Title/description changes
  const titleInput = document.getElementById("builder-title");
  const descInput = document.getElementById("builder-description");
  if (titleInput && !isReadOnly) titleInput.addEventListener("input", () => { state.dirty = true; });
  if (descInput && !isReadOnly) descInput.addEventListener("input", () => { state.dirty = true; });

  // Save button
  const saveBtn = document.getElementById("builder-save-btn");
  if (saveBtn && !isReadOnly) saveBtn.addEventListener("click", saveSurvey);

  if (!isReadOnly) {
    body.querySelectorAll("button[data-qtype]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addQuestion(btn.dataset.qtype);
      });
    });
  }

  // Question card handlers
  const questionsEl = document.getElementById("builder-questions");
  if (!questionsEl) return;
  if (isReadOnly) return;

  // Question text, type, required changes
  questionsEl.addEventListener("input", (e) => {
    const card = e.target.closest(".survey-question-card");
    if (!card) return;
    state.dirty = true;
    const idx = parseInt(card.dataset.questionIndex, 10);
    if (e.target.dataset.questionText !== undefined) {
      state.questions[idx].questionText = e.target.value;
    } else if (e.target.dataset.optionIndex !== undefined) {
      const oi = parseInt(e.target.dataset.optionIndex, 10);
      state.questions[idx].options[oi] = e.target.value;
    }
  });

  questionsEl.addEventListener("change", (e) => {
    const card = e.target.closest(".survey-question-card");
    if (!card) return;
    state.dirty = true;
    const idx = parseInt(card.dataset.questionIndex, 10);
    if (e.target.dataset.questionType !== undefined) {
      const newType = e.target.value;
      state.questions[idx].questionType = newType;
      // Initialize options if switching to a choice type
      if (["single_choice", "multi_choice", "dropdown"].includes(newType) && !state.questions[idx].options) {
        state.questions[idx].options = ["Option 1", "Option 2"];
      }
      renderBuilder(); // re-render to show/hide options
    } else if (e.target.dataset.required !== undefined) {
      state.questions[idx].isRequired = e.target.checked;
    }
  });

  // Delete question
  questionsEl.addEventListener("click", async (e) => {
    if (e.target.dataset.deleteQuestion !== undefined) {
      const card = e.target.closest(".survey-question-card");
      if (!card) return;
      if (!await showConfirmModal({ title: "Remove Question", message: "Delete this question?", confirmLabel: "Delete", danger: true })) return;
      const idx = parseInt(card.dataset.questionIndex, 10);
      state.questions.splice(idx, 1);
      state.dirty = true;
      renderBuilder();
    }

    // Add option
    if (e.target.dataset.addOption !== undefined) {
      const card = e.target.closest(".survey-question-card");
      if (!card) return;
      const idx = parseInt(card.dataset.questionIndex, 10);
      if (!state.questions[idx].options) state.questions[idx].options = [];
      state.questions[idx].options.push("Option " + (state.questions[idx].options.length + 1));
      state.dirty = true;
      renderBuilder();
    }

    // Remove option
    if (e.target.dataset.removeOption !== undefined) {
      const card = e.target.closest(".survey-question-card");
      if (!card) return;
      const idx = parseInt(card.dataset.questionIndex, 10);
      const oi = parseInt(e.target.dataset.removeOption, 10);
      state.questions[idx].options.splice(oi, 1);
      state.dirty = true;
      renderBuilder();
    }
  });

  // Drag-to-reorder
  setupDragReorder(questionsEl);
}

// ============================================================
// Drag Reorder
// ============================================================

let draggedQuestionId = null;

function setupDragReorder(container) {
  container.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".survey-question-card");
    if (!card) return;
    draggedQuestionId = card.dataset.questionId;
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("survey-question-dragging");
  });

  container.addEventListener("dragend", (e) => {
    const card = e.target.closest(".survey-question-card");
    if (card) card.classList.remove("survey-question-dragging");
    draggedQuestionId = null;
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  container.addEventListener("drop", async (e) => {
    e.preventDefault();
    const target = e.target.closest(".survey-question-card");
    if (!target || !draggedQuestionId) return;
    const targetId = target.dataset.questionId;
    if (draggedQuestionId === targetId) return;

    const draggedIdx = state.questions.findIndex((q) => q.id === draggedQuestionId);
    const targetIdx = state.questions.findIndex((q) => q.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [moved] = state.questions.splice(draggedIdx, 1);
    state.questions.splice(targetIdx, 0, moved);
    state.dirty = true;

    renderBuilder();

    // Save reorder to server
    try {
      await fetchJson("/api/survey/" + state.selectedSurveyId + "/questions/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: state.questions.map((q) => q.id) }),
      });
    } catch {}
  });
}

// ============================================================
// Add Question
// ============================================================

function addQuestion(type) {
  const q = {
    id: "new_" + Math.random().toString(36).slice(2, 10),
    questionText: "",
    questionType: type,
    isRequired: false,
    sortOrder: state.questions.length,
    options: ["single_choice", "multi_choice", "dropdown"].includes(type) ? ["Option 1", "Option 2"] : [],
  };
  state.questions.push(q);
  state.dirty = true;
  renderBuilder();

  // Focus the new question's text input
  const cards = document.querySelectorAll(".survey-question-card");
  const last = cards[cards.length - 1];
  if (last) {
    const input = last.querySelector("[data-question-text]");
    if (input) input.focus();
  }
}

// ============================================================
// Save Survey
// ============================================================

async function saveSurvey() {
  if (!state.selectedSurveyId) return;
  if (isSelectedSurveyReadOnly()) {
    await showAlertModal({ title: "Survey Closed", message: "Closed surveys are read-only. Clone the survey to make changes." });
    return;
  }

  const saveBtn = document.getElementById("builder-save-btn");
  const msg = document.getElementById("builder-msg");
  if (saveBtn) saveBtn.disabled = true;
  if (msg) msg.classList.add("hidden");

  const title = document.getElementById("builder-title")?.value.trim();
  const description = document.getElementById("builder-description")?.value.trim();

  if (!title) {
    if (msg) {
      msg.textContent = "Title is required";
      msg.className = "text-sm text-error";
      msg.classList.remove("hidden");
    }
    if (saveBtn) saveBtn.disabled = false;
    return;
  }

  const questions = state.questions.map((q, i) => ({
    id: q.id.startsWith("new_") ? undefined : q.id,
    questionText: q.questionText,
    questionType: q.questionType,
    isRequired: q.isRequired,
    sortOrder: i,
    options: q.options || [],
  }));

  try {
    await fetchJson("/api/survey/" + state.selectedSurveyId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        questions,
      }),
    });

    await refreshSelectedSurveyFromServer();
    state.dirty = false;
    renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    const refreshedMsg = document.getElementById("builder-msg");
    if (refreshedMsg) {
      refreshedMsg.textContent = "Survey saved";
      refreshedMsg.className = "text-sm text-accent";
      refreshedMsg.classList.remove("hidden");
    }
  } catch (err) {
    if (msg) {
      msg.textContent = err.message;
      msg.className = "text-sm text-error";
      msg.classList.remove("hidden");
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ============================================================
// Create New Survey
// ============================================================

async function createNewSurvey() {
  try {
    const data = await fetchJson("/api/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Untitled Survey",
        description: "",
        responseMode: "anonymous_public",
        status: "draft",
        questions: [],
      }),
    });
    await loadSurveyList();
    await selectSurvey(data.id);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

async function cloneSelectedSurvey() {
  if (!state.selectedSurvey) return;

  const source = state.selectedSurvey;
  const copyTitleBase = (source.title || "Untitled Survey").trim() || "Untitled Survey";
  const questions = state.questions.map((q, index) => ({
    questionText: q.questionText,
    questionType: q.questionType,
    isRequired: !!q.isRequired,
    sortOrder: index,
    options: Array.isArray(q.options) ? [...q.options] : [],
  }));

  try {
    const data = await fetchJson("/api/survey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: (copyTitleBase + " (Copy)").slice(0, 160),
        description: source.description || "",
        responseMode: source.responseMode || "anonymous_public",
        status: "draft",
        startsAt: null,
        endsAt: null,
        questions,
      }),
    });
    await loadSurveyList();
    await selectSurvey(data.id);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

// ============================================================
// Meta Panel — Right Column
// ============================================================

function renderMetaPanel() {
  const body = document.getElementById("survey-meta-body");

  if (!state.selectedSurvey) {
    body.innerHTML = stateBlock("Select a survey to see settings.");
    return;
  }

  const s = state.selectedSurvey;
  const effectiveStatus = getEffectiveSurveyStatus(s);
  const isPublished = effectiveStatus === "published";
  const isDraft = effectiveStatus === "draft";
  const isEnded = effectiveStatus === "ended";
  const isClosed = effectiveStatus === "closed";

  let html = "";

  // Status
  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Status</div>';
  html += renderStatusBadge(effectiveStatus);
  html += "</div>";

  // Response mode
  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Response Mode</div>';
  html += '<select id="meta-response-mode" class="input-field"' + (isClosed ? " disabled" : "") + '>';
  html += '<option value="anonymous_public"' + (s.responseMode === "anonymous_public" ? " selected" : "") + ">Anonymous Public</option>";
  html += '<option value="internal_named"' + (s.responseMode === "internal_named" ? " selected" : "") + ">Named Internal</option>";
  html += '<option value="public_named"' + (s.responseMode === "public_named" ? " selected" : "") + ">Named Public</option>";
  html += "</select>";
  html += "</div>";

  // Timeline
  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Starts</div>';
  html += '<div class="grid gap-2 survey-meta-timeline-grid">';
  html += '<input id="meta-starts-date" type="date" class="input-field" value="' + formatDateInput(s.startsAt) + '"' + (isClosed ? " disabled" : "") + '>';
  html += '<button type="button" id="meta-starts-time" class="input-field bulletin-time-trigger" data-time-label="Start Time" data-hour24="' + getHour24(s.startsAt) + '" data-minute="' + getMinute(s.startsAt) + '"' + (isClosed ? " disabled" : "") + '>' + formatTimeDisplay(s.startsAt) + '</button>';
  html += "</div>";
  html += "</div>";

  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Ends</div>';
  html += '<div class="grid gap-2 survey-meta-timeline-grid">';
  html += '<input id="meta-ends-date" type="date" class="input-field" value="' + formatDateInput(s.endsAt) + '"' + (isClosed ? " disabled" : "") + '>';
  html += '<button type="button" id="meta-ends-time" class="input-field bulletin-time-trigger" data-time-label="End Time" data-hour24="' + getHour24(s.endsAt) + '" data-minute="' + getMinute(s.endsAt) + '"' + (isClosed ? " disabled" : "") + '>' + formatTimeDisplay(s.endsAt) + '</button>';
  html += "</div>";
  html += "</div>";

  // Public link
  if (s.publicToken) {
    html += '<div class="survey-meta-section">';
    html += '<div class="survey-meta-label">Response Link</div>';
    html += '<div class="flex gap-2">';
    html += '<input id="meta-public-url" class="input-field" value="' + escapeHtml(window.location.origin + "/survey/r/" + s.publicToken) + '" readonly>';
    html += '<button type="button" id="meta-copy-link" class="btn-secondary text-xs">Copy</button>';
    html += "</div>";
    html += "</div>";
  }

  // Stats
  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Info</div>';
  html += '<div class="text-xs text-muted survey-meta-info">';
  html += '<div>Created: ' + formatDate(s.createdAt) + "</div>";
  html += '<div>Updated: ' + formatDate(s.updatedAt) + "</div>";
  html += '<div>Questions: ' + state.questions.length + "</div>";
  html += "</div>";
  html += "</div>";

  // Actions
  html += '<div class="survey-meta-section">';
  html += '<div class="survey-meta-label">Actions</div>';
  html += '<div class="grid gap-2">';
  if (isDraft) {
    html += '<button type="button" id="meta-publish-btn" class="btn-primary">Publish Survey</button>';
  }
  if (isPublished) {
    html += '<button type="button" id="meta-end-early-btn" class="btn-secondary">End Early</button>';
    html += '<button type="button" id="meta-close-btn" class="btn-secondary">Close Survey</button>';
  }
  if (isEnded) {
    html += '<button type="button" id="meta-reopen-btn" class="btn-primary">Reopen Survey</button>';
    html += '<button type="button" id="meta-close-btn" class="btn-secondary">Close Survey</button>';
  }
  if (isClosed) {
    html += '<button type="button" id="meta-clone-btn" class="btn-primary">Clone Survey</button>';
  }
  html += '<button type="button" id="meta-delete-btn" class="btn-danger">Delete Survey</button>';
  html += "</div>";
  html += "</div>";

  // Countdown
  if (isPublished && s.endsAt) {
    const remaining = s.endsAt - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      const days = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      html += '<div class="survey-countdown">Closes in ' + days + "d " + hours + "h</div>";
    } else {
      html += '<div class="survey-countdown survey-countdown-closed">Ended</div>';
    }
  } else if (isEnded) {
    html += '<div class="survey-countdown survey-countdown-closed">Ended</div>';
  } else if (isClosed) {
    html += '<div class="survey-countdown survey-countdown-closed">Closed</div>';
  }

  body.innerHTML = html;
  attachMetaHandlers();
}

function attachMetaHandlers() {
  const isReadOnly = isSelectedSurveyReadOnly();

  // Response mode
  const modeEl = document.getElementById("meta-response-mode");
  if (modeEl && !isReadOnly) modeEl.addEventListener("change", async () => {
    state.dirty = true;
    try {
      const data = await fetchJson("/api/survey/" + state.selectedSurveyId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseMode: modeEl.value }),
      });
      state.selectedSurvey = data.survey;
      state.dirty = false;
      upsertSurveyInState(data.survey);
      renderSurveyPanels({ builder: false, meta: true, list: true, stats: true });
    } catch {}
  });

  // Date/time handlers
  ["starts", "ends"].forEach((field) => {
    const dateEl = document.getElementById("meta-" + field + "-date");
    if (dateEl && !isReadOnly) dateEl.addEventListener("change", () => saveTimeline());
  });

  // Copy link
  const copyBtn = document.getElementById("meta-copy-link");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    const input = document.getElementById("meta-public-url");
    if (input) {
      navigator.clipboard.writeText(input.value);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
    }
  });

  // Publish
  const publishBtn = document.getElementById("meta-publish-btn");
  if (publishBtn) publishBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "Publish Survey", message: "Publish this survey? A response link will be generated.", confirmLabel: "Publish" })) return;
    try {
      const data = await fetchJson("/api/survey/" + state.selectedSurveyId + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish" }),
      });
      state.selectedSurvey = data.survey;
      upsertSurveyInState(data.survey);
      renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  });

  // End Early
  const endBtn = document.getElementById("meta-end-early-btn");
  if (endBtn) endBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "End Survey Early", message: "This will close the survey immediately. No more responses will be accepted.", confirmLabel: "End Now", danger: true })) return;
    try {
      const data = await fetchJson("/api/survey/" + state.selectedSurveyId + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_early" }),
      });
      state.selectedSurvey = data.survey;
      upsertSurveyInState(data.survey);
      renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  });

  // Reopen
  const reopenBtn = document.getElementById("meta-reopen-btn");
  if (reopenBtn) reopenBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "Reopen Survey", message: "Reopen this survey so it starts accepting responses again?", confirmLabel: "Reopen" })) return;
    try {
      const data = await fetchJson("/api/survey/" + state.selectedSurveyId + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      state.selectedSurvey = data.survey;
      upsertSurveyInState(data.survey);
      renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  });

  // Close
  const closeBtn = document.getElementById("meta-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "Close Survey", message: "Close this survey? It will stop accepting responses.", confirmLabel: "Close", danger: true })) return;
    try {
      const data = await fetchJson("/api/survey/" + state.selectedSurveyId + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      state.selectedSurvey = data.survey;
      upsertSurveyInState(data.survey);
      renderSurveyPanels({ builder: true, meta: true, list: true, stats: true });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  });

  const cloneBtn = document.getElementById("meta-clone-btn");
  if (cloneBtn) cloneBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "Clone Survey", message: "Create a new draft copy of this closed survey?", confirmLabel: "Clone" })) return;
    await cloneSelectedSurvey();
  });

  // Delete
  const deleteBtn = document.getElementById("meta-delete-btn");
  if (deleteBtn) deleteBtn.addEventListener("click", async () => {
    if (!await showConfirmModal({ title: "Delete Survey", message: "This will permanently delete the survey and all responses. This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
    try {
      await fetchJson("/api/survey/" + state.selectedSurveyId, { method: "DELETE" });
      state.selectedSurveyId = "";
      state.selectedSurvey = null;
      state.questions = [];
      state.dirty = false;
      await loadSurveyList();
      renderSurveyPanels({ builder: true, meta: true, list: false, stats: true });
    } catch (err) {
      await showAlertModal({ title: "Error", message: err.message });
    }
  });
}

async function saveTimeline() {
  if (isSelectedSurveyReadOnly()) return;

  const startsDate = document.getElementById("meta-starts-date")?.value;
  const endsDate = document.getElementById("meta-ends-date")?.value;
  const startsTimeEl = document.getElementById("meta-starts-time");
  const endsTimeEl = document.getElementById("meta-ends-time");

  const startsAt = startsDate ? buildTimestamp(startsDate, startsTimeEl) : null;
  const endsAt = endsDate ? buildTimestamp(endsDate, endsTimeEl) : null;

  try {
    const data = await fetchJson("/api/survey/" + state.selectedSurveyId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsAt, endsAt }),
    });
    state.selectedSurvey = data.survey;
    upsertSurveyInState(data.survey);
    renderSurveyPanels({ builder: false, meta: true, list: true, stats: true });
  } catch {}
}

function buildTimestamp(dateStr, timeBtn) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const h = parseInt(timeBtn?.dataset.hour24 || "0", 10);
  const min = parseInt(timeBtn?.dataset.minute || "0", 10);
  return Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
}

// ============================================================
// Date/Time Helpers
// ============================================================

function formatDateInput(unix) {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function getHour24(unix) {
  if (!unix) return "9";
  return String(new Date(unix * 1000).getHours());
}

function getMinute(unix) {
  if (!unix) return "0";
  return String(new Date(unix * 1000).getMinutes());
}

function formatTimeDisplay(unix) {
  if (!unix) return "Set time";
  const d = new Date(unix * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  const h = d.getHours();
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "AM" : "PM";
  return pad(h12) + ":" + pad(d.getMinutes()) + " " + ampm;
}

function formatDate(unix) {
  if (!unix) return "N/A";
  return new Date(unix * 1000).toLocaleDateString();
}

// ============================================================
// Time Picker (reuses bulletin-time pattern)
// ============================================================

function initTimeModal() {
  const modal = document.getElementById("survey-time-modal");
  const closeBtn = document.getElementById("survey-time-modal-close");
  const hourDisplay = document.getElementById("survey-time-hour-display");
  const minuteDisplay = document.getElementById("survey-time-minute-display");
  const hourFace = document.getElementById("survey-clock-hour-face");
  const minuteFace = document.getElementById("survey-clock-minute-face");
  const hand = document.getElementById("survey-clock-hand");
  const amBtn = document.getElementById("survey-time-am");
  const pmBtn = document.getElementById("survey-time-pm");
  const cancelBtn = document.getElementById("survey-time-cancel");
  const saveBtn = document.getElementById("survey-time-save");
  const heading = document.getElementById("survey-time-modal-heading");

  if (!modal || !closeBtn) return;

  function open(triggerEl) {
    state.activeTimeFieldId = triggerEl.id;
    state.activeTimeView = "hour";
    state.pendingTimeValue = {
      hour24: parseInt(triggerEl.dataset.hour24 || "9", 10),
      minute: parseInt(triggerEl.dataset.minute || "0", 10),
    };
    heading.textContent = triggerEl.dataset.timeLabel || "Choose time";
    updateDisplay();
    renderFace();
    modal.classList.remove("hidden");
  }

  function close() {
    modal.classList.add("hidden");
    state.activeTimeFieldId = null;
  }

  function updateDisplay() {
    if (!state.pendingTimeValue) return;
    const h = state.pendingTimeValue.hour24;
    const m = state.pendingTimeValue.minute;
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    hourDisplay.textContent = String(h12).padStart(2, "0");
    minuteDisplay.textContent = String(m).padStart(2, "0");
    amBtn.classList.toggle("active", h < 12);
    pmBtn.classList.toggle("active", h >= 12);

    if (state.activeTimeView === "hour") {
      hourDisplay.classList.add("active");
      minuteDisplay.classList.remove("active");
      hourFace.classList.remove("hidden");
      minuteFace.classList.add("hidden");
    } else {
      hourDisplay.classList.remove("active");
      minuteDisplay.classList.add("active");
      hourFace.classList.add("hidden");
      minuteFace.classList.remove("hidden");
    }
  }

  function renderFace() {
    if (state.activeTimeView === "hour") {
      renderHourFace();
    } else {
      renderMinuteFace();
    }
  }

  function renderHourFace() {
    hourFace.innerHTML = "";
    for (let i = 1; i <= 12; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bulletin-clock-option";
      btn.textContent = i;
      const h12 = state.pendingTimeValue.hour24 % 12 || 12;
      if (i === h12) btn.classList.add("active");
      btn.addEventListener("click", () => {
        const isPM = state.pendingTimeValue.hour24 >= 12;
        state.pendingTimeValue.hour24 = isPM ? (i === 12 ? 12 : i + 12) : (i === 12 ? 0 : i);
        state.activeTimeView = "minute";
        updateDisplay();
        renderFace();
      });
      hourFace.appendChild(btn);
    }
    const h12 = state.pendingTimeValue.hour24 % 12 || 12;
    const angle = (h12 === 12 ? 0 : h12) * 30;
    hand.dataset.clockAngle = String(angle / 30);
  }

  function renderMinuteFace() {
    minuteFace.innerHTML = "";
    for (let i = 0; i < 12; i++) {
      const val = i * 5;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bulletin-clock-option";
      btn.textContent = String(val).padStart(2, "0");
      if (val === state.pendingTimeValue.minute) btn.classList.add("active");
      btn.addEventListener("click", () => {
        state.pendingTimeValue.minute = val;
        updateDisplay();
      });
      minuteFace.appendChild(btn);
    }
    const angle = state.pendingTimeValue.minute / 5;
    hand.dataset.clockAngle = String(angle);
  }

  // Event listeners
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  hourDisplay.addEventListener("click", () => {
    state.activeTimeView = "hour";
    updateDisplay();
    renderFace();
  });

  minuteDisplay.addEventListener("click", () => {
    state.activeTimeView = "minute";
    updateDisplay();
    renderFace();
  });

  amBtn.addEventListener("click", () => {
    if (state.pendingTimeValue.hour24 >= 12) state.pendingTimeValue.hour24 -= 12;
    updateDisplay();
  });

  pmBtn.addEventListener("click", () => {
    if (state.pendingTimeValue.hour24 < 12) state.pendingTimeValue.hour24 += 12;
    updateDisplay();
  });

  saveBtn.addEventListener("click", () => {
    if (!state.activeTimeFieldId || !state.pendingTimeValue) return;
    const trigger = document.getElementById(state.activeTimeFieldId);
    if (trigger) {
      trigger.dataset.hour24 = String(state.pendingTimeValue.hour24);
      trigger.dataset.minute = String(state.pendingTimeValue.minute);
      const h = state.pendingTimeValue.hour24;
      const m = state.pendingTimeValue.minute;
      const pad = (v) => String(v).padStart(2, "0");
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      trigger.textContent = pad(h12) + ":" + pad(m) + " " + ampm;
      saveTimeline();
    }
    close();
  });

  // Bind trigger buttons via event delegation (buttons are re-created by renderMetaPanel)
  document.getElementById("survey-meta-body").addEventListener("click", (e) => {
    const trigger = e.target.closest(".bulletin-time-trigger");
    if (trigger) open(trigger);
  });
}

// ============================================================
// URL Sync
// ============================================================

function syncUrl() {
  const params = new URLSearchParams(window.location.search);
  if (state.selectedSurveyId) {
    params.set("survey", state.selectedSurveyId);
  } else {
    params.delete("survey");
  }
  const qs = params.toString();
  const url = window.location.pathname + (qs ? "?" + qs : "");
  history.replaceState(null, "", url);
}

function readUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return params.get("survey") || "";
}

// ============================================================
// Results button
// ============================================================

function initViewResultsBtn() {
  const btn = document.getElementById("survey-results-btn");
  if (btn) btn.addEventListener("click", () => {
    if (state.selectedSurveyId) {
      window.location.href = "/survey/results?id=" + state.selectedSurveyId;
    }
  });
}

// ============================================================
// Init
// ============================================================

async function init() {
  // Sidebar collapse
  document.getElementById("survey-sidebar-collapse-btn")?.addEventListener("click", () => {
    document.getElementById("survey-sidebar")?.classList.toggle("collapsed");
  });

  // Sidebar nav + mobile tabs
  document.querySelectorAll("[data-survey-view]").forEach((btn) => {
    btn.addEventListener("click", () => setCurrentView(btn.dataset.surveyView));
  });
  if (new URLSearchParams(window.location.search).get("view") === "about") {
    setCurrentView("about");
  }

  // New survey
  document.getElementById("survey-new-btn")?.addEventListener("click", createNewSurvey);

  // Refresh
  document.getElementById("survey-list-refresh-btn")?.addEventListener("click", loadSurveyList);

  // Results button
  initViewResultsBtn();

  // Time picker
  initTimeModal();

  // Load surveys
  await loadSurveyList();
  refreshTimeSensitiveSurveyUi();
  window.setInterval(refreshTimeSensitiveSurveyUi, 30 * 1000);

  // Select from URL param
  const surveyId = readUrlParams();
  if (surveyId) {
    await selectSurvey(surveyId);
  }
}

init().catch((err) => {
  const body = document.getElementById("survey-list-body");
  if (body) body.textContent = "Failed to load: " + err.message;
});
