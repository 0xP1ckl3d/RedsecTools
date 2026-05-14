const DEFAULT_SECTION_CONTENT = [
  {
    title: "Cover / Introduction",
    content: [
      "# {{title}}",
      "",
      "Prepared for **{{client_name}}**",
      "",
      "**Prepared by:** {{prepared_by_name}}",
      "",
      "**Date:** {{date}}",
    ].join("\n"),
  },
  {
    title: "Client and Contacts",
    content: [
      "## Client and Contacts",
      "",
      "| Field | Detail |",
      "|-------|--------|",
      "| Client | {{client_name}} |",
      "| Primary contact | {{primary_contact_name}} |",
      "| Primary contact email | {{primary_contact_email}} |",
      "| Prepared by | {{prepared_by_name}} |",
    ].join("\n"),
  },
  {
    title: "Out of Scope",
    content: [
      "## Out of Scope",
      "",
      "The following activities and assets are excluded unless separately authorised in writing:",
      "",
      "- Denial-of-service, stress, load, or destructive testing.",
      "- Social engineering, phishing, physical access testing, or third-party testing unless explicitly scoped.",
      "- Modification, deletion, or extraction of production data beyond what is required to safely evidence a finding.",
      "- Assets, accounts, networks, applications, or cloud resources not listed in the authorised target set.",
    ].join("\n"),
  },
  {
    title: "Time Allocation",
    content: [
      "## Time Allocation",
      "",
      "| Phase | Days | Notes |",
      "|-------|------|-------|",
      "| Scoping and planning | {{scoping_days}} | Kick-off, access validation, final target confirmation, and rules of engagement alignment. |",
      "| Testing | {{testing_days}} | Manual assessment, targeted automation, exploit validation, evidence capture, and daily progress management. |",
      "| Analysis and reporting | {{reporting_days}} | Finding validation, report drafting, QA, and delivery preparation. |",
      "| **Total** | **{{estimated_days}}** | Estimated consultant effort for the proposed scope. |",
    ].join("\n"),
  },
  {
    title: "Delivery Schedule",
    content: [
      "## Delivery Schedule",
      "",
      "| Milestone | Target Date |",
      "|-----------|-------------|",
      "| Testing start | {{start_date}} |",
      "| Testing end | {{end_date}} |",
      "| Draft report | {{draft_date}} |",
      "| Final report | {{final_date}} |",
      "",
      "Dates are subject to timely access, scope confirmation, and availability of required client contacts.",
    ].join("\n"),
  },
  {
    title: "Acceptance and Next Steps",
    content: [
      "## Acceptance and Next Steps",
      "",
      "To proceed with the engagement:",
      "",
      "1. Confirm acceptance of this proposal and commercial terms.",
      "2. Provide the authorised target list, access requirements, and escalation contacts.",
      "3. Schedule the kick-off meeting and confirm the testing window.",
      "4. Complete access validation before testing begins.",
      "5. Commence testing in line with the agreed rules of engagement.",
    ].join("\n"),
  },
];

module.exports = {
  id: "022_reporter_proposal_section_format_repair",
  description: "Repair literal newline escapes and improve remaining built-in proposal section defaults.",
  up(db) {
    const templateId = "builtin-proposal-default";
    const updateTemplate = db.prepare(`
      UPDATE reporter_proposal_template_sections
      SET content = ?, updated_at = unixepoch()
      WHERE template_id = ? AND title = ?
    `);

    for (const section of DEFAULT_SECTION_CONTENT) {
      updateTemplate.run(section.content, templateId, section.title);
    }

    const sectionTables = ["reporter_proposal_template_sections", "reporter_proposal_sections"];
    for (const table of sectionTables) {
      const rows = db.prepare(`SELECT id, content FROM ${table}`).all()
        .filter((row) => String(row.content || "").includes("\\n"));
      const update = db.prepare(`UPDATE ${table} SET content = ?, updated_at = unixepoch() WHERE id = ?`);
      for (const row of rows) {
        update.run(String(row.content || "").replace(/\\n/g, "\n"), row.id);
      }
    }
  },
};
