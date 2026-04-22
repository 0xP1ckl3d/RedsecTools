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

let currentPageId = null;

async function loadPages(query = "") {
  const data = await fetchJson(`/api/wiki/pages${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const list = document.getElementById("wiki-pages-list");
  list.innerHTML = data.pages.length
    ? data.pages.map((page) => `
      <button type="button" class="w-full text-left card wiki-page-btn" data-id="${page.id}">
        <div class="font-medium">${escapeHtml(page.title)}</div>
        <div class="text-xs text-muted">${escapeHtml(page.slug)}</div>
      </button>
    `).join("")
    : '<p class="text-sm text-muted">No wiki pages yet.</p>';
  list.querySelectorAll(".wiki-page-btn").forEach((button) => {
    button.addEventListener("click", () => loadPage(button.dataset.id));
  });
}

async function loadPage(pageId) {
  const data = await fetchJson(`/api/wiki/pages/${pageId}`);
  currentPageId = data.page.id;
  document.getElementById("wiki-title").value = data.page.title;
  document.getElementById("wiki-slug").value = data.page.slug;
  document.getElementById("wiki-body").value = data.page.body_markdown;
  document.getElementById("wiki-preview").innerHTML = data.page.body_html || "";
}

function renderPreview() {
  const value = document.getElementById("wiki-body").value;
  const lines = value.split("\n").map((line) => `<div>${escapeHtml(line)}</div>`);
  document.getElementById("wiki-preview").innerHTML = lines.join("");
}

async function init() {
  document.getElementById("wiki-save-btn").addEventListener("click", async () => {
    const payload = {
      title: document.getElementById("wiki-title").value.trim(),
      slug: document.getElementById("wiki-slug").value.trim(),
      bodyMarkdown: document.getElementById("wiki-body").value,
    };
    const msg = document.getElementById("wiki-msg");
    msg.classList.add("hidden");
    try {
      if (currentPageId) {
        await fetchJson(`/api/wiki/pages/${currentPageId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const data = await fetchJson("/api/wiki/pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        currentPageId = data.id;
      }
      msg.textContent = "Page saved.";
      msg.className = "text-sm text-accent";
      await loadPages(document.getElementById("wiki-search").value.trim());
      if (currentPageId) await loadPage(currentPageId);
    } catch (error) {
      msg.textContent = error.message;
      msg.className = "text-sm text-error";
    }
    msg.classList.remove("hidden");
  });

  document.getElementById("wiki-new-btn").addEventListener("click", () => {
    currentPageId = null;
    document.getElementById("wiki-title").value = "";
    document.getElementById("wiki-slug").value = "";
    document.getElementById("wiki-body").value = "";
    document.getElementById("wiki-preview").innerHTML = "Start typing to preview the page.";
  });
  document.getElementById("wiki-refresh-btn").addEventListener("click", () => loadPages(document.getElementById("wiki-search").value.trim()));
  document.getElementById("wiki-search").addEventListener("input", (event) => loadPages(event.target.value.trim()));
  document.getElementById("wiki-body").addEventListener("input", renderPreview);
  await loadPages();
}

init().catch((error) => {
  const list = document.getElementById("wiki-pages-list");
  if (list) list.textContent = error.message;
});
