const PBKDF2_ITERATIONS = 600000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function arrayToBase64(array) {
  return btoa(String.fromCharCode(...new Uint8Array(array)));
}

function base64ToArray(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

async function exportKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayToBase64url(raw);
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptFilename(filename, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(filename));
  return {
    encryptedFilename: arrayToBase64(ciphertext),
    filenameIv: arrayToBase64(iv),
  };
}

async function createEncryptedShare(files, password) {
  const key = await generateKey();
  const keyBase64 = await exportKey(key);
  const salt = password ? crypto.getRandomValues(new Uint8Array(SALT_LENGTH)) : null;
  const passwordKey = password ? await deriveKey(password, salt) : null;

  const encryptedFiles = [];

  for (const file of files) {
    const fileIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    let fileCiphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv }, key, file.buffer);

    const { encryptedFilename, filenameIv } = await encryptFilename(file.name, key);

    const result = {
      ciphertext: fileCiphertext,
      iv: arrayToBase64(fileIv),
      encryptedFilename,
      filenameIv,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      ivPassword: null,
    };

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

export {
  createEncryptedShare,
};
