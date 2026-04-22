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

function formatDateTimeInput(unix) {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadSurveys() {
  const data = await fetchJson("/api/survey/list");
  const list = document.getElementById("survey-list");
  list.innerHTML = data.surveys.length
    ? data.surveys.map((survey) => `
      <div class="card">
        <div class="flex justify-between items-start gap-3">
          <div>
            <div class="font-medium">${escapeHtml(survey.title)}</div>
            <div class="text-xs text-muted">${escapeHtml(survey.responseMode)} • ${escapeHtml(survey.status)}</div>
            <div class="text-sm mt-2">${escapeHtml(survey.description || "")}</div>
            ${survey.publicToken ? `<div class="text-xs mt-2"><a class="text-accent hover:underline" href="/survey/r/${survey.publicToken}">Open response link</a></div>` : ""}
          </div>
          <button class="btn-secondary text-xs survey-results-btn" data-id="${survey.id}">Results</button>
        </div>
      </div>
    `).join("")
    : '<p class="text-sm text-muted">No surveys created yet.</p>';

  list.querySelectorAll(".survey-results-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const data = await fetchJson(`/api/survey/${button.dataset.id}/results`);
      const responseCount = data.results.responses.length;
      const questionCount = data.questions.length;
      alert(`Responses: ${responseCount}\nQuestions: ${questionCount}`);
    });
  });
}

async function init() {
  document.getElementById("survey-refresh-btn").addEventListener("click", loadSurveys);
  document.getElementById("survey-create-btn").addEventListener("click", async () => {
    const msg = document.getElementById("survey-create-msg");
    msg.classList.add("hidden");
    try {
      const questions = JSON.parse(document.getElementById("survey-questions-json").value || "[]");
      const data = await fetchJson("/api/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("survey-title").value.trim(),
          description: document.getElementById("survey-description").value.trim(),
          responseMode: document.getElementById("survey-response-mode").value,
          status: "published",
          startsAt: document.getElementById("survey-starts-at").value ? Math.floor(new Date(document.getElementById("survey-starts-at").value).getTime() / 1000) : null,
          endsAt: document.getElementById("survey-ends-at").value ? Math.floor(new Date(document.getElementById("survey-ends-at").value).getTime() / 1000) : null,
          questions,
        }),
      });
      msg.textContent = data.publicToken ? `Survey saved. Public token: ${data.publicToken}` : "Survey saved.";
      msg.className = "text-sm text-accent";
      document.getElementById("survey-title").value = "";
      document.getElementById("survey-description").value = "";
      document.getElementById("survey-questions-json").value = "";
      await loadSurveys();
    } catch (error) {
      msg.textContent = error.message;
      msg.className = "text-sm text-error";
    }
    msg.classList.remove("hidden");
  });

  await loadSurveys();
}

init().catch((error) => {
  const list = document.getElementById("survey-list");
  if (list) list.textContent = error.message;
});
