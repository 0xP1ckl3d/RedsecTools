const defaultProposalHtml = String.raw`<!doctype html>
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

  <section class="cover-page">
    <div class="cover-band"></div>

    <div class="cover-inner">
      <div class="brand-lockup">
        <div class="brand-mark">RS</div>
        <div>
          <div class="brand-name">RedSec</div>
          <div class="brand-subtitle">Offensive Security</div>
        </div>
      </div>

      <div class="cover-main">
        <div class="document-type">Security Assessment Proposal</div>
        <h1>{{ meta.title }}</h1>
        {% if meta.clientName %}
        <div class="client-line">Prepared for {{ meta.clientName }}</div>
        {% endif %}
      </div>

      <div class="cover-meta">
        {% if meta.clientName %}
        <div class="meta-item">
          <span class="meta-label">Client</span>
          <span class="meta-value">{{ meta.clientName }}</span>
        </div>
        {% endif %}

        {% if meta.preparedByUsername %}
        <div class="meta-item">
          <span class="meta-label">Prepared By</span>
          <span class="meta-value">{{ meta.preparedByUsername }}</span>
        </div>
        {% endif %}

        {% if meta.createdAt %}
        <div class="meta-item">
          <span class="meta-label">Date</span>
          <span class="meta-value">{{ meta.createdAt }}</span>
        </div>
        {% endif %}

        {% if meta.validUntil %}
        <div class="meta-item">
          <span class="meta-label">Valid Until</span>
          <span class="meta-value">{{ meta.validUntil }}</span>
        </div>
        {% endif %}

        {% if meta.estimatedDays %}
        <div class="meta-item">
          <span class="meta-label">Estimated Days</span>
          <span class="meta-value">{{ meta.estimatedDays }}</span>
        </div>
        {% endif %}

        {% if meta.quotedValue %}
        <div class="meta-item">
          <span class="meta-label">Quoted Value</span>
          <span class="meta-value">{{ meta.quotedValue }}</span>
        </div>
        {% endif %}
      </div>
    </div>

    <div class="classification-footer">Commercial in Confidence</div>
  </section>

  <div class="page-break"></div>

  <section id="page-toc" class="content-page">
    <div class="running-header">
      <span>{{ meta.title }}</span>
      <span>Proposal</span>
    </div>

    <h1>Table of Contents</h1>

    <ol class="toc-list">
      {% for item in toc_items %}
      <li class="toc-level{{ item.level }}">
        <span>{{ item.title }}</span>
      </li>
      {% endfor %}
    </ol>

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      {% if meta.clientName %}
      <span>{{ meta.clientName }}</span>
      {% else %}
      <span>Commercial in Confidence</span>
      {% endif %}
    </div>
  </section>

  <div class="page-break"></div>

  {% for section in sections %}
  <section class="content-page proposal-section">
    <div class="running-header">
      <span>{{ meta.title }}</span>
      <span>Proposal</span>
    </div>

    <h1 class="in-toc numbered">{{ section.title }}</h1>

    {% if section.contentHtml %}
    <div class="prose">
      {{ section.contentHtml | safe }}
    </div>
    {% else %}
    <div class="placeholder">
      This section has not yet been completed.
    </div>
    {% endif %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      {% if meta.clientName %}
      <span>{{ meta.clientName }}</span>
      {% else %}
      <span>Commercial in Confidence</span>
      {% endif %}
    </div>
  </section>
  {% if not loop.last %}<div class="page-break"></div>{% endif %}
  {% endfor %}

</body>
</html>`;

const defaultProposalCss = String.raw`:root {
  --red: #c0162d;
  --red-dark: #8f1022;
  --red-soft: #fde8ec;

  --ink: #111827;
  --slate: #1f2937;
  --steel: #475569;
  --muted: #64748b;
  --border: #d8dee8;
  --surface: #f5f7fb;
  --surface-strong: #eef2f7;
  --white: #ffffff;
}

@page {
  size: A4;
  margin: 18mm 16mm;
}

@page cover {
  size: A4;
  margin: 0;
}

* {
  box-sizing: border-box;
}

html {
  font-size: 10pt;
}

body {
  margin: 0;
  padding: 0;
  font-family: "Segoe UI", Arial, Helvetica, sans-serif;
  color: var(--ink);
  background: var(--white);
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page-break {
  page-break-before: always;
  break-before: page;
}

.content-page {
  position: relative;
  min-height: 250mm;
}

.running-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: -8mm -4mm 12mm -4mm;
  padding: 4mm 4mm 3mm 4mm;
  border-bottom: 2px solid var(--red);
  background: var(--slate);
  color: var(--white);
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.running-footer {
  position: absolute;
  bottom: -10mm;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--border);
  padding-top: 3mm;
  color: var(--muted);
  font-size: 7.5pt;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cover-page {
  page: cover;
  width: 210mm;
  min-height: 297mm;
  margin: 0;
  padding: 0;
  background: var(--white);
  position: relative;
  overflow: hidden;
}

.cover-band {
  position: absolute;
  top: 0;
  right: 0;
  width: 54mm;
  height: 297mm;
  background: linear-gradient(180deg, var(--slate), var(--red-dark));
}

.cover-inner {
  position: relative;
  z-index: 2;
  padding: 26mm 22mm;
  min-height: 277mm;
  display: flex;
  flex-direction: column;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  background: var(--red);
  color: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 16pt;
  letter-spacing: -0.05em;
}

.brand-name {
  font-size: 17pt;
  font-weight: 900;
  color: var(--ink);
}

.brand-subtitle {
  color: var(--muted);
  font-size: 8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cover-main {
  margin-top: 42mm;
  max-width: 130mm;
}

.document-type {
  color: var(--red);
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin-bottom: 7mm;
}

.cover-main h1 {
  font-size: 34pt;
  line-height: 1.03;
  margin: 0 0 8mm 0;
  padding: 0;
  color: var(--ink);
  border: none;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.client-line {
  color: var(--steel);
  font-size: 12pt;
  padding-left: 5mm;
  border-left: 4px solid var(--red);
}

.cover-meta {
  margin-top: auto;
  width: 132mm;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
}

.meta-item {
  padding: 5mm;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.meta-label {
  display: block;
  color: var(--muted);
  font-size: 7pt;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 1.5mm;
}

.meta-value {
  display: block;
  color: var(--ink);
  font-size: 10pt;
  font-weight: 700;
}

.classification-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6mm 22mm;
  background: var(--slate);
  color: rgba(255, 255, 255, 0.72);
  font-size: 8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  font-size: 22pt;
  line-height: 1.12;
  color: var(--ink);
  margin: 0 0 7mm 0;
  padding-bottom: 3mm;
  border-bottom: 2px solid var(--border);
  page-break-after: avoid;
  break-after: avoid;
}

h2 {
  font-size: 14pt;
  color: var(--slate);
  margin: 8mm 0 3mm 0;
  padding-bottom: 1.5mm;
  border-bottom: 1px solid var(--border);
  page-break-after: avoid;
  break-after: avoid;
}

h3 {
  font-size: 12pt;
  color: var(--slate);
  margin: 6mm 0 2mm 0;
}

p {
  margin: 0 0 3.5mm 0;
}

strong {
  font-weight: 700;
  color: var(--slate);
}

.placeholder {
  border: 1px dashed var(--border);
  background: var(--surface);
  color: var(--muted);
  padding: 5mm;
  font-style: italic;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  counter-reset: toc-item;
}

.toc-list li {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 2.5mm 0;
}

.toc-list li::before {
  counter-increment: toc-item;
  content: counter(toc-item) ".";
  min-width: 12mm;
  color: var(--muted);
  font-weight: 800;
}

.toc-level1 {
  font-weight: 800;
  color: var(--slate);
  font-size: 11pt;
}

.toc-level2 {
  margin-left: 9mm;
  color: var(--steel);
  font-size: 9.5pt;
}

.toc-level3 {
  margin-left: 18mm;
  color: var(--muted);
  font-size: 9pt;
}

.proposal-section {
  page-break-inside: auto;
}

.proposal-section h1 {
  color: var(--ink);
}

.proposal-section h1::after {
  content: "Proposal Section";
  display: block;
  margin-top: 1.5mm;
  color: var(--red);
  font-size: 7pt;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.prose {
  font-size: 10pt;
  color: var(--ink);
}

.prose p {
  margin-bottom: 3.5mm;
}

.prose ul,
.prose ol {
  margin: 0 0 3.5mm 6mm;
  padding-left: 4mm;
}

.prose li {
  margin-bottom: 1.5mm;
}

.prose blockquote {
  margin: 4mm 0;
  padding: 3mm 4mm;
  border-left: 4px solid var(--red);
  background: var(--surface);
  color: var(--steel);
}

.prose code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 8.7pt;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 0.6mm 1.2mm;
  border-radius: 1mm;
  color: var(--red-dark);
}

.prose pre {
  margin: 4mm 0;
  padding: 4mm;
  background: #0f172a;
  color: #e5e7eb;
  border-radius: 2mm;
  font-family: Consolas, "Courier New", monospace;
  font-size: 8pt;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
}

.prose pre code {
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 5mm 0;
  font-size: 9pt;
  page-break-inside: avoid;
}

.prose th {
  background: var(--slate);
  color: var(--white);
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
  padding: 2.8mm;
  border: 1px solid var(--border);
}

.prose td {
  border: 1px solid var(--border);
  padding: 2.8mm;
  vertical-align: top;
}

.prose tbody tr:nth-child(even) td {
  background: var(--surface);
}

.prose img {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 2mm;
  margin: 3mm 0;
  page-break-inside: avoid;
}

.prose a {
  color: var(--red);
  text-decoration: underline;
}

body {
  counter-reset: report-section;
}

h1.numbered {
  counter-increment: report-section;
  counter-reset: report-subsection;
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

.reporter-pdf-header {
  font-size: 8pt;
  color: var(--muted);
  text-align: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.reporter-pdf-footer {
  font-size: 8pt;
  color: var(--muted);
  text-align: center;
  padding: 4px 0;
}`;

const defaultReportHtml = String.raw`<!doctype html>
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

  <section class="cover-page">
    <div class="cover-band"></div>

    <div class="cover-inner">
      <div class="brand-lockup">
        <div class="brand-mark">RS</div>
        <div>
          <div class="brand-name">RedSec</div>
          <div class="brand-subtitle">Offensive Security</div>
        </div>
      </div>

      <div class="cover-main">
        <div class="document-type">Penetration Testing Report</div>
        <h1>{{ report.title }}</h1>
        {% if report.customer %}
        <div class="client-line">Prepared for {{ report.customer }}</div>
        {% endif %}
      </div>

      <div class="cover-meta">
        {% if report.customer %}
        <div class="meta-item">
          <span class="meta-label">Customer</span>
          <span class="meta-value">{{ report.customer }}</span>
        </div>
        {% endif %}

        {% if report.author %}
        <div class="meta-item">
          <span class="meta-label">Author</span>
          <span class="meta-value">{{ report.author }}</span>
        </div>
        {% endif %}

        {% if report.version %}
        <div class="meta-item">
          <span class="meta-label">Version</span>
          <span class="meta-value">{{ report.version }}</span>
        </div>
        {% endif %}

        {% if report.report_date %}
        <div class="meta-item">
          <span class="meta-label">Report Date</span>
          <span class="meta-value">{{ report.report_date }}</span>
        </div>
        {% endif %}

        {% if report.start_date or report.end_date or report.duration %}
        <div class="meta-item meta-wide">
          <span class="meta-label">Assessment Period</span>
          <span class="meta-value">
            {% if report.start_date %}{{ report.start_date }}{% endif %}
            {% if report.start_date and report.end_date %} to {% endif %}
            {% if report.end_date %}{{ report.end_date }}{% endif %}
            {% if report.duration %}({{ report.duration }} days){% endif %}
          </span>
        </div>
        {% endif %}
      </div>
    </div>

    <div class="classification-footer">Confidential</div>
  </section>

  <div class="page-break"></div>

  <section id="page-toc" class="content-page">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <h1 class="numbered">Table of Contents</h1>

    <ol class="toc-list">
      {% for item in toc_items %}
      <li class="toc-level{{ item.level }}">
        <span>{{ item.title }}</span>
      </li>
      {% endfor %}
    </ol>

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>

  <div class="page-break"></div>

  <section id="executive-summary" class="content-page">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <h1 class="numbered in-toc">Executive Summary</h1>

    {% if report.customer and report.duration %}
    <p>
      RedSec performed a penetration test for {{ report.customer }} over {{ report.duration }} days{% if report.start_date %}, commencing on {{ report.start_date }}{% endif %}{% if report.end_date %} and concluding on {{ report.end_date }}{% endif %}.
    </p>
    {% endif %}

    {% if report.executive_summary_html %}
    <div class="prose">
      {{ report.executive_summary_html | safe }}
    </div>
    {% else %}
    <div class="placeholder">
      The executive summary section has not yet been completed.
    </div>
    {% endif %}

    <h2 class="in-toc numbered">Findings Summary</h2>

    <p>
      RedSec identified <strong>{{ findings | length }}</strong> finding{% if findings | length != 1 %}s{% endif %} during the assessment.
    </p>

    <div class="severity-grid">
      <div class="severity-card severity-critical">
        <span class="severity-count">{{ severity_counts.critical }}</span>
        <span class="severity-label">Critical</span>
      </div>
      <div class="severity-card severity-high">
        <span class="severity-count">{{ severity_counts.high }}</span>
        <span class="severity-label">High</span>
      </div>
      <div class="severity-card severity-medium">
        <span class="severity-count">{{ severity_counts.medium }}</span>
        <span class="severity-label">Medium</span>
      </div>
      <div class="severity-card severity-low">
        <span class="severity-count">{{ severity_counts.low }}</span>
        <span class="severity-label">Low</span>
      </div>
      <div class="severity-card severity-info">
        <span class="severity-count">{{ severity_counts.info }}</span>
        <span class="severity-label">Informational</span>
      </div>
    </div>

    {% if report.scope_html %}
    <h2 class="in-toc numbered">Scope</h2>
    <div class="prose">
      {{ report.scope_html | safe }}
    </div>
    {% endif %}

    {% if report.out_of_scope_html %}
    <h2>Out of Scope</h2>
    <div class="prose">
      {{ report.out_of_scope_html | safe }}
    </div>
    {% endif %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>

  {% for section in sections %}
  {% if section.sectionType != "executive_summary" and section.sectionType != "scope" and section.sectionType != "appendix" and section.sectionType != "custom" %}
  <div class="page-break"></div>
  <section class="content-page">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <h1 class="numbered in-toc">{{ section.title }}</h1>

    {% if section.contentHtml %}
    <div class="prose">
      {{ section.contentHtml | safe }}
    </div>
    {% else %}
    <div class="placeholder">
      This section has not yet been completed.
    </div>
    {% endif %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>
  {% endif %}
  {% endfor %}

  <div class="page-break"></div>

  <section id="findings" class="content-page">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <h1 class="numbered in-toc">Findings</h1>

    {% if findings | length %}
    <table class="finding-summary-table">
      <thead>
        <tr>
          <th class="ref-col">Ref</th>
          <th>Finding</th>
          <th class="severity-col">Severity</th>
          <th class="cvss-col">CVSS</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {% for finding in findings %}
        {% set severityLevel = finding.severity | lower %}
        {% if finding.cvss and finding.cvss.level %}
        {% set severityLevel = finding.cvss.level | lower %}
        {% endif %}
        <tr>
          <td class="ref-col">F{{ loop.index }}</td>
          <td>{{ finding.title }}</td>
          <td class="severity-col">
            <span class="severity-pill severity-{{ severityLevel }}">{{ severityLevel | upper }}</span>
          </td>
          <td class="cvss-col">
            {% if finding.cvss and finding.cvss.score %}
            {{ finding.cvss.score }}
            {% else %}
            N/A
            {% endif %}
          </td>
          <td>{{ finding.status | title }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>
    {% else %}
    <div class="placeholder">No findings have been included in this report.</div>
    {% endif %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>

  {% for finding in findings %}
  {% set severityLevel = finding.severity | lower %}
  {% if finding.cvss and finding.cvss.level %}
  {% set severityLevel = finding.cvss.level | lower %}
  {% endif %}

  <div class="page-break"></div>

  <section class="finding-page content-page finding-{{ severityLevel }}">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <div class="finding-heading">
      <div class="finding-heading-main">
        <div class="finding-ref">Finding {{ loop.index }}</div>
        <h1 class="finding-title in-toc numbered">{{ finding.title }}</h1>
      </div>

      <div class="finding-badges">
        <span class="severity-pill severity-{{ severityLevel }}">{{ severityLevel | upper }}</span>
        {% if finding.retest_status %}
        <span class="retest-pill retest-{{ finding.retest_status }}">{{ finding.retest_status | title }}</span>
        {% endif %}
      </div>
    </div>

    {% if finding.cvss and finding.cvss.score %}
    <div class="cvss-panel">
      <div class="cvss-score-block">
        <span class="cvss-label">CVSS Score</span>
        <span class="cvss-score">{{ finding.cvss.score }}</span>
      </div>
      <div class="cvss-vector-block">
        <span class="cvss-label">Severity</span>
        <span class="cvss-value">{{ finding.cvss.level | upper }}</span>
        {% if finding.cvss.vector %}
        <span class="cvss-label cvss-vector-label">Vector</span>
        <span class="cvss-vector">{{ finding.cvss.vector }}</span>
        {% endif %}
      </div>
    </div>
    {% endif %}

    {% for field in finding.renderedFields %}
    {% if field.html %}
    <div class="finding-section field-{{ field.name }}">
      <h2>{{ field.label }}</h2>
      <div class="prose">
        {{ field.html | safe }}
      </div>
    </div>
    {% endif %}
    {% endfor %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>
  {% endfor %}

  {% if annexures and annexures.length %}
  <div class="page-break"></div>

  <section id="annexures" class="content-page">
    <div class="running-header">
      <span>{{ report.title }}</span>
      <span>Confidential</span>
    </div>

    <h1 class="numbered in-toc">Annexures</h1>

    {% for annexure in annexures %}
    <div class="annexure-block">
      <h2 class="numbered in-toc">{{ annexure.title }}</h2>
      <div class="prose">
        {{ annexure.content_html | safe }}
      </div>
    </div>
    {% endfor %}

    <div class="running-footer">
      <span>RedSec Offensive Security</span>
      <span>{{ report.customer }}</span>
    </div>
  </section>
  {% endif %}

</body>
</html>`;

const defaultReportCss = String.raw`:root {
  --red: #c0162d;
  --red-dark: #8f1022;
  --red-soft: #fde8ec;

  --ink: #111827;
  --slate: #1f2937;
  --steel: #475569;
  --muted: #64748b;
  --border: #d8dee8;
  --surface: #f5f7fb;
  --surface-strong: #eef2f7;
  --white: #ffffff;

  --critical: #b91c1c;
  --critical-bg: #fee2e2;
  --high: #c2410c;
  --high-bg: #ffedd5;
  --medium: #a16207;
  --medium-bg: #fef3c7;
  --low: #1d4ed8;
  --low-bg: #dbeafe;
  --info: #0369a1;
  --info-bg: #e0f2fe;
}

@page {
  size: A4;
  margin: 18mm 16mm;
}

@page cover {
  size: A4;
  margin: 0;
}

* {
  box-sizing: border-box;
}

html {
  font-size: 10pt;
}

body {
  margin: 0;
  padding: 0;
  font-family: "Segoe UI", Arial, Helvetica, sans-serif;
  color: var(--ink);
  background: var(--white);
  line-height: 1.55;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page-break {
  page-break-before: always;
  break-before: page;
}

.content-page {
  position: relative;
  min-height: 250mm;
}

.running-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: -8mm -4mm 12mm -4mm;
  padding: 4mm 4mm 3mm 4mm;
  border-bottom: 2px solid var(--red);
  background: var(--slate);
  color: var(--white);
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.running-footer {
  position: absolute;
  bottom: -10mm;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--border);
  padding-top: 3mm;
  color: var(--muted);
  font-size: 7.5pt;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cover-page {
  page: cover;
  width: 210mm;
  min-height: 297mm;
  margin: 0;
  padding: 0;
  background: var(--white);
  position: relative;
  overflow: hidden;
}

.cover-band {
  position: absolute;
  top: 0;
  right: 0;
  width: 54mm;
  height: 297mm;
  background: linear-gradient(180deg, var(--slate), var(--red-dark));
}

.cover-inner {
  position: relative;
  z-index: 2;
  padding: 26mm 22mm;
  min-height: 277mm;
  display: flex;
  flex-direction: column;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  background: var(--red);
  color: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 16pt;
  letter-spacing: -0.05em;
}

.brand-name {
  font-size: 17pt;
  font-weight: 900;
  color: var(--ink);
}

.brand-subtitle {
  color: var(--muted);
  font-size: 8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cover-main {
  margin-top: 42mm;
  max-width: 130mm;
}

.document-type {
  color: var(--red);
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  margin-bottom: 7mm;
}

.cover-main h1 {
  font-size: 34pt;
  line-height: 1.03;
  margin: 0 0 8mm 0;
  padding: 0;
  color: var(--ink);
  border: none;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.client-line {
  color: var(--steel);
  font-size: 12pt;
  padding-left: 5mm;
  border-left: 4px solid var(--red);
}

.cover-meta {
  margin-top: auto;
  width: 132mm;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
}

.meta-item {
  padding: 5mm;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.meta-wide {
  grid-column: span 2;
}

.meta-label {
  display: block;
  color: var(--muted);
  font-size: 7pt;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin-bottom: 1.5mm;
}

.meta-value {
  display: block;
  color: var(--ink);
  font-size: 10pt;
  font-weight: 700;
}

.classification-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 6mm 22mm;
  background: var(--slate);
  color: rgba(255, 255, 255, 0.72);
  font-size: 8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  font-size: 22pt;
  line-height: 1.12;
  color: var(--ink);
  margin: 0 0 7mm 0;
  padding-bottom: 3mm;
  border-bottom: 2px solid var(--border);
  page-break-after: avoid;
  break-after: avoid;
}

h2 {
  font-size: 14pt;
  color: var(--slate);
  margin: 8mm 0 3mm 0;
  padding-bottom: 1.5mm;
  border-bottom: 1px solid var(--border);
  page-break-after: avoid;
  break-after: avoid;
}

h3 {
  font-size: 12pt;
  color: var(--slate);
  margin: 6mm 0 2mm 0;
}

p {
  margin: 0 0 3.5mm 0;
}

strong {
  font-weight: 700;
  color: var(--slate);
}

.placeholder {
  border: 1px dashed var(--border);
  background: var(--surface);
  color: var(--muted);
  padding: 5mm;
  font-style: italic;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-list li {
  display: flex;
  border-bottom: 1px solid var(--border);
  padding: 2.5mm 0;
}

.toc-level1 {
  font-weight: 800;
  color: var(--slate);
  font-size: 11pt;
}

.toc-level2 {
  margin-left: 9mm;
  color: var(--steel);
  font-size: 9.5pt;
}

.toc-level3 {
  margin-left: 18mm;
  color: var(--muted);
  font-size: 9pt;
}

.severity-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 2mm;
  margin: 6mm 0 8mm 0;
}

.severity-card {
  border: 1px solid var(--border);
  padding: 4mm 2mm;
  text-align: center;
  border-radius: 2mm;
}

.severity-count {
  display: block;
  font-size: 24pt;
  font-weight: 900;
  line-height: 1;
}

.severity-label {
  display: block;
  margin-top: 1.5mm;
  font-size: 7.5pt;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.severity-critical { background: var(--critical-bg); color: var(--critical); }
.severity-high { background: var(--high-bg); color: var(--high); }
.severity-medium { background: var(--medium-bg); color: var(--medium); }
.severity-low { background: var(--low-bg); color: var(--low); }
.severity-info,
.severity-informational { background: var(--info-bg); color: var(--info); }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 5mm 0;
  page-break-inside: avoid;
}

th {
  background: var(--slate);
  color: var(--white);
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
  padding: 2.8mm;
}

td {
  border: 1px solid var(--border);
  padding: 2.8mm;
  vertical-align: top;
}

tbody tr:nth-child(even) td {
  background: var(--surface);
}

.finding-summary-table {
  font-size: 9pt;
}

.ref-col {
  width: 16mm;
  font-weight: 800;
  color: var(--muted);
}

.severity-col {
  width: 30mm;
}

.cvss-col {
  width: 20mm;
  text-align: center;
}

.finding-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8mm;
  margin-bottom: 5mm;
  padding: 5mm;
  background: var(--surface);
  border-left: 5px solid var(--red);
  page-break-inside: avoid;
  break-inside: avoid;
}

.finding-critical .finding-heading { border-left-color: var(--critical); background: var(--critical-bg); }
.finding-high .finding-heading { border-left-color: var(--high); background: var(--high-bg); }
.finding-medium .finding-heading { border-left-color: var(--medium); background: var(--medium-bg); }
.finding-low .finding-heading { border-left-color: var(--low); background: var(--low-bg); }
.finding-info .finding-heading,
.finding-informational .finding-heading { border-left-color: var(--info); background: var(--info-bg); }

.finding-ref {
  color: var(--muted);
  font-size: 8pt;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 1mm;
}

.finding-title {
  border: none;
  margin: 0;
  padding: 0;
  font-size: 19pt;
}

.finding-badges {
  display: flex;
  flex-direction: column;
  gap: 2mm;
  align-items: flex-end;
}

.severity-pill,
.retest-pill {
  display: inline-block;
  border-radius: 999px;
  padding: 1.8mm 4mm;
  font-size: 7.5pt;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.severity-pill.severity-critical { background: var(--critical); color: var(--white); }
.severity-pill.severity-high { background: var(--high); color: var(--white); }
.severity-pill.severity-medium { background: var(--medium); color: var(--white); }
.severity-pill.severity-low { background: var(--low); color: var(--white); }
.severity-pill.severity-info,
.severity-pill.severity-informational { background: var(--info); color: var(--white); }

.retest-pill {
  background: var(--slate);
  color: var(--white);
}

.cvss-panel {
  display: flex;
  gap: 4mm;
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 4mm;
  margin-bottom: 5mm;
  page-break-inside: avoid;
  break-inside: avoid;
}

.cvss-score-block {
  width: 28mm;
  border-right: 1px solid var(--border);
  padding-right: 4mm;
}

.cvss-label {
  display: block;
  color: var(--muted);
  font-size: 7pt;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.cvss-score {
  display: block;
  font-size: 26pt;
  line-height: 1;
  font-weight: 900;
  color: var(--ink);
  margin-top: 1mm;
}

.cvss-value {
  display: block;
  font-weight: 900;
  color: var(--ink);
  margin-top: 1mm;
}

.cvss-vector-label {
  margin-top: 3mm;
}

.cvss-vector {
  display: block;
  font-family: Consolas, "Courier New", monospace;
  font-size: 7.8pt;
  color: var(--steel);
  word-break: break-all;
  margin-top: 1mm;
}

.finding-section {
  margin-bottom: 6mm;
  page-break-inside: auto;
}

.finding-section h2 {
  font-size: 12pt;
  margin-top: 0;
  margin-bottom: 2.5mm;
  color: var(--red-dark);
  border-bottom: 1px solid var(--border);
}

.field-description h2 {
  color: var(--slate);
}

.field-remediation h2,
.field-recommendation h2 {
  color: #166534;
}

.prose {
  font-size: 10pt;
  color: var(--ink);
}

.prose p {
  margin-bottom: 3.5mm;
}

.prose ul,
.prose ol {
  margin: 0 0 3.5mm 6mm;
  padding-left: 4mm;
}

.prose li {
  margin-bottom: 1.5mm;
}

.prose blockquote {
  margin: 4mm 0;
  padding: 3mm 4mm;
  border-left: 4px solid var(--red);
  background: var(--surface);
  color: var(--steel);
}

.prose code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 8.7pt;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  padding: 0.6mm 1.2mm;
  border-radius: 1mm;
  color: var(--red-dark);
}

.prose pre {
  margin: 4mm 0;
  padding: 4mm;
  background: #0f172a;
  color: #e5e7eb;
  border-radius: 2mm;
  font-family: Consolas, "Courier New", monospace;
  font-size: 8pt;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
}

.prose pre code {
  border: none;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.prose table {
  font-size: 9pt;
}

.prose th {
  background: var(--surface-strong);
  color: var(--slate);
  border: 1px solid var(--border);
}

.prose img {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 2mm;
  margin: 3mm 0;
  page-break-inside: avoid;
}

.prose a {
  color: var(--red);
  text-decoration: underline;
}

.annexure-block {
  margin-bottom: 8mm;
}

body {
  counter-reset: report-section;
}

h1.numbered {
  counter-increment: report-section;
  counter-reset: report-subsection;
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

.finding-title.numbered {
  counter-increment: finding-item;
}

.finding-title.numbered::before {
  content: counter(finding-item) ". ";
}`;

module.exports = {
  defaultProposalHtml,
  defaultProposalCss,
  defaultReportHtml,
  defaultReportCss,
};
