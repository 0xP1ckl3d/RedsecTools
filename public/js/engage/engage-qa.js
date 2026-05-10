const EngageQa = (() => {
  let state = { reviews: [], activeFilter: "ready_for_qa" };

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

  const QA_STATUS_CLASSES = {
    not_requested: "draft",
    ready_for_qa: "qa",
    assigned: "qa",
    reviewing: "testing",
    requires_more_work: "blocked",
    ready_for_delivery: "delivered",
    delivered: "delivered",
    cancelled: "closed",
  };

  const QA_FILTERS = [
    { key: "ready_for_qa", label: "Queue", param: { status: "ready_for_qa" } },
    { key: "my_reviews", label: "My Reviews", param: { assignee: "me" } },
    { key: "assigned", label: "Assigned", param: { status: "assigned" } },
    { key: "reviewing", label: "In Review", param: { status: "reviewing" } },
    { key: "requires_more_work", label: "Needs Work", param: { status: "requires_more_work" } },
    { key: "ready_for_delivery", label: "Ready to Deliver", param: { status: "ready_for_delivery" } },
    { key: "delivered", label: "Completed", param: { status: "delivered" } },
    { key: "all", label: "All", param: { status: "all" } },
  ];

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function formatDate(ts) {
    if (!ts) return "---";
    return new Date(ts * 1000).toLocaleDateString();
  }

  function qaStatusPill(status) {
    const cls = QA_STATUS_CLASSES[status] || "draft";
    const label = QA_STATUS_LABELS[status] || status;
    return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(label)}</span>`;
  }

  async function init() {
    state.activeFilter = "ready_for_qa";
    await refresh();
  }

  async function refresh() {
    const section = document.querySelector('[data-engage-section="qa"]');
    if (!section) return;
    section.innerHTML = '<div class="engage-empty">Loading QA queue...</div>';
    try {
      const filter = QA_FILTERS.find((f) => f.key === state.activeFilter);
      let params = filter ? { ...filter.param } : { status: "ready_for_qa" };

      if (params.assignee === "me") {
        const userId = window._engageUser?.id;
        if (!userId) {
          section.innerHTML = '<div class="engage-empty">Unable to determine user identity.</div>';
          return;
        }
        params = { assignee: userId };
      }

      const result = await EngageApi.listQa(params);
      state.reviews = result.reviews || [];
      renderList(section);
    } catch (err) {
      const section2 = document.querySelector('[data-engage-section="qa"]');
      if (section2) section2.innerHTML = `<div class="engage-empty">Failed to load QA reviews: ${esc(err.message)}</div>`;
    }
  }

  function renderList(section) {
    const caps = window._engageCapabilities || {};
    const reviews = state.reviews;

    let html = '<div class="engage-qa-header">';
    html += '<div class="engage-section-title">QA Queue</div>';
    html += '<button type="button" class="btn-primary text-sm qa-submit-btn">Submit for QA</button>';
    html += "</div>";

    html += '<div class="engage-tabs engage-qa-filters">';
    for (const filter of QA_FILTERS) {
      if (filter.key === "my_reviews" && !caps.canPerformQa && !caps.canManageQa && !caps.canManageAll) continue;
      const isActive = filter.key === state.activeFilter;
      html += `<button type="button" class="engage-tab ${isActive ? "active" : ""}" data-qa-filter="${filter.key}">${esc(filter.label)}</button>`;
    }
    html += "</div>";

    if (!reviews || reviews.length === 0) {
      html += '<div class="engage-panel"><div class="engage-empty">No QA reviews match this filter.</div></div>';
    } else {
      html += '<div class="engage-qa-cards">';
      for (const r of reviews) {
        html += renderReviewCard(r, caps);
      }
      html += "</div>";
    }

    section.innerHTML = html;
    bindEvents(section, caps);
  }

  function renderReviewCard(review, caps) {
    let html = `<div class="engage-qa-detail-card" data-qa-id="${esc(review.id)}">`;

    html += '<div class="engage-qa-card-header">';
    html += "<div>";
    html += `<div class="engage-qa-card-title">${esc(review.engagement_title || "Unknown Engagement")}</div>`;
    html += `<div class="engage-qa-card-meta">${esc(review.client_display_name || review.client_name || "")}</div>`;
    html += "</div>";
    html += qaStatusPill(review.status);
    html += "</div>";

    html += '<div class="engage-qa-card-details">';
    if (review.report_link) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Report:</span> <span class="engage-link-badge">${esc(review.report_link)}</span></div>`;
    }
    if (review.share_link) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Share:</span> <span class="engage-link-badge">${esc(review.share_link)}</span></div>`;
    }
    if (review.assigned_to_username) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Reviewer:</span> ${esc(review.assigned_to_username)}</div>`;
    }
    if (review.assigned_by_username) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Assigned by:</span> ${esc(review.assigned_by_username)}</div>`;
    }
    if (review.qa_notes) {
      const truncated = review.qa_notes.length > 150 ? review.qa_notes.substring(0, 150) + "..." : review.qa_notes;
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Notes:</span> ${esc(truncated)}</div>`;
    }
    html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Created:</span> ${formatDate(review.created_at)}</div>`;
    if (review.updated_at && review.updated_at !== review.created_at) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Updated:</span> ${formatDate(review.updated_at)}</div>`;
    }
    if (review.completed_at) {
      html += `<div class="engage-qa-card-field"><span class="engage-qa-field-label">Completed:</span> ${formatDate(review.completed_at)}</div>`;
    }
    html += "</div>";

    const userId = window._engageUser?.id;
    const isAssignee = review.assigned_to_user_id === userId;
    const actions = getActions(review, caps, isAssignee);
    if (actions.length > 0) {
      html += '<div class="engage-qa-card-actions">';
      for (const act of actions) {
        const btnClass = act.danger ? "btn-danger" : "btn-primary";
        html += `<button type="button" class="${btnClass} text-sm qa-action-btn" data-action="${act.action}" data-status="${esc(act.status || "")}">${esc(act.label)}</button>`;
      }
      html += "</div>";
    }

    html += "</div>";
    return html;
  }

  function getActions(review, caps, isAssignee) {
    const actions = [];
    const s = review.status;

    if (s === "ready_for_qa" && (caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "assign", label: "Assign Reviewer" });
    }
    if (s === "assigned" && (isAssignee || caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "update_status", status: "reviewing", label: "Start Review" });
    }
    if (s === "reviewing" && (isAssignee || caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "update_status_with_notes", status: "requires_more_work", label: "Requires More Work" });
      actions.push({ action: "update_status", status: "ready_for_delivery", label: "Ready for Delivery" });
    }
    if (s === "requires_more_work" && (isAssignee || caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "update_status", status: "reviewing", label: "Resume Review" });
    }
    if (s === "ready_for_delivery" && (caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "update_status", status: "delivered", label: "Mark Delivered" });
    }
    if ((caps.canManageQa || caps.canManageAll) && !["delivered", "cancelled"].includes(s)) {
      actions.push({ action: "update_status", status: "cancelled", label: "Cancel", danger: true });
    }
    if (["assigned", "reviewing", "requires_more_work"].includes(s) && (isAssignee || caps.canManageQa || caps.canManageAll)) {
      actions.push({ action: "add_notes", label: "Add Notes" });
    }

    return actions;
  }

  function bindEvents(section, caps) {
    section.querySelector(".qa-submit-btn")?.addEventListener("click", () => openSubmitQaModal());

    section.querySelectorAll("[data-qa-filter]").forEach((tab) => {
      tab.addEventListener("click", async () => {
        state.activeFilter = tab.dataset.qaFilter;
        await refresh();
      });
    });

    section.querySelectorAll(".qa-action-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-qa-id]");
        if (!card) return;
        const reviewId = card.dataset.qaId;
        const action = btn.dataset.action;
        const targetStatus = btn.dataset.status;
        await handleAction(reviewId, action, targetStatus, caps);
      });
    });
  }

  async function handleAction(reviewId, action, targetStatus, caps) {
    if (action === "assign") {
      openAssignModal(reviewId);
      return;
    }
    if (action === "update_status_with_notes") {
      openStatusWithNotesModal(reviewId, targetStatus);
      return;
    }
    if (action === "add_notes") {
      openQaNotesModal(reviewId);
      return;
    }
    if (action === "update_status") {
      const label = QA_STATUS_LABELS[targetStatus] || targetStatus;
      const isDanger = targetStatus === "cancelled";
      const confirmed = await EngageModal.confirm({
        title: "Update QA Status",
        message: `Change QA status to "${label}"?`,
        confirmLabel: "Update",
        danger: isDanger,
      });
      if (!confirmed) return;
      try {
        await EngageApi.updateQaStatus(reviewId, { status: targetStatus });
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to update QA status: " + err.message });
      }
    }
  }

  function openAssignModal(reviewId) {
    const review = state.reviews.find((r) => r.id === reviewId);
    if (!review) return;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Assign QA Reviewer</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Reviewer *</label>
        <select id="qa-assignee" class="input-field w-full"><option value="">Loading users...</option></select>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Assign</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    EngageApi.listUsers().then((result) => {
      const select = overlay.querySelector("#qa-assignee");
      const users = result.users || [];
      select.innerHTML = '<option value="">Select a reviewer</option>' +
        users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join("");
    }).catch(() => {
      overlay.querySelector("#qa-assignee").innerHTML = '<option value="">Failed to load users</option>';
    });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const assignedToUserId = overlay.querySelector("#qa-assignee").value;
      if (!assignedToUserId) {
        await EngageModal.alert({ title: "Validation Error", message: "Select a reviewer." });
        return;
      }
      try {
        await EngageApi.assignQa(review.engagement_id, { assignedToUserId, qaReviewId: reviewId });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to assign reviewer: " + err.message });
      }
    });
  }

  function openStatusWithNotesModal(reviewId, targetStatus) {
    const label = QA_STATUS_LABELS[targetStatus] || targetStatus;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">${esc(label)}</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Notes *</label>
        <textarea id="qa-status-notes" class="input-field w-full" rows="4" placeholder="Describe what needs work..."></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Update</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const notes = overlay.querySelector("#qa-status-notes").value.trim();
      if (!notes) {
        await EngageModal.alert({ title: "Validation Error", message: "Notes are required for this action." });
        return;
      }
      try {
        await EngageApi.updateQaStatus(reviewId, { status: targetStatus, qaNotes: notes });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to update QA status: " + err.message });
      }
    });
  }

  function openQaNotesModal(reviewId) {
    const existing = state.reviews.find((r) => r.id === reviewId);
    const existingNotes = existing ? existing.qa_notes || "" : "";

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">QA Notes</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Notes</label>
        <textarea id="qa-notes-input" class="input-field w-full" rows="5" placeholder="Add QA notes...">${esc(existingNotes)}</textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Save Notes</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const notes = overlay.querySelector("#qa-notes-input").value.trim();
      if (!notes) {
        await EngageModal.alert({ title: "Validation Error", message: "Notes cannot be empty." });
        return;
      }
      try {
        await EngageApi.updateQaStatus(reviewId, { status: existing?.status, qaNotes: notes });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to save notes: " + err.message });
      }
    });
  }

  function openSubmitQaModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Submit for QA</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Engagement *</label>
        <select id="qa-submit-engagement" class="input-field w-full"><option value="">Loading engagements...</option></select>
        <label class="block text-sm text-muted mb-1 mt-3">Reporter Project ID</label>
        <input type="text" id="qa-submit-reporter-id" class="input-field w-full" placeholder="Optional">
        <label class="block text-sm text-muted mb-1 mt-3">Report Link</label>
        <input type="text" id="qa-submit-report-link" class="input-field w-full" placeholder="PDF URL or path">
        <label class="block text-sm text-muted mb-1 mt-3">Share Link</label>
        <input type="text" id="qa-submit-share-link" class="input-field w-full" placeholder="Optional RedSecShare link">
        <label class="block text-sm text-muted mb-1 mt-3">Notes for Reviewer *</label>
        <textarea id="qa-submit-notes" class="input-field w-full" rows="4" placeholder="Describe the report, scope, what needs reviewing..."></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Submit</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    EngageApi.listEngagements().then((result) => {
      const select = overlay.querySelector("#qa-submit-engagement");
      const engagements = result.engagements || [];
      select.innerHTML = '<option value="">Select an engagement</option>' +
        engagements.filter((e) => !e.archived_at).map((e) =>
          `<option value="${e.id}">${esc(e.title)}${e.client_display_name ? " — " + esc(e.client_display_name) : ""}</option>`
        ).join("");
    }).catch(() => {
      overlay.querySelector("#qa-submit-engagement").innerHTML = '<option value="">Failed to load engagements</option>';
    });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const engagementId = overlay.querySelector("#qa-submit-engagement").value;
      const notes = overlay.querySelector("#qa-submit-notes").value.trim();
      if (!engagementId) {
        await EngageModal.alert({ title: "Validation Error", message: "Select an engagement." });
        return;
      }
      if (!notes) {
        await EngageModal.alert({ title: "Validation Error", message: "Notes are required. Provide context for the QA reviewer." });
        return;
      }
      try {
        await EngageApi.requestQa(engagementId, {
          reporterProjectId: overlay.querySelector("#qa-submit-reporter-id").value.trim() || undefined,
          reportLink: overlay.querySelector("#qa-submit-report-link").value.trim() || undefined,
          shareLink: overlay.querySelector("#qa-submit-share-link").value.trim() || undefined,
          qaNotes: notes,
        });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to submit for QA: " + err.message });
      }
    });
  }

  return { init, refresh };
})();
