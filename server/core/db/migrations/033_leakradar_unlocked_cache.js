module.exports = {
  id: "033_leakradar_unlocked_cache",
  description: "Add encrypted LeakRadar unlocked record cache.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS leakradar_unlocked_records (
        leak_id TEXT PRIMARY KEY,
        domains_json TEXT NOT NULL DEFAULT '[]',
        payload_encrypted TEXT NOT NULL,
        unlocked_by TEXT,
        first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_leakradar_unlocked_records_last_seen ON leakradar_unlocked_records(last_seen_at DESC);
    `);
  },
};
