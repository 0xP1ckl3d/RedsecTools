const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Database = require("better-sqlite3");
const { createEncryptedPlatformBackup } = require("../server/core/backup");

test("platform backup manifest includes database and data-file coverage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redsectools-backup-test-"));
  const dbPath = path.join(dir, "pastes.db");
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('ok');");
    fs.mkdirSync(path.join(dir, "brand"), { recursive: true });
    fs.writeFileSync(path.join(dir, "brand", "logo.webp"), "brand");

    const backup = await createEncryptedPlatformBackup({
      db,
      dbPath,
      passphrase: "0123456789abcdef",
      latestMigration: "999_test",
    });
    const payload = JSON.parse(backup.toString("utf8"));

    assert.equal(payload.manifest.format, "redsectools.encrypted-platform-backup.v2");
    assert.equal(payload.manifest.latestMigration, "999_test");
    assert.equal(payload.manifest.encrypted, true);
    assert.equal(payload.manifest.fileCount, 1);
    assert.ok(payload.manifest.includedPaths.includes("pastes.db"));
    assert.ok(payload.manifest.includedPaths.includes("brand/logo.webp"));
    assert.ok(payload.manifest.excludedPaths.includes("tmp/"));
    assert.equal(typeof payload.ciphertext, "string");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("restore utility extracts encrypted platform backup to a staging directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redsectools-restore-test-"));
  const dbPath = path.join(dir, "pastes.db");
  const backupPath = path.join(dir, "backup.rsecbackup");
  const restoreDir = path.join(dir, "restore");
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('ok');");
    fs.mkdirSync(path.join(dir, "brand"), { recursive: true });
    fs.writeFileSync(path.join(dir, "brand", "logo.webp"), "brand");
    const backup = await createEncryptedPlatformBackup({
      db,
      dbPath,
      passphrase: "0123456789abcdef",
      latestMigration: "999_test",
    });
    fs.writeFileSync(backupPath, backup);

    execFileSync(process.execPath, [
      path.join(__dirname, "..", "scripts", "restore-platform-backup.js"),
      backupPath,
      restoreDir,
    ], {
      env: { ...process.env, REDSECTOOLS_BACKUP_PASSPHRASE: "0123456789abcdef" },
      stdio: "pipe",
    });

    assert.ok(fs.existsSync(path.join(restoreDir, "pastes.db")));
    assert.equal(fs.readFileSync(path.join(restoreDir, "brand", "logo.webp"), "utf8"), "brand");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
