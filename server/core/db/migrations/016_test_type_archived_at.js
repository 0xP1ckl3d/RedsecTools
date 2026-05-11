module.exports = {
  id: "016_test_type_archived_at",
  description: "Add archived_at column to reporter_test_type_templates for custom write-up archiving.",
  up(db) {
    db.exec(`ALTER TABLE reporter_test_type_templates ADD COLUMN archived_at INTEGER`);
  },
};
