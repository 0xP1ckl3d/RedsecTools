const EngageEngagements = (() => {
  let state = { engagements: [], selectedEng: null, detail: null, view: "list" };

  const ENG_STATUSES = [
    "draft", "contract_signed", "scheduled", "testing_not_started", "testing_in_progress",
    "testing_blocked", "testing_complete", "reporting_in_progress", "ready_for_delivery",
    "delivered", "retest_pending", "post_engagement_followup", "closed", "cancelled"
  ];
  const ENG_STATUS_LABELS = {
    draft: "Draft", contract_signed: "Contract Signed", scheduled: "Scheduled",
    testing_not_started: "Testing Not Started", testing_in_progress: "Testing In Progress",
    testing_blocked: "Blocked", testing_complete: "Testing Complete",
    reporting_in_progress: "Reporting", ready_for_delivery: "Ready for Delivery",
    ready_for_qa: "In QA", qa_assigned: "In QA", qa_in_progress: "In QA",
    qa_changes_required: "Changes Required", qa_ready_for_delivery: "Ready for Delivery",
    delivered: "Delivered", retest_pending: "Retest Pending",
    post_engagement_followup: "Follow-up", closed: "Closed", cancelled: "Cancelled"
  };
  const ENG_STATUS_CLASSES = {
    draft: "draft", contract_signed: "active", scheduled: "active",
    testing_not_started: "active", testing_in_progress: "testing",
    testing_blocked: "blocked", testing_complete: "testing",
    reporting_in_progress: "reporting", ready_for_delivery: "delivered",
    ready_for_qa: "qa", qa_assigned: "qa", qa_in_progress: "qa",
    qa_changes_required: "blocked", qa_ready_for_delivery: "delivered",
    delivered: "delivered", retest_pending: "testing",
    post_engagement_followup: "active", closed: "closed", cancelled: "closed"
  };
  const PRIORITIES = ["low", "normal", "high", "critical"];
  const ENG_TYPES = ["internal", "external", "webapp", "cloud", "build_review", "red_team", "wireless", "configuration_review", "assumed_breach", "custom"];
  const ENG_TYPE_LABELS = { internal: "Internal", external: "External", webapp: "Web App", cloud: "Cloud", build_review: "Build Review", red_team: "Red Team", wireless: "Wireless", configuration_review: "Config Review", assumed_breach: "Assumed Breach", custom: "Custom" };

  function parseEngTypes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [raw]; } catch { return [raw]; }
  }

  function renderTypeTags(raw) {
    const types = parseEngTypes(raw);
    if (!types.length) return "";
    return types.map((t) => `<span class="engage-type-tag">${esc(ENG_TYPE_LABELS[t] || t)}</span>`).join("");
  }
  const TEAM_ROLES = ["manager", "technical_lead", "tester", "qa_reviewer", "observer"];
  const TEAM_ROLE_LABELS = { manager: "Manager", technical_lead: "Technical Lead", tester: "Tester", qa_reviewer: "QA Reviewer", observer: "Observer" };

  const esc = (str) => window.RedSecUI.escapeHtml(str || "");

  function formatDate(ts) {
    if (!ts) return "---";
    return new Date(ts * 1000).toLocaleDateString();
  }

  function formatCurrency(value) {
    if (value == null) return "---";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }

  function engStatusPill(status) {
    const cls = ENG_STATUS_CLASSES[status] || "draft";
    const label = ENG_STATUS_LABELS[status] || status;
    return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
  }

  function priorityLabel(p) {
    const colors = { low: "draft", normal: "active", high: "qa", critical: "blocked" };
    return `<span class="engage-status-pill ${colors[p] || "draft"}"><span class="pill-dot"></span>${esc(p || "normal")}</span>`;
  }

  function userOptionLabel(user) {
    if (!user) return "";
    const isMe = user.id === window._engageUser?.id ? " (you)" : "";
    return `${user.username || user.id}${isMe}`;
  }

  function getLatestQaReview() {
    const reviews = state.detail?.qaReviews || [];
    return reviews[0] || null;
  }

  function canRequestQaAgain() {
    const latest = getLatestQaReview();
    return !latest || ["requires_more_work", "ready_for_delivery", "cancelled"].includes(latest.status);
  }

  function isActiveQa(review) {
    return review && ["ready_for_qa", "assigned", "reviewing"].includes(review.status);
  }

  function renderList() {
    const section = document.querySelector('[data-engage-section="engagements"]');
    if (!section) return;

    const engagements = state.engagements;
    let html = '<div class="engage-engagements-header">';
    html += '<div class="engage-section-title">Engagements</div>';
    if (window._engageCapabilities?.canCreateEngagement) {
      html += '<button type="button" class="btn-primary text-sm eng-create-btn">New Engagement</button>';
    }
    html += '</div>';

    if (!engagements || engagements.length === 0) {
      html += '<div class="engage-panel"><div class="engage-empty">No engagements yet.</div></div>';
      section.innerHTML = html;
      bindCreateBtn(section);
      return;
    }

    html += '<div class="engage-engagement-list">';
    for (const e of engagements) {
      html += `<div class="engage-engagement-row" data-eng-id="${e.id}">
        <div class="engage-engagement-row-main">
          <strong>${esc(e.title)}</strong>
          <div class="engage-list-item-meta">${esc(e.client_display_name || e.client_name || "")} &middot; ${renderTypeTags(e.engagement_type)}</div>
        </div>
        <div class="engage-engagement-row-status">
          ${engStatusPill(e.status)}
          ${e.priority && e.priority !== "normal" ? priorityLabel(e.priority) : ""}
        </div>
      </div>`;
    }
    html += '</div>';
    section.innerHTML = html;
    bindCreateBtn(section);
    section.querySelectorAll(".engage-engagement-row[data-eng-id]").forEach((el) => {
      el.addEventListener("click", () => openEngagement(el.dataset.engId));
    });
  }

  function bindCreateBtn(container) {
    const btn = container.querySelector(".eng-create-btn");
    if (btn) btn.addEventListener("click", openCreateModal);
  }

  function openLinkInputModal(label, callback) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Link ${esc(label)}</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">${esc(label)} *</label>
        <input type="text" id="link-input" class="input-field w-full" placeholder="Enter ID">
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Link</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const val = overlay.querySelector("#link-input").value.trim();
      if (!val) { await EngageModal.alert({ title: "Validation Error", message: `${label} is required.` }); return; }
      overlay.remove();
      callback(val);
    });
    overlay.querySelector("#link-input").focus();
  }

  function openCreateModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">New Engagement</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Client *</label>
        <select id="eng-client" class="input-field w-full"><option value="">Loading clients...</option></select>
        <label class="block text-sm text-muted mb-1 mt-3">Title *</label>
        <input type="text" id="eng-title" class="input-field w-full" placeholder="Engagement title">
        <label class="block text-sm text-muted mb-1 mt-3">Types</label>
        <div class="engage-type-checkboxes">
          ${ENG_TYPES.map((t) => `<label class="engage-type-checkbox"><input type="checkbox" name="eng-types" value="${t}"> ${esc(ENG_TYPE_LABELS[t] || t)}</label>`).join("")}
        </div>
        <label class="block text-sm text-muted mb-1 mt-3">Priority</label>
        <select id="eng-priority" class="input-field w-full">
          ${PRIORITIES.map((p) => `<option value="${p}">${esc(p)}</option>`).join("")}
        </select>
        <div class="engage-grid-2 mt-3">
          <div>
            <label class="block text-sm text-muted mb-1">Scheduled Start</label>
            <input type="date" id="eng-start" class="input-field w-full">
          </div>
          <div>
            <label class="block text-sm text-muted mb-1">Scheduled End</label>
            <input type="date" id="eng-end" class="input-field w-full">
          </div>
        </div>
        <label class="block text-sm text-muted mb-1 mt-3">Scope Summary</label>
        <textarea id="eng-scope" class="input-field w-full" rows="3" placeholder="High-level scope summary"></textarea>
        <div class="engage-team-picker mt-3">
          <div class="engage-section-title-row">
            <span class="text-sm text-muted font-semibold">Team Members *</span>
            <button type="button" class="btn-secondary text-sm" id="eng-create-add-member-btn">Add Team Member</button>
          </div>
          <div id="eng-create-team-list" class="engage-team-list mt-2"></div>
          <p class="text-xs text-muted mt-1">The current user is included automatically.</p>
        </div>
        <label class="block text-sm text-muted mb-1 mt-3">Notes</label>
        <textarea id="eng-notes" class="input-field w-full" rows="2"></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Create</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const selectedMembers = new Map();
    if (window._engageUser?.id) {
      selectedMembers.set(window._engageUser.id, { userId: window._engageUser.id, username: window._engageUser.username, role: "manager", isPrimary: true });
    }
    const allUsers = [];

    function renderCreateTeamList() {
      const list = overlay.querySelector("#eng-create-team-list");
      if (!list) return;
      const members = Array.from(selectedMembers.values());
      list.innerHTML = members.map((m) => `<div class="engage-team-item">
        <div>
          <strong>${esc(m.username || m.userId)}</strong>
          <span class="engage-type-tag">${esc(TEAM_ROLE_LABELS[m.role] || m.role)}</span>
          ${m.isPrimary ? '<span class="engage-type-tag">Primary</span>' : ""}
        </div>
        ${m.userId === window._engageUser?.id ? "" : `<button type="button" class="btn-secondary text-sm eng-create-remove-member" data-user-id="${esc(m.userId)}">Remove</button>`}
      </div>`).join("");
      list.querySelectorAll(".eng-create-remove-member").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedMembers.delete(btn.dataset.userId);
          renderCreateTeamList();
        });
      });
    }
    renderCreateTeamList();

    EngageApi.listClients().then((result) => {
      const select = overlay.querySelector("#eng-client");
      const clients = result.clients || [];
      select.innerHTML = '<option value="">Select a client</option>' +
        clients.map((c) => `<option value="${c.id}">${esc(c.display_name || c.name)}</option>`).join("");
    }).catch(() => {
      overlay.querySelector("#eng-client").innerHTML = '<option value="">Failed to load</option>';
    });

    EngageApi.listUsers().then((result) => {
      allUsers.splice(0, allUsers.length, ...(result.users || []));
    }).catch(() => {});

    overlay.querySelector("#eng-create-add-member-btn")?.addEventListener("click", async () => {
      if (!allUsers.length) {
        await EngageModal.alert({ title: "Users Unavailable", message: "User list has not loaded yet." });
        return;
      }
      const options = allUsers
        .filter((u) => !selectedMembers.has(u.id))
        .map((u) => `<option value="${esc(u.id)}">${esc(userOptionLabel(u))}</option>`)
        .join("");
      if (!options) {
        await EngageModal.alert({ title: "Team Complete", message: "All available users are already assigned." });
        return;
      }
      const html = `<div class="space-y-3">
        <label class="block text-sm text-muted mb-1">User</label>
        <select id="eng-create-member-user" class="input-field w-full">${options}</select>
        <label class="block text-sm text-muted mb-1">Role</label>
        <select id="eng-create-member-role" class="input-field w-full">
          ${TEAM_ROLES.map((r) => `<option value="${r}">${esc(TEAM_ROLE_LABELS[r])}</option>`).join("")}
        </select>
      </div>`;
      const confirmed = await EngageModal.confirm({ title: "Add Team Member", message: html, htmlMessage: true, confirmLabel: "Add" });
      if (!confirmed) return;
      const userId = document.getElementById("eng-create-member-user")?.value;
      const role = document.getElementById("eng-create-member-role")?.value || "tester";
      const user = allUsers.find((u) => u.id === userId);
      if (userId) {
        selectedMembers.set(userId, { userId, username: user?.username, role, isPrimary: false });
        renderCreateTeamList();
      }
    });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const clientId = overlay.querySelector("#eng-client").value;
      const title = overlay.querySelector("#eng-title").value.trim();
      if (!clientId) { await EngageModal.alert({ title: "Validation Error", message: "Select a client." }); return; }
      if (!title) { await EngageModal.alert({ title: "Validation Error", message: "Title is required." }); return; }
      const startDate = overlay.querySelector("#eng-start").value;
      const endDate = overlay.querySelector("#eng-end").value;
      if (startDate && endDate && startDate > endDate) {
        await EngageModal.alert({ title: "Validation Error", message: "End date must be after start date." }); return;
      }
      if (selectedMembers.size < 1) {
        await EngageModal.alert({ title: "Validation Error", message: "Add at least one team member." }); return;
      }
      try {
        await EngageApi.createEngagement({
          clientId, title,
          engagementType: [...overlay.querySelectorAll("input[name='eng-types']:checked")].map((cb) => cb.value),
          priority: overlay.querySelector("#eng-priority").value,
          scheduledStartDate: startDate || null,
          scheduledEndDate: endDate || null,
          teamMembers: Array.from(selectedMembers.values()).map((m) => ({ userId: m.userId, role: m.role, isPrimary: m.isPrimary })),
          highLevelScopeSummary: overlay.querySelector("#eng-scope").value.trim(),
          notes: overlay.querySelector("#eng-notes").value.trim(),
        });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to create engagement: " + err.message });
      }
    });
  }

  async function openEngagement(engId) {
    const section = document.querySelector('[data-engage-section="engagements"]');
    if (!section) return;
    section.innerHTML = '<div class="engage-empty">Loading engagement...</div>';
    try {
      const data = await EngageApi.getEngagementDetail(engId);
      state.selectedEng = data.engagement;
      state.detail = data;
      state.view = "detail";
      renderDetail(section, data);
    } catch (err) {
      section.innerHTML = `<div class="engage-empty">Failed to load engagement: ${esc(err.message)}</div>`;
    }
  }

  function renderDetail(section, data) {
    const e = data.engagement;
    const team = data.team || [];
    const activity = data.activity || [];
    const notes = data.notes || [];
    const caps = window._engageCapabilities || {};
    const latestQa = getLatestQaReview();
    const activeQa = data.activeQaReview || (isActiveQa(latestQa) ? latestQa : null);

    let html = '<div class="engage-eng-detail">';

    // Header
    html += '<div class="engage-eng-detail-header">';
    html += '<button type="button" class="btn-secondary text-sm eng-back-btn">Back to Engagements</button>';
    html += `<h2 class="engage-opp-detail-title">${esc(e.title)}</h2>`;
    html += `<div class="engage-opp-detail-meta">${esc(e.client_display_name || e.client_name || "")} &middot; ${renderTypeTags(e.engagement_type)} &middot; ${engStatusPill(e.status)} ${activeQa ? qaStatusPill(activeQa.status) : ""} ${priorityLabel(e.priority)}</div>`;
    html += '<div class="engage-opp-detail-actions">';

    if ((caps.canEditEngagement || caps.canManageAll) && !activeQa) {
      html += `<select class="input-field text-sm eng-status-select" title="Change status">
        ${ENG_STATUSES.map((status) => `<option value="${status}" ${status === e.status ? "selected" : ""}>${esc(ENG_STATUS_LABELS[status] || status)}</option>`).join("")}
      </select>`;
    } else if (activeQa) {
      html += '<span class="engage-static-display engage-status-lock text-sm">Status locked by active QA</span>';
    }

    // Link buttons
    if (caps.canEditEngagement || caps.canManageAll) {
      html += '<button type="button" class="btn-secondary text-sm eng-link-cal-btn">Link Calendar</button>';
      html += '<button type="button" class="btn-secondary text-sm eng-link-reporter-btn">Link Reporter</button>';
      html += '<button type="button" class="btn-primary text-sm eng-create-report-btn">Create Report</button>';
      html += '<button type="button" class="btn-secondary text-sm eng-create-cal-btn">Create Calendar Project</button>';
    }
    const canQaRequest = canRequestQaAgain();
    html += `<button type="button" class="btn-primary text-sm eng-request-qa-btn" ${canQaRequest ? "" : "disabled"}>${activeQa ? "QA In Progress" : latestQa?.status === "requires_more_work" ? "Resubmit QA" : "Request QA"}</button>`;
    html += '<button type="button" class="btn-secondary text-sm eng-note-btn">Add Note</button>';
    html += '</div></div>';

    if (activeQa) {
      html += `<div class="engage-control-banner">
        <div>
          <strong>QA controls this engagement right now.</strong>
          <div class="engage-list-item-meta">Delivery status returns here when QA approves delivery, requests changes, or cancels the review.</div>
        </div>
        ${qaStatusPill(activeQa.status)}
      </div>`;
    }

    // Details panel
    html += '<div class="engage-panel engage-eng-fields">';
    html += '<div class="engage-grid-2">';
    const cal = data.linkedCalendarProject || null;
    const calendarEstimate = cal
      ? `${Number(cal.estimatedValue || 0).toFixed(1)} ${cal.estimatedMode === "days" ? "days" : "hours"} (${Number(cal.estimatedHours || 0).toFixed(1)}h)`
      : "---";
    const fields = [
      ["Client", esc(e.client_display_name || e.client_name || "---")],
      ["Types", renderTypeTags(e.engagement_type) || "---"],
      ["Priority", priorityLabel(e.priority)],
      ["Commercial Value", e.commercial_value != null ? formatCurrency(e.commercial_value) : "---"],
      ["Engage Estimate", e.estimated_days != null ? `${e.estimated_days} days` : "---"],
      ["Engage Target Start", e.scheduled_start_date || "---"],
      ["Engage Target End", e.scheduled_end_date || "---"],
      ["Calendar Start", cal?.startsAt ? formatDate(cal.startsAt) : "---"],
      ["Calendar End", cal?.endsAt ? formatDate(cal.endsAt) : "---"],
      ["Calendar Estimate", calendarEstimate],
      ["Actual Start", e.actual_start_date || "---"],
      ["Actual End", e.actual_end_date || "---"],
    ];
    for (const [label, value] of fields) {
      html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">${label}</span><div>${value}</div></div>`;
    }
    html += '</div>';

    // Linked resources
    const links = [];
    if (data.linkedCalendarProject) {
      const lp = data.linkedCalendarProject;
      links.push(`Calendar: <a href="/calendar/?view=projects&projectId=${encodeURIComponent(lp.id)}" class="engage-link-badge" target="_blank">${esc(lp.code ? `${lp.code} · ${lp.name}` : (lp.name || "Calendar Project"))}</a> <span class="text-muted text-xs">${esc(lp.status || "")}</span>`);
    } else if (e.redseccal_project_id) {
      links.push(`Calendar: <span class="engage-link-badge">${esc(e.redseccal_project_id)}</span>`);
    }
    if (data.linkedReporterProject) {
      const lr = data.linkedReporterProject;
      links.push(`Reporter: <a href="/reporter/?projectId=${encodeURIComponent(lr.id)}" class="engage-link-badge" target="_blank">${esc(lr.title || "Report Project")}</a> <span class="text-muted text-xs">${esc(lr.status || "")}</span>`);
    } else if (e.redsec_reporter_project_id) {
      links.push(`Reporter: <span class="engage-link-badge">${esc(e.redsec_reporter_project_id)}</span>`);
    }
    if (links.length > 0) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Linked Resources</span><div class="mt-1">${links.join(" &middot; ")}</div></div>`;
    }

    if (e.high_level_scope_summary) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Scope</span><div>${esc(e.high_level_scope_summary)}</div></div>`;
    }
    if (e.notes) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Notes</span><div>${esc(e.notes)}</div></div>`;
    }
    html += '</div>';

    // Team section
    html += '<div class="engage-section"><div class="engage-section-title-row"><div class="engage-section-title">Team</div>';
    if (caps.canAssignTeam || caps.canManageAll) {
      html += '<button type="button" class="btn-primary text-sm eng-add-member-btn">Add Team Member</button>';
    }
    html += '</div><div class="engage-panel">';
    if (team.length === 0) {
      html += '<div class="engage-empty">No team members assigned.</div>';
    } else {
      html += '<div class="engage-team-list">';
      for (const m of team) {
        html += `<div class="engage-team-item">
          <div>
            <strong>${esc(m.username || m.user_id)}</strong>
            <span class="engage-type-tag">${esc(TEAM_ROLE_LABELS[m.role] || m.role || "member")}</span>
            ${m.is_primary ? '<span class="engage-type-tag">Primary</span>' : ""}
          </div>
          <div>`;
        if (caps.canAssignTeam || caps.canManageAll) {
          html += `<button type="button" class="btn-secondary text-sm eng-remove-member-btn" data-member-id="${m.id}" title="Remove">Remove</button>`;
        }
        html += '</div></div>';
      }
      html += '</div>';
    }
    html += '</div></div>';

    // Tabs for Activity / QA / Notes
    html += '<div class="engage-tabs">';
    ["Activity", "QA", "Notes"].forEach((tab, i) => {
      html += `<button type="button" class="engage-tab ${i === 0 ? "active" : ""}" data-eng-tab="${tab.toLowerCase()}">${tab}</button>`;
    });
    html += '</div>';

    html += `<div data-eng-panel="activity">${renderActivity(activity)}</div>`;
    html += `<div data-eng-panel="qa" class="hidden">${renderQaReviews(data.qaReviews || [])}</div>`;
    html += `<div data-eng-panel="notes" class="hidden">${renderNotes(notes)}</div>`;

    html += '</div>';

    section.innerHTML = html;
    bindDetailEvents(section, e, caps);
  }

  function renderActivity(activity) {
    if (!activity || activity.length === 0) return '<div class="engage-panel"><div class="engage-empty">No activity recorded.</div></div>';
    return '<div class="engage-panel">' + activity.map((a) => `<div class="engage-activity-item">
      <div class="engage-activity-dot"></div>
      <div class="engage-activity-content">
        <strong>${esc((a.action || "").replace(/_/g, " "))}</strong>
        <span class="engage-activity-meta"> ${esc(a.username || "")} ${a.details ? "&middot; " + esc(JSON.stringify(a.details)).substring(0, 80) : ""}</span>
      </div>
      <div class="engage-activity-time">${formatDate(a.created_at)}</div>
    </div>`).join("") + '</div>';
  }

  function renderNotes(notes) {
    if (!notes || notes.length === 0) return '<div class="engage-panel"><div class="engage-empty">No notes.</div></div>';
    return '<div class="engage-panel">' + notes.map((n) => `<div class="engage-note-item">
      <div class="engage-note-content">${esc(n.content)}</div>
      <div class="engage-list-item-meta">${esc(n.username || n.user_id || "")} &middot; ${formatDate(n.created_at)}</div>
    </div>`).join("") + '</div>';
  }

  const QA_STATUS_LABELS = {
    not_requested: "Not Requested", ready_for_qa: "QA Requested", assigned: "Assigned",
    reviewing: "Reviewing", requires_more_work: "Changes Required",
    ready_for_delivery: "Approved for Delivery", cancelled: "Cancelled",
  };
  const QA_STATUS_CLASSES = {
    not_requested: "draft", ready_for_qa: "qa", assigned: "qa", reviewing: "testing",
    requires_more_work: "blocked", ready_for_delivery: "delivered", delivered: "delivered", cancelled: "closed",
  };

  function qaStatusPill(status) {
    const cls = QA_STATUS_CLASSES[status] || "draft";
    const label = QA_STATUS_LABELS[status] || status;
    return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
  }

  function renderQaReviews(reviews) {
    if (!reviews || reviews.length === 0) return '<div class="engage-panel"><div class="engage-empty">No QA reviews requested.</div></div>';
    return '<div class="engage-panel">' + reviews.map((r) => {
      const cls = QA_STATUS_CLASSES[r.status] || "draft";
      const label = QA_STATUS_LABELS[r.status] || r.status;
      let details = "";
      if (r.report_link) details += `<span class="engage-link-badge">Report</span> `;
      if (r.share_link) details += `<span class="engage-link-badge">Share</span> `;
      if (r.assigned_by_username) details += `Submitted by: ${esc(r.assigned_by_username)} `;
      if (r.assigned_to_username) details += `Reviewer: ${esc(r.assigned_to_username)}`;
      if (r.qa_notes) {
        const truncated = r.qa_notes.length > 120 ? r.qa_notes.substring(0, 120) + "..." : r.qa_notes;
        details += `<div class="engage-qa-notes-preview">${esc(truncated)}</div>`;
      }
      return `<div class="engage-list-item">
        <div>
          <strong>${esc(label)}</strong>
          <div class="engage-list-item-meta">${details} &middot; ${formatDate(r.created_at)}</div>
        </div>
        <span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>
      </div>`;
    }).join("") + '</div>';
  }

  function openRequestQaModal(engagementId) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Request QA</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Reporter Project ID</label>
        <input type="text" id="qa-reporter-id" class="input-field w-full" placeholder="Optional">
        <label class="block text-sm text-muted mb-1 mt-3">Report Link</label>
        <input type="text" id="qa-report-link" class="input-field w-full" placeholder="PDF URL or path">
        <label class="block text-sm text-muted mb-1 mt-3">Share Link</label>
        <input type="text" id="qa-share-link" class="input-field w-full" placeholder="Optional ${window.brandName("Share")} link">
        <label class="block text-sm text-muted mb-1 mt-3">Notes for Reviewer</label>
        <textarea id="qa-request-notes" class="input-field w-full" rows="3" placeholder="Context for the QA reviewer..."></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Submit QA Request</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    const linkedReporterId = state.detail?.linkedReporterProject?.id || state.selectedEng?.redsec_reporter_project_id || "";
    const latestReportLink = state.detail?.latestReporterPdf?.downloadUrl || "";
    overlay.querySelector("#qa-reporter-id").value = linkedReporterId;
    overlay.querySelector("#qa-report-link").value = latestReportLink;

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      try {
        await EngageApi.requestQa(engagementId, {
          reporterProjectId: overlay.querySelector("#qa-reporter-id").value.trim() || undefined,
          reportLink: overlay.querySelector("#qa-report-link").value.trim() || undefined,
          shareLink: overlay.querySelector("#qa-share-link").value.trim() || undefined,
          qaNotes: overlay.querySelector("#qa-request-notes").value.trim(),
        });
        overlay.remove();
        await openEngagement(engagementId);
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to request QA: " + err.message });
      }
    });
  }

  function bindDetailEvents(section, e, caps) {
    section.querySelector(".eng-back-btn").addEventListener("click", () => { state.view = "list"; renderList(); });
    section.querySelector(".eng-note-btn").addEventListener("click", () => EngageClients.openNoteModal("engagement", e.id));
    section.querySelector(".eng-request-qa-btn")?.addEventListener("click", () => openRequestQaModal(e.id));

    // Tab switching
    section.querySelectorAll(".engage-tab[data-eng-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        section.querySelectorAll(".engage-tab[data-eng-tab]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        section.querySelectorAll("[data-eng-panel]").forEach((p) => p.classList.add("hidden"));
        const panel = section.querySelector(`[data-eng-panel="${tab.dataset.engTab}"]`);
        if (panel) panel.classList.remove("hidden");
      });
    });

    section.querySelector(".eng-status-select")?.addEventListener("change", async (event) => {
        const next = event.target.value;
        if (next === e.status) return;
        const confirmed = await EngageModal.confirm({
          title: "Update Status",
          message: `Change status to "${ENG_STATUS_LABELS[next]}"?`,
          confirmLabel: "Update",
          danger: next === "cancelled",
        });
        if (!confirmed) {
          event.target.value = e.status;
          return;
        }
        try {
          await EngageApi.updateStatus(e.id, next);
          await openEngagement(e.id);
        } catch (err) {
          event.target.value = e.status;
          await EngageModal.alert({ title: "Error", message: "Failed to update status: " + err.message });
        }
    });

    // Link Calendar
    section.querySelector(".eng-link-cal-btn")?.addEventListener("click", async () => {
      openCalendarProjectPicker(e);
    });

    // Link Reporter
    section.querySelector(".eng-link-reporter-btn")?.addEventListener("click", async () => {
      openReporterProjectPicker(e);
    });

    // Create Report
    section.querySelector(".eng-create-report-btn")?.addEventListener("click", async () => {
      openCreateReporterProject(e);
    });

    // Create Calendar Project
    section.querySelector(".eng-create-cal-btn")?.addEventListener("click", async () => {
      openCreateCalendarProject(e);
    });

    // Remove team member
    section.querySelectorAll(".eng-remove-member-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const confirmed = await EngageModal.confirm({
          title: "Remove Team Member",
          message: "Remove this team member from the engagement?",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!confirmed) return;
        try {
          await EngageApi.removeTeamMember(e.id, btn.dataset.memberId);
          await openEngagement(e.id);
        } catch (err) {
          await EngageModal.alert({ title: "Error", message: "Failed to remove member: " + err.message });
        }
      });
    });

    // Add team member
    section.querySelector(".eng-add-member-btn")?.addEventListener("click", () => openAddMemberModal(e.id));
  }

  function openAddMemberModal(engagementId) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Add Team Member</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">User *</label>
        <select id="member-user" class="input-field w-full"><option value="">Loading users...</option></select>
        <label class="block text-sm text-muted mb-1 mt-3">Role</label>
        <select id="member-role" class="input-field w-full">
          ${TEAM_ROLES.map((r) => `<option value="${r}">${esc(TEAM_ROLE_LABELS[r])}</option>`).join("")}
        </select>
        <label class="block mt-3"><input type="checkbox" id="member-primary"> Primary member</label>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Add</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });

    EngageApi.listUsers().then((result) => {
      const select = overlay.querySelector("#member-user");
      const users = result.users || [];
      select.innerHTML = '<option value="">Select a user</option>' +
        users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join("");
    }).catch(() => {
      overlay.querySelector("#member-user").innerHTML = '<option value="">Failed to load users</option>';
    });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const userId = overlay.querySelector("#member-user").value;
      if (!userId) { await EngageModal.alert({ title: "Validation Error", message: "Select a user." }); return; }
      try {
        await EngageApi.addTeamMember(engagementId, {
          userId,
          role: overlay.querySelector("#member-role").value,
          isPrimary: overlay.querySelector("#member-primary").checked,
        });
        overlay.remove();
        await openEngagement(engagementId);
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to add member: " + err.message });
      }
    });
  }

  async function refresh() {
    try {
      const result = await EngageApi.listEngagements();
      state.engagements = result.engagements || [];
      state.view = "list";
      state.selectedEng = null;
      renderList();
    } catch {
      state.engagements = [];
    }
  }

  async function openReporterProjectPicker(e) {
    const data = await EngageApi.listReporterProjects();
    const projects = data.projects || [];
    if (!projects.length) {
      await EngageModal.alert({ title: "No Projects", message: "No active Reporter projects found." });
      return;
    }
    const items = projects.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} — ${esc(p.clientName || "No client")} [${esc(p.status)}]</option>`).join("");
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Select Reporter Project</label>
      <select id="eng-reporter-pick" class="input-field w-full"><option value="">Choose...</option>${items}</select>
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Link Reporter Project", message: html, htmlMessage: true, confirmLabel: "Link" });
    if (!confirmed) return;
    const selectedId = document.getElementById("eng-reporter-pick")?.value;
    if (!selectedId) { await EngageModal.alert({ title: "Error", message: "Select a project." }); return; }
    try {
      await EngageApi.linkReporter(e.id, { redsecReporterProjectId: selectedId });
      await openEngagement(e.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to link: " + err.message });
    }
  }

  async function openCalendarProjectPicker(e) {
    const data = await EngageApi.listCalendarProjects();
    const projects = data.projects || [];
    if (!projects.length) {
      await EngageModal.alert({ title: "No Calendar Projects", message: "No Calendar projects found." });
      return;
    }
    const items = projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${esc(p.clientName || "No client")} [${esc(p.status || "")}]</option>`).join("");
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Select Calendar Project</label>
      <select id="eng-cal-pick" class="input-field w-full"><option value="">Choose...</option>${items}</select>
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Link Calendar Project", message: html, htmlMessage: true, confirmLabel: "Link" });
    if (!confirmed) return;
    const selectedId = document.getElementById("eng-cal-pick")?.value;
    if (!selectedId) { await EngageModal.alert({ title: "Error", message: "Select a project." }); return; }
    try {
      await EngageApi.linkCalendar(e.id, { redseccalProjectId: selectedId });
      await openEngagement(e.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to link: " + err.message });
    }
  }

  async function openCreateReporterProject(e) {
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Report Title</label>
      <input type="text" id="eng-create-report-title" class="input-field w-full" value="${esc(e.title + " - Report")}">
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Create Reporter Project", message: html, htmlMessage: true, confirmLabel: "Create" });
    if (!confirmed) return;
    const title = document.getElementById("eng-create-report-title")?.value;
    if (!title?.trim()) { await EngageModal.alert({ title: "Error", message: "Title is required." }); return; }
    try {
      const result = await EngageApi.createReporterProject(e.id, { title: title.trim() });
      await EngageModal.alert({ title: "Project Created", message: `Created "${result.project.title}" in Reporter.` });
      await openEngagement(e.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to create: " + err.message });
    }
  }

  async function openCreateCalendarProject(e) {
    const derivedRate = e.commercial_value && e.estimated_days ? Math.round((Number(e.commercial_value) / Number(e.estimated_days)) * 100) / 100 : 0;
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Project Name</label>
      <input type="text" id="eng-create-cal-name" class="input-field w-full" value="${esc(e.title)}">
      <label class="block text-sm text-muted mb-1">Project Code</label>
      <input type="text" id="eng-create-cal-code" class="input-field w-full" value="${esc((e.title || "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24))}">
      <div class="engage-grid-2">
        <div>
          <label class="block text-sm text-muted mb-1">Estimated Days</label>
          <input type="number" min="0" step="0.1" id="eng-create-cal-days" class="input-field w-full" value="${esc(e.estimated_days || "")}">
        </div>
        <div>
          <label class="block text-sm text-muted mb-1">Daily Rate</label>
          <input type="number" min="0" step="0.01" id="eng-create-cal-rate" class="input-field w-full" value="${esc(derivedRate || "")}">
        </div>
      </div>
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Create Calendar Project", message: html, htmlMessage: true, confirmLabel: "Create" });
    if (!confirmed) return;
    const name = document.getElementById("eng-create-cal-name")?.value;
    if (!name?.trim()) { await EngageModal.alert({ title: "Error", message: "Name is required." }); return; }
    try {
      const result = await EngageApi.createCalendarProject(e.id, {
        name: name.trim(),
        code: document.getElementById("eng-create-cal-code")?.value.trim(),
        estimatedDays: Number.parseFloat(document.getElementById("eng-create-cal-days")?.value) || undefined,
        billableRate: Number.parseFloat(document.getElementById("eng-create-cal-rate")?.value) || undefined,
      });
      await EngageModal.alert({ title: "Calendar Project Created", message: `Created "${result.project.name}" in Calendar.` });
      await openEngagement(e.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to create: " + err.message });
    }
  }

  async function init() {
    await refresh();
  }

  return { init, refresh, openEng: openEngagement };
})();
