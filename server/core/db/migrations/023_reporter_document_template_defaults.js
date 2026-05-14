module.exports = {
  id: "023_reporter_document_template_defaults",
  description: "Refresh built-in Reporter proposal and report document templates with the current defaults.",
  up(db) {
    const {
      defaultProposalCss,
      defaultProposalHtml,
      defaultReportCss,
      defaultReportHtml,
    } = require("../../../reporter-default-templates");

    db.prepare(`
      UPDATE reporter_proposal_templates
      SET html_template = ?, css_template = ?, updated_at = unixepoch()
      WHERE id = 'builtin-proposal-default' AND is_builtin = 1
    `).run(defaultProposalHtml, defaultProposalCss);

    db.prepare(`
      UPDATE reporter_designs
      SET html_template = ?, css_template = ?, updated_at = unixepoch()
      WHERE id = 'builtin-redsec-default' AND is_builtin = 1
    `).run(defaultReportHtml, defaultReportCss);
  },
};
