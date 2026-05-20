import { escapeHtml, safeAttr, badge, setInlineResult, clearInlineResult } from "./ui-components.js";
import {
  cvssSeverity,
  calculateCvssScore,
  cvssBuilderHtml,
  bindCvssBuilder,
  updateCvssBuilderScorebox,
  buildCvssVectorFromScope,
} from "./cvss-calculator.js";
import { initCyberChef } from "./cyberchef-lite.js";

const state = { currentView: "cvss" };

function api(path, options = {}) {
  return fetch("/api" + path, options).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  });
}

function initSidebar() {
  document.querySelectorAll("[data-minitools-view]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.minitoolsView));
  });
  document.getElementById("minitools-sidebar-collapse-btn")?.addEventListener("click", () => {
    document.getElementById("minitools-sidebar")?.classList.toggle("collapsed");
  });
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll("[data-minitools-view]").forEach((btn) => {
    const isActive = btn.dataset.minitoolsView === view;
    btn.classList.toggle("active", isActive);
  });
  document.querySelectorAll("[id^='minitools-view-']").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `minitools-view-${view}`);
  });
}

function initCvss() {
  const container = document.getElementById("minitools-cvss-container");
  const resultEl = document.getElementById("minitools-cvss-result");
  if (!container) return;

  container.innerHTML = cvssBuilderHtml({});

  const update = () => {
    const vector = buildCvssVectorFromScope(container);
    const score = calculateCvssScore(vector);
    updateCvssBuilderScorebox(container, score);
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="minitools-cvss-output">
          <div class="flex items-center gap-3 flex-wrap">
            <code class="text-sm bg-card px-3 py-1 rounded border border-border break-all">${escapeHtml(vector)}</code>
            ${score != null ? `<span class="badge badge-${severityTone(cvssSeverity(score))}">${score.toFixed(1)} ${cvssSeverity(score)}</span>` : '<span class="text-sm text-muted">Invalid</span>'}
          </div>
        </div>
      `;
    }
  };

  bindCvssBuilder(container, update);
  update();
}

function severityTone(severity) {
  return { critical: "red", high: "orange", medium: "yellow", low: "blue", info: "gray" }[severity] || "gray";
}

function initBreach() {
  const input = document.getElementById("breach-email");
  const btn = document.getElementById("breach-check-btn");
  const resultsEl = document.getElementById("breach-results");
  const inlineEl = document.getElementById("breach-inline-result");

  if (!btn || !input) return;

  const check = async () => {
    const email = input.value.trim();
    if (!email) return;

    clearInlineResult(inlineEl);
    btn.disabled = true;
    btn.textContent = "Checking...";
    resultsEl.innerHTML = '<div class="text-sm text-muted">Looking up breach data...</div>';

    try {
      const data = await api(`/minitools/breach-check?email=${encodeURIComponent(email)}`);
      renderBreachResults(data, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Check";
    }
  };

  btn.addEventListener("click", check);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
}

function renderBreachResults(data, container) {
  const breaches = data.breaches;
  const analytics = data.analytics;

  if (!breaches || breaches.status === "error" || (breaches.breaches && breaches.breaches[0] && breaches.breaches[0].length === 0)) {
    container.innerHTML = '<div class="text-sm text-muted">No breaches found for this email address.</div>';
    return;
  }

  let html = "";

  if (analytics?.BreachMetrics?.risk) {
    const risk = analytics.BreachMetrics.risk;
    const tone = { Critical: "red", High: "orange", Moderate: "yellow", Low: "blue" }[risk.risk_label] || "gray";
    html += `
      <div class="minitools-risk-gauge mb-4">
        <span class="text-sm text-muted mr-2">Risk Score:</span>
        <span class="badge badge-${tone}">${escapeHtml(risk.risk_label)} (${risk.risk_score}/100)</span>
      </div>
    `;
  }

  const details = analytics?.ExposedBreaches?.breaches_details || [];

  if (details.length > 0) {
    html += '<div class="grid gap-3">';
    for (const b of details) {
      const pwRisk = { easytocrack: "red", hardtocrack: "blue", plaintext: "red", unknown: "gray" }[b.password_risk] || "gray";
      html += `
        <div class="minitools-breach-card card p-4">
          <div class="flex items-start justify-between gap-2 mb-2">
            <div>
              <h4 class="font-bold text-sm">${escapeHtml(b.breach)}</h4>
              <span class="text-xs text-muted">${escapeHtml(b.domain)} &middot; ${escapeHtml(b.industry)}</span>
            </div>
            <div class="flex gap-1 flex-shrink-0">
              <span class="badge badge-red">${Number(b.xposed_records).toLocaleString()} records</span>
              <span class="badge badge-${pwRisk}">PW: ${escapeHtml(b.password_risk)}</span>
            </div>
          </div>
          <p class="text-xs text-muted mb-2">${escapeHtml(b.details)}</p>
          <div class="flex gap-1 flex-wrap">
            ${b.xposed_data.split(";").map((d) => `<span class="badge badge-gray">${escapeHtml(d.trim())}</span>`).join("")}
          </div>
          <div class="text-xs text-muted mt-1">Breach date: ${escapeHtml(b.xposed_date)}</div>
        </div>
      `;
    }
    html += "</div>";
  } else if (breaches?.breaches?.[0]) {
    html += '<div class="flex flex-wrap gap-2">';
    for (const name of breaches.breaches[0]) {
      html += `<span class="badge badge-red">${escapeHtml(name)}</span>`;
    }
    html += "</div>";
  }

  if (analytics?.BreachMetrics?.passwords_strength) {
    const pw = analytics.BreachMetrics.passwords_strength;
    html += `
      <div class="mt-4 p-3 card">
        <h5 class="text-sm font-bold mb-2">Password Strength Breakdown</h5>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>Easy to crack: <span class="text-red-400 font-bold">${pw.EasyToCrack}</span></div>
          <div>Plain text: <span class="text-red-400 font-bold">${pw.PlainText}</span></div>
          <div>Strong hash: <span class="text-blue-400 font-bold">${pw.StrongHash}</span></div>
          <div>Unknown: <span class="text-muted font-bold">${pw.Unknown}</span></div>
        </div>
      </div>
    `;
  }

  if (analytics?.BreachMetrics?.yearwise_details?.[0]) {
    const years = analytics.BreachMetrics.yearwise_details[0];
    const entries = Object.entries(years).filter(([k, v]) => v > 0);
    if (entries.length > 0) {
      html += `<div class="mt-4 p-3 card"><h5 class="text-sm font-bold mb-2">Breach Timeline</h5><div class="flex gap-2 flex-wrap">`;
      for (const [year, count] of entries) {
        const label = year.replace("y", "");
        html += `<span class="badge badge-orange">${escapeHtml(label)}: ${count}</span>`;
      }
      html += "</div></div>";
    }
  }

  container.innerHTML = html || '<div class="text-sm text-muted">No detailed breach information available.</div>';
}

function initAzure() {
  const input = document.getElementById("azure-domain");
  const btn = document.getElementById("azure-lookup-btn");
  const resultsEl = document.getElementById("azure-results");
  const inlineEl = document.getElementById("azure-inline-result");

  if (!btn || !input) return;

  const lookup = async () => {
    const domain = input.value.trim();
    if (!domain) return;

    clearInlineResult(inlineEl);
    btn.disabled = true;
    btn.textContent = "Looking up...";
    resultsEl.innerHTML = '<div class="text-sm text-muted">Querying Azure tenant data...</div>';

    try {
      const data = await api(`/minitools/azure-tenant?domain=${encodeURIComponent(domain)}`);
      renderAzureResults(data, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Lookup";
    }
  };

  btn.addEventListener("click", lookup);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
}

function renderAzureResults(response, container) {
  if (response.format === "raw" || response.format === "unknown") {
    container.innerHTML = `
      <div class="minitools-azure-card card p-4">
        <p class="text-sm text-muted mb-2">Raw response from Azure mapping service (unexpected format):</p>
        <pre class="text-xs bg-card p-3 rounded border border-border overflow-auto max-h-96 whitespace-pre-wrap break-all">${escapeHtml(response.raw)}</pre>
      </div>
    `;
    return;
  }

  const d = response.data;
  if (!d || !d.tenant_id) {
    container.innerHTML = '<div class="text-sm text-muted">No Azure tenant found for this domain.</div>';
    return;
  }

  const related = d.related_domains || [];
  let html = `
    <div class="minitools-azure-card card p-4">
      <div class="grid gap-3">
        <div>
          <div class="text-xs text-muted">Tenant ID</div>
          <code class="text-sm">${escapeHtml(d.tenant_id)}</code>
        </div>
        <div>
          <div class="text-xs text-muted">Tenant Name</div>
          <div class="text-sm font-bold">${escapeHtml(d.tenant_name)}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Brand Name</div>
          <div class="text-sm">${escapeHtml(d.brand_name || "-")}</div>
        </div>
        <div>
          <div class="text-xs text-muted">Primary Domain</div>
          <div class="text-sm">${escapeHtml(d.domain)}</div>
        </div>
  `;

  if (related.length > 0) {
    html += `
      <div>
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">Related Domains</span>
            <span class="badge badge-gray">${d.related_count || related.length}</span>
          </div>
          <button type="button" id="azure-copy-all-domains" class="text-xs text-accent hover:underline">Copy all</button>
        </div>
        <div class="flex flex-wrap gap-1" id="azure-domain-list">
          ${related.map((dom) => `<span class="badge badge-gray text-xs cursor-pointer hover:text-accent transition-colors" data-azure-domain="${escapeHtml(dom)}" title="Click to copy">${escapeHtml(dom)}</span>`).join("")}
        </div>
      </div>
    `;
  }

  html += "</div></div>";
  container.innerHTML = html;

  if (related.length > 0) {
    container.querySelectorAll("[data-azure-domain]").forEach((el) => {
      el.addEventListener("click", () => {
        navigator.clipboard.writeText(el.dataset.azureDomain).then(() => {
          const orig = el.textContent;
          el.textContent = "Copied!";
          setTimeout(() => { el.textContent = orig; }, 1200);
        });
      });
    });
    document.getElementById("azure-copy-all-domains")?.addEventListener("click", (e) => {
      navigator.clipboard.writeText(related.join("\n")).then(() => {
        const btn = e.target;
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = orig; }, 1200);
      });
    });
  }
}

function initSecurityTrails() {
  const input = document.getElementById("securitytrails-domain");
  const btn = document.getElementById("securitytrails-lookup-btn");
  const resultsEl = document.getElementById("securitytrails-results");
  const inlineEl = document.getElementById("securitytrails-inline-result");

  if (!btn || !input) return;

  // Toggle styled type buttons
  const typeGroup = document.getElementById("st-type-group");
  typeGroup?.addEventListener("click", (e) => {
    const clicked = e.target.closest("[data-st-type]");
    if (!clicked) return;
    typeGroup.querySelectorAll("[data-st-type]").forEach((b) => b.classList.remove("active"));
    clicked.classList.add("active");
  });

  const lookup = async () => {
    const domain = input.value.trim();
    if (!domain) return;
    const active = typeGroup?.querySelector("[data-st-type].active");
    const type = active?.dataset.stType || "both";

    clearInlineResult(inlineEl);
    btn.disabled = true;
    btn.textContent = "Looking up...";
    resultsEl.innerHTML = '<div class="text-sm text-muted">Querying SecurityTrails...</div>';

    try {
      const data = await api(`/minitools/securitytrails/lookup?domain=${encodeURIComponent(domain)}&type=${type}`);
      updateSecurityTrailsQuota(data.quota);
      renderSecurityTrailsResults(data, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Lookup";
    }
  };

  btn.addEventListener("click", lookup);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
}

function updateSecurityTrailsQuota(quota) {
  const el = document.getElementById("securitytrails-quota");
  if (!el || !quota) return;
  const pct = Math.round((quota.used / quota.limit) * 100);
  const tone = pct >= 90 ? "red" : pct >= 70 ? "yellow" : "gray";
  el.innerHTML = `<div class="flex items-center gap-2 text-xs text-muted"><span>Daily quota:</span> <span class="badge badge-${tone}">${quota.used}/${quota.limit} used</span></div>`;
}

function renderSecurityTrailsResults(data, container) {
  const d = data.details;
  const subs = data.subdomains;

  if (!d && !subs) {
    container.innerHTML = '<div class="text-sm text-muted">No data returned from SecurityTrails.</div>';
    return;
  }

  let html = "";

  if (d) {
    // Domain overview table - scalar fields only
    const objectKeys = new Set();
    for (const [k, v] of Object.entries(d)) {
      if (v != null && typeof v === "object" && !Array.isArray(v)) objectKeys.add(k);
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") objectKeys.add(k);
    }
    const scalarKeys = Object.keys(d).filter((k) => !objectKeys.has(k) && d[k] != null && d[k] !== "" && d[k] !== false);
    if (scalarKeys.length > 0) {
      html += `<div class="card p-4 mb-4">
        <h3 class="font-bold text-sm mb-3">Domain Details</h3>
        <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>`;
      for (const key of scalarKeys) {
        const label = key.replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
        html += `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(label)}</td><td class="text-sm">${renderScalar(d[key])}</td></tr>`;
      }
      html += `</tbody></table></div></div>`;
    }

    // Tags
    if (d.tags && d.tags.length > 0) {
      html += `<div class="card p-4 mb-4">
        <h3 class="font-bold text-sm mb-3">Tags</h3>
        <div class="flex flex-wrap gap-1">${d.tags.map((t) => `<span class="badge badge-gray text-xs">${escapeHtml(String(t))}</span>`).join("")}</div>
      </div>`;
    }

    // DNS records - SecurityTrails uses "current_dns" with { type: { values: [...], first_seen: "..." } }
    const dnsData = d.current_dns || d.dns;
    if (dnsData && typeof dnsData === "object") {
      for (const [type, typeData] of Object.entries(dnsData)) {
        if (!typeData) continue;
        const values = typeData.values || (Array.isArray(typeData) ? typeData : []);
        const arr = Array.isArray(values) ? values : [];
        const firstSeen = typeData.first_seen || null;
        // Skip empty record types (e.g. aaaa: {})
        if (arr.length === 0 && !firstSeen) continue;

        const columns = arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null
          ? Object.keys(arr[0]).map((k) => prettyLabel(k))
          : ["Value"];

        html += `<div class="card p-4 mb-4">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="font-bold text-sm">${escapeHtml(type.toUpperCase())} Records</h3>
            <span class="badge badge-gray">${arr.length}</span>
            ${firstSeen ? `<span class="text-xs text-muted ml-auto">First seen: ${escapeHtml(firstSeen)}</span>` : ""}
          </div>
          <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
          <tbody>`;
        for (const rec of arr) {
          if (typeof rec === "string") {
            html += `<tr><td class="text-xs break-all">${escapeHtml(rec)}</td></tr>`;
          } else if (typeof rec === "object" && rec !== null) {
            html += `<tr>${Object.values(rec).map((v) => `<td class="text-xs break-all">${renderScalar(v)}</td>`).join("")}</tr>`;
          }
        }
        html += `</tbody></table></div></div>`;
      }
    }

    // WHOIS
    if (d.whois && typeof d.whois === "object") {
      html += `<div class="card p-4 mb-4">
        <h3 class="font-bold text-sm mb-3">WHOIS</h3>
        <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>`;
      for (const [key, val] of Object.entries(d.whois)) {
        if (val == null || val === "") continue;
        const label = key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
        html += `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(label)}</td><td class="text-sm">${renderScalar(val)}</td></tr>`;
      }
      html += `</tbody></table></div></div>`;
    }

    // Computed data
    if (d.computed && typeof d.computed === "object") {
      html += `<div class="card p-4 mb-4">
        <h3 class="font-bold text-sm mb-3">Computed</h3>
        <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>`;
      for (const [key, val] of Object.entries(d.computed)) {
        if (val == null || val === "") continue;
        html += `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(key)}</td><td class="text-sm">${renderScalar(val)}</td></tr>`;
      }
      html += `</tbody></table></div></div>`;
    }
  }

  // Subdomains table
  if (subs?.subdomains && subs.subdomains.length > 0) {
    const apex = d?.apex_domain || "";
    html += `<div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm">Subdomains <span class="badge badge-gray ml-1">${subs.subdomains.length}</span></h3>
        <button type="button" id="st-copy-all-subs" class="text-xs text-accent hover:underline">Copy all</button>
      </div>
      <div class="threat-table-wrap"><table class="threat-table">
        <thead><tr><th>#</th><th>Subdomain</th><th>FQDN</th></tr></thead>
        <tbody>
        ${subs.subdomains.map((s, i) => {
          const prefix = s || "";
          const fqdn = prefix ? `${prefix}.${apex}` : apex;
          return `<tr>
            <td class="text-xs text-muted">${i + 1}</td>
            <td class="text-xs">${escapeHtml(prefix) || '<span class="text-muted">(apex)</span>'}</td>
            <td class="text-xs"><span class="cursor-pointer hover:text-accent transition-colors" data-st-sub="${escapeHtml(fqdn)}" title="Click to copy">${escapeHtml(fqdn)}</span></td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>
    </div>`;
  } else if (subs && subs.subdomains && subs.subdomains.length === 0) {
    html += `<div class="card p-4"><h3 class="font-bold text-sm mb-2">Subdomains</h3><p class="text-sm text-muted">No subdomains found.</p></div>`;
  }

  // Extra fields from subdomain response
  if (subs) {
    const subKnown = new Set(["subdomains", "endpoint", "meta"]);
    const subExtra = Object.keys(subs).filter((k) => !subKnown.has(k) && subs[k] != null);
    if (subExtra.length > 0) {
      html += `<div class="card p-4 mt-4">
        <h3 class="font-bold text-sm mb-3">Additional Data</h3>
        <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>`;
      for (const key of subExtra) {
        html += `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(key)}</td><td class="text-sm">${renderScalar(subs[key])}</td></tr>`;
      }
      html += `</tbody></table></div></div>`;
    }
  }

  container.innerHTML = html;

  // Bind copy handlers
  container.querySelectorAll("[data-st-sub]").forEach((el) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(el.dataset.stSub).then(() => {
        const orig = el.textContent;
        el.textContent = "Copied!";
        setTimeout(() => { el.textContent = orig; }, 1200);
      });
    });
  });
  document.getElementById("st-copy-all-subs")?.addEventListener("click", (e) => {
    const allSubs = Array.from(container.querySelectorAll("[data-st-sub]")).map((el) => el.dataset.stSub);
    navigator.clipboard.writeText(allSubs.join("\n")).then(() => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1200);
    });
  });
}

function initLeakRadar() {
  const input = document.getElementById("leakradar-domain");
  const typeGroup = document.getElementById("leakradar-type-group");
  const searchBtn = document.getElementById("leakradar-search-btn");
  const unlockedBtn = document.getElementById("leakradar-unlocked-btn");
  const loadMoreBtn = document.getElementById("leakradar-load-more-btn");
  const resultsEl = document.getElementById("leakradar-results");
  const inlineEl = document.getElementById("leakradar-inline-result");
  if (!input || !searchBtn || !resultsEl) return;

  const leakState = { mode: "search", type: "employees", domain: "", page: 1, nextPage: null };

  typeGroup?.addEventListener("click", (event) => {
    const clicked = event.target.closest("[data-leakradar-type]");
    if (!clicked) return;
    typeGroup.querySelectorAll("[data-leakradar-type]").forEach((button) => button.classList.remove("active"));
    clicked.classList.add("active");
  });

  const run = async ({ mode = "search", page = 1, append = false } = {}) => {
    const domain = input.value.trim();
    if (!domain && mode !== "unlocked") return;
    const activeType = typeGroup?.querySelector("[data-leakradar-type].active")?.dataset.leakradarType || "employees";
    const type = mode === "unlocked" ? "unlocked" : activeType;
    const button = mode === "unlocked" ? unlockedBtn : searchBtn;
    const originalLabel = button?.textContent;

    leakState.mode = mode;
    leakState.type = type;
    leakState.domain = domain;
    leakState.page = page;
    clearInlineResult(inlineEl);
    if (button) {
      button.disabled = true;
      button.textContent = append ? "Loading..." : "Querying...";
    }
    if (loadMoreBtn) loadMoreBtn.classList.add("hidden");
    if (!append) {
      resultsEl.innerHTML = '<div class="text-sm text-muted">Querying LeakRadar...</div>';
    }

    try {
      const endpoint = mode === "unlocked" ? "/minitools/leakradar/unlocked" : "/minitools/leakradar/search";
      const params = new URLSearchParams({ page: String(page) });
      if (domain) params.set("domain", domain);
      if (mode !== "unlocked") params.set("type", type);
      const data = await api(`${endpoint}?${params.toString()}`);
      leakState.nextPage = data.nextPage || null;
      leakState.page = data.page || page;
      renderLeakRadarResults(data, resultsEl, { append, mode, type });
      if (loadMoreBtn) {
        loadMoreBtn.classList.toggle("hidden", !data.hasMore);
        loadMoreBtn.textContent = "Load Next Page";
      }
    } catch (err) {
      if (append) {
        setInlineResult(inlineEl, err.message || "LeakRadar request failed", false);
      } else {
        resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  };

  searchBtn.addEventListener("click", () => run({ mode: "search", page: 1 }));
  unlockedBtn?.addEventListener("click", () => run({ mode: "unlocked", page: 1 }));
  loadMoreBtn?.addEventListener("click", () => {
    if (!leakState.nextPage) return;
    run({ mode: leakState.mode, page: leakState.nextPage, append: true });
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") run({ mode: "search", page: 1 }); });

  resultsEl.addEventListener("click", async (event) => {
    const pageBtn = event.target.closest("[data-leakradar-page]");
    if (pageBtn) {
      const page = Number(pageBtn.dataset.leakradarPage || 1);
      if (Number.isFinite(page) && page >= 1) {
        run({ mode: leakState.mode, page, append: false });
      }
      return;
    }

    const unlockBtn = event.target.closest("[data-leakradar-unlock]");
    if (!unlockBtn) return;
    const leakId = unlockBtn.dataset.leakradarUnlock;
    unlockBtn.disabled = true;
    const original = unlockBtn.textContent;
    unlockBtn.textContent = "Unlocking...";
    try {
      const unlockResponse = await api("/minitools/leakradar/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leakId, domain: leakState.domain }),
      });
      updateLeakRadarUnlockedRow(resultsEl, leakId, unlockResponse.unlockedRecord || unlockResponse.data);
      unlockBtn.textContent = "Unlocked";
      unlockBtn.classList.remove("btn-primary");
      unlockBtn.classList.add("btn-secondary");
    } catch (err) {
      unlockBtn.disabled = false;
      unlockBtn.textContent = original;
      setInlineResult(inlineEl, err.message || "Unlock failed", false);
    }
  });
}

function leakRadarArrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const candidates = [
    payload.items,
    payload.data,
    payload.results,
    payload.leaks,
    payload.unlocked,
    payload.records,
    payload.data?.items,
    payload.data?.results,
    payload.data?.leaks,
    payload.data?.unlocked,
  ];
  return candidates.find(Array.isArray) || [];
}

function extractLeakRadarUnlockedItem(payload, leakId) {
  if (!payload || typeof payload !== "object") return null;
  const items = leakRadarArrayFromPayload(payload);
  if (items.length) {
    return items.find((item) => getLeakRadarItemId(item) === leakId) || items[0];
  }
  if (getLeakRadarItemId(payload) === leakId || Object.keys(payload).length) return payload;
  return null;
}

function leakRadarUnlockedPassword(item) {
  const direct = leakRadarFirstValue(item, LEAKRADAR_PASSWORD_KEYS);
  if (direct) return direct;
  if (!item || typeof item !== "object") return "";
  for (const value of Object.values(item)) {
    if (value && typeof value === "object") {
      const nested = leakRadarUnlockedPassword(value);
      if (nested) return nested;
    }
  }
  return "";
}

function updateLeakRadarUnlockedRow(container, leakId, payload) {
  const row = container?.querySelector(`[data-leakradar-row="${CSS.escape(leakId)}"]`);
  if (!row) return;
  const unlockedItem = extractLeakRadarUnlockedItem(payload, leakId);
  const password = leakRadarUnlockedPassword(unlockedItem);
  const passwordCell = row.querySelector("[data-leakradar-password-cell]");
  if (passwordCell && password) {
    passwordCell.innerHTML = leakRadarCompactValue(password);
  }
  const metaCell = row.querySelector("[data-leakradar-meta-cell]");
  if (metaCell && unlockedItem) {
    const meta = leakRadarMetaValue(unlockedItem);
    if (meta) metaCell.innerHTML = leakRadarCompactValue(meta);
  }
}

function getLeakRadarItemId(item) {
  if (!item || typeof item !== "object") return "";
  return String(item.id || item.leak_id || item.leakId || item.uuid || item._id || item.hash || "").trim();
}

const LEAKRADAR_ACCOUNT_KEYS = [
  "username_masked", "usernameMasked", "masked_username", "maskedUsername",
  "email", "email_address", "emailAddress", "mail", "username", "user_name", "userName",
  "user", "login", "account", "account_name", "accountName", "credential_username",
  "credential_email", "employee_email", "customer_email", "third_party_email", "identifier",
];
const LEAKRADAR_DOMAIN_URL_KEYS = ["url", "uri", "domain", "url_domain", "url_host", "host", "hostname", "subdomain", "email_domain", "email_host"];
const LEAKRADAR_SOURCE_KEYS = ["source", "breach", "breach_name", "breachName", "database", "collection", "leak_name", "leakName", "dataset", "compromise"];
const LEAKRADAR_PASSWORD_KEYS = ["password", "password_plain", "plaintext_password", "cleartext_password", "secret", "credential", "password_hash", "hash", "password_type", "hash_type"];
const LEAKRADAR_META_KEYS = [
  "added_at", "addedAt", "date", "leaked_at", "leakedAt", "breach_date", "breachDate", "compromised_at", "compromisedAt",
  "created_at", "createdAt", "updated_at", "updatedAt", "unlocked_at", "unlockedAt",
  "last_seen", "lastSeen", "indexed_at", "indexedAt", "published_at", "publishedAt",
  "list", "comment", "status", "type", "category", "severity", "confidence", "malware_family", "malwareFamily",
];
const LEAKRADAR_META_EXTRA_KEYS = ["password_strength", "passwordStrength", "status", "category", "is_email", "isEmail", "unlocked"];

function renderLeakRadarResults(data, container, { append = false, mode = "search", type = "employees" } = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  const header = `
    <div class="card p-4 mb-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div class="text-xs text-muted">LeakRadar ${mode === "unlocked" ? "Unlocked History" : prettyLabel(type)}</div>
          <h3 class="font-bold text-sm mt-1">${escapeHtml(data.domain || (mode === "unlocked" ? "All unlocked records" : ""))}</h3>
        </div>
        <div class="flex gap-2 flex-wrap">
          ${badge(`${items.length} loaded`, "gray")}
          ${data.total != null ? badge(`${Number(data.total).toLocaleString()} total`, "blue") : ""}
          ${badge(`Page ${data.page || 1}`, "gray")}
          ${Number(data.page || 1) > 1 ? `<button type="button" class="btn-secondary text-xs px-2 py-1" data-leakradar-page="${Number(data.page || 1) - 1}">Prev</button>` : ""}
          ${data.nextPage ? `<button type="button" class="btn-secondary text-xs px-2 py-1" data-leakradar-page="${Number(data.nextPage)}">Next</button>` : ""}
        </div>
      </div>
    </div>
  `;
  if (!append && items.length === 0) {
    container.innerHTML = header + '<div class="card p-4 text-sm text-muted">No LeakRadar results returned for this query.</div>';
    return;
  }

  const unlockedById = data.unlockedById || {};
  const itemHtml = items.map((item) => renderLeakRadarTableRow(item, { mode, type, unlockedById })).join("");
  if (append) {
    const tbody = container.querySelector("#leakradar-result-body");
    if (tbody) tbody.insertAdjacentHTML("beforeend", itemHtml);
    else container.insertAdjacentHTML("beforeend", leakRadarTableHtml(itemHtml));
  } else {
    container.innerHTML = header + leakRadarTableHtml(itemHtml);
  }
}

function leakRadarTableHtml(rowsHtml) {
  return `
    <div class="card p-0 overflow-hidden">
      <div class="threat-table-wrap">
        <table class="threat-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Domain / URL</th>
              <th>Source</th>
              <th>Password / Hash</th>
              <th>Meta</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="leakradar-result-body">${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function leakRadarFirstValue(item, keys, seen = new WeakSet()) {
  if (!item || typeof item !== "object") return "";
  if (seen.has(item)) return "";
  seen.add(item);
  for (const key of keys) {
    if (item[key] !== null && item[key] !== undefined && item[key] !== "") return item[key];
  }
  for (const value of Object.values(item)) {
    if (value && typeof value === "object") {
      const nested = leakRadarFirstValue(value, keys, seen);
      if (nested !== null && nested !== undefined && nested !== "") return nested;
    }
  }
  return "";
}

function leakRadarCompactValue(value) {
  if (value === null || value === undefined || value === "") return '<span class="text-muted">-</span>';
  if (Array.isArray(value)) return value.length ? escapeHtml(value.slice(0, 4).map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ")) : '<span class="text-muted">-</span>';
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return escapeHtml(String(value));
}

function leakRadarDisplayDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function leakRadarMetaValue(item) {
  const date = leakRadarFirstValue(item, LEAKRADAR_META_KEYS);
  const parts = [];
  if (date) parts.push(leakRadarDisplayDate(date));
  for (const key of LEAKRADAR_META_EXTRA_KEYS) {
    const value = leakRadarFirstValue(item, [key]);
    if (value === null || value === undefined || value === "" || value === date) continue;
    parts.push(`${prettyLabel(key)}: ${typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}`);
  }
  return parts.join(" | ");
}

function renderLeakRadarTableRow(item, { mode, type, unlockedById = {} }) {
  if (typeof item === "string") {
    const stringCell = `<span class="text-xs font-mono break-all">${escapeHtml(item)}</span>`;
    return type === "subdomains"
      ? `<tr><td class="text-xs text-muted">-</td><td>${stringCell}</td><td colspan="3"></td><td class="text-xs text-muted">-</td></tr>`
      : `<tr><td>${stringCell}</td><td colspan="4"></td><td class="text-xs text-muted">-</td></tr>`;
  }
  const id = getLeakRadarItemId(item);
  const cachedItem = id && unlockedById && typeof unlockedById === "object" ? unlockedById[id] : null;
  const displayItem = cachedItem ? { ...(item || {}), ...cachedItem } : item;
  const account = leakRadarFirstValue(displayItem, LEAKRADAR_ACCOUNT_KEYS);
  const canUnlock = mode !== "unlocked" && type !== "subdomains" && id && !cachedItem;
  const domainOrUrl = leakRadarFirstValue(displayItem, LEAKRADAR_DOMAIN_URL_KEYS);
  const source = leakRadarFirstValue(displayItem, LEAKRADAR_SOURCE_KEYS);
  const password = leakRadarFirstValue(displayItem, LEAKRADAR_PASSWORD_KEYS);
  const meta = leakRadarMetaValue(displayItem);
  return `
    <tr ${id ? `data-leakradar-row="${safeAttr(id)}"` : ""}>
      <td class="text-xs break-all">${leakRadarCompactValue(account)}</td>
      <td class="text-xs break-all">${leakRadarCompactValue(domainOrUrl)}</td>
      <td class="text-xs break-all">${leakRadarCompactValue(source)}</td>
      <td class="text-xs break-all" data-leakradar-password-cell>${leakRadarCompactValue(password)}</td>
      <td class="text-xs break-all" data-leakradar-meta-cell>${leakRadarCompactValue(meta)}</td>
      <td class="text-xs whitespace-nowrap">${canUnlock ? `<button type="button" class="btn-primary text-sm whitespace-nowrap" data-leakradar-unlock="${safeAttr(id)}">Unlock</button>` : cachedItem || mode === "unlocked" ? '<span class="badge badge-green text-xs">Unlocked</span>' : '<span class="text-muted">-</span>'}</td>
    </tr>
  `;
}

function renderScalar(val) {
  if (val == null || val === "") return '<span class="text-muted">-</span>';
  if (Array.isArray(val)) {
    return val.map((v) => `<span class="badge badge-gray text-xs">${escapeHtml(String(v))}</span>`).join(" ");
  }
  if (typeof val === "object") {
    return `<code class="text-xs break-all">${escapeHtml(JSON.stringify(val))}</code>`;
  }
  if (typeof val === "boolean") {
    return val ? '<span class="badge badge-green text-xs">Yes</span>' : '<span class="badge badge-gray text-xs">No</span>';
  }
  if (typeof val === "number") {
    return `<span>${Number(val).toLocaleString()}</span>`;
  }
  return escapeHtml(String(val));
}

function prettyLabel(key) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
}

const SECURITY_HEADERS_SAMPLE = `HTTP/2 200
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Set-Cookie: redsec_session=example; Secure; HttpOnly; SameSite=Strict`;

function initSecurityHeaders() {
  const urlInput = document.getElementById("security-headers-url");
  const fetchBtn = document.getElementById("security-headers-fetch-btn");
  const rawInput = document.getElementById("security-headers-raw");
  const analyzeBtn = document.getElementById("security-headers-analyze-btn");
  const sampleBtn = document.getElementById("security-headers-sample-btn");
  const clearBtn = document.getElementById("security-headers-clear-btn");
  const resultsEl = document.getElementById("security-headers-results");
  const inlineEl = document.getElementById("security-headers-inline-result");

  const analyze = async (payload, busyButton, busyLabel) => {
    clearInlineResult(inlineEl);
    if (!resultsEl) return;
    const originalLabel = busyButton?.textContent;
    if (busyButton) {
      busyButton.disabled = true;
      busyButton.textContent = busyLabel;
    }
    resultsEl.innerHTML = '<div class="text-sm text-muted">Analyzing security headers...</div>';
    try {
      const data = await api("/minitools/security-headers/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      renderSecurityHeadersResults(data, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
    } finally {
      if (busyButton) {
        busyButton.disabled = false;
        busyButton.textContent = originalLabel;
      }
    }
  };

  fetchBtn?.addEventListener("click", () => {
    const url = urlInput?.value.trim();
    if (!url) return;
    analyze({ mode: "url", url }, fetchBtn, "Fetching...");
  });
  urlInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") fetchBtn?.click(); });
  analyzeBtn?.addEventListener("click", () => {
    const rawHeaders = rawInput?.value || "";
    if (!rawHeaders.trim()) return;
    analyze({ mode: "raw", rawHeaders }, analyzeBtn, "Analyzing...");
  });
  sampleBtn?.addEventListener("click", () => {
    if (rawInput) rawInput.value = SECURITY_HEADERS_SAMPLE;
  });
  clearBtn?.addEventListener("click", () => {
    if (rawInput) rawInput.value = "";
    if (resultsEl) resultsEl.innerHTML = "";
    clearInlineResult(inlineEl);
  });
}

function gradeTone(grade) {
  return { A: "green", B: "blue", C: "amber", D: "amber", E: "red", F: "red" }[grade] || "gray";
}

function findingTone(status) {
  return { pass: "green", warn: "amber", fail: "red", info: "blue" }[status] || "gray";
}

function securityHeaderStatusLabel(status) {
  return { pass: "Pass", warn: "Warning", fail: "Fail", info: "Info" }[status] || prettyLabel(status || "Info");
}

function securityHeaderBadge(label, tone, extraClass = "") {
  return badge(label, tone, `minitools-security-badge ${extraClass}`.trim());
}

function renderSecurityHeadersResults(data, container) {
  const analysis = data.analysis || {};
  const findings = analysis.findings || [];
  const counts = analysis.counts || {};
  const observed = analysis.observedHeaders || {};
  const sourceLine = data.source ? `<div class="text-xs text-muted mt-1">Source: ${escapeHtml(data.source)}${data.status ? ` &middot; HTTP ${escapeHtml(data.status)}` : ""}</div>` : "";

  let html = `
    <div class="card p-4 mb-4">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div class="text-xs text-muted">Security Grade</div>
          <div class="flex items-center gap-3 mt-1">
            ${securityHeaderBadge(`Grade ${analysis.grade || "?"}`, gradeTone(analysis.grade), "minitools-security-grade-badge")}
            <span class="text-sm text-muted">${Number(analysis.score || 0)}/100</span>
          </div>
          ${sourceLine}
        </div>
        <div class="minitools-security-counts">
          ${securityHeaderBadge(`Pass ${counts.pass || 0}`, "green", "minitools-security-count-badge")}
          ${securityHeaderBadge(`Warning ${counts.warn || 0}`, "amber", "minitools-security-count-badge")}
          ${securityHeaderBadge(`Fail ${counts.fail || 0}`, "red", "minitools-security-count-badge")}
          ${securityHeaderBadge(`Info ${counts.info || 0}`, "blue", "minitools-security-count-badge")}
        </div>
      </div>
    </div>
    <div class="grid gap-3">
      ${findings.map((item) => `
        <div class="card p-4">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                ${securityHeaderBadge(securityHeaderStatusLabel(item.status), findingTone(item.status), "minitools-security-status-badge")}
                <h3 class="font-bold text-sm">${escapeHtml(item.title)}</h3>
              </div>
              <div class="text-xs text-muted mt-1">${escapeHtml(item.header || "")}</div>
            </div>
          </div>
          ${item.observed ? `<div class="text-xs mb-2"><span class="text-muted">Observed:</span> <code class="break-all">${escapeHtml(item.observed)}</code></div>` : ""}
          <p class="text-sm text-muted">${escapeHtml(item.recommendation || "")}</p>
          ${item.fix ? `<pre class="mt-3 text-xs bg-card p-3 rounded border border-border overflow-auto whitespace-pre-wrap break-all">${escapeHtml(item.fix)}</pre>` : ""}
        </div>
      `).join("")}
    </div>
  `;

  const observedEntries = Object.entries(observed);
  if (observedEntries.length) {
    html += `
      <div class="card p-4 mt-4">
        <h3 class="font-bold text-sm mb-3">Observed Headers</h3>
        <div class="threat-table-wrap"><table class="threat-table">
          <thead><tr><th>Header</th><th>Value</th></tr></thead>
          <tbody>
            ${observedEntries.map(([name, value]) => `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(name)}</td><td class="text-xs break-all">${escapeHtml(value)}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function tlsSeverityTone(severity) {
  return { critical: "red", high: "red", medium: "amber", low: "blue", info: "gray" }[String(severity || "").toLowerCase()] || "gray";
}

function tlsBadge(label, tone, extraClass = "") {
  return badge(label, tone, `minitools-security-badge ${extraClass}`.trim());
}

function initTlsCheck() {
  const targetInput = document.getElementById("tls-check-target");
  const dnsInput = document.getElementById("tls-check-dns");
  const ctInput = document.getElementById("tls-check-ct");
  const ciphersInput = document.getElementById("tls-check-ciphers");
  const runBtn = document.getElementById("tls-check-run-btn");
  const inlineEl = document.getElementById("tls-check-inline-result");
  const resultsEl = document.getElementById("tls-check-results");
  if (!targetInput || !runBtn || !resultsEl) return;

  const run = async () => {
    const target = targetInput.value.trim();
    if (!target) return;
    clearInlineResult(inlineEl);
    runBtn.disabled = true;
    runBtn.textContent = ciphersInput?.checked ? "Scanning..." : "Checking...";
    resultsEl.innerHTML = '<div class="text-sm text-muted">Running TLS checks from the app server...</div>';
    try {
      const data = await api("/minitools/tls-check/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          includeDns: !!dnsInput?.checked,
          includeCt: !!ctInput?.checked,
          includeCiphers: !!ciphersInput?.checked,
          timeoutMs: ciphersInput?.checked ? 10000 : 6000,
        }),
      });
      renderTlsCheckResults(data, resultsEl);
    } catch (err) {
      resultsEl.innerHTML = `<div class="text-sm text-error">${escapeHtml(err.message)}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = "Run TLS Check";
    }
  };

  runBtn.addEventListener("click", run);
  targetInput.addEventListener("keydown", (event) => { if (event.key === "Enter") run(); });
  resultsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tls-export]");
    if (!button || !resultsEl.__tlsPayload) return;
    const type = button.dataset.tlsExport;
    const content = type === "json" ? JSON.stringify(resultsEl.__tlsPayload, null, 2)
      : type === "csv" ? tlsToCsv(resultsEl.__tlsPayload)
        : tlsToMarkdown(resultsEl.__tlsPayload);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tls-check-${(resultsEl.__tlsPayload.host || "target").replace(/[^a-z0-9.-]+/gi, "_")}.${type === "json" ? "json" : type === "csv" ? "csv" : "md"}`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function formatTlsValue(value) {
  if (value === null || value === undefined || value === "") return '<span class="text-muted">-</span>';
  if (Array.isArray(value)) return value.length ? value.map((item) => `<span class="badge badge-gray text-xs mr-1 mb-1">${escapeHtml(String(item))}</span>`).join("") : '<span class="text-muted">-</span>';
  if (typeof value === "boolean") return value ? tlsBadge("Yes", "green") : tlsBadge("No", "gray");
  if (typeof value === "object") return `<pre class="text-xs whitespace-pre-wrap break-all">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return escapeHtml(String(value));
}

function tlsProtocolStatusBadge(version, accepted) {
  const isLegacy = version === "SSLv3" || version === "SSLv2" || version === "TLSv1" || version === "TLSv1.1";
  const isCurrent = version === "TLSv1.3";
  if (accepted) {
    const tone = isCurrent ? "green" : version === "TLSv1.2" ? "amber" : "red";
    return `<span class="flex items-center gap-2"><span class="font-bold">${escapeHtml(version)}</span>${tlsBadge("Accepted", tone)}</span>`;
  }
  // Not accepted — missing TLSv1.3 is a concern, deprecated missing is good
  const tone = isCurrent ? "amber" : "green";
  return `<span class="flex items-center gap-2"><span class="font-bold">${escapeHtml(version)}</span>${tlsBadge("Not accepted", tone)}</span>`;
}

function tlsCipherRatingBadge(rating) {
  const tone = rating === "strong" ? "green" : rating === "weak" ? "amber" : rating === "broken" ? "red" : "gray";
  return tlsBadge(rating ? rating.toUpperCase() : "UNKNOWN", tone);
}

function tlsDnsStatusBadge(label, good, warning) {
  if (good) return `<span class="flex items-center gap-2">${tlsBadge(label, "green")}</span>`;
  if (warning) return `<span class="flex items-center gap-2">${tlsBadge(label, "amber")}</span>`;
  return `<span class="flex items-center gap-2">${tlsBadge(label, "red")}</span>`;
}

function detailRows(rows) {
  return `<div class="threat-table-wrap"><table class="threat-table"><tbody>${rows.map(([label, value]) => `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(label)}</td><td class="text-xs break-all">${formatTlsValue(value)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderTlsCheckResults(data, container) {
  container.__tlsPayload = data;
  if (!data.success) {
    container.innerHTML = `<div class="card p-4"><h3 class="font-bold text-sm text-error">TLS check failed</h3><p class="text-sm text-muted mt-1">${escapeHtml(data.error || "Unknown error")}</p></div>`;
    return;
  }
  const cert = data.certificate || {};
  const issues = data.issues || [];
  const counts = data.counts || {};
  const dns = data.dns || {};
  const tlsInfo = data.tls || {};
  const highest = issues.find((item) => item.severity !== "info")?.severity || "info";
  let html = `
    <div class="card p-4 mb-4">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="text-xs text-muted">TLS Target</div>
          <h3 class="text-lg font-bold mt-1">${escapeHtml(data.target || "")}</h3>
          <div class="text-xs text-muted mt-1">Certificate source IP: ${escapeHtml(data.certSourceIp || "-")}</div>
        </div>
        <div class="minitools-security-counts">
          ${tlsBadge(`Risk ${prettyLabel(highest)}`, tlsSeverityTone(highest), "minitools-security-count-badge")}
          ${tlsBadge(`Critical ${counts.critical || 0}`, "red", "minitools-security-count-badge")}
          ${tlsBadge(`High ${counts.high || 0}`, "red", "minitools-security-count-badge")}
          ${tlsBadge(`Medium ${counts.medium || 0}`, "amber", "minitools-security-count-badge")}
          ${tlsBadge(`Low ${counts.low || 0}`, "blue", "minitools-security-count-badge")}
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        <button type="button" class="btn-secondary" data-tls-export="json">Export JSON</button>
        <button type="button" class="btn-secondary" data-tls-export="csv">Export CSV</button>
        <button type="button" class="btn-secondary" data-tls-export="md">Export Markdown</button>
      </div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card p-4">
        <h3 class="font-bold text-sm mb-3">Certificate</h3>
        ${detailRows([
          ["Subject", cert.subject],
          ["Issuer", cert.issuer],
          ["Common Names", cert.commonNames],
          ["SAN Entries", cert.sanEntries],
          ["Serial Number", cert.serialNumber],
          ["Valid From", cert.notBefore],
          ["Valid To", cert.notAfter],
          ["Days Remaining", data.validity?.daysRemaining],
          ["SHA1", cert.sha1],
          ["SHA256", cert.sha256],
          ["Signature Algorithm", cert.signatureAlgorithm],
          ["Public Key Type", cert.publicKeyType],
          ["Public Key Size", cert.publicKeySize],
          ["Version", cert.version],
          ["Basic Constraints", cert.basicConstraints],
          ["Key Usage", cert.keyUsage],
          ["Extended Key Usage", cert.extendedKeyUsage],
        ])}
      </div>
      <div class="card p-4">
        <h3 class="font-bold text-sm mb-3">TLS Context</h3>
        ${detailRows([
          ["TLS Version", tlsInfo.version],
          ["Cipher Suite", tlsInfo.cipher],
          ["Cipher Bits", tlsInfo.cipherBits],
          ["ALPN", tlsInfo.alpn],
          ["Chain Length", data.chainLength],
          ["Discovered SAN DNS", data.discoveredSanDns],
        ])}
      </div>
    </div>
  `;
  if (data.chain?.length) {
    html += `<div class="card p-4 mt-4"><h3 class="font-bold text-sm mb-3">Certificate Chain</h3>${detailRows(data.chain.map((item, index) => [`#${index + 1}`, `${item.subject || "-"} | issuer: ${item.issuer || "-"} | sha256: ${item.sha256 || "-"}`]))}</div>`;
  }
  if (data.dns) {
    // Color-coded DNS fields
    const dnsRows = [];
    dnsRows.push(["Resolved IPv4", dns.resolvedIpv4]);
    dnsRows.push(["Resolved IPv6", dns.resolvedIpv6]);
    dnsRows.push(["Nameservers", dns.nameservers]);
    dnsRows.push(["MX Records", dns.mxRecords]);

    // Cert consistency — green if consistent, red if not
    if (dns.certConsistent === null) {
      dnsRows.push(["Cert Consistent", { label: "N/A (single IP)", good: false, warning: false, na: true }]);
    } else if (dns.certConsistent === true) {
      dnsRows.push(["Cert Consistent", { label: "Consistent", good: true }]);
    } else {
      dnsRows.push(["Cert Consistent", { label: "INCONSISTENT — different certs on different IPs", good: false }]);
    }
    if (dns.ipCertFingerprints && typeof dns.ipCertFingerprints === "object") {
      const fpEntries = Object.entries(dns.ipCertFingerprints);
      dnsRows.push(["Per-IP Fingerprints", fpEntries.map(([ip, fp]) => `${ip} → ${fp}`).join("\n")]);
    }

    // CAA — green if present, red if none
    if (dns.caaRecords && dns.caaRecords.length) {
      dnsRows.push(["CAA Records", { label: dns.caaRecords.join(", "), good: true }]);
    } else if (Array.isArray(dns.caaRecords) && dns.caaRecords.length === 0) {
      dnsRows.push(["CAA Records", { label: "None — any CA may issue certificates", good: false, warning: true }]);
    } else {
      dnsRows.push(["CAA Records", dns.caaRecords]);
    }

    // SPF — green for -all, amber for ~all, red for +all/?all/missing
    if (dns.spfRecord === null) {
      dnsRows.push(["SPF", { label: "Not present — spoofing risk", good: false, warning: true }]);
    } else {
      const spfLower = dns.spfRecord.toLowerCase();
      if (spfLower.includes("-all")) dnsRows.push(["SPF", { label: dns.spfRecord, good: true }]);
      else if (spfLower.includes("~all")) dnsRows.push(["SPF", { label: dns.spfRecord + " (softfail)", good: false, warning: true }]);
      else dnsRows.push(["SPF", { label: dns.spfRecord + " (permissive)", good: false }]);
    }

    // DMARC — green for reject, amber for quarantine, red for none
    if (dns.dmarcRecord === null) {
      dnsRows.push(["DMARC", { label: "Not present — no enforcement policy", good: false, warning: true }]);
    } else {
      const dmarcLower = dns.dmarcRecord.toLowerCase();
      if (dmarcLower.includes("p=reject")) dnsRows.push(["DMARC", { label: dns.dmarcRecord, good: true }]);
      else if (dmarcLower.includes("p=quarantine")) dnsRows.push(["DMARC", { label: dns.dmarcRecord + " (quarantine only)", good: false, warning: true }]);
      else if (dmarcLower.includes("p=none")) dnsRows.push(["DMARC", { label: dns.dmarcRecord + " (no enforcement)", good: false }]);
      else dnsRows.push(["DMARC", { label: dns.dmarcRecord, good: true }]);
    }

    // DNSSEC — green if enabled, red if not
    if (dns.dnssec === true) {
      dnsRows.push(["DNSSEC", { label: "Enabled (DS records present)", good: true }]);
    } else if (dns.dnssec === false) {
      dnsRows.push(["DNSSEC", { label: "Not detected — cache poisoning possible", good: false, warning: true }]);
    } else {
      dnsRows.push(["DNSSEC", dns.dnssec]);
    }

    // Zone transfer — red if SUCCESS, green if blocked
    const zt = String(dns.zoneTransfer || "");
    if (zt.startsWith("SUCCESS")) {
      dnsRows.push(["Zone Transfer", { label: dns.zoneTransfer + " — ZONE TRANSFER OPEN", good: false }]);
    } else if (zt.includes("blocked")) {
      dnsRows.push(["Zone Transfer", { label: dns.zoneTransfer, good: true }]);
    } else {
      dnsRows.push(["Zone Transfer", dns.zoneTransfer]);
    }

    // Wildcard DNS — green if no, amber if yes
    if (dns.wildcardDns === true) {
      dnsRows.push(["Wildcard DNS", { label: "Active — random subdomains resolve", good: false, warning: true }]);
    } else if (dns.wildcardDns === false) {
      dnsRows.push(["Wildcard DNS", { label: "Not active", good: true }]);
    } else {
      dnsRows.push(["Wildcard DNS", dns.wildcardDns]);
    }

    html += `<div class="card p-4 mt-4"><h3 class="font-bold text-sm mb-3">DNS Resolution And Security</h3><div class="threat-table-wrap"><table class="threat-table"><tbody>${dnsRows.map(([label, value]) => {
      let valHtml;
      if (value && typeof value === "object" && !Array.isArray(value) && ("good" in value || "warning" in value)) {
        const tone = value.good ? "green" : value.warning ? "amber" : "red";
        valHtml = `<span class="flex items-center gap-2">${tlsBadge(value.label, tone)}</span>`;
      } else {
        valHtml = formatTlsValue(value);
      }
      return `<tr><td class="text-xs text-muted whitespace-nowrap">${escapeHtml(label)}</td><td class="text-xs break-all">${valHtml}</td></tr>`;
    }).join("")}</tbody></table></div></div>`;
  }
  if (data.ctNames?.length) {
    html += `<div class="card p-4 mt-4"><h3 class="font-bold text-sm mb-3">Certificate Transparency Names</h3><div class="flex flex-wrap gap-1">${data.ctNames.slice(0, 120).map((name) => `<span class="badge badge-gray text-xs">${escapeHtml(name)}</span>`).join("")}</div></div>`;
  }
  if (data.cipherScan) {
    const proto = data.cipherScan.protocolSupport || {};
    const grouped = data.cipherScan.grouped || {};
    const versionNotes = data.cipherScan.versionNotes || {};
    const notes = data.cipherScan.notes || [];
    const allVersions = ["TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1", "SSLv3", "SSLv2"];

    html += `<div class="card p-4 mt-4"><h3 class="font-bold text-sm mb-3">Cipher Scan</h3>`;

    // Protocol support as styled labels
    html += `<h4 class="text-xs font-bold text-muted uppercase mt-2 mb-2">Protocol Support</h4>`;
    html += `<div class="threat-table-wrap mb-3"><table class="threat-table"><tbody>`;
    for (const ver of allVersions) {
      const accepted = !!proto[ver];
      html += `<tr><td class="text-xs font-bold whitespace-nowrap">${escapeHtml(ver)}</td><td class="text-xs">${tlsProtocolStatusBadge(ver, accepted)}</td></tr>`;
    }
    html += `</tbody></table></div>`;

    // Per-version cipher groups — single table so columns align
    const groupKeys = Object.keys(grouped);
    if (groupKeys.length) {
      html += `<div class="overflow-x-auto mt-3"><table class="w-full border-collapse text-sm"><thead><tr><th class="w-24 text-left py-2 px-2 border-b-2 border-border text-muted font-semibold whitespace-nowrap">Rating</th><th class="text-left py-2 px-2 border-b-2 border-border text-muted font-semibold">Cipher Suite</th><th class="w-14 text-right py-2 px-2 border-b-2 border-border text-muted font-semibold whitespace-nowrap">Bits</th></tr></thead><tbody>`;
      for (const ver of groupKeys) {
        const ciphers = grouped[ver];
        const note = versionNotes[ver] || "";
        const isDeprecated = ["TLSv1", "TLSv1.1", "SSLv3", "SSLv2"].includes(ver);
        const headerClass = ver === "TLSv1.3" ? "text-green-600" : isDeprecated ? "text-red-500" : "text-amber-500";
        html += `<tr><td colspan="3" class="pt-4 pb-1"><span class="text-xs font-bold uppercase ${headerClass}">${escapeHtml(ver)}</span>${note ? ` <span class="text-xs text-muted">— ${escapeHtml(note)}</span>` : ""}</td></tr>`;
        for (const item of ciphers) {
          html += `<tr><td class="py-1.5 px-2 border-b border-border align-middle">${tlsCipherRatingBadge(item.rating)}</td><td class="py-1.5 px-2 border-b border-border text-xs font-mono break-all">${escapeHtml(item.cipher || "")}</td><td class="py-1.5 px-2 border-b border-border text-xs text-right tabular-nums">${escapeHtml(String(item.bits != null ? item.bits : "-"))}</td></tr>`;
        }
      }
      html += `</tbody></table></div>`;
    } else {
      html += `<p class="text-sm text-muted py-4 text-center">No probed ciphers accepted or probes timed out.</p>`;
    }

    if (notes.length) {
      html += `<p class="text-xs text-muted mt-3">${notes.map((n) => escapeHtml(n)).join(" ")}</p>`;
    }
    html += `</div>`;
  }
  html += `<div class="card p-4 mt-4"><h3 class="font-bold text-sm mb-3">Findings</h3><div class="grid gap-3">${issues.length ? issues.map((item) => `<div class="border border-border rounded p-3 bg-elevated"><div class="flex items-center gap-2 flex-wrap">${tlsBadge(prettyLabel(item.severity), tlsSeverityTone(item.severity), "minitools-security-status-badge")}<h4 class="font-bold text-sm">${escapeHtml(item.title)}</h4></div><p class="text-sm text-muted mt-2">${escapeHtml(item.detail || "")}</p></div>`).join("") : '<div class="text-sm text-muted">No findings.</div>'}</div></div>`;
  container.innerHTML = html;
}

function tlsToCsv(data) {
  const rows = [["target", "success", "severity", "title", "detail"]];
  for (const item of data.issues || []) rows.push([data.target, data.success, item.severity, item.title, item.detail]);
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
}

function tlsToMarkdown(data) {
  const lines = ["# TLS Check Summary", "", `Target: ${data.target}`, `Success: ${data.success}`, `TLS: ${data.tls?.version || "-"} / ${data.tls?.cipher || "-"}`, `Expires: ${data.certificate?.notAfter || "-"}`, "", "## Findings", ""];
  for (const item of data.issues || []) lines.push(`- **${String(item.severity || "").toUpperCase()}** ${item.title}: ${item.detail}`);
  return lines.join("\n") + "\n";
}

function hideMinitool(tool) {
  document.querySelector(`[data-minitools-view="${tool}"]`)?.remove();
  document.querySelector(`.mobile-tab[data-minitools-view="${tool}"]`)?.remove();
  document.getElementById(`minitools-view-${tool}`)?.remove();
}

function showFirstEnabledView(excludeTool) {
  const firstBtn = document.querySelector("[data-minitools-view]");
  if (firstBtn) {
    switchView(firstBtn.dataset.minitoolsView);
  }
}

async function init() {
  // Load bootstrap to determine which tools are enabled
  let enabledTools = { cvss: true, breach: true, azure: true, securitytrails: true, "security-headers": true, "tls-check": true, leakradar: true, cyberchef: true };
  try {
    const data = await api("/minitools/bootstrap");
    enabledTools = {
      cvss: !!data.tools?.cvss?.enabled,
      breach: !!data.tools?.breach?.enabled,
      azure: !!data.tools?.azure?.enabled,
      securitytrails: !!data.tools?.securitytrails?.enabled,
      "security-headers": !!data.tools?.securityHeaders?.enabled,
      "tls-check": !!data.tools?.tlsCheck?.enabled,
      leakradar: !!data.tools?.leakradar?.enabled,
      cyberchef: !!data.tools?.cyberchef?.enabled,
    };
    const st = data.tools?.securitytrails;
    if (st) {
      updateSecurityTrailsQuota({ used: st.usedToday, limit: st.dailyLimit });
      if (!st.enabled) {
        const results = document.getElementById("securitytrails-results");
        if (results) {
          results.innerHTML = '<div class="info-box text-sm mt-2">SecurityTrails is not configured. Ask an admin to add an API key in Admin > Tools > SecurityTrails.</div>';
        }
      }
    }
    const lr = data.tools?.leakradar;
    if (lr && !lr.enabled) {
      const results = document.getElementById("leakradar-results");
      if (results) {
        results.innerHTML = '<div class="info-box text-sm mt-2">LeakRadar is not configured. Ask an admin to add an API key in Admin > Tools > LeakRadar.</div>';
      }
    }
  } catch (_) { /* bootstrap optional */ }

  // Hide disabled tools from sidebar, mobile tabs, and view sections
  const allTools = ["cvss", "breach", "azure", "securitytrails", "security-headers", "tls-check", "leakradar", "cyberchef"];
  for (const tool of allTools) {
    if (!enabledTools[tool]) {
      hideMinitool(tool);
    }
  }

  // If current view was removed, switch to first remaining one
  const currentBtn = document.querySelector(`[data-minitools-view="${state.currentView}"]`);
  if (!currentBtn) {
    showFirstEnabledView();
  }

  initSidebar();
  if (enabledTools.cvss) initCvss();
  if (enabledTools.breach) initBreach();
  if (enabledTools.azure) initAzure();
  if (enabledTools.securitytrails) initSecurityTrails();
  if (enabledTools["security-headers"]) initSecurityHeaders();
  if (enabledTools["tls-check"]) initTlsCheck();
  if (enabledTools.cyberchef) initCyberChef();
  if (enabledTools.leakradar) initLeakRadar();
}

init();
