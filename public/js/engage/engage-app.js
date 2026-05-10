// RedSecEngage Dashboard — Phase 3
// Statistics-first visual dashboard with role-aware views.

const STATUS_CLASSES = {
  draft: "draft",
  contract_signed: "active",
  scheduled: "active",
  testing_not_started: "active",
  testing_in_progress: "testing",
  testing_blocked: "blocked",
  testing_complete: "testing",
  reporting_in_progress: "reporting",
  ready_for_qa: "qa",
  qa_assigned: "qa",
  qa_in_progress: "qa",
  qa_changes_required: "blocked",
  qa_ready_for_delivery: "delivered",
  delivered: "delivered",
  retest_pending: "testing",
  post_engagement_followup: "active",
  closed: "closed",
  cancelled: "closed",
  archived: "closed",
};

const STATUS_LABELS = {
  draft: "Draft",
  contract_signed: "Contract Signed",
  scheduled: "Scheduled",
  testing_not_started: "Testing Not Started",
  testing_in_progress: "Testing In Progress",
  testing_blocked: "Blocked",
  testing_complete: "Testing Complete",
  reporting_in_progress: "Reporting",
  ready_for_qa: "Ready for QA",
  qa_assigned: "QA Assigned",
  qa_in_progress: "QA In Progress",
  qa_changes_required: "QA Changes Required",
  qa_ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered",
  retest_pending: "Retest Pending",
  post_engagement_followup: "Follow-up",
  closed: "Closed",
  cancelled: "Cancelled",
};

const OPP_STAGE_LABELS = {
  lead: "Lead",
  qualified: "Qualified",
  scoping: "Scoping",
  proposal_drafting: "Proposal Drafting",
  proposal_sent: "Proposal Sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  rejected: "Rejected",
};

const QA_STATUS_LABELS = {
  not_requested: "Not Requested",
  ready_for_qa: "Ready for QA",
  assigned: "Assigned",
  reviewing: "Reviewing",
  requires_more_work: "Requires More Work",
  ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function formatCurrency(value) {
  if (value == null) return "---";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusPill(status) {
  const cls = STATUS_CLASSES[status] || "draft";
  const label = STATUS_LABELS[status] || status;
  return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
}

function qaStatusPill(status) {
  const cls = status === "reviewing" ? "qa" : status === "requires_more_work" ? "blocked" : status === "ready_for_delivery" ? "delivered" : "draft";
  const label = QA_STATUS_LABELS[status] || status;
  return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
}

function renderStatCard(label, value, sub, valueClass) {
  return `<div class="engage-stat-card">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value ${valueClass || ""}">${value}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function renderTopRow(stats, capabilities) {
  const cards = [];
  if (capabilities.canSeeCommercials) {
    cards.push(renderStatCard("Pipeline Value", formatCurrency(stats.pipelineValue), `Weighted: ${formatCurrency(stats.weightedPipelineValue)}`, "accent"));
  }
  cards.push(renderStatCard("Active Engagements", stats.activeEngagements));
  cards.push(renderStatCard("Waiting for QA", stats.waitingForQA, `${stats.qaInProgress} in progress`));
  cards.push(renderStatCard("Blocked", stats.blockedEngagements, stats.overdueEngagements > 0 ? `${stats.overdueEngagements} overdue` : "", stats.blockedEngagements > 0 ? "warning" : ""));
  cards.push(renderStatCard("Ready for Delivery", stats.readyForDelivery, `${stats.deliveredThisMonth || 0} delivered this month`));
  if (capabilities.canSeeCommercials) {
    cards.push(renderStatCard("Open Opportunities", stats.openOpportunities, `${stats.wonThisMonth} won / ${stats.lostThisMonth} lost this month`));
  } else {
    cards.push(renderStatCard("Open Opportunities", stats.openOpportunities));
  }
  if (capabilities.canViewAll) {
    cards.push(renderStatCard("Team Utilisation", `${stats.teamUtilisationPercent || 0}%`, `${stats.usersOverallocated || 0} overallocated`, stats.usersOverallocated > 0 ? "warning" : ""));
  }
  if (stats.averageDaysInQA != null) {
    cards.push(renderStatCard("Avg Days in QA", stats.averageDaysInQA));
  }
  return `<div class="engage-stats-row">${cards.join("")}</div>`;
}

function renderStatusBar(distribution) {
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  if (total === 0) return '<div class="engage-status-bar"></div><div class="engage-empty">No engagements</div>';
  let bar = '<div class="engage-status-bar">';
  let legend = '<div class="engage-status-legend">';
  for (const [status, count] of Object.entries(distribution)) {
    if (count === 0) continue;
    const pct = (count / total * 100).toFixed(1);
    bar += `<div class="engage-status-bar-segment color-${status}" data-width="${pct}%"></div>`;
    legend += `<span class="engage-status-legend-item"><span class="engage-status-legend-dot color-${status}"></span>${STATUS_LABELS[status] || status}: ${count}</span>`;
  }
  bar += "</div>";
  legend += "</div>";
  return bar + legend;
}

function renderFunnel(distribution) {
  const stages = ["lead", "qualified", "scoping", "proposal_drafting", "proposal_sent", "negotiation"];
  const maxVal = Math.max(1, ...stages.map((s) => distribution[s] || 0));
  let html = '<div class="engage-funnel">';
  for (const stage of stages) {
    const count = distribution[stage] || 0;
    const pct = (count / maxVal * 100).toFixed(1);
    html += `<div class="engage-funnel-step">
      <div class="engage-funnel-label">${OPP_STAGE_LABELS[stage]}</div>
      <div class="engage-funnel-bar" data-width="${pct}%"></div>
      <div class="engage-funnel-count">${count}</div>
    </div>`;
  }
  html += "</div>";
  return html;
}

function renderEngagementList(engagements) {
  if (!engagements || engagements.length === 0) return '<div class="engage-empty">No engagements</div>';
  return engagements.map((e) => `<div class="engage-list-item">
    <div>
      <a href="/engage">${esc(e.title)}</a>
      <div class="engage-list-item-meta">${esc(e.engagement_type || "")}</div>
    </div>
    ${statusPill(e.status)}
  </div>`).join("");
}

function renderQaCards(reviews) {
  if (!reviews || reviews.length === 0) return '<div class="engage-empty">No QA reviews</div>';
  return reviews.map((r) => `<div class="engage-qa-card">
    <div class="engage-qa-card-title">${esc(r.report_link || "QA Review")}</div>
    <div class="engage-qa-card-meta">${qaStatusPill(r.status)}</div>
  </div>`).join("");
}

function renderUtilisation(utilisation) {
  if (!utilisation || utilisation.length === 0) return '<div class="engage-empty">No utilisation data</div>';
  const maxHours = Math.max(1, ...utilisation.map((u) => u.booked_hours));
  return utilisation.map((u) => {
    const pct = (u.booked_hours / maxHours * 100).toFixed(1);
    const over = u.booked_hours > 160;
    return `<div class="engage-util-row">
      <div class="engage-util-label" title="${esc(u.username || u.assignee_user_id)}">${esc(u.username || u.assignee_user_id)}</div>
      <div class="engage-util-bar-track"><div class="engage-util-bar-fill ${over ? "over" : ""}" data-width="${pct}%"></div></div>
      <div class="engage-util-value">${Math.round(u.booked_hours)}h</div>
    </div>`;
  }).join("");
}

function renderBlockedOverdue(blocked, overdue) {
  const items = [...(blocked || []), ...(overdue || [])];
  if (items.length === 0) return '<div class="engage-empty">Nothing requires attention</div>';
  return items.map((e) => `<div class="engage-list-item">
    <div>
      <a href="/engage">${esc(e.title)}</a>
      <div class="engage-list-item-meta">${e.scheduled_end_date ? `Due: ${e.scheduled_end_date}` : ""}</div>
    </div>
    ${statusPill(e.status)}
  </div>`).join("");
}

function renderRecentActivity(activity) {
  if (!activity || activity.length === 0) return '<div class="engage-empty">No recent activity</div>';
  return activity.slice(0, 10).map((a) => `<div class="engage-list-item">
    <div>
      <strong>${esc(a.action.replace(/_/g, " "))}</strong>
      <span class="engage-activity-meta"> ${esc(a.entity_type)} ${a.username ? `by ${esc(a.username)}` : ""}</span>
    </div>
    <div class="engage-list-item-meta">${new Date(a.created_at * 1000).toLocaleDateString()}</div>
  </div>`).join("");
}

// Sidebar + mobile tab switching
(function initEngageSidebar() {
  const sidebar = document.getElementById("engage-sidebar");
  const collapseBtn = document.getElementById("engage-sidebar-collapse-btn");
  if (sidebar && collapseBtn) {
    collapseBtn.addEventListener("click", () => sidebar.classList.toggle("collapsed"));
  }

  const initializedViews = new Set(["dashboard"]);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-engage-view]");
    if (!btn) return;
    const view = btn.dataset.engageView;
    // Update sidebar active state
    document.querySelectorAll("[data-engage-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.engageView === view);
    });
    // Show/hide content sections
    document.querySelectorAll("[data-engage-section]").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.engageSection !== view);
    });
    // Lazy-initialize views on first switch
    if (!initializedViews.has(view)) {
      initializedViews.add(view);
      if (view === "clients" && typeof EngageClients !== "undefined") EngageClients.init();
      if (view === "pipeline" && typeof EngageOpportunities !== "undefined") EngageOpportunities.init();
      if (view === "engagements" && typeof EngageEngagements !== "undefined") EngageEngagements.init();
      if (view === "qa" && typeof EngageQa !== "undefined") EngageQa.init();
      if (view === "utilisation" && typeof EngageUtilisation !== "undefined") EngageUtilisation.init();
    }
  });
})();

async function initEngageApp() {
  const loading = document.getElementById("engage-loading");
  const errorEl = document.getElementById("engage-error");
  const content = document.getElementById("engage-content");
  if (!loading || !content) return;

  try {
    const res = await fetch("/api/engage/bootstrap");
    if (res.status === 403) {
      loading.classList.add("hidden");
      errorEl.textContent = "You do not have permission to access RedSecEngage.";
      errorEl.classList.remove("hidden");
      return;
    }
    if (!res.ok) throw new Error("Failed to load dashboard");
    const data = await res.json();

    const { stats, capabilities, myWork, recentActivity } = data;
    window._engageCapabilities = capabilities;
    window._engageUser = data.user || null;

    loading.classList.add("hidden");
    content.classList.remove("hidden");

    let html = '<div data-engage-section="dashboard">';

    // Top row — stat cards
    html += renderTopRow(stats, capabilities);

    // Second row
    html += '<div class="engage-grid-2">';

    // Pipeline funnel
    html += '<div class="engage-section"><div class="engage-section-title">Pipeline Funnel</div><div class="engage-panel">' +
      renderFunnel(stats.oppStageDistribution) +
      "</div></div>";

    // Engagement status distribution
    html += '<div class="engage-section"><div class="engage-section-title">Engagement Status</div><div class="engage-panel">' +
      renderStatusBar(stats.engStatusDistribution) +
      "</div></div>";

    html += "</div>";

    // Third row
    html += '<div class="engage-grid-3">';

    // My work
    html += '<div class="engage-section"><div class="engage-section-title">My Work</div><div class="engage-panel">' +
      renderEngagementList(myWork.engagements) +
      "</div></div>";

    // Blocked / overdue
    if (capabilities.canViewAll) {
      html += '<div class="engage-section"><div class="engage-section-title">Needs Attention</div><div class="engage-panel">' +
        renderBlockedOverdue(stats.blockedList, stats.overdueList) +
        "</div></div>";
    }

    // QA Queue
    if (capabilities.canManageQa || capabilities.canPerformQa) {
      html += '<div class="engage-section"><div class="engage-section-title">QA Queue</div><div class="engage-panel">' +
        renderQaCards(myWork.qaReviews) +
        "</div></div>";
    }

    html += "</div>";

    // Fourth row (manager/admin only)
    if (capabilities.canViewAll && recentActivity.length > 0) {
      html += '<div class="engage-grid-2">';
      html += '<div class="engage-section"><div class="engage-section-title">Recent Activity</div><div class="engage-panel">' +
        renderRecentActivity(recentActivity) +
        "</div></div>";

      // Utilisation
      html += '<div class="engage-section"><div class="engage-section-title">Utilisation (30 days)</div><div class="engage-panel" id="utilisation-panel">Loading...</div></div>';
      html += "</div>";
    }

    html += "</div>"; // close dashboard section

    // Placeholder sections for other views (populated in later phases)
    html += '<div data-engage-section="clients" class="hidden"><div class="engage-empty">Loading clients...</div></div>';
    html += '<div data-engage-section="pipeline" class="hidden"><div class="engage-empty">Loading pipeline...</div></div>';
    html += '<div data-engage-section="engagements" class="hidden"><div class="engage-empty">Loading engagements...</div></div>';
    html += '<div data-engage-section="qa" class="hidden"><div class="engage-empty">Loading QA queue...</div></div>';
    html += '<div data-engage-section="utilisation" class="hidden"><div class="engage-empty">Loading utilisation...</div></div>';

    content.innerHTML = html;

    // Apply dynamic widths from data-width attributes (CSP-safe: no inline styles)
    content.querySelectorAll("[data-width]").forEach((el) => {
      el.style.width = el.dataset.width;
    });

    // Load utilisation separately (manager/admin only)
    if (capabilities.canViewAll) {
      try {
        const utilRes = await fetch("/api/engage/utilisation?days=30");
        if (utilRes.ok) {
          const utilData = await utilRes.json();
          const panel = document.getElementById("utilisation-panel");
          if (panel) {
            panel.innerHTML = renderUtilisation(utilData.utilisation);
            panel.querySelectorAll("[data-width]").forEach((el) => {
              el.style.width = el.dataset.width;
            });
          }
        }
      } catch {
        // Best-effort
      }
    }
  } catch (err) {
    loading.classList.add("hidden");
    errorEl.textContent = "Failed to load dashboard. Please try again.";
    errorEl.classList.remove("hidden");
  }
}

initEngageApp();
