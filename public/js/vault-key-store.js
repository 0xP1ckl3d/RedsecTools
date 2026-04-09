// RedSecVault — Vault key storage in IndexedDB
// Stores decrypted vault master keys, same pattern as chat-crypto.js stores RSA keys.
// Keys are stored per-vault and persist across page navigation within the session.

window.VaultKeyStore = (function () {
  const DB_NAME = "redsec_vault_keys";
  const STORE_NAME = "keys";
  const DB_VERSION = 1;

  function openDB() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "vaultId" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function exportMasterKey(key) {
    const raw = await crypto.subtle.exportKey("raw", key);
    let binary = "";
    for (let i = 0; i < raw.byteLength; i++) binary += String.fromCharCode(new Uint8Array(raw)[i]);
    return btoa(binary);
  }

  async function importMasterKey(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return crypto.subtle.importKey(
      "raw", bytes.buffer, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
  }

  async function storeKey(vaultId, masterKey) {
    try {
      const db = await openDB();
      const keyBase64 = await exportMasterKey(masterKey);
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.put({ vaultId: vaultId, keyBase64: keyBase64, storedAt: Date.now() });
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error); };
        tx.oncomplete = function () { db.close(); };
      });
    } catch (err) {
      console.error("[vault-keystore] storeKey failed:", err);
    }
  }

  async function getKey(vaultId) {
    try {
      const db = await openDB();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(vaultId);
        request.onsuccess = function () {
          if (request.result && request.result.keyBase64) {
            importMasterKey(request.result.keyBase64).then(resolve).catch(function () { resolve(null); });
          } else {
            resolve(null);
          }
        };
        request.onerror = function () { reject(request.error); };
        tx.oncomplete = function () { db.close(); };
      });
    } catch (err) {
      console.error("[vault-keystore] getKey failed:", err);
      return null;
    }
  }

  async function removeKey(vaultId) {
    try {
      const db = await openDB();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(vaultId);
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error); };
        tx.oncomplete = function () { db.close(); };
      });
    } catch (err) {
      console.error("[vault-keystore] removeKey failed:", err);
    }
  }

  async function clearAll() {
    try {
      const db = await openDB();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = function () { resolve(); };
        request.onerror = function () { reject(request.error); };
        tx.oncomplete = function () { db.close(); };
      });
    } catch (err) {
      console.error("[vault-keystore] clearAll failed:", err);
    }
  }

  return { storeKey, getKey, removeKey, clearAll };
})();
