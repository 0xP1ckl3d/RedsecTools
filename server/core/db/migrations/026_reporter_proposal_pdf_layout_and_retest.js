module.exports = {
  id: "026_reporter_proposal_pdf_layout_and_retest",
  description: "Refresh proposal PDF defaults for linked TOC, flowing sections, no renderer footer, and retest allocations.",
  up(db) {
    const {
      defaultProposalCss,
      defaultProposalHtml,
    } = require("../../../reporter-default-templates");

    db.prepare(`
      UPDATE reporter_proposal_templates
      SET html_template = ?, css_template = ?, updated_at = unixepoch()
      WHERE id = 'builtin-proposal-default' AND is_builtin = 1
    `).run(defaultProposalHtml, defaultProposalCss);
  },
};
