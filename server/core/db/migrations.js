const fs = require("fs");
const path = require("path");

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

function runMigrations(db, migrationsDir = path.join(__dirname, "migrations")) {
  ensureMigrationTable(db);
  if (!fs.existsSync(migrationsDir)) return;

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => row.id),
  );
  const files = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.js$/i.test(name))
    .sort();

  const insert = db.prepare("INSERT OR IGNORE INTO schema_migrations (id, description) VALUES (?, ?)");
  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    const id = migration.id || file.replace(/\.js$/i, "");
    if (applied.has(id)) continue;
    const tx = db.transaction(() => {
      migration.up(db);
      insert.run(id, migration.description || "");
    });
    tx();
    applied.add(id);
  }
}

module.exports = {
  ensureMigrationTable,
  runMigrations,
};
