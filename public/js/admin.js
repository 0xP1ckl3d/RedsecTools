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
  loadCalendarSettings();
  loadRoles().then(() => loadUsers()).catch(() => loadUsers());
  loadBulletinsAdmin();
  setAdminTabGroup("server");
}

function formatTime(unix) {
  return new Date(unix * 1000).toLocaleString();
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
const childTabs = ["settings", "security", "roles", "bulletins", "weather", "team-shortcuts", "invites", "users", "chat", "pastes", "files", "survey-tool-settings", "vaults", "calendar-tool-settings", "wiki-tool-settings"];
const adminTabGroups = {
  server: ["settings", "security", "roles"],
  homepage: ["weather", "bulletins", "team-shortcuts"],
  "users-admin": ["users", "invites"],
  tools: ["calendar-tool-settings", "wiki-tool-settings", "chat", "pastes", "files", "survey-tool-settings", "vaults"],
};
const adminSubtabLabels = {
  settings: "SMTP",
  security: "Session Security",
  roles: "Access Controls",
  weather: "Weather",
  bulletins: "Bulletins",
  "team-shortcuts": "Shortcuts",
  users: "Users",
  invites: "Invites",
  "calendar-tool-settings": "RedSecCal",
  "wiki-tool-settings": "RedSecWiki",
  chat: "RedSecTeam",
  pastes: "RedSecPaste",
  files: "RedSecShare",
  "survey-tool-settings": "RedSecSurvey",
  vaults: "RedSecVault",
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
  }
  if (visibleTabs.has("settings")) {
    loadSmtpSettings();
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
          <td class="flex gap-2 flex-wrap">
            ${u.suspended
              ? `<button class="user-unsuspend-btn text-xs hover:underline" data-id="${u.id}">Unsuspend</button>`
              : `<button class="user-suspend-btn text-xs text-amber hover:underline" data-id="${u.id}">Suspend</button>`
            }
            <button class="user-reset-mfa-btn text-xs text-amber hover:underline hidden" data-id="${u.id}">Reset MFA</button>
            <button class="user-reset-btn text-xs hover:underline" data-id="${u.id}">Reset PW</button>
            <button class="user-delete-btn text-error text-xs hover:underline" data-id="${u.id}">Delete</button>
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
          <td class="flex gap-2">${actions}</td>
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
  const to = prompt("Enter email address to send test to:");
  if (!to) return;

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
      tr.className = "border-b";
      tr.style.borderColor = "var(--border)";
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
const saveSecurityBtn = document.getElementById("save-security-btn");
const securityResult = document.getElementById("security-result");

async function loadSecuritySettings() {
  try {
    const res = await api("/api/settings/security");
    if (!res.ok) return;
    const data = await res.json();
    securitySessionTTL.value = data.sessionTTL || 43200;
    securitySessionTTLExtended.value = data.sessionTTLExtended || 604800;
    securityMfaRememberDays.value = data.mfaRememberDays || 30;
    securityMfaRequired.checked = data.mfaRequired || false;
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
            ${role.isSystem ? "" : `<button class="btn-danger text-xs role-delete-btn" data-id="${role.id}">Delete</button>`}
          </div>
        </div>`;
      }).join("")
      : '<p class="text-sm text-muted">No roles configured.</p>';

    list.querySelectorAll(".role-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!await showConfirmModal({ title: "Delete Role", message: "Delete this role? Users with this role will lose its permissions.", confirmLabel: "Delete", danger: true })) return;
        await api(`/api/roles/${button.dataset.id}`, { method: "DELETE" });
        loadRoles();
        loadUsers();
      });
    });
  } catch {}
}

document.getElementById("create-role-btn")?.addEventListener("click", async () => {
  const name = document.getElementById("role-name").value.trim();
  const description = document.getElementById("role-description").value.trim();
  const permissions = [...document.querySelectorAll('#role-permissions-grid input[type="checkbox"]:checked')].map((input) => input.value);
  const result = document.getElementById("role-result");
  result.classList.add("hidden");
  try {
    await api("/api/roles", {
      method: "POST",
      body: JSON.stringify({ name, description, permissions }),
    });
    document.getElementById("role-name").value = "";
    document.getElementById("role-description").value = "";
    document.querySelectorAll('#role-permissions-grid input[type="checkbox"]').forEach((input) => { input.checked = false; });
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

// --- Init ---
checkAuth();
