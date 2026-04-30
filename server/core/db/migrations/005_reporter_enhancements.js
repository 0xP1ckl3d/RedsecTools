module.exports = {
  id: "005_reporter_enhancements",
  description: "Add assignee to findings, readonly/tags/override_finding_order to projects, finding_ordering/finding_grouping to designs.",
  up(db) {
    const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
    const addColumn = (table, column, sql) => {
      if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
    };

    addColumn("reporter_findings", "assignee_id", "assignee_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_reporter_findings_assignee ON reporter_findings(assignee_id)");

    addColumn("reporter_projects", "readonly", "readonly INTEGER NOT NULL DEFAULT 0");
    addColumn("reporter_projects", "readonly_since", "readonly_since INTEGER");
    addColumn("reporter_projects", "tags", "tags TEXT NOT NULL DEFAULT ''");
    addColumn("reporter_projects", "override_finding_order", "override_finding_order INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_reporter_projects_readonly ON reporter_projects(readonly)");

    addColumn("reporter_designs", "finding_ordering", "finding_ordering TEXT NOT NULL DEFAULT '[]'");
    addColumn("reporter_designs", "finding_grouping", "finding_grouping TEXT");
  },
};
