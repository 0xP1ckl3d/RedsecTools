#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function usage() {
  console.error("Usage: node scripts/restore-platform-backup.js <backup.rsecbackup> <output-dir>");
  process.exit(2);
}

function safeJoin(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) {
    throw new Error(`Unsafe backup path: ${relativePath}`);
  }
  return target;
}

function askPassphrase() {
  if (process.env.REDSECTOOLS_BACKUP_PASSPHRASE) {
    return Promise.resolve(process.env.REDSECTOOLS_BACKUP_PASSPHRASE);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("Backup passphrase: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [, , backupPath, outputDir] = process.argv;
  if (!backupPath || !outputDir) usage();

  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const manifest = backup.manifest;
  if (!manifest || manifest.format !== "redsectools.encrypted-platform-backup.v2") {
    throw new Error("Unsupported backup format");
  }

  const passphrase = await askPassphrase();
  if (!passphrase) throw new Error("Passphrase required");

  const key = crypto.pbkdf2Sync(
    passphrase,
    Buffer.from(backup.salt, "base64"),
    manifest.iterations,
    32,
    "sha256",
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(backup.iv, "base64"));
  decipher.setAuthTag(Buffer.from(backup.tag, "base64"));
  decipher.setAAD(Buffer.from(JSON.stringify(manifest), "utf8"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(backup.ciphertext, "base64")),
    decipher.final(),
  ]);
  const archive = JSON.parse(plaintext.toString("utf8"));

  fs.mkdirSync(outputDir, { recursive: true });
  const dbTarget = safeJoin(outputDir, archive.database.path || "pastes.db");
  fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
  const dbBuffer = Buffer.from(archive.database.data, "base64");
  fs.writeFileSync(dbTarget, dbBuffer);

  for (const file of archive.files || []) {
    const target = safeJoin(outputDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(file.data, "base64"));
  }

  console.log(JSON.stringify({
    restoredTo: path.resolve(outputDir),
    database: archive.database.path,
    files: (archive.files || []).length,
    appVersion: manifest.appVersion,
    buildCommit: manifest.buildCommit || null,
    latestMigration: manifest.latestMigration || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
