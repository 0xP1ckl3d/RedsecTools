module.exports = {
  id: "008_engage_core",
  description: "Create RedSecEngage core tables: clients, contacts, opportunities, engagements, team members, QA reviews, notes, and activity log.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS engage_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        industry TEXT,
        website TEXT,
        account_owner_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'prospect',
        notes TEXT NOT NULL DEFAULT '',
        default_billing_contact_id TEXT,
        default_technical_contact_id TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_engage_clients_status ON engage_clients(status);
      CREATE INDEX IF NOT EXISTS idx_engage_clients_owner ON engage_clients(account_owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_engage_clients_name ON engage_clients(name);

      CREATE TABLE IF NOT EXISTS engage_client_contacts (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT,
        email TEXT,
        phone TEXT,
        contact_type TEXT NOT NULL DEFAULT 'other',
        is_primary INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_engage_contacts_client ON engage_client_contacts(client_id);

      CREATE TABLE IF NOT EXISTS engage_opportunities (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        title TEXT NOT NULL,
        opportunity_type TEXT NOT NULL DEFAULT 'custom',
        stage TEXT NOT NULL DEFAULT 'lead',
        estimated_value REAL,
        quoted_value REAL,
        estimated_days REAL,
        probability_percent INTEGER,
        expected_start_date TEXT,
        expected_decision_date TEXT,
        proposal_reporter_doc_id TEXT,
        proposal_pdf_generation_id TEXT,
        owner_user_id TEXT,
        created_by TEXT,
        lost_reason TEXT,
        rejected_reason TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        closed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_engage_opps_client ON engage_opportunities(client_id);
      CREATE INDEX IF NOT EXISTS idx_engage_opps_stage ON engage_opportunities(stage);
      CREATE INDEX IF NOT EXISTS idx_engage_opps_owner ON engage_opportunities(owner_user_id);

      CREATE TABLE IF NOT EXISTS engage_engagements (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        opportunity_id TEXT,
        title TEXT NOT NULL,
        engagement_type TEXT NOT NULL DEFAULT 'custom',
        status TEXT NOT NULL DEFAULT 'draft',
        priority TEXT NOT NULL DEFAULT 'normal',
        commercial_value REAL,
        estimated_days REAL,
        scheduled_start_date TEXT,
        scheduled_end_date TEXT,
        actual_start_date TEXT,
        actual_end_date TEXT,
        engagement_manager_user_id TEXT,
        technical_lead_user_id TEXT,
        redseccal_project_id TEXT,
        redsec_reporter_project_id TEXT,
        proposal_reporter_doc_id TEXT,
        delivery_reporter_project_id TEXT,
        high_level_scope_summary TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        closed_at INTEGER,
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_engage_engagements_client ON engage_engagements(client_id);
      CREATE INDEX IF NOT EXISTS idx_engage_engagements_status ON engage_engagements(status);
      CREATE INDEX IF NOT EXISTS idx_engage_engagements_manager ON engage_engagements(engagement_manager_user_id);
      CREATE INDEX IF NOT EXISTS idx_engage_engagements_lead ON engage_engagements(technical_lead_user_id);
      CREATE INDEX IF NOT EXISTS idx_engage_engagements_opportunity ON engage_engagements(opportunity_id);

      CREATE TABLE IF NOT EXISTS engage_engagement_members (
        id TEXT PRIMARY KEY,
        engagement_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'tester',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(engagement_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_engage_members_engagement ON engage_engagement_members(engagement_id);
      CREATE INDEX IF NOT EXISTS idx_engage_members_user ON engage_engagement_members(user_id);

      CREATE TABLE IF NOT EXISTS engage_qa_reviews (
        id TEXT PRIMARY KEY,
        engagement_id TEXT NOT NULL,
        reporter_project_id TEXT,
        assigned_by_user_id TEXT,
        assigned_to_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'not_requested',
        qa_notes TEXT NOT NULL DEFAULT '',
        report_link TEXT,
        share_link TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_engage_qa_engagement ON engage_qa_reviews(engagement_id);
      CREATE INDEX IF NOT EXISTS idx_engage_qa_assignee ON engage_qa_reviews(assigned_to_user_id);
      CREATE INDEX IF NOT EXISTS idx_engage_qa_status ON engage_qa_reviews(status);

      CREATE TABLE IF NOT EXISTS engage_notes (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_engage_notes_entity ON engage_notes(entity_type, entity_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS engage_activity (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_engage_activity_entity ON engage_activity(entity_type, entity_id, created_at DESC);
    `);
  },
};
