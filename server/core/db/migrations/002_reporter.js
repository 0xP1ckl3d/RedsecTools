module.exports = {
  id: "002_reporter",
  description: "Add RedSecReporter tables for pentest report projects, findings, designs, templates, and collaboration features.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reporter_designs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        report_type TEXT NOT NULL DEFAULT 'custom',
        html_template TEXT NOT NULL DEFAULT '',
        css_template TEXT NOT NULL DEFAULT '',
        field_definitions TEXT NOT NULL DEFAULT '[]',
        section_definitions TEXT NOT NULL DEFAULT '[]',
        finding_field_definitions TEXT NOT NULL DEFAULT '[]',
        finding_ordering_rule TEXT NOT NULL DEFAULT 'severity_desc',
        finding_grouping_rule TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_designs_type ON reporter_designs(report_type);

      CREATE TABLE IF NOT EXISTS reporter_projects (
        id TEXT PRIMARY KEY,
        design_id TEXT NOT NULL,
        title TEXT NOT NULL,
        report_type TEXT NOT NULL DEFAULT 'custom',
        status TEXT NOT NULL DEFAULT 'draft',
        version INTEGER NOT NULL DEFAULT 1,
        client_name TEXT NOT NULL DEFAULT '',
        project_metadata TEXT NOT NULL DEFAULT '{}',
        is_archived INTEGER NOT NULL DEFAULT 0,
        due_date INTEGER,
        source_project_id TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_projects_design ON reporter_projects(design_id);
      CREATE INDEX IF NOT EXISTS idx_reporter_projects_status ON reporter_projects(status);
      CREATE INDEX IF NOT EXISTS idx_reporter_projects_archived ON reporter_projects(is_archived);
      CREATE INDEX IF NOT EXISTS idx_reporter_projects_created_by ON reporter_projects(created_by);

      CREATE TABLE IF NOT EXISTS reporter_project_members (
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'pentester',
        joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (project_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS reporter_findings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        template_id TEXT,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'info',
        cvss_vector TEXT NOT NULL DEFAULT '',
        cvss_score REAL,
        status TEXT NOT NULL DEFAULT 'draft',
        order_index INTEGER NOT NULL DEFAULT 0,
        group_key TEXT,
        is_included INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        updated_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_findings_project ON reporter_findings(project_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_reporter_findings_severity ON reporter_findings(project_id, severity);
      CREATE INDEX IF NOT EXISTS idx_reporter_findings_status ON reporter_findings(project_id, status);

      CREATE TABLE IF NOT EXISTS reporter_finding_fields (
        id TEXT PRIMARY KEY,
        finding_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(finding_id, field_name)
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_finding_fields_finding ON reporter_finding_fields(finding_id, field_name);

      CREATE TABLE IF NOT EXISTS reporter_sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        section_type TEXT NOT NULL DEFAULT 'custom',
        content TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        is_included INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        updated_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_sections_project ON reporter_sections(project_id, order_index);

      CREATE TABLE IF NOT EXISTS reporter_finding_templates (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        severity TEXT NOT NULL DEFAULT 'medium',
        cvss_vector TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_finding_templates_severity ON reporter_finding_templates(severity);

      CREATE TABLE IF NOT EXISTS reporter_template_fields (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'en',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(template_id, field_name, language)
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_template_fields_template ON reporter_template_fields(template_id);

      CREATE TABLE IF NOT EXISTS reporter_notes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Untitled Note',
        content TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_notes_project ON reporter_notes(project_id, order_index);

      CREATE TABLE IF NOT EXISTS reporter_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_resolved INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_comments_target ON reporter_comments(target_type, target_id, created_at);

      CREATE TABLE IF NOT EXISTS reporter_history (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        change_summary TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_history_target ON reporter_history(target_type, target_id, version_number DESC);

      CREATE TABLE IF NOT EXISTS reporter_pdf_generations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        render_options TEXT NOT NULL DEFAULT '{}',
        generated_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_pdf_generations_project ON reporter_pdf_generations(project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS reporter_import_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        import_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        source_file TEXT,
        result_summary TEXT NOT NULL DEFAULT '{}',
        error_message TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_reporter_import_jobs_project ON reporter_import_jobs(project_id);
    `);
  },
};
