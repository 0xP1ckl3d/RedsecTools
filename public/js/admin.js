import { showConfirmModal, showAlertModal } from "./confirm-modal.js";

const adminLoginShell = document.getElementById("admin-login-shell");
const loginSection = document.getElementById("login-section");
const dashboard = document.getElementById("dashboard");
const adminPassword = document.getElementById("admin-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

// --- Auth ---

async function api(path, options = {}) {
  const res = await fetch(`/admin${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("Not authenticated");
  }
  if (res.status === 403) {
    const data = await res.clone().json().catch(() => null);
    if (data?.code === "recent_admin_required") {
      return res;
    }
    showLogin();
    loginError.textContent = "Admin access requires an active user session. Please log in to your account first.";
    loginError.classList.remove("hidden");
    throw new Error("Active user session required");
  }
  return res;
}

function showLogin() {
  adminLoginShell?.classList.remove("hidden");
  adminLoginShell?.removeAttribute("hidden");
  loginSection.classList.remove("hidden");
  loginSection.removeAttribute("hidden");
  dashboard.classList.add("hidden");
  dashboard.setAttribute("hidden", "");
}

function showDashboard() {
  adminLoginShell?.classList.add("hidden");
  adminLoginShell?.setAttribute("hidden", "");
  loginSection.classList.add("hidden");
  loginSection.setAttribute("hidden", "");
  dashboard.classList.remove("hidden");
  dashboard.removeAttribute("hidden");
  loadPasteStats();
  loadPastes();
  loadFileStats();
  loadFiles();
  loadInvites();
  loadSmtpSettings();
  loadThemeSettings();
  loadCalendarSettings();
  loadRoles().then(() => loadUsers()).catch(() => loadUsers());
  loadBulletinsAdmin();
  setAdminTabGroup("server");
}

function formatTime(unix) {
  return new Date(unix * 1000).toLocaleString();
}

function formatRelativeTimeShort(unix) {
  if (!unix) return "Never";
  const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (diffSeconds < 60) return "Just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function formatRelativeTimeWithTitle(unix) {
  if (!unix) return '<span class="text-muted">Never</span>';
  return `<span title="${escapeHtml(formatTime(unix))}">${escapeHtml(formatRelativeTimeShort(unix))}</span>`;
}

function formatExpiry(expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const diff = expiresAt - now;
  if (diff <= 0) return "Expired";
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function userDisplayName(p) {
  if (p.username) return escapeHtml(p.username);
  if (p.guestInvitedBy) return `ANON (${escapeHtml(p.guestInvitedBy)})`;
  return "ANON";
}

async function checkAuth() {
  try {
    const res = await fetch("/admin/api/auth-status");
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        showDashboard();
        return;
      }
    }
  } catch {}
  showLogin();
}

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  loginError.classList.add("hidden");

  try {
    const res = await fetch("/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword.value }),
    });

    if (res.ok) {
      adminPassword.value = "";
      showDashboard();
    } else {
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        loginError.textContent = "Admin access requires an active user session. Please log in to your account first.";
      } else {
        loginError.textContent = "Invalid password.";
      }
      loginError.classList.remove("hidden");
    }
  } catch {
    loginError.textContent = "Login failed.";
    loginError.classList.remove("hidden");
  } finally {
    loginBtn.disabled = false;
  }
});

adminPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", async () => {
  await fetch("/admin/logout", { method: "POST" });
  showLogin();
});

// --- Tabs ---

const tabBtns = document.querySelectorAll(".admin-tab[data-tab]");
const childTabs = ["theme", "settings", "security", "deployment", "roles", "bulletins", "weather", "team-shortcuts", "users", "invites", "calendar-tool-settings", "engage-tool-settings", "reporter-tool-settings", "survey-tool-settings", "wiki-tool-settings", "chat", "vaults", "pastes", "files", "threat-tool-settings", "redsecai-tool-settings"];
const adminTabGroups = {
  server: ["theme", "settings", "security", "deployment", "roles"],
  homepage: ["weather", "bulletins", "team-shortcuts"],
  "users-admin": ["users", "invites"],
  tools: ["calendar-tool-settings", "engage-tool-settings", "reporter-tool-settings", "survey-tool-settings", "wiki-tool-settings", "chat", "vaults", "pastes", "files", "threat-tool-settings", "redsecai-tool-settings"],
};
const adminSubtabLabels = {
  theme: "Branding",
  settings: "SMTP",
  security: "Session Security",
  deployment: "Deployment",
  roles: "Access Controls",
  weather: "Weather",
  bulletins: "Bulletins",
  "team-shortcuts": "Shortcuts",
  users: "Users",
  invites: "Invites",
  "calendar-tool-settings": window.brandName("Cal"),
  "wiki-tool-settings": window.brandName("Wiki"),
  "redsecai-tool-settings": window.brandName("AI"),
  chat: window.brandName("Team"),
  pastes: window.brandName("Paste"),
  files: window.brandName("Share"),
  "survey-tool-settings": window.brandName("Survey"),
  vaults: window.brandName("Vault"),
  "threat-tool-settings": window.brandName("Threat"),
  "reporter-tool-settings": window.brandName("Reporter"),
  "engage-tool-settings": window.brandName("Engage"),
};
let activeAdminParentTab = "server";
let activeAdminChildTab = "settings";

function renderAdminSubtabs() {
  const container = document.getElementById("admin-subtabs");
  if (!container) return;
  const children = adminTabGroups[activeAdminParentTab] || [];
  if (children.length <= 1) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = children.map((childTab) => `
    <button type="button" class="admin-subtab-btn${childTab === activeAdminChildTab ? " active" : ""}" data-admin-child-tab="${childTab}">
      ${escapeHtml(adminSubtabLabels[childTab] || childTab)}
    </button>
  `).join("");

  container.querySelectorAll("[data-admin-child-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAdminChildTab = button.dataset.adminChildTab;
      updateAdminVisibleTabs();
    });
  });
}

function updateAdminVisibleTabs() {
  const visibleTabs = new Set([activeAdminChildTab]);
  childTabs.forEach((childTab) => {
    document.getElementById(`${childTab}-tab`)?.classList.toggle("hidden", !visibleTabs.has(childTab));
  });
  renderAdminSubtabs();

  if (visibleTabs.has("chat")) {
    loadChatStats();
    loadChatConversations();
  }
  if (visibleTabs.has("vaults")) {
    loadVaultStats();
    loadVaultsAdmin();
  }
  if (visibleTabs.has("security")) {
    loadSecuritySettings();
    loadSsoSettings();
  }
  if (visibleTabs.has("deployment")) {
    loadDeploymentQuality();
  }
  if (visibleTabs.has("settings")) {
    loadSmtpSettings();
  }
  if (visibleTabs.has("theme")) {
    loadThemeSettings();
  }
  if (visibleTabs.has("files")) {
    loadShareSettings();
    loadFileStats();
    loadFiles();
  }
  if (visibleTabs.has("calendar-tool-settings")) {
    loadCalendarSettings();
  }
  if (visibleTabs.has("wiki-tool-settings")) {
    loadWikiToolSettings();
  }
  if (visibleTabs.has("redsecai-tool-settings")) {
    loadRedSecAiSettings();
  }
  if (visibleTabs.has("survey-tool-settings")) {
    loadSurveyAdminStats();
    loadSurveysAdmin();
  }
  if (visibleTabs.has("weather")) {
    loadWeatherLocations();
  }
  if (visibleTabs.has("team-shortcuts")) {
    loadTeamShortcuts();
  }
  if (visibleTabs.has("roles")) {
    loadRoles();
  }
  if (visibleTabs.has("bulletins")) {
    loadBulletinsAdmin();
  }
  if (visibleTabs.has("threat-tool-settings")) {
    loadThreatAdminStats();
    loadThreatAdminFeeds();
    loadThreatAdminTemplates();
    loadThreatAdminSettings();
  }
  if (visibleTabs.has("reporter-tool-settings")) {
    loadReporterAdminStats();
  }
  if (visibleTabs.has("engage-tool-settings")) {
    loadEngageAdminSummary();
    loadEngageActivity();
  }
}

function setAdminTabGroup(tab) {
  activeAdminParentTab = tab;
  const children = adminTabGroups[tab] || [];
  if (!children.includes(activeAdminChildTab)) {
    activeAdminChildTab = children[0] || "";
  }
  tabBtns.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  updateAdminVisibleTabs();
}

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setAdminTabGroup(btn.dataset.tab);
  });
});

document.getElementById("admin-sidebar-collapse-btn")?.addEventListener("click", () => {
  document.getElementById("admin-sidebar")?.classList.toggle("collapsed");
});

// ============================================================
// PASTES
// ============================================================

const pasteSelectAll = document.getElementById("paste-select-all");
const pasteBulkDeleteBtn = document.getElementById("paste-bulk-delete-btn");
const pasteSelectedCount = document.getElementById("paste-selected-count");
const pastesBody = document.getElementById("pastes-body");
const pastePrevBtn = document.getElementById("paste-prev-btn");
const pasteNextBtn = document.getElementById("paste-next-btn");
const pastePageInfo = document.getElementById("paste-page-info");
const pasteRefreshBtn = document.getElementById("paste-refresh-btn");

let pastePage = 1;
let pasteSelectedIds = new Set();

async function loadPasteStats() {
  try {
    const res = await api("/api/paste-stats");
    const stats = await res.json();
    document.getElementById("paste-stat-total").textContent = stats.total;
    document.getElementById("paste-stat-active").textContent = stats.active;
    document.getElementById("paste-stat-expired").textContent = stats.expired;
  } catch {}
}

async function loadPastes() {
  try {
    const res = await api(`/api/pastes?page=${pastePage}&limit=50`);
    const data = await res.json();

    pasteSelectedIds.clear();
    updatePasteBulkUI();
    pasteSelectAll.checked = false;

    pastesBody.innerHTML = "";

    if (data.pastes.length === 0) {
      pastesBody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-8">No pastes found.</td></tr>';
    } else {
      for (const p of data.pastes) {
        const isExpired = p.expiresAt < Math.floor(Date.now() / 1000);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><input type="checkbox" class="paste-select" data-id="${p.id}"></td>
          <td class="font-mono text-xs">${p.id.substring(0, 12)}...</td>
          <td class="text-xs">${userDisplayName(p)}</td>
          <td class="text-xs">${p.sourceIp}</td>
          <td class="text-xs">${p.syntax || "plaintext"}</td>
          <td class="text-xs">${formatTime(p.createdAt)}</td>
          <td class="text-xs"><span class="badge ${isExpired ? "badge-red" : "badge-green"}">${formatExpiry(p.expiresAt)}</span></td>
          <td>${p.hasPassword ? '<span class="badge badge-amber">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
          <td>${p.burnAfterReading ? '<span class="badge badge-red">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
          <td class="text-xs">${formatSize(p.size)}</td>
          <td><button class="delete-paste-btn text-error text-xs hover:underline" data-id="${p.id}">Delete</button></td>
        `;
        pastesBody.appendChild(tr);
      }
    }

    pastePageInfo.textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    pastePrevBtn.disabled = data.page <= 1;
    pasteNextBtn.disabled = data.page >= data.totalPages;
  } catch {}
}

pastesBody.addEventListener("change", (e) => {
  if (e.target.classList.contains("paste-select")) {
    const id = e.target.dataset.id;
    if (e.target.checked) pasteSelectedIds.add(id);
    else pasteSelectedIds.delete(id);
    updatePasteBulkUI();
  }
});

pasteSelectAll.addEventListener("change", () => {
  const checkboxes = pastesBody.querySelectorAll(".paste-select");
  if (pasteSelectAll.checked) {
    checkboxes.forEach((cb) => { cb.checked = true; pasteSelectedIds.add(cb.dataset.id); });
  } else {
    checkboxes.forEach((cb) => { cb.checked = false; });
    pasteSelectedIds.clear();
  }
  updatePasteBulkUI();
});

function updatePasteBulkUI() {
  pasteSelectedCount.textContent = pasteSelectedIds.size;
  pasteBulkDeleteBtn.classList.toggle("hidden", pasteSelectedIds.size === 0);
}

pastesBody.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-paste-btn")) {
    const id = e.target.dataset.id;
    if (!await showConfirmModal({ title: "Delete Paste", message: "Permanently delete this paste?", confirmLabel: "Delete", danger: true })) return;
    try {
      const res = await api(`/api/paste/${id}`, { method: "DELETE" });
      if (res.ok) { loadPastes(); loadPasteStats(); }
    } catch {}
  }
});

pasteBulkDeleteBtn.addEventListener("click", async () => {
  if (!await showConfirmModal({ title: "Bulk Delete", message: `Permanently delete ${pasteSelectedIds.size} paste(s)?`, confirmLabel: "Delete All", danger: true })) return;
  try {
    await api("/api/pastes/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: [...pasteSelectedIds] }),
    });
    loadPastes();
    loadPasteStats();
  } catch {}
});

pastePrevBtn.addEventListener("click", () => { if (pastePage > 1) { pastePage--; loadPastes(); } });
pasteNextBtn.addEventListener("click", () => { pastePage++; loadPastes(); });
pasteRefreshBtn.addEventListener("click", () => { loadPasteStats(); loadPastes(); });

// ============================================================
// FILES
// ============================================================

const fileSelectAll = document.getElementById("file-select-all");
const fileBulkDeleteBtn = document.getElementById("file-bulk-delete-btn");
const fileSelectedCount = document.getElementById("file-selected-count");
const filesBody = document.getElementById("files-body");
const filePrevBtn = document.getElementById("file-prev-btn");
const fileNextBtn = document.getElementById("file-next-btn");
const filePageInfo = document.getElementById("file-page-info");
const fileRefreshBtn = document.getElementById("file-refresh-btn");
const shareMaxFileSizeSelect = document.getElementById("share-max-file-size");
const shareMaxFilesSelect = document.getElementById("share-max-files");
const shareSettingsSaveBtn = document.getElementById("share-settings-save-btn");
const shareSettingsResult = document.getElementById("share-settings-result");

let filePage = 1;
let fileSelectedIds = new Set();

async function loadShareSettings() {
  try {
    const res = await api("/api/settings/share");
    const data = await res.json();
    if (shareMaxFileSizeSelect) shareMaxFileSizeSelect.value = String(data.maxFileSizeMb);
    if (shareMaxFilesSelect) shareMaxFilesSelect.value = String(data.maxFilesPerShare);
  } catch {}
}

async function loadFileStats() {
  try {
    const res = await api("/api/file-stats");
    const stats = await res.json();
    document.getElementById("file-stat-total").textContent = stats.total;
    document.getElementById("file-stat-active").textContent = stats.active;
    document.getElementById("file-stat-expired").textContent = stats.expired;
    document.getElementById("file-stat-disk").textContent = formatSize(stats.diskUsage);
  } catch {}
}

async function loadFiles() {
  try {
    const res = await api(`/api/files?page=${filePage}&limit=50`);
    const data = await res.json();

    fileSelectedIds.clear();
    updateFileBulkUI();
    fileSelectAll.checked = false;

    filesBody.innerHTML = "";

    if (data.files.length === 0) {
      filesBody.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-8">No files found.</td></tr>';
    } else {
      for (const f of data.files) {
        const isExpired = f.expiresAt < Math.floor(Date.now() / 1000);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><input type="checkbox" class="file-select" data-id="${f.id}"></td>
          <td class="font-mono text-xs">${f.id.substring(0, 12)}...</td>
          <td class="text-xs">${userDisplayName(f)}</td>
          <td class="text-xs">${formatSize(f.fileSize)}</td>
          <td class="text-xs">${f.fileCount === 1 ? "1 file" : f.fileCount + " files"}</td>
          <td class="text-xs">${f.sourceIp}</td>
          <td class="text-xs">${formatTime(f.createdAt)}</td>
          <td class="text-xs"><span class="badge ${isExpired ? "badge-red" : "badge-green"}">${formatExpiry(f.expiresAt)}</span></td>
          <td>${f.hasPassword ? '<span class="badge badge-amber">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
          <td>${f.burnAfterReading ? '<span class="badge badge-red">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
          <td><button class="delete-file-btn text-error text-xs hover:underline" data-id="${f.id}">Delete</button></td>
        `;
        filesBody.appendChild(tr);
      }
    }

    filePageInfo.textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    filePrevBtn.disabled = data.page <= 1;
    fileNextBtn.disabled = data.page >= data.totalPages;
  } catch {}
}

filesBody.addEventListener("change", (e) => {
  if (e.target.classList.contains("file-select")) {
    const id = e.target.dataset.id;
    if (e.target.checked) fileSelectedIds.add(id);
    else fileSelectedIds.delete(id);
    updateFileBulkUI();
  }
});

fileSelectAll.addEventListener("change", () => {
  const checkboxes = filesBody.querySelectorAll(".file-select");
  if (fileSelectAll.checked) {
    checkboxes.forEach((cb) => { cb.checked = true; fileSelectedIds.add(cb.dataset.id); });
  } else {
    checkboxes.forEach((cb) => { cb.checked = false; });
    fileSelectedIds.clear();
  }
  updateFileBulkUI();
});

function updateFileBulkUI() {
  fileSelectedCount.textContent = fileSelectedIds.size;
  fileBulkDeleteBtn.classList.toggle("hidden", fileSelectedIds.size === 0);
}

filesBody.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-file-btn")) {
    const id = e.target.dataset.id;
    if (!await showConfirmModal({ title: "Delete File", message: "Permanently delete this file?", confirmLabel: "Delete", danger: true })) return;
    try {
      const res = await api(`/api/file/${id}`, { method: "DELETE" });
      if (res.ok) { loadFiles(); loadFileStats(); }
    } catch {}
  }
});

fileBulkDeleteBtn.addEventListener("click", async () => {
  if (!await showConfirmModal({ title: "Bulk Delete", message: `Permanently delete ${fileSelectedIds.size} file(s)?`, confirmLabel: "Delete All", danger: true })) return;
  try {
    await api("/api/files/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: [...fileSelectedIds] }),
    });
    loadFiles();
    loadFileStats();
  } catch {}
});

filePrevBtn.addEventListener("click", () => { if (filePage > 1) { filePage--; loadFiles(); } });
fileNextBtn.addEventListener("click", () => { filePage++; loadFiles(); });
fileRefreshBtn.addEventListener("click", () => { loadShareSettings(); loadFileStats(); loadFiles(); });

shareSettingsSaveBtn?.addEventListener("click", async () => {
  shareSettingsSaveBtn.disabled = true;
  shareSettingsResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/share", {
      method: "POST",
      body: JSON.stringify({
        maxFileSizeMb: parseInt(shareMaxFileSizeSelect.value, 10),
        maxFilesPerShare: parseInt(shareMaxFilesSelect.value, 10),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save");
    shareSettingsResult.textContent = `Limits saved: ${data.maxFileSizeMb} MB, ${data.maxFilesPerShare} file${data.maxFilesPerShare === 1 ? "" : "s"} per share.`;
    shareSettingsResult.className = "text-sm text-accent";
  } catch (err) {
    shareSettingsResult.textContent = err.message;
    shareSettingsResult.className = "text-sm text-error";
  }

  shareSettingsResult.classList.remove("hidden");
  shareSettingsSaveBtn.disabled = false;
});

// ============================================================
// SURVEYS
// ============================================================

const surveyAdminBody = document.getElementById("survey-admin-body");
const surveyAdminPrevBtn = document.getElementById("survey-admin-prev-btn");
const surveyAdminNextBtn = document.getElementById("survey-admin-next-btn");
const surveyAdminPageInfo = document.getElementById("survey-admin-page-info");
const surveyAdminRefreshBtn = document.getElementById("survey-admin-refresh-btn");

let surveyAdminPage = 1;

function formatSurveyStatus(status) {
  if (status === "published") return '<span class="badge badge-green">Active</span>';
  if (status === "draft") return '<span class="badge badge-amber">Draft</span>';
  if (status === "ended") return '<span class="badge badge-red">Ended</span>';
  return '<span class="badge badge-gray">Closed</span>';
}

function formatSurveyMode(mode) {
  if (mode === "internal_named") return "Named Internal";
  if (mode === "public_named") return "Named Public";
  return "Anonymous Public";
}

async function loadSurveyAdminStats() {
  try {
    const res = await api("/api/survey-stats");
    const stats = await res.json();
    document.getElementById("survey-admin-stat-total").textContent = stats.total;
    document.getElementById("survey-admin-stat-active").textContent = stats.active;
    document.getElementById("survey-admin-stat-ended").textContent = stats.ended;
    document.getElementById("survey-admin-stat-closed").textContent = stats.closed;
  } catch {}
}

async function loadSurveysAdmin() {
  try {
    const res = await api(`/api/surveys?page=${surveyAdminPage}&limit=50`);
    const data = await res.json();

    surveyAdminBody.innerHTML = "";

    if (!data.surveys.length) {
      surveyAdminBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-8">No surveys found.</td></tr>';
    } else {
      for (const survey of data.surveys) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div class="text-sm font-medium">${escapeHtml(survey.title || "Untitled Survey")}</div>
            <div class="text-xs text-muted font-mono mt-1">${escapeHtml(survey.id.substring(0, 12))}...</div>
          </td>
          <td class="text-xs">${escapeHtml(survey.ownerUsername || "Unknown")}</td>
          <td>${formatSurveyStatus(survey.status)}</td>
          <td class="text-xs">${escapeHtml(formatSurveyMode(survey.responseMode))}</td>
          <td class="text-xs">${survey.questionCount}</td>
          <td class="text-xs">${survey.responseCount}</td>
          <td class="text-xs">${formatTime(survey.updatedAt)}</td>
          <td><button class="delete-survey-admin-btn text-error text-xs hover:underline" data-id="${escapeHtml(survey.id)}">Delete</button></td>
        `;
        surveyAdminBody.appendChild(tr);
      }
    }

    surveyAdminPageInfo.textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    surveyAdminPrevBtn.disabled = data.page <= 1;
    surveyAdminNextBtn.disabled = data.page >= data.totalPages;
  } catch {}
}

surveyAdminBody?.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-survey-admin-btn")) return;
  const { id } = e.target.dataset;
  if (!await showConfirmModal({ title: "Delete Survey", message: "Permanently delete this survey and all of its responses?", confirmLabel: "Delete", danger: true })) return;
  try {
    const res = await api(`/api/survey/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadSurveyAdminStats();
      loadSurveysAdmin();
    }
  } catch {}
});

surveyAdminPrevBtn?.addEventListener("click", () => {
  if (surveyAdminPage > 1) {
    surveyAdminPage -= 1;
    loadSurveysAdmin();
  }
});

surveyAdminNextBtn?.addEventListener("click", () => {
  surveyAdminPage += 1;
  loadSurveysAdmin();
});

surveyAdminRefreshBtn?.addEventListener("click", () => {
  loadSurveyAdminStats();
  loadSurveysAdmin();
});

// ============================================================
// USERS
// ============================================================

const usersBody = document.getElementById("users-body");
const userPrevBtn = document.getElementById("user-prev-btn");
const userNextBtn = document.getElementById("user-next-btn");
const userPageInfo = document.getElementById("user-page-info");
const userRefreshBtn = document.getElementById("user-refresh-btn");

let userPage = 1;
let cachedRoles = [];
let permissionDefinitions = [];

function getPermissionDefinitionMap() {
  return new Map(permissionDefinitions.map((permission) => [permission.key, permission]));
}

function populateInviteRoleSelect() {
  const select = document.getElementById("invite-role");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Default role</option>' + cachedRoles.map((role) => (
    `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`
  )).join("");
  if (currentValue && cachedRoles.some((role) => role.id === currentValue)) {
    select.value = currentValue;
  }
}

function populateSsoDefaultRoleSelect() {
  const select = document.getElementById("sso-default-role");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Default member role</option>' + cachedRoles.map((role) => (
    `<option value="${escapeHtml(role.id)}">${escapeHtml(role.name)}</option>`
  )).join("");
  if (currentValue && cachedRoles.some((role) => role.id === currentValue)) {
    select.value = currentValue;
  }
}

async function loadUsers() {
  try {
    if (!cachedRoles.length) {
      try {
        await loadRoles();
      } catch {}
    }
    const res = await api(`/api/users?page=${userPage}&limit=50`);
    const data = await res.json();

    usersBody.innerHTML = "";

    if (data.users.length === 0) {
      usersBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-8">No users found.</td></tr>';
    } else {
      for (const u of data.users) {
        const tr = document.createElement("tr");
        const roleOptions = cachedRoles.map((role) => `<option value="${escapeHtml(role.id)}" ${u.roleId === role.id ? "selected" : ""}>${escapeHtml(role.name)}</option>`).join("");
        tr.innerHTML = `
          <td class="text-sm font-medium">${escapeHtml(u.username)}</td>
          <td class="text-xs">${escapeHtml(u.email)}</td>
          <td>${roleOptions ? `<select class="input-field text-xs py-1 px-2 user-role-select" data-id="${u.id}">${roleOptions}</select>` : '<span class="text-xs text-muted">No roles</span>'}</td>
          <td>${u.suspended ? '<span class="badge badge-red">Suspended</span>' : '<span class="badge badge-green">Active</span>'}</td>
          <td id="mfa-${u.id}"><span class="text-xs text-muted">Loading...</span></td>
          <td class="text-xs">${formatTime(u.createdAt)}</td>
          <td>
            <div class="admin-table-actions">
              ${u.suspended
                ? `<button class="user-unsuspend-btn text-xs hover:underline" data-id="${u.id}">Unsuspend</button>`
                : `<button class="user-suspend-btn text-xs text-amber hover:underline" data-id="${u.id}">Suspend</button>`
              }
              <button class="user-reset-mfa-btn text-xs text-amber hover:underline hidden" data-id="${u.id}">Reset MFA</button>
              <button class="user-reset-btn text-xs hover:underline" data-id="${u.id}">Reset PW</button>
              <button class="user-delete-btn text-error text-xs hover:underline" data-id="${u.id}">Delete</button>
            </div>
          </td>
        `;
        usersBody.appendChild(tr);
      }
    }

    userPageInfo.textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    userPrevBtn.disabled = data.page <= 1;
    userNextBtn.disabled = data.page >= data.totalPages;

    // Load MFA status for each user
    for (const u of data.users) {
      loadUserMFAStatus(u.id);
    }
  } catch {}
}

usersBody.addEventListener("click", async (e) => {
  const btn = e.target;
  const id = btn.dataset.id;

  if (btn.classList.contains("user-suspend-btn")) {
    if (!await showConfirmModal({ title: "Suspend User", message: "This user will be logged out immediately.", confirmLabel: "Suspend", danger: true })) return;
    await api(`/api/users/${id}/suspend`, { method: "POST" });
    loadUsers();
  } else if (btn.classList.contains("user-unsuspend-btn")) {
    await api(`/api/users/${id}/unsuspend`, { method: "POST" });
    loadUsers();
  } else if (btn.classList.contains("user-reset-btn")) {
    if (!await showConfirmModal({ title: "Reset Password", message: "Send a password reset email to this user?" })) return;
    const res = await api(`/api/users/${id}/reset-password`, { method: "POST" });
    const data = await res.json();
    if (data.emailSent) {
      await showAlertModal({ title: "Password Reset", message: "Reset email sent successfully." });
    } else {
      await showAlertModal({ title: "Email Failed", message: "Could not send email. Reset URL: " + data.resetUrl });
    }
  } else if (btn.classList.contains("user-delete-btn")) {
    if (!await showConfirmModal({ title: "Delete User", message: "Permanently delete this user? This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
    await api(`/api/users/${id}`, { method: "DELETE" });
    loadUsers();
  }
});

userPrevBtn.addEventListener("click", () => { if (userPage > 1) { userPage--; loadUsers(); } });
userNextBtn.addEventListener("click", () => { userPage++; loadUsers(); });
userRefreshBtn.addEventListener("click", () => { loadUsers(); });

// ============================================================
// INVITES
// ============================================================

const invitesBody = document.getElementById("invites-body");
const inviteEmail = document.getElementById("invite-email");
const createInviteBtn = document.getElementById("create-invite-btn");
const inviteResult = document.getElementById("invite-result");
const invitePrevBtn = document.getElementById("invite-prev-btn");
const inviteNextBtn = document.getElementById("invite-next-btn");
const invitePageInfo = document.getElementById("invite-page-info");
const inviteRefreshBtn = document.getElementById("invite-refresh-btn");

let invitePage = 1;

async function loadInvites() {
  try {
    const res = await api(`/api/invites?page=${invitePage}&limit=50`);
    const data = await res.json();

    invitesBody.innerHTML = "";

    if (data.invites.length === 0) {
      invitesBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-8">No invitations found.</td></tr>';
    } else {
      for (const inv of data.invites) {
        const isExpired = inv.expiresAt < Math.floor(Date.now() / 1000);
        const status = inv.used ? '<span class="badge badge-green">Used</span>'
          : isExpired ? '<span class="badge badge-red">Expired</span>'
          : '<span class="badge badge-amber">Pending</span>';
        const tr = document.createElement("tr");
        const isPending = !inv.used && !isExpired;
        const actions = isPending
          ? `<button class="copy-invite-btn text-xs hover:underline" data-token="${escapeHtml(inv.token)}">Copy Link</button>
             <button class="revoke-invite-btn text-error text-xs hover:underline" data-id="${inv.id}">Revoke</button>`
          : inv.used ? "" : `<button class="revoke-invite-btn text-error text-xs hover:underline" data-id="${inv.id}">Delete</button>`;
        tr.innerHTML = `
          <td class="text-sm">${escapeHtml(inv.email)}</td>
          <td class="text-xs">${escapeHtml(inv.roleName || "Default role")}</td>
          <td>${status}</td>
          <td class="text-xs">${formatTime(inv.createdAt)}</td>
          <td class="text-xs">${formatTime(inv.expiresAt)}</td>
          <td><div class="admin-table-actions">${actions}</div></td>
        `;
        invitesBody.appendChild(tr);
      }
    }

    invitePageInfo.textContent = `Page ${data.page} of ${data.totalPages || 1}`;
    invitePrevBtn.disabled = data.page <= 1;
    inviteNextBtn.disabled = data.page >= data.totalPages;
  } catch {}
}

createInviteBtn.addEventListener("click", async () => {
  const email = inviteEmail.value.trim();
  const roleId = document.getElementById("invite-role")?.value || "";
  if (!email) return;

  createInviteBtn.disabled = true;
  inviteResult.classList.add("hidden");

  try {
    const res = await api("/api/invites", {
      method: "POST",
      body: JSON.stringify({ email, roleId: roleId || null }),
    });
    const data = await res.json();

    if (res.ok) {
      if (data.emailSent) {
        inviteResult.textContent = `Invitation sent to ${email}` + (data.smtpResponse ? ` — ${data.smtpResponse}` : "");
        inviteResult.className = "text-sm mt-2 text-accent";
      } else {
        inviteResult.innerHTML = `Email failed. Share this link: <a href="${data.registrationUrl}" class="text-accent hover:underline break-all">${data.registrationUrl}</a>`;
        inviteResult.className = "text-sm mt-2 text-amber";
      }
      inviteResult.classList.remove("hidden");
      inviteEmail.value = "";
      const inviteRole = document.getElementById("invite-role");
      if (inviteRole) inviteRole.value = "";
      loadInvites();
    } else {
      inviteResult.textContent = data.error || "Failed to create invite";
      inviteResult.className = "text-sm mt-2 text-error";
      inviteResult.classList.remove("hidden");
    }
  } catch {
    inviteResult.textContent = "Network error";
    inviteResult.className = "text-sm mt-2 text-error";
    inviteResult.classList.remove("hidden");
  } finally {
    createInviteBtn.disabled = false;
  }
});

invitePrevBtn.addEventListener("click", () => { if (invitePage > 1) { invitePage--; loadInvites(); } });
inviteNextBtn.addEventListener("click", () => { invitePage++; loadInvites(); });
inviteRefreshBtn.addEventListener("click", () => { loadInvites(); });

invitesBody.addEventListener("click", async (e) => {
  const revokeBtn = e.target.closest(".revoke-invite-btn");
  if (revokeBtn) {
    const id = revokeBtn.dataset.id;
    if (!await showConfirmModal({ title: "Revoke Invite", message: "Revoke this invitation? The link will no longer work.", confirmLabel: "Revoke", danger: true })) return;
    try {
      const res = await api(`/api/invites/${id}`, { method: "DELETE" });
      if (res.ok) {
        loadInvites();
      } else {
        const data = await res.json();
        await showAlertModal({ title: "Error", message: data.error || "Failed to revoke" });
      }
    } catch {}
    return;
  }
  const copyBtn = e.target.closest(".copy-invite-btn");
  if (copyBtn) {
    const token = copyBtn.dataset.token;
    const url = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy Link"; }, 2000);
    });
  }
});

// ============================================================
// SETTINGS (SMTP)
// ============================================================

const smtpHost = document.getElementById("smtp-host");
const smtpPort = document.getElementById("smtp-port");
const smtpUser = document.getElementById("smtp-user");
const smtpPass = document.getElementById("smtp-pass");
const smtpFrom = document.getElementById("smtp-from");
const smtpSecure = document.getElementById("smtp-secure");
const saveSmtpBtn = document.getElementById("save-smtp-btn");
const testSmtpBtn = document.getElementById("test-smtp-btn");
const smtpResult = document.getElementById("smtp-result");
const calendarDailyHours = document.getElementById("calendar-daily-hours");
const calendarWorkdayStart = document.getElementById("calendar-workday-start");
const calendarWorkdayEnd = document.getElementById("calendar-workday-end");
const calendarWorkdayCheckboxes = [...document.querySelectorAll(".calendar-workday-checkbox")];
const saveCalendarSettingsBtn = document.getElementById("save-calendar-settings-btn");
const calendarSettingsResult = document.getElementById("calendar-settings-result");
const siteThemeInputs = [...document.querySelectorAll("input[name='site-primary-theme']")];
const saveThemeSettingsBtn = document.getElementById("save-theme-settings-btn");
const themeSettingsResult = document.getElementById("theme-settings-result");
const brandLogoInput = document.getElementById("brand-logo-input");
const brandLogoPreview = document.getElementById("brand-logo-preview");
const deleteBrandLogoBtn = document.getElementById("delete-brand-logo-btn");
const brandLogoResult = document.getElementById("brand-logo-result");
const customThemePickerRow = document.getElementById("custom-theme-picker-row");
const customThemeSwatch = document.getElementById("custom-theme-swatch");
const customThemeHexDisplay = document.getElementById("custom-theme-hex-display");
const customThemeModal = document.getElementById("custom-theme-modal");
const customThemeColorPicker = document.getElementById("custom-theme-color-picker");
const customThemeHexInput = document.getElementById("custom-theme-hex-input");
const customThemePreview = document.getElementById("custom-theme-preview");
const siteBrandPrefix = document.getElementById("site-brand-prefix");
let customThemeHex = "";

function setAdminBrandLogoState(hasBrandLogo, version) {
  const hasLogo = !!hasBrandLogo;
  const cacheBust = version || Date.now();
  if (brandLogoPreview) {
    if (hasLogo) {
      brandLogoPreview.onerror = () => setAdminBrandLogoState(false, "");
      brandLogoPreview.src = "/brand-logo.webp?v=" + encodeURIComponent(cacheBust);
      brandLogoPreview.alt = "Current brand logo";
      brandLogoPreview.classList.remove("hidden");
    } else {
      brandLogoPreview.onerror = null;
      brandLogoPreview.removeAttribute("src");
      brandLogoPreview.alt = "";
      brandLogoPreview.classList.add("hidden");
    }
  }
  if (deleteBrandLogoBtn) {
    deleteBrandLogoBtn.disabled = !hasLogo;
    deleteBrandLogoBtn.setAttribute("aria-disabled", hasLogo ? "false" : "true");
  }
  try {
    if (hasLogo) {
      localStorage.setItem("site-brand-logo", "true");
      localStorage.setItem("site-brand-logo-version", String(cacheBust));
    } else {
      localStorage.removeItem("site-brand-logo");
      localStorage.removeItem("site-brand-logo-version");
    }
  } catch {}
}

function probeAdminBrandLogoAsset() {
  if (!brandLogoPreview) return;
  const version = Date.now();
  const img = new Image();
  img.onload = () => setAdminBrandLogoState(true, version);
  img.onerror = () => setAdminBrandLogoState(false, "");
  img.src = "/brand-logo.webp?v=" + encodeURIComponent(version);
}

function primeAdminBrandLogoState() {
  let cachedLogo = "";
  let cachedVersion = "";
  try {
    cachedLogo = localStorage.getItem("site-brand-logo") || "";
    cachedVersion = localStorage.getItem("site-brand-logo-version") || "";
  } catch {}
  if (cachedLogo === "true") {
    setAdminBrandLogoState(true, cachedVersion || Date.now());
  } else if (deleteBrandLogoBtn) {
    deleteBrandLogoBtn.disabled = false;
    deleteBrandLogoBtn.setAttribute("aria-disabled", "false");
  }
  probeAdminBrandLogoAsset();
}

const wikiPersonalSpacesEnabled = document.getElementById("wiki-personal-spaces-enabled");
const wikiSearchResultLimit = document.getElementById("wiki-search-result-limit");
const wikiTeamHomePage = document.getElementById("wiki-team-home-page");
const wikiSettingsSaveBtn = document.getElementById("wiki-settings-save-btn");
const wikiSettingsResult = document.getElementById("wiki-settings-result");

async function loadSmtpSettings() {
  try {
    const res = await api("/api/settings/smtp");
    const config = await res.json();
    smtpHost.value = config.host || "";
    smtpPort.value = config.port || "587";
    smtpUser.value = config.user || "";
    smtpPass.value = config.pass || "";
    smtpFrom.value = config.from || "";
    smtpSecure.checked = config.secure || false;
  } catch {}
}

async function loadCalendarSettings() {
  if (!calendarDailyHours) return;
  try {
    const res = await api("/api/settings/calendar");
    const config = await res.json();
    calendarDailyHours.value = Number(config.dailyHours || 7.6).toFixed(1);
    if (calendarWorkdayStart) calendarWorkdayStart.value = config.workdayStart || "08:30";
    if (calendarWorkdayEnd) calendarWorkdayEnd.value = config.workdayEnd || "17:30";
    const workdays = new Set(Array.isArray(config.workdays) ? config.workdays.map(String) : ["1", "2", "3", "4", "5"]);
    calendarWorkdayCheckboxes.forEach((checkbox) => {
      checkbox.checked = workdays.has(String(checkbox.value));
    });
  } catch {}
}

async function loadThemeSettings() {
  if (!siteThemeInputs.length) return;
  primeAdminBrandLogoState();
  try {
    const res = await api("/api/settings/theme");
    const config = await res.json();
    const theme = config.primaryTheme || "red";
    const customHex = config.customHex || "";
    if (siteBrandPrefix) siteBrandPrefix.value = config.brandPrefix || "";
    setAdminBrandLogoState(!!config.hasBrandLogo, config.brandLogoVersion || "");
    if (!config.hasBrandLogo) probeAdminBrandLogoAsset();
    if (customHex && theme === "custom") {
      customThemeHex = customHex;
      siteThemeInputs.forEach((input) => { input.checked = input.value === "custom"; });
      customThemeSwatch.style.background = customHex;
      customThemeHexDisplay.textContent = customHex;
      customThemePickerRow?.classList.remove("hidden");
      applyCustomTheme(customHex);
    } else {
      siteThemeInputs.forEach((input) => { input.checked = input.value === theme; });
      customThemePickerRow?.classList.add("hidden");
      document.documentElement.setAttribute("data-primary-theme", theme);
      localStorage.setItem("site-primary-theme", theme);
    }
  } catch {}
}

function applyCustomTheme(hex) {
  document.documentElement.setAttribute("data-primary-theme", "custom");
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const hoverR = Math.max(0, Math.round(r * 0.8));
  const hoverG = Math.max(0, Math.round(g * 0.8));
  const hoverB = Math.max(0, Math.round(b * 0.8));
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-hover", `#${hoverR.toString(16).padStart(2,"0")}${hoverG.toString(16).padStart(2,"0")}${hoverB.toString(16).padStart(2,"0")}`);
  document.documentElement.style.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.25)`);
  document.documentElement.style.setProperty("--accent-muted", `rgba(${r}, ${g}, ${b}, 0.12)`);
  document.documentElement.style.setProperty("--selection-bg", `rgba(${r}, ${g}, ${b}, 0.3)`);
  localStorage.setItem("site-primary-theme", "custom");
  localStorage.setItem("site-custom-theme-hex", hex);
}

async function loadWikiToolSettings() {
  if (!wikiSearchResultLimit || !wikiTeamHomePage) return;
  try {
    const res = await api("/api/wiki/settings");
    const data = await res.json();
    document.getElementById("wiki-stat-total-pages").textContent = data.stats?.total ?? 0;
    document.getElementById("wiki-stat-team-pages").textContent = data.stats?.teamTotal ?? 0;
    document.getElementById("wiki-stat-personal-pages").textContent = data.stats?.personalTotal ?? 0;
    document.getElementById("wiki-stat-revisions").textContent = data.stats?.revisions ?? 0;
    wikiPersonalSpacesEnabled.checked = data.settings?.personalSpacesEnabled !== false;
    wikiSearchResultLimit.value = data.settings?.searchResultLimit || 20;
    wikiTeamHomePage.innerHTML = '<option value="">Automatic first team page</option>' + (data.teamPages || []).map((page) => (
      `<option value="${escapeHtml(page.id)}">${escapeHtml(page.title)}</option>`
    )).join("");
    wikiTeamHomePage.value = data.settings?.teamHomePageId || "";
    const recent = document.getElementById("wiki-admin-recent-pages");
    if (recent) {
      recent.innerHTML = (data.recentPages || []).length
        ? data.recentPages.map((page) => `
          <div class="card">
            <div class="font-medium">${escapeHtml(page.title)}</div>
            <div class="text-xs text-muted mt-1">${escapeHtml(page.slug)} · ${escapeHtml(page.authorUsername || "Unknown")} · ${escapeHtml(formatTime(page.updatedAt))}</div>
          </div>
        `).join("")
        : '<div class="text-sm text-muted">No wiki pages yet.</div>';
    }
  } catch {}
}

saveSmtpBtn.addEventListener("click", async () => {
  saveSmtpBtn.disabled = true;
  smtpResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/smtp", {
      method: "POST",
      body: JSON.stringify({
        host: smtpHost.value,
        port: smtpPort.value,
        user: smtpUser.value,
        pass: smtpPass.value,
        from: smtpFrom.value,
        secure: smtpSecure.checked,
      }),
    });

    if (res.ok) {
      smtpResult.textContent = "SMTP configuration saved";
      smtpResult.className = "text-sm text-accent";
      smtpResult.classList.remove("hidden");
    } else {
      const data = await res.json();
      smtpResult.textContent = data.error || "Failed to save";
      smtpResult.className = "text-sm text-error";
      smtpResult.classList.remove("hidden");
    }
  } catch {
    smtpResult.textContent = "Network error";
    smtpResult.className = "text-sm text-error";
    smtpResult.classList.remove("hidden");
  } finally {
    saveSmtpBtn.disabled = false;
  }
});

testSmtpBtn.addEventListener("click", async () => {
  const toInput = document.getElementById("test-smtp-to");
  const to = toInput ? toInput.value.trim() : "";
  if (!to) {
    if (smtpResult) {
      smtpResult.textContent = "Enter a recipient email address above.";
      smtpResult.className = "text-sm text-warning";
      smtpResult.classList.remove("hidden");
    }
    return;
  }

  testSmtpBtn.disabled = true;
  smtpResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/smtp/test", {
      method: "POST",
      body: JSON.stringify({ to }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      smtpResult.textContent = "Test email sent successfully!" + (data.smtpResponse ? ` — ${data.smtpResponse}` : "");
      smtpResult.className = "text-sm text-accent";
    } else {
      smtpResult.textContent = data.error || "Test failed";
      smtpResult.className = "text-sm text-error";
    }
    smtpResult.classList.remove("hidden");
  } catch {
    smtpResult.textContent = "Network error";
    smtpResult.className = "text-sm text-error";
    smtpResult.classList.remove("hidden");
  } finally {
    testSmtpBtn.disabled = false;
  }
});

saveCalendarSettingsBtn?.addEventListener("click", async () => {
  saveCalendarSettingsBtn.disabled = true;
  calendarSettingsResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/calendar", {
      method: "POST",
      body: JSON.stringify({
        dailyHours: Number.parseFloat(calendarDailyHours.value) || 7.6,
        workdayStart: calendarWorkdayStart?.value || "08:30",
        workdayEnd: calendarWorkdayEnd?.value || "17:30",
        workdays: calendarWorkdayCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => Number(checkbox.value)),
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      calendarDailyHours.value = Number(data.dailyHours || 7.6).toFixed(1);
      if (calendarWorkdayStart) calendarWorkdayStart.value = data.workdayStart || "08:30";
      if (calendarWorkdayEnd) calendarWorkdayEnd.value = data.workdayEnd || "17:30";
      const workdays = new Set(Array.isArray(data.workdays) ? data.workdays.map(String) : ["1", "2", "3", "4", "5"]);
      calendarWorkdayCheckboxes.forEach((checkbox) => {
        checkbox.checked = workdays.has(String(checkbox.value));
      });
      calendarSettingsResult.textContent = "Calendar settings saved.";
      calendarSettingsResult.className = "text-sm text-accent";
    } else {
      calendarSettingsResult.textContent = data.error || "Failed to save calendar settings.";
      calendarSettingsResult.className = "text-sm text-error";
    }
  } catch {
    calendarSettingsResult.textContent = "Network error";
    calendarSettingsResult.className = "text-sm text-error";
  } finally {
    calendarSettingsResult.classList.remove("hidden");
    saveCalendarSettingsBtn.disabled = false;
  }
});

saveThemeSettingsBtn?.addEventListener("click", async () => {
  saveThemeSettingsBtn.disabled = true;
  themeSettingsResult.classList.add("hidden");
  const primaryTheme = siteThemeInputs.find((input) => input.checked)?.value || "red";
  const payload = { primaryTheme };
  if (siteBrandPrefix) payload.brandPrefix = siteBrandPrefix.value.trim();
  if (primaryTheme === "custom" && customThemeHex) {
    payload.customHex = customThemeHex;
  }
  try {
    const res = await api("/api/settings/theme", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const saved = data.primaryTheme || primaryTheme;
      if (saved === "custom" && data.customHex) {
        applyCustomTheme(data.customHex);
      } else {
        document.documentElement.setAttribute("data-primary-theme", saved);
        localStorage.setItem("site-primary-theme", saved);
      }
      themeSettingsResult.textContent = "Theme saved.";
      themeSettingsResult.className = "text-sm text-accent";
    } else {
      themeSettingsResult.textContent = data.error || "Failed to save theme.";
      themeSettingsResult.className = "text-sm text-error";
    }
  } catch {
    themeSettingsResult.textContent = "Network error";
    themeSettingsResult.className = "text-sm text-error";
  } finally {
    themeSettingsResult.classList.remove("hidden");
    saveThemeSettingsBtn.disabled = false;
  }
});

brandLogoInput?.addEventListener("change", async () => {
  const file = brandLogoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    brandLogoResult.textContent = "Only image files are accepted.";
    brandLogoResult.className = "text-sm text-error";
    brandLogoResult.classList.remove("hidden");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    brandLogoResult.textContent = "File must be under 5 MB.";
    brandLogoResult.className = "text-sm text-error";
    brandLogoResult.classList.remove("hidden");
    return;
  }
  brandLogoResult.classList.add("hidden");
  const formData = new FormData();
  formData.append("logo", file);
  try {
    const res = await fetch("/admin/api/settings/brand-logo", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAdminBrandLogoState(true, data.brandLogoVersion || Date.now());
      brandLogoResult.textContent = "Logo uploaded.";
      brandLogoResult.className = "text-sm text-accent";
    } else {
      brandLogoResult.textContent = data.error || "Upload failed.";
      brandLogoResult.className = "text-sm text-error";
    }
  } catch {
    brandLogoResult.textContent = "Network error";
    brandLogoResult.className = "text-sm text-error";
  } finally {
    brandLogoResult.classList.remove("hidden");
    brandLogoInput.value = "";
  }
});

deleteBrandLogoBtn?.addEventListener("click", async () => {
  brandLogoResult.classList.add("hidden");
  try {
    const res = await api("/api/settings/brand-logo", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setAdminBrandLogoState(false, "");
      location.reload();
    } else {
      brandLogoResult.textContent = data.error || "Failed to remove logo.";
      brandLogoResult.className = "text-sm text-error";
      brandLogoResult.classList.remove("hidden");
    }
  } catch {
    brandLogoResult.textContent = "Network error";
    brandLogoResult.className = "text-sm text-error";
    brandLogoResult.classList.remove("hidden");
  }
});

wikiSettingsSaveBtn?.addEventListener("click", async () => {
  wikiSettingsSaveBtn.disabled = true;
  wikiSettingsResult.classList.add("hidden");
  try {
    const res = await api("/api/wiki/settings", {
      method: "PUT",
      body: JSON.stringify({
        personalSpacesEnabled: wikiPersonalSpacesEnabled.checked,
        searchResultLimit: parseInt(wikiSearchResultLimit.value, 10) || 20,
        teamHomePageId: wikiTeamHomePage.value || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      wikiSearchResultLimit.value = data.settings?.searchResultLimit || 20;
      wikiSettingsResult.textContent = "Wiki settings saved.";
      wikiSettingsResult.className = "text-sm text-accent";
      await loadWikiToolSettings();
    } else {
      wikiSettingsResult.textContent = data.error || "Failed to save wiki settings.";
      wikiSettingsResult.className = "text-sm text-error";
    }
  } catch {
    wikiSettingsResult.textContent = "Network error";
    wikiSettingsResult.className = "text-sm text-error";
  } finally {
    wikiSettingsResult.classList.remove("hidden");
    wikiSettingsSaveBtn.disabled = false;
  }
});

// Custom theme radio change — show/hide picker row
siteThemeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.value === "custom" && input.checked) {
      customThemePickerRow?.classList.remove("hidden");
      if (!customThemeHex) {
        customThemeHex = "#E53935";
        customThemeSwatch.style.background = customThemeHex;
        customThemeHexDisplay.textContent = customThemeHex;
      }
    } else if (input.checked) {
      customThemePickerRow?.classList.add("hidden");
      // Reset to named theme preview
      document.documentElement.removeAttribute("style");
      document.documentElement.setAttribute("data-primary-theme", input.value);
    }
  });
});

// Custom theme modal open/close
document.getElementById("open-custom-theme-modal")?.addEventListener("click", () => {
  if (!customThemeHex) customThemeHex = "#E53935";
  customThemeColorPicker.value = customThemeHex;
  customThemeHexInput.value = customThemeHex;
  customThemePreview.style.background = customThemeHex;
  customThemeModal?.classList.remove("hidden");
});

document.getElementById("custom-theme-modal-close")?.addEventListener("click", () => {
  customThemeModal?.classList.add("hidden");
});

document.getElementById("custom-theme-cancel-btn")?.addEventListener("click", () => {
  customThemeModal?.classList.add("hidden");
});

customThemeModal?.addEventListener("click", (e) => {
  if (e.target === customThemeModal) customThemeModal.classList.add("hidden");
});

// Color picker → hex input sync
customThemeColorPicker?.addEventListener("input", () => {
  customThemeHexInput.value = customThemeColorPicker.value.toUpperCase();
  customThemePreview.style.background = customThemeColorPicker.value;
});

// Hex input → color picker sync
customThemeHexInput?.addEventListener("input", () => {
  const val = customThemeHexInput.value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    customThemeColorPicker.value = val;
    customThemePreview.style.background = val;
  }
});

// Apply custom color
document.getElementById("custom-theme-apply-btn")?.addEventListener("click", () => {
  const hex = customThemeHexInput.value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    customThemeHexInput.style.borderColor = "var(--accent)";
    return;
  }
  customThemeHex = hex;
  customThemeSwatch.style.background = hex;
  customThemeHexDisplay.textContent = hex;
  applyCustomTheme(hex);
  customThemeModal?.classList.add("hidden");
});

const redsecAiEnabled = document.getElementById("redsecai-enabled");
const redsecAiAutoPull = document.getElementById("redsecai-auto-pull");
const redsecAiAutostart = document.getElementById("redsecai-autostart");
const redsecAiBaseUrl = document.getElementById("redsecai-base-url");
const redsecAiModel = document.getElementById("redsecai-model");
const redsecAiTimeoutMs = document.getElementById("redsecai-timeout-ms");
const redsecAiActionTtlSeconds = document.getElementById("redsecai-action-ttl-seconds");
const redsecAiEndpointBox = document.getElementById("redsecai-endpoint-box");
const redsecAiStatusBox = document.getElementById("redsecai-status-box");
const redsecAiDiagnosticsBox = document.getElementById("redsecai-diagnostics-box");
const redsecAiDiagnosticsBtn = document.getElementById("redsecai-diagnostics-btn");
const redsecAiActionsBox = document.getElementById("redsecai-actions-box");
const redsecAiSaveBtn = document.getElementById("redsecai-save-btn");
const redsecAiResult = document.getElementById("redsecai-settings-result");

function setRedSecAiText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadRedSecAiSettings() {
  try {
    const res = await api("/api/settings/redsecai");
    const data = await res.json();
    if (redsecAiEnabled) redsecAiEnabled.checked = !!data.enabled;
    if (redsecAiAutoPull) redsecAiAutoPull.checked = !!data.autoPull;
    if (redsecAiAutostart) redsecAiAutostart.checked = !!data.autostart;
    if (redsecAiBaseUrl) redsecAiBaseUrl.value = data.baseUrl || "http://127.0.0.1:11434";
    if (redsecAiModel) redsecAiModel.value = data.model || "qwen3.5:4b";
    if (redsecAiTimeoutMs) redsecAiTimeoutMs.value = data.timeoutMs || 120000;
    if (redsecAiActionTtlSeconds) redsecAiActionTtlSeconds.value = data.actionTtlSeconds || 7200;

    setRedSecAiText("redsecai-stat-enabled", data.enabled ? "On" : "Off");
    setRedSecAiText("redsecai-stat-ready", data.ready ? (data.cloudModel ? "Cloud" : "Yes") : (data.installing ? "Pulling" : "No"));
    setRedSecAiText("redsecai-stat-model", data.model || "-");
    setRedSecAiText("redsecai-stat-models", String((data.availableModels || []).length));
    setRedSecAiText("redsecai-stat-actions", String(data.actionStats?.pendingCount || 0));

    if (redsecAiStatusBox) {
      const models = (data.availableModels || []).length
        ? `Installed models: ${(data.availableModels || []).map(escapeHtml).join(", ")}`
        : "No installed models reported by Ollama.";
      const readyText = data.cloudModel && data.ready
        ? `${window.brandName("AI")} cloud model is available through this Ollama service.`
        : (data.ready ? `${window.brandName("AI")} is ready.` : escapeHtml(data.error || `${window.brandName("AI")} is not ready.`));
      redsecAiStatusBox.className = `info-box text-sm mt-4 ${data.ready ? "text-accent" : "text-warning"}`;
      redsecAiStatusBox.innerHTML = data.enabled
        ? `${readyText}<br>${models}`
        : `${window.brandName("AI")} is globally disabled.`;
    }
    if (redsecAiEndpointBox) {
      const warnings = Array.isArray(data.endpointWarnings) ? data.endpointWarnings : [];
      redsecAiEndpointBox.className = `info-box text-sm mt-4 ${data.endpointRisk === "elevated" ? "text-warning" : "text-muted"}`;
      redsecAiEndpointBox.innerHTML = [
        `<strong>Processing mode:</strong> ${escapeHtml(data.processingMode || "unknown")}`,
        warnings.length
          ? warnings.map((warning) => escapeHtml(warning)).join("<br>")
          : "Prompt context stays within the configured local or internal Ollama endpoint unless a cloud model is selected.",
      ].join("<br>");
    }
    if (redsecAiActionsBox) {
      const events = data.actionStats?.recentEvents || [];
      redsecAiActionsBox.innerHTML = events.length
        ? `<strong>Recent AI activity</strong><br>${events.slice(0, 8).map((event) => `${escapeHtml(event.type || "event")} - ${escapeHtml(event.tool || "system")} - ${escapeHtml(event.summary || "")}`).join("<br>")}`
        : `No recent ${window.brandName("AI")} confirmed-action activity.`;
    }
  } catch {
    if (redsecAiStatusBox) {
      redsecAiStatusBox.className = "info-box text-sm mt-4 text-error";
      redsecAiStatusBox.textContent = `Failed to load ${window.brandName("AI")} settings.`;
    }
    if (redsecAiActionsBox) redsecAiActionsBox.textContent = `Failed to load ${window.brandName("AI")} activity.`;
    if (redsecAiEndpointBox) redsecAiEndpointBox.textContent = `Failed to load ${window.brandName("AI")} endpoint processing mode.`;
  }
}

redsecAiSaveBtn?.addEventListener("click", async () => {
  redsecAiSaveBtn.disabled = true;
  redsecAiResult?.classList.add("hidden");
  try {
    const res = await api("/api/settings/redsecai", {
      method: "POST",
      body: JSON.stringify({
        enabled: !!redsecAiEnabled?.checked,
        baseUrl: redsecAiBaseUrl?.value || "",
        model: redsecAiModel?.value || "",
        timeoutMs: parseInt(redsecAiTimeoutMs?.value, 10) || 120000,
        actionTtlSeconds: parseInt(redsecAiActionTtlSeconds?.value, 10) || 7200,
        autostart: !!redsecAiAutostart?.checked,
        autoPull: !!redsecAiAutoPull?.checked,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to save ${window.brandName("AI")} settings`);
    if (redsecAiResult) {
      redsecAiResult.textContent = `${window.brandName("AI")} settings saved.`;
      redsecAiResult.className = "text-sm text-accent";
      redsecAiResult.classList.remove("hidden");
    }
    await loadRedSecAiSettings();
  } catch (error) {
    if (redsecAiResult) {
      redsecAiResult.textContent = error.message || "Network error";
      redsecAiResult.className = "text-sm text-error";
      redsecAiResult.classList.remove("hidden");
    }
  } finally {
    redsecAiSaveBtn.disabled = false;
  }
});

redsecAiDiagnosticsBtn?.addEventListener("click", async () => {
  redsecAiDiagnosticsBtn.disabled = true;
  if (redsecAiDiagnosticsBox) {
    redsecAiDiagnosticsBox.className = "info-box text-sm mt-4";
    redsecAiDiagnosticsBox.textContent = `Running ${window.brandName("AI")} diagnostics from the app server...`;
  }
  try {
    const res = await api("/api/settings/redsecai/diagnostics", {
      method: "POST",
      body: JSON.stringify({ timeoutMs: 60000 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Diagnostics failed");
    const generate = data.probes?.generate || {};
    const chat = data.probes?.chat || {};
    const formatProbe = (label, probe) => {
      const parts = [
        `<strong>${label}:</strong> ${probe.ok ? "ok" : "failed"} in ${escapeHtml(String(probe.elapsedMs || 0))}ms`,
      ];
      if (probe.status !== undefined) parts.push(`HTTP ${escapeHtml(String(probe.status))}`);
      if (probe.error) parts.push(escapeHtml(probe.error));
      if (probe.bodyPreview) parts.push(`<code>${escapeHtml(String(probe.bodyPreview).slice(0, 500))}</code>`);
      return parts.join(" - ");
    };
    if (redsecAiDiagnosticsBox) {
      redsecAiDiagnosticsBox.className = `info-box text-sm mt-4 ${generate.ok && chat.ok ? "text-accent" : "text-warning"}`;
      redsecAiDiagnosticsBox.innerHTML = [
        `<strong>Endpoint:</strong> ${escapeHtml(data.config?.baseUrl || "-")}`,
        `<strong>Model:</strong> ${escapeHtml(data.config?.model || "-")}${data.config?.cloudModel ? " (cloud)" : ""}`,
        `<strong>Processing mode:</strong> ${escapeHtml(data.config?.processingMode || "unknown")}`,
        `<strong>Health:</strong> ${data.health?.ok ? "ready" : escapeHtml(data.health?.error || "not ready")}`,
        formatProbe("/api/generate", generate),
        formatProbe("/api/chat", chat),
      ].join("<br>");
    }
  } catch (error) {
    if (redsecAiDiagnosticsBox) {
      redsecAiDiagnosticsBox.className = "info-box text-sm mt-4 text-error";
      redsecAiDiagnosticsBox.textContent = error.message || "Diagnostics failed";
    }
  } finally {
    redsecAiDiagnosticsBtn.disabled = false;
  }
});

document.getElementById("redsecai-refresh-btn")?.addEventListener("click", loadRedSecAiSettings);

// ============================================================
// CHAT
// ============================================================

let chatPage = 1;

async function loadChatStats() {
  try {
    const res = await api("/api/chat-stats");
    const data = await res.json();
    document.getElementById("chat-total-conversations").textContent = data.totalConversations;
    document.getElementById("chat-active-conversations").textContent = data.activeConversations;
    document.getElementById("chat-total-messages").textContent = data.totalMessages;
  } catch {}
}

async function loadChatConversations(page = 1) {
  chatPage = page;
  try {
    const res = await api(`/api/conversations?page=${page}&limit=50`);
    const data = await res.json();

    const tbody = document.getElementById("chat-table-body");
    tbody.innerHTML = "";

    if (data.conversations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-muted">No conversations</td></tr>';
      return;
    }

    for (const conv of data.conversations) {
      const tr = document.createElement("tr");
      tr.className = "border-b border-[var(--border)]";
      tr.innerHTML = `
        <td class="py-2 px-3 font-mono text-xs">${escapeHtml(conv.id.substring(0, 8))}...</td>
        <td class="py-2 px-3">${escapeHtml(conv.name || "-")}</td>
        <td class="py-2 px-3"><span class="badge badge-gray">${conv.type}</span></td>
        <td class="py-2 px-3">${conv.memberCount}</td>
        <td class="py-2 px-3">${conv.messageCount}</td>
        <td class="py-2 px-3">${formatDate(conv.createdAt)}</td>
        <td class="py-2 px-3">
          <button class="text-error hover:underline text-sm" data-delete-conv="${conv.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Update pagination
    document.getElementById("chat-page-info").textContent = `Page ${data.page} of ${data.totalPages}`;
    document.getElementById("chat-prev-page").disabled = page <= 1;
    document.getElementById("chat-next-page").disabled = page >= data.totalPages;
  } catch {}
}

// Delete conversation via event delegation
document.getElementById("chat-table-body").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delete-conv]");
  if (!btn) return;
  const id = btn.dataset.deleteConv;
  if (!await showConfirmModal({ title: "Delete Conversation", message: "Delete this conversation and all its messages?", confirmLabel: "Delete", danger: true })) return;

  try {
    const res = await api(`/api/conversations/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadChatConversations(chatPage);
      loadChatStats();
    }
  } catch {}
});

// Chat pagination
document.getElementById("chat-prev-page").addEventListener("click", () => {
  if (chatPage > 1) loadChatConversations(chatPage - 1);
});
document.getElementById("chat-next-page").addEventListener("click", () => {
  loadChatConversations(chatPage + 1);
});

// Chat refresh
document.getElementById("refresh-chat-btn").addEventListener("click", () => {
  loadChatStats();
  loadChatConversations(chatPage);
});

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleDateString();
}

// ============================================================
// USER MFA STATUS
// ============================================================

async function loadUserMFAStatus(userId) {
  try {
    const res = await api(`/api/users/${userId}`);
    if (!res.ok) return;
    const user = await res.json();
    const td = document.getElementById(`mfa-${userId}`);
    if (!td) return;

    if (user.mfaEnabled) {
      td.innerHTML = '<span class="badge badge-green">Enabled</span>';
      // Show reset MFA button
      const btn = document.querySelector(`.user-reset-mfa-btn[data-id="${userId}"]`);
      if (btn) btn.classList.remove("hidden");
    } else {
      td.innerHTML = '<span class="badge badge-gray">Disabled</span>';
    }
  } catch {
    const td = document.getElementById(`mfa-${userId}`);
    if (td) td.innerHTML = '<span class="text-xs text-muted">-</span>';
  }
}

// Add MFA reset handler to users body click
usersBody.addEventListener("click", async (e) => {
  const btn = e.target;
  if (btn.classList.contains("user-reset-mfa-btn")) {
    const id = btn.dataset.id;
    if (!await showConfirmModal({ title: "Reset MFA", message: "This user will be logged out and need to set up MFA again.", confirmLabel: "Reset MFA", danger: true })) return;
    try {
      const res = await api(`/api/users/${id}/reset-mfa`, { method: "POST" });
      if (res.ok) {
        await showAlertModal({ title: "MFA Reset", message: "User has been logged out." });
        loadUsers();
      } else {
        const data = await res.json();
        await showAlertModal({ title: "Error", message: data.error || "Failed to reset MFA" });
      }
    } catch {}
  }
});

// ============================================================
// SECURITY SETTINGS
// ============================================================

const securitySessionTTL = document.getElementById("security-session-ttl");
const securitySessionTTLExtended = document.getElementById("security-session-ttl-extended");
const securityMfaRememberDays = document.getElementById("security-mfa-remember-days");
const securityMfaRequired = document.getElementById("security-mfa-required");
const securityAdminReauthRequired = document.getElementById("security-admin-reauth-required");
const saveSecurityBtn = document.getElementById("save-security-btn");
const securityResult = document.getElementById("security-result");
const ssoEnabled = document.getElementById("sso-enabled");
const ssoProvider = document.getElementById("sso-provider");
const ssoRequireLogin = document.getElementById("sso-require-login");
const ssoAutoProvision = document.getElementById("sso-auto-provision");
const ssoLoginPath = document.getElementById("sso-login-path");
const ssoAcsPath = document.getElementById("sso-acs-path");
const ssoMetadataPath = document.getElementById("sso-metadata-path");
const ssoEntityId = document.getElementById("sso-entity-id");
const ssoIdpEntityId = document.getElementById("sso-idp-entity-id");
const ssoIdpMetadataUrl = document.getElementById("sso-idp-metadata-url");
const ssoEntryPoint = document.getElementById("sso-entry-point");
const ssoDefaultRole = document.getElementById("sso-default-role");
const ssoEmailAttribute = document.getElementById("sso-email-attribute");
const ssoUsernameAttribute = document.getElementById("sso-username-attribute");
const ssoFullNameAttribute = document.getElementById("sso-full-name-attribute");
const ssoIdpCert = document.getElementById("sso-idp-cert");
const ssoPublicCert = document.getElementById("sso-public-cert");
const ssoPrivateKey = document.getElementById("sso-private-key");
const ssoPrivateKeyStatus = document.getElementById("sso-private-key-status");
const ssoSignRequests = document.getElementById("sso-sign-requests");
const ssoForceAuthn = document.getElementById("sso-force-authn");
const ssoMetadataLink = document.getElementById("sso-metadata-link");
const saveSsoBtn = document.getElementById("save-sso-btn");
const ssoResult = document.getElementById("sso-result");

async function loadSecuritySettings() {
  try {
    const res = await api("/api/settings/security");
    if (!res.ok) return;
    const data = await res.json();
    securitySessionTTL.value = data.sessionTTL || 43200;
    securitySessionTTLExtended.value = data.sessionTTLExtended || 604800;
    securityMfaRememberDays.value = data.mfaRememberDays || 30;
    securityMfaRequired.checked = data.mfaRequired || false;
    securityAdminReauthRequired.checked = data.adminReauthRequired || false;
  } catch {}
}

saveSecurityBtn.addEventListener("click", async () => {
  saveSecurityBtn.disabled = true;
  securityResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/security", {
      method: "POST",
      body: JSON.stringify({
        sessionTTL: parseInt(securitySessionTTL.value, 10),
        sessionTTLExtended: parseInt(securitySessionTTLExtended.value, 10),
        mfaRememberDays: parseInt(securityMfaRememberDays.value, 10),
        mfaRequired: securityMfaRequired.checked,
        adminReauthRequired: securityAdminReauthRequired.checked,
      }),
    });

    if (res.ok) {
      securityResult.textContent = "Security settings saved";
      securityResult.className = "text-sm text-accent";
      securityResult.classList.remove("hidden");
    } else {
      const data = await res.json();
      securityResult.textContent = data.error || "Failed to save";
      securityResult.className = "text-sm text-error";
      securityResult.classList.remove("hidden");
    }
  } catch {
    securityResult.textContent = "Network error";
    securityResult.className = "text-sm text-error";
    securityResult.classList.remove("hidden");
  } finally {
    saveSecurityBtn.disabled = false;
  }
});

async function loadSsoSettings() {
  try {
    const res = await api("/api/settings/sso");
    if (!res.ok) return;
    const data = await res.json();
    ssoEnabled.checked = data.enabled || false;
    ssoProvider.value = data.provider || "none";
    ssoRequireLogin.checked = data.requireForLogin || false;
    ssoAutoProvision.checked = data.autoProvision || false;
    ssoLoginPath.value = data.loginPath || "/api/auth/sso/saml/login";
    ssoAcsPath.value = data.acsPath || "/api/auth/sso/saml/acs";
    ssoMetadataPath.value = data.metadataPath || "/api/auth/sso/saml/metadata";
    ssoEntityId.value = data.entityId || "";
    ssoIdpEntityId.value = data.idpEntityId || "";
    ssoIdpMetadataUrl.value = data.idpMetadataUrl || "";
    ssoEntryPoint.value = data.entryPoint || "";
    ssoDefaultRole.value = data.defaultRoleId || "";
    ssoEmailAttribute.value = data.emailAttribute || "email";
    ssoUsernameAttribute.value = data.usernameAttribute || "username";
    ssoFullNameAttribute.value = data.fullNameAttribute || "displayName";
    ssoIdpCert.value = data.idpCert || "";
    ssoPublicCert.value = data.publicCert || "";
    ssoPrivateKey.value = "";
    ssoPrivateKeyStatus.textContent = data.privateKeyConfigured ? "Private key is stored. Leave blank to keep it." : "No private key stored.";
    ssoSignRequests.checked = data.signRequests || false;
    ssoForceAuthn.checked = data.forceAuthn || false;
    if (ssoMetadataLink) ssoMetadataLink.href = data.metadataPath || "/api/auth/sso/saml/metadata";
  } catch {}
}

saveSsoBtn?.addEventListener("click", async () => {
  saveSsoBtn.disabled = true;
  ssoResult.classList.add("hidden");

  try {
    const res = await api("/api/settings/sso", {
      method: "POST",
      body: JSON.stringify({
        enabled: ssoEnabled.checked,
        provider: ssoProvider.value,
        requireForLogin: ssoRequireLogin.checked,
        autoProvision: ssoAutoProvision.checked,
        loginPath: ssoLoginPath.value,
        acsPath: ssoAcsPath.value,
        metadataPath: ssoMetadataPath.value,
        entityId: ssoEntityId.value,
        idpEntityId: ssoIdpEntityId.value,
        idpMetadataUrl: ssoIdpMetadataUrl.value,
        entryPoint: ssoEntryPoint.value,
        defaultRoleId: ssoDefaultRole.value,
        emailAttribute: ssoEmailAttribute.value,
        usernameAttribute: ssoUsernameAttribute.value,
        fullNameAttribute: ssoFullNameAttribute.value,
        idpCert: ssoIdpCert.value,
        publicCert: ssoPublicCert.value,
        privateKey: ssoPrivateKey.value,
        signRequests: ssoSignRequests.checked,
        forceAuthn: ssoForceAuthn.checked,
      }),
    });

    if (res.ok) {
      ssoResult.textContent = "SSO settings saved";
      ssoResult.className = "text-sm text-accent";
      ssoResult.classList.remove("hidden");
    } else {
      const data = await res.json();
      ssoResult.textContent = data.error || "Failed to save";
      ssoResult.className = "text-sm text-error";
      ssoResult.classList.remove("hidden");
    }
  } catch {
    ssoResult.textContent = "Network error";
    ssoResult.className = "text-sm text-error";
    ssoResult.classList.remove("hidden");
  } finally {
    saveSsoBtn.disabled = false;
  }
});

// ============================================================
// DEPLOYMENT QUALITY
// ============================================================

const deploymentRefreshBtn = document.getElementById("deployment-refresh-btn");
const deploymentWarnings = document.getElementById("deployment-warnings");
const deploymentSummaryGrid = document.getElementById("deployment-summary-grid");
const deploymentMigrationsBody = document.getElementById("deployment-migrations-body");
const auditEventsBody = document.getElementById("audit-events-body");
const auditRefreshBtn = document.getElementById("audit-refresh-btn");
const auditExportBtn = document.getElementById("audit-export-btn");
const backupPassphrase = document.getElementById("backup-passphrase");
const backupExportBtn = document.getElementById("backup-export-btn");
const backupResult = document.getElementById("backup-result");

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function renderDeploymentWarnings(warnings) {
  if (!deploymentWarnings) return;
  if (!warnings?.length) {
    deploymentWarnings.innerHTML = '<div class="info-box text-sm text-accent">No deployment warnings detected.</div>';
    return;
  }
  deploymentWarnings.innerHTML = warnings.map((warning) => {
    const badgeClass = warning.level === "high" ? "badge-red" : warning.level === "medium" ? "badge-amber" : "badge-gray";
    return `
      <div class="info-box">
        <div class="flex items-center gap-2 mb-1">
          <span class="badge ${badgeClass}">${escapeHtml(warning.level || "info")}</span>
          <span class="font-medium">${escapeHtml(warning.code || "warning")}</span>
        </div>
        <p class="text-sm text-muted">${escapeHtml(warning.message || "")}</p>
      </div>
    `;
  }).join("");
}

function deploymentMetric(label, value, hint = "") {
  return `
    <div class="info-box">
      <div class="text-xs text-muted uppercase tracking-wide">${escapeHtml(label)}</div>
      <div class="text-lg font-semibold text-primary mt-1">${escapeHtml(String(value ?? ""))}</div>
      ${hint ? `<div class="text-xs text-muted mt-1">${escapeHtml(hint)}</div>` : ""}
    </div>
  `;
}

function renderDeploymentSummary(data) {
  if (!deploymentSummaryGrid) return;
  deploymentSummaryGrid.innerHTML = [
    deploymentMetric("Environment", data.app?.environment || "development", `Node ${data.app?.node || ""}`),
    deploymentMetric("Version", data.app?.version || "local", data.app?.commit ? `Commit ${data.app.commit}` : data.app?.platform || ""),
    deploymentMetric("Cookie Secure", data.deployment?.cookieSecure ? "Enabled" : "Disabled", data.deployment?.cookieSecureSource || ""),
    deploymentMetric("Readiness", data.readiness?.status || "unknown", `Database ${data.readiness?.checks?.database || "unknown"}`),
    deploymentMetric("Admin Re-auth", data.controls?.adminReauthRequired ? "Enabled" : "Disabled", data.controls?.adminReauthWindowSeconds ? `${Math.floor(data.controls.adminReauthWindowSeconds / 60)} minute freshness window` : ""),
    deploymentMetric("SSO", data.controls?.ssoEnabled ? "Configured" : "Disabled", data.controls?.ssoProvider || "none"),
    deploymentMetric("Database", formatBytes(data.database?.sizeBytes), data.database?.path || ""),
    deploymentMetric("Data Storage", formatBytes(data.storage?.dataBytes), `${data.counts?.recentAuditEvents || 0} audit events in the last hour`),
    deploymentMetric("Users Without MFA", data.counts?.usersWithoutMfa || 0, `${data.counts?.users || 0} total users`),
  ].join("");
}

function renderMigrations(migrations) {
  if (!deploymentMigrationsBody) return;
  if (!migrations?.length) {
    deploymentMigrationsBody.innerHTML = '<tr><td colspan="3" class="text-muted">No tracked migrations have been applied.</td></tr>';
    return;
  }
  deploymentMigrationsBody.innerHTML = migrations.map((migration) => `
    <tr>
      <td class="font-mono text-xs">${escapeHtml(migration.id)}</td>
      <td>${escapeHtml(migration.description || "")}</td>
      <td class="text-xs">${migration.appliedAt ? formatTime(migration.appliedAt) : "Unknown"}</td>
    </tr>
  `).join("");
}

function renderAuditEvents(events) {
  if (!auditEventsBody) return;
  if (!events?.length) {
    auditEventsBody.innerHTML = '<tr><td colspan="5" class="text-muted">No audit events recorded yet.</td></tr>';
    return;
  }
  auditEventsBody.innerHTML = events.map((event) => {
    const actor = event.actorUsername || event.actorUserId || event.actorType || "system";
    const target = [event.targetType, event.targetId].filter(Boolean).join(": ") || "-";
    const badgeClass = event.outcome === "success" ? "badge-green" : event.outcome === "failure" ? "badge-red" : "badge-gray";
    return `
      <tr>
        <td class="text-xs">${event.createdAt ? formatTime(event.createdAt) : "Unknown"}</td>
        <td>${escapeHtml(actor)}</td>
        <td>
          <div class="font-medium">${escapeHtml(event.action || "unknown")}</div>
          <div class="text-xs text-muted">${escapeHtml(event.category || "general")}</div>
        </td>
        <td class="text-xs">${escapeHtml(target)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(event.outcome || "unknown")}</span></td>
      </tr>
    `;
  }).join("");
}

async function loadAuditEvents() {
  if (!auditEventsBody) return;
  try {
    const res = await api("/api/audit-events?limit=25");
    if (!res.ok) throw new Error("Audit request failed");
    const data = await res.json();
    renderAuditEvents(data.events || []);
  } catch {
    auditEventsBody.innerHTML = '<tr><td colspan="5" class="text-error">Failed to load audit events.</td></tr>';
  }
}

async function loadDeploymentQuality() {
  try {
    const res = await api("/api/security-posture");
    if (!res.ok) throw new Error("Posture request failed");
    const data = await res.json();
    renderDeploymentWarnings(data.warnings || []);
    renderDeploymentSummary(data);
    renderMigrations(data.database?.migrations || []);
  } catch {
    if (deploymentWarnings) {
      deploymentWarnings.innerHTML = '<div class="info-box text-sm text-error">Failed to load deployment posture.</div>';
    }
  }
  await loadAuditEvents();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

deploymentRefreshBtn?.addEventListener("click", () => {
  loadDeploymentQuality();
});

auditRefreshBtn?.addEventListener("click", () => {
  loadAuditEvents();
});

auditExportBtn?.addEventListener("click", () => {
  window.location.href = "/admin/api/audit-events.csv";
});

backupExportBtn?.addEventListener("click", async () => {
  if (!backupResult || !backupPassphrase) return;
  backupExportBtn.disabled = true;
  backupResult.classList.add("hidden");

  try {
    const res = await api("/api/backup/export", {
      method: "POST",
      body: JSON.stringify({ passphrase: backupPassphrase.value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Backup export failed");
    }
    const blob = await res.blob();
    downloadBlob(blob, `redsectools-backup-${new Date().toISOString().slice(0, 10)}.rsecbackup`);
    backupPassphrase.value = "";
    backupResult.textContent = "Encrypted backup exported";
    backupResult.className = "text-sm text-accent";
    backupResult.classList.remove("hidden");
    loadAuditEvents();
  } catch (error) {
    backupResult.textContent = error.message || "Backup export failed";
    backupResult.className = "text-sm text-error";
    backupResult.classList.remove("hidden");
  } finally {
    backupExportBtn.disabled = false;
  }
});

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================
// VAULTS
// ============================================================

let vaultAdminPage = 1;
const expandedVaultIds = new Set();

function formatVaultPermissionLabel(permission) {
  if (permission === "owner") return "Owner";
  if (permission === "viewer") return "Read only";
  if (permission === "full") return "Full";
  return "Read/write/edit";
}

function vaultMembersRow(vaultId) {
  return `<tr class="vault-members-row hidden" data-vault-members-row="${escapeHtml(vaultId)}">
    <td colspan="7" class="px-3 py-0">
      <div class="py-3">
        <div class="rounded-lg border border-[var(--border)] overflow-hidden">
          <div class="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted bg-[var(--bg-elevated)]">Members</div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[var(--border)]">
                  <th class="text-left py-2 px-3 font-medium">Username</th>
                  <th class="text-left py-2 px-3 font-medium">User ID</th>
                  <th class="text-left py-2 px-3 font-medium">Permission</th>
                  <th class="text-left py-2 px-3 font-medium">Joined</th>
                  <th class="text-left py-2 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody data-vault-members-body="${escapeHtml(vaultId)}">
                <tr><td colspan="5" class="py-3 px-3 text-sm text-muted">Loading members...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </td>
  </tr>`;
}

async function loadVaultMembersAdmin(vaultId) {
  const body = document.querySelector(`[data-vault-members-body="${CSS.escape(vaultId)}"]`);
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" class="py-3 px-3 text-sm text-muted">Loading members...</td></tr>`;
  try {
    const res = await api(`/api/vaults/${vaultId}/members`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      body.innerHTML = `<tr><td colspan="5" class="py-3 px-3 text-sm text-error">${escapeHtml(data.error || "Failed to load members")}</td></tr>`;
      return;
    }
    const members = data.members || [];
    if (!members.length) {
      body.innerHTML = `<tr><td colspan="5" class="py-3 px-3 text-sm text-muted">No members found</td></tr>`;
      return;
    }
    body.innerHTML = members.map((member) => {
      const joinedAt = member.joinedAt ? formatTime(member.joinedAt) : "-";
      const actions = member.isOwner
        ? ""
        : `<select class="input-field text-xs py-1 px-2 min-w-[11rem]" data-vault-member-permission="${escapeHtml(vaultId)}" data-user-id="${escapeHtml(member.userId)}">
            <option value="viewer" ${member.permission === "viewer" ? "selected" : ""}>Read only</option>
            <option value="editor" ${member.permission === "editor" ? "selected" : ""}>Read/write/edit</option>
            <option value="full" ${member.permission === "full" ? "selected" : ""}>Full</option>
          </select>
          <button class="text-error text-xs hover:underline" data-vault-member-remove="${escapeHtml(vaultId)}" data-user-id="${escapeHtml(member.userId)}">Remove</button>`;
      return `<tr class="border-b border-[var(--border)]">
        <td class="py-2 px-3">${escapeHtml(member.username || member.userId)}</td>
        <td class="py-2 px-3 font-mono text-xs">${escapeHtml(member.userId)}</td>
        <td class="py-2 px-3">${member.isOwner ? '<span class="badge badge-amber">Owner</span>' : escapeHtml(formatVaultPermissionLabel(member.permission))}</td>
        <td class="py-2 px-3 text-xs text-muted">${joinedAt}</td>
        <td class="py-2 px-3"><div class="flex items-center gap-2 flex-wrap justify-end">${actions}</div></td>
      </tr>`;
    }).join("");
  } catch {
    body.innerHTML = `<tr><td colspan="5" class="py-3 px-3 text-sm text-error">Failed to load members</td></tr>`;
  }
}

async function toggleVaultMembersAdmin(vaultId) {
  const row = document.querySelector(`[data-vault-members-row="${CSS.escape(vaultId)}"]`);
  if (!row) return;
  const isExpanded = expandedVaultIds.has(vaultId);
  const trigger = document.querySelector(`[data-vault-toggle="${CSS.escape(vaultId)}"]`);
  if (isExpanded) {
    expandedVaultIds.delete(vaultId);
    row.classList.add("hidden");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    return;
  }
  expandedVaultIds.add(vaultId);
  row.classList.remove("hidden");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  await loadVaultMembersAdmin(vaultId);
}

async function loadVaultStats() {
  try {
    const res = await api("/api/vault/stats");
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("vault-stat-total").textContent = data.totalVaults || 0;
    document.getElementById("vault-stat-entries").textContent = data.totalEntries || 0;
    document.getElementById("vault-stat-shares").textContent = data.totalShares || 0;
  } catch {}
}

async function loadVaultsAdmin(page = 1) {
  vaultAdminPage = page;
  try {
    const res = await api(`/api/vaults?page=${page}`);
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById("vault-table-body");
    const vaults = data.vaults || [];
    if (!vaults.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-muted">No vaults</td></tr>`;
    } else {
      tbody.innerHTML = vaults.map(v => `<tr class="border-b border-[var(--border)]">
        <td class="py-2 px-3 font-mono text-xs"><button type="button" class="text-left hover:underline" data-vault-toggle="${escapeHtml(v.id)}" aria-expanded="${expandedVaultIds.has(v.id) ? "true" : "false"}">${escapeHtml(v.id)}</button></td>
        <td class="py-2 px-3"><span class="badge badge-gray capitalize">${v.type}</span></td>
        <td class="py-2 px-3">${escapeHtml(v.ownerUsername || v.ownerId)}</td>
        <td class="py-2 px-3">${v.entryCount || 0}</td>
        <td class="py-2 px-3">${v.memberCount || 0}</td>
        <td class="py-2 px-3 text-muted">${v.createdAt ? new Date(v.createdAt * 1000).toLocaleDateString() : "-"}</td>
        <td class="py-2 px-3"><button class="vault-delete-btn text-error text-xs hover:underline" data-vault-id="${escapeHtml(v.id)}">Delete</button></td>
      </tr>${vaultMembersRow(v.id)}`).join("");
      for (const vault of vaults) {
        if (expandedVaultIds.has(vault.id)) {
          const row = document.querySelector(`[data-vault-members-row="${CSS.escape(vault.id)}"]`);
          if (row) row.classList.remove("hidden");
          loadVaultMembersAdmin(vault.id);
        }
      }
    }
    document.getElementById("vault-page-info").textContent = `Page ${page}`;
    document.getElementById("vault-prev-page").disabled = page <= 1;
    document.getElementById("vault-next-page").disabled = vaults.length < 20;
  } catch {}
}

document.getElementById("vault-table-body").addEventListener("click", async (e) => {
  const toggle = e.target.closest("[data-vault-toggle]");
  if (toggle) {
    await toggleVaultMembersAdmin(toggle.dataset.vaultToggle);
    return;
  }

  const removeBtn = e.target.closest("[data-vault-member-remove]");
  if (removeBtn) {
    if (!await showConfirmModal({ title: "Remove Member", message: "Remove this vault member?", confirmLabel: "Remove", danger: true })) return;
    try {
      const res = await api(`/api/vaults/${removeBtn.dataset.vaultMemberRemove}/members/${removeBtn.dataset.userId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await showAlertModal({ title: "Error", message: data.error || "Failed to remove member" });
        return;
      }
      await loadVaultMembersAdmin(removeBtn.dataset.vaultMemberRemove);
      await loadVaultsAdmin(vaultAdminPage);
    } catch {
      await showAlertModal({ title: "Error", message: "Failed to remove member" });
    }
    return;
  }

  const btn = e.target.closest(".vault-delete-btn");
  if (!btn) return;
  const id = btn.dataset.vaultId;
  if (!await showConfirmModal({ title: "Delete Vault", message: "Delete this vault and all its entries? This cannot be undone.", confirmLabel: "Delete", danger: true })) return;
  try {
    const res = await api(`/api/vaults/${id}`, { method: "DELETE" });
    if (res.ok) {
      loadVaultsAdmin(vaultAdminPage);
      loadVaultStats();
    }
  } catch {}
});

document.getElementById("vault-prev-page").addEventListener("click", () => loadVaultsAdmin(vaultAdminPage - 1));
document.getElementById("vault-next-page").addEventListener("click", () => loadVaultsAdmin(vaultAdminPage + 1));

// ============================================================
// WEATHER ADMIN
// ============================================================

let weatherLocations = [];

async function loadWeatherLocations() {
  try {
    const res = await api("/api/settings/weather");
    if (!res.ok) return;
    const data = await res.json();
    weatherLocations = data.locations || [];
    renderWeatherLocations();
  } catch {}
}

function renderWeatherLocations() {
  const list = document.getElementById("weather-locations-list");
  const count = document.getElementById("weather-count");
  count.textContent = weatherLocations.length;

  if (weatherLocations.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">No locations configured.</p>';
    return;
  }

  list.innerHTML = weatherLocations.map((loc, i) => `
    <div class="weather-loc-row" draggable="true" data-index="${i}">
      <span class="weather-loc-drag" title="Drag to reorder">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>
      </span>
      <span class="text-sm weather-loc-name">${escapeHtml(loc.name)}</span>
      <button type="button" class="weather-remove-btn text-error text-xs hover:underline" data-index="${i}">Remove</button>
    </div>
  `).join("");

  list.querySelectorAll(".weather-remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index, 10);
      weatherLocations.splice(idx, 1);
      await saveWeatherLocations();
      renderWeatherLocations();
    });
  });

  // Drag-to-reorder
  let dragIdx = null;
  list.querySelectorAll(".weather-loc-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragIdx = parseInt(row.dataset.index, 10);
      row.classList.add("weather-loc-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("weather-loc-dragging");
      dragIdx = null;
      list.querySelectorAll(".weather-loc-row").forEach((r) => r.classList.remove("weather-loc-drop-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("weather-loc-drop-over");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("weather-loc-drop-over");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetIdx = parseInt(row.dataset.index, 10);
      if (dragIdx === null || dragIdx === targetIdx) return;
      const [moved] = weatherLocations.splice(dragIdx, 1);
      weatherLocations.splice(targetIdx, 0, moved);
      await saveWeatherLocations();
      renderWeatherLocations();
    });
  });
}

async function saveWeatherLocations() {
  await api("/api/settings/weather", {
    method: "POST",
    body: JSON.stringify({ locations: weatherLocations }),
  });
}

// Search
document.getElementById("weather-search-btn").addEventListener("click", async () => {
  const input = document.getElementById("weather-search-input");
  const q = input.value.trim();
  if (!q) return;

  const resultsEl = document.getElementById("weather-search-results");
  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = '<p class="text-xs text-muted">Searching...</p>';

  try {
    const res = await api(`/api/settings/weather/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      resultsEl.innerHTML = '<p class="text-xs text-muted">No results found.</p>';
      return;
    }

    resultsEl.innerHTML = results.map((r) => `
      <button type="button" class="weather-add-btn flex items-center justify-between w-full p-2 rounded-lg text-sm text-left cursor-pointer weather-search-result" data-name="${escapeHtml(r.name)}" data-lat="${r.lat}" data-lon="${r.lon}">
        <span>${escapeHtml(r.name)}</span>
        <span class="text-xs text-accent">+ Add</span>
      </button>
    `).join("");

    resultsEl.querySelectorAll(".weather-add-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (weatherLocations.length >= 5) {
          await showAlertModal({ title: "Limit Reached", message: "Maximum 5 locations allowed." });
          return;
        }
        weatherLocations.push({ name: btn.dataset.name, lat: parseFloat(btn.dataset.lat), lon: parseFloat(btn.dataset.lon) });
        await saveWeatherLocations();
        renderWeatherLocations();
        resultsEl.classList.add("hidden");
        input.value = "";
      });
    });
  } catch {
    resultsEl.innerHTML = '<p class="text-xs text-muted">Search failed.</p>';
  }
});

usersBody.addEventListener("change", async (e) => {
  const select = e.target.closest(".user-role-select");
  if (!select) return;
  try {
    await api(`/api/users/${select.dataset.id}/role`, {
      method: "PUT",
      body: JSON.stringify({ roleId: select.value }),
    });
  } catch {
    loadUsers();
  }
});

document.getElementById("vault-table-body").addEventListener("change", async (e) => {
  const select = e.target.closest("[data-vault-member-permission]");
  if (!select) return;
  try {
    const res = await api(`/api/vaults/${select.dataset.vaultMemberPermission}/members/${select.dataset.userId}`, {
      method: "PUT",
      body: JSON.stringify({ permission: select.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await showAlertModal({ title: "Error", message: data.error || "Failed to update member" });
      await loadVaultMembersAdmin(select.dataset.vaultMemberPermission);
      return;
    }
    await loadVaultMembersAdmin(select.dataset.vaultMemberPermission);
  } catch {
    await showAlertModal({ title: "Error", message: "Failed to update member" });
    await loadVaultMembersAdmin(select.dataset.vaultMemberPermission);
  }
});

document.getElementById("weather-search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("weather-search-btn").click();
});

document.getElementById("weather-refresh-btn").addEventListener("click", () => loadWeatherLocations());

// ============================================================
// TEAM SHORTCUTS ADMIN
// ============================================================

const EMOJI_DATA_ADMIN = {
  Smileys: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐"],
  Gestures: ["👍","👎","👊","✊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐","🖖","👋","🤏","💪","🦾","🖕"],
  Hearts: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","♥️","❤️‍🔥","❤️‍🩹","💟"],
  Animals: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦅","🦆","🦉","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🪲","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🐘","🦏","🐫"],
  Objects: ["💻","⌨️","🖥","🖨","📱","☎️","📞","📟","📠","🔋","🔌","💡","🔦","🕯","📷","📸","📹","🎥","📽","🎬","📺","📻","📡","🔍","🔎","🔬","🔭","🧲","⚙️","🔧","🔨","⚒","🛠","⛏","🔩","🗜","💡","🔑","🗝","🚪","🪑","🛋","🛏","🧸","🖼","🪞","🪟","📦","📫","📝","🖊","🖋","✒️","📌","📎","✂️","📋","📁","📂","🗂","📆","📅","📇","📈","📉","📊","📋"],
  Symbols: ["✅","❌","⭕","❗","❓","‼️","⁉️","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","💠","🔲","🔳","♻️","✝️","☪️","🕉","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","⛔","📛","🚫","❤️‍🔥","🎶","🎵","🎤","🎧","🎸","🎹","🎺","🥁","🔔","🔕","📣","📢","💬","💭","🗯"],
};

let teamShortcutEditingId = null;
let teamSelectedEmoji = null;
let teamUploadedIconUrl = null;
let teamCurrentEmojiCat = "Smileys";

async function loadTeamShortcuts() {
  try {
    const res = await api("/api/shortcuts/team");
    if (!res.ok) return;
    const data = await res.json();
    renderTeamShortcuts(data.shortcuts || []);
  } catch {}
}

function renderTeamShortcuts(shortcuts) {
  const list = document.getElementById("team-shortcuts-list");
  if (!list) return;

  if (shortcuts.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">No team shortcuts configured.</p>';
    return;
  }

  list.innerHTML = shortcuts.map((s) => {
    const iconHtml = s.iconUrl
      ? '<img src="' + escapeHtml(s.iconUrl) + '" class="w-5 h-5 rounded" alt="">'
      : '<span>' + (s.icon || "🔗") + '</span>';
    return '<div class="flex items-center justify-between p-3 card">' +
      '<div class="flex items-center gap-3">' +
        '<span class="text-lg">' + iconHtml + '</span>' +
        '<div>' +
          '<div class="text-sm font-semibold">' + escapeHtml(s.title) + '</div>' +
          '<div class="text-xs text-muted">' + escapeHtml(s.url) + '</div>' +
          (s.description ? '<div class="text-xs text-muted">' + escapeHtml(s.description) + '</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="flex gap-2">' +
        '<button type="button" class="btn-secondary text-xs team-sc-edit" data-id="' + escapeHtml(s.id) + '">Edit</button>' +
        '<button type="button" class="btn-danger text-xs team-sc-delete" data-id="' + escapeHtml(s.id) + '">Delete</button>' +
      '</div>' +
    '</div>';
  }).join("");

  list.querySelectorAll(".team-sc-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sc = shortcuts.find((s) => s.id === btn.dataset.id);
      if (sc) openTeamShortcutModal(sc);
    });
  });

  list.querySelectorAll(".team-sc-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!await showConfirmModal({ title: "Delete Shortcut", message: "Delete this team shortcut?", confirmLabel: "Delete", danger: true })) return;
      await api("/api/shortcuts/team/" + btn.dataset.id, { method: "DELETE" });
      loadTeamShortcuts();
    });
  });
}

function openTeamShortcutModal(existing) {
  teamShortcutEditingId = existing ? existing.id : null;
  document.getElementById("team-shortcut-modal-title").value = existing ? existing.title : "";
  document.getElementById("team-shortcut-modal-url").value = existing ? existing.url : "";
  const descEl = document.getElementById("team-shortcut-modal-desc");
  if (descEl) descEl.value = existing ? (existing.description || "") : "";
  teamSelectedEmoji = existing ? (existing.icon || null) : null;
  teamUploadedIconUrl = existing ? (existing.iconUrl || null) : null;
  document.getElementById("team-shortcut-emoji-trigger").innerHTML = teamUploadedIconUrl
    ? '<img src="' + escapeHtml(teamUploadedIconUrl) + '" class="shortcut-emoji-preview" alt="">'
    : (teamSelectedEmoji || "🔗");
  document.getElementById("team-shortcut-image-upload").value = "";
  document.getElementById("team-shortcut-modal-heading").textContent = existing ? "Edit Team Shortcut" : "Add Team Shortcut";
  document.getElementById("team-shortcut-modal").classList.remove("hidden");
}

function closeTeamShortcutModal() {
  document.getElementById("team-shortcut-modal").classList.add("hidden");
  document.getElementById("team-shortcut-emoji-picker").classList.add("hidden");
  teamShortcutEditingId = null;
  teamUploadedIconUrl = null;
}

// Team shortcut modal events
document.getElementById("team-shortcut-add-btn").addEventListener("click", () => openTeamShortcutModal(null));
document.getElementById("team-shortcut-modal-close").addEventListener("click", closeTeamShortcutModal);
document.getElementById("team-shortcut-modal").addEventListener("click", (e) => { if (e.target.id === "team-shortcut-modal") closeTeamShortcutModal(); });

// Team image upload
document.getElementById("team-shortcut-image-upload").addEventListener("change", async function () {
  const file = this.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { await showAlertModal({ title: "Too Large", message: "Image must be under 2MB." }); return; }
  const formData = new FormData();
  formData.append("image", file);
  try {
    const res = await api("/api/shortcuts/team/upload-icon", { method: "POST", body: formData, headers: {} });
    if (!res.ok) { await showAlertModal({ title: "Upload Failed", message: "Could not upload the image." }); return; }
    const data = await res.json();
    teamUploadedIconUrl = data.url;
    teamSelectedEmoji = null;
    document.getElementById("team-shortcut-emoji-trigger").innerHTML = '<img src="' + escapeHtml(teamUploadedIconUrl) + '" class="shortcut-emoji-preview" alt="">';
    document.getElementById("team-shortcut-emoji-picker").classList.add("hidden");
  } catch { await showAlertModal({ title: "Upload Failed", message: "Could not upload the image." }); }
});

// Team emoji picker
document.getElementById("team-shortcut-emoji-trigger").addEventListener("click", () => {
  const picker = document.getElementById("team-shortcut-emoji-picker");
  if (picker.classList.contains("hidden")) {
    // Init categories
    const cats = Object.keys(EMOJI_DATA_ADMIN);
    const catContainer = document.getElementById("team-shortcut-emoji-categories");
    catContainer.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-category-tab" + (cat === teamCurrentEmojiCat ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        teamCurrentEmojiCat = cat;
        catContainer.querySelectorAll(".emoji-category-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderTeamEmojiCategory(cat);
      });
      catContainer.appendChild(btn);
    });
    renderTeamEmojiCategory(teamCurrentEmojiCat);
    picker.classList.remove("hidden");
  } else {
    picker.classList.add("hidden");
  }
});

function renderTeamEmojiCategory(cat) {
  const grid = document.getElementById("team-shortcut-emoji-grid");
  const emojis = EMOJI_DATA_ADMIN[cat] || [];
  grid.innerHTML = "";
  emojis.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-item";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      teamSelectedEmoji = emoji;
      teamUploadedIconUrl = null;
      document.getElementById("team-shortcut-emoji-trigger").textContent = emoji;
      document.getElementById("team-shortcut-emoji-picker").classList.add("hidden");
    });
    grid.appendChild(btn);
  });
}

document.addEventListener("click", (e) => {
  const picker = document.getElementById("team-shortcut-emoji-picker");
  const trigger = document.getElementById("team-shortcut-emoji-trigger");
  if (picker && trigger && !picker.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
    picker.classList.add("hidden");
  }
});

// Team shortcut save
document.getElementById("team-shortcut-modal-save").addEventListener("click", async () => {
  const title = document.getElementById("team-shortcut-modal-title").value.trim();
  const url = document.getElementById("team-shortcut-modal-url").value.trim();
  const descEl = document.getElementById("team-shortcut-modal-desc");
  const description = descEl ? descEl.value.trim() : "";
  if (!title || !url) return;

  const body = {
    title,
    url,
    icon: teamUploadedIconUrl ? null : teamSelectedEmoji,
    icon_url: teamUploadedIconUrl,
    description,
  };

  let res;
  if (teamShortcutEditingId) {
    res = await api("/api/shortcuts/team/" + teamShortcutEditingId, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } else {
    res = await api("/api/shortcuts/team", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  if (res.ok) {
    closeTeamShortcutModal();
    loadTeamShortcuts();
  } else {
    const data = await res.json().catch(() => ({}));
    await showAlertModal({ title: "Error", message: data.error || "Failed to save" });
  }
});

// ============================================================
// ROLES
// ============================================================

function renderRolePermissions(permissions) {
  const grid = document.getElementById("role-permissions-grid");
  if (!grid) return;

  const permissionMap = getPermissionDefinitionMap();
  const groupedPermissions = {};
  permissions.forEach((permission) => {
    const definition = permissionMap.get(permission) || {
      key: permission,
      category: permission.split(".")[0],
      label: permission.split(".").slice(1).join("."),
      description: "",
    };
    if (!groupedPermissions[definition.category]) groupedPermissions[definition.category] = [];
    groupedPermissions[definition.category].push(definition);
  });

  grid.innerHTML = Object.entries(groupedPermissions).map(([group, definitions]) => {
    const checkboxes = definitions.map((definition) => `
      <label class="role-permission-card">
        <span class="custom-checkbox gap-2">
          <input type="checkbox" value="${escapeHtml(definition.key)}">
          <span class="checkmark"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></span>
        </span>
        <span class="role-permission-copy">
          <span class="role-permission-label">${escapeHtml(definition.label)}</span>
          <span class="role-permission-description">${escapeHtml(definition.description || "")}</span>
        </span>
      </label>
    `).join("");
    return `<details class="role-perm-group">
      <summary class="role-perm-group-summary">
        <span class="role-perm-group-title">${escapeHtml(group)}</span>
        <span class="role-perm-group-count">${definitions.length}</span>
      </summary>
      <div class="role-permission-grid">${checkboxes}</div>
    </details>`;
  }).join("");
}

async function loadRoles() {
  try {
    const data = await (await api("/api/roles")).json();
    cachedRoles = data.roles || [];
    permissionDefinitions = data.permissionDefinitions || [];
    populateInviteRoleSelect();
    populateSsoDefaultRoleSelect();
    renderRolePermissions(data.permissions || []);
    const list = document.getElementById("roles-list");
    if (!list) return;
    list.innerHTML = cachedRoles.length
      ? cachedRoles.map((role) => {
        const permissionMap = getPermissionDefinitionMap();
        const permGroups = {};
        (role.permissions || []).forEach((permission) => {
          const definition = permissionMap.get(permission) || {
            category: permission.split(".")[0],
            label: permission.split(".").slice(1).join("."),
            description: "",
          };
          if (!permGroups[definition.category]) permGroups[definition.category] = [];
          permGroups[definition.category].push(definition);
        });
        const permHtml = Object.entries(permGroups).map(([group, definitions]) => `
          <div class="admin-role-summary-line">
            <span class="role-perm-group-title">${escapeHtml(group)}</span>
            <span class="text-xs text-muted">${escapeHtml(definitions.map((definition) => definition.label).join(", "))}</span>
          </div>
        `).join("");
        return `
        <div class="card">
          <div class="flex justify-between items-start gap-3">
            <div class="flex-1">
              <div class="font-medium">${escapeHtml(role.name)} ${role.isSystem ? '<span class="badge badge-gray">System</span>' : ""}</div>
              <div class="text-xs text-muted mt-1">${escapeHtml(role.description || "No description")}</div>
              <div class="mt-2">${permHtml || '<span class="text-xs text-muted">No permissions</span>'}</div>
            </div>
            ${role.isSystem ? "" : `<button class="btn-secondary text-xs role-edit-btn" data-id="${role.id}" data-index="${cachedRoles.indexOf(role)}">Edit</button> <button class="btn-danger text-xs role-delete-btn" data-id="${role.id}">Delete</button>`}
          </div>
        </div>`;
      }).join("")
      : '<p class="text-sm text-muted">No roles configured.</p>';

    list.querySelectorAll(".role-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!await showConfirmModal({ title: "Delete Role", message: "Delete this role? Users with this role will lose its permissions.", confirmLabel: "Delete", danger: true })) return;
        await api("/api/roles/" + button.dataset.id, { method: "DELETE" });
        loadRoles();
        loadUsers();
      });
    });

    list.querySelectorAll(".role-edit-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const role = cachedRoles[parseInt(button.dataset.index, 10)];
        if (role) populateRoleForm(role);
      });
    });
  } catch {}
}

let editingRoleId = null;

function populateRoleForm(role) {
  document.getElementById("role-name").value = role ? role.name : "";
  document.getElementById("role-description").value = role ? (role.description || "") : "";
  const btn = document.getElementById("create-role-btn");
  if (btn) btn.textContent = role ? "Update Role" : "Save Role";
  editingRoleId = role ? role.id : null;
  // Check the role's permissions in the grid
  document.querySelectorAll('#role-permissions-grid input[type="checkbox"]').forEach((input) => {
    input.checked = role ? (role.permissions || []).includes(input.value) : false;
  });
}

document.getElementById("create-role-btn")?.addEventListener("click", async () => {
  const name = document.getElementById("role-name").value.trim();
  const description = document.getElementById("role-description").value.trim();
  const permissions = [...document.querySelectorAll('#role-permissions-grid input[type="checkbox"]:checked')].map((input) => input.value);
  const result = document.getElementById("role-result");
  result.classList.add("hidden");
  try {
    if (editingRoleId) {
      await api("/api/roles/" + editingRoleId, {
        method: "PUT",
        body: JSON.stringify({ name, description, permissions }),
      });
    } else {
      await api("/api/roles", {
        method: "POST",
        body: JSON.stringify({ name, description, permissions }),
      });
    }
    document.getElementById("role-name").value = "";
    document.getElementById("role-description").value = "";
    document.querySelectorAll('#role-permissions-grid input[type="checkbox"]').forEach((input) => { input.checked = false; });
    editingRoleId = null;
    const btn = document.getElementById("create-role-btn");
    if (btn) btn.textContent = "Save Role";
    result.textContent = "Role saved.";
    result.className = "text-sm text-accent";
    await loadRoles();
    await loadUsers();
  } catch (error) {
    result.textContent = error.message;
    result.className = "text-sm text-error";
  }
  result.classList.remove("hidden");
});

document.getElementById("roles-refresh-btn")?.addEventListener("click", loadRoles);

// ============================================================
// BULLETINS
// ============================================================

async function loadBulletinsAdmin() {
  try {
    const data = await (await api("/api/bulletins")).json();
    document.getElementById("bulletin-stat-total").textContent = data.stats.total;
    document.getElementById("bulletin-stat-active").textContent = data.stats.active;
    document.getElementById("bulletin-auto-purge-enabled").checked = !!data.retention?.autoPurgeEnabled;
    document.getElementById("bulletin-auto-purge-days").value = data.retention?.autoPurgeDays || 90;
    const list = document.getElementById("bulletins-list");
    list.innerHTML = data.bulletins.length
      ? data.bulletins.map((bulletin) => `
        <div class="card">
          <div class="flex justify-between items-start gap-3">
            <div>
              <div class="font-medium">${escapeHtml(bulletin.title)}</div>
              <div class="text-xs text-muted mt-1">${escapeHtml(bulletin.status)} • ${escapeHtml(bulletin.authorUsername || "Unknown")} • ${escapeHtml(bulletin.recurrenceType || "none")}</div>
            </div>
            <div class="flex gap-2">
              <button class="btn-danger text-xs bulletin-delete-btn" data-id="${bulletin.id}">Delete</button>
            </div>
          </div>
        </div>
      `).join("")
      : '<p class="text-sm text-muted">No bulletins yet.</p>';

    list.querySelectorAll(".bulletin-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!await showConfirmModal({ title: "Delete Bulletin", message: "Delete this bulletin?", confirmLabel: "Delete", danger: true })) return;
        await api(`/api/bulletins/${button.dataset.id}`, { method: "DELETE" });
        loadBulletinsAdmin();
      });
    });

    await populateBulletinPurgeUsers();
  } catch {}
}

async function populateBulletinPurgeUsers() {
  const select = document.getElementById("bulletin-purge-user");
  if (!select) return;
  const currentValue = select.value;
  const res = await api("/api/users?page=1&limit=100");
  const data = await res.json().catch(() => ({ users: [] }));
  const users = Array.isArray(data?.users) ? data.users : [];
  select.innerHTML = '<option value="">Select a user</option>' + users.map((user) => (
    `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username || user.email || user.id)}</option>`
  )).join("");
  if (currentValue) select.value = currentValue;
}

document.getElementById("bulletin-settings-save-btn")?.addEventListener("click", async () => {
  const result = document.getElementById("bulletin-result");
  result.classList.add("hidden");
  try {
    await api("/api/bulletins/settings", {
      method: "PUT",
      body: JSON.stringify({
        autoPurgeEnabled: document.getElementById("bulletin-auto-purge-enabled").checked,
        autoPurgeDays: parseInt(document.getElementById("bulletin-auto-purge-days").value, 10),
      }),
    });
    result.textContent = "Retention settings saved.";
    result.className = "text-sm text-accent";
    await loadBulletinsAdmin();
  } catch (error) {
    result.textContent = error.message;
    result.className = "text-sm text-error";
  }
  result.classList.remove("hidden");
});

document.getElementById("bulletin-purge-user-btn")?.addEventListener("click", async () => {
  const userId = document.getElementById("bulletin-purge-user").value;
  if (!userId) {
    await showAlertModal({ title: "Select User", message: "Select a user first." });
    return;
  }
  if (!await showConfirmModal({ title: "Purge User Bulletins", message: "Purge all bulletin messages for this user?", confirmLabel: "Purge", danger: true })) return;
  try {
    await api("/api/bulletins/purge-user", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    await loadBulletinsAdmin();
  } catch (error) {
    await showAlertModal({ title: "Error", message: error.message || "Failed to purge user bulletins" });
  }
});

document.getElementById("bulletin-purge-all-btn")?.addEventListener("click", async () => {
  const confirmText = document.getElementById("bulletin-purge-all-confirm").value.trim();
  if (confirmText !== "PURGE ALL") {
    await showAlertModal({ title: "Confirmation Required", message: 'Type "PURGE ALL" to confirm.' });
    return;
  }
  if (!await showConfirmModal({ title: "Purge All Bulletins", message: "Purge all bulletin messages and bulletin assets? This cannot be undone.", confirmLabel: "Purge All", danger: true })) return;
  try {
    await api("/api/bulletins/purge-all", {
      method: "POST",
      body: JSON.stringify({ confirm: confirmText }),
    });
    document.getElementById("bulletin-purge-all-confirm").value = "";
    await loadBulletinsAdmin();
  } catch (error) {
    await showAlertModal({ title: "Error", message: error.message || "Failed to purge all bulletins" });
  }
});

document.getElementById("bulletin-preview-refresh")?.addEventListener("click", loadBulletinsAdmin);

// ============================================================
// REDSECTHREAT
// ============================================================

const THREAT_FEED_TYPE_ORDER = { rss: 0, website: 1, api: 2, onion: 3 };
const THREAT_FEED_TYPE_LABELS = { rss: "RSS / Atom", website: "Website", api: "REST API", onion: "Onion (Tor)" };

function threatFeedTypeBadge(type) {
  const label = THREAT_FEED_TYPE_LABELS[type] || type || "Unknown";
  const colorClass = {
    rss: "badge-green",
    website: "badge-blue",
    api: "badge-purple",
    onion: "badge-gray",
  }[type] || "badge-gray";
  return '<span class="badge ' + colorClass + '">' + escapeHtml(label) + '</span>';
}

async function threatAdminJson(path, options) {
  const response = await api(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadReporterAdminStats() {
  try {
    const response = await api("/api/reporter-stats");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed");

    const stats = data.stats || {};
    document.getElementById("reporter-stat-projects").textContent = stats.totalProjects || 0;
    document.getElementById("reporter-stat-findings").textContent = stats.totalFindings || 0;
    document.getElementById("reporter-stat-templates").textContent = stats.totalTemplates || 0;
    document.getElementById("reporter-stat-archived").textContent = stats.archivedProjects || 0;

    const tbody = document.getElementById("reporter-admin-projects-body");
    if (!tbody) return;
    const projects = data.recentProjects || [];
    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-8">No reporter projects yet.</td></tr>';
      return;
    }

    tbody.innerHTML = projects.map((project) => `
      <tr>
        <td class="font-medium">${escapeHtml(project.title || "Untitled project")}</td>
        <td>${escapeHtml(project.clientName || "-")}</td>
        <td>${escapeHtml(project.reportType || "-")}</td>
        <td>${escapeHtml(project.createdByUsername || project.createdBy || "-")}</td>
        <td>${reporterAccessDetails(project.members || [])}</td>
        <td>${reporterStatusBadge(project.status || "draft")}</td>
        <td>${project.isArchived ? '<span class="badge badge-gray">Archived</span>' : '<span class="badge badge-green">Active</span>'}</td>
        <td class="text-xs text-muted">${formatRelativeTimeWithTitle(project.updatedAt)}</td>
      </tr>
    `).join("");
  } catch {
    const tbody = document.getElementById("reporter-admin-projects-body");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-error py-8">Failed to load reporter stats.</td></tr>';
    }
  }
}

function reporterAccessDetails(members) {
  if (!members.length) {
    return '<span class="text-xs text-error">No assigned users</span>';
  }
  const leadCount = members.filter((member) => member.role === "lead").length;
  const summary = `${members.length} user${members.length === 1 ? "" : "s"}${leadCount ? `, ${leadCount} lead${leadCount === 1 ? "" : "s"}` : ""}`;
  return `
    <details class="admin-inline-details">
      <summary>${escapeHtml(summary)}</summary>
      <div class="admin-inline-details-panel">
        ${members.map((member) => `
          <div class="admin-inline-details-row">
            <span>${escapeHtml(member.username || member.userId || "Unknown user")}</span>
            <span class="badge badge-gray">${escapeHtml(String(member.role || "member").replace(/_/g, " "))}</span>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function reporterStatusBadge(status) {
  const value = String(status || "draft");
  const colors = {
    draft: "badge-gray",
    in_progress: "badge-blue",
    in_review: "badge-purple",
    approved: "badge-green",
    delivered: "badge-green",
    archived: "badge-gray",
  };
  return `<span class="badge ${colors[value] || "badge-gray"}">${escapeHtml(value.replace(/_/g, " "))}</span>`;
}

async function loadThreatAdminStats() {
  try {
    const stats = await threatAdminJson("/api/threat/stats");
    document.getElementById("threat-stat-feed-sources").textContent = stats.feedSources || 0;
    document.getElementById("threat-stat-active-feeds").textContent = stats.activeFeeds || 0;
    document.getElementById("threat-stat-total-alerts").textContent = stats.totalAlerts || 0;
    document.getElementById("threat-stat-unresolved").textContent = stats.unresolved || 0;
  } catch {}
}

async function loadThreatAdminFeeds() {
  try {
    const data = await threatAdminJson("/api/threat/feeds");
    const tbody = document.getElementById("threat-feeds-body");
    if (!tbody) return;

    const feeds = data.feeds || [];
    if (!feeds.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-8">No feed sources configured.</td></tr>';
      return;
    }

    // Sort by type group then name
    const sorted = [...feeds].sort((a, b) => {
      const ta = THREAT_FEED_TYPE_ORDER[a.feedType] ?? 9;
      const tb = THREAT_FEED_TYPE_ORDER[b.feedType] ?? 9;
      if (ta !== tb) return ta - tb;
      return (a.name || "").localeCompare(b.name || "");
    });

    // Group by type
    let currentType = "";
    const rows = [];
    for (const feed of sorted) {
      const feedType = feed.feedType || "rss";
      if (feedType !== currentType) {
        currentType = feedType;
        const label = THREAT_FEED_TYPE_LABELS[feedType] || feedType;
        const isOnion = feedType === "onion";
        rows.push(
          '<tr class="threat-feed-group-row">' +
            '<td colspan="8" class="text-xs font-semibold uppercase tracking-wide text-muted py-2 px-3">' +
              threatFeedTypeBadge(feedType) +
              (isOnion ? ' <span class="text-warning text-xs">(requires Tor proxy in General Settings)</span>' : '') +
            '</td>' +
          '</tr>'
        );
      }
      rows.push(
        '<tr>' +
          '<td class="text-sm font-medium">' + escapeHtml(feed.name || feed.url) + '</td>' +
          '<td class="text-xs">' + threatFeedTypeBadge(feedType) + '</td>' +
          '<td><label class="custom-checkbox gap-2"><input type="checkbox" class="threat-feed-enabled-toggle" data-id="' + escapeHtml(feed.id) + '"' + (feed.enabled ? ' checked' : '') + '><span class="checkmark"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></span></label></td>' +
          '<td><label class="custom-checkbox gap-2"><input type="checkbox" class="threat-feed-default-toggle" data-id="' + escapeHtml(feed.id) + '"' + (feed.isDefault ? ' checked' : '') + '><span class="checkmark"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></span></label></td>' +
          '<td class="text-xs">' + (feed.fetchInterval ? Math.round(feed.fetchInterval / 60) + " min" : "-") + '</td>' +
          '<td class="text-xs">' + formatRelativeTimeWithTitle(feed.lastFetchedAt || feed.lastChecked) + '</td>' +
          '<td class="text-xs text-muted" title="' + escapeHtml(feed.url || "") + '">' + escapeHtml((feed.url || "").length > 40 ? feed.url.substring(0, 40) + "..." : feed.url) + '</td>' +
          '<td>' +
            '<button class="threat-feed-edit-btn text-accent text-xs hover:underline" data-id="' + escapeHtml(feed.id) + '">Edit</button> ' +
            '<button class="threat-feed-delete-btn text-error text-xs hover:underline" data-id="' + escapeHtml(feed.id) + '">Delete</button>' +
          '</td>' +
        '</tr>'
      );
    }
    tbody.innerHTML = rows.join("");
  } catch {}
}

async function loadThreatAdminTemplates() {
  try {
    const data = await threatAdminJson("/api/threat/templates");
    const tbody = document.getElementById("threat-templates-body");
    if (!tbody) return;
    const templates = data.templates || [];
    if (!templates.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">No API templates configured.</td></tr>';
      return;
    }
    tbody.innerHTML = templates.map((template) => {
      const endpoint = template.configuration?.endpoint || "-";
      const typeBadge = template.isSystem
        ? '<span class="badge badge-purple">System</span>'
        : '<span class="badge badge-blue">Custom</span>';
      return (
        '<tr>' +
          '<td class="text-sm font-medium">' + escapeHtml(template.name || "Untitled template") + '</td>' +
          '<td class="text-xs text-muted" title="' + escapeHtml(endpoint) + '">' + escapeHtml(endpoint.length > 56 ? endpoint.slice(0, 56) + "..." : endpoint) + '</td>' +
          '<td>' + typeBadge + '</td>' +
          '<td>' + (template.enabled ? '<span class="badge badge-green">Enabled</span>' : '<span class="badge badge-gray">Disabled</span>') + '</td>' +
          '<td>' +
            '<button class="threat-template-test-btn text-accent text-xs hover:underline" data-id="' + escapeHtml(template.id) + '">Test</button> ' +
            '<button class="threat-template-edit-btn text-accent text-xs hover:underline" data-id="' + escapeHtml(template.id) + '">Edit</button> ' +
            (template.isSystem
              ? '<button class="text-muted text-xs" type="button" disabled>Delete</button>'
              : '<button class="threat-template-delete-btn text-error text-xs hover:underline" data-id="' + escapeHtml(template.id) + '">Delete</button>') +
          '</td>' +
        '</tr>'
      );
    }).join("");
  } catch (error) {
    const tbody = document.getElementById("threat-templates-body");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-error py-8">' + escapeHtml(error.message || "Failed to load templates") + '</td></tr>';
    }
  }
}

function applyThreatNotificationPolicy(policy = {}) {
  const email = policy.email || {};
  const webhook = policy.webhook || {};
  const discord = policy.discord || {};

  const emailEnabled = document.getElementById("threat-notify-email-enabled");
  const emailFrom = document.getElementById("threat-notify-email-from");
  const webhookEnabled = document.getElementById("threat-notify-webhook-enabled");
  const discordEnabled = document.getElementById("threat-notify-discord-enabled");
  const discordUsername = document.getElementById("threat-notify-discord-username");
  const discordAvatar = document.getElementById("threat-notify-discord-avatar");

  if (emailEnabled) emailEnabled.checked = email.enabled !== false;
  if (emailFrom) emailFrom.value = email.fromOverride || "";
  if (webhookEnabled) webhookEnabled.checked = webhook.enabled !== false;
  if (discordEnabled) discordEnabled.checked = discord.enabled !== false;
  if (discordUsername) discordUsername.value = discord.username || window.brandName("Threat");
  if (discordAvatar) discordAvatar.value = discord.avatarUrl || "";
}

function readThreatNotificationPolicy() {
  return {
    email: {
      enabled: document.getElementById("threat-notify-email-enabled")?.checked ?? true,
      fromOverride: document.getElementById("threat-notify-email-from")?.value.trim() || "",
    },
    webhook: {
      enabled: document.getElementById("threat-notify-webhook-enabled")?.checked ?? true,
    },
    discord: {
      enabled: document.getElementById("threat-notify-discord-enabled")?.checked ?? true,
      username: document.getElementById("threat-notify-discord-username")?.value.trim() || window.brandName("Threat"),
      avatarUrl: document.getElementById("threat-notify-discord-avatar")?.value.trim() || "",
    },
  };
}

async function loadThreatAdminSettings() {
  try {
    const settings = await threatAdminJson("/api/threat/settings");
    const autoFetch = document.getElementById("threat-auto-fetch");
    const fetchInterval = document.getElementById("threat-fetch-interval");
    const retentionDays = document.getElementById("threat-retention-days");
    const torProxy = document.getElementById("threat-tor-proxy");
    if (autoFetch) autoFetch.checked = !!settings.autoFetch;
    if (fetchInterval) fetchInterval.value = settings.fetchInterval || 30;
    if (retentionDays) retentionDays.value = settings.alertRetentionDays || 14;
    if (torProxy) torProxy.value = settings.torProxyUrl || "";
    applyThreatNotificationPolicy(settings.notificationChannels || {});
  } catch {}
}

async function saveThreatSettings() {
  return saveThreatSettingsSection({
    saveButtonId: "threat-settings-save-btn",
    resultId: "threat-settings-result",
    successMessage: "Threat settings saved.",
  });
}

async function saveThreatNotificationSettings() {
  return saveThreatSettingsSection({
    saveButtonId: "threat-notification-settings-save-btn",
    resultId: "threat-notification-settings-result",
    successMessage: "Notification policy saved.",
  });
}

async function saveThreatSettingsSection({
  saveButtonId,
  resultId,
  successMessage,
}) {
  const saveBtn = document.getElementById(saveButtonId);
  const resultEl = document.getElementById(resultId);
  if (!saveBtn) return;
  saveBtn.disabled = true;
  resultEl?.classList.add("hidden");

  try {
    const res = await threatAdminJson("/api/threat/settings", {
      method: "PUT",
      body: JSON.stringify({
        autoFetch: document.getElementById("threat-auto-fetch")?.checked || false,
        fetchInterval: parseInt(document.getElementById("threat-fetch-interval")?.value, 10) || 30,
        alertRetentionDays: parseInt(document.getElementById("threat-retention-days")?.value, 10) || 14,
        torProxyUrl: document.getElementById("threat-tor-proxy")?.value || "",
        notificationChannels: readThreatNotificationPolicy(),
      }),
    });
    if (res.success) {
      if (resultEl) {
        resultEl.textContent = successMessage;
        resultEl.className = "text-sm text-accent";
      }
      applyThreatNotificationPolicy(res.notificationChannels || {});
    } else {
      if (resultEl) {
        resultEl.textContent = res.error || "Failed to save threat settings.";
        resultEl.className = "text-sm text-error";
      }
    }
  } catch {
    if (resultEl) {
      resultEl.textContent = "Network error";
      resultEl.className = "text-sm text-error";
    }
  } finally {
    resultEl?.classList.remove("hidden");
    saveBtn.disabled = false;
  }
}

function renderThreatForceRefreshResults(results) {
  const container = document.getElementById("threat-force-refresh-results");
  if (!container) return;
  if (!Array.isArray(results) || !results.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = '<div class="rounded-lg border border-primary/10 p-4 bg-black/10">' +
    '<div class="font-medium mb-2">Last Force Refresh Results</div>' +
    '<div class="space-y-1">' +
      results.map((result) => {
        const outcome = result.error
          ? '<span class="text-error">Error: ' + escapeHtml(result.error) + "</span>"
          : result.contentChanged
            ? '<span class="text-accent">Content changed</span>'
            : result.unchanged
              ? '<span class="text-muted">No change</span>'
              : '<span class="text-accent">Checked</span>';
        return '<div class="flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 py-2 first:border-t-0 first:pt-0">' +
          '<div><span class="font-medium">' + escapeHtml(result.name || "Unknown feed") + '</span></div>' +
          '<div class="text-xs text-muted">Alerts: ' + escapeHtml(result.alerts ?? 0) + '</div>' +
          '<div class="text-xs">' + outcome + '</div>' +
        '</div>';
      }).join("") +
    "</div>" +
  "</div>";
}

function openThreatTemplateModal(template) {
  const modal = document.getElementById("threat-template-modal");
  const heading = document.getElementById("threat-template-modal-heading");
  const idField = document.getElementById("threat-template-edit-id");
  const nameField = document.getElementById("threat-template-name");
  const descriptionField = document.getElementById("threat-template-description");
  const configField = document.getElementById("threat-template-config");
  const enabledField = document.getElementById("threat-template-enabled");
  const resultEl = document.getElementById("threat-template-result");
  if (!modal) return;

  if (heading) heading.textContent = template ? "Edit API Template" : "Add API Template";
  if (idField) idField.value = template?.id || "";
  if (nameField) nameField.value = template?.name || "";
  if (descriptionField) descriptionField.value = template?.description || "";
  if (configField) configField.value = JSON.stringify(template?.configuration || {}, null, 2);
  if (enabledField) enabledField.checked = template?.enabled !== false;
  if (resultEl) resultEl.classList.add("hidden");
  modal.classList.remove("hidden");
}

function closeThreatTemplateModal() {
  document.getElementById("threat-template-modal")?.classList.add("hidden");
}

function closeThreatTemplateTestModal() {
  document.getElementById("threat-template-test-modal")?.classList.add("hidden");
}

async function runThreatTemplateTest(templateId) {
  const modal = document.getElementById("threat-template-test-modal");
  const content = document.getElementById("threat-template-test-content");
  if (!modal || !content) return;
  modal.classList.remove("hidden");
  content.innerHTML = '<p class="text-sm text-muted">Running template test...</p>';

  try {
    const result = await threatAdminJson("/api/threat/templates/" + templateId + "/test", { method: "POST" });
    content.innerHTML = '<pre class="threat-template-test-pre">' + escapeHtml(JSON.stringify(result.result || result, null, 2)) + '</pre>';
  } catch (error) {
    content.innerHTML = '<p class="text-sm text-error">' + escapeHtml(error.message || "Template test failed") + "</p>";
  }
}

// --- Threat Feed Modal ---
function openThreatFeedModal(feed) {
  const modal = document.getElementById("threat-feed-modal");
  const heading = document.getElementById("threat-feed-modal-heading");
  const idField = document.getElementById("threat-feed-edit-id");
  const nameField = document.getElementById("threat-feed-name");
  const urlField = document.getElementById("threat-feed-url");
  const typeField = document.getElementById("threat-feed-type");
  const intervalField = document.getElementById("threat-feed-interval");
  const enabledField = document.getElementById("threat-feed-enabled");
  const defaultField = document.getElementById("threat-feed-default");
  const warning = document.getElementById("threat-feed-onion-warning");
  const resultEl = document.getElementById("threat-feed-result");
  if (!modal) return;

  if (feed) {
    heading.textContent = "Edit Feed Source";
    idField.value = feed.id;
    nameField.value = feed.name || "";
    urlField.value = feed.url || "";
    typeField.value = feed.feedType || "rss";
    intervalField.value = feed.fetchInterval || 3600;
    enabledField.checked = feed.enabled !== false;
    defaultField.checked = !!feed.isDefault;
  } else {
    heading.textContent = "Add Feed Source";
    idField.value = "";
    nameField.value = "";
    urlField.value = "";
    typeField.value = "rss";
    intervalField.value = 3600;
    enabledField.checked = true;
    defaultField.checked = false;
  }
  warning.classList.toggle("hidden", typeField.value !== "onion");
  resultEl.classList.add("hidden");
  modal.classList.remove("hidden");
}

function closeThreatFeedModal() {
  document.getElementById("threat-feed-modal")?.classList.add("hidden");
}

document.getElementById("threat-feed-type")?.addEventListener("change", (e) => {
  const warning = document.getElementById("threat-feed-onion-warning");
  if (warning) warning.classList.toggle("hidden", e.target.value !== "onion");
});

document.getElementById("threat-feed-modal-close")?.addEventListener("click", closeThreatFeedModal);

document.getElementById("threat-feed-save-btn")?.addEventListener("click", async () => {
  const idField = document.getElementById("threat-feed-edit-id");
  const resultEl = document.getElementById("threat-feed-result");
  const saveBtn = document.getElementById("threat-feed-save-btn");
  const body = {
    name: document.getElementById("threat-feed-name")?.value.trim() || "",
    url: document.getElementById("threat-feed-url")?.value.trim(),
    feedType: document.getElementById("threat-feed-type")?.value,
    fetchInterval: parseInt(document.getElementById("threat-feed-interval")?.value, 10) || 3600,
    enabled: document.getElementById("threat-feed-enabled")?.checked ?? true,
    isDefault: document.getElementById("threat-feed-default")?.checked ?? false,
  };
  if (!body.url) {
    resultEl.textContent = "URL is required.";
    resultEl.className = "text-sm text-error";
    resultEl.classList.remove("hidden");
    return;
  }
  saveBtn.disabled = true;
  resultEl.classList.add("hidden");
  try {
    const editId = idField.value;
    await (editId
      ? threatAdminJson("/api/threat/feeds/" + editId, { method: "PUT", body: JSON.stringify(body) })
      : threatAdminJson("/api/threat/feeds", { method: "POST", body: JSON.stringify(body) }));
    closeThreatFeedModal();
    loadThreatAdminStats();
    loadThreatAdminFeeds();
  } catch (error) {
    resultEl.textContent = error.message || "Network error";
    resultEl.className = "text-sm text-error";
    resultEl.classList.remove("hidden");
  } finally {
    saveBtn.disabled = false;
  }
});

document.getElementById("threat-add-feed-btn")?.addEventListener("click", () => openThreatFeedModal(null));
document.getElementById("threat-template-add-btn")?.addEventListener("click", () => openThreatTemplateModal(null));
document.getElementById("threat-template-refresh-btn")?.addEventListener("click", loadThreatAdminTemplates);
document.getElementById("threat-template-modal-close")?.addEventListener("click", closeThreatTemplateModal);
document.getElementById("threat-template-test-modal-close")?.addEventListener("click", closeThreatTemplateTestModal);

document.getElementById("threat-template-save-btn")?.addEventListener("click", async () => {
  const idField = document.getElementById("threat-template-edit-id");
  const resultEl = document.getElementById("threat-template-result");
  const saveBtn = document.getElementById("threat-template-save-btn");
  let configuration = {};

  try {
    configuration = JSON.parse(document.getElementById("threat-template-config")?.value || "{}");
  } catch (error) {
    if (resultEl) {
      resultEl.textContent = "Invalid JSON: " + error.message;
      resultEl.className = "text-sm text-error";
      resultEl.classList.remove("hidden");
    }
    return;
  }

  const body = {
    name: document.getElementById("threat-template-name")?.value.trim() || "",
    description: document.getElementById("threat-template-description")?.value.trim() || "",
    configuration,
    enabled: document.getElementById("threat-template-enabled")?.checked ?? true,
  };

  if (!body.name) {
    if (resultEl) {
      resultEl.textContent = "Template name is required.";
      resultEl.className = "text-sm text-error";
      resultEl.classList.remove("hidden");
    }
    return;
  }

  saveBtn.disabled = true;
  if (resultEl) resultEl.classList.add("hidden");
  try {
    const editId = idField?.value;
    await (editId
      ? threatAdminJson("/api/threat/templates/" + editId, { method: "PUT", body: JSON.stringify(body) })
      : threatAdminJson("/api/threat/templates", { method: "POST", body: JSON.stringify(body) }));
    closeThreatTemplateModal();
    loadThreatAdminTemplates();
  } catch (error) {
    if (resultEl) {
      resultEl.textContent = error.message || "Failed to save template.";
      resultEl.className = "text-sm text-error";
      resultEl.classList.remove("hidden");
    }
  } finally {
    saveBtn.disabled = false;
  }
});

// Threat feed toggle handlers (event delegation)
document.getElementById("threat-feeds-body")?.addEventListener("change", async (e) => {
  const enabledToggle = e.target.closest(".threat-feed-enabled-toggle");
  if (enabledToggle) {
    try {
      await threatAdminJson("/api/threat/feeds/" + enabledToggle.dataset.id, {
        method: "PUT",
        body: JSON.stringify({ enabled: enabledToggle.checked }),
      });
    } catch {
      enabledToggle.checked = !enabledToggle.checked;
    }
    return;
  }
  const defaultToggle = e.target.closest(".threat-feed-default-toggle");
  if (defaultToggle) {
    try {
      await threatAdminJson("/api/threat/feeds/" + defaultToggle.dataset.id, {
        method: "PUT",
        body: JSON.stringify({ isDefault: defaultToggle.checked }),
      });
    } catch {
      defaultToggle.checked = !defaultToggle.checked;
    }
  }
});

// Threat feed edit/delete handlers (event delegation)
document.getElementById("threat-feeds-body")?.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".threat-feed-edit-btn");
  if (editBtn) {
    const data = await threatAdminJson("/api/threat/feeds");
    const feed = (data.feeds || []).find((f) => f.id === editBtn.dataset.id);
    if (feed) openThreatFeedModal(feed);
    return;
  }
  const btn = e.target.closest(".threat-feed-delete-btn");
  if (!btn) return;
  if (!await showConfirmModal({ title: "Delete Feed", message: "Remove this threat feed source? This will also delete related alerts.", confirmLabel: "Delete", danger: true })) return;
  try {
    await threatAdminJson("/api/threat/feeds/" + btn.dataset.id, { method: "DELETE" });
    loadThreatAdminStats();
    loadThreatAdminFeeds();
  } catch {}
});

document.getElementById("threat-templates-body")?.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".threat-template-edit-btn");
  if (editBtn) {
    const data = await threatAdminJson("/api/threat/templates");
    const template = (data.templates || []).find((item) => item.id === editBtn.dataset.id);
    if (template) openThreatTemplateModal(template);
    return;
  }

  const testBtn = e.target.closest(".threat-template-test-btn");
  if (testBtn) {
    await runThreatTemplateTest(testBtn.dataset.id);
    return;
  }

  const deleteBtn = e.target.closest(".threat-template-delete-btn");
  if (!deleteBtn) return;
  if (!await showConfirmModal({ title: "Delete API Template", message: `Remove this API template from ${window.brandName("Threat")}?`, confirmLabel: "Delete", danger: true })) return;
  try {
    await threatAdminJson("/api/threat/templates/" + deleteBtn.dataset.id, { method: "DELETE" });
    loadThreatAdminTemplates();
  } catch (error) {
    await showAlertModal({ title: "Template Delete Failed", message: error.message || "Failed to delete template." });
  }
});

document.getElementById("threat-settings-save-btn")?.addEventListener("click", saveThreatSettings);
document.getElementById("threat-notification-settings-save-btn")?.addEventListener("click", saveThreatNotificationSettings);

document.getElementById("threat-refresh-btn")?.addEventListener("click", () => {
  loadThreatAdminStats();
  loadThreatAdminFeeds();
  loadThreatAdminTemplates();
  loadThreatAdminSettings();
});

// Force refresh all feeds
document.getElementById("threat-force-refresh-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("threat-force-refresh-btn");
  if (!btn) return;
  const originalText = btn.textContent;
  btn.textContent = "Fetching...";
  btn.disabled = true;
  try {
    const data = await threatAdminJson("/api/threat/feeds/refresh-all", { method: "POST" });
    btn.textContent = "Fetched " + (data.checked || 0) + " feeds";
    renderThreatForceRefreshResults(data.results || []);
    setTimeout(() => { btn.textContent = originalText; }, 3000);
    loadThreatAdminStats();
    loadThreatAdminFeeds();
    loadThreatAdminTemplates();
  } catch (error) {
    btn.textContent = error.message || "Network error";
    setTimeout(() => { btn.textContent = originalText; }, 3000);
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
// RedSecEngage Activity Log
// ============================================================

let engageActivityPage = 1;
let engageActivityTotal = 0;

function setEngageText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function moneyCompact(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

function renderIssueList(items, label, field = "title") {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<div>${escapeHtml(label)}: 0</div>`;
  return `<div>${escapeHtml(label)}: <strong>${list.length}</strong></div><ul class="mt-1 list-disc pl-5">${list.slice(0, 5).map((item) => `<li>${escapeHtml(item[field] || item.engagement_title || item.id || "Item")}</li>`).join("")}</ul>`;
}

async function loadEngageAdminSummary() {
  try {
    const res = await fetch("/admin/api/engage-summary");
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    const stats = data.stats || {};
    const counts = data.counts || {};
    const issues = data.issues || {};

    setEngageText("engage-admin-stat-active", counts.engagements ?? "-");
    setEngageText("engage-admin-stat-pipeline", moneyCompact(stats.pipelineValue));
    setEngageText("engage-admin-stat-qa", counts.qaQueue ?? "-");
    setEngageText("engage-admin-stat-issues", counts.attention ?? "-");

    const deliveryBox = document.getElementById("engage-admin-delivery-box");
    if (deliveryBox) {
      deliveryBox.innerHTML = [
        `Active engagements: <strong>${escapeHtml(counts.engagements ?? 0)}</strong>`,
        `Open opportunities: <strong>${escapeHtml(counts.opportunities ?? 0)}</strong>`,
        `Linked to Reporter/Calendar: <strong>${escapeHtml(counts.linkedEngagements ?? 0)}</strong>`,
        `Activity records: <strong>${escapeHtml(counts.activity ?? 0)}</strong>`,
      ].join("<br>");
    }

    const qaBox = document.getElementById("engage-admin-qa-box");
    if (qaBox) {
      qaBox.innerHTML = [
        `Queue items: <strong>${escapeHtml(counts.qaQueue ?? 0)}</strong>`,
        `Unassigned reviews: <strong>${escapeHtml(counts.unassignedQa ?? 0)}</strong>`,
        renderIssueList(issues.unassignedQa, "Unassigned QA", "engagement_title"),
      ].join("<br>");
    }

    const qualityBox = document.getElementById("engage-admin-quality-box");
    if (qualityBox) {
      qualityBox.innerHTML = [
        renderIssueList(issues.missingTeam, "Missing tester/technical lead"),
        renderIssueList(issues.overdue, "Overdue engagements"),
        renderIssueList(issues.blocked, "Blocked engagements"),
        renderIssueList(issues.unlinkedActive, "No linked Reporter/Calendar resource"),
      ].join("");
    }
  } catch {
    setEngageText("engage-admin-stat-active", "-");
    setEngageText("engage-admin-stat-pipeline", "-");
    setEngageText("engage-admin-stat-qa", "-");
    setEngageText("engage-admin-stat-issues", "-");
    const deliveryBox = document.getElementById("engage-admin-delivery-box");
    const qaBox = document.getElementById("engage-admin-qa-box");
    const qualityBox = document.getElementById("engage-admin-quality-box");
    if (deliveryBox) deliveryBox.textContent = "Failed to load delivery health.";
    if (qaBox) qaBox.textContent = "Failed to load QA state.";
    if (qualityBox) qualityBox.textContent = "Failed to load quality checks.";
  }
}

async function loadEngageActivity() {
  const body = document.getElementById("engage-activity-body");
  const countEl = document.getElementById("engage-activity-count");
  const pageInfo = document.getElementById("engage-activity-page-info");
  const prevBtn = document.getElementById("engage-activity-prev-btn");
  const nextBtn = document.getElementById("engage-activity-next-btn");
  const pageSize = Number(document.getElementById("engage-activity-page-size")?.value) || 50;
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">Loading...</td></tr>';
  try {
    const res = await fetch(`/admin/api/engage-activity?page=${engageActivityPage}&limit=${pageSize}`);
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    engageActivityTotal = data.total;
    if (countEl) countEl.textContent = data.total;
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${Math.max(1, Math.ceil(data.total / pageSize))}`;
    if (prevBtn) prevBtn.disabled = engageActivityPage <= 1;
    if (nextBtn) nextBtn.disabled = engageActivityPage * pageSize >= data.total;
    if (!data.rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">No activity recorded</td></tr>';
      return;
    }
    body.innerHTML = data.rows.map((r) => {
      const ts = r.created_at ? new Date(r.created_at * 1000).toLocaleString() : "-";
      let details = "";
      try { details = JSON.parse(r.details || "{}"); details = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(", "); } catch { details = r.details || ""; }
      return `<tr>
        <td class="text-sm">${ts}</td>
        <td class="text-sm">${r.username || r.user_id || "-"}</td>
        <td class="text-sm">${r.entity_type || "-"}${r.entity_id ? " <span class=\"text-xs text-muted\">" + r.entity_id.substring(0, 8) + "...</span>" : ""}</td>
        <td class="text-sm">${r.action || "-"}</td>
        <td class="text-sm text-muted admin-engage-details-col">${details}</td>
      </tr>`;
    }).join("");
  } catch {
    body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">Failed to load activity</td></tr>';
  }
}

document.getElementById("engage-admin-refresh-btn")?.addEventListener("click", () => {
  loadEngageAdminSummary();
  loadEngageActivity();
});
document.getElementById("engage-activity-refresh-btn")?.addEventListener("click", loadEngageActivity);
document.getElementById("engage-activity-prev-btn")?.addEventListener("click", () => { engageActivityPage = Math.max(1, engageActivityPage - 1); loadEngageActivity(); });
document.getElementById("engage-activity-next-btn")?.addEventListener("click", () => { engageActivityPage++; loadEngageActivity(); });
document.getElementById("engage-activity-page-size")?.addEventListener("change", () => { engageActivityPage = 1; loadEngageActivity(); });

// --- Init ---
checkAuth();
