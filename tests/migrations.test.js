const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationsDir = path.join(__dirname, "..", "server", "core", "db", "migrations");

test("database migrations have unique numeric prefixes and declared ids", () => {
  const files = fs.readdirSync(migrationsDir).filter((file) => /^\d+_.+\.js$/i.test(file)).sort();
  const prefixes = new Map();
  const ids = new Map();

  for (const file of files) {
    const prefix = file.match(/^(\d+)_/)[1];
    prefixes.set(prefix, [...(prefixes.get(prefix) || []), file]);
    const migration = require(path.join(migrationsDir, file));
    assert.equal(typeof migration.id, "string", `${file} must export a string id`);
    assert.equal(typeof migration.up, "function", `${file} must export an up(db) function`);
    ids.set(migration.id, [...(ids.get(migration.id) || []), file]);
  }

  const duplicatePrefixes = [...prefixes.entries()].filter((entry) => entry[1].length > 1);
  const duplicateIds = [...ids.entries()].filter((entry) => entry[1].length > 1);
  assert.deepEqual(duplicatePrefixes, []);
  assert.deepEqual(duplicateIds, []);
});
