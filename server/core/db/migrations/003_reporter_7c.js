module.exports = {
  id: "003_reporter_7c",
  description: "Add RedSecReporter evidence, import/export, notes, comments, and history support tables.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reporter_evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        finding_id TEXT,
        section_id TEXT,
        filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        caption TEXT NOT NULL DEFAULT '',
        evidence_type TEXT NOT NULL DEFAULT 'file',
        redaction_status TEXT NOT NULL DEFAULT 'not_required',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_evidence_project ON reporter_evidence(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reporter_evidence_finding ON reporter_evidence(finding_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reporter_evidence_section ON reporter_evidence(section_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_reporter_notes_project ON reporter_notes(project_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_reporter_comments_project ON reporter_comments(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reporter_import_jobs_project ON reporter_import_jobs(project_id, created_at DESC);
    `);
  },
};
