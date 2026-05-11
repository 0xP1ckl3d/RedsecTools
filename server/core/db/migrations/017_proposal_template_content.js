module.exports = {
  id: "017_proposal_template_content",
  description: "Populate html_template and css_template on the built-in proposal template with defaults.",
  up(db) {
    const { defaultProposalHtmlTemplate, defaultProposalCssTemplate } = require("../../../reporter-render-service");
    db.prepare(`
      UPDATE reporter_proposal_templates
      SET html_template = ?, css_template = ?, updated_at = unixepoch()
      WHERE id = 'builtin-proposal-default' AND (html_template IS NULL OR html_template = '')
    `).run(defaultProposalHtmlTemplate(), defaultProposalCssTemplate());
  },
};
