module.exports = {
  id: "009_reporter_proposals",
  description: "Add project_type to Reporter tables and seed proposal templates for RedSecEngage.",
  up(db) {
    const now = Math.floor(Date.now() / 1000);

    db.prepare("ALTER TABLE reporter_projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'report'").run();
    db.prepare("ALTER TABLE reporter_designs ADD COLUMN project_type TEXT NOT NULL DEFAULT 'report'").run();

    // Seed 10 proposal designs
    const proposalDesigns = [
      {
        id: "builtin-proposal-internal",
        name: "Internal Penetration Test Proposal",
        reportType: "internal",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-external",
        name: "External Penetration Test Proposal",
        reportType: "external",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-webapp",
        name: "Web Application Penetration Test Proposal",
        reportType: "webapp",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-cloud",
        name: "Cloud Security Review Proposal",
        reportType: "cloud",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-build",
        name: "Build Review Proposal",
        reportType: "build",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-redteam",
        name: "Red Team Assessment Proposal",
        reportType: "redteam",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "rules_of_engagement", label: "Rules of Engagement", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-wireless",
        name: "Wireless Assessment Proposal",
        reportType: "wireless",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-config",
        name: "Configuration Review Proposal",
        reportType: "config",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-assumed-breach",
        name: "Assumed Breach Assessment Proposal",
        reportType: "custom",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "rules_of_engagement", label: "Rules of Engagement", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
      {
        id: "builtin-proposal-generic",
        name: "Generic Security Assessment Proposal",
        reportType: "custom",
        sectionDefs: [
          { name: "cover", label: "Cover Page", type: "executive_summary" },
          { name: "scope", label: "Scope of Work", type: "scope" },
          { name: "methodology", label: "Approach & Methodology", type: "methodology" },
          { name: "timeline", label: "Timeline & Deliverables", type: "recommendations" },
          { name: "commercial", label: "Commercial Terms", type: "recommendations" },
          { name: "acceptance", label: "Acceptance", type: "recommendations" },
        ],
      },
    ];

    const insertDesign = db.prepare(
      `INSERT OR IGNORE INTO reporter_designs
        (id, name, description, report_type, html_template, css_template,
         field_definitions, section_definitions, finding_field_definitions,
         finding_ordering_rule, finding_grouping_rule, is_builtin, sort_order,
         project_type, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', '[]', ?, '[]', 'severity_desc', NULL, 1, ?, 'proposal', NULL, ?, ?)`
    );

    let sortOrder = 100;
    for (const d of proposalDesigns) {
      insertDesign.run(
        d.id,
        d.name,
        d.name + " template for RedSecEngage proposals.",
        d.reportType,
        JSON.stringify(d.sectionDefs),
        sortOrder++,
        now,
        now
      );
    }
  },
};
