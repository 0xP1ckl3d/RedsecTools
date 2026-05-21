import { ensureHljs, highlightCode, updateGutter } from "./lib/hljs-loader.js";

let popupState = null;
let pendingMfa = null;
let detailEntry = null;
let selectedShareFiles = [];
let activeToolTab = "vault";
let mfaSubmitting = false;
let loginOverrideMode = false;

const activeFilters = {
  query: "",
  vaultId: "all",
  itemType: "password",
};

const revealedSecrets = new Set();
const MAX_SHARE_FILES = 20;
const MAX_SHARE_TOTAL_BYTES = 250 * 1024 * 1024;

const views = {
  login: document.getElementById("login-view"),
  mfa: document.getElementById("mfa-view"),
  locked: document.getElementById("locked-view"),
  unlocked: document.getElementById("unlocked-view"),
};

const toolPanels = {
  vault: document.getElementById("tab-panel-vault"),
  paste: document.getElementById("tab-panel-paste"),
  share: document.getElementById("tab-panel-share"),
};

const headerActions = document.getElementById("header-actions");
const subtitle = document.getElementById("subtitle");
const toast = document.getElementById("toast");
const inlineToggleRow = document.getElementById("inline-toggle-row");
const inlineSuggestionToggle = document.getElementById("inline-suggestion-toggle");
const vaultDashboard = document.getElementById("vault-dashboard");
const entryDetailView = document.getElementById("entry-detail-view");
const pasteWorkspace = document.getElementById("paste-workspace");
const pastePreviewView = document.getElementById("paste-preview-view");
const detailContent = document.getElementById("detail-content");
const detailEditForm = document.getElementById("detail-edit-form");
const mfaDigits = Array.from(document.querySelectorAll(".mfa-digit"));

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2500);
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove("hidden");
}

function clearError(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.classList.add("hidden");
}

function setActiveView(name) {
  Object.values(views).forEach((view) => {
    view.classList.remove("active");
    view.classList.add("hidden");
  });
  views[name].classList.remove("hidden");
  views[name].classList.add("active");
  headerActions.classList.toggle("hidden", name !== "unlocked");
}

function setToolTab(tabName) {
  activeToolTab = tabName;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  Object.entries(toolPanels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === tabName);
    panel.classList.toggle("hidden", name !== tabName);
  });
}

async function sendMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.success) {
    throw new Error(response?.error || "Unexpected extension error");
  }
  return response;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function maskSecret(value) {
  const length = Math.max(8, Math.min(18, String(value || "").length || 8));
  return "•".repeat(length);
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) && numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getDisplayDomain(value) {
  const input = String(value || "").trim();
  if (!input) return "";

  try {
    return new URL(input).hostname || input;
  } catch {
    return input;
  }
}

function fieldRevealKey(entry, field) {
  return `${entry.refId}:${field.copyField}:${field.label}`;
}

function getFieldDisplayValue(entry, field) {
  if (!field.secret) return field.value || "";
  return revealedSecrets.has(fieldRevealKey(entry, field)) ? field.value || "" : maskSecret(field.value);
}

function clearSensitiveFields() {
  document.getElementById("login-password").value = "";
  document.getElementById("unlock-password").value = "";
  document.getElementById("mfa-recovery").value = "";
  document.getElementById("mfa-remember-device").checked = false;
  mfaDigits.forEach((input) => {
    input.value = "";
  });
}

function renderLoginMode(state) {
  const rememberedLogin = state.rememberedLogin || null;
  const compactLogin = !!(rememberedLogin && !loginOverrideMode);

  document.getElementById("remembered-login").classList.toggle("hidden", !compactLogin);
  document.getElementById("base-url-field").classList.toggle("hidden", compactLogin);
  document.getElementById("login-email-field").classList.toggle("hidden", compactLogin);

  document.getElementById("base-url").value = rememberedLogin?.baseUrl || state.baseUrl || "";
  document.getElementById("login-email").value = rememberedLogin?.email || "";
  document.getElementById("remembered-email").textContent = rememberedLogin?.email || "";
  document.getElementById("remembered-server").textContent = rememberedLogin?.baseUrl || "";
}

function resetPasteForm() {
  document.getElementById("paste-content").value = "";
  document.getElementById("paste-syntax").value = "plaintext";
  document.getElementById("paste-expiry").value = "86400";
  document.getElementById("paste-password").value = "";
  document.getElementById("paste-password").type = "password";
  document.getElementById("toggle-paste-password-btn").textContent = "Reveal";
  document.getElementById("paste-burn").checked = false;
  pasteWorkspace.classList.remove("hidden");
  pastePreviewView.classList.add("hidden");
  document.getElementById("paste-form").classList.remove("hidden");
  document.getElementById("paste-result").classList.add("hidden");
  document.getElementById("paste-result-url").value = "";
  document.getElementById("paste-preview-content").textContent = "";
  document.getElementById("paste-preview-content").classList.remove("hljs");
  document.getElementById("paste-preview-gutter").innerHTML = "";
  clearError("paste-error");
}

function resetShareForm() {
  selectedShareFiles = [];
  document.getElementById("share-files").value = "";
  document.getElementById("share-expiry").value = "86400";
  document.getElementById("share-password").value = "";
  document.getElementById("share-password").type = "password";
  document.getElementById("toggle-share-password-btn").textContent = "Reveal";
  document.getElementById("share-burn").checked = false;
  document.getElementById("share-form").classList.remove("hidden");
  document.getElementById("share-result").classList.add("hidden");
  document.getElementById("share-result-url").value = "";
  renderSelectedShareFiles();
  clearError("share-error");
}

function initializeMfaMode(mode = "code") {
  document.querySelectorAll("[data-mfa-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mfaMode === mode);
  });
  const recovery = mode === "recovery";
  document.getElementById("mfa-code-row").classList.toggle("hidden", recovery);
  document.getElementById("mfa-recovery-row").classList.toggle("hidden", !recovery);
  document.getElementById("mfa-submit").classList.toggle("hidden", !recovery);
}

async function initialize() {
  const response = await sendMessage("initializePopup");
  renderState(response.state);
}

function hideDetailView() {
  detailEntry = null;
  vaultDashboard.classList.remove("hidden");
  entryDetailView.classList.add("hidden");
  detailContent.classList.remove("hidden");
  detailEditForm.classList.add("hidden");
  clearError("edit-error");
}

function showDetailView() {
  vaultDashboard.classList.add("hidden");
  entryDetailView.classList.remove("hidden");
}

function hidePastePreviewView() {
  pastePreviewView.classList.add("hidden");
  pasteWorkspace.classList.remove("hidden");
}

function showPastePreviewView() {
  pasteWorkspace.classList.add("hidden");
  pastePreviewView.classList.remove("hidden");
}

function renderState(state) {
  popupState = state;
  hideDetailView();
  hidePastePreviewView();
  clearSensitiveFields();
  document.getElementById("open-server-link").classList.toggle("has-link", state.mode === "unlocked" && !!state.baseUrl);

  if (state.mode === "signed_out") {
    setActiveView("login");
    subtitle.textContent = "Sign in.";
    inlineToggleRow.classList.add("hidden");
    loginOverrideMode = false;
    renderLoginMode(state);
    initializeMfaMode("code");
    return;
  }

  if (state.mode === "locked") {
    setActiveView("locked");
    subtitle.textContent = `Signed in as ${state.user?.username || "user"}`;
    inlineToggleRow.classList.add("hidden");
    return;
  }

  if (state.mode === "unlocked") {
    setActiveView("unlocked");
    subtitle.textContent = "Vault, paste, and share.";
    inlineToggleRow.classList.remove("hidden");
    loadInlineSuggestionSetting();
    document.getElementById("user-label").textContent = state.user?.username || "";
    document.getElementById("entry-count-label").textContent = `${state.entryCount}`;
    document.getElementById("site-label").textContent = getDisplayDomain(state.currentPageUrl) || "Open a website tab";
    document.getElementById("save-sheet").classList.add("hidden");
    document.getElementById("save-current-site-btn").textContent = "Add";
    populateSelect(
      document.getElementById("save-vault"),
      state.writableVaults || [],
      state.writableVaults?.[0]?.id || "",
    );
    populateSelect(document.getElementById("vault-filter"), state.vaultFilters || [], "all");
    populateSelect(document.getElementById("type-filter"), state.typeFilters || [], "password");
    renderSiteSuggestions(state.currentSiteSuggestions || []);
    activeFilters.query = "";
    activeFilters.vaultId = "all";
    activeFilters.itemType = "password";
    document.getElementById("search-input").value = "";
    setToolTab("vault");
    resetPasteForm();
    resetShareForm();
    runSearch().catch((error) => showToast(error.message));
  }
}

function populateSelect(select, options, selectedValue) {
  const html = (options || []).map((option) => {
    const label = option.label || option.name || option.title || "Vault";
    return `<option value="${escapeAttr(option.id)}">${escapeHtml(label)}</option>`;
  }).join("");
  select.innerHTML = html;
  if (selectedValue) {
    select.value = selectedValue;
  }
}

function renderSiteSuggestions(entries) {
  const container = document.getElementById("site-suggestions");
  if (!entries.length) {
    container.innerHTML = `<div class="entry-card"><div class="entry-card-body"><p class="entry-subtitle">No host-matched credentials for the current site.</p></div></div>`;
    return;
  }
  container.innerHTML = entries.map((entry) => renderEntryCard(entry, true)).join("");
  bindEntryActions(container);
}

function renderSearchResults(entries) {
  const container = document.getElementById("search-results");
  if (!entries.length) {
    container.innerHTML = `<div class="entry-card"><div class="entry-card-body"><p class="entry-subtitle">No entries matched the current search and filters.</p></div></div>`;
    return;
  }
  container.innerHTML = entries.map((entry) => renderEntryCard(entry, false)).join("");
  bindEntryActions(container);
}

function renderEntryCard(entry, compact) {
  const subtitleParts = [
    entry.username,
    getDisplayDomain(entry.url),
    entry.fromUsername ? `shared by ${entry.fromUsername}` : "",
  ].filter(Boolean);
  const subtitleHtml = subtitleParts.length
    ? `<p class="entry-subtitle">${escapeHtml(subtitleParts.join(" · "))}</p>`
    : "";
  const badges = [
    entry.typeLabel,
    entry.vaultName,
    entry.matchLevel && entry.matchLevel !== "none" ? `${entry.matchLevel} match` : "",
  ].filter(Boolean);

  const actionButtons = [];
  if (entry.canFill) {
    actionButtons.push(`<button type="button" class="btn btn-secondary btn-small" data-action="fill" data-ref="${escapeAttr(entry.refId)}">Fill</button>`);
  }
  if (entry.username) {
    actionButtons.push(`<button type="button" class="btn btn-secondary btn-small" data-action="copy" data-field="username" data-ref="${escapeAttr(entry.refId)}">Copy User</button>`);
  }
  if (entry.type === "password" || entry.type === "api_key" || entry.type === "ssh_key") {
    actionButtons.push(`<button type="button" class="btn btn-secondary btn-small" data-action="copy" data-field="password" data-ref="${escapeAttr(entry.refId)}">Copy Secret</button>`);
  }
  if (entry.canCopyTotp) {
    actionButtons.push(`<button type="button" class="btn btn-secondary btn-small" data-action="copy" data-field="totp" data-ref="${escapeAttr(entry.refId)}">Copy TOTP</button>`);
  }
  actionButtons.push(`<button type="button" class="btn btn-ghost btn-small" data-action="details" data-ref="${escapeAttr(entry.refId)}">${compact ? "Details" : "Open Details"}</button>`);

  return `
    <article class="entry-card">
      <div class="entry-card-body">
        <div class="entry-top">
          <div class="entry-title-wrap">
            <h3 class="entry-title">${escapeHtml(entry.title)}</h3>
            <div class="entry-badges">
              ${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}
            </div>
            ${subtitleHtml}
          </div>
        </div>
        <div class="entry-actions">${actionButtons.join("")}</div>
      </div>
    </article>
  `;
}

function bindEntryActions(container) {
  container.querySelectorAll("[data-action='fill']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await sendMessage("fillEntry", { refId: button.dataset.ref });
        showToast("Credentials filled on the current page");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  container.querySelectorAll("[data-action='copy']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const response = await sendMessage("copyField", {
          refId: button.dataset.ref,
          field: button.dataset.field,
        });
        await navigator.clipboard.writeText(response.value || "");
        showToast("Copied to clipboard");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  container.querySelectorAll("[data-action='details']").forEach((button) => {
    button.addEventListener("click", () => {
      openEntryDetail(button.dataset.ref).catch((error) => showToast(error.message));
    });
  });
}

async function runSearch() {
  if (!popupState || popupState.mode !== "unlocked") return;
  const response = await sendMessage("searchEntries", activeFilters);
  renderSearchResults(response.results || []);
}

function toggleSaveSheet(show) {
  const sheet = document.getElementById("save-sheet");
  const nextState = typeof show === "boolean" ? show : sheet.classList.contains("hidden");
  sheet.classList.toggle("hidden", !nextState);
  document.getElementById("save-current-site-btn").textContent = nextState ? "Hide" : "Add";
}

async function openSaveSheet() {
  clearError("save-error");
  const sheet = document.getElementById("save-sheet");
  if (!sheet.classList.contains("hidden")) {
    toggleSaveSheet(false);
    return;
  }
  if (!popupState?.writableVaults?.length) {
    showToast("Unlock at least one writable vault first");
    return;
  }

  const response = await sendMessage("getCurrentSiteContext");
  const pageUrl = response.pageUrl || popupState.currentPageUrl || "";
  const parsedUrl = pageUrl ? new URL(pageUrl) : null;
  const hostname = parsedUrl?.hostname || "";
  const siteOrigin = parsedUrl?.origin || "";
  const form = response.formContext || {};

  document.getElementById("save-title").value = response.pageTitle || hostname || "New Login";
  document.getElementById("save-username").value = form.username || "";
  document.getElementById("save-password").value = form.password || "";
  document.getElementById("save-password").type = "password";
  document.getElementById("toggle-save-password-btn").textContent = "Reveal";
  document.getElementById("save-url").value = siteOrigin;
  document.getElementById("save-notes").value = "";
  document.getElementById("save-favorite").checked = false;
  toggleSaveSheet(true);
}

async function openEntryDetail(refId) {
  const response = await sendMessage("getEntryDetail", { refId });
  detailEntry = response.entry;
  renderDetailEntry();
  showDetailView();
}

function renderDetailEntry() {
  if (!detailEntry) return;

  document.getElementById("detail-edit-btn").classList.toggle("hidden", !detailEntry.editable);
  detailContent.classList.remove("hidden");
  detailEditForm.classList.add("hidden");

  const badges = [
    detailEntry.typeLabel,
    detailEntry.vaultName,
    detailEntry.matchLevel && detailEntry.matchLevel !== "none" ? `${detailEntry.matchLevel} match` : "",
  ].filter(Boolean);

  detailContent.innerHTML = `
    <div class="stack">
      <div>
        <h2 class="detail-title">${escapeHtml(detailEntry.title)}</h2>
        <div class="entry-badges" style="margin-top: 10px;">
          ${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}
        </div>
        <p class="detail-helper">${escapeHtml(detailEntry.fromUsername ? `Shared by ${detailEntry.fromUsername}` : "Full item details are shown below.")}</p>
      </div>
      <div class="detail-meta">
        <div class="detail-meta-card">
          <strong>Created</strong>
          <span class="detail-helper">${escapeHtml(formatDateTime(detailEntry.createdAt))}</span>
        </div>
        <div class="detail-meta-card">
          <strong>Updated</strong>
          <span class="detail-helper">${escapeHtml(formatDateTime(detailEntry.updatedAt))}</span>
        </div>
      </div>
      <div class="detail-field-list">
        ${detailEntry.fields.map((field) => renderDetailField(detailEntry, field)).join("")}
      </div>
    </div>
  `;

  bindDetailActions();
}

function renderDetailField(entry, field) {
  const revealed = revealedSecrets.has(fieldRevealKey(entry, field));
  const displayValue = getFieldDisplayValue(entry, field);
  const valueClass = field.secret && !revealed ? "detail-field-value detail-field-secret" : "detail-field-value";

  return `
    <article class="detail-field-card">
      <span class="detail-field-label">${escapeHtml(field.label)}</span>
      <pre class="${valueClass}">${escapeHtml(displayValue)}</pre>
      <div class="field-inline-actions">
        ${field.secret ? `<button type="button" class="btn btn-ghost btn-small" data-detail-action="toggle-secret" data-secret-key="${escapeAttr(fieldRevealKey(entry, field))}">${revealed ? "Hide" : "Reveal"}</button>` : ""}
        <button type="button" class="btn btn-secondary btn-small" data-detail-action="copy" data-ref="${escapeAttr(entry.refId)}" data-field="${escapeAttr(field.copyField)}">Copy</button>
      </div>
    </article>
  `;
}

function bindDetailActions() {
  detailContent.querySelectorAll("[data-detail-action='copy']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const response = await sendMessage("copyField", {
          refId: button.dataset.ref,
          field: button.dataset.field,
        });
        await navigator.clipboard.writeText(response.value || "");
        showToast("Copied to clipboard");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  detailContent.querySelectorAll("[data-detail-action='toggle-secret']").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.secretKey;
      if (revealedSecrets.has(key)) revealedSecrets.delete(key);
      else revealedSecrets.add(key);
      renderDetailEntry();
    });
  });
}

function buildEditFieldHtml(entry) {
  const data = entry.data || {};

  switch (entry.type) {
    case "password":
      return `
        <div class="edit-grid-two">
          <label class="field">
            <span>Username / Email</span>
            <input id="edit-username" type="text" value="${escapeAttr(data.username || "")}">
          </label>
          <label class="field">
            <span>URL</span>
            <input id="edit-url" type="url" value="${escapeAttr(data.url || "")}">
          </label>
        </div>
        <label class="field">
          <span>Password</span>
          <div class="secret-input-row">
            <input id="edit-password" type="password" value="${escapeAttr(data.password || "")}">
            <button type="button" class="btn btn-ghost btn-square" data-toggle-input="edit-password">Reveal</button>
          </div>
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
    case "note":
      return `
        <label class="field">
          <span>Note</span>
          <textarea id="edit-content">${escapeHtml(data.content || "")}</textarea>
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
    case "api_key":
      return `
        <div class="edit-grid-two">
          <label class="field">
            <span>Service</span>
            <input id="edit-service" type="text" value="${escapeAttr(data.service || "")}">
          </label>
          <label class="field">
            <span>API Key</span>
            <div class="secret-input-row">
              <input id="edit-key" type="password" value="${escapeAttr(data.key || "")}">
              <button type="button" class="btn btn-ghost btn-square" data-toggle-input="edit-key">Reveal</button>
            </div>
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
    case "ssh_key":
      return `
        <label class="field">
          <span>Private Key</span>
          <textarea id="edit-private-key">${escapeHtml(data.private_key || "")}</textarea>
        </label>
        <label class="field">
          <span>Public Key</span>
          <textarea id="edit-public-key">${escapeHtml(data.public_key || "")}</textarea>
        </label>
        <label class="field">
          <span>Passphrase</span>
          <div class="secret-input-row">
            <input id="edit-passphrase" type="password" value="${escapeAttr(data.passphrase || "")}">
            <button type="button" class="btn btn-ghost btn-square" data-toggle-input="edit-passphrase">Reveal</button>
          </div>
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
    case "totp":
      return `
        <div class="edit-grid-two">
          <label class="field">
            <span>Issuer</span>
            <input id="edit-issuer" type="text" value="${escapeAttr(data.issuer || "")}">
          </label>
          <label class="field">
            <span>Account</span>
            <input id="edit-account" type="text" value="${escapeAttr(data.account || "")}">
          </label>
        </div>
        <label class="field">
          <span>Secret</span>
          <div class="secret-input-row">
            <input id="edit-secret" type="password" value="${escapeAttr(data.secret || "")}">
            <button type="button" class="btn btn-ghost btn-square" data-toggle-input="edit-secret">Reveal</button>
          </div>
        </label>
        <div class="edit-grid-two">
          <label class="field">
            <span>Digits</span>
            <input id="edit-digits" type="number" min="6" max="8" value="${escapeAttr(String(data.digits || 6))}">
          </label>
          <label class="field">
            <span>Notes</span>
            <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
          </label>
        </div>
      `;
    case "custom":
      return `
        <div id="edit-custom-fields" class="stack">
          ${(data.fields || []).map((field, index) => renderCustomFieldRow(index, field)).join("")}
        </div>
        <button type="button" id="add-custom-field-btn" class="btn btn-ghost">Add Field</button>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
    default:
      return `
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-notes">${escapeHtml(data.notes || "")}</textarea>
        </label>
      `;
  }
}

function renderCustomFieldRow(index, field = {}) {
  return `
    <div class="custom-field-row" data-custom-field="${index}">
      <input class="custom-field-label" type="text" placeholder="Label" value="${escapeAttr(field.label || "")}">
      <input class="custom-field-value" type="${field.type === "password" ? "password" : "text"}" placeholder="Value" value="${escapeAttr(field.value || "")}">
      <select class="custom-field-type">
        <option value="text" ${field.type === "text" ? "selected" : ""}>Text</option>
        <option value="password" ${field.type === "password" ? "selected" : ""}>Password</option>
        <option value="url" ${field.type === "url" ? "selected" : ""}>URL</option>
        <option value="email" ${field.type === "email" ? "selected" : ""}>Email</option>
      </select>
      <button type="button" class="btn btn-ghost btn-small" data-remove-custom-field="${index}">Remove</button>
    </div>
  `;
}

function startEditingEntry() {
  if (!detailEntry?.editable) return;
  clearError("edit-error");
  detailContent.classList.add("hidden");
  detailEditForm.classList.remove("hidden");
  document.getElementById("edit-title").value = detailEntry.title || "";
  document.getElementById("edit-favorite").checked = !!detailEntry.favorite;
  document.getElementById("edit-dynamic-fields").innerHTML = buildEditFieldHtml(detailEntry);
  bindEditFieldActions();
}

function bindEditFieldActions() {
  detailEditForm.querySelectorAll("[data-toggle-input]").forEach((button) => {
    button.onclick = () => {
      const input = document.getElementById(button.dataset.toggleInput);
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      button.textContent = input.type === "password" ? "Reveal" : "Hide";
    };
  });

  const addCustomFieldBtn = document.getElementById("add-custom-field-btn");
  if (addCustomFieldBtn) {
    addCustomFieldBtn.onclick = () => {
      const container = document.getElementById("edit-custom-fields");
      const index = container.querySelectorAll("[data-custom-field]").length;
      container.insertAdjacentHTML("beforeend", renderCustomFieldRow(index));
      bindEditFieldActions();
    };
  }

  detailEditForm.querySelectorAll("[data-remove-custom-field]").forEach((button) => {
    button.onclick = () => {
      button.closest("[data-custom-field]")?.remove();
    };
  });
}

function collectEditedData(entry) {
  switch (entry.type) {
    case "password": {
      const data = {
        username: document.getElementById("edit-username").value.trim(),
        password: document.getElementById("edit-password").value,
        url: document.getElementById("edit-url").value.trim(),
      };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    case "note": {
      const data = { content: document.getElementById("edit-content").value };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    case "api_key": {
      const data = {
        service: document.getElementById("edit-service").value.trim(),
        key: document.getElementById("edit-key").value,
      };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    case "ssh_key": {
      const data = {
        private_key: document.getElementById("edit-private-key").value,
        public_key: document.getElementById("edit-public-key").value,
        passphrase: document.getElementById("edit-passphrase").value,
      };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    case "totp": {
      const data = {
        issuer: document.getElementById("edit-issuer").value.trim(),
        account: document.getElementById("edit-account").value.trim(),
        secret: document.getElementById("edit-secret").value.trim().toUpperCase(),
        digits: parseInt(document.getElementById("edit-digits").value, 10) || 6,
        period: detailEntry.data?.period || 30,
        algorithm: detailEntry.data?.algorithm || "SHA-1",
      };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    case "custom": {
      const fields = Array.from(document.querySelectorAll("[data-custom-field]")).map((row) => ({
        label: row.querySelector(".custom-field-label")?.value.trim() || "",
        value: row.querySelector(".custom-field-value")?.value || "",
        type: row.querySelector(".custom-field-type")?.value || "text",
      })).filter((field) => field.label || field.value);
      const data = { fields };
      const notes = document.getElementById("edit-notes").value;
      if (notes) data.notes = notes;
      return data;
    }
    default: {
      const data = {};
      const notes = document.getElementById("edit-notes")?.value;
      if (notes) data.notes = notes;
      return data;
    }
  }
}

function collectMfaCode() {
  return mfaDigits.map((input) => input.value).join("");
}

async function submitMfaCode({ recoveryCode = "" } = {}) {
  clearError("mfa-error");
  if (!pendingMfa || mfaSubmitting) return;
  mfaSubmitting = true;

  try {
    const response = await sendMessage("completeMfa", {
      baseUrl: pendingMfa.baseUrl,
      tempToken: pendingMfa.tempToken,
      password: pendingMfa.password,
      code: recoveryCode ? "" : collectMfaCode(),
      recoveryCode,
      rememberBrowser: document.getElementById("mfa-remember-device").checked,
    });
    pendingMfa = null;
    mfaSubmitting = false;
    renderState(response.state);
    showToast("Vault unlocked");
  } catch (error) {
    mfaSubmitting = false;
    showError("mfa-error", error.message);
  }
}

function bindMfaDigits() {
  mfaDigits.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      if (input.value && index < mfaDigits.length - 1) {
        mfaDigits[index + 1].focus();
      }
      if (collectMfaCode().length === 6) {
        submitMfaCode().catch((error) => showError("mfa-error", error.message));
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        mfaDigits[index - 1].focus();
      }
    });

    input.addEventListener("paste", (event) => {
      const pasted = (event.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      if (!pasted) return;
      event.preventDefault();
      pasted.split("").forEach((digit, digitIndex) => {
        if (mfaDigits[digitIndex]) {
          mfaDigits[digitIndex].value = digit;
        }
      });
      const nextIndex = Math.min(pasted.length, 5);
      mfaDigits[nextIndex].focus();
      if (collectMfaCode().length === 6) {
        submitMfaCode().catch((error) => showError("mfa-error", error.message));
      }
    });
  });
}

function renderSelectedShareFiles() {
  const summary = document.getElementById("share-file-summary");
  const list = document.getElementById("share-file-list");

  if (!selectedShareFiles.length) {
    summary.textContent = "No files selected yet.";
    list.innerHTML = "";
    return;
  }

  const totalBytes = selectedShareFiles.reduce((sum, file) => sum + file.size, 0);
  summary.textContent = `${selectedShareFiles.length} file${selectedShareFiles.length === 1 ? "" : "s"} selected · ${formatBytes(totalBytes)}`;
  list.innerHTML = selectedShareFiles.map((file, index) => `
    <div class="file-chip">
      <span>${escapeHtml(file.name)} · ${escapeHtml(formatBytes(file.size))}</span>
      <button type="button" class="btn btn-ghost btn-small" data-remove-share-file="${index}">Remove</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-remove-share-file]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedShareFiles.splice(parseInt(button.dataset.removeShareFile, 10), 1);
      renderSelectedShareFiles();
    });
  });
}

async function handlePasteCreate() {
  clearError("paste-error");
  const button = document.getElementById("create-paste-btn");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Creating...";

  try {
    const response = await sendMessage("createPaste", {
      content: document.getElementById("paste-content").value,
      password: document.getElementById("paste-password").value,
      burnAfterReading: document.getElementById("paste-burn").checked,
      expiresIn: document.getElementById("paste-expiry").value,
      syntax: document.getElementById("paste-syntax").value,
    });
    document.getElementById("paste-result-url").value = response.url;
    document.getElementById("paste-form").classList.add("hidden");
    document.getElementById("paste-result").classList.remove("hidden");
    showToast("Paste link created");
  } catch (error) {
    showError("paste-error", error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function renderPastePreview() {
  clearError("paste-error");
  const content = document.getElementById("paste-content").value;
  if (!content.trim()) {
    showError("paste-error", "Enter some content first.");
    return;
  }

  const syntax = document.getElementById("paste-syntax").value;
  const previewScroll = document.getElementById("paste-preview-scroll");
  const gutter = document.getElementById("paste-preview-gutter");
  const preview = document.getElementById("paste-preview-content");
  const lineCount = content.split("\n").length;
  updateGutter(gutter, lineCount);

  const loaded = await ensureHljs(syntax).catch(() => false);
  const highlighted = loaded ? highlightCode(content, syntax) : null;
  if (highlighted) {
    preview.classList.add("hljs");
    preview.innerHTML = highlighted;
  } else {
    preview.classList.remove("hljs");
    preview.textContent = content;
  }

  previewScroll.scrollTop = 0;
  previewScroll.scrollLeft = 0;
  showPastePreviewView();
}

async function handleShareCreate() {
  clearError("share-error");
  if (!selectedShareFiles.length) {
    showError("share-error", "Select at least one file.");
    return;
  }

  const button = document.getElementById("create-share-btn");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Creating...";

  try {
    const files = [];
    for (const file of selectedShareFiles) {
      files.push({
        name: file.name,
        type: file.type,
        size: file.size,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      });
    }

    const response = await sendMessage("createShare", {
      files,
      password: document.getElementById("share-password").value,
      burnAfterReading: document.getElementById("share-burn").checked,
      expiresIn: document.getElementById("share-expiry").value,
    });
    document.getElementById("share-result-url").value = response.url;
    document.getElementById("share-form").classList.add("hidden");
    document.getElementById("share-result").classList.remove("hidden");
    showToast("Share link created");
  } catch (error) {
    showError("share-error", error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError("login-error");
  try {
    const response = await sendMessage("login", {
      baseUrl: document.getElementById("base-url").value,
      email: document.getElementById("login-email").value,
      password: document.getElementById("login-password").value,
      keepSignedIn: document.getElementById("keep-signed-in").checked,
    });

    if (response.result?.mfaRequired) {
      pendingMfa = {
        baseUrl: response.baseUrl,
        tempToken: response.result.tempToken,
        password: document.getElementById("login-password").value,
      };
      clearSensitiveFields();
      initializeMfaMode("code");
      clearError("mfa-error");
      setActiveView("mfa");
      subtitle.textContent = "Enter the MFA challenge to finish sign-in.";
      mfaDigits[0].focus();
      return;
    }

    if (response.result?.mfaSetupRequired) {
      showError("login-error", "Complete MFA setup in the web app before using the extension.");
      return;
    }

    renderState(response.state);
    showToast("Vault unlocked");
  } catch (error) {
    showError("login-error", error.message);
  }
});

document.querySelectorAll("[data-mfa-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    initializeMfaMode(button.dataset.mfaMode);
    clearError("mfa-error");
    if (button.dataset.mfaMode === "code") {
      clearSensitiveFields();
      mfaDigits[0].focus();
    } else {
      document.getElementById("mfa-recovery").focus();
    }
  });
});

document.getElementById("mfa-back").addEventListener("click", () => {
  pendingMfa = null;
  clearSensitiveFields();
  setActiveView("login");
});

document.getElementById("mfa-submit").addEventListener("click", async () => {
  await submitMfaCode({ recoveryCode: document.getElementById("mfa-recovery").value.trim() });
});

document.getElementById("switch-account-btn").addEventListener("click", () => {
  loginOverrideMode = true;
  if (popupState?.mode === "signed_out") {
    renderLoginMode(popupState);
  }
  document.getElementById("base-url").focus();
});

document.getElementById("unlock-submit").addEventListener("click", async () => {
  clearError("unlock-error");
  try {
    const response = await sendMessage("unlock", {
      password: document.getElementById("unlock-password").value,
    });
    renderState(response.state);
    showToast("Vault unlocked");
  } catch (error) {
    showError("unlock-error", error.message);
  }
});

document.getElementById("lock-btn").addEventListener("click", async () => {
  await sendMessage("lock");
  renderState((await sendMessage("initializePopup")).state);
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await sendMessage("logout");
  renderState((await sendMessage("initializePopup")).state);
});

document.getElementById("open-server-link").addEventListener("click", async () => {
  if (popupState?.mode !== "unlocked" || !popupState?.baseUrl) return;
  try {
    await sendMessage("openServerApp");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => setToolTab(button.dataset.tab));
});

document.getElementById("search-input").addEventListener("input", (event) => {
  activeFilters.query = event.target.value;
  runSearch().catch((error) => showToast(error.message));
});

document.getElementById("vault-filter").addEventListener("change", (event) => {
  activeFilters.vaultId = event.target.value;
  runSearch().catch((error) => showToast(error.message));
});

document.getElementById("type-filter").addEventListener("change", (event) => {
  activeFilters.itemType = event.target.value;
  runSearch().catch((error) => showToast(error.message));
});

document.getElementById("save-current-site-btn").addEventListener("click", () => {
  openSaveSheet().catch((error) => showToast(error.message));
});

document.getElementById("cancel-save-btn").addEventListener("click", () => {
  toggleSaveSheet(false);
});

document.getElementById("toggle-save-password-btn").addEventListener("click", () => {
  const input = document.getElementById("save-password");
  input.type = input.type === "password" ? "text" : "password";
  document.getElementById("toggle-save-password-btn").textContent = input.type === "password" ? "Reveal" : "Hide";
});

document.getElementById("generate-password-btn").addEventListener("click", async () => {
  try {
    const response = await sendMessage("generatePassword", { length: 24 });
    const input = document.getElementById("save-password");
    input.value = response.password;
    input.type = "password";
    document.getElementById("toggle-save-password-btn").textContent = "Reveal";
    await sendMessage("fillGeneratedPassword", { password: response.password });
    showToast(`Generated password (${response.entropy} bits)`);
  } catch (error) {
    showToast(error.message);
  }
});

document.getElementById("save-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError("save-error");
  try {
    await sendMessage("saveCurrentSite", {
      vaultId: document.getElementById("save-vault").value,
      title: document.getElementById("save-title").value,
      username: document.getElementById("save-username").value,
      password: document.getElementById("save-password").value,
      url: document.getElementById("save-url").value,
      notes: document.getElementById("save-notes").value,
      favorite: document.getElementById("save-favorite").checked,
    });
    toggleSaveSheet(false);
    renderState((await sendMessage("initializePopup")).state);
    showToast("Login saved to vault");
  } catch (error) {
    showError("save-error", error.message);
  }
});

document.getElementById("detail-back-btn").addEventListener("click", () => {
  hideDetailView();
});

document.getElementById("detail-edit-btn").addEventListener("click", () => {
  startEditingEntry();
});

document.getElementById("cancel-edit-btn").addEventListener("click", () => {
  renderDetailEntry();
});

document.getElementById("detail-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError("edit-error");
  if (!detailEntry) return;

  try {
    const refId = detailEntry.refId;
    await sendMessage("updateEntry", {
      refId,
      title: document.getElementById("edit-title").value.trim(),
      favorite: document.getElementById("edit-favorite").checked,
      folder: detailEntry.folder || null,
      data: collectEditedData(detailEntry),
    });

    const refreshedState = (await sendMessage("initializePopup")).state;
    renderState(refreshedState);
    await openEntryDetail(refId);
    showToast("Entry updated");
  } catch (error) {
    showError("edit-error", error.message);
  }
});

document.getElementById("toggle-paste-password-btn").addEventListener("click", () => {
  const input = document.getElementById("paste-password");
  input.type = input.type === "password" ? "text" : "password";
  document.getElementById("toggle-paste-password-btn").textContent = input.type === "password" ? "Reveal" : "Hide";
});

document.getElementById("toggle-share-password-btn").addEventListener("click", () => {
  const input = document.getElementById("share-password");
  input.type = input.type === "password" ? "text" : "password";
  document.getElementById("toggle-share-password-btn").textContent = input.type === "password" ? "Reveal" : "Hide";
});

document.getElementById("create-paste-btn").addEventListener("click", () => {
  handlePasteCreate().catch((error) => showError("paste-error", error.message));
});

document.getElementById("toggle-paste-preview-btn").addEventListener("click", () => {
  renderPastePreview().catch((error) => showError("paste-error", error.message));
});

document.getElementById("paste-preview-back-btn").addEventListener("click", () => {
  hidePastePreviewView();
});

document.getElementById("copy-paste-link-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.getElementById("paste-result-url").value);
  showToast("Paste link copied");
});

document.getElementById("new-paste-btn").addEventListener("click", () => {
  resetPasteForm();
});

document.getElementById("share-files").addEventListener("change", (event) => {
  clearError("share-error");
  const incoming = Array.from(event.target.files || []);
  const existing = new Set(selectedShareFiles.map((file) => `${file.name}:${file.size}`));
  for (const file of incoming) {
    if (selectedShareFiles.length >= MAX_SHARE_FILES) {
      showError("share-error", "You can upload up to 20 files per share.");
      break;
    }
    if (!existing.has(`${file.name}:${file.size}`)) {
      const nextTotal = selectedShareFiles.reduce((sum, candidate) => sum + candidate.size, 0) + file.size;
      if (nextTotal > MAX_SHARE_TOTAL_BYTES) {
        showError("share-error", "Total selected file size cannot exceed 250 MB.");
        break;
      }
      selectedShareFiles.push(file);
    }
  }
  renderSelectedShareFiles();
  event.target.value = "";
});

document.getElementById("create-share-btn").addEventListener("click", () => {
  handleShareCreate().catch((error) => showError("share-error", error.message));
});

document.getElementById("copy-share-link-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.getElementById("share-result-url").value);
  showToast("Share link copied");
});

document.getElementById("new-share-btn").addEventListener("click", () => {
  resetShareForm();
});

bindMfaDigits();

async function loadInlineSuggestionSetting() {
  try {
    const response = await sendMessage("getInlineSuggestionSetting");
    inlineSuggestionToggle.classList.toggle("active", response.enabled);
  } catch {
    inlineSuggestionToggle.classList.add("active");
  }
}

inlineSuggestionToggle.addEventListener("click", async () => {
  const isActive = inlineSuggestionToggle.classList.contains("active");
  try {
    const response = await sendMessage("setInlineSuggestionSetting", { enabled: !isActive });
    inlineSuggestionToggle.classList.toggle("active", response.enabled);
  } catch (error) {
    showToast(error.message);
  }
});

initialize().catch((error) => {
  subtitle.textContent = error.message || "Failed to initialize extension";
  setActiveView("login");
});
