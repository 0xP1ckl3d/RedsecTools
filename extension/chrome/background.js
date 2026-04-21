import { decrypt, exportRawAesKey, importRawAesKey } from "./lib/core-crypto.js";
import { decryptPrivateKey, exportPrivateKey, importPrivateKey } from "./lib/chat-crypto.js";
import { createEncryptedPaste } from "./lib/paste-crypto.js";
import { createEncryptedShare } from "./lib/share-crypto.js";
import {
  decryptEntry,
  decryptSharedEntry,
  decryptSharedKey,
  encryptEntry,
  generatePassword,
  generateTotpCode,
  unlockPersonalVault,
  unlockTeamVault,
} from "./lib/vault-crypto.js";
import { getBaseDomain, getMatchLevel, getHostname } from "./lib/domain-utils.js";

const LOCAL_KEYS = {
  auth: "auth",
  settings: "settings",
};

const SESSION_KEYS = {
  state: "sessionState",
};

const ITEM_TYPE_ORDER = ["password", "totp", "note", "api_key", "ssh_key", "custom"];
const ITEM_TYPE_LABELS = {
  password: "Passwords",
  totp: "OTP / TOTP",
  note: "Secure Notes",
  api_key: "API Keys",
  ssh_key: "SSH Keys",
  custom: "Custom",
};

function isHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function getLocal(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function removeLocal(keys) {
  await chrome.storage.local.remove(keys);
}

async function getSessionState() {
  const result = await chrome.storage.session.get(SESSION_KEYS.state);
  return result[SESSION_KEYS.state] || null;
}

async function setSessionState(state) {
  await chrome.storage.session.set({ [SESSION_KEYS.state]: state });
}

async function clearSessionState() {
  await chrome.storage.session.remove(SESSION_KEYS.state);
}

async function getSettings() {
  return (await getLocal(LOCAL_KEYS.settings, {})) || {};
}

async function setSettings(settings) {
  await setLocal(LOCAL_KEYS.settings, settings);
  return settings;
}

async function getAuth() {
  return await getLocal(LOCAL_KEYS.auth, null);
}

async function setAuth(auth) {
  await setLocal(LOCAL_KEYS.auth, auth);
  return auth;
}

async function clearAuth() {
  await removeLocal([LOCAL_KEYS.auth]);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function normalizeBaseUrl(baseUrl) {
  const url = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!isHttpUrl(url)) {
    throw new Error("A valid RedSecTools base URL is required");
  }
  return url;
}

async function resolveBaseUrl(provided) {
  if (provided) return normalizeBaseUrl(provided);

  const settings = await getSettings();
  if (settings.baseUrl) return normalizeBaseUrl(settings.baseUrl);

  const tab = await getActiveTab();
  if (tab?.url && isHttpUrl(tab.url)) {
    const parsed = new URL(tab.url);
    return `${parsed.protocol}//${parsed.host}`;
  }

  throw new Error("Set the RedSecTools URL before signing in");
}

async function apiFetch(path, { baseUrl, method = "GET", token, body } = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data;
}

async function apiUpload(path, { baseUrl, token, formData }) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: formData,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data;
}

async function requireValidAuth() {
  const auth = await getAuth();
  if (!auth?.token || !auth?.baseUrl) {
    throw new Error("Extension login required");
  }
  if (auth.expiresAt && auth.expiresAt <= Math.floor(Date.now() / 1000)) {
    await clearAuth();
    await clearSessionState();
    throw new Error("Extension session expired");
  }
  return auth;
}

async function lockVault() {
  const state = await getSessionState();
  if (!state) return { success: true, locked: true };
  await setSessionState({
    cache: state.cache || { vaults: [], entriesByVault: {}, sharedEntries: [] },
    unlockedAt: null,
    vaultKeys: {},
    rsaPrivateKeyBase64: null,
  });
  return { success: true, locked: true };
}

async function logoutVault() {
  const auth = await getAuth();
  if (auth?.token && auth?.baseUrl) {
    try {
      await apiFetch("/api/ext/auth/logout", {
        baseUrl: auth.baseUrl,
        token: auth.token,
        method: "POST",
      });
    } catch {}
  }
  await clearAuth();
  await clearSessionState();
  return { success: true };
}

async function unlockVaultWithPassword(password) {
  const auth = await requireValidAuth();
  if (!password) throw new Error("Password is required to unlock the vault");

  const vaultData = await apiFetch("/api/ext/vault/vaults", {
    baseUrl: auth.baseUrl,
    token: auth.token,
  });
  const sharedData = await apiFetch("/api/ext/vault/shared", {
    baseUrl: auth.baseUrl,
    token: auth.token,
  });

  const backup = await apiFetch("/api/ext/chat/keys/backup", {
    baseUrl: auth.baseUrl,
    token: auth.token,
  }).catch(() => null);

  let rsaPrivateKey = null;
  let rsaPrivateKeyBase64 = null;
  if (backup?.encryptedPrivateKey && backup.privateKeyIv && backup.privateKeySalt) {
    rsaPrivateKey = await decryptPrivateKey(
      backup.encryptedPrivateKey,
      backup.privateKeyIv,
      backup.privateKeySalt,
      password,
    ).catch(() => null);
    if (rsaPrivateKey) {
      rsaPrivateKeyBase64 = await exportPrivateKey(rsaPrivateKey);
    }
  }

  const vaultKeys = {};
  const entriesByVault = {};
  for (const vault of vaultData.vaults || []) {
    let masterKey = null;

    if (vault.type === "personal" && vault.encryptedMasterKey && vault.masterKeyIv && vault.masterKeySalt) {
      masterKey = await unlockPersonalVault(
        vault.encryptedMasterKey,
        vault.masterKeyIv,
        vault.masterKeySalt,
        password,
      ).catch(() => null);
    } else if (vault.type === "team" && rsaPrivateKey) {
      const mkData = await apiFetch(`/api/ext/vault/vaults/${vault.id}/master-key`, {
        baseUrl: auth.baseUrl,
        token: auth.token,
      }).catch(() => null);
      if (mkData?.encryptedMasterKey) {
        masterKey = await unlockTeamVault(mkData.encryptedMasterKey, rsaPrivateKey).catch(() => null);
      }
    }

    if (!masterKey) continue;

    vaultKeys[vault.id] = await exportRawAesKey(masterKey);
    const entryData = await apiFetch(`/api/ext/vault/vaults/${vault.id}/entries`, {
      baseUrl: auth.baseUrl,
      token: auth.token,
    }).catch(() => ({ entries: [] }));
    entriesByVault[vault.id] = entryData.entries || [];
  }

  await setSessionState({
    unlockedAt: Date.now(),
    rsaPrivateKeyBase64,
    vaultKeys,
    cache: {
      vaults: vaultData.vaults || [],
      entriesByVault,
      sharedEntries: sharedData.shares || [],
    },
  });

  return buildPopupState();
}

async function getImportedVaultKeyMap(state) {
  const keyMap = {};
  for (const [vaultId, rawKey] of Object.entries(state?.vaultKeys || {})) {
    keyMap[vaultId] = await importRawAesKey(rawKey);
  }
  return keyMap;
}

async function getImportedPrivateKey(state) {
  if (!state?.rsaPrivateKeyBase64) return null;
  return importPrivateKey(state.rsaPrivateKeyBase64);
}

async function decryptVaultName(vault, keyMap) {
  const key = keyMap[vault.id];
  if (!key) return "Vault";
  return decrypt(vault.nameEncrypted, key, vault.nameIv).catch(() => "Vault");
}

async function getDecryptedEntries(state) {
  if (!state?.cache) return [];

  const keyMap = await getImportedVaultKeyMap(state);
  const decryptedEntries = [];

  for (const vault of state.cache.vaults || []) {
    const key = keyMap[vault.id];
    if (!key) continue;

    const vaultName = await decryptVaultName(vault, keyMap);
    const entries = state.cache.entriesByVault?.[vault.id] || [];
    for (const entry of entries) {
      const decryptedEntry = await decryptEntry(entry, key).catch(() => null);
      if (!decryptedEntry) continue;
      decryptedEntries.push({
        ...decryptedEntry,
        kind: "vault",
        refId: `vault:${vault.id}:${entry.id}`,
        vaultName,
        permissions: vault.permissions,
        fromUsername: null,
      });
    }
  }

  const privateKey = await getImportedPrivateKey(state);
  if (privateKey) {
    for (const share of state.cache.sharedEntries || []) {
      const shareKey = await decryptSharedKey(share.encryptedEntryKey, privateKey).catch(() => null);
      if (!shareKey) continue;
      const decryptedShare = await decryptSharedEntry(share, shareKey).catch(() => null);
      if (!decryptedShare) continue;
      decryptedEntries.push({
        ...decryptedShare,
        kind: "shared",
        refId: `shared:${share.id}`,
        vaultId: null,
        vaultName: "Shared with me",
        permissions: { canWrite: false, isOwner: false },
      });
    }
  }

  return decryptedEntries;
}

function scoreEntryForQuery(entry, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 1;

  const customFieldValues = Array.isArray(entry.data?.fields)
    ? entry.data.fields.flatMap((field) => [field?.label, field?.value]).filter(Boolean)
    : [];

  const haystack = [
    entry.title,
    entry.data?.username,
    entry.data?.url,
    entry.data?.content,
    entry.data?.service,
    entry.data?.issuer,
    entry.data?.account,
    entry.data?.notes,
    entry.data?.public_key,
    entry.fromUsername,
    ...customFieldValues,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (!haystack.includes(q)) return 0;
  if (String(entry.title || "").toLowerCase().startsWith(q)) return 5;
  if (String(entry.data?.username || "").toLowerCase().startsWith(q)) return 4;
  return 2;
}

function getSiteSuggestions(entries, pageUrl) {
  const passwordEntries = entries.filter((entry) => entry.type === "password" && entry.data?.url);
  const exact = passwordEntries.filter((entry) => getMatchLevel(entry.data.url, pageUrl) === "exact");
  const base = passwordEntries.filter((entry) => getMatchLevel(entry.data.url, pageUrl) === "base");
  const chosen = exact.length ? exact : base;

  return chosen
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""))
    .map((entry) => ({
      ...formatEntrySummary(entry, pageUrl),
      matchLevel: exact.length ? "exact" : "base",
    }));
}

function formatEntrySummary(entry, pageUrl) {
  return {
    id: entry.id,
    refId: entry.refId,
    kind: entry.kind,
    title: entry.title,
    type: entry.type,
    data: entry.data || {},
    folder: entry.folder || null,
    favorite: !!entry.favorite,
    username: entry.data?.username || entry.data?.account || "",
    url: entry.data?.url || "",
    vaultName: entry.vaultName,
    vaultId: entry.kind === "shared" ? "shared" : entry.vaultId,
    fromUsername: entry.fromUsername || null,
    matchLevel: pageUrl ? getMatchLevel(entry.data?.url, pageUrl) : "none",
    canFill: entry.type === "password",
    canCopyTotp: entry.type === "totp",
    typeLabel: ITEM_TYPE_LABELS[entry.type] || entry.type,
    fields: buildEntryFields(entry),
    editable: entry.kind === "vault" && !!entry.permissions?.canWrite,
    permissions: entry.permissions || { canWrite: false, isOwner: false },
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

function buildEntryFields(entry) {
  const details = [];
  const data = entry.data || {};

  if (entry.type === "password") {
    if (data.username) details.push({ label: "Username", value: data.username, copyField: "data.username" });
    if (data.password) details.push({ label: "Password", value: data.password, copyField: "data.password", secret: true });
    if (data.url) details.push({ label: "URL", value: data.url, copyField: "data.url" });
  } else if (entry.type === "note") {
    if (data.content) details.push({ label: "Note", value: data.content, copyField: "data.content", multiline: true });
  } else if (entry.type === "api_key") {
    if (data.service) details.push({ label: "Service", value: data.service, copyField: "data.service" });
    if (data.key) details.push({ label: "API Key", value: data.key, copyField: "data.key", secret: true });
  } else if (entry.type === "ssh_key") {
    if (data.private_key) details.push({ label: "Private Key", value: data.private_key, copyField: "data.private_key", secret: true, multiline: true });
    if (data.public_key) details.push({ label: "Public Key", value: data.public_key, copyField: "data.public_key", multiline: true });
    if (data.passphrase) details.push({ label: "Passphrase", value: data.passphrase, copyField: "data.passphrase", secret: true });
  } else if (entry.type === "totp") {
    if (data.issuer) details.push({ label: "Issuer", value: data.issuer, copyField: "data.issuer" });
    if (data.account) details.push({ label: "Account", value: data.account, copyField: "data.account" });
    if (data.secret) details.push({ label: "Secret", value: data.secret, copyField: "data.secret", secret: true });
  } else if (entry.type === "custom") {
    for (let i = 0; i < (data.fields || []).length; i++) {
      const field = data.fields[i];
      if (!field?.value) continue;
      details.push({
        label: field.label || `Field ${i + 1}`,
        value: field.value,
        copyField: `custom:${i}`,
        secret: field.type === "password",
        multiline: typeof field.value === "string" && field.value.includes("\n"),
      });
    }
  }

  if (data.notes) {
    details.push({ label: "Notes", value: data.notes, copyField: "data.notes", multiline: true });
  }

  return details;
}

function getVaultFilters(state, keyMap, entries) {
  const filters = [{ id: "all", label: "All vaults" }];

  for (const vault of state?.cache?.vaults || []) {
    if (!keyMap[vault.id]) continue;
    filters.push({
      id: vault.id,
      label: vault._decryptedName || "Vault",
    });
  }

  if ((entries || []).some((entry) => entry.kind === "shared")) {
    filters.push({ id: "shared", label: "Shared with me" });
  }

  return filters.sort((a, b) => {
    if (a.id === "all") return -1;
    if (b.id === "all") return 1;
    return a.label.localeCompare(b.label);
  });
}

function getTypeFilters(entries) {
  const found = new Set(entries.map((entry) => entry.type));
  const ordered = ITEM_TYPE_ORDER
    .filter((type) => found.has(type))
    .map((type) => ({ id: type, label: ITEM_TYPE_LABELS[type] || type }));
  const unique = [];
  const seen = new Set();
  for (const item of [{ id: "password", label: "Passwords" }, { id: "all", label: "All types" }, ...ordered]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

async function buildPopupState() {
  const auth = await getAuth();
  const state = await getSessionState();
  const settings = await getSettings();
  const tab = await getActiveTab();
  const currentPageUrl = isHttpUrl(tab?.url) ? tab.url : "";
  const rememberedLogin = settings.lastLoginEmail && settings.baseUrl
    ? {
        email: settings.lastLoginEmail,
        baseUrl: settings.baseUrl,
      }
    : null;

  if (!auth?.token) {
    return {
      mode: "signed_out",
      baseUrl: settings.baseUrl || "",
      rememberedLogin,
      currentPageUrl,
    };
  }

  if (auth.expiresAt && auth.expiresAt <= Math.floor(Date.now() / 1000)) {
    await clearAuth();
    await clearSessionState();
    return {
      mode: "signed_out",
      baseUrl: settings.baseUrl || "",
      rememberedLogin,
      currentPageUrl,
    };
  }

  const unlocked = !!(state && Object.keys(state.vaultKeys || {}).length > 0);
  if (!unlocked) {
    return {
      mode: "locked",
      baseUrl: auth.baseUrl,
      user: auth.user,
      currentPageUrl,
    };
  }

  const entries = await getDecryptedEntries(state);
  const writableVaults = [];
  const keyMap = await getImportedVaultKeyMap(state);
  for (const vault of state.cache.vaults || []) {
    vault._decryptedName = await decryptVaultName(vault, keyMap);
    if (!vault.permissions?.canWrite || !keyMap[vault.id]) continue;
    writableVaults.push({
      id: vault.id,
      name: vault._decryptedName,
      label: vault._decryptedName,
      type: vault.type,
      permission: vault.permissions.permission,
    });
  }

  return {
    mode: "unlocked",
    baseUrl: auth.baseUrl,
    user: auth.user,
    currentPageUrl,
    writableVaults,
    currentSiteSuggestions: currentPageUrl ? getSiteSuggestions(entries, currentPageUrl) : [],
    vaultFilters: getVaultFilters(state, keyMap, entries),
    typeFilters: getTypeFilters(entries),
    entryCount: entries.length,
  };
}

async function searchEntries(query, pageUrl = "", filters = {}) {
  const state = await getSessionState();
  if (!state || !Object.keys(state.vaultKeys || {}).length) {
    return [];
  }

  const entries = await getDecryptedEntries(state);
  return entries
    .map((entry) => ({ entry, score: scoreEntryForQuery(entry, query) }))
    .filter((item) => item.score > 0)
    .filter((item) => {
      if (filters.vaultId && filters.vaultId !== "all") {
        const entryVaultId = item.entry.kind === "shared" ? "shared" : item.entry.vaultId;
        if (entryVaultId !== filters.vaultId) return false;
      }
      if (filters.itemType && filters.itemType !== "all" && item.entry.type !== filters.itemType) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aMatch = pageUrl ? getMatchLevel(a.entry.data?.url, pageUrl) : "none";
      const bMatch = pageUrl ? getMatchLevel(b.entry.data?.url, pageUrl) : "none";
      const weight = { exact: 2, base: 1, none: 0 };
      if (weight[bMatch] !== weight[aMatch]) return weight[bMatch] - weight[aMatch];
      return (a.entry.title || "").localeCompare(b.entry.title || "");
    })
    .slice(0, 50)
    .map(({ entry }) => formatEntrySummary(entry, pageUrl));
}

async function findEntryByRef(refId) {
  const entries = await getDecryptedEntries(await getSessionState());
  return entries.find((entry) => entry.refId === refId) || null;
}

async function requestContentScript(type, payload = {}) {
  const tab = await getActiveTab();
  if (!tab?.id || !isHttpUrl(tab.url)) {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, payload });
  } catch {
    return null;
  }
}

async function fillEntryOnCurrentPage(refId) {
  const entry = await findEntryByRef(refId);
  if (!entry || entry.type !== "password") {
    throw new Error("Password entry not found");
  }

  const response = await requestContentScript("fillCredentials", {
    username: entry.data?.username || "",
    password: entry.data?.password || "",
  });
  if (!response?.success) {
    throw new Error(response?.error || "Unable to fill credentials on this page");
  }

  return { success: true };
}

async function fillGeneratedPasswordOnCurrentPage(password) {
  const response = await requestContentScript("fillGeneratedPassword", { password });
  if (!response?.success) {
    throw new Error(response?.error || "Unable to fill generated password on this page");
  }
  return response;
}

async function getCurrentSiteContext() {
  const tab = await getActiveTab();
  const pageUrl = isHttpUrl(tab?.url) ? tab.url : "";
  const pageTitle = tab?.title || "";
  const formContext = await requestContentScript("collectFormContext", {});
  return {
    pageUrl,
    pageTitle,
    formContext: formContext || null,
  };
}

async function saveCurrentSiteEntry(payload) {
  const auth = await requireValidAuth();
  const state = await getSessionState();
  if (!state) throw new Error("Vault is locked");

  const rawKey = state.vaultKeys?.[payload.vaultId];
  if (!rawKey) throw new Error("Selected vault is not unlocked");

  const masterKey = await importRawAesKey(rawKey);
  const title = String(payload.title || "").trim() || getHostname(payload.url) || "New Login";
  const url = String(payload.url || "").trim();
  const data = {
    username: String(payload.username || "").trim(),
    password: String(payload.password || ""),
    url,
  };
  if (payload.notes) data.notes = String(payload.notes);

  const encrypted = await encryptEntry(title, data, null, masterKey);
  const result = await apiFetch(`/api/ext/vault/vaults/${payload.vaultId}/entries`, {
    baseUrl: auth.baseUrl,
    token: auth.token,
    method: "POST",
    body: {
      ...encrypted,
      type: "password",
      favorite: !!payload.favorite,
    },
  });

  const refreshed = await apiFetch(`/api/ext/vault/vaults/${payload.vaultId}/entries`, {
    baseUrl: auth.baseUrl,
    token: auth.token,
  });
  await setSessionState({
    ...state,
    cache: {
      ...state.cache,
      entriesByVault: {
        ...state.cache.entriesByVault,
        [payload.vaultId]: refreshed.entries || [],
      },
    },
  });

  return { success: true, id: result.id };
}

async function createPasteLink(payload) {
  const auth = await requireValidAuth();
  const encrypted = await createEncryptedPaste(String(payload.content || ""), String(payload.password || ""));
  const result = await apiFetch("/api/ext/paste", {
    baseUrl: auth.baseUrl,
    token: auth.token,
    method: "POST",
    body: {
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      ivPassword: encrypted.ivPassword,
      salt: encrypted.salt,
      hasPassword: encrypted.hasPassword,
      burnAfterReading: !!payload.burnAfterReading,
      expiresIn: parseInt(payload.expiresIn, 10),
      syntax: payload.syntax || "plaintext",
    },
  });

  return {
    success: true,
    id: result.id,
    url: `${normalizeBaseUrl(auth.baseUrl)}/p/${result.id}#${encrypted.keyBase64}`,
  };
}

async function createShareLink(payload) {
  const auth = await requireValidAuth();
  const files = payload.files || [];
  if (!files.length) throw new Error("Select at least one file");

  const normalizedFiles = [];
  for (const file of files) {
    let buffer = file.buffer;
    if (!buffer && Array.isArray(file.bytes)) {
      buffer = new Uint8Array(file.bytes).buffer;
    } else if (Array.isArray(buffer)) {
      buffer = new Uint8Array(buffer).buffer;
    } else if (buffer && !(buffer instanceof ArrayBuffer) && ArrayBuffer.isView(buffer)) {
      buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(`Invalid file payload for ${file.name || "upload"}`);
    }
    normalizedFiles.push({
      buffer,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  }

  const encrypted = await createEncryptedShare(normalizedFiles, String(payload.password || ""));
  const formData = new FormData();

  for (let i = 0; i < encrypted.files.length; i++) {
    const encryptedFile = encrypted.files[i];
    formData.append("files", new Blob([encryptedFile.ciphertext]), `file_${i}`);
  }

  const metadata = {
    expiresIn: parseInt(payload.expiresIn, 10),
    hasPassword: encrypted.hasPassword,
    burnAfterReading: !!payload.burnAfterReading,
    salt: encrypted.salt,
    files: encrypted.files.map((file) => ({
      iv: file.iv,
      encryptedFilename: file.encryptedFilename,
      filenameIv: file.filenameIv,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      ivPassword: file.ivPassword,
    })),
  };
  formData.append("metadata", JSON.stringify(metadata));

  const result = await apiUpload("/api/ext/share", {
    baseUrl: auth.baseUrl,
    token: auth.token,
    formData,
  });

  return {
    success: true,
    id: result.id,
    url: `${normalizeBaseUrl(auth.baseUrl)}/s/${result.id}#${encrypted.keyBase64}`,
    fileCount: files.length,
  };
}

async function updateExistingEntry(payload) {
  const auth = await requireValidAuth();
  const state = await getSessionState();
  if (!state) throw new Error("Vault is locked");

  const entry = await findEntryByRef(payload.refId);
  if (!entry || entry.kind !== "vault") {
    throw new Error("Only vault items can be edited");
  }
  if (!entry.permissions?.canWrite) {
    throw new Error("You do not have edit rights for this vault");
  }

  const rawKey = state.vaultKeys?.[entry.vaultId];
  if (!rawKey) {
    throw new Error("Selected vault is not unlocked");
  }

  const masterKey = await importRawAesKey(rawKey);
  const encrypted = await encryptEntry(
    String(payload.title || "").trim() || entry.title,
    payload.data || {},
    payload.folder || null,
    masterKey,
  );

  await apiFetch(`/api/ext/vault/entries/${entry.id}`, {
    baseUrl: auth.baseUrl,
    token: auth.token,
    method: "PUT",
    body: {
      ...encrypted,
      favorite: !!payload.favorite,
    },
  });

  const refreshed = await apiFetch(`/api/ext/vault/vaults/${entry.vaultId}/entries`, {
    baseUrl: auth.baseUrl,
    token: auth.token,
  });
  await setSessionState({
    ...state,
    cache: {
      ...state.cache,
      entriesByVault: {
        ...state.cache.entriesByVault,
        [entry.vaultId]: refreshed.entries || [],
      },
    },
  });

  const updatedEntry = await findEntryByRef(payload.refId);
  return {
    success: true,
    entry: updatedEntry ? formatEntrySummary(updatedEntry, "") : null,
  };
}

async function getCopyValue(refId, field) {
  const entry = await findEntryByRef(refId);
  if (!entry) throw new Error("Entry not found");

  if (field === "username") return entry.data?.username || entry.data?.account || "";
  if (field === "password") return entry.data?.password || entry.data?.key || entry.data?.private_key || "";
  if (field === "totp") {
    const result = await generateTotpCode(
      entry.data?.secret || "",
      entry.data?.period || 30,
      entry.data?.digits || 6,
      entry.data?.algorithm || "SHA-1",
    );
    return result.code;
  }
  if (field.startsWith("data.")) {
    return entry.data?.[field.slice(5)] || "";
  }
  if (field.startsWith("custom:")) {
    const index = parseInt(field.split(":")[1], 10);
    return entry.data?.fields?.[index]?.value || "";
  }

  return "";
}

async function openExtensionPopup() {
  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup();
      return { success: true };
    } catch {
      return { success: false };
    }
  }
  return { success: false };
}

async function openServerApp() {
  const auth = await getAuth();
  const settings = await getSettings();
  const baseUrl = auth?.baseUrl || settings?.baseUrl;
  if (!baseUrl) {
    throw new Error("No server URL is configured");
  }
  await chrome.tabs.create({ url: normalizeBaseUrl(baseUrl) });
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "initializePopup":
        sendResponse({ success: true, state: await buildPopupState() });
        break;
      case "saveSettings": {
        const settings = await setSettings({
          ...(await getSettings()),
          baseUrl: normalizeBaseUrl(message.payload.baseUrl),
        });
        sendResponse({ success: true, settings });
        break;
      }
      case "login": {
        const baseUrl = await resolveBaseUrl(message.payload?.baseUrl);
        const existingSettings = await getSettings();
        await setSettings({ ...existingSettings, baseUrl });
        const result = await apiFetch("/api/ext/auth/login", {
          baseUrl,
          method: "POST",
          body: {
            email: message.payload.email,
            password: message.payload.password,
            keepSignedIn: !!message.payload.keepSignedIn,
            rememberBrowser: !!message.payload.rememberBrowser,
          },
        });

        if (result.success && result.token) {
          await setSettings({
            ...(await getSettings()),
            baseUrl,
            lastLoginEmail: String(message.payload.email || "").trim(),
          });
          await setAuth({
            baseUrl,
            token: result.token,
            expiresAt: result.expiresAt,
            user: result.user,
          });
          const state = await unlockVaultWithPassword(message.payload.password);
          sendResponse({ success: true, state });
          break;
        }

        if (result.mfaRequired || result.mfaSetupRequired) {
          await setSettings({
            ...(await getSettings()),
            baseUrl,
            lastLoginEmail: String(message.payload.email || "").trim(),
          });
        }

        sendResponse({ success: true, result, baseUrl });
        break;
      }
      case "completeMfa": {
        const authResult = await apiFetch("/api/ext/auth/login/mfa", {
          baseUrl: message.payload.baseUrl,
          method: "POST",
          body: {
            tempToken: message.payload.tempToken,
            code: message.payload.code,
            recoveryCode: message.payload.recoveryCode,
            rememberBrowser: !!message.payload.rememberBrowser,
          },
        });
        await setAuth({
          baseUrl: normalizeBaseUrl(message.payload.baseUrl),
          token: authResult.token,
          expiresAt: authResult.expiresAt,
          user: authResult.user,
        });
        const state = await unlockVaultWithPassword(message.payload.password);
        sendResponse({ success: true, state });
        break;
      }
      case "unlock":
        sendResponse({ success: true, state: await unlockVaultWithPassword(message.payload.password) });
        break;
      case "lock":
        sendResponse(await lockVault());
        break;
      case "logout":
        sendResponse(await logoutVault());
        break;
      case "searchEntries": {
        const tab = await getActiveTab();
        sendResponse({
          success: true,
          results: await searchEntries(
            message.payload.query,
            isHttpUrl(tab?.url) ? tab.url : "",
            {
              vaultId: message.payload.vaultId || "all",
              itemType: message.payload.itemType || "password",
            },
          ),
        });
        break;
      }
      case "getCurrentSiteContext":
        sendResponse({ success: true, ...(await getCurrentSiteContext()) });
        break;
      case "generatePassword":
        sendResponse({ success: true, ...generatePassword(message.payload.length || 24, message.payload.options || {}) });
        break;
      case "fillGeneratedPassword":
        sendResponse(await fillGeneratedPasswordOnCurrentPage(message.payload.password));
        break;
      case "fillEntry":
        sendResponse(await fillEntryOnCurrentPage(message.payload.refId));
        break;
      case "copyField":
        sendResponse({ success: true, value: await getCopyValue(message.payload.refId, message.payload.field) });
        break;
      case "saveCurrentSite":
        sendResponse(await saveCurrentSiteEntry(message.payload));
        break;
      case "createPaste":
        sendResponse(await createPasteLink(message.payload));
        break;
      case "createShare":
        sendResponse(await createShareLink(message.payload));
        break;
      case "getEntryDetail": {
        const tab = await getActiveTab();
        const pageUrl = isHttpUrl(tab?.url) ? tab.url : "";
        const entry = await findEntryByRef(message.payload.refId);
        if (!entry) {
          sendResponse({ success: false, error: "Entry not found" });
          break;
        }
        sendResponse({ success: true, entry: formatEntrySummary(entry, pageUrl) });
        break;
      }
      case "updateEntry":
        sendResponse(await updateExistingEntry(message.payload));
        break;
      case "getInlineSuggestions": {
        const state = await getSessionState();
        const auth = await getAuth();
        if (!auth?.token || (auth.expiresAt && auth.expiresAt <= Math.floor(Date.now() / 1000))) {
          await clearAuth();
          await clearSessionState();
          sendResponse({ success: true, mode: "signed_out", suggestions: [] });
          break;
        }
        if (!state || !Object.keys(state.vaultKeys || {}).length) {
          sendResponse({ success: true, mode: "locked", suggestions: [] });
          break;
        }
        const entries = await getDecryptedEntries(state);
        sendResponse({
          success: true,
          mode: "unlocked",
          suggestions: getSiteSuggestions(entries, message.payload.pageUrl),
        });
        break;
      }
      case "openPopup":
        sendResponse(await openExtensionPopup());
        break;
      case "openServerApp":
        sendResponse(await openServerApp());
        break;
      default:
        sendResponse({ success: false, error: "Unknown message" });
        break;
    }
  })().catch(async (error) => {
    if (/session expired/i.test(error.message || "")) {
      await clearAuth();
      await clearSessionState();
    }
    sendResponse({ success: false, error: error.message || "Unexpected error" });
  });

  return true;
});

chrome.runtime.onStartup.addListener(async () => {
  await clearSessionState();
});
