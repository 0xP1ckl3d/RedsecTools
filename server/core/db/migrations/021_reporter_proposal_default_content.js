module.exports = {
  id: "021_reporter_proposal_default_content",
  description: "Improve built-in Reporter proposal section defaults and keep service write-up placeholders aligned.",
  up(db) {
    const templateId = "builtin-proposal-default";
    const sections = [
      {
        title: "Understanding of Requirements",
        content: [
          "## Understanding of Requirements",
          "",
          "RedSec will perform a security assessment designed to identify exploitable weaknesses, validate practical risk, and provide remediation guidance that can be actioned by technical and management stakeholders.",
          "",
          "The engagement objectives are:",
          "",
          "- Validate the security posture of the agreed in-scope systems.",
          "- Identify vulnerabilities that could lead to unauthorised access, data exposure, privilege escalation, or operational disruption.",
          "- Provide clear evidence, business impact, and remediation guidance for each confirmed issue.",
          "- Support prioritisation by explaining realistic attack paths and affected assets.",
        ].join("\n"),
      },
      {
        title: "Proposed Services",
        content: [
          "## Proposed Services",
          "",
          "The following services are proposed based on the selected assessment types. Each service write-up is populated from the managed RedSecReporter test type library so proposal language remains consistent across engagements.",
          "",
          "{{test_type_inserts}}",
        ].join("\n"),
      },
      {
        title: "Scope of Work",
        content: [
          "## Scope of Work",
          "",
          "### In Scope",
          "",
          "- Agreed applications, hosts, cloud assets, network ranges, accounts, or environments supplied during scoping.",
          "- Supporting authentication, authorisation, session management, exposed services, and integration points relevant to the selected test types.",
          "- Manual validation of meaningful findings, supported by automated discovery where appropriate.",
          "",
          "### Authorised Targets",
          "",
          "The final authorised target list must be confirmed before testing begins. Assets not explicitly authorised are excluded from testing.",
          "",
          "### Testing Window",
          "",
          "Testing will be performed during the agreed engagement window and coordinated through the nominated client contact.",
        ].join("\n"),
      },
      {
        title: "Methodology",
        content: [
          "## Methodology",
          "",
          "RedSec combines manual testing, targeted automation, and consultant-led analysis. Testing is risk-focused and evidence-led rather than a scan-only activity.",
          "",
          "The methodology typically includes:",
          "",
          "1. Kick-off, access validation, and rules of engagement confirmation.",
          "2. Reconnaissance and attack surface mapping for the authorised scope.",
          "3. Vulnerability discovery using manual techniques and controlled tooling.",
          "4. Exploit validation where safe and authorised.",
          "5. Impact analysis, attack path development, and evidence capture.",
          "6. Reporting, quality review, and delivery of remediation guidance.",
          "",
          "Relevant industry references may include OWASP, PTES, NIST SP 800-115, CIS benchmarks, MITRE ATT&CK, and vendor-specific security guidance.",
        ].join("\n"),
      },
      {
        title: "Rules of Engagement and Restrictions",
        content: [
          "## Rules of Engagement",
          "",
          "### Authorised Actions",
          "",
          "- Perform security testing only against confirmed in-scope assets.",
          "- Attempt controlled exploitation where it is necessary to validate risk.",
          "- Capture evidence required to support findings without collecting unnecessary sensitive data.",
          "",
          "### Restricted Actions",
          "",
          "- Denial-of-service, destructive testing, persistence, data deletion, or production data modification unless explicitly authorised in writing.",
          "- Testing of third-party systems without written confirmation of authorisation.",
          "- Social engineering, physical security testing, or phishing unless explicitly included in scope.",
          "",
          "### Deconfliction",
          "",
          "The client will provide an escalation contact for urgent issues, service impact, suspected real-world compromise, or scope clarification.",
        ].join("\n"),
      },
      {
        title: "Client Responsibilities and Prerequisites",
        content: [
          "## Client Responsibilities",
          "",
          "The following prerequisites are generated from the selected test type write-ups and should be confirmed before testing starts.",
          "",
          "{{client_requirements_insert}}",
        ].join("\n"),
      },
      {
        title: "Consultant Requirements",
        content: [
          "## Consultant Requirements",
          "",
          "The following consultant-side requirements are generated from the selected test type write-ups and help ensure the delivery team has the correct access, tooling, and operating assumptions.",
          "",
          "{{consultant_requirements_insert}}",
        ].join("\n"),
      },
      {
        title: "Deliverables",
        content: [
          "## Deliverables",
          "",
          "RedSec will provide a final report suitable for both technical remediation and management review. Deliverables typically include:",
          "",
          "- Executive summary describing overall risk, key themes, and prioritised recommendations.",
          "- Technical findings with evidence, affected assets, impact, likelihood, severity, and remediation guidance.",
          "- Reproduction notes and proof-of-concept detail where appropriate and safe to disclose.",
          "- Retest guidance and optional retest outcome tracking if included in the engagement.",
          "- Debrief session to walk through findings, answer questions, and agree remediation priorities.",
        ].join("\n"),
      },
      {
        title: "Commercial Terms",
        content: [
          "## Commercial Terms",
          "",
          "Item | Value",
          "-----|------",
          "Estimated effort | {{estimated_days}} days",
          "Total fee | {{quoted_value}}",
          "Proposal valid until | {{valid_until}}",
          "",
          "Fees are based on the scope, assumptions, and access model described in this proposal. Material scope changes, delayed access, or additional testing requirements may require a revised estimate.",
        ].join("\n"),
      },
    ];

    const update = db.prepare(`
      UPDATE reporter_proposal_template_sections
      SET content = ?, updated_at = unixepoch()
      WHERE template_id = ? AND title = ?
    `);
    for (const section of sections) {
      update.run(section.content, templateId, section.title);
    }
  },
};
