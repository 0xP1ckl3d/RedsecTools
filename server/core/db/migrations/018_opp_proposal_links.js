module.exports = {
  id: "018_opp_proposal_links",
  description: "Create junction table for multiple proposal links per opportunity.",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS engage_opportunity_proposals (
        opportunity_id TEXT NOT NULL,
        reporter_proposal_id TEXT NOT NULL,
        linked_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (opportunity_id, reporter_proposal_id)
      );
    `);
    // Migrate existing single-link data into the junction table
    const rows = db.prepare("SELECT id, reporter_proposal_id FROM engage_opportunities WHERE reporter_proposal_id IS NOT NULL").all();
    const insert = db.prepare("INSERT OR IGNORE INTO engage_opportunity_proposals (opportunity_id, reporter_proposal_id) VALUES (?, ?)");
    for (const r of rows) {
      insert.run(r.id, r.reporter_proposal_id);
    }
  },
};
