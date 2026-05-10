const EngageUtilisation = (() => {
  let state = { data: null, days: 30 };

  const PERIODS = [
    { label: "7d", days: 7 },
    { label: "14d", days: 14 },
    { label: "30d", days: 30 },
    { label: "60d", days: 60 },
    { label: "90d", days: 90 },
  ];

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  async function init() {
    await refresh();
  }

  async function refresh() {
    const section = document.querySelector('[data-engage-section="utilisation"]');
    if (!section) return;
    section.innerHTML = '<div class="engage-empty">Loading utilisation...</div>';
    try {
      const result = await EngageApi.utilisation(state.days);
      state.data = result;
      render(section);
    } catch (err) {
      const sec2 = document.querySelector('[data-engage-section="utilisation"]');
      if (sec2) sec2.innerHTML = `<div class="engage-empty">Failed to load utilisation: ${esc(err.message)}</div>`;
    }
  }

  function render(section) {
    const data = state.data;
    if (!data) return;

    const util = data.utilisation || [];
    const overallocated = data.overallocated || [];
    const availableSoon = data.availableSoon || [];
    const noTesters = data.engagementsWithoutTesters || [];
    const isManager = data.isManager;

    let html = '<div class="engage-util-header">';
    html += '<div class="engage-section-title">' + (isManager ? "Team Utilisation" : "My Utilisation") + '</div>';
    html += '<div class="engage-util-periods">';
    for (const p of PERIODS) {
      const isActive = p.days === state.days;
      html += `<button type="button" class="engage-tab ${isActive ? "active" : ""}" data-util-days="${p.days}">${esc(p.label)}</button>`;
    }
    html += '</div></div>';

    // Summary cards
    const totalBooked = util.reduce((s, u) => s + u.booked_hours, 0);
    const avgUtil = util.length > 0 ? Math.round(util.reduce((s, u) => s + u.utilisation_percent, 0) / util.length) : 0;

    html += '<div class="engage-stats-row">';
    html += renderStatCard("Working Days", data.workingDays || 0, `${data.totalAvailableHours || 0} available hours`);
    html += renderStatCard("Total Booked", `${Math.round(totalBooked)}h`, `${util.length} team member${util.length !== 1 ? "s" : ""}`);
    html += renderStatCard("Avg Utilisation", `${avgUtil}%`, avgUtil > 85 ? "High load" : avgUtil < 50 ? "Low load" : "Healthy");
    if (isManager) {
      html += renderStatCard("Overallocated", overallocated.length, overallocated.length > 0 ? "Needs attention" : "", overallocated.length > 0 ? "warning" : "");
    }
    html += '</div>';

    // Utilisation bars
    if (util.length > 0) {
      html += '<div class="engage-section"><div class="engage-section-title">' + (isManager ? "Team Load" : "Your Load") + '</div>';
      html += '<div class="engage-panel">';
      for (const u of util) {
        const pct = Math.min(u.utilisation_percent, 150);
        const over = u.is_overallocated;
        html += '<div class="engage-util-row">';
        html += `<div class="engage-util-label" title="${esc(u.username || u.assignee_user_id)}">${esc(u.username || u.assignee_user_id)}</div>`;
        html += '<div class="engage-util-bar-track"><div class="engage-util-bar-fill ' + (over ? "over" : "") + '" data-width="' + pct + '%"></div></div>';
        html += `<div class="engage-util-value">${Math.round(u.booked_hours)}h / ${u.available_hours}h (${u.utilisation_percent}%)</div>`;
        html += '</div>';
      }
      html += '</div></div>';
    } else {
      html += '<div class="engage-panel"><div class="engage-empty">No scheduled time in this period.</div></div>';
    }

    // Manager-only sections
    if (isManager) {
      html += '<div class="engage-grid-2">';

      // Available soon
      html += '<div class="engage-section"><div class="engage-section-title">Available Soon</div><div class="engage-panel">';
      if (availableSoon.length === 0) {
        html += '<div class="engage-empty">No users under 50% utilisation.</div>';
      } else {
        for (const u of availableSoon.slice(0, 5)) {
          html += `<div class="engage-list-item"><div><strong>${esc(u.username || u.assignee_user_id)}</strong></div><div class="engage-list-item-meta">${u.utilisation_percent}% booked (${Math.round(u.booked_hours)}h)</div></div>`;
        }
      }
      html += '</div></div>';

      // Engagements without testers
      html += '<div class="engage-section"><div class="engage-section-title">Engagements Without Testers</div><div class="engage-panel">';
      if (noTesters.length === 0) {
        html += '<div class="engage-empty">All active engagements have testers.</div>';
      } else {
        for (const e of noTesters) {
          html += `<div class="engage-list-item"><div><strong>${esc(e.title)}</strong></div></div>`;
        }
      }
      html += '</div></div>';

      html += '</div>';
    }

    section.innerHTML = html;

    // Apply dynamic widths
    section.querySelectorAll("[data-width]").forEach((el) => {
      el.style.width = el.dataset.width;
    });

    // Period selector
    section.querySelectorAll("[data-util-days]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.days = parseInt(btn.dataset.utilDays, 10);
        await refresh();
      });
    });
  }

  function renderStatCard(label, value, sub, valueClass) {
    return `<div class="engage-stat-card">
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value ${valueClass || ""}">${value}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
    </div>`;
  }

  return { init, refresh };
})();
