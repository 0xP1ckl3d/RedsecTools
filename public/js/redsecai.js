const STORAGE_KEY = "redsecai.messages.v1";
const ACTIVE_JOB_KEY = "redsecai.activeJob.v1";
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

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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

function getActiveJob() {
  try {
    return JSON.parse(sessionStorage.getItem(ACTIVE_JOB_KEY) || "null");
  } catch (_) {
    return null;
  }
}

function setActiveJob(job) {
  if (!job) sessionStorage.removeItem(ACTIVE_JOB_KEY);
  else sessionStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
}

async function checkStatus() {
  const res = await fetch("/api/ai/status", { headers: { accept: "application/json" } });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) return { enabled: false, ready: false, error: "RedSecAI status unavailable" };
  return res.json();
}

function createWidget(status) {
  const readyText = status.ready
    ? `Model: ${escapeHtml(status.model)}${status.cloudModel ? " (cloud)" : ""}`
    : escapeHtml(status.installing ? "Installing local model..." : (status.error || "Model is not ready"));
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
      <span class="redsecai-alert-badge hidden" aria-hidden="true"></span>
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
      <p class="redsecai-footnote">${readyText}</p>
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

function createJobId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getClientTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (_) {
    return "";
  }
}

function rememberClientTimeZone() {
  const timeZone = getClientTimeZone();
  if (timeZone) {
    document.cookie = `redsec_tz=${encodeURIComponent(timeZone)}; Path=/; SameSite=Lax`;
  }
  return timeZone;
}

function createRedSecAiSocket({ onStart, onStatus, onDelta, onDone, onError, onSnapshot, onActions }) {
  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const pending = [];

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const timeZone = encodeURIComponent(rememberClientTimeZone());
    ws = new WebSocket(`${protocol}//${location.host}/ws/redsecai${timeZone ? `?tz=${timeZone}` : ""}`);

    ws.onopen = () => {
      connected = true;
      reconnectAttempts = 0;
      while (pending.length && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(pending.shift()));
      }
      const activeJob = getActiveJob();
      if (activeJob?.jobId) {
        send({ type: "redsecai_resume", jobId: activeJob.jobId });
      }
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (message.type === "redsecai_start") onStart(message);
      else if (message.type === "redsecai_status") onStatus(message);
      else if (message.type === "redsecai_delta") onDelta(message);
      else if (message.type === "redsecai_done") onDone(message);
      else if (message.type === "redsecai_error") onError(message);
      else if (message.type === "redsecai_snapshot") onSnapshot(message);
      else if (message.type === "redsecai_actions") onActions(message);
    };

    ws.onclose = () => {
      connected = false;
      if (reconnectAttempts >= 8) return;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {};
  }

  function send(message) {
    if (connected && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      pending.push(message);
      connect();
    }
  }

  function close() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts = 99;
    if (ws) ws.close(1000, "closing");
  }

  connect();
  return { send, close };
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
  const footnote = widget.querySelector(".redsecai-footnote");
  const alertBadge = widget.querySelector(".redsecai-alert-badge");
  let messages = loadMessages();
  let activeAssistant = null;
  let activeAssistantText = "";
  let activeStatusText = "";
  let progressTimer = null;
  let progressTimeoutTimer = null;
  let progressStartedAt = 0;
  let activeJobId = null;
  let activeJobTimeoutMs = Number(status.timeoutMs) || 0;
  const timedOutJobIds = new Set();
  const pendingActionIds = new Set();
  const pendingActions = new Map();
  let unreadCount = 0;

  renderMessages(messagesEl, messages);

  function isPanelOpen() {
    return !panel.classList.contains("hidden");
  }

  function syncAlertBadge() {
    const actionCount = pendingActions.size;
    const total = unreadCount + actionCount;
    if (!alertBadge) return;
    alertBadge.classList.toggle("hidden", total <= 0);
    alertBadge.textContent = total > 9 ? "9+" : String(total);
    launcher.classList.toggle("has-alert", total > 0);
    launcher.setAttribute("aria-label", total > 0 ? `Open RedSecAI, ${total} unread item${total === 1 ? "" : "s"}` : "Open RedSecAI");
  }

  function markUnread(count = 1) {
    if (isPanelOpen()) return;
    unreadCount += count;
    syncAlertBadge();
  }

  function clearUnread() {
    unreadCount = 0;
    syncAlertBadge();
  }

  function ensureActiveAssistant() {
    if (activeAssistant) return activeAssistant;
    activeAssistant = document.createElement("article");
    activeAssistant.className = "redsecai-message assistant";
    activeAssistant.innerHTML = `<div class="redsecai-message-role">RedSecAI</div><div class="redsecai-message-body">Thinking...</div>`;
    messagesEl.appendChild(activeAssistant);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return activeAssistant;
  }

  function updateActiveStatus(text) {
    activeStatusText = text || "Working";
    if (activeAssistantText) return;
    const item = ensureActiveAssistant();
    const body = item.querySelector(".redsecai-message-body");
    if (body) body.innerHTML = `<span class="redsecai-live-status">${escapeHtml(activeStatusText)}</span>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateActiveAssistant(text) {
    activeAssistantText = text;
    const item = ensureActiveAssistant();
    const body = item.querySelector(".redsecai-message-body");
    if (body) body.innerHTML = renderMarkdownLite(text || "Thinking...");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setFootnote(text) {
    if (footnote) footnote.textContent = text;
  }

  function stopProgress() {
    if (progressTimer) clearInterval(progressTimer);
    if (progressTimeoutTimer) clearTimeout(progressTimeoutTimer);
    progressTimer = null;
    progressTimeoutTimer = null;
    progressStartedAt = 0;
    setFootnote(status.ready ? `Model: ${status.model}${status.cloudModel ? " (cloud)" : ""}` : (status.installing ? "Installing local model..." : (status.error || "Model is not ready")));
  }

  function startProgress(job = {}) {
    stopProgress();
    activeJobId = job.jobId || activeJobId || null;
    activeJobTimeoutMs = Number(job.timeoutMs || status.timeoutMs || activeJobTimeoutMs) || 0;
    progressStartedAt = Number(job.startedAt) || Date.now();
    const timeoutLabel = activeJobTimeoutMs ? ` / timeout ${formatDuration(activeJobTimeoutMs)}` : "";
    const tick = () => setFootnote(`Generating for ${formatDuration(Date.now() - progressStartedAt)}${timeoutLabel}`);
    tick();
    progressTimer = setInterval(tick, 1000);
    if (activeJobTimeoutMs) {
      const remainingMs = Math.max(0, activeJobTimeoutMs - (Date.now() - progressStartedAt));
      progressTimeoutTimer = setTimeout(() => {
        if (activeJobId) timedOutJobIds.add(activeJobId);
        failActiveAssistant(`RedSecAI request timed out after ${formatDuration(activeJobTimeoutMs)}. The server did not send a completion event.`);
      }, remainingMs + 1000);
    }
  }

  function finishActiveAssistant(text) {
    const content = text || activeAssistantText || "No response.";
    messages.push({ role: "assistant", content });
    saveMessages(messages);
    setActiveJob(null);
    activeJobId = null;
    activeAssistant = null;
    activeAssistantText = "";
    activeStatusText = "";
    renderMessages(messagesEl, messages);
    renderActionCards([...pendingActions.values()]);
    markUnread(1);
    send.disabled = false;
    stopProgress();
    input.focus();
  }

  function failActiveAssistant(text) {
    finishActiveAssistant(text || "RedSecAI request failed.");
  }

  function renderActionCard(action) {
    if (!action?.id) return;
    if (messagesEl.querySelector(`.redsecai-action-card[data-action-id="${CSS.escape(action.id)}"]`)) return;
    pendingActionIds.add(action.id);
    pendingActions.set(action.id, action);
    syncAlertBadge();
    const card = document.createElement("article");
    card.className = "redsecai-action-card";
    card.innerHTML = `
      <div class="redsecai-action-title">${escapeHtml(action.summary || action.tool)}</div>
      <div class="redsecai-action-meta">${escapeHtml(action.tool)} · expires ${escapeHtml(new Date((action.expiresAt || 0) * 1000).toLocaleTimeString())}</div>
      <pre class="redsecai-action-args">${escapeHtml(JSON.stringify(action.args || {}, null, 2))}</pre>
      <div class="redsecai-action-row">
        <button type="button" class="redsecai-action-confirm">Confirm</button>
        <button type="button" class="redsecai-action-dismiss">Reject</button>
      </div>
      <div class="redsecai-action-result hidden"></div>
    `;
    const confirmBtn = card.querySelector(".redsecai-action-confirm");
    const dismissBtn = card.querySelector(".redsecai-action-dismiss");
    const resultEl = card.querySelector(".redsecai-action-result");
    card.dataset.actionId = action.id;
    confirmBtn?.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      if (resultEl) {
        resultEl.className = "redsecai-action-result";
        resultEl.textContent = "Confirming...";
      }
      try {
        await confirmAction(action);
        if (resultEl) {
          resultEl.className = "redsecai-action-result success";
          resultEl.textContent = "Action completed.";
        }
        const confirmationMessage = { role: "assistant", content: `Confirmed pending action: ${action.summary || action.tool}` };
        messages.push(confirmationMessage);
        saveMessages(messages);
        appendMessage(messagesEl, confirmationMessage);
        card.remove();
      } catch (error) {
        confirmBtn.disabled = false;
        if (resultEl) {
          resultEl.className = "redsecai-action-result error";
          resultEl.textContent = error.message || "Action failed.";
        }
      }
    });
    dismissBtn?.addEventListener("click", async () => {
      dismissBtn.disabled = true;
      if (resultEl) {
        resultEl.className = "redsecai-action-result";
        resultEl.textContent = "Rejecting...";
      }
      try {
        await rejectAction(action);
        const rejectedMessage = { role: "assistant", content: `Rejected pending action: ${action.summary || action.tool}` };
        messages.push(rejectedMessage);
        saveMessages(messages);
        appendMessage(messagesEl, rejectedMessage);
        card.remove();
      } catch (error) {
        dismissBtn.disabled = false;
        if (resultEl) {
          resultEl.className = "redsecai-action-result error";
          resultEl.textContent = error.message || "Reject failed.";
        }
      }
    });
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderActionCards(actions = []) {
    let newActionCount = 0;
    actions.forEach((action) => {
      if (action?.id) {
        if (!pendingActions.has(action.id)) newActionCount += 1;
        pendingActions.set(action.id, action);
      }
    });
    syncAlertBadge();
    const seen = new Set([...messagesEl.querySelectorAll(".redsecai-action-card")].map((card) => card.dataset.actionId));
    actions
      .filter((action) => action?.id && !seen.has(action.id))
      .forEach(renderActionCard);
    return newActionCount;
  }

  async function confirmAction(action) {
    if (!action?.id) throw new Error("No pending action selected.");
    const res = await fetch(`/api/ai/actions/${encodeURIComponent(action.id)}/confirm`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.error || "Action failed.");
    pendingActions.delete(action.id);
    pendingActionIds.delete(action.id);
    syncAlertBadge();
    return body;
  }

  async function rejectAction(action) {
    if (!action?.id) throw new Error("No pending action selected.");
    const res = await fetch(`/api/ai/actions/${encodeURIComponent(action.id)}/reject`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) throw new Error(body.error || "Reject failed.");
    pendingActions.delete(action.id);
    pendingActionIds.delete(action.id);
    syncAlertBadge();
    return body;
  }

  async function fallbackPost() {
    const timeZone = rememberClientTimeZone();
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        messages,
        page: {
          path: window.location.pathname,
          title: document.title,
          timeZone,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) renderActionCards(body.pendingActions || []);
    if (res.ok) return body.message || "No response.";
    const detail = body.details?.elapsedMs ? `\n\nElapsed: ${formatDuration(body.details.elapsedMs)}.` : "";
    return (body.error || "RedSecAI is unavailable.") + detail;
  }

  const aiSocket = createRedSecAiSocket({
    onStart(message) {
      const startedAt = Number(message.startedAt) || Date.now();
      const timeoutMs = Number(message.timeoutMs || status.timeoutMs) || 0;
      setActiveJob({ jobId: message.jobId, startedAt, timeoutMs });
      send.disabled = true;
      startProgress({ jobId: message.jobId, startedAt, timeoutMs });
      ensureActiveAssistant();
      updateActiveStatus("Starting RedSecAI turn");
    },
    onStatus(message) {
      if (message.jobId && timedOutJobIds.has(message.jobId)) return;
      updateActiveStatus(message.label || "Working");
    },
    onDelta(message) {
      if (message.jobId && timedOutJobIds.has(message.jobId)) return;
      updateActiveAssistant(activeAssistantText + (message.delta || ""));
    },
    onDone(message) {
      if (message.jobId && timedOutJobIds.has(message.jobId)) return;
      finishActiveAssistant(message.message || activeAssistantText);
      renderActionCards(message.actions || []);
    },
    onError(message) {
      if (message.jobId && timedOutJobIds.has(message.jobId)) return;
      const detail = message.details?.elapsedMs ? `\n\nElapsed: ${formatDuration(message.details.elapsedMs)}.` : "";
      failActiveAssistant((message.error || "RedSecAI is unavailable.") + detail);
    },
    onSnapshot(message) {
      if (!message.jobId) return;
      if (timedOutJobIds.has(message.jobId)) return;
      if (message.error) {
        failActiveAssistant(message.error);
        return;
      }
      updateActiveAssistant(message.message || "");
      if (!message.message && Array.isArray(message.statuses) && message.statuses.length) {
        const latest = message.statuses[message.statuses.length - 1];
        updateActiveStatus(latest.label || "Working");
      }
      if (message.done) {
        finishActiveAssistant(message.message || activeAssistantText);
      } else {
        const activeJob = getActiveJob();
        startProgress({
          jobId: message.jobId,
          startedAt: activeJob?.startedAt || message.startedAt || Date.now(),
          timeoutMs: activeJob?.timeoutMs || message.timeoutMs || status.timeoutMs,
        });
      }
    },
    onActions(message) {
      renderActionCards(message.actions || []);
    },
  });

  renderActionCards(status.pendingActions || []);

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      clearUnread();
      renderActionCards([...pendingActions.values()]);
      input.focus();
    } else {
      syncAlertBadge();
    }
  });
  closeBtn.addEventListener("click", () => {
    panel.classList.add("hidden");
    syncAlertBadge();
  });
  clearBtn.addEventListener("click", () => {
    messages = [];
    saveMessages(messages);
    setActiveJob(null);
    activeAssistant = null;
    activeAssistantText = "";
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

    activeAssistant = null;
    activeAssistantText = "";
    ensureActiveAssistant();

    const jobId = createJobId();
    const startedAt = Date.now();
    activeJobId = jobId;
    setActiveJob({ jobId, startedAt, timeoutMs: status.timeoutMs || 0 });
    startProgress({ jobId, startedAt, timeoutMs: status.timeoutMs || 0 });

    try {
      const timeZone = rememberClientTimeZone();
      aiSocket.send({
        type: "redsecai_chat",
        jobId,
        messages,
        page: {
          path: window.location.pathname,
          title: document.title,
          timeZone,
        },
      });
    } catch (_) {
      try {
        const fallbackMessage = await fallbackPost();
        if (activeJobId === jobId && !timedOutJobIds.has(jobId)) finishActiveAssistant(fallbackMessage);
      } catch {
        if (activeJobId === jobId && !timedOutJobIds.has(jobId)) failActiveAssistant("RedSecAI is unavailable right now.");
      }
    }
  });

  window.addEventListener("beforeunload", () => aiSocket.close());
}

initRedSecAI();
