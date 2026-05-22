const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { safeFetchPublicUrl, readResponseTextWithLimit } = require("../security/safe-fetch");
const { logEvent } = require("../logger");
const { DB_PATH } = require("../db/connection");

const LOL_LOOKUP_SOURCES = Object.freeze({
  lolbas: {
    key: "lolbas",
    name: "LOLBAS",
    url: "https://lolbas-project.github.io/api/lolbas.json",
    platform: "Windows",
  },
  gtfobins: {
    key: "gtfobins",
    name: "GTFOBins",
    url: "https://gtfobins.org/api.json",
    platform: "Linux/Unix",
  },
  loldrivers: {
    key: "loldrivers",
    name: "LOLDrivers",
    url: "https://www.loldrivers.io/api/drivers.json",
    platform: "Drivers",
  },
});

const DEFAULT_BACKUP_RETENTION = 10;
const DEFAULT_STALE_DAYS = 8;
const DEFAULT_SYNC_SCHEDULE = "daily";
const SCHEDULE_HOURS = Object.freeze({ manual: null, daily: 24, weekly: 24 * 7 });
const LOL_LOOKUP_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const LOL_LOOKUP_RESULT_LIMIT = 90;
const LOL_LOOKUP_FETCH_TIMEOUT_MS = 30 * 1000;
const LOL_LOOKUP_SYNC_TIMEOUT_MS = Object.freeze({
  lolbas: 60 * 1000,
  gtfobins: 60 * 1000,
  loldrivers: 3 * 60 * 1000,
});
const BACKUP_DIR = path.join(path.dirname(DB_PATH), "lol-lookup", "source-backups");
const activeSourceSyncs = new Set();

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function compact(values) {
  return [...new Set(asArray(values).flatMap((value) => {
    if (value == null) return [];
    if (typeof value === "object") return Object.values(value).flatMap((item) => compact(item));
    const text = String(value).trim();
    return text ? [text] : [];
  }))];
}

function json(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function timestampSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoBackupStamp(nowSeconds) {
  return new Date(nowSeconds * 1000).toISOString().replace(/[:.]/g, "-");
}

function sourceDefinition(sourceKey) {
  return LOL_LOOKUP_SOURCES[sourceKey] || null;
}

function textHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function entryId(sourceKey, name, sourceLink, discriminator = "") {
  return crypto.createHash("sha256")
    .update([sourceKey, name, sourceLink || "", discriminator].join("\0"))
    .digest("hex")
    .slice(0, 32);
}

function lowerText(...values) {
  return compact(values).join("\n").toLowerCase();
}

function flattenTags(tags) {
  return compact(asArray(tags).flatMap((tag) => {
    if (tag && typeof tag === "object") {
      return Object.entries(tag).flatMap(([key, value]) => [key, value]);
    }
    return tag;
  }));
}

function collectLinks(items) {
  return compact(asArray(items).flatMap((item) => {
    if (!item || typeof item !== "object") return item;
    return item.Link || item.link || item.URL || item.Url || item.url || item.Reference || item.reference || null;
  }));
}

function normalizeLolbasType(entry) {
  const url = String(entry.url || "").toLowerCase();
  const name = String(entry.Name || "").toLowerCase();
  if (url.includes("/scripts/") || /\.(ps1|bat|cmd|vbs|js|wsf)$/i.test(name)) return "script";
  if (url.includes("/libraries/") || /\.(dll|ocx)$/i.test(name)) return "library";
  return "binary";
}

function normalizeLolbasEntries(rawEntries, source, fetchedAt, sourceVersion) {
  if (!Array.isArray(rawEntries)) throw new Error("LOLBAS feed must be an array");
  return rawEntries.map((entry) => {
    if (!entry || typeof entry !== "object" || !String(entry.Name || "").trim()) {
      throw new Error("LOLBAS entry is missing Name");
    }
    const commands = asArray(entry.Commands).map((command) => ({
      command: String(command.Command || "").trim(),
      description: String(command.Description || "").trim(),
      usecase: String(command.Usecase || "").trim(),
      category: String(command.Category || command.Function || "").trim(),
      privileges: String(command.Privileges || "").trim(),
      operatingSystem: String(command.OperatingSystem || "").trim(),
      mitreId: String(command.MitreID || "").trim(),
      tags: flattenTags(command.Tags),
    })).filter((command) => command.command || command.description || command.usecase);
    const paths = compact(asArray(entry.Full_Path).map((item) => item?.Path || item?.path || item));
    const detections = asArray(entry.Detection).filter(Boolean);
    const functions = compact(commands.map((command) => command.category));
    const attackMappings = compact(commands.map((command) => command.mitreId));
    const tags = compact([flattenTags(entry.Tags), commands.flatMap((command) => command.tags)]);
    const references = collectLinks(entry.Resources);
    const sourceLink = String(entry.url || source.url);
    return normalizedEntry({
      source,
      fetchedAt,
      sourceVersion,
      name: String(entry.Name).trim(),
      platform: source.platform,
      entryType: normalizeLolbasType(entry),
      description: String(entry.Description || "").trim(),
      functions,
      commands,
      paths,
      detections,
      attackMappings,
      tags,
      references,
      sourceLink,
      rawEntry: entry,
      metadata: compact([entry.Author, entry.Created]),
    });
  });
}

function normalizeGtfoBinsEntries(rawEntries, source, fetchedAt, sourceVersion) {
  if (!rawEntries || Array.isArray(rawEntries) || typeof rawEntries !== "object") {
    throw new Error("GTFOBins feed must be an object keyed by binary name");
  }
  const entries = rawEntries.executables && typeof rawEntries.executables === "object"
    ? rawEntries.executables
    : rawEntries;
  const functionMetadata = rawEntries.functions && typeof rawEntries.functions === "object"
    ? rawEntries.functions
    : {};
  return Object.entries(entries).flatMap(([name, entry]) => {
    if (!name || !entry || typeof entry !== "object") {
      throw new Error("GTFOBins entry is malformed");
    }
    const aliasTarget = entry.alias && entries[entry.alias] && typeof entries[entry.alias] === "object"
      ? entries[entry.alias]
      : null;
    const functionMap = entry.functions && typeof entry.functions === "object"
      ? entry.functions
      : aliasTarget?.functions && typeof aliasTarget.functions === "object"
        ? aliasTarget.functions
        : null;
    if (!functionMap) return [];
    const commands = Object.entries(functionMap).flatMap(([functionName, payloads]) =>
      asArray(payloads).map((payload) => ({
        function: functionName,
        command: String(payload?.code || "").trim(),
        description: String(payload?.description || payload?.comment || "").trim(),
        contexts: payload?.contexts && typeof payload.contexts === "object" ? payload.contexts : null,
        sourceFunction: functionMetadata[functionName]?.label || functionName,
      })).filter((payload) => payload.command || payload.description)
    );
    const functions = Object.keys(functionMap);
    const attackMappings = compact(functions.flatMap((fn) => functionMetadata[fn]?.mitre || []));
    return [normalizedEntry({
      source,
      fetchedAt,
      sourceVersion,
      name,
      platform: source.platform,
      entryType: "Unix binary",
      description: String(entry.description || entry.comment || aliasTarget?.description || aliasTarget?.comment || "").trim(),
      functions,
      commands,
      attackMappings,
      sourceLink: `https://gtfobins.org/gtfobins/${encodeURIComponent(name)}/`,
      rawEntry: entry.alias ? { ...entry, _aliasTarget: entry.alias } : entry,
      tags: compact([functions, entry.alias]),
    })];
  });
}

function parseMaybeMultiJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (rows.length > 1) {
      return rows.map((line) => JSON.parse(line));
    }
    throw error;
  }
}

function pick(record, names, fallback = null) {
  for (const name of names) {
    if (record && record[name] != null && record[name] !== "") return record[name];
  }
  return fallback;
}

function normalizeDriverSamples(record) {
  return asArray(pick(record, ["KnownVulnerableSamples", "knownVulnerableSamples", "Samples", "samples"], []))
    .filter((sample) => sample && typeof sample === "object")
    .map((sample) => ({
      filename: String(pick(sample, ["Filename", "filename", "FileName", "fileName"], "")).trim(),
      sha256: String(pick(sample, ["SHA256", "Sha256", "sha256"], "")).trim(),
      sha1: String(pick(sample, ["SHA1", "Sha1", "sha1"], "")).trim(),
      md5: String(pick(sample, ["MD5", "Md5", "md5"], "")).trim(),
      signer: String(pick(sample, ["Signer", "signer", "AuthentihashSigner"], "")).trim(),
      vendor: String(pick(sample, ["Vendor", "vendor", "Company", "company"], "")).trim(),
      created: String(pick(sample, ["Created", "created"], "")).trim(),
    }));
}

function driverReferenceLinks(record) {
  return collectLinks([
    pick(record, ["Resources", "resources", "References", "references"], []),
    pick(record, ["Tags", "tags"], []),
  ]);
}

function normalizeLolDriverFeed(rawFeed) {
  if (Array.isArray(rawFeed)) return rawFeed;
  if (rawFeed && Array.isArray(rawFeed.drivers)) return rawFeed.drivers;
  if (rawFeed && typeof rawFeed === "object") return [rawFeed];
  throw new Error("LOLDrivers feed must be a JSON object or array");
}

function normalizeLolDriverEntries(rawFeed, source, fetchedAt, sourceVersion) {
  const records = normalizeLolDriverFeed(rawFeed);
  return records.map((record, index) => {
    if (!record || typeof record !== "object") throw new Error("LOLDrivers entry must be an object");
    const samples = normalizeDriverSamples(record);
    const filenames = compact(samples.map((sample) => sample.filename));
    const uuid = String(pick(record, ["Id", "id", "UUID", "Uuid", "uuid"], "")).trim();
    const name = filenames[0]
      || String(pick(record, ["Tag", "tag", "Name", "name", "Filename", "filename"], "")).trim()
      || `LOLDrivers record ${index + 1}`;
    const category = String(pick(record, ["Category", "category"], "")).trim();
    const privileges = compact(pick(record, ["Privileges", "privileges"], []));
    const tags = compact([
      flattenTags(pick(record, ["Tags", "tags"], [])),
      category,
      privileges,
      filenames,
      pick(record, ["Verified", "verified"], ""),
      pick(record, ["MitreID", "mitreId", "MITRE", "mitre"], ""),
    ]);
    const attackMappings = compact(pick(record, ["MitreID", "mitreId", "MITRE", "mitre"], []));
    const hashes = samples.flatMap((sample) => [
      sample.sha256 ? { algorithm: "SHA256", value: sample.sha256, filename: sample.filename } : null,
      sample.sha1 ? { algorithm: "SHA1", value: sample.sha1, filename: sample.filename } : null,
      sample.md5 ? { algorithm: "MD5", value: sample.md5, filename: sample.filename } : null,
    ]).filter(Boolean);
    const signer = compact(samples.map((sample) => sample.signer)).join(", ");
    const vendor = compact(samples.map((sample) => sample.vendor)).join(", ");
    const commands = asArray(pick(record, ["Commands", "commands"], [])).map((command) => ({
      command: String(command?.Command || command?.command || command || "").trim(),
      description: String(command?.Description || command?.description || "").trim(),
    })).filter((command) => command.command || command.description);
    const description = compact([
      pick(record, ["Description", "description"], ""),
      pick(record, ["Usecase", "UseCase", "usecase", "useCase"], ""),
      pick(record, ["Notes", "notes"], ""),
    ]).join("\n");
    return normalizedEntry({
      source,
      fetchedAt,
      sourceVersion,
      name,
      platform: source.platform,
      entryType: "driver",
      description,
      functions: compact([category, privileges]),
      commands,
      detections: asArray(pick(record, ["Detection", "Detections", "detection", "detections"], [])).filter(Boolean),
      attackMappings,
      tags,
      references: driverReferenceLinks(record),
      sourceLink: uuid ? `https://www.loldrivers.io/drivers/${encodeURIComponent(uuid)}/` : source.url,
      hashes,
      signer,
      vendor,
      rawEntry: { ...record, _normalizedSamples: samples },
      discriminator: uuid || index,
    });
  });
}

function normalizedEntry({
  source,
  fetchedAt,
  sourceVersion,
  name,
  platform,
  entryType,
  description = "",
  functions = [],
  commands = [],
  paths = [],
  detections = [],
  attackMappings = [],
  tags = [],
  references = [],
  hashes = [],
  signer = "",
  vendor = "",
  sourceLink = null,
  rawEntry,
  metadata = [],
  discriminator = "",
}) {
  const searchText = lowerText(
    name,
    platform,
    entryType,
    description,
    functions,
    commands.flatMap((command) => Object.values(command || {})),
    paths,
    detections,
    attackMappings,
    tags,
    references,
    hashes.flatMap((hash) => Object.values(hash || {})),
    signer,
    vendor,
    metadata,
  );
  return {
    id: entryId(source.key, name, sourceLink, discriminator),
    sourceKey: source.key,
    sourceUrl: source.url,
    sourceLink,
    name,
    nameLc: name.toLowerCase(),
    platform,
    entryType,
    description,
    functions: compact(functions),
    commands,
    paths: compact(paths),
    detections,
    attackMappings: compact(attackMappings),
    tags: compact(tags),
    references: compact(references),
    hashes,
    signer: signer || "",
    vendor: vendor || "",
    searchText,
    rawEntry,
    fetchedAt,
    sourceVersion,
  };
}

function normalizeSourceDocument(sourceKey, text, { fetchedAt = timestampSeconds(), sourceVersion = null } = {}) {
  const source = sourceDefinition(sourceKey);
  if (!source) throw new Error("Unknown LOL Lookup source");
  const raw = parseMaybeMultiJson(text);
  let entries = [];
  if (sourceKey === "lolbas") entries = normalizeLolbasEntries(raw, source, fetchedAt, sourceVersion);
  if (sourceKey === "gtfobins") entries = normalizeGtfoBinsEntries(raw, source, fetchedAt, sourceVersion);
  if (sourceKey === "loldrivers") entries = normalizeLolDriverEntries(raw, source, fetchedAt, sourceVersion);
  if (!entries.length) throw new Error(`${source.name} feed contains no entries`);
  return entries;
}

function sourceVersionFromResponse(response, contentHash) {
  const etag = response?.headers?.get?.("etag");
  const modified = response?.headers?.get?.("last-modified");
  if (etag) return `etag:${etag.replace(/^W\//, "")}`;
  if (modified) return `last-modified:${modified}`;
  return `sha256:${contentHash}`;
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function writeRawBackup(sourceKey, text, fetchedAt, contentHash) {
  ensureBackupDir();
  const suffix = crypto.randomBytes(3).toString("hex");
  const fileName = `${sourceKey}-${isoBackupStamp(fetchedAt)}-${contentHash.slice(0, 12)}-${suffix}.json`;
  const backupPath = path.join(BACKUP_DIR, fileName);
  fs.writeFileSync(backupPath, text, { encoding: "utf8", flag: "wx" });
  return backupPath;
}

function lolLookupStatements(db) {
  return {
    upsertSource: db.prepare(`
      INSERT INTO lol_lookup_sources (
        source_key, source_name, source_url, source_version, content_hash, raw_document,
        entry_count, fetched_at, last_success_at, last_attempted_at, last_error
      ) VALUES (
        @sourceKey, @sourceName, @sourceUrl, @sourceVersion, @contentHash, @rawDocument,
        @entryCount, @fetchedAt, @fetchedAt, @fetchedAt, NULL
      )
      ON CONFLICT(source_key) DO UPDATE SET
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        source_version = excluded.source_version,
        content_hash = excluded.content_hash,
        raw_document = excluded.raw_document,
        entry_count = excluded.entry_count,
        fetched_at = excluded.fetched_at,
        last_success_at = excluded.last_success_at,
        last_attempted_at = excluded.last_attempted_at,
        last_error = NULL,
        updated_at = unixepoch()
    `),
    markAttempt: db.prepare(`
      INSERT INTO lol_lookup_sources (source_key, source_name, source_url, last_attempted_at, last_error)
      VALUES (@sourceKey, @sourceName, @sourceUrl, @attemptedAt, @error)
      ON CONFLICT(source_key) DO UPDATE SET
        last_attempted_at = excluded.last_attempted_at,
        last_error = excluded.last_error,
        updated_at = unixepoch()
    `),
    beginAttempt: db.prepare(`
      INSERT INTO lol_lookup_sources (source_key, source_name, source_url, last_attempted_at, last_error)
      VALUES (@sourceKey, @sourceName, @sourceUrl, @attemptedAt, NULL)
      ON CONFLICT(source_key) DO UPDATE SET
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        last_attempted_at = excluded.last_attempted_at,
        last_error = NULL,
        updated_at = unixepoch()
    `),
    deleteEntries: db.prepare("DELETE FROM lol_lookup_entries WHERE source_key = ?"),
    insertEntry: db.prepare(`
      INSERT INTO lol_lookup_entries (
        id, source_key, source_url, source_link, name, name_lc, platform, entry_type, description,
        functions_json, commands_json, paths_json, detections_json, attack_mappings_json, tags_json,
        references_json, hashes_json, signer, vendor, search_text, raw_entry, fetched_at, source_version
      ) VALUES (
        @id, @sourceKey, @sourceUrl, @sourceLink, @name, @nameLc, @platform, @entryType, @description,
        @functionsJson, @commandsJson, @pathsJson, @detectionsJson, @attackMappingsJson, @tagsJson,
        @referencesJson, @hashesJson, @signer, @vendor, @searchText, @rawEntry, @fetchedAt, @sourceVersion
      )
    `),
    insertSearchEntry: db.prepare(`
      INSERT INTO lol_lookup_search_entries (
        entry_id, source_key, source_url, source_link, name, name_lc, platform, entry_type, description,
        functions_json, attack_mappings_json, tags_json, hashes_json, signer, vendor, search_text, fetched_at
      ) VALUES (
        @id, @sourceKey, @sourceUrl, @sourceLink, @name, @nameLc, @platform, @entryType, @description,
        @functionsJson, @attackMappingsJson, @tagsJson, @hashesJson, @signer, @vendor, @searchText, @fetchedAt
      )
    `),
    insertBackup: db.prepare(`
      INSERT INTO lol_lookup_backups (source_key, backup_path, content_hash, source_version, entry_count, fetched_at)
      VALUES (@sourceKey, @backupPath, @contentHash, @sourceVersion, @entryCount, @fetchedAt)
    `),
    listOldBackups: db.prepare(`
      SELECT id, backup_path FROM lol_lookup_backups
      WHERE source_key = ?
      ORDER BY created_at DESC, id DESC
      LIMIT -1 OFFSET ?
    `),
    deleteBackup: db.prepare("DELETE FROM lol_lookup_backups WHERE id = ?"),
      sourceStatus: db.prepare(`
        SELECT s.*, COUNT(b.id) AS backup_count
        FROM lol_lookup_sources s
        LEFT JOIN lol_lookup_backups b ON b.source_key = s.source_key
        GROUP BY s.source_key
        ORDER BY s.source_name ASC
      `),
      functionFacets: db.prepare(`
        SELECT source_key, functions_json
        FROM lol_lookup_search_entries
        WHERE functions_json != '[]'
      `),
      sourceByKey: db.prepare("SELECT * FROM lol_lookup_sources WHERE source_key = ?"),
    entry: db.prepare(`
      SELECT e.*, s.source_name, s.last_success_at
      FROM lol_lookup_entries e
      JOIN lol_lookup_sources s ON s.source_key = e.source_key
      WHERE e.id = ?
    `),
  };
}

function replaceLolLookupSource(db, { sourceKey, rawDocument, entries, fetchedAt, sourceVersion, contentHash, backupPath }) {
  const source = sourceDefinition(sourceKey);
  const statements = lolLookupStatements(db);
  db.transaction(() => {
    statements.upsertSource.run({
      sourceKey,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceVersion,
      contentHash,
      rawDocument,
      entryCount: entries.length,
      fetchedAt,
    });
    statements.deleteEntries.run(sourceKey);
    for (const entry of entries) {
      statements.insertEntry.run({
        ...entry,
        functionsJson: JSON.stringify(entry.functions),
        commandsJson: JSON.stringify(entry.commands),
        pathsJson: JSON.stringify(entry.paths),
        detectionsJson: JSON.stringify(entry.detections),
        attackMappingsJson: JSON.stringify(entry.attackMappings),
        tagsJson: JSON.stringify(entry.tags),
        referencesJson: JSON.stringify(entry.references),
        hashesJson: JSON.stringify(entry.hashes),
        rawEntry: JSON.stringify(entry.rawEntry),
      });
      statements.insertSearchEntry.run({
        ...entry,
        functionsJson: JSON.stringify(entry.functions),
        attackMappingsJson: JSON.stringify(entry.attackMappings),
        tagsJson: JSON.stringify(entry.tags),
        hashesJson: JSON.stringify(entry.hashes),
      });
    }
    statements.insertBackup.run({
      sourceKey,
      backupPath,
      contentHash,
      sourceVersion,
      entryCount: entries.length,
      fetchedAt,
    });
  })();
}

function normalizePositiveInteger(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function getLolLookupSettings(getSetting) {
  const schedule = String(getSetting("lol_lookup_sync_schedule") || DEFAULT_SYNC_SCHEDULE).toLowerCase();
  return {
    syncSchedule: Object.hasOwn(SCHEDULE_HOURS, schedule) ? schedule : DEFAULT_SYNC_SCHEDULE,
    backupRetention: normalizePositiveInteger(getSetting("lol_lookup_backup_retention"), DEFAULT_BACKUP_RETENTION, { max: 50 }),
    staleDays: normalizePositiveInteger(getSetting("lol_lookup_stale_days"), DEFAULT_STALE_DAYS, { max: 365 }),
  };
}

function pruneRawBackups(db, sourceKey, retention) {
  const statements = lolLookupStatements(db);
  const oldBackups = statements.listOldBackups.all(sourceKey, retention);
  for (const backup of oldBackups) {
    const resolved = path.resolve(backup.backup_path);
    const root = path.resolve(BACKUP_DIR) + path.sep;
    if (resolved.startsWith(root)) {
      try {
        fs.unlinkSync(resolved);
      } catch (_) {
        // Metadata is still removed; stale backup files are harmless and can be cleared later.
      }
    }
    statements.deleteBackup.run(backup.id);
  }
}

async function syncLolLookupSource(db, sourceKey, { getSetting = () => null } = {}) {
  const source = sourceDefinition(sourceKey);
  if (!source) throw new Error("Unknown LOL Lookup source");
  const statements = lolLookupStatements(db);
  const fetchedAt = timestampSeconds();
  const controller = new AbortController();
  const syncTimeoutMs = LOL_LOOKUP_SYNC_TIMEOUT_MS[sourceKey] || LOL_LOOKUP_SYNC_TIMEOUT_MS.lolbas;
  let timedOut = false;
  const syncTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, syncTimeoutMs);
  activeSourceSyncs.add(sourceKey);
  statements.beginAttempt.run({
    sourceKey,
    sourceName: source.name,
    sourceUrl: source.url,
    attemptedAt: fetchedAt,
  });
  try {
    const { response } = await safeFetchPublicUrl(source.url, {
      headers: { accept: "application/json", "user-agent": "RedSecTools-LOL-Lookup/1.0" },
      signal: controller.signal,
      timeoutMs: LOL_LOOKUP_FETCH_TIMEOUT_MS,
      maxRedirects: 2,
    });
    if (!response.ok) throw new Error(`${source.name} responded with HTTP ${response.status}`);
    const rawDocument = await readResponseTextWithLimit(response, LOL_LOOKUP_MAX_SOURCE_BYTES);
    const contentHash = textHash(rawDocument);
    const sourceVersion = sourceVersionFromResponse(response, contentHash);
    const entries = normalizeSourceDocument(sourceKey, rawDocument, { fetchedAt, sourceVersion });
    const backupPath = writeRawBackup(sourceKey, rawDocument, fetchedAt, contentHash);
    replaceLolLookupSource(db, { sourceKey, rawDocument, entries, fetchedAt, sourceVersion, contentHash, backupPath });
    pruneRawBackups(db, sourceKey, getLolLookupSettings(getSetting).backupRetention);
    return { ok: true, sourceKey, sourceName: source.name, entryCount: entries.length, fetchedAt, sourceVersion };
  } catch (error) {
    const errorMessage = timedOut
      ? `${source.name} sync timed out after ${Math.ceil(syncTimeoutMs / 1000)} seconds`
      : error.message || "Sync failed";
    statements.markAttempt.run({
      sourceKey,
      sourceName: source.name,
      sourceUrl: source.url,
      attemptedAt: fetchedAt,
      error: errorMessage,
    });
    return { ok: false, sourceKey, sourceName: source.name, error: errorMessage };
  } finally {
    clearTimeout(syncTimer);
    activeSourceSyncs.delete(sourceKey);
  }
}

async function syncAllLolLookupSources(db, options) {
  return Promise.all(Object.keys(LOL_LOOKUP_SOURCES).map((sourceKey) =>
    syncLolLookupSource(db, sourceKey, options)
  ));
}

function serializeStatus(row, settings, now = timestampSeconds()) {
  const lastSuccessAt = Number(row?.last_success_at || 0) || null;
  const lastAttemptedAt = Number(row?.last_attempted_at || 0) || null;
  const syncing = activeSourceSyncs.has(row.source_key);
  const incompleteAttempt = !syncing && lastAttemptedAt && (!lastSuccessAt || lastAttemptedAt > lastSuccessAt) && !row?.last_error;
  const staleAfter = settings.staleDays * 24 * 60 * 60;
  return {
    key: row.source_key,
    name: row.source_name,
    sourceUrl: row.source_url,
    sourceVersion: row.source_version || null,
    fetchedAt: row.fetched_at || null,
    lastSuccessAt,
    lastAttemptedAt,
    lastError: row.last_error || (incompleteAttempt ? "The last refresh attempt did not complete before a validated cache update." : null),
    entryCount: Number(row.entry_count || 0),
    backupCount: Number(row.backup_count || 0),
    syncing,
    stale: !lastSuccessAt || (now - lastSuccessAt) > staleAfter,
  };
}

function getLolLookupStatus(db, { getSetting = () => null } = {}) {
  const settings = getLolLookupSettings(getSetting);
  const statements = lolLookupStatements(db);
  const rows = statements.sourceStatus.all();
  const byKey = new Map(rows.map((row) => [row.source_key, row]));
  return {
    settings,
    sources: Object.values(LOL_LOOKUP_SOURCES).map((source) => serializeStatus(byKey.get(source.key) || {
      source_key: source.key,
      source_name: source.name,
      source_url: source.url,
    }, settings)),
    functionFacets: buildFunctionFacets(statements.functionFacets.all()),
  };
}

function addFunctionFacet(facets, sourceKey, value) {
  const label = String(value || "").trim();
  const key = filterName(label);
  if (!label || !key) return;
  if (!facets.all.has(key)) facets.all.set(key, label);
  if (!facets.bySource[sourceKey]) facets.bySource[sourceKey] = new Map();
  if (!facets.bySource[sourceKey].has(key)) facets.bySource[sourceKey].set(key, label);
}

function facetValues(values) {
  return [...values.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function buildFunctionFacets(rows) {
  const facets = { all: new Map(), bySource: {} };
  for (const row of rows) {
    for (const functionName of json(row.functions_json, [])) {
      addFunctionFacet(facets, row.source_key, functionName);
    }
  }
  return {
    all: facetValues(facets.all),
    bySource: Object.fromEntries(Object.values(LOL_LOOKUP_SOURCES).map((source) => [
      source.key,
      facetValues(facets.bySource[source.key] || new Map()),
    ])),
  };
}

function rowToResult(row, { summary = false } = {}) {
  const result = {
    id: row.id,
    source: row.source_key,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    sourceLink: row.source_link || row.source_url,
    lastDatasetUpdate: row.last_success_at || row.fetched_at,
    name: row.name,
    platform: row.platform,
    type: row.entry_type,
    description: row.description || "",
    functions: json(row.functions_json, []),
    tags: json(row.tags_json, []),
    attackMappings: json(row.attack_mappings_json, []),
    hashes: json(row.hashes_json, []),
    signer: row.signer || "",
    vendor: row.vendor || "",
  };
  if (!summary) {
    result.commands = json(row.commands_json, []);
    result.paths = json(row.paths_json, []);
    result.detections = json(row.detections_json, []);
    result.references = json(row.references_json, []);
    result.rawEntry = json(row.raw_entry, {});
    result.sourceVersion = row.source_version || null;
  }
  return result;
}

function normalizeSearchText(value, maxLength = 5000) {
  return String(value || "").trim().slice(0, maxLength);
}

function tokenize(value) {
  return compact(normalizeSearchText(value).toLowerCase()
    .split(/[^a-z0-9_.:+\\/-]+/i)
    .filter((part) => part.length > 1));
}

function commandTokens(command) {
  return tokenize(command).flatMap((token) => {
    const base = token.split(/[\\/]/).pop();
    return base && base !== token ? [token, base] : [token];
  });
}

function hashLike(value) {
  return /^[a-f0-9]{8,128}$/i.test(normalizeSearchText(value).replace(/\s+/g, ""));
}

function filterName(value) {
  return String(value || "").trim().toLowerCase();
}

function likeSearchPattern(value) {
  return `%${String(value || "").replace(/[!%_]/g, "!$&")}%`;
}

function searchCandidateTerms(search) {
  const query = search.query.toLowerCase();
  const tokens = search.mode === "command" ? commandTokens(query) : tokenize(query);
  return compact([query, tokens]).slice(0, 32);
}

function searchCandidateRows(db, search) {
  const params = [];
  const filters = [];
  const query = search.query.toLowerCase();
  const compactQuery = query.replace(/\s+/g, "");

  if (search.source) {
    filters.push("e.source_key = ?");
    params.push(search.source);
  }
  if (search.platform) {
    filters.push("lower(e.platform) = ?");
    params.push(search.platform);
  }
  if (search.functionFilter) {
    filters.push("e.functions_json LIKE ? ESCAPE '!'");
    params.push(likeSearchPattern(search.functionFilter));
  }

  if (search.mode === "hash") {
    filters.push("e.source_key = 'loldrivers'");
    filters.push("e.search_text LIKE ? ESCAPE '!'");
    params.push(likeSearchPattern(compactQuery));
  } else if (search.mode === "exact" && !hashLike(query)) {
    filters.push("e.name_lc = ?");
    params.push(query);
  } else {
    const terms = search.mode === "exact" ? [compactQuery] : searchCandidateTerms(search);
    const termFilters = terms.map(() => "(e.name_lc LIKE ? ESCAPE '!' OR e.search_text LIKE ? ESCAPE '!')");
    for (const term of terms) {
      const pattern = likeSearchPattern(term);
      params.push(pattern, pattern);
    }
    if (termFilters.length) filters.push(`(${termFilters.join(" OR ")})`);
  }

  return db.prepare(`
    SELECT
      e.entry_id AS id,
      e.source_key,
      e.source_url,
      e.source_link,
      e.name,
      e.name_lc,
      e.platform,
      e.entry_type,
      e.description,
      e.functions_json,
      e.attack_mappings_json,
      e.tags_json,
      e.hashes_json,
      e.signer,
      e.vendor,
      e.search_text,
      e.fetched_at,
      s.source_name,
      s.last_success_at
    FROM lol_lookup_search_entries e
    JOIN lol_lookup_sources s ON s.source_key = e.source_key
    WHERE ${filters.length ? filters.join(" AND ") : "1 = 0"}
    ORDER BY e.name_lc ASC
  `).all(...params);
}

function scoreRow(row, search) {
  const name = row.name_lc;
  const text = row.search_text;
  const query = search.query.toLowerCase();
  const queryTokens = search.mode === "command" ? commandTokens(query) : tokenize(query);
  const functionFilter = filterName(search.functionFilter);
  const functions = json(row.functions_json, []).map(filterName);
  if (functionFilter && !functions.some((fn) => fn.includes(functionFilter)) && !text.includes(functionFilter)) return -1;
  if (search.platform && filterName(row.platform) !== filterName(search.platform)) return -1;
  if (search.source && row.source_key !== search.source) return -1;
  if (!query) return 1;
  if (search.mode === "hash" && row.source_key !== "loldrivers") return -1;
  if (search.mode === "hash" && !text.includes(query.replace(/\s+/g, ""))) return -1;
  if (search.mode === "exact") {
    if (name === query) return 1000;
    if (hashLike(query) && text.includes(query.replace(/\s+/g, ""))) return 900;
    return -1;
  }
  if (name === query) return 1000;
  if (name.includes(query)) return 700;
  if (text.includes(query)) return 520;
  if (!queryTokens.length) return -1;
  const matching = queryTokens.filter((token) => name.includes(token) || text.includes(token));
  if (!matching.length) return -1;
  if (search.mode !== "command" && matching.length < queryTokens.length) return -1;
  return (matching.length * 70) + (matching.some((token) => name.includes(token)) ? 120 : 0);
}

function searchLolLookup(db, options = {}) {
  const search = {
    query: normalizeSearchText(options.query),
    mode: ["quick", "exact", "command", "hash"].includes(options.mode) ? options.mode : "quick",
    platform: filterName(options.platform),
    source: filterName(options.source),
    functionFilter: filterName(options.functionFilter),
  };
  if (search.platform === "windows") search.platform = "windows";
  if (search.platform === "linux" || search.platform === "unix") search.platform = "linux/unix";
  if (search.platform === "drivers" || search.platform === "driver") search.platform = "drivers";
  const limit = normalizePositiveInteger(options.limit, LOL_LOOKUP_RESULT_LIMIT, { max: LOL_LOOKUP_RESULT_LIMIT });
  const scored = searchCandidateRows(db, search)
    .map((row) => ({ row, score: scoreRow(row, search) }))
    .filter((result) => result.score >= 0)
    .sort((a, b) => b.score - a.score || a.row.name_lc.localeCompare(b.row.name_lc));
  const results = search.query ? scored.slice(0, limit) : scored;
  return {
    query: search.query,
    mode: search.mode,
    results: results.map(({ row }) => rowToResult(row, { summary: true })),
  };
}

function getLolLookupEntry(db, id) {
  const row = lolLookupStatements(db).entry.get(String(id || ""));
  return row ? rowToResult(row) : null;
}

function dueForScheduledSync(row, hours, now = timestampSeconds()) {
  if (!hours) return false;
  const lastSuccessAt = Number(row?.last_success_at || 0);
  const lastAttemptedAt = Number(row?.last_attempted_at || 0);
  const marker = Math.max(lastSuccessAt, lastAttemptedAt);
  return !marker || (now - marker) >= hours * 60 * 60;
}

async function syncDueLolLookupSources(db, { getSetting = () => null } = {}) {
  const settings = getLolLookupSettings(getSetting);
  const hours = SCHEDULE_HOURS[settings.syncSchedule];
  if (!hours) return [];
  const statements = lolLookupStatements(db);
  const results = [];
  for (const source of Object.values(LOL_LOOKUP_SOURCES)) {
    if (dueForScheduledSync(statements.sourceByKey.get(source.key), hours)) {
      results.push(await syncLolLookupSource(db, source.key, { getSetting }));
    }
  }
  return results;
}

function startLolLookupSyncScheduler(db, { getSetting = () => null } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncDueLolLookupSources(db, { getSetting });
      for (const result of results.filter((item) => !item.ok)) {
        logEvent("lol_lookup:scheduled_sync_failed", null, { source: result.sourceKey, error: result.error });
      }
    } catch (error) {
      logEvent("lol_lookup:scheduler_failed", null, { error: error.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref?.();
  setTimeout(run, 15 * 1000).unref?.();
  return timer;
}

module.exports = {
  LOL_LOOKUP_SOURCES,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_STALE_DAYS,
  DEFAULT_SYNC_SCHEDULE,
  normalizeSourceDocument,
  normalizeLolDriverFeed,
  replaceLolLookupSource,
  syncLolLookupSource,
  syncAllLolLookupSources,
  syncDueLolLookupSources,
  startLolLookupSyncScheduler,
  getLolLookupSettings,
  getLolLookupStatus,
  searchLolLookup,
  getLolLookupEntry,
};
