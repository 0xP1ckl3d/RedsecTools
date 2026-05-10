module.exports = {
  id: "014_cleanup_old_proposal_designs",
  description:
    "Remove old proposal-type designs seeded by migration 009. Proposals are now first-class records in reporter_proposals.",
  up(db) {
    db.prepare(
      `DELETE FROM reporter_designs WHERE project_type = 'proposal' AND is_builtin = 1`
    ).run();
  },
};
