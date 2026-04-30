const STORAGE_KEY = "redsecai.messages.v1";
const MAX_HISTORY = 12;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownLite(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function loadMessages() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
  } catch (_) {
    return [];
  }
}

function saveMessages(messages) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
}

async function checkStatus() {
  const res = await fetch("/api/ai/status", { headers: { accept: "application/json" } });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) return { enabled: false, ready: false, error: "RedSecAI status unavailable" };
  return res.json();
}

function createWidget(status) {
  const root = document.createElement("section");
  root.className = "redsecai-widget";
  root.innerHTML = `
    <button type="button" class="redsecai-launcher" aria-label="Open RedSecAI" title="RedSecAI">
      <svg class="redsecai-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.75C4 4.23 5.23 3 6.75 3h10.5C18.77 3 20 4.23 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H12l-4.1 3.25A.85.85 0 0 1 6.5 18.58V16A2.75 2.75 0 0 1 4 13.25v-7.5Z"></path>
        <path d="M8 8.5h8M8 11.5h5.5"></path>
      </svg>
      <span class="redsecai-launcher-mark">RedSecAI</span>
      <span class="redsecai-status-dot ${status.ready ? "ready" : "offline"}"></span>
    </button>
    <div class="redsecai-panel hidden" role="dialog" aria-label="RedSecAI assistant">
      <header class="redsecai-header">
        <div>
          <div class="redsecai-kicker">RedSecAI</div>
          <h2>Local assistant</h2>
        </div>
        <div class="redsecai-header-actions">
          <button type="button" class="redsecai-icon-btn" data-redsecai-clear title="Clear chat" aria-label="Clear chat">R</button>
          <button type="button" class="redsecai-icon-btn" data-redsecai-close title="Close" aria-label="Close">x</button>
        </div>
      </header>
      <div class="redsecai-boundary">
        Scoped to your session. No access to vault, paste, share, or team-chat plaintext.
      </div>
      <div class="redsecai-messages" aria-live="polite"></div>
      <form class="redsecai-form">
        <textarea class="redsecai-input" rows="2" placeholder="Ask about reports, calendar, or threat intel..."></textarea>
        <button type="submit" class="redsecai-send" title="Send" aria-label="Send">-&gt;</button>
      </form>
      <p class="redsecai-footnote">${status.ready ? `Model: ${escapeHtml(status.model)}` : escapeHtml(status.installing ? "Installing local model..." : (status.error || "Local model is not ready"))}</p>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function appendMessage(container, message) {
  const item = document.createElement("article");
  item.className = `redsecai-message ${message.role === "assistant" ? "assistant" : "user"}`;
  item.innerHTML = `<div class="redsecai-message-role">${message.role === "assistant" ? "RedSecAI" : "You"}</div><div class="redsecai-message-body">${renderMarkdownLite(message.content)}</div>`;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function renderMessages(container, messages) {
  container.innerHTML = "";
  if (!messages.length) {
    appendMessage(container, {
      role: "assistant",
      content: "I can help draft reports, summarize scoped threat intel, and reason over calendar context available to your account.",
    });
    return;
  }
  messages.forEach((message) => appendMessage(container, message));
}

async function initRedSecAI() {
  let status;
  try {
    status = await checkStatus();
  } catch (_) {
    status = null;
  }
  if (!status || status.enabled === false) return;

  const widget = createWidget(status);
  const launcher = widget.querySelector(".redsecai-launcher");
  const panel = widget.querySelector(".redsecai-panel");
  const closeBtn = widget.querySelector("[data-redsecai-close]");
  const clearBtn = widget.querySelector("[data-redsecai-clear]");
  const form = widget.querySelector(".redsecai-form");
  const input = widget.querySelector(".redsecai-input");
  const send = widget.querySelector(".redsecai-send");
  const messagesEl = widget.querySelector(".redsecai-messages");
  let messages = loadMessages();

  renderMessages(messagesEl, messages);

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) input.focus();
  });
  closeBtn.addEventListener("click", () => panel.classList.add("hidden"));
  clearBtn.addEventListener("click", () => {
    messages = [];
    saveMessages(messages);
    renderMessages(messagesEl, messages);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content || send.disabled) return;

    const userMessage = { role: "user", content };
    messages.push(userMessage);
    saveMessages(messages);
    appendMessage(messagesEl, userMessage);
    input.value = "";
    send.disabled = true;

    const pending = { role: "assistant", content: "Thinking..." };
    appendMessage(messagesEl, pending);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          messages,
          page: {
            path: window.location.pathname,
            title: document.title,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      const assistant = {
        role: "assistant",
        content: res.ok ? (body.message || "No response.") : (body.error || "RedSecAI is unavailable."),
      };
      messages.push(assistant);
      saveMessages(messages);
      renderMessages(messagesEl, messages);
    } catch (_) {
      messages.push({ role: "assistant", content: "RedSecAI is unavailable right now." });
      saveMessages(messages);
      renderMessages(messagesEl, messages);
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
}

initRedSecAI();
