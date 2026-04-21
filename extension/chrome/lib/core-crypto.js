const PBKDF2_ITERATIONS = 600000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

function arrayToBase64(array) {
  return btoa(String.fromCharCode(...new Uint8Array(array)));
}

function base64ToArray(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function generateKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

async function exportRawAesKey(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayToBase64(raw);
}

async function importRawAesKey(base64) {
  return crypto.subtle.importKey(
    "raw",
    base64ToArray(base64),
    { name: "AES-GCM", length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(plaintext, key) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ciphertext: arrayToBase64(ciphertext), iv: arrayToBase64(iv) };
}

async function decrypt(ciphertextB64, key, ivB64) {
  const ciphertext = base64ToArray(ciphertextB64);
  const iv = base64ToArray(ivB64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
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

export {
  PBKDF2_ITERATIONS,
  arrayToBase64,
  base64ToArray,
  generateKey,
  exportRawAesKey,
  importRawAesKey,
  encrypt,
  decrypt,
  deriveKey,
};
