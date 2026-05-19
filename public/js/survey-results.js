import { showAlertModal } from "./confirm-modal.js";
import { escapeHtml, stateBlock } from "./ui-components.js";

// RedSecTools — Survey Results & Analytics

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const state = {
  surveyId: "",
  survey: null,
  questions: [],
  results: null,
};

const CHART_TONE_CLASSES = [
  "survey-chart-tone-1",
  "survey-chart-tone-2",
  "survey-chart-tone-3",
  "survey-chart-tone-4",
  "survey-chart-tone-5",
  "survey-chart-tone-6",
];

function formatDate(unix) {
  if (!unix) return "N/A";
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(unix) {
  if (!unix) return "N/A";
  return new Date(unix * 1000).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getChartToneClass(index) {
  return CHART_TONE_CLASSES[index % CHART_TONE_CLASSES.length];
}

function createChartMeter(percent, classNames = []) {
  const meter = document.createElement("progress");
  meter.className = ["survey-chart-meter"].concat(classNames).join(" ");
  meter.max = 100;
  meter.value = Math.max(0, Math.min(100, percent));
  return meter;
}

// ============================================================
// Init
// ============================================================

async function init() {
  const params = new URLSearchParams(window.location.search);
  state.surveyId = params.get("id");
  if (!state.surveyId) {
    showError("No survey ID specified.");
    return;
  }

  try {
    const data = await fetchJson("/api/survey/" + state.surveyId + "/results");
    state.survey = data.survey;
    state.questions = data.questions || [];
    state.results = data.results || { responses: [], answers: [] };
    renderAll();
  } catch (err) {
    showError(err.message);
  }
}

function showError(message) {
  document.getElementById("results-loading").classList.add("hidden");
  document.getElementById("results-error").classList.remove("hidden");
  document.getElementById("results-error-message").textContent = message;
}

function renderAll() {
  document.getElementById("results-loading").classList.add("hidden");
  document.getElementById("results-content").classList.remove("hidden");

  document.getElementById("results-survey-title").textContent = state.survey.title;
  document.getElementById("results-survey-description").textContent = state.survey.description || "";

  renderStatsRow();
  renderTimeline();
  renderQuestionBreakdowns();
  renderResponseList();

  // Export button
  document.getElementById("results-export-btn").addEventListener("click", () => {
    window.location.href = "/api/survey/" + state.surveyId + "/results/export";
  });
}

// ============================================================
// Stats Row
// ============================================================

function renderStatsRow() {
  const responses = state.results.responses.length;
  const questions = state.questions.length;
  const createdAt = formatDate(state.survey.createdAt);

  document.getElementById("results-stats-row").innerHTML =
    '<div class="survey-results-stat"><div class="survey-results-stat-value">' + responses + '</div><div class="survey-results-stat-label">Responses</div></div>' +
    '<div class="survey-results-stat"><div class="survey-results-stat-value">' + questions + '</div><div class="survey-results-stat-label">Questions</div></div>' +
    '<div class="survey-results-stat"><div class="survey-results-stat-value">' + createdAt + '</div><div class="survey-results-stat-label">Created</div></div>';
}

// ============================================================
// Response Timeline
// ============================================================

function renderTimeline() {
  const section = document.getElementById("results-timeline-section");
  const chart = document.getElementById("results-timeline-chart");

  if (state.results.responses.length < 2) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");

  // Group by date
  const byDate = new Map();
  for (const r of state.results.responses) {
    const key = new Date(r.submittedAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    byDate.set(key, (byDate.get(key) || 0) + 1);
  }

  const points = Array.from(byDate.entries());
  const max = Math.max(...points.map(([, count]) => count), 1);
  chart.innerHTML = "";

  points.forEach(([label, count], index) => {
    const item = document.createElement("div");
    item.className = "survey-timeline-item";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("survey-timeline-bar", getChartToneClass(index));

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = label + ": " + count;
    svg.appendChild(title);

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    const height = Math.max(4, Math.round((count / max) * 100));
    rect.setAttribute("x", "0");
    rect.setAttribute("y", String(100 - height));
    rect.setAttribute("width", "24");
    rect.setAttribute("height", String(height));
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", "currentColor");
    svg.appendChild(rect);

    const labelEl = document.createElement("span");
    labelEl.className = "survey-timeline-bar-label";
    labelEl.textContent = label;

    item.appendChild(svg);
    item.appendChild(labelEl);
    chart.appendChild(item);
  });
}

function getChoiceOptions(options, counts) {
  const merged = Array.isArray(options) ? options.slice() : [];
  Object.keys(counts).forEach((option) => {
    if (option && !merged.includes(option)) merged.push(option);
  });
  return merged;
}

function renderChartRow(labelText, count, percent, toneClasses) {
  const row = document.createElement("div");
  row.className = "survey-chart-row";

  const label = document.createElement("span");
  label.className = "survey-chart-label";
  label.textContent = labelText;

  const meter = createChartMeter(percent, toneClasses);

  const value = document.createElement("span");
  value.className = "survey-chart-value";
  value.textContent = count + " (" + percent + "%)";

  row.appendChild(label);
  row.appendChild(meter);
  row.appendChild(value);
  return row;
}

function renderCountRow(labelText, count, percent, toneClasses) {
  const row = renderChartRow(labelText, count, percent, toneClasses);
  row.querySelector(".survey-chart-value").textContent = String(count);
  return row;
}

function renderChoiceChart(options, answers, totalResponses, isMulti) {
  const counts = {};
  (options || []).forEach((o) => { counts[o] = 0; });

  for (const a of answers) {
    if (isMulti && Array.isArray(a.answerJson)) {
      for (const v of a.answerJson) {
        counts[v] = (counts[v] || 0) + 1;
      }
    } else {
      const val = a.answerText || "";
      if (!val) continue;
      counts[val] = (counts[val] || 0) + 1;
    }
  }

  const total = isMulti ? answers.length : totalResponses || answers.length;
  const container = document.createElement("div");
  container.className = "survey-chart-container";

  getChoiceOptions(options, counts).forEach((opt, index) => {
    const count = counts[opt] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    container.appendChild(renderChartRow(opt, count, pct, [getChartToneClass(index)]));
  });

  return container.outerHTML;
}

function renderRatingBreakdown(answers) {
  const values = answers.map((a) => parseInt(a.answerText, 10)).filter((v) => !isNaN(v) && v >= 1 && v <= 10);
  if (values.length === 0) return '<p class="text-sm text-muted">No rating data.</p>';

  const avg = (values.reduce((s, v) => s + v, 0) / values.length).toFixed(1);

  const dist = {};
  for (let i = 1; i <= 10; i++) dist[i] = 0;
  values.forEach((v) => { dist[v]++; });

  const maxDist = Math.max(...Object.values(dist), 1);

  const container = document.createElement("div");
  container.className = "survey-chart-container";

  const header = document.createElement("div");
  header.className = "text-center mb-3";
  header.innerHTML = '<span class="text-2xl font-bold">' + avg + '</span> <span class="text-sm text-muted">/ 10 average</span>';
  container.appendChild(header);

  for (let val = 10; val >= 1; val--) {
    const count = dist[val];
    const pct = Math.round((count / maxDist) * 100);
    container.appendChild(renderCountRow(String(val), count, pct, [getChartToneClass(10 - val)]));
  }

  return container.outerHTML;
}

function renderYesNoBreakdown(answers) {
  const yes = answers.filter((a) => (a.answerText || "").toLowerCase() === "yes").length;
  const no = answers.filter((a) => (a.answerText || "").toLowerCase() === "no").length;
  const total = yes + no || 1;

  const container = document.createElement("div");
  container.className = "survey-chart-container";

  [["Yes", yes, "survey-chart-meter-yes"], ["No", no, "survey-chart-meter-no"]].forEach(([labelText, count, toneClass]) => {
    const pct = Math.round((count / total) * 100);
    container.appendChild(renderChartRow(labelText, count, pct, [toneClass]));
  });

  return container.outerHTML;
}

// ============================================================
// Per-Question Breakdowns
// ============================================================

function renderQuestionBreakdowns() {
  const container = document.getElementById("results-questions");

  const answersByQuestion = new Map();
  for (const a of state.results.answers) {
    if (!answersByQuestion.has(a.questionId)) answersByQuestion.set(a.questionId, []);
    answersByQuestion.get(a.questionId).push(a);
  }

  container.innerHTML = state.questions.map((q, i) => {
    const answers = answersByQuestion.get(q.id) || [];
    const total = state.results.responses.length;
    return renderQuestionBreakdown(q, i, answers, total);
  }).join("");
}

function renderQuestionBreakdown(q, index, answers, totalResponses) {
  const type = q.questionType;
  const typeLabels = {
    short_text: "Short Text", long_text: "Long Text",
    single_choice: "Single Choice", multi_choice: "Multiple Choice",
    rating: "Rating", yes_no: "Yes / No", dropdown: "Dropdown",
  };

  let body = "";

  if (type === "short_text" || type === "long_text") {
    body = renderTextAnswers(answers);
  } else if (type === "single_choice" || type === "dropdown") {
    body = renderChoiceChart(q.options || [], answers, totalResponses, false);
  } else if (type === "multi_choice") {
    body = renderChoiceChart(q.options || [], answers, totalResponses, true);
  } else if (type === "rating") {
    body = renderRatingBreakdown(answers);
  } else if (type === "yes_no") {
    body = renderYesNoBreakdown(answers);
  }

  return (
    '<div class="survey-question-breakdown">' +
      '<div class="survey-question-breakdown-header">' +
        '<div class="survey-question-breakdown-title">Q' + (index + 1) + ": " + escapeHtml(q.questionText) + (q.isRequired ? " *" : "") + '</div>' +
        '<div class="survey-question-breakdown-type">' + escapeHtml(typeLabels[type] || type) + " &middot; " + answers.length + " answers</div>" +
      "</div>" +
      body +
    "</div>"
  );
}

function renderTextAnswers(answers) {
  const texts = answers.map((a) => a.answerText).filter(Boolean);
  if (texts.length === 0) return '<p class="text-sm text-muted">No text responses.</p>';
  return '<div class="survey-chart-container">' +
    texts.map((t) => '<div class="survey-text-response">' + escapeHtml(t) + "</div>").join("") +
  "</div>";
}

// ============================================================
// Individual Response List
// ============================================================

function renderResponseList() {
  const container = document.getElementById("results-responses-list");
  const countEl = document.getElementById("results-response-count");
  const responses = state.results.responses;

  if (countEl) countEl.textContent = responses.length + " responses";

  if (responses.length === 0) {
    container.innerHTML = stateBlock("No responses yet.");
    return;
  }

  container.innerHTML = responses.map((r) => {
    const name = r.responderName || "Anonymous";
    return (
      '<div class="survey-response-card">' +
        '<div class="survey-response-card-info">' +
          '<div class="survey-response-card-name">' + escapeHtml(name) + '</div>' +
          '<div class="survey-response-card-date">' + formatDateTime(r.submittedAt) + '</div>' +
        "</div>" +
        '<button type="button" class="btn-secondary text-xs" data-view-response="' + escapeHtml(r.id) + '">View</button>' +
      "</div>"
    );
  }).join("");

  container.querySelectorAll("[data-view-response]").forEach((btn) => {
    btn.addEventListener("click", () => viewResponse(btn.dataset.viewResponse));
  });
}

async function viewResponse(responseId) {
  try {
    const data = await fetchJson("/api/survey/" + state.surveyId + "/responses/" + responseId);
    showResponseModal(data.response);
  } catch (err) {
    await showAlertModal({ title: "Error", message: err.message });
  }
}

function showResponseModal(response) {
  // Create overlay
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay survey-response-modal-overlay";

  const name = response.responderName || "Anonymous";
  const date = formatDateTime(response.submittedAt);

  // Index answers by question
  const answerMap = new Map();
  for (const a of response.answers || []) {
    answerMap.set(a.questionId, a);
  }

  let answersHtml = state.questions.map((q, i) => {
    const a = answerMap.get(q.id);
    let val = "";
    if (!a) {
      val = '<span class="text-muted">No answer</span>';
    } else if (Array.isArray(a.answerJson)) {
      val = escapeHtml(a.answerJson.join(", "));
    } else {
      val = escapeHtml(a.answerText || "");
    }
    return (
      '<div class="survey-response-detail-item">' +
        '<div class="text-xs text-muted font-semibold">Q' + (i + 1) + ": " + escapeHtml(q.questionText) + '</div>' +
        '<div class="text-sm mt-1">' + val + '</div>' +
      "</div>"
    );
  }).join("");

  const card = document.createElement("div");
  card.className = "modal-card";
  card.innerHTML =
    '<div class="flex justify-between items-center mb-4">' +
      '<div>' +
        '<p class="text-xs font-semibold uppercase tracking-wide text-muted">Response Detail</p>' +
        '<h3 class="text-lg font-semibold">' + escapeHtml(name) + '</h3>' +
        '<p class="text-xs text-muted">' + date + '</p>' +
      '</div>' +
      '<button type="button" class="text-muted hover:text-primary text-lg cursor-pointer close-response-modal" title="Close">&times;</button>' +
    '</div>' +
    answersHtml;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  card.querySelector(".close-response-modal").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

// ============================================================
// Start
// ============================================================

init().catch((err) => {
  showError(err.message);
});
