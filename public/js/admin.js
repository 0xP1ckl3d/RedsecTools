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
  return res;
}

function showLogin() {
  loginSection.classList.remove("hidden");
  dashboard.classList.add("hidden");
  logoutBtn.classList.add("hidden");
}

function showDashboard() {
  loginSection.classList.add("hidden");
  dashboard.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  loadPasteStats();
  loadPastes();
  loadFileStats();
  loadFiles();
  loadUsers();
  loadInvites();
  loadSmtpSettings();
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
    const res = await fetch("/admin/api/paste-stats");
    if (res.ok) {
      showDashboard();
      return;
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
      loginError.classList.remove("hidden");
    }
  } catch {
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
const tabs = ["pastes", "files", "users", "invites", "settings", "chat"];

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    tabs.forEach((t) => {
      document.getElementById(`${t}-tab`).classList.toggle("hidden", t !== tab);
    });
    if (tab === "chat") {
      loadChatStats();
      loadChatConversations();
    }
  });
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
    if (!confirm("Delete this paste?")) return;
    try {
      const res = await api(`/api/paste/${id}`, { method: "DELETE" });
      if (res.ok) { loadPastes(); loadPasteStats(); }
    } catch {}
  }
});

pasteBulkDeleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete ${pasteSelectedIds.size} paste(s)?`)) return;
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

let filePage = 1;
let fileSelectedIds = new Set();

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
    if (!confirm("Delete this file?")) return;
    try {
      const res = await api(`/api/file/${id}`, { method: "DELETE" });
      if (res.ok) { loadFiles(); loadFileStats(); }
    } catch {}
  }
});

fileBulkDeleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete ${fileSelectedIds.size} file(s)?`)) return;
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
fileRefreshBtn.addEventListener("click", () => { loadFileStats(); loadFiles(); });

// ============================================================
// USERS
// ============================================================

const usersBody = document.getElementById("users-body");
const userPrevBtn = document.getElementById("user-prev-btn");
const userNextBtn = document.getElementById("user-next-btn");
const userPageInfo = document.getElementById("user-page-info");
const userRefreshBtn = document.getElementById("user-refresh-btn");

let userPage = 1;

async function loadUsers() {
  try {
    const res = await api(`/api/users?page=${userPage}&limit=50`);
    const data = await res.json();

    usersBody.innerHTML = "";

    if (data.users.length === 0) {
      usersBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">No users found.</td></tr>';
    } else {
      for (const u of data.users) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="text-sm font-medium">${escapeHtml(u.username)}</td>
          <td class="text-xs">${escapeHtml(u.email)}</td>
          <td>${u.suspended ? '<span class="badge badge-red">Suspended</span>' : '<span class="badge badge-green">Active</span>'}</td>
          <td class="text-xs">${formatTime(u.createdAt)}</td>
          <td class="flex gap-2 flex-wrap">
            ${u.suspended
              ? `<button class="user-unsuspend-btn text-xs hover:underline" data-id="${u.id}">Unsuspend</button>`
              : `<button class="user-suspend-btn text-xs text-amber hover:underline" data-id="${u.id}">Suspend</button>`
            }
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
  } catch {}
}

usersBody.addEventListener("click", async (e) => {
  const btn = e.target;
  const id = btn.dataset.id;

  if (btn.classList.contains("user-suspend-btn")) {
    if (!confirm("Suspend this user? They will be logged out immediately.")) return;
    await api(`/api/users/${id}/suspend`, { method: "POST" });
    loadUsers();
  } else if (btn.classList.contains("user-unsuspend-btn")) {
    await api(`/api/users/${id}/unsuspend`, { method: "POST" });
    loadUsers();
  } else if (btn.classList.contains("user-reset-btn")) {
    if (!confirm("Send password reset email to this user?")) return;
    const res = await api(`/api/users/${id}/reset-password`, { method: "POST" });
    const data = await res.json();
    if (data.emailSent) {
      alert("Password reset email sent.");
    } else {
      alert("Email failed. Reset URL: " + data.resetUrl);
    }
  } else if (btn.classList.contains("user-delete-btn")) {
    if (!confirm("Permanently delete this user? This cannot be undone.")) return;
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
      invitesBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-8">No invitations found.</td></tr>';
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
  if (!email) return;

  createInviteBtn.disabled = true;
  inviteResult.classList.add("hidden");

  try {
    const res = await api("/api/invites", {
      method: "POST",
      body: JSON.stringify({ email }),
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
    if (!confirm("Revoke this invitation?")) return;
    try {
      const res = await api(`/api/invites/${id}`, { method: "DELETE" });
      if (res.ok) {
        loadInvites();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to revoke");
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

    if (res.ok) {
      smtpResult.textContent = "Test email sent successfully!" + (data.smtpResponse ? ` — ${data.smtpResponse}` : "");
      smtpResult.className = "text-sm text-accent";
    } else {
      const data = await res.json();
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
  if (!confirm("Delete this conversation and all its messages?")) return;

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

// --- Utility ---
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---
checkAuth();
