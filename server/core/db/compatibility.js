function runLegacyCompatibilityPatches(db) {
// Legacy paste/share schemas from the original app did not have the later
// password/link ownership columns. Keep these additive until the compatibility
// surface is fully replaced by tracked migrations.
try { db.exec("ALTER TABLE pastes ADD COLUMN iv_password BLOB"); } catch {}
try { db.exec("ALTER TABLE pastes ADD COLUMN salt BLOB"); } catch {}
try { db.exec("ALTER TABLE pastes ADD COLUMN user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE pastes ADD COLUMN guest_invited_by TEXT"); } catch {}
try { db.exec("ALTER TABLE shares ADD COLUMN salt BLOB"); } catch {}
try { db.exec("ALTER TABLE shares ADD COLUMN burned INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE shares ADD COLUMN user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE shares ADD COLUMN guest_invited_by TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN full_name TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role_id TEXT"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0"); } catch {}
// Add avatar column to users table (safe migration)
try { db.exec("ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN role_id TEXT"); } catch {}
try { db.exec("ALTER TABLE invites ADD COLUMN role_id TEXT"); } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN edited_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE messages ADD COLUMN deleted_at INTEGER"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at)"); } catch {}

// Add needs_rekey column to vault_members (safe migration)
try { db.exec("ALTER TABLE vault_members ADD COLUMN needs_rekey INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE vault_members ADD COLUMN can_write INTEGER NOT NULL DEFAULT 1"); } catch {}
try { db.exec("ALTER TABLE vault_members ADD COLUMN can_manage_members INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("UPDATE vault_members SET can_write = 1 WHERE can_write IS NULL"); } catch {}
try { db.exec("UPDATE vault_members SET can_manage_members = CASE WHEN role = 'admin' THEN 1 ELSE 0 END WHERE can_manage_members IS NULL OR can_manage_members NOT IN (0, 1)"); } catch {}
try { db.exec("ALTER TABLE mfa_pending_logins ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN description TEXT"); } catch {}
try { db.exec("ALTER TABLE homepage_shortcuts ADD COLUMN icon_url TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN code TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN client_name TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN project_type TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN starts_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN ends_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_mode TEXT NOT NULL DEFAULT 'hours'"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_value REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN estimated_hours INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN billable_rate REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE calendar_projects ADD COLUMN notes TEXT"); } catch {}
try { db.exec("ALTER TABLE calendar_entries ADD COLUMN scheduled_hours REAL NOT NULL DEFAULT 0"); } catch {}
try { db.exec("UPDATE calendar_entries SET scheduled_hours = ROUND((ends_at - starts_at) / 3600.0, 2) WHERE project_id IS NOT NULL AND (scheduled_hours IS NULL OR scheduled_hours = 0) AND ends_at > starts_at"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN excerpt TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN scope TEXT NOT NULL DEFAULT 'team'"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN owner_id TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN last_editor_id TEXT"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN published_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE wiki_pages ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE wiki_page_revisions ADD COLUMN excerpt TEXT"); } catch {}
try { db.exec("UPDATE wiki_pages SET excerpt = substr(replace(replace(body_markdown, char(13), ' '), char(10), ' '), 1, 220) WHERE excerpt IS NULL OR excerpt = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET scope = 'team' WHERE scope IS NULL OR scope = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET last_editor_id = author_id WHERE last_editor_id IS NULL OR last_editor_id = ''"); } catch {}
try { db.exec("UPDATE wiki_pages SET published_at = coalesce(updated_at, created_at) WHERE published_at IS NULL OR published_at = 0"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_wiki_pages_scope_owner ON wiki_pages(scope, owner_id, updated_at)"); } catch {}

try { db.exec("ALTER TABLE threat_alerts ADD COLUMN article_url TEXT"); } catch {}
try { db.exec("ALTER TABLE threat_alerts ADD COLUMN user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE threat_articles ADD COLUMN image_url TEXT"); } catch {}
try { db.exec("ALTER TABLE threat_articles ADD COLUMN published_at INTEGER"); } catch {}
try { db.exec("ALTER TABLE threat_articles ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())"); } catch {}
try { db.exec("ALTER TABLE threat_keywords ADD COLUMN user_id TEXT"); } catch {}
try { db.exec("ALTER TABLE threat_tags ADD COLUMN user_id TEXT"); } catch {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS threat_user_keyword_disabled (
    user_id TEXT NOT NULL,
    keyword_id TEXT NOT NULL,
    PRIMARY KEY (user_id, keyword_id)
  )
`); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_threat_alerts_user ON threat_alerts(user_id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_threat_keywords_user ON threat_keywords(user_id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_threat_tags_user ON threat_tags(user_id)"); } catch {}

function migrateThreatScopedTables() {
  const keywordSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threat_keywords'").get()?.sql || "";
  if (/keyword\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(keywordSql)) {
    db.exec(`
      BEGIN;
      ALTER TABLE threat_keywords RENAME TO threat_keywords_legacy;
      CREATE TABLE threat_keywords (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        is_regex INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        criticality TEXT NOT NULL DEFAULT 'medium' CHECK(criticality IN ('low','medium','high','critical')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        user_id TEXT
      );
      INSERT INTO threat_keywords (id, keyword, case_sensitive, is_regex, enabled, criticality, created_at, updated_at, user_id)
      SELECT id, keyword, case_sensitive, is_regex, enabled, criticality, created_at, updated_at, user_id
      FROM threat_keywords_legacy;
      DROP TABLE threat_keywords_legacy;
      CREATE INDEX IF NOT EXISTS idx_threat_keywords_enabled ON threat_keywords(enabled);
      CREATE INDEX IF NOT EXISTS idx_threat_keywords_user ON threat_keywords(user_id);
      COMMIT;
    `);
  }

  const tagSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threat_tags'").get()?.sql || "";
  if (/name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tagSql)) {
    db.exec(`
      BEGIN;
      ALTER TABLE threat_tags RENAME TO threat_tags_legacy;
      CREATE TABLE threat_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#E53935',
        description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        user_id TEXT
      );
      INSERT INTO threat_tags (id, name, color, description, created_at, user_id)
      SELECT id, name, color, description, created_at, user_id
      FROM threat_tags_legacy;
      DROP TABLE threat_tags_legacy;
      CREATE INDEX IF NOT EXISTS idx_threat_tags_user ON threat_tags(user_id);
      COMMIT;
    `);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_keywords_system_unique
      ON threat_keywords(keyword) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_keywords_user_unique
      ON threat_keywords(user_id, keyword) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_tags_system_unique
      ON threat_tags(name) WHERE user_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_tags_user_unique
      ON threat_tags(user_id, name) WHERE user_id IS NOT NULL;
  `);
}

migrateThreatScopedTables();

// Per-user favourite shortcuts (junction table — works for personal AND team shortcuts)
db.exec(`CREATE TABLE IF NOT EXISTS user_favourite_shortcuts (
  user_id TEXT NOT NULL,
  shortcut_id TEXT NOT NULL,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, shortcut_id)
)`);


}

module.exports = {
  runLegacyCompatibilityPatches,
};
