module.exports = {
  id: "019_engage_qa_completion_semantics",
  description: "Treat Engage QA as completed only when delivered or cancelled.",
  up(db) {
    db.prepare(`
      UPDATE engage_qa_reviews
      SET completed_at = NULL
      WHERE status = 'ready_for_delivery'
    `).run();
  },
};
