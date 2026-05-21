// RedSecTeam - E2E encryption module for the chat system
// Uses ONLY the native Web Crypto API. Zero external dependencies.
// Hybrid RSA-OAEP (2048-bit) + AES-256-GCM scheme.

window.ChatCrypto = (function () {
  const PBKDF2_ITERATIONS = 600000;
  const IV_LENGTH = 12;
  const SALT_LENGTH = 16;
  const KEY_LENGTH = 256;
  const DB_NAME = "redsec_chat_keys";
  const STORE_NAME = "keys";

  // --- Encoding helpers ---

  function arrayToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // --- IndexedDB helpers ---

  function openDB() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "userId" });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  // --- RSA key pair management ---

  async function generateKeyPair() {
    return crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function exportPublicKey(key) {
    const buf = await crypto.subtle.exportKey("spki", key);
    return arrayToBase64(new Uint8Array(buf));
  }

  async function exportPrivateKey(key) {
    const buf = await crypto.subtle.exportKey("pkcs8", key);
    return arrayToBase64(new Uint8Array(buf));
  }

  async function importPublicKey(base64) {
    const buf = base64ToArray(base64);
    return crypto.subtle.importKey(
      "spki",
      buf,
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt"]
    );
  }

  async function importPrivateKey(base64) {
    const buf = base64ToArray(base64);
    return crypto.subtle.importKey(
      "pkcs8",
      buf,
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["decrypt"]
    );
  }

  // --- Password-encrypted private key backup ---

  async function encryptPrivateKey(privateKey, password) {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      const aesKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: KEY_LENGTH },
        false,
        ["encrypt"]
      );

      const rawKey = await crypto.subtle.exportKey("pkcs8", privateKey);
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, rawKey);

      return {
        encryptedPrivateKey: arrayToBase64(new Uint8Array(encrypted)),
        iv: arrayToBase64(iv),
        salt: arrayToBase64(salt),
      };
    } catch (err) {
      console.error("encryptPrivateKey failed:", err);
      return null;
    }
  }

  async function decryptPrivateKey(encryptedPrivateKey, iv, salt, password) {
    try {
      const saltBuf = base64ToArray(salt);
      const ivBuf = base64ToArray(iv);
      const ciphertext = base64ToArray(encryptedPrivateKey);

      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
      );
      const aesKey = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: KEY_LENGTH },
        false,
        ["decrypt"]
      );

      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, aesKey, ciphertext);
      return crypto.subtle.importKey(
        "pkcs8",
        decrypted,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        ["decrypt"]
      );
    } catch (err) {
      console.error("decryptPrivateKey failed:", err);
      return null;
    }
  }

  // --- IndexedDB key storage ---

  async function storeKeyInIndexedDB(userId, privateKey) {
    try {
      const db = await openDB();
      const privateKeyBase64 = await exportPrivateKey(privateKey);
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.put({
          userId: userId,
          privateKeyBase64: privateKeyBase64,
          storedAt: Date.now(),
        });
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    } catch (err) {
      console.error("storeKeyInIndexedDB failed:", err);
    }
  }

  async function getKeyFromIndexedDB(userId) {
    try {
      const db = await openDB();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(userId);
        request.onsuccess = function () {
          if (request.result && request.result.privateKeyBase64) {
            importPrivateKey(request.result.privateKeyBase64).then(resolve).catch(function () {
              resolve(null);
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = function () {
          reject(request.error);
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    } catch (err) {
      console.error("getKeyFromIndexedDB failed:", err);
      return null;
    }
  }

  async function removeKeyFromIndexedDB(userId) {
    try {
      const db = await openDB();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(userId);
        request.onsuccess = function () {
          resolve();
        };
        request.onerror = function () {
          reject(request.error);
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    } catch (err) {
      console.error("removeKeyFromIndexedDB failed:", err);
    }
  }

  // --- Conversation key operations ---

  async function generateConversationKey() {
    return crypto.subtle.generateKey(
      { name: "AES-GCM", length: KEY_LENGTH },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function exportConversationKey(key) {
    const buf = await crypto.subtle.exportKey("raw", key);
    return arrayToBase64(new Uint8Array(buf));
  }

  async function importConversationKey(base64) {
    const buf = base64ToArray(base64);
    return crypto.subtle.importKey(
      "raw",
      buf,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );
  }

  // --- RSA encryption of conversation keys ---

  async function encryptConversationKeyForMember(conversationKey, publicKey) {
    try {
      const raw = await crypto.subtle.exportKey("raw", conversationKey);
      const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, raw);
      return arrayToBase64(new Uint8Array(encrypted));
    } catch (err) {
      console.error("encryptConversationKeyForMember failed:", err);
      return null;
    }
  }

  async function decryptConversationKey(encryptedKeyBase64, privateKey) {
    try {
      const encrypted = base64ToArray(encryptedKeyBase64);
      const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encrypted);
      return crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );
    } catch (err) {
      console.error("decryptConversationKey failed:", err);
      return null;
    }
  }

  // --- Message encrypt / decrypt ---

  async function encryptMessage(plaintext, conversationKey, keyVersion) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const encoder = new TextEncoder();
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        conversationKey,
        encoder.encode(plaintext)
      );
      return {
        ciphertext: arrayToBase64(new Uint8Array(ciphertext)),
        iv: arrayToBase64(iv),
      };
    } catch (err) {
      console.error("encryptMessage failed:", err);
      return null;
    }
  }

  async function decryptMessage(ciphertext, iv, conversationKey) {
    try {
      const ciphertextBuf = base64ToArray(ciphertext);
      const ivBuf = base64ToArray(iv);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuf },
        conversationKey,
        ciphertextBuf
      );
      return new TextDecoder().decode(plaintext);
    } catch (err) {
      console.error("decryptMessage failed:", err);
      return null;
    }
  }

  return {
    generateKeyPair: generateKeyPair,
    exportPublicKey: exportPublicKey,
    exportPrivateKey: exportPrivateKey,
    importPublicKey: importPublicKey,
    importPrivateKey: importPrivateKey,
    encryptPrivateKey: encryptPrivateKey,
    decryptPrivateKey: decryptPrivateKey,
    storeKeyInIndexedDB: storeKeyInIndexedDB,
    getKeyFromIndexedDB: getKeyFromIndexedDB,
    removeKeyFromIndexedDB: removeKeyFromIndexedDB,
    generateConversationKey: generateConversationKey,
    exportConversationKey: exportConversationKey,
    importConversationKey: importConversationKey,
    encryptConversationKeyForMember: encryptConversationKeyForMember,
    decryptConversationKey: decryptConversationKey,
    encryptMessage: encryptMessage,
    decryptMessage: decryptMessage,
  };
})();
