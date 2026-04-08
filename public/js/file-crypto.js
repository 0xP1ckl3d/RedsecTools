// RedSecShare — Client-side file cryptography module
// Supports multi-file shares. All files encrypted with the same key K.
// If password: each file re-encrypted with password-derived key P (unique IV per file).

import { generateKey, exportKey, deriveKey, importKey, arrayToBase64, base64ToArray } from "./crypto.js";

const IV_LENGTH = 12;
const SALT_LENGTH = 16;

// --- Filename encryption ---

async function encryptFilename(filename, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(filename));
  return {
    encryptedFilename: arrayToBase64(ciphertext),
    filenameIv: arrayToBase64(iv),
  };
}

async function decryptFilename(encryptedB64, key, ivB64) {
  const ciphertext = base64ToArray(encryptedB64);
  const iv = base64ToArray(ivB64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// --- Multi-file create flow ---

async function createEncryptedShare(files, password) {
  // files: [{ buffer: ArrayBuffer, name: string, type: string, size: number }]
  const key = await generateKey();
  const keyBase64 = await exportKey(key);
  const salt = password ? crypto.getRandomValues(new Uint8Array(SALT_LENGTH)) : null;
  const passwordKey = password ? await deriveKey(password, salt) : null;

  const encryptedFiles = [];

  for (const file of files) {
    // Encrypt file content with key K
    const fileIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    let fileCiphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv }, key, file.buffer);

    // Encrypt filename with key K
    const { encryptedFilename, filenameIv } = await encryptFilename(file.name, key);

    const result = {
      ciphertext: fileCiphertext, // ArrayBuffer
      iv: arrayToBase64(fileIv),
      encryptedFilename,
      filenameIv,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      ivPassword: null,
    };

    // If password: re-encrypt file ciphertext with password-derived key P
    if (passwordKey) {
      const fileIvPw = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
      const outerCiphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIvPw }, passwordKey, fileCiphertext);
      result.ciphertext = outerCiphertext;
      result.ivPassword = arrayToBase64(fileIvPw);
    }

    encryptedFiles.push(result);
  }

  return {
    files: encryptedFiles,
    keyBase64,
    salt: salt ? arrayToBase64(salt) : null,
    hasPassword: !!password,
  };
}

// --- Decrypt flows ---

async function decryptFile(ciphertextBuffer, key, ivB64) {
  const iv = base64ToArray(ivB64);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertextBuffer);
}

async function decryptFileWithPassword(ciphertextBuffer, ivPasswordB64, saltB64, password, urlKeyB64) {
  // Decrypt outer layer (password)
  const salt = base64ToArray(saltB64);
  const passwordKey = await deriveKey(password, salt);
  const ivPw = base64ToArray(ivPasswordB64);
  const innerCiphertext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivPw }, passwordKey, ciphertextBuffer);

  // Decrypt inner layer (URL key)
  const urlKey = await importKey(urlKeyB64);
  return { innerCiphertext, urlKey };
}

export { createEncryptedShare, decryptFile, decryptFileWithPassword, encryptFilename, decryptFilename };
