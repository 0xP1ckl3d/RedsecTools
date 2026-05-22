module.exports = {
  id: "035_lol_lookup_search_projection",
  description: "Add a lightweight LOL Lookup search projection separate from raw source entry details.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lol_lookup_search_entries (
        entry_id TEXT PRIMARY KEY REFERENCES lol_lookup_entries(id) ON DELETE CASCADE,
        source_key TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_link TEXT,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL,
        platform TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        description TEXT,
        functions_json TEXT NOT NULL DEFAULT '[]',
        attack_mappings_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        hashes_json TEXT NOT NULL DEFAULT '[]',
        signer TEXT,
        vendor TEXT,
        search_text TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_lol_lookup_search_entries_source
        ON lol_lookup_search_entries(source_key);
      CREATE INDEX IF NOT EXISTS idx_lol_lookup_search_entries_platform
        ON lol_lookup_search_entries(platform);
      CREATE INDEX IF NOT EXISTS idx_lol_lookup_search_entries_name
        ON lol_lookup_search_entries(name_lc);

      INSERT OR REPLACE INTO lol_lookup_search_entries (
        entry_id, source_key, source_url, source_link, name, name_lc, platform, entry_type,
        description, functions_json, attack_mappings_json, tags_json, hashes_json, signer,
        vendor, search_text, fetched_at
      )
      SELECT
        id,
        source_key,
        source_url,
        source_link,
        name,
        name_lc,
        platform,
        entry_type,
        description,
        functions_json,
        attack_mappings_json,
        tags_json,
        hashes_json,
        signer,
        vendor,
        lower(
          coalesce(name, '') || char(10) ||
          coalesce(platform, '') || char(10) ||
          coalesce(entry_type, '') || char(10) ||
          coalesce(description, '') || char(10) ||
          coalesce(functions_json, '[]') || char(10) ||
          coalesce(commands_json, '[]') || char(10) ||
          coalesce(paths_json, '[]') || char(10) ||
          coalesce(detections_json, '[]') || char(10) ||
          coalesce(attack_mappings_json, '[]') || char(10) ||
          coalesce(tags_json, '[]') || char(10) ||
          coalesce(references_json, '[]') || char(10) ||
          coalesce(hashes_json, '[]') || char(10) ||
          coalesce(signer, '') || char(10) ||
          coalesce(vendor, '')
        ),
        fetched_at
      FROM lol_lookup_entries;
    `);
  },
};
