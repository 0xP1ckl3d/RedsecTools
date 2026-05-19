// RedSecEngage Dashboard — Phase 3
// Statistics-first visual dashboard with role-aware views.
import { escapeHtml as esc } from "../ui-components.js";

const STATUS_CLASSES = {
  draft: "draft",
  contract_signed: "active",
  scheduled: "active",
  testing_not_started: "active",
  testing_in_progress: "testing",
  testing_blocked: "blocked",
  testing_complete: "testing",
  reporting_in_progress: "reporting",
  ready_for_delivery: "delivered",
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
  ready_for_delivery: "Ready for Delivery",
  ready_for_qa: "In QA",
  qa_assigned: "In QA",
  qa_in_progress: "In QA",
  qa_changes_required: "Changes Required",
  qa_ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered",
  retest_pending: "Retest Pending",
  post_engagement_followup: "Follow-up",
  closed: "Closed",
  cancelled: "Cancelled",
  archived: "Archived",
};

const STATUS_CHART_COLORS = {
  draft: "#64748b",
  contract_signed: "#16a34a",
  scheduled: "#0ea5e9",
  testing_not_started: "#38bdf8",
  testing_in_progress: "#2563eb",
  testing_blocked: "#dc2626",
  testing_complete: "#14b8a6",
  reporting_in_progress: "#7c3aed",
  ready_for_delivery: "#84cc16",
  ready_for_qa: "#f59e0b",
  qa_assigned: "#d97706",
  qa_in_progress: "#ea580c",
  qa_changes_required: "#be123c",
  qa_ready_for_delivery: "#84cc16",
  delivered: "#15803d",
  retest_pending: "#06b6d4",
  post_engagement_followup: "#a855f7",
  closed: "#475569",
  cancelled: "#71717a",
  archived: "#334155",
};

const ENG_STATUS_ORDER = [
  "draft",
  "contract_signed",
  "scheduled",
  "testing_not_started",
  "testing_in_progress",
  "testing_blocked",
  "testing_complete",
  "reporting_in_progress",
  "ready_for_delivery",
  "ready_for_qa",
  "qa_assigned",
  "qa_in_progress",
  "qa_changes_required",
  "qa_ready_for_delivery",
  "retest_pending",
  "post_engagement_followup",
  "delivered",
  "closed",
  "cancelled",
  "archived",
];

const ACTIVE_DELIVERY_STATUSES = [
  "contract_signed",
  "scheduled",
  "testing_not_started",
  "testing_in_progress",
  "testing_blocked",
  "testing_complete",
  "reporting_in_progress",
  "ready_for_delivery",
  "ready_for_qa",
  "qa_assigned",
  "qa_in_progress",
  "qa_changes_required",
  "qa_ready_for_delivery",
  "retest_pending",
  "post_engagement_followup",
];

const DELIVERY_WORK_STATUSES = [
  "contract_signed",
  "scheduled",
  "testing_not_started",
  "testing_in_progress",
  "testing_blocked",
  "testing_complete",
  "reporting_in_progress",
  "retest_pending",
  "post_engagement_followup",
];

const QA_WORK_STATUSES = [
  "ready_for_qa",
  "qa_assigned",
  "qa_in_progress",
  "qa_changes_required",
];

const TERMINAL_STATUSES = ["delivered", "closed", "cancelled", "archived"];

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
  ready_for_qa: "QA Requested",
  assigned: "Assigned",
  reviewing: "Reviewing",
  requires_more_work: "Changes Required",
  ready_for_delivery: "Approved for Delivery",
  cancelled: "Cancelled",
};

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

function qaAttentionLabel(status) {
  if (status === "ready_for_qa") return "Unassigned QA";
  if (status === "requires_more_work") return "Changes Required";
  if (status === "ready_for_delivery") return "Approved for Delivery";
  return QA_STATUS_LABELS[status] || status;
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

function pieSlicePath(cx, cy, radius, startAngle, endAngle) {
  const toPoint = (angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };
  const start = toPoint(startAngle);
  const end = toPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function sumStatuses(distribution, statuses) {
  return statuses.reduce((sum, status) => sum + Number((distribution || {})[status] || 0), 0);
}

function pickDistribution(distribution, statuses) {
  return statuses.reduce((acc, status) => {
    const count = Number((distribution || {})[status] || 0);
    if (count > 0) acc[status] = count;
    return acc;
  }, {});
}

function orderedStatusEntries(distribution, statuses) {
  const source = distribution || {};
  const order = statuses || ENG_STATUS_ORDER;
  const known = order
    .map((status) => [status, Number(source[status] || 0)])
    .filter(([, count]) => count > 0);
  const extras = Object.keys(source)
    .filter((status) => !order.includes(status) && Number(source[status]) > 0)
    .sort()
    .map((status) => [status, Number(source[status])]);
  return known.concat(extras);
}

function renderStatusChart(distribution, options = {}) {
  const entries = orderedStatusEntries(distribution, options.statuses);
  const total = entries.reduce((sum, [, count]) => sum + Number(count), 0);
  const emptyText = options.emptyText || "No engagements";
  if (total === 0) return `<div class="engage-status-chart-empty"><div class="engage-empty">${esc(emptyText)}</div></div>`;

  let angle = 0;
  const slices = entries.map(([status, count]) => {
    const value = Number(count);
    const nextAngle = angle + (value / total) * 360;
    const color = STATUS_CHART_COLORS[status] || "#64748b";
    const path = entries.length === 1
      ? `<circle cx="50" cy="50" r="42" fill="${color}"></circle>`
      : `<path d="${pieSlicePath(50, 50, 42, angle, nextAngle)}" fill="${color}"></path>`;
    angle = nextAngle;
    return path;
  }).join("");

  const legend = entries.map(([status, count]) => {
    const pct = Math.round((Number(count) / total) * 100);
    return `<div class="engage-status-chart-legend-item">
      <span class="engage-status-chart-dot color-${esc(status)}"></span>
      <span>${esc(STATUS_LABELS[status] || status)}</span>
      <strong>${count}</strong>
      <span class="text-muted">${pct}%</span>
    </div>`;
  }).join("");

  return `<div class="engage-status-chart">
    <div class="engage-status-chart-visual">
      <svg class="engage-status-pie" viewBox="0 0 100 100" role="img" aria-label="${esc(options.ariaLabel || "Engagement status distribution")}">
        ${slices}
      </svg>
      <div class="engage-status-chart-total">
        <strong>${total}</strong>
        <span>${esc(options.totalLabel || "Total")}</span>
      </div>
    </div>
    <div class="engage-status-chart-legend">${legend}</div>
  </div>`;
}

function renderHealthMetric(label, value, sub, tone) {
  return `<div class="engage-health-metric ${tone ? `tone-${tone}` : ""}">
    <div>
      <div class="engage-health-label">${esc(label)}</div>
      ${sub ? `<div class="engage-health-sub">${esc(sub)}</div>` : ""}
    </div>
    <div class="engage-health-value">${esc(String(value))}</div>
  </div>`;
}

function renderOutcomeItem(label, value, sub) {
  return `<div class="engage-outcome-item">
    <div class="engage-outcome-value">${esc(String(value))}</div>
    <div class="engage-outcome-label">${esc(label)}</div>
    ${sub ? `<div class="engage-outcome-sub">${esc(sub)}</div>` : ""}
  </div>`;
}

function renderDeliveryHealth(stats, qaReviews = []) {
  const distribution = stats.engStatusDistribution || {};
  const activeDistribution = pickDistribution(distribution, ACTIVE_DELIVERY_STATUSES);
  const deliveryCount = sumStatuses(distribution, DELIVERY_WORK_STATUSES);
  const qaCount = Number(stats.waitingForQA || 0) + Number(stats.qaInProgress || 0);
  const unassignedQaCount = qaReviews.filter((review) =>
    !review.assigned_to_user_id && !["delivered", "cancelled"].includes(review.status)
  ).length;
  const attentionCount = Number(stats.blockedEngagements || 0) + Number(stats.overdueEngagements || 0) + Number(stats.qaChangesRequired || 0) + unassignedQaCount;
  const readyCount = Number(stats.readyForDelivery || 0);
  const draftCount = Number(distribution.draft || 0);
  const terminalTotal = sumStatuses(distribution, TERMINAL_STATUSES);

  return `<div class="engage-delivery-health">
    <div class="engage-delivery-chart-block">
      ${renderStatusChart(activeDistribution, {
        emptyText: "No active delivery work",
        totalLabel: "Active",
        ariaLabel: "Active engagement delivery distribution",
        statuses: ACTIVE_DELIVERY_STATUSES,
      })}
    </div>
    <div class="engage-health-stack">
      ${renderHealthMetric("Delivery Work", deliveryCount, "Scheduled, testing, reporting, retest, follow-up", deliveryCount > 0 ? "info" : "")}
      ${renderHealthMetric("QA Pressure", qaCount, `${stats.waitingForQA || 0} waiting, ${stats.qaInProgress || 0} in progress`, qaCount > 0 ? "qa" : "")}
      ${renderHealthMetric("Needs Action", attentionCount, `${stats.blockedEngagements || 0} blocked, ${stats.overdueEngagements || 0} overdue, ${stats.qaChangesRequired || 0} QA changes, ${unassignedQaCount} unassigned QA`, attentionCount > 0 ? "warning" : "")}
      ${renderHealthMetric("Ready to Ship", readyCount, "Passed QA and awaiting delivery", readyCount > 0 ? "success" : "")}
    </div>
    <div class="engage-outcome-strip">
      ${renderOutcomeItem("Delivered This Month", stats.deliveredThisMonth || 0)}
      ${renderOutcomeItem("Closed This Month", stats.closedThisMonth || 0)}
      ${renderOutcomeItem("Draft / Intake", draftCount, "Not active delivery")}
      ${renderOutcomeItem("Lifetime Outcomes", terminalTotal, "Delivered, closed, cancelled, archived")}
    </div>
  </div>`;
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
  return engagements.map((e) => renderWorkCard({
    title: e.title,
    meta: e.engagement_type || "",
    badge: statusPill(e.status),
    attrs: `data-dashboard-eng-id="${esc(e.id)}"`,
  })).join("");
}

function renderQaCards(reviews) {
  if (!reviews || reviews.length === 0) return '<div class="engage-empty">No QA reviews</div>';
  return reviews.map((r) => renderWorkCard({
    title: r.engagement_title || r.report_link || "QA Review",
    meta: `${r.assigned_by_username ? `Submitted by ${r.assigned_by_username}` : "Submitted by unknown"} · ${r.assigned_to_username ? `Reviewer: ${r.assigned_to_username}` : "Unassigned"}`,
    badge: qaStatusPill(r.status),
    attrs: `data-dashboard-qa-id="${esc(r.id || "")}"`,
  })).join("");
}

function renderWorkCard({ title, meta, badge, attrs }) {
  return `<div class="engage-work-card engage-clickable-item" ${attrs || ""}>
    <div class="engage-work-card-main">
      <strong>${esc(title)}</strong>
      <div class="engage-list-item-meta">${esc(meta || "")}</div>
    </div>
    <div class="engage-work-card-status">${badge || ""}</div>
  </div>`;
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

function renderNeedsAttention(blocked, overdue, qaReviews) {
  const items = [...(blocked || []), ...(overdue || [])];
  const qaItems = (qaReviews || []).filter((review) =>
    !review.assigned_to_user_id || review.status === "requires_more_work"
  );
  if (items.length === 0 && qaItems.length === 0) return '<div class="engage-empty">Nothing requires attention</div>';
  const engagementHtml = items.map((e) => renderWorkCard({
    title: e.title,
    meta: e.scheduled_end_date ? `Overdue: ${e.scheduled_end_date}` : "Blocked",
    badge: statusPill(e.status),
    attrs: `data-dashboard-eng-id="${esc(e.id)}"`,
  })).join("");
  const qaHtml = qaItems.map((review) => renderWorkCard({
    title: review.engagement_title || "QA Review",
    meta: qaAttentionLabel(review.status),
    badge: qaStatusPill(review.status),
    attrs: `data-dashboard-qa-id="${esc(review.id || "")}"`,
  })).join("");
  if (!engagementHtml && !qaHtml) return '<div class="engage-empty">Nothing requires attention</div>';
  return engagementHtml + qaHtml;
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

  async function switchToView(view) {
    document.querySelectorAll("[data-engage-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.engageView === view);
    });
    document.querySelectorAll("[data-engage-section]").forEach((el) => {
      el.classList.toggle("hidden", el.dataset.engageSection !== view);
    });
    if (!initializedViews.has(view)) {
      initializedViews.add(view);
      if (view === "clients" && typeof EngageClients !== "undefined") await EngageClients.init();
      if (view === "pipeline" && typeof EngageOpportunities !== "undefined") await EngageOpportunities.init();
      if (view === "engagements" && typeof EngageEngagements !== "undefined") await EngageEngagements.init();
      if (view === "qa" && typeof EngageQa !== "undefined") await EngageQa.init();
      if (view === "utilisation" && typeof EngageUtilisation !== "undefined") await EngageUtilisation.init();
    }
  }
  window.switchEngageView = switchToView;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-engage-view]");
    if (!btn) return;
    switchToView(btn.dataset.engageView);
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
      errorEl.textContent = "You do not have permission to access " + window.brandName("Engage") + ".";
      errorEl.classList.remove("hidden");
      return;
    }
    if (!res.ok) throw new Error("Failed to load dashboard");
    const data = await res.json();

    const { stats, capabilities, myWork, recentActivity } = data;
    const dashboardQaReviews = data.dashboardQaReviews || myWork.qaReviews || [];
    const dashboardAttentionQaReviews = data.dashboardAttentionQaReviews || dashboardQaReviews;
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

    // Active delivery health
    html += '<div class="engage-section"><div class="engage-section-title">Active Delivery Health</div><div class="engage-panel engage-delivery-health-panel">' +
      renderDeliveryHealth(stats, dashboardQaReviews) +
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
        renderNeedsAttention(stats.blockedList, stats.overdueList, dashboardAttentionQaReviews) +
        "</div></div>";
    }

    // QA Queue
    if (capabilities.canManageQa || capabilities.canPerformQa) {
      html += '<div class="engage-section"><div class="engage-section-title">QA Queue</div><div class="engage-panel">' +
        renderQaCards(dashboardQaReviews) +
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

    // Lazy-loaded sections for other views, populated by their feature modules.
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

    // Bind dashboard engagement links to switch to engagement view
    content.querySelectorAll("[data-dashboard-eng-id]").forEach((el) => {
      el.addEventListener("click", async (event) => {
        event.preventDefault();
        await switchEngageView("engagements");
        if (typeof EngageEngagements !== "undefined" && EngageEngagements.openEng) {
          EngageEngagements.openEng(el.dataset.dashboardEngId);
        }
      });
    });

    content.querySelectorAll("[data-dashboard-qa-id]").forEach((el) => {
      el.addEventListener("click", async (event) => {
        event.preventDefault();
        await switchEngageView("qa");
      });
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
