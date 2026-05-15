const COMMERCIAL_TERMS_CONTENT = [
  "## Commercial Terms",
  "",
  "Item | Value",
  "-----|------",
  "Estimated effort | {{estimated_days}} days",
  "Total fee | {{quoted_value}}",
  "Proposal valid until | {{valid_until}}",
  "",
  "Fees are based on the scope, assumptions, and access model described in this proposal. Material scope changes, delayed access, or additional testing requirements may require a revised estimate.",
].join("\n");

module.exports = {
  id: "029_reporter_proposal_commercial_terms_table",
  description: "Repair Commercial Terms proposal tables to use no-outer-pipe markdown like Time Allocation.",
  up(db) {
    db.prepare(`
      UPDATE reporter_proposal_template_sections
      SET content = ?, updated_at = unixepoch()
      WHERE template_id = 'builtin-proposal-default'
        AND title = 'Commercial Terms'
    `).run(COMMERCIAL_TERMS_CONTENT);

    db.prepare(`
      UPDATE reporter_proposal_sections
      SET content = ?, updated_at = unixepoch()
      WHERE title = 'Commercial Terms'
        AND (
          content LIKE '%| Item | Value |%'
          OR content LIKE '%**Total Fee:**%'
          OR content LIKE '%Proposal valid until%'
        )
    `).run(COMMERCIAL_TERMS_CONTENT);
  },
};
