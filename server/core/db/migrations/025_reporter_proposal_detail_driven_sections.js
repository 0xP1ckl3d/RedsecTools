const DETAIL_DRIVEN_SECTIONS = [
  {
    title: "Client and Contacts",
    content: [
      "## Client",
      "",
      "**{{client_name}}**",
      "",
      "**Primary Contact:** {{primary_contact_name}}{% if primary_contact_email %} ({{primary_contact_email}}){% endif %}",
      "",
      "## Prepared By",
      "",
      "{{prepared_by_name}}",
    ].join("\n"),
  },
  {
    title: "Time Allocation",
    content: [
      "## Time Allocation",
      "",
      "{{time_allocation_table}}",
    ].join("\n"),
  },
  {
    title: "Delivery Schedule",
    content: [
      "## Delivery Schedule",
      "",
      "- **Testing Start:** {{start_date}}",
      "- **Testing End:** {{end_date}}",
      "- **Draft Report:** {{draft_date}}",
      "- **Final Report:** {{final_date}}",
    ].join("\n"),
  },
];

module.exports = {
  id: "025_reporter_proposal_detail_driven_sections",
  description: "Make built-in proposal sections render from proposal details and calculated allocations.",
  up(db) {
    const updateTemplate = db.prepare(`
      UPDATE reporter_proposal_template_sections
      SET content = ?, updated_at = unixepoch()
      WHERE template_id = 'builtin-proposal-default' AND title = ?
    `);
    const updateExisting = db.prepare(`
      UPDATE reporter_proposal_sections
      SET content = ?, updated_at = unixepoch()
      WHERE title = ? AND content LIKE ?
    `);

    for (const section of DETAIL_DRIVEN_SECTIONS) {
      updateTemplate.run(section.content, section.title);
      updateExisting.run(section.content, section.title, "%{{%");
    }
  },
};
