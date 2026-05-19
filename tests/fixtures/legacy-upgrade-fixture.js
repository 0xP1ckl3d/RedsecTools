const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redsectools-upgrade-"));
const dbPath = path.join(dir, "legacy.sqlite");

try {
  const legacy = new Database(dbPath);
  legacy.exec(fs.readFileSync(path.join(__dirname, "legacy-db-snapshot.sql"), "utf8"));
  legacy.close();

  process.env.DB_PATH = dbPath;
  process.env.COOKIE_SECRET = "legacy-upgrade-cookie-secret";
  process.env.REDSECAI_AUTOSTART = "false";
  process.env.REDSECAI_AUTO_PULL = "false";

  const database = require("../../server/database");
  const paste = database.getPaste("legacyPaste123456789012");
  assert.ok(paste);
  assert.deepEqual(Buffer.from(paste.ciphertext), Buffer.from("00112233445566778899", "hex"));
  assert.equal(database.getSetting("sso_enabled"), "false");
  assert.equal(database.getSetting("sso_require_for_login"), "false");
  assert.equal(database.getSetting("admin_reauth_required"), "false");
  assert.equal(database.getSetting("openapi_enabled"), "false");
  assert.equal(database.getSetting("service_accounts_enabled"), "false");
  assert.equal(database.getSetting("webhooks_enabled"), "false");
  assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'service_accounts'").get());
  assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'platform_webhooks'").get());
  assert.ok(database.listSchemaMigrations().some((migration) => migration.id === "031_service_accounts"));
  assert.ok(database.listSchemaMigrations().some((migration) => migration.id === "032_platform_webhooks"));
  database.db.close();
} finally {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {}
}
