module.exports = {
  id: "012_reporter_test_types",
  description: "Add test_types JSON array column to reporter_projects for multi-test-type support.",
  up(db) {
    db.exec(`
      ALTER TABLE reporter_projects ADD COLUMN test_types TEXT NOT NULL DEFAULT '[]';
    `);
  },
};
