import { arrayToBase64, base64ToArray, decrypt, encrypt, deriveKey } from "./core-crypto.js";

const IV_LENGTH = 12;

async function unlockPersonalVault(encryptedMasterKeyB64, masterKeyIvB64, masterKeySaltB64, password) {
  const salt = base64ToArray(masterKeySaltB64);
  const wrappingKey = await deriveKey(password, salt);
  const iv = base64ToArray(masterKeyIvB64);
  const encryptedMasterKey = base64ToArray(encryptedMasterKeyB64);

  const masterKeyRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    encryptedMasterKey,
  );

  return crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

async function unlockTeamVault(encryptedMasterKeyB64, privateKey) {
  const encryptedKey = base64ToArray(encryptedMasterKeyB64);
  const masterKeyRaw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedKey);
  return crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

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

async function decryptEntry(entry, masterKey) {
  const title = normalizeStoredTitle(await decrypt(entry.titleEncrypted, masterKey, entry.titleIv));
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

async function decryptSharedKey(encryptedEntryKeyB64, privateKey) {
  const encryptedKey = base64ToArray(encryptedEntryKeyB64);
  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedKey);
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function decryptSharedEntry(share, masterKey) {
  const title = normalizeStoredTitle(await decrypt(share.titleEncrypted, masterKey, share.titleIv));
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

function normalizeStoredTitle(rawTitle) {
  try {
    const parsed = JSON.parse(rawTitle);
    return typeof parsed === "string" ? parsed : rawTitle;
  } catch {
    return rawTitle;
  }
}

async function generateTotpCode(base32Secret, period = 30, digits = 6, algorithm = "SHA-1") {
  const secret = base32Decode(base32Secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);
  const secondsRemaining = period - (now % period);

  const counterBuf = new ArrayBuffer(8);
  const counterView = new DataView(counterBuf);
  counterView.setBigUint64(0, BigInt(counter));

  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const otp = binary % Math.pow(10, digits);

  return {
    code: otp.toString().padStart(digits, "0"),
    secondsRemaining,
  };
}

function generatePassword(length = 24, options = {}) {
  const {
    uppercase = true,
    lowercase = true,
    digits = true,
    symbols = true,
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

function base32Decode(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(str || "").toUpperCase().replace(/[=\s]/g, "");
  const bytes = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const ch of clean) {
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
  unlockPersonalVault,
  unlockTeamVault,
  encryptEntry,
  decryptEntry,
  decryptSharedKey,
  decryptSharedEntry,
  generateTotpCode,
  generatePassword,
};
