module.exports = {
  id: "011_reporter_proposals",
  description: "Create first-class Reporter proposal tables separate from report projects.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reporter_proposals (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        title TEXT NOT NULL,
        client_name TEXT NOT NULL DEFAULT '',
        client_id TEXT,
        primary_contact_name TEXT NOT NULL DEFAULT '',
        primary_contact_email TEXT NOT NULL DEFAULT '',
        prepared_for_name TEXT NOT NULL DEFAULT '',
        prepared_for_email TEXT NOT NULL DEFAULT '',
        prepared_by_user_id TEXT,
        opportunity_id TEXT,
        engagement_id TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        proposal_type TEXT NOT NULL DEFAULT 'security_assessment',
        test_types TEXT NOT NULL DEFAULT '[]',
        proposal_metadata TEXT NOT NULL DEFAULT '{}',
        valid_until INTEGER,
        estimated_days REAL,
        quoted_value REAL,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS reporter_proposal_sections (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        title TEXT NOT NULL,
        section_type TEXT NOT NULL DEFAULT 'markdown',
        content TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        is_included INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (proposal_id) REFERENCES reporter_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS reporter_proposal_generations (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        filename TEXT,
        file_path TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER,
        error_message TEXT,
        FOREIGN KEY (proposal_id) REFERENCES reporter_proposals(id)
      );

      CREATE TABLE IF NOT EXISTS reporter_proposal_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        template_type TEXT NOT NULL DEFAULT 'security_assessment',
        html_template TEXT NOT NULL DEFAULT '',
        css_template TEXT NOT NULL DEFAULT '',
        metadata_schema TEXT NOT NULL DEFAULT '{}',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS reporter_proposal_template_sections (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        title TEXT NOT NULL,
        section_type TEXT NOT NULL DEFAULT 'markdown',
        content TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL DEFAULT 0,
        is_required INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (template_id) REFERENCES reporter_proposal_templates(id)
      );

      CREATE TABLE IF NOT EXISTS reporter_test_type_templates (
        id TEXT PRIMARY KEY,
        test_type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        methodology_writeup TEXT NOT NULL DEFAULT '',
        scope_guidance TEXT NOT NULL DEFAULT '',
        deliverables TEXT NOT NULL DEFAULT '',
        client_requirements TEXT NOT NULL DEFAULT '',
        consultant_requirements TEXT NOT NULL DEFAULT '',
        assumptions TEXT NOT NULL DEFAULT '',
        restrictions TEXT NOT NULL DEFAULT '',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_proposals_status ON reporter_proposals(status);
      CREATE INDEX IF NOT EXISTS idx_proposals_opportunity ON reporter_proposals(opportunity_id);
      CREATE INDEX IF NOT EXISTS idx_proposals_engagement ON reporter_proposals(engagement_id);
      CREATE INDEX IF NOT EXISTS idx_proposal_sections_proposal ON reporter_proposal_sections(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_proposal_gens_proposal ON reporter_proposal_generations(proposal_id);
      CREATE INDEX IF NOT EXISTS idx_proposal_template_sections ON reporter_proposal_template_sections(template_id);
      CREATE INDEX IF NOT EXISTS idx_test_type_templates_type ON reporter_test_type_templates(test_type);
    `);
  },
};
