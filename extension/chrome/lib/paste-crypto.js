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

async function encrypt(plaintext, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ciphertext: arrayToBase64(ciphertext), iv: arrayToBase64(iv) };
}

async function encryptRaw(buffer, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buffer);
  return { ciphertext: arrayToBase64(ciphertext), iv: arrayToBase64(iv) };
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

async function createEncryptedPaste(plaintext, password) {
  const key = await generateKey();
  const { ciphertext: innerCiphertext, iv } = await encrypt(plaintext, key);
  const result = { iv, keyBase64: await exportKey(key) };

  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const passwordKey = await deriveKey(password, salt);
    const { ciphertext: outerCiphertext, iv: ivPassword } = await encryptRaw(base64ToArray(innerCiphertext), passwordKey);
    result.ciphertext = outerCiphertext;
    result.ivPassword = ivPassword;
    result.salt = arrayToBase64(salt);
    result.hasPassword = true;
  } else {
    result.ciphertext = innerCiphertext;
    result.ivPassword = null;
    result.salt = null;
    result.hasPassword = false;
  }

  return result;
}

export {
  createEncryptedPaste,
};
