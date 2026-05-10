module.exports = {
  id: "015_engage_proposal_link",
  description:
    "Add reporter_proposal_id to engage_opportunities for first-class proposal linking. Deprecate proposal_reporter_doc_id.",
  up(db) {
    db.prepare(
      `ALTER TABLE engage_opportunities ADD COLUMN reporter_proposal_id TEXT`
    ).run();
  },
};
