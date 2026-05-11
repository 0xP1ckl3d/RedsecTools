const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");
const puppeteer = require("puppeteer-core");
const { renderMarkdownToHtml } = require("./wiki-render");

const REPORTER_PDF_DIR = path.join(__dirname, "..", "data", "reporter-pdfs");
const DEFAULT_TIMEOUT_MS = parseInt(process.env.REPORTER_PDF_TIMEOUT_MS, 10) || 120000;

function ensureReporterPdfDir() {
  fs.mkdirSync(REPORTER_PDF_DIR, { recursive: true });
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value, style) {
  if (!value) return "";
  let date;
  if (typeof value === "number") {
    date = new Date(value * 1000);
  } else if (typeof value === "string") {
    date = new Date(value);
  } else {
    date = value;
  }
  if (isNaN(date.getTime())) return String(value);
  if (style === "long") {
    return date.toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" });
  }
  if (style === "short") {
    return date.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
  }
  return date.toLocaleDateString();
}

function defaultHtmlTemplate() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{ report.title }}</title>
  {% if cssHref %}
  <link rel="stylesheet" href="{{ cssHref }}">
  {% else %}
  <style>{{ css | safe }}</style>
  {% endif %}
</head>
<body>

  <!-- COVER PAGE -->
  <section class="page-cover">
    <div class="cover-header">
      <div class="company-logo-text">RedSec</div>
    </div>
    <div class="cover-content">
      <h1 class="cover-title">Penetration Testing Report</h1>
      <div class="cover-subtitle">{{ report.title }}</div>
      <div class="cover-details">
        {% if report.customer %}
        <div class="detail-group detail-group-customer">
          <div class="detail-row">
            <span class="detail-label">Customer:</span>
            <span class="detail-value">{{ report.customer }}</span>
          </div>
          {% if report.customer_name %}
          <div class="detail-row">
            <span class="detail-label"></span>
            <span class="detail-value">{{ report.customer_name }}</span>
          </div>
          {% endif %}
          {% if report.position_title %}
          <div class="detail-row">
            <span class="detail-label"></span>
            <span class="detail-value">{{ report.position_title }}</span>
          </div>
          {% endif %}
        </div>
        {% endif %}

        {% if report.author %}
        <div class="detail-group detail-group-author">
          <div class="detail-row">
            <span class="detail-label">Author:</span>
            <span class="detail-value">{{ report.author }}</span>
          </div>
          {% if report.author_title %}
          <div class="detail-row">
            <span class="detail-label"></span>
            <span class="detail-value">{{ report.author_title }}</span>
          </div>
          {% endif %}
        </div>
        {% endif %}

        <div class="detail-group detail-group-meta">
          {% if report.version %}
          <div class="detail-row">
            <span class="detail-label">Version:</span>
            <span class="detail-value">{{ report.version }}</span>
          </div>
          {% endif %}
          {% if report.report_date %}
          <div class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">{{ report.report_date }}</span>
          </div>
          {% endif %}
        </div>
      </div>
    </div>
  </section>

  <div class="page-break"></div>

  <!-- TABLE OF CONTENTS -->
  <section id="page-toc">
    <h1>Table of Contents</h1>
    <ul class="toc-list">
      {% for item in toc_items %}
      <li class="toc-level{{ item.level }}">{{ item.title }}</li>
      {% endfor %}
    </ul>
  </section>

  <div class="page-break"></div>

  <!-- EXECUTIVE SUMMARY -->
  <section id="executive-summary">
    <h1 class="in-toc numbered">Executive Summary</h1>
    {% if report.customer and report.duration %}
    <div>
      The penetration test for {{ report.customer }} was conducted over <b>{{ report.duration }}</b> days{% if report.start_date %}, commencing on {{ report.start_date }}{% endif %}{% if report.end_date %} and concluding {{ report.end_date }}{% endif %}.
    </div>
    <br>
    {% endif %}
    {% if report.executive_summary_html %}
    <div>{{ report.executive_summary_html | safe }}</div>
    {% endif %}

    <h2 class="in-toc numbered">Findings Summary</h2>
    <div>
      In total, there were <b>{{ findings | length }}</b> security vulnerabilities identified during the assessment.
    </div>

    <table class="severity-summary">
      <thead>
        <tr>
          <th>Severity</th>
          <th>Count</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="severity-cell critical">Critical</td>
          <td>{{ severity_counts.critical }}</td>
          <td>Immediate and severe risk</td>
        </tr>
        <tr>
          <td class="severity-cell high">High</td>
          <td>{{ severity_counts.high }}</td>
          <td>Significant risk</td>
        </tr>
        <tr>
          <td class="severity-cell medium">Medium</td>
          <td>{{ severity_counts.medium }}</td>
          <td>Moderate risk</td>
        </tr>
        <tr>
          <td class="severity-cell low">Low</td>
          <td>{{ severity_counts.low }}</td>
          <td>Minor risk</td>
        </tr>
        <tr>
          <td class="severity-cell info">Informational</td>
          <td>{{ severity_counts.info }}</td>
          <td>Non-impacting observations</td>
        </tr>
      </tbody>
    </table>

    {% if report.scope_html %}
    <h2 class="in-toc numbered">Scope</h2>
    <div>The following items were in scope for this test:</div>
    <div>{{ report.scope_html | safe }}</div>
    {% endif %}
    {% if report.out_of_scope_html %}
    <div>The following items were explicitly out of scope for this test:</div>
    <div>{{ report.out_of_scope_html | safe }}</div>
    {% endif %}
  </section>

  <div class="page-break"></div>

  <!-- FINDINGS -->
  <section id="findings">
    <h1 class="in-toc numbered">Findings</h1>
    {% for finding in findings %}
    <div class="finding{% if not loop.first %} finding-break{% endif %}">
      <div class="finding-inner">
        <div class="finding-header">
          <h2 class="finding-title in-toc numbered">{{ finding.title }}</h2>
          <div class="finding-badges">
            {% if finding.cvss and finding.cvss.level %}
            <span class="finding-severity {{ finding.cvss.level | lower }}">{{ finding.cvss.level | upper }}</span>
            {% else %}
            <span class="finding-severity info">{{ finding.severity | upper }}</span>
            {% endif %}
            {% if finding.retest_status %}
            <span class="retest-badge retest-{{ finding.retest_status }}">{{ finding.retest_status | title }}</span>
            {% endif %}
          </div>
        </div>

        <div class="finding-body">
          {% if finding.cvss and finding.cvss.score %}
          <div class="finding-section">
            <div class="finding-section-title">CVSS Score</div>
            <div class="finding-section-content">
              <div class="cvss-display">
                <span class="cvss-score">{{ finding.cvss.score }}</span>
                <span class="cvss-level cvss-{{ finding.cvss.level | lower }}">{{ finding.cvss.level | upper }}</span>
                {% if finding.cvss.vector %}
                <span class="cvss-vector">{{ finding.cvss.vector }}</span>
                {% endif %}
              </div>
            </div>
          </div>
          {% endif %}

          {% for field in finding.renderedFields %}
          {% if field.html %}
          <div class="finding-section">
            <div class="finding-section-title">{{ field.label }}</div>
            <div class="finding-section-content">{{ field.html | safe }}</div>
          </div>
          {% endif %}
          {% endfor %}
        </div>
      </div>
    </div>
    {% endfor %}
  </section>

  {% if annexures.length %}
  <div class="page-break"></div>

  <!-- ANNEXURES -->
  <section id="annexures">
    <h1 class="in-toc numbered">Annexures</h1>
    {% for annexure in annexures %}
    <div>
      <h2 class="in-toc numbered">{{ annexure.title }}</h2>
      {{ annexure.content_html | safe }}
    </div>
    {% if not loop.last %}<div class="page-break"></div>{% endif %}
    {% endfor %}
  </section>
  {% endif %}

</body>
</html>`;
}

function defaultCssTemplate() {
  return `:root {
    --red-primary: #D32F2F;
    --red-dark: #B71C1C;
    --charcoal: #2C2C2C;
    --charcoal-light: #424242;
    --white: #FFFFFF;
    --gray-light: #F5F5F5;
    --gray-medium: #BDBDBD;
    --gray-dark: #757575;
}

@page {
    size: A4;
    margin: 25mm 20mm;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    line-height: 1.6;
    color: var(--charcoal);
    font-size: 11pt;
}

/* COVER PAGE */
.page-cover {
    page: cover;
    page-break-after: always;
    height: 297mm;
    width: 210mm;
    margin: 0;
    padding: 28mm 24mm;
    background: linear-gradient(
        135deg,
        var(--charcoal) 0%,
        var(--charcoal-light) 40%,
        var(--red-dark) 100%
    );
    color: var(--white);
    display: flex;
    flex-direction: column;
}

@page cover {
    size: A4;
    margin: 0;
}

.cover-header {
    margin-bottom: 90pt;
}

.company-logo img {
    max-width: 200pt;
    height: auto;
}

.company-logo-text {
    display: inline-block;
    font-size: 26pt;
    font-weight: 800;
    color: var(--white);
    letter-spacing: 0.02em;
    border-left: 6pt solid var(--red-primary);
    padding-left: 12pt;
}

.cover-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    margin-top: -65pt;
}

.cover-title {
    font-size: 38pt;
    font-weight: bold;
    color: var(--white);
    margin: 0 0 18pt 0;
    border: none;
    padding: 0;
}

.cover-subtitle {
    font-size: 22pt;
    color: var(--gray-medium);
    margin-bottom: 28pt;
}

.cover-details {
    background: rgba(255,255,255,0.10);
    padding: 25pt;
    display: flex;
    flex-direction: column;
    gap: 12pt;
    margin-top: -10pt;
}

.detail-group .detail-row {
    display: flex;
    margin-bottom: 2.5pt;
}

.detail-group .detail-row:last-child {
    margin-bottom: 0;
}

.detail-label {
    font-weight: bold;
    min-width: 120pt;
    color: var(--red-primary);
}

.detail-value {
    color: var(--white);
}

/* TABLE OF CONTENTS */
#page-toc ul {
    list-style: none;
    padding: 0;
}

#page-toc li {
    padding: 3pt 0;
    border-bottom: 1px solid var(--gray-light);
    font-size: 12pt;
    color: var(--charcoal);
}

#page-toc .toc-level1 {
    font-size: 1.5rem;
    font-weight: bold;
    margin-top: 0.8rem;
}

#page-toc .toc-level2 {
    font-size: 1.2rem;
    font-weight: bold;
    margin-top: 0.5rem;
    margin-left: 2rem;
}

#page-toc .toc-level3 {
    font-size: 1rem;
    margin-top: 0.4rem;
    margin-left: 4rem;
}

/* CONTENT SECTIONS */
h1 {
    font-size: 24pt;
    color: var(--charcoal);
    margin-bottom: 15pt;
    padding-bottom: 8pt;
    border-bottom: 3pt solid var(--red-primary);
    page-break-after: avoid;
    page-break-inside: avoid;
}

h2 {
    font-size: 18pt;
    color: var(--charcoal);
    margin-top: 20pt;
    margin-bottom: 12pt;
    page-break-after: avoid;
}

h3 {
    font-size: 14pt;
    color: var(--charcoal-light);
    margin-top: 15pt;
    margin-bottom: 10pt;
    page-break-after: avoid;
}

p {
    margin-bottom: 10pt;
    text-align: justify;
}

/* SEVERITY SUMMARY TABLE */
.severity-summary {
    width: 100%;
    border-collapse: collapse;
    margin: 20pt 0;
}

.severity-summary th,
.severity-summary td {
    padding: 12pt;
    text-align: left;
    border: 1pt solid var(--gray-medium);
}

.severity-summary th {
    background-color: var(--charcoal);
    color: var(--white);
    font-weight: bold;
    font-size: 12pt;
}

.severity-summary tbody tr:nth-child(even) {
    background-color: var(--gray-light);
}

.severity-cell {
    font-weight: bold;
    text-transform: uppercase;
    font-size: 11pt;
}

.severity-cell.critical { background-color: #B71C1C !important; color: var(--white); }
.severity-cell.high     { background-color: #D32F2F !important; color: var(--white); }
.severity-cell.medium   { background-color: #F57C00 !important; color: var(--white); }
.severity-cell.low      { background-color: #FBC02D !important; color: var(--charcoal); }
.severity-cell.info     { background-color: #0288D1 !important; color: var(--white); }

/* FINDINGS */
.finding {
    margin: 25pt 0;
    page-break-inside: auto;
    border: none;
}

.finding-header {
    padding: 15pt;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--gray-light);
    border: 1pt solid var(--gray-medium);
    border-bottom: 2pt solid var(--red-primary);
    border-radius: 4pt;
    break-after: avoid;
}

.finding-title {
    font-size: 16pt;
    font-weight: bold;
    color: var(--charcoal);
    margin: 0;
}

.finding-severity {
    padding: 6pt 15pt;
    border-radius: 15pt;
    font-weight: bold;
    font-size: 10pt;
    text-transform: uppercase;
    white-space: nowrap;
}

.finding-severity.critical { background-color: #B71C1C; color: var(--white); }
.finding-severity.high     { background-color: #D32F2F; color: var(--white); }
.finding-severity.medium   { background-color: #F57C00; color: var(--white); }
.finding-severity.low      { background-color: #FBC02D; color: var(--charcoal); }
.finding-severity.info,
.finding-severity.none     { background-color: #0288D1; color: var(--white); }

.finding-body {
    padding: 15pt;
}

.finding-section {
    margin-bottom: 15pt;
}

.finding-section:last-child {
    margin-bottom: 0;
}

.finding-section-title {
    font-size: 13pt;
    font-weight: bold;
    color: var(--red-primary);
    margin-bottom: 8pt;
    padding-bottom: 4pt;
    border-bottom: 2pt solid var(--gray-light);
}

.finding-section-content {
    color: var(--charcoal);
    line-height: 1.7;
}

.finding-break {
    page-break-before: always;
}

/* CVSS DISPLAY */
.cvss-display {
    display: flex;
    align-items: center;
    gap: 10pt;
    padding: 10pt;
    background-color: var(--gray-light);
    border-radius: 4pt;
}

.cvss-score {
    font-size: 24pt;
    font-weight: bold;
    color: var(--charcoal);
}

.cvss-level {
    padding: 4pt 10pt;
    border-radius: 10pt;
    font-weight: bold;
    font-size: 10pt;
    text-transform: uppercase;
}

.cvss-level.cvss-critical { background-color: #B71C1C; color: var(--white); }
.cvss-level.cvss-high     { background-color: #D32F2F; color: var(--white); }
.cvss-level.cvss-medium   { background-color: #F57C00; color: var(--white); }
.cvss-level.cvss-low      { background-color: #FBC02D; color: var(--charcoal); }
.cvss-level.cvss-info     { background-color: #0288D1; color: var(--white); }

.cvss-vector {
    font-family: 'Consolas', 'Source Code Pro', monospace;
    font-size: 9pt;
    color: var(--gray-dark);
}

/* RE-TEST STATUS BADGES */
.retest-badge {
    display: inline-block;
    padding: 4pt 12pt;
    border-radius: 12pt;
    font-size: 10pt;
    font-weight: bold;
    text-transform: uppercase;
    color: var(--white);
    background-color: var(--gray-medium);
    white-space: nowrap;
}

.retest-open     { background-color: #E53935; }
.retest-resolved { background-color: #43A047; }
.retest-partial  { background-color: #FB8C00; }
.retest-changed  { background-color: #5E35B1; }
.retest-accepted { background-color: #00897B; }
.retest-new      { background-color: #0288D1; }

/* CODE BLOCKS */
pre {
    background-color: var(--charcoal);
    color: var(--white);
    padding: 12pt;
    border-radius: 4pt;
    overflow-x: auto;
    font-size: 9pt;
    font-family: 'Consolas', 'Source Code Pro', monospace;
    margin: 10pt 0;
    page-break-inside: avoid;
}

code {
    font-family: 'Consolas', 'Source Code Pro', monospace;
    background-color: var(--gray-light);
    padding: 2pt 4pt;
    border-radius: 2pt;
    font-size: 10pt;
}

pre code {
    background-color: transparent;
    padding: 0;
}

/* TABLES */
table {
    width: 100%;
    border-collapse: collapse;
    margin: 15pt 0;
    page-break-inside: avoid;
}

table th,
table td {
    padding: 10pt;
    border: 1pt solid var(--gray-medium);
}

table th {
    background-color: var(--charcoal-light);
    color: var(--white);
    font-weight: bold;
    font-size: 11pt;
}

table tbody tr:nth-child(even) {
    background-color: var(--gray-light);
}

/* IMAGES */
img {
    max-width: 100%;
    height: auto;
    margin: 10pt 0;
    page-break-inside: avoid;
}

/* LISTS */
ul, ol {
    margin-left: 15pt;
    margin-bottom: 10pt;
}

li {
    margin-bottom: 5pt;
}

/* LINKS */
a {
    color: var(--red-primary);
    text-decoration: none;
}

/* PAGE BREAKS */
.page-break {
    page-break-before: always;
}

.no-break {
    page-break-inside: avoid;
}

/* NUMBERED HEADINGS */
body {
    counter-reset: report-section;
}

h1.numbered {
    counter-increment: report-section;
    counter-reset: report-subsection finding-item annexure-item;
}

h1.numbered::before {
    content: counter(report-section) ". ";
}

h2.numbered {
    counter-increment: report-subsection;
}

h2.numbered::before {
    content: counter(report-section) "." counter(report-subsection) " ";
}

#findings {
    counter-reset: finding-item;
}

#findings h1.numbered {
    counter-reset: finding-item;
}

#findings .finding-title.numbered {
    counter-increment: finding-item;
}

#findings .finding-title.numbered::before {
    content: counter(finding-item) ". ";
}

#annexures {
    counter-reset: annexure-item;
}

#annexures h2.numbered {
    counter-increment: annexure-item;
}

#annexures h2.numbered::before {
    content: counter(annexure-item) ". ";
}`;
}

function labelForField(name) {
  return String(name || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildReportContext({ project, design, findings, sections, members, evidence, stats }) {
  const fieldDefinitions = Array.isArray(design?.findingFieldDefinitions) && design.findingFieldDefinitions.length
    ? design.findingFieldDefinitions
    : [
      { name: "description", label: "Description" },
      { name: "attack_scenario", label: "Attack Scenario" },
      { name: "remediation", label: "Remediation" },
      { name: "references", label: "References" },
    ];

  const metadata = project.projectMetadata || {};
  const report = {
    title: project.title,
    customer: project.clientName || "",
    customer_name: metadata.customer_name || "",
    position_title: metadata.position_title || "",
    author: metadata.author || project.creatorUsername || "",
    author_title: metadata.author_title || "",
    version: project.version || "1.0",
    report_date: formatDate(project.updatedAt || project.createdAt, "long"),
    start_date: metadata.start_date ? formatDate(metadata.start_date, "long") : "",
    end_date: metadata.end_date ? formatDate(metadata.end_date, "long") : "",
    duration: metadata.duration || "",
    report_type: project.reportType || "",
    executive_summary: "",
    executive_summary_html: "",
    scope: "",
    scope_html: "",
    out_of_scope: "",
    out_of_scope_html: "",
  };

  const tocItems = [];
  const sectionDefinitions = Array.isArray(design?.sectionDefinitions) ? design.sectionDefinitions : [];
  const annexures = [];
  const includedFindings = (findings || []).filter((f) => f.isIncluded !== false);
  const includedSections = (sections || []).filter((s) => s.isIncluded !== false);

  for (const section of includedSections) {
    const contentHtml = renderMarkdownToHtml(section.content || "");
    if (section.sectionType === "executive_summary") {
      report.executive_summary = section.content || "";
      report.executive_summary_html = contentHtml;
    } else if (section.sectionType === "scope") {
      report.scope = section.content || "";
      report.scope_html = contentHtml;
    } else if (section.sectionType === "methodology") {
      tocItems.push({ title: section.title, level: 1 });
    } else if (section.sectionType === "appendix" || section.sectionType === "custom") {
      annexures.push({
        title: section.title,
        content_html: contentHtml,
      });
    }
    tocItems.push({ title: section.title, level: 1 });
  }

  tocItems.push({ title: "Findings", level: 1 });
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  const processedFindings = includedFindings.map((finding) => {
    const fields = finding.fields || {};
    const level = (finding.cvssLevel || finding.severity || "info").toLowerCase();
    if (severityCounts[level] !== undefined) severityCounts[level]++;

    const cvss = (finding.cvssVector || finding.cvssScore)
      ? { score: finding.cvssScore || "", level: finding.cvssLevel || "", vector: finding.cvssVector || "" }
      : null;

    const renderedFields = fieldDefinitions.map((field) => {
      const name = field.name || field.fieldName;
      const value = fields[name] || "";
      return {
        name,
        label: field.label || labelForField(name),
        html: value ? renderMarkdownToHtml(String(value)) : "",
      };
    }).filter((f) => f.html);

    return {
      title: finding.title,
      severity: finding.severity || "info",
      status: finding.status || "draft",
      retest_status: fields.retest_status || null,
      cvss,
      fields,
      renderedFields,
      orderIndex: finding.orderIndex || 0,
      createdAt: finding.createdAt || 0,
    };
  });

  // Apply finding ordering
  const orderingConfig = Array.isArray(design?.findingOrdering) && design.findingOrdering.length
    ? design.findingOrdering
    : [{ field: "severity", order: "desc" }, { field: "title", order: "asc" }];

  if (!project.overrideFindingOrder) {
    const severityRank = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    processedFindings.sort((a, b) => {
      for (const rule of orderingConfig) {
        const dir = rule.order === "desc" ? -1 : 1;
        if (rule.field === "severity" || rule.field === "cvss") {
          const aRank = severityRank[a.severity] || 0;
          const bRank = severityRank[b.severity] || 0;
          if (aRank !== bRank) return dir * (aRank - bRank);
        } else if (rule.field === "title") {
          const cmp = (a.title || "").localeCompare(b.title || "");
          if (cmp !== 0) return dir * cmp;
        } else if (rule.field === "cvss_score") {
          const aScore = a.cvss?.score || 0;
          const bScore = b.cvss?.score || 0;
          if (aScore !== bScore) return dir * (aScore - bScore);
        }
      }
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // Apply finding grouping
  const groupingConfig = Array.isArray(design?.findingGrouping) && design.findingGrouping.length
    ? design.findingGrouping[0]
    : null;

  let groupedFindings;
  if (groupingConfig) {
    const groups = new Map();
    const groupField = groupingConfig.field;
    for (const f of processedFindings) {
      let key;
      if (groupField === "severity" || groupField === "cvss") {
        key = f.severity || "info";
      } else {
        key = f.fields?.[groupField] || "Other";
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    groupedFindings = Array.from(groups.entries()).map(([groupTitle, items]) => ({ groupTitle, findings: items }));
  } else {
    groupedFindings = [{ groupTitle: null, findings: processedFindings }];
  }

  for (const finding of processedFindings) {
    tocItems.push({ title: finding.title, level: 2 });
  }

  return {
    project,
    report,
    design,
    members,
    stats,
    generatedAt: new Date().toISOString(),
    findings: processedFindings,
    grouped_findings: groupedFindings,
    severity_counts: severityCounts,
    toc_items: tocItems,
    annexures,
    sections: includedSections.map((s) => ({
      ...s,
      contentHtml: renderMarkdownToHtml(s.content || ""),
    })),
    evidence: evidence || [],
  };
}

function renderReportHtml(input, options = {}) {
  const design = input.design || {};
  const css = design.cssTemplate || defaultCssTemplate();
  let template = design.htmlTemplate || defaultHtmlTemplate();
  if (options.cssHref) {
    template = template.replace(/<style>\s*\{\{\s*css\s*\|\s*safe\s*\}\}\s*<\/style>/g, '<link rel="stylesheet" href="{{ cssHref }}">');
  }
  const env = new nunjucks.Environment(null, {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });
  const context = buildReportContext(input);
  return env.renderString(template, { ...context, css, cssHref: options.cssHref || "", escapeHtml });
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function renderPdfBuffer(html, options = {}) {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    throw new Error("Chromium executable not found. Set PUPPETEER_EXECUTABLE_PATH or use the Docker image with Chromium installed.");
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    timeout: timeoutMs,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url === "about:blank" || url.startsWith("data:")) {
        request.continue();
      } else {
        request.abort();
      }
    });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: timeoutMs });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: options.headerTemplate || '<div class="reporter-pdf-header">RedSec Penetration Test Report</div>',
      footerTemplate: options.footerTemplate || '<div class="reporter-pdf-footer">Page <span class="pageNumber"></span></div>',
      margin: { top: "25mm", right: "20mm", bottom: "25mm", left: "20mm" },
      timeout: timeoutMs,
    });
  } finally {
    await browser.close();
  }
}

// --- Proposal Rendering ---

function buildProposalContext({ proposal, template, sections, testTypes }) {
  const includedSections = (sections || []).filter((s) => s.isIncluded !== false && s.isIncluded !== 0);

  const processedSections = includedSections.map((s, i) => {
    let contentHtml = "";
    try { contentHtml = renderMarkdownToHtml(s.content || ""); } catch { contentHtml = escapeHtml(s.content || ""); }
    return { title: s.title, contentHtml, sectionType: s.sectionType || s.section_type || "markdown", orderIndex: i };
  });

  const tocItems = processedSections.map((s) => ({ title: s.title, level: 1 }));

  const processedTestTypes = (testTypes || []).map((tt) => {
    const render = (md) => { try { return renderMarkdownToHtml(md || ""); } catch { return escapeHtml(md || ""); } };
    return {
      type: tt.test_type || tt.testType || tt.type || "",
      name: tt.name || "",
      methodologyHtml: render(tt.methodology_writeup || tt.methodology || ""),
      scopeHtml: render(tt.scope_guidance || tt.scope || ""),
      deliverablesHtml: render(tt.deliverables || ""),
      clientRequirementsHtml: render(tt.client_requirements || tt.clientRequirements || ""),
      consultantRequirementsHtml: render(tt.consultant_requirements || tt.consultantRequirements || ""),
      assumptionsHtml: render(tt.assumptions || ""),
      restrictionsHtml: render(tt.restrictions || ""),
    };
  });

  return {
    proposal,
    meta: {
      title: proposal.title || "",
      clientName: proposal.clientName || proposal.client_name || "",
      primaryContactName: proposal.primaryContactName || proposal.primary_contact_name || "",
      primaryContactEmail: proposal.primaryContactEmail || proposal.primary_contact_email || "",
      preparedForName: proposal.preparedForName || proposal.prepared_for_name || "",
      preparedForEmail: proposal.preparedForEmail || proposal.prepared_for_email || "",
      preparedByUsername: proposal.preparedByUsername || proposal.prepared_by_username || "",
      proposalType: proposal.proposalType || proposal.proposal_type || "security_assessment",
      quotedValue: proposal.quotedValue || proposal.quoted_value,
      estimatedDays: proposal.estimatedDays || proposal.estimated_days,
      validUntil: proposal.validUntil || proposal.valid_until ? formatDate(proposal.validUntil || proposal.valid_until, "long") : "",
      status: proposal.status || "draft",
      createdAt: formatDate(proposal.createdAt || proposal.created_at, "long"),
    },
    sections: processedSections,
    toc_items: tocItems,
    test_types: processedTestTypes,
    generated_at: new Date().toISOString(),
    escapeHtml,
  };
}

function renderProposalDocumentHtml(input, options = {}) {
  const template = input.template || {};
  const css = template.css_template || template.cssTemplate || defaultProposalCssTemplate();
  let html = template.html_template || template.htmlTemplate || defaultProposalHtmlTemplate();
  if (options.cssHref) {
    html = html.replace(/<style>\s*\{\{\s*css\s*\|\s*safe\s*\}\}\s*<\/style>/g, '<link rel="stylesheet" href="{{ cssHref }}">');
  }
  const env = new nunjucks.Environment(null, {
    autoescape: true,
    throwOnUndefined: false,
    trimBlocks: true,
    lstripBlocks: true,
  });
  const context = buildProposalContext(input);
  return env.renderString(html, { ...context, css, cssHref: options.cssHref || "", escapeHtml });
}

function defaultProposalHtmlTemplate() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{ meta.title }}</title>
  {% if cssHref %}
  <link rel="stylesheet" href="{{ cssHref }}">
  {% else %}
  <style>{{ css | safe }}</style>
  {% endif %}
</head>
<body>

  <!-- COVER PAGE -->
  <section class="page-cover">
    <div class="cover-header">
      <div class="company-logo-text">RedSec</div>
    </div>
    <div class="cover-content">
      <h1 class="cover-title">Security Assessment Proposal</h1>
      <div class="cover-subtitle">{{ meta.title }}</div>
      <div class="cover-details">
        {% if meta.clientName %}
        <div class="detail-group detail-group-customer">
          <div class="detail-row">
            <span class="detail-label">Client:</span>
            <span class="detail-value">{{ meta.clientName }}</span>
          </div>
        </div>
        {% endif %}

        {% if meta.preparedByUsername %}
        <div class="detail-group detail-group-author">
          <div class="detail-row">
            <span class="detail-label">Prepared By:</span>
            <span class="detail-value">{{ meta.preparedByUsername }}</span>
          </div>
        </div>
        {% endif %}

        <div class="detail-group detail-group-meta">
          <div class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">{{ meta.createdAt }}</span>
          </div>
          {% if meta.validUntil %}
          <div class="detail-row">
            <span class="detail-label">Valid Until:</span>
            <span class="detail-value">{{ meta.validUntil }}</span>
          </div>
          {% endif %}
          {% if meta.estimatedDays %}
          <div class="detail-row">
            <span class="detail-label">Estimated Days:</span>
            <span class="detail-value">{{ meta.estimatedDays }}</span>
          </div>
          {% endif %}
          {% if meta.quotedValue %}
          <div class="detail-row">
            <span class="detail-label">Quoted Value:</span>
            <span class="detail-value">{{ meta.quotedValue }}</span>
          </div>
          {% endif %}
        </div>
      </div>
    </div>
  </section>

  <div class="page-break"></div>

  <!-- TABLE OF CONTENTS -->
  <section id="page-toc">
    <h1>Table of Contents</h1>
    <ul class="toc-list">
      {% for item in toc_items %}
      <li class="toc-level{{ item.level }}">{{ item.title }}</li>
      {% endfor %}
    </ul>
  </section>

  <div class="page-break"></div>

  <!-- SECTIONS -->
  {% for section in sections %}
  <section>
    <h1 class="in-toc numbered">{{ section.title }}</h1>
    {{ section.contentHtml | safe }}
  </section>
  {% if not loop.last %}<div class="page-break"></div>{% endif %}
  {% endfor %}

</body>
</html>`;
}

function defaultProposalCssTemplate() {
  return `:root {
  --red-primary: #dc2626;
  --red-dark: #991b1b;
  --charcoal: #1a1a1a;
  --gray-700: #374151;
  --gray-500: #6b7280;
  --gray-300: #d1d5db;
  --gray-100: #f3f4f6;
  --white: #ffffff;
}

@page {
  size: A4;
  margin: 25mm 20mm;
}

@page cover {
  margin: 0;
}

* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--charcoal);
  line-height: 1.6;
  margin: 0;
  padding: 0;
  font-size: 11pt;
}

.page-break {
  page-break-after: always;
  break-after: page;
}

/* Cover Page */
.page-cover {
  page: cover;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, var(--red-primary) 0%, var(--red-dark) 100%);
  color: var(--white);
  padding: 60px;
}

.cover-header {
  margin-bottom: 40px;
}

.company-logo-text {
  font-size: 48pt;
  font-weight: 800;
  letter-spacing: -2px;
  text-transform: uppercase;
}

.cover-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.cover-title {
  font-size: 28pt;
  font-weight: 300;
  margin: 0 0 8px 0;
  border: none;
  padding: 0;
}

.cover-subtitle {
  font-size: 16pt;
  font-weight: 600;
  margin-bottom: 40px;
  opacity: 0.9;
}

.cover-details {
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 24px;
}

.detail-group {
  margin-bottom: 12px;
}

.detail-group:last-child {
  margin-bottom: 0;
}

.detail-row {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
}

.detail-label {
  font-weight: 600;
  min-width: 140px;
  opacity: 0.85;
}

.detail-value {
  flex: 1;
}

/* Table of Contents */
#page-toc h1 {
  border-bottom: 2px solid var(--red-primary);
  padding-bottom: 8px;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-list li {
  padding: 4px 0;
  border-bottom: 1px solid var(--gray-100);
}

.toc-level1 {
  font-weight: 600;
  font-size: 12pt;
}

.toc-level2 {
  font-weight: 400;
  padding-left: 24px;
  font-size: 11pt;
}

/* Headings */
h1 {
  font-size: 18pt;
  color: var(--charcoal);
  border-bottom: 2px solid var(--red-primary);
  padding-bottom: 6px;
  margin-top: 24px;
}

h2 {
  font-size: 14pt;
  color: var(--gray-700);
  margin-top: 20px;
}

h3 {
  font-size: 12pt;
  color: var(--gray-500);
  margin-top: 16px;
}

h1.numbered { counter-increment: report-section; }
h2.numbered { counter-increment: report-subsection; }

/* Tables */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 10pt;
}

th, td {
  border: 1px solid var(--gray-300);
  padding: 8px 12px;
  text-align: left;
}

th {
  background: var(--gray-100);
  font-weight: 600;
}

/* Code */
code {
  background: var(--gray-100);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10pt;
}

pre {
  background: var(--gray-100);
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 9pt;
}

pre code {
  background: none;
  padding: 0;
}

/* Blockquotes */
blockquote {
  border-left: 3px solid var(--red-primary);
  padding-left: 12px;
  color: var(--gray-500);
  margin-left: 0;
}

/* Lists */
ul, ol {
  padding-left: 24px;
}

/* Links */
a {
  color: var(--red-primary);
  text-decoration: none;
}

/* PDF Header/Footer */
.reporter-pdf-header {
  font-size: 8pt;
  color: var(--gray-500);
  text-align: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--gray-300);
}

.reporter-pdf-footer {
  font-size: 8pt;
  color: var(--gray-500);
  text-align: center;
  padding: 4px 0;
}
`;
}

module.exports = {
  REPORTER_PDF_DIR,
  ensureReporterPdfDir,
  renderReportHtml,
  renderPdfBuffer,
  defaultHtmlTemplate,
  defaultCssTemplate,
  buildReportContext,
  renderProposalDocumentHtml,
  defaultProposalHtmlTemplate,
  defaultProposalCssTemplate,
  buildProposalContext,
  formatDate,
};
