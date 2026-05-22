module.exports = {
  id: "034_lol_lookup_cache",
  description: "Add LOL Lookup source cache, normalised search entries, and raw backup metadata.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lol_lookup_sources (
        source_key TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_version TEXT,
        content_hash TEXT,
        raw_document TEXT,
        entry_count INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER,
        last_success_at INTEGER,
        last_attempted_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS lol_lookup_entries (
        id TEXT PRIMARY KEY,
        source_key TEXT NOT NULL REFERENCES lol_lookup_sources(source_key) ON DELETE CASCADE,
        source_url TEXT NOT NULL,
        source_link TEXT,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL,
        platform TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        description TEXT,
        functions_json TEXT NOT NULL DEFAULT '[]',
        commands_json TEXT NOT NULL DEFAULT '[]',
        paths_json TEXT NOT NULL DEFAULT '[]',
        detections_json TEXT NOT NULL DEFAULT '[]',
        attack_mappings_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        references_json TEXT NOT NULL DEFAULT '[]',
        hashes_json TEXT NOT NULL DEFAULT '[]',
        signer TEXT,
        vendor TEXT,
        search_text TEXT NOT NULL,
        raw_entry TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        source_version TEXT,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_lol_lookup_entries_source ON lol_lookup_entries(source_key);
      CREATE INDEX IF NOT EXISTS idx_lol_lookup_entries_platform ON lol_lookup_entries(platform);
      CREATE INDEX IF NOT EXISTS idx_lol_lookup_entries_name ON lol_lookup_entries(name_lc);

      CREATE TABLE IF NOT EXISTS lol_lookup_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL REFERENCES lol_lookup_sources(source_key) ON DELETE CASCADE,
        backup_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source_version TEXT,
        entry_count INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_lol_lookup_backups_source_created
        ON lol_lookup_backups(source_key, created_at DESC);
    `);
  },
};
