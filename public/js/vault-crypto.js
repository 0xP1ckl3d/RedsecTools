// RedSecVault — Client-side vault cryptography module
// Uses Web Crypto API only. Imports from crypto.js for AES-GCM primitives.
// Reuses ChatCrypto RSA functions for team vault key distribution and entry sharing.

import { generateKey, encrypt, decrypt, deriveKey, arrayToBase64, base64ToArray } from "./crypto.js";

const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 600000;

// ============================================================
// Encoding helpers
// ============================================================

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ============================================================
// Personal vault: master key encryption with password
// ============================================================

/**
 * Create a new personal vault.
 * Generates a random AES-256-GCM master key, wraps it with PBKDF2(password).
 * Returns everything needed to send to the server.
 */
async function createPersonalVault(vaultName, password) {
  // Generate random vault master key
  const masterKey = await generateKey();
  const masterKeyRaw = await crypto.subtle.exportKey("raw", masterKey);

  // Derive wrapping key from password
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const wrappingKey = await deriveKeyFromPassword(password, salt);

  // Encrypt master key with wrapping key
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encryptedMasterKey = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, wrappingKey, masterKeyRaw,
  );

  // Encrypt vault name with master key
  const nameResult = await encrypt(vaultName, masterKey);

  return {
    nameEncrypted: nameResult.ciphertext,
    nameIv: nameResult.iv,
    type: "personal",
    encryptedMasterKey: arrayBufferToBase64(encryptedMasterKey),
    masterKeyIv: arrayBufferToBase64(iv),
    masterKeySalt: arrayBufferToBase64(salt),
    masterKey, // keep in memory for immediate use
  };
}

/**
 * Unlock a personal vault using the user's password.
 * Returns the decrypted master key.
 */
async function unlockPersonalVault(encryptedMasterKeyB64, masterKeyIvB64, masterKeySaltB64, password) {
  const salt = base64ToArrayBuffer(masterKeySaltB64);
  const wrappingKey = await deriveKeyFromPassword(password, salt);
  const iv = base64ToArrayBuffer(masterKeyIvB64);
  const encryptedMasterKey = base64ToArrayBuffer(encryptedMasterKeyB64);

  const masterKeyRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, wrappingKey, encryptedMasterKey,
  );

  return crypto.subtle.importKey(
    "raw", masterKeyRaw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
}

// ============================================================
// Team vault: RSA-OAEP key distribution (reuses chat keys)
// ============================================================

/**
 * Create a new team vault.
 * Generates a random AES-256-GCM master key, encrypts it for each member
 * using their RSA public key.
 */
async function createTeamVault(vaultName, members) {
  // members: [{ userId, publicKey (CryptoKey or base64) }]
  const masterKey = await generateKey();
  const masterKeyRaw = await crypto.subtle.exportKey("raw", masterKey);

  // Encrypt vault name with master key
  const nameResult = await encrypt(vaultName, masterKey);

  // Encrypt master key for each member
  const memberEntries = [];
  for (const m of members) {
    const publicKey = m.publicKey instanceof CryptoKey
      ? m.publicKey
      : await importRsaPublicKey(m.publicKey);
    const encryptedMasterKey = await encryptWithRsa(masterKeyRaw, publicKey);
    memberEntries.push({
      userId: m.userId,
      encryptedMasterKey: encryptedMasterKey,
      permission: m.permission || (m.role === "admin" ? "full" : "editor"),
    });
  }

  return {
    nameEncrypted: nameResult.ciphertext,
    nameIv: nameResult.iv,
    type: "team",
    members: memberEntries,
    masterKey, // keep in memory
  };
}

/**
 * Unlock a team vault using the member's encrypted master key and their RSA private key.
 */
async function unlockTeamVault(encryptedMasterKeyB64, privateKey) {
  const encryptedKey = base64ToArrayBuffer(encryptedMasterKeyB64);
  const masterKeyRaw = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" }, privateKey, encryptedKey,
  );
  return crypto.subtle.importKey(
    "raw", masterKeyRaw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
}

async function wrapTeamVaultKeyForMember(masterKey, publicKeyOrBase64) {
  const publicKey = publicKeyOrBase64 instanceof CryptoKey
    ? publicKeyOrBase64
    : await importRsaPublicKey(publicKeyOrBase64);
  const masterKeyRaw = await crypto.subtle.exportKey("raw", masterKey);
  return encryptWithRsa(masterKeyRaw, publicKey);
}

// ============================================================
// Entry encryption
// ============================================================

/**
 * Encrypt a vault entry's data.
 * Each field gets its own IV for independent encryption.
 */
async function encryptEntry(title, data, folder, masterKey) {
  const titleResult = await encrypt(JSON.stringify(title), masterKey);
  const dataResult = await encrypt(JSON.stringify(data), masterKey);
  const folderResult = folder ? await encrypt(folder, masterKey) : null;

  return {
    titleEncrypted: titleResult.ciphertext,
    titleIv: titleResult.iv,
    dataEncrypted: dataResult.ciphertext,
    dataIv: dataResult.iv,
    folderEncrypted: folderResult ? folderResult.ciphertext : null,
    folderIv: folderResult ? folderResult.iv : null,
  };
}

/**
 * Decrypt a vault entry.
 */
async function decryptEntry(entry, masterKey) {
  const title = await decrypt(entry.titleEncrypted, masterKey, entry.titleIv);
  const data = JSON.parse(await decrypt(entry.dataEncrypted, masterKey, entry.dataIv));
  const folder = entry.folderEncrypted ? await decrypt(entry.folderEncrypted, masterKey, entry.folderIv) : null;

  return {
    id: entry.id,
    vaultId: entry.vaultId,
    type: entry.type,
    title,
    data,
    folder,
    favorite: entry.favorite,
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Decrypt a shared entry (uses the share's encrypted data directly).
 */
async function decryptSharedEntry(share, masterKey) {
  const title = await decrypt(share.titleEncrypted, masterKey, share.titleIv);
  const data = JSON.parse(await decrypt(share.dataEncrypted, masterKey, share.dataIv));

  return {
    id: share.id,
    entryId: share.entryId,
    fromUserId: share.fromUserId,
    fromUsername: share.fromUsername,
    type: share.type,
    title,
    data,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
  };
}

// ============================================================
// Entry sharing (cross-vault)
// ============================================================

/**
 * Share an entry with another user.
 * Re-encrypts the entry data with a fresh key, then wraps that key
 * with the recipient's RSA public key.
 */
async function shareEntry(entry, toUserPublicKey) {
  const publicKey = toUserPublicKey instanceof CryptoKey
    ? toUserPublicKey
    : await importRsaPublicKey(toUserPublicKey);

  // Generate a fresh AES key for this share
  const shareKey = await generateKey();
  const shareKeyRaw = await crypto.subtle.exportKey("raw", shareKey);

  // Re-encrypt entry data with the share key
  const titleResult = await encrypt(entry.title, shareKey);
  const dataResult = await encrypt(JSON.stringify(entry.data), shareKey);

  // Encrypt share key with recipient's RSA public key
  const encryptedEntryKey = await encryptWithRsa(shareKeyRaw, publicKey);

  return {
    encryptedEntryKey,
    titleEncrypted: titleResult.ciphertext,
    titleIv: titleResult.iv,
    dataEncrypted: dataResult.ciphertext,
    dataIv: dataResult.iv,
  };
}

/**
 * Decrypt a shared entry's key using the recipient's RSA private key.
 */
async function decryptSharedKey(encryptedEntryKeyB64, privateKey) {
  const encryptedKey = base64ToArrayBuffer(encryptedEntryKeyB64);
  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedKey);
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

// ============================================================
// TOTP code generation (RFC 6238)
// ============================================================

/**
 * Generate a TOTP code from a base32-encoded secret.
 * Returns { code: "123456", secondsRemaining: 24 }
 */
async function generateTotpCode(base32Secret, period = 30, digits = 6, algorithm = "SHA-1") {
  // Decode base32 secret
  const secret = base32Decode(base32Secret);

  // Calculate time counter
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);
  const secondsRemaining = period - (now % period);

  // Convert counter to 8-byte big-endian buffer
  const counterBuf = new ArrayBuffer(8);
  const counterView = new DataView(counterBuf);
  counterView.setBigUint64(0, BigInt(counter));

  // HMAC
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));

  // Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const otp = binary % Math.pow(10, digits);

  return {
    code: otp.toString().padStart(digits, "0"),
    secondsRemaining,
  };
}

// ============================================================
// Password generator
// ============================================================

function generatePassword(length = 24, options = {}) {
  const {
    uppercase = true, lowercase = true, digits = true, symbols = true,
    excludeAmbiguous = false,
  } = options;

  let chars = "";
  if (uppercase) chars += excludeAmbiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (lowercase) chars += excludeAmbiguous ? "abcdefghjkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz";
  if (digits) chars += excludeAmbiguous ? "23456789" : "0123456789";
  if (symbols) chars += "!@#$%^&*()_+-=[]{}|;:,.<>?";
  if (!chars) chars = "abcdefghijklmnopqrstuvwxyz";

  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  let password = "";
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }

  const entropy = Math.floor(Math.log2(chars.length) * length);
  return { password, entropy };
}

// ============================================================
// Internal helpers
// ============================================================

async function deriveKeyFromPassword(password, saltBuffer) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importRsaPublicKey(base64Key) {
  const raw = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    "spki", raw, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"],
  );
}

async function encryptWithRsa(data, publicKey) {
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, data);
  return arrayBufferToBase64(encrypted);
}

function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  str = str.toUpperCase().replace(/[=\s]/g, "");
  const bytes = [];
  let buffer = 0, bitsLeft = 0;
  for (const ch of str) {
    const val = alphabet.indexOf(ch);
    if (val === -1) continue;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export {
  // Personal vault
  createPersonalVault,
  unlockPersonalVault,
  // Team vault
  createTeamVault,
  unlockTeamVault,
  wrapTeamVaultKeyForMember,
  // Entry encryption
  encryptEntry,
  decryptEntry,
  decryptSharedEntry,
  // Entry sharing
  shareEntry,
  decryptSharedKey,
  // TOTP
  generateTotpCode,
  // Password generator
  generatePassword,
};
