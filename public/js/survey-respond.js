import { showAlertModal } from "./confirm-modal.js";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function $(id) {
  return document.getElementById(id);
}

/* ------------------------------------------------------------------
   State
   ------------------------------------------------------------------ */

const state = {
  survey: null,
  questions: [],
  currentIndex: 0,
  answers: {},       // keyed by question id
  responderName: "",
};

/* ------------------------------------------------------------------
   DOM references
   ------------------------------------------------------------------ */

const els = {
  loading:      $("respond-loading"),
  error:        $("respond-error"),
  errorText:    $("respond-error-text"),
  stepper:      $("respond-stepper"),
  title:        $("respond-survey-title"),
  description:  $("respond-survey-description"),
  progressFill: $("survey-progress-fill"),
  progressText: $("respond-progress-text"),
  questionContainer: $("respond-question-container"),
  questionText: $("respond-question-text"),
  questionRequired: $("respond-question-required"),
  questionInput: $("respond-question-input"),
  nameSection:  $("respond-name-section"),
  nameInput:    $("respond-name-input"),
  validationMsg: $("respond-validation-msg"),
  prevBtn:      $("respond-prev-btn"),
  nextBtn:      $("respond-next-btn"),
  thankyou:     $("respond-thankyou"),
};

/* ------------------------------------------------------------------
   Show / hide containers
   ------------------------------------------------------------------ */

function showContainer(id) {
  [els.loading, els.error, els.stepper, els.thankyou].forEach((el) => {
    if (el) el.classList.add("hidden");
  });
  const target = $(id);
  if (target) target.classList.remove("hidden");
}

function showError(message) {
  if (els.errorText) els.errorText.textContent = message;
  showContainer("respond-error");
}

function showValidation(message) {
  if (els.validationMsg) {
    els.validationMsg.textContent = message;
    els.validationMsg.classList.remove("hidden");
  }
}

function hideValidation() {
  if (els.validationMsg) els.validationMsg.classList.add("hidden");
}

/* ------------------------------------------------------------------
   Question renderers
   ------------------------------------------------------------------ */

function renderShortText(question, savedValue) {
  const input = document.createElement("input");
  input.className = "input-field";
  input.type = "text";
  input.placeholder = "Your answer";
  if (savedValue) input.value = savedValue;
  return input;
}

function renderLongText(question, savedValue) {
  const textarea = document.createElement("textarea");
  textarea.className = "input-field min-h-[120px]";
  textarea.placeholder = "Your answer";
  if (savedValue) textarea.value = savedValue;
  return textarea;
}

function renderSingleChoice(question, savedValue) {
  const container = document.createElement("div");
  container.className = "space-y-2";
  for (const option of (question.options || [])) {
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 text-sm cursor-pointer";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "q-" + question.id;
    radio.value = option;
    if (savedValue === option) radio.checked = true;

    const span = document.createElement("span");
    span.textContent = option;

    label.appendChild(radio);
    label.appendChild(span);
    container.appendChild(label);
  }
  return container;
}

function renderMultiChoice(question, savedValue) {
  const saved = Array.isArray(savedValue) ? savedValue : [];
  const container = document.createElement("div");
  container.className = "space-y-2";
  for (const option of (question.options || [])) {
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 text-sm cursor-pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "q-" + question.id;
    checkbox.value = option;
    if (saved.includes(option)) checkbox.checked = true;

    const span = document.createElement("span");
    span.textContent = option;

    label.appendChild(checkbox);
    label.appendChild(span);
    container.appendChild(label);
  }
  return container;
}

function renderRating(question, savedValue) {
  const row = document.createElement("div");
  row.className = "survey-rating-row";
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "survey-rating-btn";
    btn.textContent = String(i);
    if (savedValue === String(i)) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      row.querySelectorAll(".survey-rating-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    row.appendChild(btn);
  }
  return row;
}

function renderYesNo(question, savedValue) {
  const row = document.createElement("div");
  row.className = "survey-yesno-row";

  const yesBtn = document.createElement("button");
  yesBtn.type = "button";
  yesBtn.className = "survey-yesno-btn btn-yes";
  yesBtn.textContent = "Yes";
  if (savedValue === "Yes") yesBtn.classList.add("selected");
  yesBtn.addEventListener("click", () => {
    yesBtn.classList.add("selected");
    noBtn.classList.remove("selected");
  });

  const noBtn = document.createElement("button");
  noBtn.type = "button";
  noBtn.className = "survey-yesno-btn btn-no";
  noBtn.textContent = "No";
  if (savedValue === "No") noBtn.classList.add("selected");
  noBtn.addEventListener("click", () => {
    noBtn.classList.add("selected");
    yesBtn.classList.remove("selected");
  });

  row.appendChild(yesBtn);
  row.appendChild(noBtn);
  return row;
}

function renderDropdown(question, savedValue) {
  const select = document.createElement("select");
  select.className = "input-field";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select an option";
  select.appendChild(placeholder);

  for (const option of (question.options || [])) {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (savedValue === option) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

/* ------------------------------------------------------------------
   Read answer from current input
   ------------------------------------------------------------------ */

function readAnswer(question) {
  const container = els.questionInput;
  const type = question.questionType;

  if (type === "short_text" || type === "long_text") {
    const input = container.querySelector(".input-field");
    return input ? input.value : "";
  }

  if (type === "single_choice") {
    const checked = container.querySelector("input[type=radio]:checked");
    return checked ? checked.value : "";
  }

  if (type === "multi_choice") {
    const checked = [...container.querySelectorAll("input[type=checkbox]:checked")].map((cb) => cb.value);
    return checked;
  }

  if (type === "rating") {
    const selected = container.querySelector(".survey-rating-btn.selected");
    return selected ? selected.textContent : "";
  }

  if (type === "yes_no") {
    const selected = container.querySelector(".survey-yesno-btn.selected");
    return selected ? selected.textContent : "";
  }

  if (type === "dropdown") {
    const select = container.querySelector("select");
    return select ? select.value : "";
  }

  return "";
}

/* ------------------------------------------------------------------
   Render current question
   ------------------------------------------------------------------ */

function renderCurrentQuestion() {
  const question = state.questions[state.currentIndex];
  if (!question) return;

  const total = state.questions.length;
  const current = state.currentIndex + 1;

  // Progress bar
  const pct = Math.round((current / total) * 100);
  els.progressFill.value = pct;
  els.progressText.textContent = "Question " + current + " of " + total;

  // Title & description (set once, but safe to re-set)
  els.title.textContent = state.survey.title;
  els.description.textContent = state.survey.description || "";

  // Question text
  els.questionText.textContent = question.questionText;

  // Required indicator
  if (question.isRequired) {
    els.questionRequired.classList.remove("hidden");
    els.questionRequired.textContent = "Required";
  } else {
    els.questionRequired.classList.add("hidden");
  }

  // Clear and render input
  els.questionInput.innerHTML = "";
  const saved = state.answers[question.id];
  const savedText = Array.isArray(saved) ? saved : (typeof saved === "string" ? saved : "");

  let inputEl;
  switch (question.questionType) {
    case "short_text":
      inputEl = renderShortText(question, savedText);
      break;
    case "long_text":
      inputEl = renderLongText(question, savedText);
      break;
    case "single_choice":
      inputEl = renderSingleChoice(question, savedText);
      break;
    case "multi_choice":
      inputEl = renderMultiChoice(question, saved);
      break;
    case "rating":
      inputEl = renderRating(question, savedText);
      break;
    case "yes_no":
      inputEl = renderYesNo(question, savedText);
      break;
    case "dropdown":
      inputEl = renderDropdown(question, savedText);
      break;
    default:
      inputEl = renderShortText(question, savedText);
  }

  els.questionInput.appendChild(inputEl);

  // Re-trigger fade animation
  els.questionContainer.classList.remove("survey-stepper-question");
  void els.questionContainer.offsetWidth; // force reflow
  els.questionContainer.classList.add("survey-stepper-question");

  // Name section: show on last question if not anonymous
  const isLast = state.currentIndex === total - 1;
  const needsName = state.survey.responseMode !== "anonymous_public";
  if (isLast && needsName) {
    els.nameSection.classList.remove("hidden");
    els.nameInput.value = state.responderName;
  } else {
    els.nameSection.classList.add("hidden");
  }

  // Navigation buttons
  if (state.currentIndex === 0) {
    els.prevBtn.classList.add("hidden");
  } else {
    els.prevBtn.classList.remove("hidden");
  }

  if (isLast) {
    els.nextBtn.textContent = "Submit";
  } else {
    els.nextBtn.textContent = "Next";
  }

  hideValidation();
}

/* ------------------------------------------------------------------
   Validate current question
   ------------------------------------------------------------------ */

function validateCurrent() {
  const question = state.questions[state.currentIndex];
  if (!question || !question.isRequired) return true;

  const answer = state.answers[question.id];
  if (question.questionType === "multi_choice") {
    return Array.isArray(answer) && answer.length > 0;
  }
  return typeof answer === "string" && answer.trim().length > 0;
}

/* ------------------------------------------------------------------
   Navigation
   ------------------------------------------------------------------ */

function saveCurrentAnswer() {
  const question = state.questions[state.currentIndex];
  if (!question) return;
  state.answers[question.id] = readAnswer(question);

  // Also save name if on last step
  if (els.nameInput && !els.nameSection.classList.contains("hidden")) {
    state.responderName = els.nameInput.value.trim();
  }
}

function goNext() {
  saveCurrentAnswer();
  hideValidation();

  if (!validateCurrent()) {
    showValidation("This question requires an answer.");
    return;
  }

  const isLast = state.currentIndex === state.questions.length - 1;
  if (isLast) {
    submitResponse();
  } else {
    state.currentIndex++;
    renderCurrentQuestion();
  }
}

function goPrev() {
  saveCurrentAnswer();
  hideValidation();

  if (state.currentIndex > 0) {
    state.currentIndex--;
    renderCurrentQuestion();
  }
}

/* ------------------------------------------------------------------
   Submit
   ------------------------------------------------------------------ */

async function submitResponse() {
  const token = window.location.pathname.split("/").pop();

  const answers = state.questions.map((question) => {
    const raw = state.answers[question.id];
    if (question.questionType === "multi_choice") {
      return {
        questionId: question.id,
        answerJson: Array.isArray(raw) ? raw : [],
      };
    }
    return {
      questionId: question.id,
      answerText: typeof raw === "string" ? raw : "",
    };
  });

  try {
    els.nextBtn.disabled = true;
    els.nextBtn.textContent = "Submitting...";

    await fetchJson("/api/survey/respond/" + token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        responderName: state.responderName,
        answers,
      }),
    });

    showContainer("respond-thankyou");
  } catch (error) {
    els.nextBtn.disabled = false;
    els.nextBtn.textContent = "Submit";
    await showAlertModal({ title: "Submission Failed", message: error.message });
  }
}

/* ------------------------------------------------------------------
   Init
   ------------------------------------------------------------------ */

async function init() {
  const token = window.location.pathname.split("/").pop();
  if (!token) {
    showError("No survey token provided.");
    return;
  }

  try {
    const data = await fetchJson("/api/survey/respond/" + token);
    state.survey = data.survey;
    state.questions = data.questions || [];

    if (state.questions.length === 0) {
      showError("This survey has no questions.");
      return;
    }

    // Wire buttons
    els.nextBtn.addEventListener("click", goNext);
    els.prevBtn.addEventListener("click", goPrev);

    showContainer("respond-stepper");
    renderCurrentQuestion();
  } catch (error) {
    showError(error.message);
  }
}

init();
