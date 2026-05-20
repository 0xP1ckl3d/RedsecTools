import { escapeHtml } from "./ui-components.js";

function safeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function cvssSeverity(score) {
  if (score == null) return "info";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

function parseCvssMetrics(vector) {
  const parts = String(vector || "").trim().split("/");
  if (!/^CVSS:(3\.[01]|4\.0)$/.test(parts[0])) return null;
  const metrics = {};
  metrics.version = parts[0].replace("CVSS:", "");
  for (const part of parts.slice(1)) {
    const [key, value] = part.split(":");
    if (key && value) metrics[key] = value;
  }
  return metrics;
}

function calculateCvssScore(vector) {
  const metrics = parseCvssMetrics(vector);
  if (!metrics) return null;
  if (metrics.version === "4.0") return calculateCvss40Score(metrics);
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const ui = { N: 0.85, R: 0.62 }[metrics.UI];
  const s = metrics.S;
  const c = { H: 0.56, L: 0.22, N: 0 }[metrics.C];
  const i = { H: 0.56, L: 0.22, N: 0 }[metrics.I];
  const a = { H: 0.56, L: 0.22, N: 0 }[metrics.A];
  if ([av, ac, ui, c, i, a].some((v) => v == null) || !["U", "C"].includes(s)) return null;
  const pr = s === "U"
    ? { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR]
    : { N: 0.85, L: 0.68, H: 0.50 }[metrics.PR];
  if (pr == null) return null;
  const iss = 1 - ((1 - c) * (1 - i) * (1 - a));
  const impact = s === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15);
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const raw = s === "U" ? impact + exploitability : 1.08 * (impact + exploitability);
  return Math.min(Math.ceil(Math.min(raw, 10) * 10) / 10, 10);
}

function calculateCvss40Score(metrics) {
  const av = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const ac = { L: 0.77, H: 0.44 }[metrics.AC];
  const at = { N: 0.85, P: 0.62 }[metrics.AT];
  const pr = { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR];
  const ui = { N: 0.85, P: 0.62, A: 0.45 }[metrics.UI];
  const impactMetric = { H: 0.56, L: 0.22, N: 0 };
  const impacts = ["VC", "VI", "VA", "SC", "SI", "SA"].map((key) => impactMetric[metrics[key]]);
  if ([av, ac, at, pr, ui, ...impacts].some((value) => value == null)) return null;
  const iss = 1 - impacts.reduce((acc, value) => acc * (1 - value), 1);
  const impact = 6.42 * iss;
  const exploitability = 8.22 * av * ac * at * pr * ui;
  if (impact <= 0) return 0;
  return Math.min(Math.ceil(Math.min(impact + exploitability, 10) * 10) / 10, 10);
}

function updateCvssScoreDisplay(inputEl, scoreEl, severitySelect = null) {
  if (!inputEl || !scoreEl) return;
  const vector = inputEl.value.trim();
  if (!vector) {
    scoreEl.textContent = "";
    return;
  }
  const score = calculateCvssScore(vector);
  if (score == null) {
    scoreEl.textContent = "Invalid CVSS vector";
    scoreEl.className = "text-sm text-error";
    return;
  }
  const severity = cvssSeverity(score);
  scoreEl.textContent = `${score.toFixed(1)} ${severity}`;
  scoreEl.className = `text-sm reporter-cvss-score-${severity}`;
  if (severitySelect) severitySelect.value = severity;
}

function cvssBuilderHtml(current = {}) {
  const sectionHtml = (title, groups) => `
    <section class="reporter-cvss-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="reporter-cvss-section-grid">
        ${groups.map(([key, label, values]) => `
          <div class="reporter-cvss-metric">
            <div class="reporter-cvss-metric-label">${escapeHtml(label)}</div>
            <div class="reporter-cvss-options" data-cvss-group="${safeAttr(key)}">
              ${values.map(([value, optionLabel]) => {
                const isActive = (current[key] || values[0][0]) === value;
                return `<button type="button" class="reporter-cvss-option${isActive ? " active" : ""}" data-cvss-metric="${safeAttr(key)}" data-cvss-value="${safeAttr(value)}">${escapeHtml(optionLabel)} (${escapeHtml(value)})</button>`;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
  const version = current.version === "4.0" ? "4.0" : "3.1";
  return `
    <div class="reporter-cvss-editor">
      <div class="reporter-cvss-editor-head">
        <div class="reporter-cvss-version-tabs">
          <button type="button" class="reporter-cvss-version-tab ${version === "4.0" ? "active" : ""}" data-cvss-version="4.0">CVSS:4.0</button>
          <button type="button" class="reporter-cvss-version-tab ${version === "3.1" ? "active" : ""}" data-cvss-version="3.1">CVSS:3.1</button>
        </div>
        <div class="reporter-cvss-scorebox" data-cvss-scorebox>
          <div class="reporter-cvss-scorebox-score">-</div>
          <div class="reporter-cvss-scorebox-level">Not rated</div>
        </div>
      </div>
      <div class="reporter-cvss-title" data-cvss-title>CVSS:${version} Editor</div>
      <div data-cvss-pane="3.1" class="${version === "3.1" ? "" : "hidden"}">
        ${sectionHtml("Base Score", [
          ["AV", "Attack Vector", [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]]],
          ["S", "Scope", [["U", "Unchanged"], ["C", "Changed"]]],
          ["AC", "Attack Complexity", [["L", "Low"], ["H", "High"]]],
          ["C", "Confidentiality", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["PR", "Privileges Required", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["I", "Integrity", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["UI", "User Interaction", [["N", "None"], ["R", "Required"]]],
          ["A", "Availability", [["N", "None"], ["L", "Low"], ["H", "High"]]],
        ])}
        ${sectionHtml("Temporal Score", [
          ["E", "Exploit Code Maturity", [["X", "Not Defined"], ["U", "Unproven"], ["P", "Proof-of-Concept"], ["F", "Functional"], ["H", "High"]]],
          ["RL", "Remediation Level", [["X", "Not Defined"], ["O", "Official Fix"], ["T", "Temporary Fix"], ["W", "Workaround"], ["U", "Unavailable"]]],
          ["RC", "Report Confidence", [["X", "Not Defined"], ["U", "Unknown"], ["R", "Reasonable"], ["C", "Confirmed"]]],
        ])}
        ${sectionHtml("Environmental Score", [
          ["CR", "Confidentiality Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["IR", "Integrity Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["AR", "Availability Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
        ])}
      </div>
      <div data-cvss-pane="4.0" class="${version === "4.0" ? "" : "hidden"}">
        ${sectionHtml("Base Score", [
          ["AV", "Attack Vector", [["N", "Network"], ["A", "Adjacent"], ["L", "Local"], ["P", "Physical"]]],
          ["AC", "Attack Complexity", [["L", "Low"], ["H", "High"]]],
          ["AT", "Attack Requirements", [["N", "None"], ["P", "Present"]]],
          ["PR", "Privileges Required", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["UI", "User Interaction", [["N", "None"], ["P", "Passive"], ["A", "Active"]]],
          ["VC", "Vulnerable System Confidentiality", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["VI", "Vulnerable System Integrity", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["VA", "Vulnerable System Availability", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["SC", "Subsequent System Confidentiality", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["SI", "Subsequent System Integrity", [["N", "None"], ["L", "Low"], ["H", "High"]]],
          ["SA", "Subsequent System Availability", [["N", "None"], ["L", "Low"], ["H", "High"]]],
        ])}
        ${sectionHtml("Threat Score", [
          ["E", "Exploit Maturity", [["X", "Not Defined"], ["U", "Unreported"], ["P", "Proof-of-Concept"], ["A", "Attacked"]]],
        ])}
        ${sectionHtml("Environmental Score", [
          ["CR", "Confidentiality Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["IR", "Integrity Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
          ["AR", "Availability Requirement", [["X", "Not Defined"], ["L", "Low"], ["M", "Medium"], ["H", "High"]]],
        ])}
      </div>
    </div>
  `;
}

function bindCvssBuilder(scope, update) {
  scope.querySelectorAll("[data-cvss-version]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const version = btn.dataset.cvssVersion;
      scope.querySelectorAll("[data-cvss-version]").forEach((tab) => tab.classList.toggle("active", tab === btn));
      scope.querySelectorAll("[data-cvss-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.cvssPane !== version));
      const title = scope.querySelector("[data-cvss-title]");
      if (title) title.textContent = `CVSS:${version} Editor`;
      update();
    });
  });
  scope.querySelectorAll("[data-cvss-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.closest("[data-cvss-group]");
      if (group) {
        group.querySelectorAll("[data-cvss-metric]").forEach((option) => option.classList.remove("active"));
      }
      btn.classList.add("active");
      update();
    });
  });
}

function updateCvssBuilderScorebox(scope, score) {
  const box = scope.querySelector("[data-cvss-scorebox]");
  if (!box) return;
  const severity = cvssSeverity(score);
  box.className = `reporter-cvss-scorebox reporter-cvss-score-${severity}`;
  const scoreEl = box.querySelector(".reporter-cvss-scorebox-score");
  const levelEl = box.querySelector(".reporter-cvss-scorebox-level");
  if (scoreEl) scoreEl.textContent = score == null ? "-" : score.toFixed(1);
  if (levelEl) levelEl.textContent = score == null ? "Invalid" : severity;
}

function buildCvssVectorFromScope(scope) {
  const values = {};
  const version = scope.querySelector("[data-cvss-version].active")?.dataset.cvssVersion || "3.1";
  const pane = scope.querySelector(`[data-cvss-pane="${version}"]`) || scope;
  pane.querySelectorAll("[data-cvss-metric].active").forEach((option) => { values[option.dataset.cvssMetric] = option.dataset.cvssValue; });
  if (version === "4.0") {
    const base = `CVSS:4.0/AV:${values.AV}/AC:${values.AC}/AT:${values.AT}/PR:${values.PR}/UI:${values.UI}/VC:${values.VC}/VI:${values.VI}/VA:${values.VA}/SC:${values.SC}/SI:${values.SI}/SA:${values.SA}`;
    const optional = ["E", "CR", "IR", "AR"]
      .filter((key) => values[key] && values[key] !== "X")
      .map((key) => `${key}:${values[key]}`);
    return [base, ...optional].join("/");
  }
  const base = `CVSS:3.1/AV:${values.AV}/AC:${values.AC}/PR:${values.PR}/UI:${values.UI}/S:${values.S}/C:${values.C}/I:${values.I}/A:${values.A}`;
  const optional = ["E", "RL", "RC", "CR", "IR", "AR"]
    .filter((key) => values[key] && values[key] !== "X")
    .map((key) => `${key}:${values[key]}`);
  return [base, ...optional].join("/");
}

export {
  cvssSeverity,
  parseCvssMetrics,
  calculateCvssScore,
  calculateCvss40Score,
  updateCvssScoreDisplay,
  cvssBuilderHtml,
  bindCvssBuilder,
  updateCvssBuilderScorebox,
  buildCvssVectorFromScope,
};
