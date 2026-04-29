const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function createEncryptedDatabaseBackup({ db, dbPath, passphrase }) {
  if (!passphrase || typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Backup passphrase must be at least 12 characters");
  }

  const tempPath = path.join(os.tmpdir(), `redsectools-backup-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.db`);
  await db.backup(tempPath);
  try {
    const payload = fs.readFileSync(tempPath);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(passphrase, salt, 310000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const manifest = {
      format: "redsectools.encrypted-sqlite-backup.v1",
      createdAt: new Date().toISOString(),
      source: path.basename(dbPath || "pastes.db"),
      size: payload.length,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      kdf: "pbkdf2-sha256",
      iterations: 310000,
      cipher: "aes-256-gcm",
    };
    cipher.setAAD(Buffer.from(JSON.stringify(manifest), "utf8"));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const output = {
      manifest,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    return Buffer.from(JSON.stringify(output), "utf8");
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

module.exports = {
  createEncryptedDatabaseBackup,
};
