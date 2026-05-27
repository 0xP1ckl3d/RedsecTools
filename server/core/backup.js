const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function createEncryptedDatabaseBackup({ db, dbPath, passphrase }) {
  return createEncryptedPlatformBackup({ db, dbPath, passphrase });
}

function safeRelative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function walkFiles(root, { excludedPaths = new Set() } = {}) {
  const files = [];
  const resolvedRoot = path.resolve(root);
  function walk(current) {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const resolved = path.resolve(fullPath);
      if (excludedPaths.has(resolved)) continue;
      if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) continue;
      if (entry.isDirectory()) {
        if (entry.name === "tmp") continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  walk(root);
  return files;
}

async function createEncryptedPlatformBackup({ db, dbPath, passphrase, dataDir = path.dirname(dbPath || ""), latestMigration = null }) {
  if (!passphrase || typeof passphrase !== "string" || passphrase.length < 12) {
    throw new Error("Backup passphrase must be at least 12 characters");
  }

  const tempPath = path.join(os.tmpdir(), `redsectools-backup-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.db`);
  await db.backup(tempPath);
  try {
    const database = fs.readFileSync(tempPath);
    const resolvedDataDir = path.resolve(dataDir || path.dirname(dbPath));
    const resolvedDbPath = path.resolve(dbPath || "");
    const excludedPaths = new Set([resolvedDbPath, path.resolve(tempPath)]);
    const files = walkFiles(resolvedDataDir, { excludedPaths }).map((filePath) => {
      const buffer = fs.readFileSync(filePath);
      return {
        path: safeRelative(resolvedDataDir, filePath),
        size: buffer.length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        data: buffer.toString("base64"),
      };
    });
    const includedPaths = [
      safeRelative(resolvedDataDir, resolvedDbPath) || path.basename(dbPath || "pastes.db"),
      ...files.map((file) => file.path),
    ];
    const archive = {
      database: {
        path: safeRelative(resolvedDataDir, resolvedDbPath) || path.basename(dbPath || "pastes.db"),
        size: database.length,
        sha256: crypto.createHash("sha256").update(database).digest("hex"),
        data: database.toString("base64"),
      },
      files,
    };
    const payload = Buffer.from(JSON.stringify(archive), "utf8");
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(passphrase, salt, 310000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const manifest = {
      format: "redsectools.encrypted-platform-backup.v2",
      createdAt: new Date().toISOString(),
      appVersion: require("./platform/version").getVersionInfo().version,
      buildCommit: require("./platform/version").getBuildCommit(),
      latestMigration,
      source: path.basename(dbPath || "pastes.db"),
      dataRoot: path.basename(resolvedDataDir),
      databasePath: archive.database.path,
      databaseSize: archive.database.size,
      databaseSha256: archive.database.sha256,
      fileCount: files.length,
      size: payload.length,
      sha256: crypto.createHash("sha256").update(payload).digest("hex"),
      includedPaths,
      excludedPaths: ["tmp/", archive.database.path],
      encrypted: true,
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
    const buffer = Buffer.from(JSON.stringify(output), "utf8");
    buffer.manifest = manifest;
    return buffer;
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

module.exports = {
  createEncryptedDatabaseBackup,
  createEncryptedPlatformBackup,
};
