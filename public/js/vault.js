// RedSecVault — Main UI logic
import {
  createPersonalVault, unlockPersonalVault,
  createTeamVault, unlockTeamVault,
  encryptEntry, decryptEntry, decryptSharedEntry,
  shareEntry, decryptSharedKey,
  generateTotpCode, generatePassword,
} from "./vault-crypto.js";

// ============================================================
// State
// ============================================================

let currentUser = null;
let rsaPrivateKey = null;
let vaults = [];
let decryptedEntries = [];
let sharedEntries = [];
let currentVaultId = null;
let currentEntryId = null;
let currentVaultMasterKey = null;
let masterKeyCache = {}; // vaultId → CryptoKey
let editingEntry = null;
let totpInterval = null;
let pwGenTargetField = null; // "f-password" or null
let allUsersCache = []; // cached user list for member search
let folderFilter = null; // null = show all, string = filter to folder

// ============================================================
// Init
// ============================================================

(async function init() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) { showAuthRequired(); return; }
    const data = await res.json();
    if (!data.user) { showAuthRequired(); return; }
    currentUser = data.user;
    document.getElementById("vault-content").classList.remove("hidden");
    document.getElementById("auth-required").classList.add("hidden");
    await loadRSAPrivateKey();
    await loadVaults();
    await loadSharedEntries();
    bindEvents();
  } catch (err) {
    console.error("[vault] init failed:", err);
    showAuthRequired();
  }
})();

function showAuthRequired() {
  document.getElementById("vault-content").classList.add("hidden");
  document.getElementById("auth-required").classList.remove("hidden");
}

async function loadRSAPrivateKey() {
  if (!window.ChatCrypto || !currentUser) return;
  try {
    rsaPrivateKey = await ChatCrypto.getKeyFromIndexedDB(currentUser.id);
  } catch (err) {
    console.error("[vault] RSA key load failed:", err);
  }
}

// ============================================================
// Vault list
// ============================================================

async function loadVaults() {
  try {
    const res = await fetch("/api/vault/vaults");
    if (!res.ok) return;
    const data = await res.json();
    vaults = data.vaults || [];
    renderVaultList();
  } catch (err) {
    console.error("[vault] loadVaults failed:", err);
  }
}

async function renderVaultList() {
  const container = document.getElementById("vault-list");
  const sharedSection = document.getElementById("shared-section");

  // Decrypt vault names from cached master keys
  const vaultNames = {};
  for (const v of vaults) {
    let name = null;
    // Try memory cache first
    if (masterKeyCache[v.id]) {
      try {
        const { decrypt } = await import("./crypto.js");
        name = await decrypt(v.nameEncrypted, masterKeyCache[v.id], v.nameIv);
      } catch {}
    }
    // Try VaultKeyStore
    if (!name && window.VaultKeyStore) {
      try {
        const key = await VaultKeyStore.getKey(v.id);
        if (key) {
          const { decrypt } = await import("./crypto.js");
          name = await decrypt(v.nameEncrypted, key, v.nameIv);
          masterKeyCache[v.id] = key;
        }
      } catch {}
    }
    // Team vaults: try RSA unlock
    if (!name && v.type === "team" && rsaPrivateKey) {
      try {
        const mkRes = await fetch(`/api/vault/vaults/${v.id}/master-key`);
        if (mkRes.ok) {
          const mkData = await mkRes.json();
          if (mkData.encryptedMasterKey) {
            const key = await unlockTeamVault(mkData.encryptedMasterKey, rsaPrivateKey);
            const { decrypt } = await import("./crypto.js");
            name = await decrypt(v.nameEncrypted, key, v.nameIv);
            masterKeyCache[v.id] = key;
            if (window.VaultKeyStore) await VaultKeyStore.storeKey(v.id, key);
          }
        }
      } catch {}
    }
    if (name) vaultNames[v.id] = name;
  }

  const personal = vaults.filter(v => v.type === "personal");
  const team = vaults.filter(v => v.type === "team");

  let html = "";
  if (personal.length) {
    html += `<div class="text-xs text-muted mt-1 mb-1 px-2">Personal</div>`;
    for (const v of personal) {
      html += vaultListItem(v, "personal", vaultNames[v.id]);
    }
  }
  if (team.length) {
    if (personal.length) html += `<div class="my-2"></div>`;
    html += `<div class="text-xs text-muted mt-1 mb-1 px-2">Team</div>`;
    for (const v of team) {
      html += vaultListItem(v, "team", vaultNames[v.id]);
    }
  }
  if (!vaults.length) {
    html = `<div class="text-xs text-muted text-center py-4">No vaults yet</div>`;
  }
  container.innerHTML = html;

  // Show shared section if there are shared entries
  sharedSection.classList.toggle("hidden", !sharedEntries.length);

  // Bind vault clicks
  container.querySelectorAll("[data-vault-id]").forEach(el => {
    el.addEventListener("click", () => selectVault(el.dataset.vaultId));
  });
}

function vaultListItem(v, type, name) {
  const active = v.id === currentVaultId;
  const icon = type === "personal"
    ? `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>`
    : `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;
  const displayName = name || "Vault";
  return `<button data-vault-id="${v.id}" class="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${active ? "bg-accent/10 text-accent" : "hover:bg-[var(--bg-elevated)] text-primary"}">${icon}<span class="truncate">${escHtml(displayName)}</span></button>`;
}

async function selectVault(vaultId) {
  currentVaultId = vaultId;
  currentEntryId = null;
  currentVaultMasterKey = null;
  folderFilter = null;
  clearTotpInterval();
  renderVaultList();
  renderSharedList();

  // Clear previous member display
  const memberArea = document.getElementById("vault-members-display");
  if (memberArea) memberArea.remove();

  document.getElementById("no-vault-selected").classList.add("hidden");
  document.getElementById("entry-detail-panel").classList.add("hidden");

  const vault = vaults.find(v => v.id === vaultId);
  if (!vault) return;

  // Try to unlock vault
  await unlockVault(vault);
  if (!currentVaultMasterKey) {
    showEntryListPanel(vault, []);
    document.getElementById("entry-list").innerHTML = `<div class="p-4 text-center text-muted text-sm">Could not unlock vault. RSA key may not be available.</div>`;
    document.getElementById("empty-entries").classList.add("hidden");
    return;
  }

  // Load entries
  await loadEntries(vaultId);
}

async function unlockVault(vault) {
  if (masterKeyCache[vault.id]) {
    currentVaultMasterKey = masterKeyCache[vault.id];
    return;
  }

  try {
    const res = await fetch(`/api/vault/vaults/${vault.id}/master-key`);
    if (!res.ok) return;
    const data = await res.json();

    if (vault.type === "personal") {
      // Try VaultKeyStore first (auto-unlock — key restored during login, same as chat RSA key)
      if (window.VaultKeyStore) {
        const storedKey = await VaultKeyStore.getKey(vault.id);
        if (storedKey) {
          currentVaultMasterKey = storedKey;
          masterKeyCache[vault.id] = storedKey;
          return;
        }
      }
      // Fallback: show unlock modal (user navigated directly without login flow)
      const password = await showUnlockModal();
      if (!password) return;
      try {
        const key = await unlockPersonalVault(
          data.encryptedMasterKey, data.masterKeyIv, data.masterKeySalt, password
        );
        currentVaultMasterKey = key;
        masterKeyCache[vault.id] = key;
        // Store for future auto-unlock
        if (window.VaultKeyStore) await VaultKeyStore.storeKey(vault.id, key);
      } catch {
        showToast("Incorrect password");
      }
    } else if (vault.type === "team") {
      if (!rsaPrivateKey) return;
      const key = await unlockTeamVault(data.encryptedMasterKey, rsaPrivateKey);
      currentVaultMasterKey = key;
      masterKeyCache[vault.id] = key;
    }
  } catch (err) {
    console.error("[vault] unlock failed:", err);
  }
}

// ============================================================
// Entries
// ============================================================

async function loadEntries(vaultId) {
  try {
    const res = await fetch(`/api/vault/vaults/${vaultId}/entries`);
    if (!res.ok) return;
    const data = await res.json();
    const entries = data.entries || [];

    decryptedEntries = [];
    for (const entry of entries) {
      try {
        const dec = await decryptEntry(entry, currentVaultMasterKey);
        decryptedEntries.push(dec);
      } catch (err) {
        console.error("[vault] decrypt entry failed:", entry.id, err);
      }
    }

    // Try to decrypt vault name with master key
    const vault = vaults.find(v => v.id === vaultId);
    if (vault) {
      try {
        const { decrypt } = await import("./crypto.js");
        const name = await decrypt(vault.nameEncrypted, currentVaultMasterKey, vault.nameIv);
        const nameEl = document.querySelector(`.vault-name-${vaultId}`);
        if (nameEl) nameEl.textContent = name;
        showEntryListPanel(vault, decryptedEntries, name);
      } catch {
        showEntryListPanel(vault, decryptedEntries);
      }
    }

    renderEntries();
  } catch (err) {
    console.error("[vault] loadEntries failed:", err);
  }
}

function showEntryListPanel(vault, entries, name) {
  const panel = document.getElementById("entry-list-panel");
  panel.classList.remove("hidden");
  document.getElementById("current-vault-name").textContent = name || "Vault";
  document.getElementById("entry-count").textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
  document.getElementById("create-entry-btn").classList.remove("hidden");

  // Show delete vault button only for owner
  const deleteBtn = document.getElementById("delete-vault-btn");
  if (deleteBtn) {
    deleteBtn.classList.toggle("hidden", vault.owner_id !== currentUser.id);
  }

  // Load members for team vaults
  if (vault.type === "team") loadTeamMembers(vault.id);
}

async function loadTeamMembers(vaultId) {
  try {
    const res = await fetch(`/api/vault/vaults/${vaultId}/members`);
    if (!res.ok) return;
    const data = await res.json();
    const members = data.members || [];
    if (!members.length) return;

    // Find or create member display area
    let memberArea = document.getElementById("vault-members-display");
    if (!memberArea) {
      memberArea = document.createElement("div");
      memberArea.id = "vault-members-display";
      memberArea.className = "px-4 py-2 border-b border-[var(--border)] flex items-center gap-2 flex-wrap";
      const header = document.querySelector("#entry-list-panel > div:first-child");
      if (header) header.after(memberArea);
    }
    memberArea.innerHTML = members.map(m =>
      `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-xs text-muted">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
        ${escHtml(m.username)}
        ${m.role === "admin" ? '<span class="text-accent">(admin)</span>' : ""}
      </span>`
    ).join("");
  } catch (err) {
    console.error("[vault] loadTeamMembers failed:", err);
  }
}

function renderEntries() {
  const container = document.getElementById("entry-list");
  const empty = document.getElementById("empty-entries");
  const query = document.getElementById("search-input").value.toLowerCase();

  let filtered = decryptedEntries;
  if (query) {
    filtered = filtered.filter(e =>
      e.title.toLowerCase().includes(query) ||
      (e.folder && e.folder.toLowerCase().includes(query)) ||
      e.type.toLowerCase().includes(query)
    );
  }

  // Apply folder filter
  if (folderFilter) {
    filtered = filtered.filter(e => e.folder === folderFilter);
  }

  // Sort: favorites first, then alphabetical
  filtered.sort((a, b) => {
    if (a.favorite !== b.favorite) return b.favorite ? 1 : -1;
    return a.title.localeCompare(b.title);
  });

  if (!filtered.length) {
    container.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  // Build folder groups
  const entriesWithFolder = filtered.filter(e => e.folder);
  const entriesWithoutFolder = filtered.filter(e => !e.folder);
  const folders = [...new Set(entriesWithFolder.map(e => e.folder))].sort();

  let html = "";

  // Folder filter header (when filtering by a folder)
  if (folderFilter) {
    html += `<button id="folder-back" class="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-accent hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border)]">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      ${escHtml(folderFilter)} (${filtered.length} entr${filtered.length === 1 ? "y" : "ies"})
    </button>`;
    html += entriesWithFolder.map(e => entryListItem(e)).join("");
  } else {
    // Show folder headers as clickable groups, then ungrouped entries
    for (const folder of folders) {
      const folderEntries = entriesWithFolder.filter(e => e.folder === folder);
      html += `<button data-folder="${escAttr(folder)}" class="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-[var(--bg-elevated)] transition-colors border-b border-[var(--border)]">
        <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <span class="flex-1 text-left">${escHtml(folder)}</span>
        <span class="text-xs text-muted">${folderEntries.length}</span>
      </button>`;
    }
    html += entriesWithoutFolder.map(e => entryListItem(e)).join("");
  }

  container.innerHTML = html;

  // Bind events
  container.querySelectorAll("[data-entry-id]").forEach(el => {
    el.addEventListener("click", () => showEntryDetail(el.dataset.entryId));
  });
  container.querySelectorAll("[data-folder]").forEach(el => {
    el.addEventListener("click", () => {
      folderFilter = el.dataset.folder;
      renderEntries();
    });
  });
  const folderBack = document.getElementById("folder-back");
  if (folderBack) {
    folderBack.addEventListener("click", () => {
      folderFilter = null;
      renderEntries();
    });
  }
}

function entryListItem(e) {
  const icons = {
    password: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`,
    note: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
    api_key: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>`,
    ssh_key: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>`,
    totp: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
    custom: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"/></svg>`,
  };
  const star = e.favorite ? `<svg class="w-3.5 h-3.5 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>` : "";
  const folder = e.folder ? `<span class="text-xs text-muted">${escHtml(e.folder)}</span>` : "";

  return `<button data-entry-id="${e.id}" class="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors text-left">
    <span class="text-accent shrink-0">${icons[e.type] || icons.custom}</span>
    <span class="flex-1 min-w-0">
      <span class="block text-sm font-medium truncate">${escHtml(e.title)}</span>
      ${folder}
    </span>
    ${star}
    <span class="text-xs text-muted capitalize shrink-0">${e.type.replace("_", " ")}</span>
  </button>`;
}

// ============================================================
// Shared entries
// ============================================================

async function loadSharedEntries() {
  if (!rsaPrivateKey) return;
  try {
    const res = await fetch("/api/vault/shared");
    if (!res.ok) return;
    const data = await res.json();
    const shares = data.shares || [];

    sharedEntries = [];
    for (const share of shares) {
      try {
        const shareKey = await decryptSharedKey(share.encryptedEntryKey, rsaPrivateKey);
        const dec = await decryptSharedEntry(share, shareKey);
        sharedEntries.push(dec);
      } catch (err) {
        console.error("[vault] decrypt shared entry failed:", share.id, err);
      }
    }

    renderSharedList();
    const sharedSection = document.getElementById("shared-section");
    sharedSection.classList.toggle("hidden", !sharedEntries.length);
  } catch (err) {
    console.error("[vault] loadSharedEntries failed:", err);
  }
}

function renderSharedList() {
  const container = document.getElementById("shared-list");
  if (!sharedEntries.length) {
    container.innerHTML = `<div class="text-xs text-muted text-center py-2">None</div>`;
    return;
  }
  container.innerHTML = sharedEntries.map(s => {
    const active = s.id === currentEntryId;
    return `<button data-share-id="${s.id}" class="w-full flex items-center gap-2 px-3 py-2 rounded text-sm text-left transition-colors ${active ? "bg-accent/10 text-accent" : "hover:bg-[var(--bg-elevated)] text-primary"}">
      <svg class="w-4 h-4 shrink-0 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
      <span class="truncate">${escHtml(s.title)}</span>
    </button>`;
  }).join("");

  container.querySelectorAll("[data-share-id]").forEach(el => {
    el.addEventListener("click", () => showSharedEntryDetail(el.dataset.shareId));
  });
}

// ============================================================
// Entry detail view
// ============================================================

function showEntryDetail(entryId) {
  const entry = decryptedEntries.find(e => e.id === entryId);
  if (!entry) return;
  currentEntryId = entryId;
  clearTotpInterval();

  document.getElementById("entry-list-panel").classList.add("hidden");
  document.getElementById("entry-detail-panel").classList.remove("hidden");

  const html = buildEntryDetail(entry);
  document.getElementById("entry-detail-content").innerHTML = html;
  bindDetailActions(entry);
  if (entry.type === "totp") startTotpTimer(entry);
  // Show action buttons for own entries
  document.getElementById("share-entry-btn").classList.remove("hidden");
  document.getElementById("edit-entry-btn").classList.remove("hidden");
  document.getElementById("delete-entry-btn").classList.remove("hidden");
  // Load shares for this entry
  loadEntryShares(entryId);
}

function showSharedEntryDetail(shareId) {
  const share = sharedEntries.find(s => s.id === shareId);
  if (!share) return;
  currentEntryId = shareId;
  clearTotpInterval();
  currentVaultId = null;
  renderVaultList();

  document.getElementById("entry-list-panel").classList.add("hidden");
  document.getElementById("no-vault-selected").classList.add("hidden");
  document.getElementById("entry-detail-panel").classList.remove("hidden");

  const entry = { id: share.entryId, type: share.type, title: share.title, data: share.data, sharedFrom: share.fromUsername };
  const html = buildEntryDetail(entry);
  document.getElementById("entry-detail-content").innerHTML = html;
  bindDetailActions(entry);
  if (entry.type === "totp") startTotpTimer(entry);
  // Hide edit/share/delete for shared entries
  document.getElementById("share-entry-btn").classList.add("hidden");
  document.getElementById("edit-entry-btn").classList.add("hidden");
  document.getElementById("delete-entry-btn").classList.add("hidden");
}

function buildEntryDetail(entry) {
  let html = `<div class="mb-4"><h2 class="text-lg font-bold">${escHtml(entry.title)}</h2>`;
  if (entry.folder) html += `<span class="text-xs text-muted">${escHtml(entry.folder)}</span>`;
  html += `</div>`;

  const d = entry.data || {};
  const row = (label, value, mono = false) => {
    if (!value) return "";
    return `<div class="flex items-start gap-3 py-2 border-b border-[var(--border)]">
      <span class="text-sm text-muted w-28 shrink-0">${label}</span>
      <span class="text-sm ${mono ? "font-mono break-all" : ""} flex-1">${escHtml(value)}</span>
      <button data-copy="${escAttr(value)}" class="copy-btn text-xs text-accent hover:underline shrink-0">Copy</button>
    </div>`;
  };
  const secretRow = (label, value) => {
    if (!value) return "";
    return `<div class="flex items-start gap-3 py-2 border-b border-[var(--border)]">
      <span class="text-sm text-muted w-28 shrink-0">${label}</span>
      <span class="text-sm font-mono flex-1 secret-field" data-secret="${escAttr(value)}">••••••••</span>
      <button data-toggle-secret class="text-xs text-accent hover:underline shrink-0">Show</button>
      <button data-copy="${escAttr(value)}" class="copy-btn text-xs text-accent hover:underline shrink-0">Copy</button>
    </div>`;
  };

  switch (entry.type) {
    case "password":
      html += row("Username", d.username);
      html += secretRow("Password", d.password);
      html += row("URL", d.url);
      break;
    case "note":
      html += `<div class="py-2 border-b border-[var(--border)]">
        <pre class="text-sm whitespace-pre-wrap break-words">${escHtml(d.content || "")}</pre>
        <button data-copy="${escAttr(d.content || "")}" class="copy-btn text-xs text-accent hover:underline mt-2">Copy</button>
      </div>`;
      break;
    case "api_key":
      html += secretRow("API Key", d.key);
      html += row("Service", d.service);
      break;
    case "ssh_key":
      html += secretRow("Private Key", d.private_key);
      html += row("Public Key", d.public_key, true);
      html += secretRow("Passphrase", d.passphrase);
      break;
    case "totp":
      html += `<div class="py-3 border-b border-[var(--border)]">
        <div class="flex items-center gap-3">
          <span id="totp-code" class="text-2xl font-mono font-bold tracking-widest text-accent">------</span>
          <button id="totp-copy" class="text-xs text-accent hover:underline">Copy</button>
        </div>
        <div class="flex items-center gap-2 mt-2">
          <div class="flex-1 h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
            <div class="totp-bar totp-bar-animate" id="totp-progress"></div>
          </div>
          <span id="totp-seconds" class="text-xs text-muted">--</span>
        </div>
      </div>`;
      html += row("Issuer", d.issuer);
      html += row("Account", d.account);
      html += secretRow("Secret", d.secret);
      break;
    case "custom":
      if (d.fields && d.fields.length) {
        for (const f of d.fields) {
          if (f.type === "password") html += secretRow(f.label, f.value);
          else html += row(f.label, f.value);
        }
      }
      break;
  }

  if (d.notes) html += `<div class="py-2 text-sm text-muted">${escHtml(d.notes)}</div>`;

  // Shared from badge
  if (entry.sharedFrom) {
    html += `<div class="mt-3 pt-3 border-t border-[var(--border)]"><span class="badge badge-gray">Shared by ${escHtml(entry.sharedFrom)}</span></div>`;
  }

  // Shared with section (only for own entries, not shared-from-others)
  if (!entry.sharedFrom) {
    html += `<div id="entry-shares-section" class="mt-3 pt-3 border-t border-[var(--border)] hidden"></div>`;
  }

  return html;
}

function bindDetailActions(entry) {
  // Copy buttons
  document.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      copyToClipboard(btn.dataset.copy);
      showToast("Copied to clipboard");
    });
  });

  // Show/hide secret fields
  document.querySelectorAll("[data-toggle-secret]").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.parentElement.querySelector(".secret-field");
      const isHidden = field.textContent === "••••••••";
      field.textContent = isHidden ? field.dataset.secret : "••••••••";
      btn.textContent = isHidden ? "Hide" : "Show";
    });
  });

  // TOTP copy
  const totpCopy = document.getElementById("totp-copy");
  if (totpCopy) {
    totpCopy.addEventListener("click", () => {
      const code = document.getElementById("totp-code")?.textContent;
      if (code && code !== "------") copyToClipboard(code);
      showToast("TOTP copied");
    });
  }
}

// ============================================================
// TOTP timer
// ============================================================

function startTotpTimer(entry) {
  const d = entry.data || {};
  const period = d.period || 30;
  const digits = d.digits || 6;
  const algorithm = d.algorithm || "SHA-1";
  const animClass = period === 60 ? "totp-bar-animate-60" : "totp-bar-animate";
  let lastCode = null;

  function restartAnimation(elapsed) {
    const progEl = document.getElementById("totp-progress");
    if (!progEl) return;
    // Remove animation, force reflow, re-apply with correct offset
    progEl.className = "totp-bar";
    void progEl.offsetWidth;
    const offsetClass = elapsed > 0 ? `totp-e${Math.min(elapsed, 59)}` : "";
    progEl.className = `totp-bar ${animClass} ${offsetClass}`.trim();
  }

  async function update() {
    if (!d.secret) return;
    try {
      const result = await generateTotpCode(d.secret, period, digits, algorithm);
      const codeEl = document.getElementById("totp-code");
      const secEl = document.getElementById("totp-seconds");
      if (codeEl) codeEl.textContent = result.code;
      if (secEl) secEl.textContent = `${result.secondsRemaining}s`;
      // Restart animation on period boundary or first render
      if (result.code !== lastCode) {
        lastCode = result.code;
        const elapsed = period - result.secondsRemaining;
        restartAnimation(elapsed);
      }
    } catch (err) {
      console.error("[vault] TOTP gen failed:", err);
    }
  }

  update();
  totpInterval = setInterval(update, 1000);
}

function clearTotpInterval() {
  if (totpInterval) { clearInterval(totpInterval); totpInterval = null; }
}

// ============================================================
// Create / Edit Entry Modal
// ============================================================

function openEntryModal(entry = null) {
  editingEntry = entry;
  const modal = document.getElementById("entry-modal");
  const title = document.getElementById("entry-modal-title");
  title.textContent = entry ? "Edit Entry" : "New Entry";

  document.getElementById("entry-title").value = entry ? entry.title : "";
  document.getElementById("entry-type").value = entry ? entry.type : "password";
  document.getElementById("entry-folder").value = entry ? (entry.folder || "") : "";

  const d = entry ? (entry.data || {}) : {};
  document.getElementById("f-username").value = d.username || "";
  document.getElementById("f-password").value = d.password || "";
  document.getElementById("f-url").value = d.url || "";
  document.getElementById("f-content").value = d.content || "";
  document.getElementById("f-key").value = d.key || "";
  document.getElementById("f-service").value = d.service || "";
  document.getElementById("f-private-key").value = d.private_key || "";
  document.getElementById("f-public-key").value = d.public_key || "";
  document.getElementById("f-passphrase").value = d.passphrase || "";
  document.getElementById("f-totp-secret").value = d.secret || "";
  document.getElementById("f-totp-issuer").value = d.issuer || "";
  document.getElementById("f-totp-account").value = d.account || "";
  document.getElementById("f-totp-digits").value = (d.digits || 6).toString();
  document.getElementById("f-notes").value = d.notes || "";
  document.getElementById("entry-favorite").checked = entry ? !!entry.favorite : false;

  // Custom fields
  const customList = document.getElementById("custom-fields-list");
  if (entry && entry.type === "custom" && d.fields) {
    customList.innerHTML = d.fields.map((f, i) => customFieldHtml(i, f)).join("");
  } else {
    customList.innerHTML = "";
  }

  showTypeFields(entry ? entry.type : "password");
  modal.classList.remove("hidden");
}

function showTypeFields(type) {
  ["password", "note", "api_key", "ssh_key", "totp", "custom"].forEach(t => {
    const el = document.getElementById(`fields-${t}`);
    if (el) el.classList.toggle("hidden", t !== type);
  });
}

function customFieldHtml(index, field = {}) {
  return `<div class="flex gap-2 items-start" data-custom-field="${index}">
    <input type="text" class="input-field flex-1 text-sm custom-field-label" placeholder="Label" value="${escAttr(field.label || "")}">
    <input type="text" class="input-field flex-1 text-sm custom-field-value" placeholder="Value" value="${escAttr(field.value || "")}">
    <select class="input-field w-24 text-sm custom-field-type">
      <option value="text" ${field.type === "text" ? "selected" : ""}>Text</option>
      <option value="password" ${field.type === "password" ? "selected" : ""}>Password</option>
      <option value="url" ${field.type === "url" ? "selected" : ""}>URL</option>
      <option value="email" ${field.type === "email" ? "selected" : ""}>Email</option>
    </select>
    <button data-remove-custom-field class="text-muted hover:text-accent p-1">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  </div>`;
}

function getEntryFormData() {
  const type = document.getElementById("entry-type").value;
  const title = document.getElementById("entry-title").value.trim();
  const folder = document.getElementById("entry-folder").value.trim() || null;
  const favorite = document.getElementById("entry-favorite").checked;
  const notes = document.getElementById("f-notes").value.trim();

  let data = {};
  switch (type) {
    case "password":
      data = { username: document.getElementById("f-username").value.trim(), password: document.getElementById("f-password").value, url: document.getElementById("f-url").value.trim() };
      break;
    case "note":
      data = { content: document.getElementById("f-content").value };
      break;
    case "api_key":
      data = { key: document.getElementById("f-key").value.trim(), service: document.getElementById("f-service").value.trim() };
      break;
    case "ssh_key":
      data = { private_key: document.getElementById("f-private-key").value, public_key: document.getElementById("f-public-key").value.trim(), passphrase: document.getElementById("f-passphrase").value };
      break;
    case "totp":
      data = { secret: document.getElementById("f-totp-secret").value.trim().toUpperCase(), issuer: document.getElementById("f-totp-issuer").value.trim(), account: document.getElementById("f-totp-account").value.trim(), digits: parseInt(document.getElementById("f-totp-digits").value), period: 30, algorithm: "SHA-1" };
      break;
    case "custom":
      const fields = [];
      document.querySelectorAll("[data-custom-field]").forEach(row => {
        fields.push({ label: row.querySelector(".custom-field-label").value.trim(), value: row.querySelector(".custom-field-value").value, type: row.querySelector(".custom-field-type").value });
      });
      data = { fields };
      break;
  }
  if (notes) data.notes = notes;

  return { type, title, folder, favorite, data };
}

async function saveEntry() {
  const formData = getEntryFormData();
  if (!formData.title) { showToast("Title is required"); return; }
  if (!currentVaultMasterKey) { showToast("Vault not unlocked"); return; }

  try {
    const encrypted = await encryptEntry(formData.title, formData.data, formData.folder, currentVaultMasterKey);
    const body = { ...encrypted, type: formData.type, favorite: formData.favorite };

    let res;
    if (editingEntry) {
      res = await fetch(`/api/vault/entries/${editingEntry.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      res = await fetch(`/api/vault/vaults/${currentVaultId}/entries`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    if (!res.ok) { const d = await res.json(); showToast(d.error || "Failed to save entry"); return; }

    closeModal("entry-modal");
    editingEntry = null;
    await loadEntries(currentVaultId);
    showToast(editingEntry ? "Entry updated" : "Entry created");
  } catch (err) {
    console.error("[vault] saveEntry failed:", err);
    showToast("Failed to save entry");
  }
}

// ============================================================
// Create Vault Modal
// ============================================================

function openCreateVaultModal() {
  document.getElementById("new-vault-name").value = "";
  document.querySelector('input[name="vault-type"][value="personal"]').checked = true;
  document.getElementById("team-members-section").classList.add("hidden");
  document.getElementById("member-chips").innerHTML = "";
  document.getElementById("member-search").value = "";
  document.getElementById("member-search-results").innerHTML = "";
  vaultMembers = [];
  allUsersCache = []; // reset cache so it reloads
  document.getElementById("create-vault-modal").classList.remove("hidden");
}

let vaultMembers = []; // temp array for team vault creation

async function saveVault() {
  const name = document.getElementById("new-vault-name").value.trim();
  if (!name) { showToast("Vault name is required"); return; }

  const type = document.querySelector('input[name="vault-type"]:checked').value;
  showLoading("Creating vault...");

  try {
    if (type === "personal") {
      const password = await showUnlockModal("create");
      if (!password) { hideLoading(); return; }

      const result = await createPersonalVault(name, password);
      const res = await fetch("/api/vault/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameEncrypted: result.nameEncrypted, nameIv: result.nameIv, type: "personal", encryptedMasterKey: result.encryptedMasterKey, masterKeyIv: result.masterKeyIv, masterKeySalt: result.masterKeySalt }),
      });

      if (!res.ok) { const d = await res.json(); hideLoading(); showToast(d.error || "Failed to create vault"); return; }
      const vaultData = await res.json();
      masterKeyCache[vaultData.id] = result.masterKey;
      // Store key for auto-unlock
      if (window.VaultKeyStore) await VaultKeyStore.storeKey(vaultData.id, result.masterKey);
    } else {
      // Team vault
      if (!vaultMembers.length) { hideLoading(); showToast("Add at least one team member"); return; }
      if (!rsaPrivateKey) { hideLoading(); showToast("RSA key not available"); return; }

      const members = [];
      for (const m of vaultMembers) {
        const pubKey = await ChatCrypto.importPublicKey(m.publicKey);
        members.push({ userId: m.id, publicKey: pubKey, role: "member" });
      }

      // Include owner as admin member
      const ownerPubKeyRes = await fetch(`/api/chat/keys/${currentUser.id}`);
      if (ownerPubKeyRes.ok) {
        const ownerKeyData = await ownerPubKeyRes.json();
        if (ownerKeyData.publicKey) {
          const ownerPubKey = await ChatCrypto.importPublicKey(ownerKeyData.publicKey);
          members.push({ userId: currentUser.id, publicKey: ownerPubKey, role: "admin" });
        }
      }

      const result = await createTeamVault(name, members);
      const res = await fetch("/api/vault/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameEncrypted: result.nameEncrypted, nameIv: result.nameIv, type: "team", members: result.members }),
      });

      if (!res.ok) { const d = await res.json(); hideLoading(); showToast(d.error || "Failed to create vault"); return; }
      const teamVaultData = await res.json();
      masterKeyCache[teamVaultData.id] = result.masterKey;
      if (window.VaultKeyStore) await VaultKeyStore.storeKey(teamVaultData.id, result.masterKey);
    }

    closeModal("create-vault-modal");
    vaultMembers = [];
    hideLoading();
    await loadVaults();
    showToast("Vault created");
  } catch (err) {
    console.error("[vault] saveVault failed:", err);
    hideLoading();
    showToast("Failed to create vault");
  }
}

async function searchMember(query) {
  // Client-side filter from allUsersCache (loaded when modal opens)
  if (!allUsersCache.length) {
    try {
      const res = await fetch(`/api/vault/users/search?q=`);
      if (!res.ok) return;
      const data = await res.json();
      allUsersCache = (data.users || []).filter(u => u.hasPublicKey);
    } catch (err) {
      console.error("[vault] member search load failed:", err);
      return;
    }
  }

  const container = document.getElementById("member-search-results");
  const q = (query || "").toLowerCase();
  let users = allUsersCache.filter(u => !vaultMembers.find(m => m.id === u.id));
  if (q) users = users.filter(u => u.username.toLowerCase().includes(q));

  container.innerHTML = users.map(u => `<button data-user-id="${u.id}" data-username="${escAttr(u.username)}" class="w-full text-left px-3 py-2 rounded hover:bg-[var(--bg-elevated)] text-sm">${escHtml(u.username)}</button>`).join("");
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => addMemberChip(btn.dataset.userId, btn.dataset.username));
  });
}

async function addMemberChip(userId, username) {
  // Fetch public key for this user
  try {
    const res = await fetch(`/api/chat/keys/${userId}`);
    if (!res.ok) { showToast("User has no encryption keys"); return; }
    const data = await res.json();
    if (!data.publicKey) { showToast("User has no encryption keys"); return; }
    vaultMembers.push({ id: userId, username, publicKey: data.publicKey });
    renderMemberChips();
    document.getElementById("member-search-results").innerHTML = "";
    document.getElementById("member-search").value = "";
  } catch (err) {
    showToast("Could not fetch user keys");
  }
}

function renderMemberChips() {
  document.getElementById("member-chips").innerHTML = vaultMembers.map(m =>
    `<span class="inline-flex items-center gap-1 px-2 py-1 rounded bg-accent/10 text-accent text-xs">
      ${escHtml(m.username)}
      <button data-remove-member="${m.id}" class="hover:text-primary">&times;</button>
    </span>`
  ).join("");
  document.querySelectorAll("[data-remove-member]").forEach(btn => {
    btn.addEventListener("click", () => {
      vaultMembers = vaultMembers.filter(m => m.id !== btn.dataset.removeMember);
      renderMemberChips();
    });
  });
}

// ============================================================
// Password Generator Modal
// ============================================================

function openPwGenModal(targetField) {
  pwGenTargetField = targetField || "f-password";
  document.getElementById("pwgen-modal").classList.remove("hidden");
  regeneratePw();
}

function regeneratePw() {
  const length = parseInt(document.getElementById("pw-length").value);
  const options = {
    uppercase: document.getElementById("pw-upper").checked,
    lowercase: document.getElementById("pw-lower").checked,
    digits: document.getElementById("pw-digits").checked,
    symbols: document.getElementById("pw-symbols").checked,
    excludeAmbiguous: document.getElementById("pw-no-ambiguous").checked,
  };
  const result = generatePassword(length, options);
  document.getElementById("generated-pw").textContent = result.password;
  document.getElementById("pw-entropy").textContent = `${result.entropy} bits of entropy`;
}

function copyPwAndClose() {
  const pw = document.getElementById("generated-pw").textContent;
  if (pwGenTargetField) {
    document.getElementById(pwGenTargetField).value = pw;
  }
  closeModal("pwgen-modal");
}

// ============================================================
// Share Entry Modal
// ============================================================

let shareTargetUser = null;
let shareUsersCache = [];

function openShareModal(entry) {
  shareTargetUser = null;
  document.getElementById("share-entry-name").textContent = entry.title;
  document.getElementById("share-user-search").value = "";
  document.getElementById("share-target-info").classList.add("hidden");
  document.getElementById("confirm-share-btn").disabled = true;
  document.getElementById("share-modal").classList.remove("hidden");
  loadShareUsers();
}

async function loadShareUsers() {
  if (!shareUsersCache.length) {
    try {
      const res = await fetch(`/api/vault/users/search?q=`);
      if (!res.ok) return;
      const data = await res.json();
      shareUsersCache = (data.users || []).filter(u => u.hasPublicKey);
    } catch (err) {
      console.error("[vault] share user load failed:", err);
      return;
    }
  }
  renderShareUserList("");
}

function searchShareUser(query) {
  renderShareUserList(query);
}

function renderShareUserList(query) {
  const container = document.getElementById("share-search-results");
  const q = (query || "").toLowerCase();
  let users = shareUsersCache.filter(u => u.id !== currentUser.id);
  if (q) users = users.filter(u => u.username.toLowerCase().includes(q));

  container.innerHTML = users.map(u =>
    `<button data-user-id="${u.id}" data-username="${escAttr(u.username)}" class="w-full text-left px-3 py-2 rounded hover:bg-[var(--bg-elevated)] text-sm">${escHtml(u.username)}</button>`
  ).join("");
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => selectShareTarget(btn.dataset.userId, btn.dataset.username));
  });
}

function selectShareTarget(userId, username) {
  shareTargetUser = { id: userId, username };
  document.getElementById("share-target-info").classList.remove("hidden");
  document.getElementById("share-target-info").textContent = `Share with ${username}`;
  document.getElementById("confirm-share-btn").disabled = false;
  document.getElementById("share-search-results").innerHTML = "";
}

async function confirmShare() {
  if (!shareTargetUser || !currentEntryId) return;
  const entry = decryptedEntries.find(e => e.id === currentEntryId);
  if (!entry) return;

  const expirySelect = document.getElementById("share-expiry");
  const expiresIn = expirySelect ? parseInt(expirySelect.value, 10) : 0;
  const expiresAt = expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : null;

  showLoading("Sharing entry...");
  try {
    const res = await fetch(`/api/chat/keys/${shareTargetUser.id}`);
    if (!res.ok) { hideLoading(); showToast("User has no encryption keys"); return; }
    const keyData = await res.json();
    const publicKey = await ChatCrypto.importPublicKey(keyData.publicKey);

    const shareData = await shareEntry(entry, publicKey);
    const apiRes = await fetch(`/api/vault/entries/${entry.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: shareTargetUser.id, expiresAt, ...shareData }),
    });

    if (!apiRes.ok) { const d = await apiRes.json(); hideLoading(); showToast(d.error || "Share failed"); return; }

    closeModal("share-modal");
    hideLoading();
    showToast("Entry shared");
    loadEntryShares(currentEntryId);
  } catch (err) {
    console.error("[vault] share failed:", err);
    hideLoading();
    showToast("Failed to share entry");
  }
}

// ============================================================
// Entry shares display
// ============================================================

async function loadEntryShares(entryId) {
  const section = document.getElementById("entry-shares-section");
  if (!section) return;

  try {
    const res = await fetch(`/api/vault/entries/${entryId}/shares`);
    if (!res.ok) return;
    const data = await res.json();
    const shares = data.shares || [];

    if (!shares.length) {
      section.classList.add("hidden");
      return;
    }

    section.classList.remove("hidden");
    section.innerHTML =
      `<div class="text-xs font-bold uppercase text-muted tracking-wide mb-2">Shared with</div>` +
      shares.map(s => {
        const expiry = s.expiresAt ? ` — expires ${new Date(s.expiresAt * 1000).toLocaleDateString()}` : "";
        return `<div class="flex items-center justify-between py-1.5">
          <span class="text-sm">${escHtml(s.toUsername)}${expiry}</span>
          <button data-revoke-share="${s.id}" class="text-xs text-error hover:underline">Revoke</button>
        </div>`;
      }).join("");

    section.querySelectorAll("[data-revoke-share]").forEach(btn => {
      btn.addEventListener("click", () => revokeShare(btn.dataset.revokeShare, entryId));
    });
  } catch (err) {
    console.error("[vault] load shares failed:", err);
  }
}

async function revokeShare(shareId, entryId) {
  try {
    const res = await fetch(`/api/vault/shared/${shareId}`, { method: "DELETE" });
    if (!res.ok) { showToast("Failed to revoke share"); return; }
    showToast("Share revoked");
    loadEntryShares(entryId);
  } catch (err) {
    console.error("[vault] revoke failed:", err);
    showToast("Failed to revoke share");
  }
}

// ============================================================
// Delete entry
// ============================================================

async function deleteEntry() {
  if (!currentEntryId) return;
  if (!confirm("Delete this entry? This cannot be undone.")) return;

  try {
    const res = await fetch(`/api/vault/entries/${currentEntryId}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); showToast(d.error || "Delete failed"); return; }

    currentEntryId = null;
    document.getElementById("entry-detail-panel").classList.add("hidden");
    document.getElementById("entry-list-panel").classList.remove("hidden");
    await loadEntries(currentVaultId);
    showToast("Entry deleted");
  } catch (err) {
    console.error("[vault] delete failed:", err);
    showToast("Failed to delete entry");
  }
}

async function deleteVault() {
  if (!currentVaultId) return;
  const vault = vaults.find(v => v.id === currentVaultId);
  if (!vault || vault.owner_id !== currentUser.id) return;
  if (!confirm("Delete this vault and all its entries? This cannot be undone.")) return;

  try {
    const res = await fetch(`/api/vault/vaults/${currentVaultId}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); showToast(d.error || "Delete failed"); return; }

    currentVaultId = null;
    currentVaultMasterKey = null;
    currentEntryId = null;
    clearTotpInterval();
    document.getElementById("entry-list-panel").classList.add("hidden");
    document.getElementById("entry-detail-panel").classList.add("hidden");
    document.getElementById("no-vault-selected").classList.remove("hidden");
    await loadVaults();
    showToast("Vault deleted");
  } catch (err) {
    console.error("[vault] delete vault failed:", err);
    showToast("Failed to delete vault");
  }
}

// ============================================================
// Event bindings
// ============================================================

function bindEvents() {
  // Create vault button
  document.getElementById("create-vault-btn").addEventListener("click", openCreateVaultModal);

  // Create entry button
  document.getElementById("create-entry-btn").addEventListener("click", () => openEntryModal());

  // Vault type toggle — load all users when switching to team
  document.querySelectorAll('input[name="vault-type"]').forEach(radio => {
    radio.addEventListener("change", () => {
      const isTeam = radio.value === "team";
      document.getElementById("team-members-section").classList.toggle("hidden", !isTeam);
      if (isTeam && !allUsersCache.length) {
        searchMember(""); // triggers load of all users
      }
    });
  });

  // Member search
  let memberSearchTimeout;
  document.getElementById("member-search").addEventListener("input", (e) => {
    clearTimeout(memberSearchTimeout);
    memberSearchTimeout = setTimeout(() => searchMember(e.target.value.trim()), 300);
  });

  // Save vault
  document.getElementById("save-vault-btn").addEventListener("click", saveVault);

  // Save entry
  document.getElementById("save-entry-btn").addEventListener("click", saveEntry);

  // Entry type change
  document.getElementById("entry-type").addEventListener("change", (e) => showTypeFields(e.target.value));

  // Add custom field
  document.getElementById("add-custom-field").addEventListener("click", () => {
    const list = document.getElementById("custom-fields-list");
    const idx = list.children.length;
    list.insertAdjacentHTML("beforeend", customFieldHtml(idx));
    list.lastElementChild.querySelector("[data-remove-custom-field]").addEventListener("click", () => list.lastElementChild.remove());
  });

  // Generate password button (in entry form)
  document.getElementById("gen-pw-btn").addEventListener("click", () => openPwGenModal("f-password"));

  // Password generator controls
  document.getElementById("pw-length").addEventListener("input", (e) => {
    document.getElementById("pw-length-val").textContent = e.target.value;
    regeneratePw();
  });
  ["pw-upper", "pw-lower", "pw-digits", "pw-symbols", "pw-no-ambiguous"].forEach(id => {
    document.getElementById(id).addEventListener("change", regeneratePw);
  });
  document.getElementById("regen-pw-btn").addEventListener("click", regeneratePw);
  document.getElementById("copy-pw-btn").addEventListener("click", copyPwAndClose);

  // Share
  let shareSearchTimeout;
  document.getElementById("share-user-search").addEventListener("input", (e) => {
    clearTimeout(shareSearchTimeout);
    shareSearchTimeout = setTimeout(() => searchShareUser(e.target.value.trim()), 300);
  });
  document.getElementById("confirm-share-btn").addEventListener("click", confirmShare);

  // Entry detail actions
  document.getElementById("back-to-list").addEventListener("click", () => {
    clearTotpInterval();
    currentEntryId = null;
    document.getElementById("entry-detail-panel").classList.add("hidden");
    document.getElementById("entry-list-panel").classList.remove("hidden");
  });
  document.getElementById("share-entry-btn").addEventListener("click", () => {
    const entry = decryptedEntries.find(e => e.id === currentEntryId) || sharedEntries.find(e => e.id === currentEntryId);
    if (entry) openShareModal(entry);
  });
  document.getElementById("edit-entry-btn").addEventListener("click", () => {
    const entry = decryptedEntries.find(e => e.id === currentEntryId);
    if (entry) openEntryModal(entry);
  });
  document.getElementById("delete-entry-btn").addEventListener("click", deleteEntry);
  document.getElementById("delete-vault-btn").addEventListener("click", deleteVault);

  // Search
  document.getElementById("search-input").addEventListener("input", () => renderEntries());

  // Modal close buttons
  document.querySelectorAll(".modal-close").forEach(btn => {
    btn.addEventListener("click", () => {
      const modal = btn.closest("[id$='-modal']");
      if (modal) modal.classList.add("hidden");
    });
  });

  // Close modals on overlay click
  document.querySelectorAll(".overlay-bg").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });
}

// ============================================================
// Vault Unlock Modal (Promise-based)
// ============================================================

function showUnlockModal(purpose = "unlock") {
  return new Promise((resolve) => {
    const modal = document.getElementById("unlock-modal");
    const input = document.getElementById("unlock-password");
    const submitBtn = document.getElementById("unlock-submit-btn");
    const errorEl = document.getElementById("unlock-error");
    const titleEl = modal.querySelector("h2");
    const descEl = modal.querySelector("p.text-muted");

    input.value = "";
    errorEl.classList.add("hidden");
    if (titleEl) titleEl.textContent = purpose === "create" ? "Encrypt Vault" : "Unlock Vault";
    if (descEl) descEl.textContent = purpose === "create"
      ? "Enter your password to encrypt the new vault key."
      : "Enter your password to unlock this vault.";
    submitBtn.textContent = purpose === "create" ? "Create" : "Unlock";
    modal.classList.remove("hidden");

    function cleanup() {
      modal.classList.add("hidden");
      submitBtn.removeEventListener("click", onSubmit);
      input.removeEventListener("keydown", onKey);
    }

    function onSubmit() {
      const pw = input.value;
      if (!pw) return;
      // Verify password with server first
      fetch("/api/auth/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      }).then(r => {
        if (r.ok) {
          cleanup();
          resolve(pw);
        } else {
          errorEl.classList.remove("hidden");
          input.value = "";
          input.focus();
        }
      }).catch(() => {
        cleanup();
        resolve(null);
      });
    }

    function onKey(e) {
      if (e.key === "Enter") onSubmit();
      if (e.key === "Escape") { cleanup(); resolve(null); }
    }

    submitBtn.addEventListener("click", onSubmit);
    input.addEventListener("keydown", onKey);
    input.focus();
  });
}

// ============================================================
// Utilities
// ============================================================

function showToast(message, duration = 3000) {
  const toast = document.getElementById("toast");
  document.getElementById("toast-text").textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), duration);
}

function showLoading(text = "Loading...") {
  document.getElementById("loading-text").textContent = text;
  document.getElementById("loading").classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback — use CSS classes instead of inline styles
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.className = "fixed opacity-0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function escHtml(str) {
  if (!str) return "";
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function escAttr(str) {
  if (!str) return "";
  return escHtml(str);
}
