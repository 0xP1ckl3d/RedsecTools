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

function formatActionExpiry(expiresAtSeconds) {
  const expiresAt = Number(expiresAtSeconds) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return "expiry unknown";
  const now = Date.now();
  if (expiresAt <= now) return "expired";
  const sameDay = new Date(expiresAt).toDateString() === new Date(now).toDateString();
  const options = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  return `expires ${new Date(expiresAt).toLocaleString("en-AU", options)}`;
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

function iconSvg(name) {
  const icons = {
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4"></path><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4"></path></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"></path></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></svg>',
  };
  return icons[name] || "";
}

function createWidget(status, options = {}) {
  const mode = options.mode === "page" ? "page" : "widget";
  const isPage = mode === "page";
  const readyText = status.ready
    ? `Model: ${escapeHtml(status.model)}${status.cloudModel ? " (cloud)" : ""}`
    : escapeHtml(status.installing ? "Installing local model..." : (status.error || "Model is not ready"));
  const root = document.createElement("section");
  root.className = isPage ? "redsecai-widget redsecai-page-widget" : "redsecai-widget";
  root.innerHTML = `
    ${isPage ? "" : `<button type="button" class="redsecai-launcher" aria-label="Open RedSecAI" title="RedSecAI">
      <svg class="redsecai-launcher-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5.75C4 4.23 5.23 3 6.75 3h10.5C18.77 3 20 4.23 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H12l-4.1 3.25A.85.85 0 0 1 6.5 18.58V16A2.75 2.75 0 0 1 4 13.25v-7.5Z"></path>
        <path d="M8 8.5h8M8 11.5h5.5"></path>
      </svg>
      <span class="redsecai-launcher-mark">RedSecAI</span>
      <span class="redsecai-status-dot ${status.ready ? "ready" : "offline"}"></span>
      <span class="redsecai-alert-badge hidden" aria-hidden="true"></span>
    </button>`}
    <div class="redsecai-panel ${isPage ? "" : "hidden"}" role="${isPage ? "region" : "dialog"}" aria-label="RedSecAI assistant">
      <header class="redsecai-header">
        <div>
          <div class="redsecai-kicker">RedSecAI</div>
          <h2>Local assistant</h2>
        </div>
        <div class="redsecai-header-actions">
          <a class="redsecai-icon-btn" href="/ai?view=about" title="About RedSecAI" aria-label="About RedSecAI">${iconSvg("info")}</a>
          ${isPage ? "" : `<a class="redsecai-icon-btn" href="/ai" title="Open full page" aria-label="Open RedSecAI full page">${iconSvg("expand")}</a>`}
          <button type="button" class="redsecai-icon-btn" data-redsecai-clear title="Clear chat" aria-label="Clear chat">${iconSvg("refresh")}</button>
          ${isPage ? "" : `<button type="button" class="redsecai-icon-btn" data-redsecai-close title="Close" aria-label="Close">${iconSvg("close")}</button>`}
        </div>
      </header>
      <div class="redsecai-boundary">
        Scoped to your session. No access to vault, paste, share, or team-chat plaintext.
      </div>
      <div class="redsecai-messages" aria-live="polite"></div>
      <form class="redsecai-form">
        <textarea class="redsecai-input" rows="2" placeholder="Ask about reports, calendar, or threat intel..."></textarea>
        <button type="submit" class="redsecai-send" title="Send" aria-label="Send">${iconSvg("send")}</button>
      </form>
      <p class="redsecai-footnote">${readyText}</p>
    </div>
  `;
  if (isPage && options.mount) options.mount.appendChild(root);
  else document.body.appendChild(root);
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
  const pageMount = document.querySelector("[data-redsecai-page]");
  const pageMode = !!pageMount;
  document.getElementById("redsecai-sidebar-collapse-btn")?.addEventListener("click", () => {
    document.getElementById("redsecai-sidebar")?.classList.toggle("collapsed");
  });
  let status;
  try {
    status = await checkStatus();
  } catch (_) {
    status = null;
  }
  if (!status || status.enabled === false) {
    if (pageMode && pageMount) {
      pageMount.innerHTML = '<div class="info-box text-sm">RedSecAI is not enabled for this site.</div>';
    }
    return;
  }

  const widget = createWidget(status, { mode: pageMode ? "page" : "widget", mount: pageMount });
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
  const completedActionIds = new Set();
  let unreadCount = 0;

  renderMessages(messagesEl, messages);

  function syncMobileViewportOffset() {
    if (pageMode || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const hiddenViewportHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    widget.style.setProperty("--redsecai-mobile-keyboard-offset", `${Math.round(hiddenViewportHeight)}px`);
  }

  function isPanelOpen() {
    if (pageMode) return true;
    return !panel.classList.contains("hidden");
  }

  function syncAlertBadge() {
    const actionCount = pendingActions.size;
    const total = unreadCount + actionCount;
    if (!alertBadge || !launcher) return;
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
    if (completedActionIds.has(action.id)) return;
    if (messagesEl.querySelector(`.redsecai-action-card[data-action-id="${CSS.escape(action.id)}"]`)) return;
    pendingActionIds.add(action.id);
    pendingActions.set(action.id, action);
    syncAlertBadge();
    const card = document.createElement("article");
    card.className = "redsecai-action-card";
    card.innerHTML = `
      <div class="redsecai-action-title">${escapeHtml(action.summary || action.tool)}</div>
      <div class="redsecai-action-meta">${escapeHtml(action.tool)} · ${escapeHtml(formatActionExpiry(action.expiresAt))}</div>
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
        if (error.stale) {
          card.remove();
          const staleMessage = { role: "assistant", content: error.message || "This RedSecAI action is no longer pending." };
          messages.push(staleMessage);
          saveMessages(messages);
          appendMessage(messagesEl, staleMessage);
        }
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
        if (error.stale) card.remove();
        if (resultEl) {
          resultEl.className = "redsecai-action-result error";
          resultEl.textContent = error.message || "Reject failed.";
        }
      }
    });
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeActionCard(actionId) {
    if (!actionId) return;
    pendingActions.delete(actionId);
    pendingActionIds.delete(actionId);
    const card = messagesEl.querySelector(`.redsecai-action-card[data-action-id="${CSS.escape(actionId)}"]`);
    if (card) card.remove();
  }

  function renderActionCards(actions = [], options = {}) {
    if (options.replace) {
      const liveIds = new Set(actions.map((action) => action?.id).filter(Boolean));
      [...pendingActions.keys()].forEach((actionId) => {
        if (!liveIds.has(actionId)) removeActionCard(actionId);
      });
      [...messagesEl.querySelectorAll(".redsecai-action-card")].forEach((card) => {
        if (!liveIds.has(card.dataset.actionId)) card.remove();
      });
    }
    let newActionCount = 0;
    actions.forEach((action) => {
      if (action?.id && !completedActionIds.has(action.id)) {
        if (!pendingActions.has(action.id)) newActionCount += 1;
        pendingActions.set(action.id, action);
      }
    });
    syncAlertBadge();
    const seen = new Set([...messagesEl.querySelectorAll(".redsecai-action-card")].map((card) => card.dataset.actionId));
    actions
      .filter((action) => action?.id && !completedActionIds.has(action.id) && !seen.has(action.id))
      .forEach(renderActionCard);
    return newActionCount;
  }

  async function confirmAction(action) {
    if (!action?.id) throw new Error("No pending action selected.");
    const latest = await checkStatus();
    if (Array.isArray(latest?.pendingActions)) {
      renderActionCards(latest.pendingActions, { replace: true });
      const liveAction = latest.pendingActions.find((item) => item.id === action.id);
      if (!liveAction) {
        const error = new Error("This RedSecAI action is no longer pending. Please ask RedSecAI to prepare it again.");
        error.stale = true;
        completedActionIds.add(action.id);
        removeActionCard(action.id);
        syncAlertBadge();
        throw error;
      }
      action = liveAction;
    }
    const res = await fetch(`/api/ai/actions/${encodeURIComponent(action.id)}/confirm`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      const error = new Error(body.error || "Action failed.");
      error.stale = res.status === 404 || /not found|expired/i.test(error.message);
      if (error.stale) {
        completedActionIds.add(action.id);
        removeActionCard(action.id);
        syncAlertBadge();
      }
      throw error;
    }
    completedActionIds.add(action.id);
    removeActionCard(action.id);
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
    if (!res.ok || !body.success) {
      const error = new Error(body.error || "Reject failed.");
      error.stale = res.status === 404 || /not found|expired/i.test(error.message);
      if (error.stale) {
        completedActionIds.add(action.id);
        removeActionCard(action.id);
        syncAlertBadge();
      }
      throw error;
    }
    completedActionIds.add(action.id);
    removeActionCard(action.id);
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

  renderActionCards(status.pendingActions || [], { replace: true });

  launcher?.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      widget.classList.add("is-mobile-open");
      syncMobileViewportOffset();
      clearUnread();
      checkStatus()
        .then((latest) => {
          if (Array.isArray(latest?.pendingActions)) renderActionCards(latest.pendingActions, { replace: true });
          else renderActionCards([...pendingActions.values()]);
        })
        .catch(() => renderActionCards([...pendingActions.values()]));
      input.focus();
    } else {
      widget.classList.remove("is-mobile-open");
      widget.style.removeProperty("--redsecai-mobile-keyboard-offset");
      syncAlertBadge();
    }
  });
  closeBtn?.addEventListener("click", () => {
    panel.classList.add("hidden");
    widget.classList.remove("is-mobile-open");
    widget.style.removeProperty("--redsecai-mobile-keyboard-offset");
    syncAlertBadge();
  });
  clearBtn?.addEventListener("click", () => {
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

  window.visualViewport?.addEventListener("resize", syncMobileViewportOffset);
  window.visualViewport?.addEventListener("scroll", syncMobileViewportOffset);
  window.addEventListener("resize", syncMobileViewportOffset);
  window.addEventListener("beforeunload", () => aiSocket.close());
}

initRedSecAI();
