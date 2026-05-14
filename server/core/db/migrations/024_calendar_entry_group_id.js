module.exports = {
  id: "024_calendar_entry_group_id",
  description: "Add group_id column to calendar_entries for linking daily allocation segments as a series.",
  up(db) {
    const cols = db.pragma("table_info(calendar_entries)").map((c) => c.name);
    if (!cols.includes("group_id")) {
      db.exec("ALTER TABLE calendar_entries ADD COLUMN group_id TEXT");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_calendar_entries_group ON calendar_entries(group_id) WHERE group_id IS NOT NULL");
  },
};
