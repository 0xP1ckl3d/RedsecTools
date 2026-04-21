import { PBKDF2_ITERATIONS, arrayToBase64, base64ToArray } from "./core-crypto.js";

const KEY_LENGTH = 256;

async function decryptPrivateKey(encryptedPrivateKey, iv, salt, password) {
  const saltBuf = base64ToArray(salt);
  const ivBuf = base64ToArray(iv);
  const ciphertext = base64ToArray(encryptedPrivateKey);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, aesKey, ciphertext);
  return crypto.subtle.importKey(
    "pkcs8",
    decrypted,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt"],
  );
}

async function exportPrivateKey(privateKey) {
  const raw = await crypto.subtle.exportKey("pkcs8", privateKey);
  return arrayToBase64(raw);
}

async function importPrivateKey(base64) {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToArray(base64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt"],
  );
}

export {
  decryptPrivateKey,
  exportPrivateKey,
  importPrivateKey,
};
