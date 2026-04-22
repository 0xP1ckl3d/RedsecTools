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

function renderQuestion(question) {
  if (question.questionType === "long_text") {
    return `<textarea class="input-field min-h-[120px]" data-question-id="${question.id}"></textarea>`;
  }
  if (question.questionType === "single_choice") {
    return (question.options || []).map((option) => `<label class="flex items-center gap-2 text-sm"><input type="radio" name="q-${question.id}" value="${escapeHtml(option)}"> <span>${escapeHtml(option)}</span></label>`).join("");
  }
  if (question.questionType === "multi_choice") {
    return (question.options || []).map((option) => `<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="q-${question.id}" value="${escapeHtml(option)}"> <span>${escapeHtml(option)}</span></label>`).join("");
  }
  if (question.questionType === "rating") {
    return '<input type="number" min="1" max="10" class="input-field" data-question-id="' + question.id + '">';
  }
  if (question.questionType === "yes_no") {
    return '<select class="input-field" data-question-id="' + question.id + '"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select>';
  }
  return `<input class="input-field" data-question-id="${question.id}">`;
}

async function init() {
  const token = window.location.pathname.split("/").pop();
  const root = document.getElementById("survey-response-root");
  try {
    const data = await fetchJson(`/api/survey/respond/${token}`);
    root.innerHTML = `
      <div>
        <h2 class="text-xl font-semibold">${escapeHtml(data.survey.title)}</h2>
        <p class="text-sm text-muted mt-2">${escapeHtml(data.survey.description || "")}</p>
      </div>
      ${data.questions.map((question) => `
        <div class="card">
          <div class="font-medium mb-3">${escapeHtml(question.questionText)}${question.isRequired ? " *" : ""}</div>
          <div class="space-y-2" data-question-wrap="${question.id}">
            ${renderQuestion(question)}
          </div>
        </div>
      `).join("")}
      ${data.survey.responseMode !== "anonymous_public" ? '<input id="survey-responder-name" class="input-field" placeholder="Your name (if required)">' : ""}
      <button id="survey-submit-btn" type="button" class="btn-primary">Submit</button>
      <p id="survey-submit-msg" class="text-sm hidden"></p>
    `;

    document.getElementById("survey-submit-btn").addEventListener("click", async () => {
      const answers = data.questions.map((question) => {
        const wrap = root.querySelector(`[data-question-wrap="${question.id}"]`);
        if (question.questionType === "single_choice") {
          const checked = wrap.querySelector("input[type=radio]:checked");
          return { questionId: question.id, answerText: checked ? checked.value : "" };
        }
        if (question.questionType === "multi_choice") {
          const checked = [...wrap.querySelectorAll("input[type=checkbox]:checked")].map((input) => input.value);
          return { questionId: question.id, answerJson: checked };
        }
        const input = wrap.querySelector("[data-question-id]");
        return { questionId: question.id, answerText: input ? input.value : "" };
      });
      const response = await fetchJson(`/api/survey/respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responderName: document.getElementById("survey-responder-name")?.value.trim() || "",
          answers,
        }),
      });
      const msg = document.getElementById("survey-submit-msg");
      msg.textContent = response.success ? "Response submitted." : "Response failed.";
      msg.className = "text-sm text-accent";
      msg.classList.remove("hidden");
    });
  } catch (error) {
    root.textContent = error.message;
  }
}

init();
