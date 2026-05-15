module.exports = {
  id: "028_reporter_proposal_identity_and_section_cleanup",
  description: "Refresh proposal defaults for clean section titles, professional identity fields, and safe detail-driven previews.",
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

    db.prepare(`
      UPDATE reporter_proposal_template_sections
      SET title = 'Introduction',
          content = 'Prepared for **{{client_name}}**\n\n**Prepared by:** {{prepared_by_name}}{% if prepared_by_email %} ({{prepared_by_email}}){% endif %}\n\n**Date:** {{date}}',
          updated_at = unixepoch()
      WHERE template_id = 'builtin-proposal-default'
        AND title = 'Cover / Introduction'
    `).run();
  },
};
