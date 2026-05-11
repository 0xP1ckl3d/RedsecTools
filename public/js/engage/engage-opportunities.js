const EngageOpportunities = (() => {
  let state = { opportunities: [], selectedOpp: null, detail: null, view: "list" };

  const OPP_STAGES = ["lead", "qualified", "scoping", "proposal_drafting", "proposal_sent", "negotiation", "won", "lost", "rejected"];
  const OPP_STAGE_LABELS = { lead: "Lead", qualified: "Qualified", scoping: "Scoping", proposal_drafting: "Proposal Drafting", proposal_sent: "Proposal Sent", negotiation: "Negotiation", won: "Won", lost: "Lost", rejected: "Rejected" };
  const OPP_TYPES = ["internal", "external", "webapp", "cloud", "build_review", "red_team", "wireless", "configuration_review", "assumed_breach", "custom"];

  const ACTIVE_STAGES = ["lead", "qualified", "scoping", "proposal_drafting", "proposal_sent", "negotiation"];
  const CLOSED_STAGES = ["won", "lost", "rejected"];

  function parseOppTypes(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [raw]; } catch { return [raw]; }
  }

  function renderTypeTags(raw) {
    const types = parseOppTypes(raw);
    if (!types.length) return "";
    return types.map((t) => `<span class="engage-type-tag">${esc(OPP_TYPE_LABELS[t] || t)}</span>`).join("");
  }

  const OPP_TYPE_LABELS = { internal: "Internal", external: "External", webapp: "Web App", cloud: "Cloud", build_review: "Build Review", red_team: "Red Team", wireless: "Wireless", configuration_review: "Config Review", assumed_breach: "Assumed Breach", custom: "Custom" };

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function formatCurrency(value) {
    if (value == null) return "---";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }

  function formatDate(ts) {
    if (!ts) return "---";
    return new Date(ts * 1000).toLocaleDateString();
  }

  function stagePill(stage) {
    const colors = { lead: "draft", qualified: "draft", scoping: "active", proposal_drafting: "qa", proposal_sent: "qa", negotiation: "reporting", won: "delivered", lost: "closed", rejected: "closed" };
    const cls = colors[stage] || "draft";
    return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(OPP_STAGE_LABELS[stage] || stage)}</span>`;
  }

  function renderPipeline() {
    const section = document.querySelector('[data-engage-section="pipeline"]');
    if (!section) return;

    let html = '<div class="engage-pipeline-header">';
    html += '<div class="engage-section-title">Pipeline</div>';
    html += '<button type="button" class="btn-primary text-sm opp-create-btn">New Opportunity</button>';
    html += '</div>';

    const active = state.opportunities.filter((o) => ACTIVE_STAGES.includes(o.stage));
    const closed = state.opportunities.filter((o) => CLOSED_STAGES.includes(o.stage));

    if (state.opportunities.length === 0) {
      html += '<div class="engage-panel"><div class="engage-empty">No opportunities in the pipeline. Create one to get started.</div></div>';
      section.innerHTML = html;
      bindCreateBtn(section);
      return;
    }

    html += '<div class="engage-grid-2">';

    // Active pipeline by stage
    html += '<div class="engage-section"><div class="engage-section-title">Active Pipeline</div><div class="engage-panel">';
    const byStage = {};
    for (const s of ACTIVE_STAGES) byStage[s] = [];
    for (const o of active) {
      if (byStage[o.stage]) byStage[o.stage].push(o);
    }
    for (const s of ACTIVE_STAGES) {
      const items = byStage[s];
      if (items.length === 0) continue;
      html += `<div class="engage-pipeline-stage">
        <div class="engage-pipeline-stage-header">${esc(OPP_STAGE_LABELS[s])} <span class="engage-pipeline-count">${items.length}</span></div>`;
      for (const o of items) {
        html += `<div class="engage-pipeline-card" data-opp-id="${o.id}">
          <div class="engage-pipeline-card-title">${esc(o.title)}</div>
          <div class="engage-pipeline-card-meta">${renderTypeTags(o.opportunity_type)}${o.estimated_value != null ? " &middot; " + formatCurrency(o.estimated_value) : ""}${o.probability_percent != null ? " &middot; " + o.probability_percent + "%" : ""}</div>
          <div class="engage-pipeline-card-meta">${esc(o.client_name || "")}</div>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div></div>';

    // Closed outcomes
    html += '<div class="engage-section"><div class="engage-section-title">Closed</div><div class="engage-panel">';
    if (closed.length === 0) {
      html += '<div class="engage-empty">No closed opportunities</div>';
    } else {
      for (const o of closed) {
        html += `<div class="engage-pipeline-card engage-pipeline-closed" data-opp-id="${o.id}">
          <div class="engage-pipeline-card-title">${esc(o.title)}</div>
          <div class="engage-pipeline-card-meta">${stagePill(o.stage)}${o.estimated_value != null ? " &middot; " + formatCurrency(o.estimated_value) : ""}</div>
          <div class="engage-pipeline-card-meta">${esc(o.client_name || "")} &middot; ${formatDate(o.closed_at)}</div>
        </div>`;
      }
    }
    html += '</div></div>';

    html += '</div>';
    section.innerHTML = html;
    bindCreateBtn(section);
    section.querySelectorAll(".engage-pipeline-card[data-opp-id]").forEach((el) => {
      el.addEventListener("click", () => openOpp(el.dataset.oppId));
    });
  }

  function bindCreateBtn(container) {
    const btn = container.querySelector(".opp-create-btn");
    if (btn) btn.addEventListener("click", openCreateModal);
  }

  function openCreateModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">New Opportunity</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Client *</label>
        <select id="opp-client" class="input-field w-full"><option value="">Loading clients...</option></select>
        <label class="block text-sm text-muted mb-1 mt-3">Title *</label>
        <input type="text" id="opp-title" class="input-field w-full" placeholder="Opportunity title">
        <label class="block text-sm text-muted mb-1 mt-3">Types *</label>
        <div class="engage-type-checkboxes">
          ${OPP_TYPES.map((t) => `<label class="engage-type-checkbox"><input type="checkbox" name="opp-types" value="${t}"> ${esc(OPP_TYPE_LABELS[t] || t)}</label>`).join("")}
        </div>
        <div class="engage-grid-2 mt-3">
          <div>
            <label class="block text-sm text-muted mb-1">Estimated Value</label>
            <input type="text" inputmode="numeric" id="opp-value" class="input-field w-full" placeholder="0">
          </div>
          <div>
            <label class="block text-sm text-muted mb-1">Probability %</label>
            <input type="text" inputmode="numeric" id="opp-probability" class="input-field w-full" placeholder="50">
          </div>
        </div>
        <div class="engage-grid-2 mt-3">
          <div>
            <label class="block text-sm text-muted mb-1">Estimated Days</label>
            <input type="text" inputmode="numeric" id="opp-days" class="input-field w-full" placeholder="10">
          </div>
          <div>
            <label class="block text-sm text-muted mb-1">Expected Start</label>
            <input type="date" id="opp-start" class="input-field w-full">
          </div>
        </div>
        <label class="block text-sm text-muted mb-1 mt-3">Notes</label>
        <textarea id="opp-notes" class="input-field w-full" rows="3"></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Create Opportunity</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    EngageApi.listClients().then((result) => {
      const select = overlay.querySelector("#opp-client");
      const clients = result.clients || [];
      select.innerHTML = '<option value="">Select a client</option>' +
        clients.map((c) => `<option value="${c.id}">${esc(c.display_name || c.name)}</option>`).join("");
    }).catch(() => {
      overlay.querySelector("#opp-client").innerHTML = '<option value="">Failed to load clients</option>';
    });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const clientId = overlay.querySelector("#opp-client").value;
      const title = overlay.querySelector("#opp-title").value.trim();
      if (!clientId) { await EngageModal.alert({ title: "Validation Error", message: "Select a client." }); return; }
      if (!title) { await EngageModal.alert({ title: "Validation Error", message: "Opportunity title is required." }); return; }
      const probRaw = overlay.querySelector("#opp-probability").value;
      const valueRaw = overlay.querySelector("#opp-value").value;
      const daysRaw = overlay.querySelector("#opp-days").value;
      if (probRaw !== "" && isNaN(Number(probRaw))) {
        await EngageModal.alert({ title: "Validation Error", message: "Probability must be a number." }); return;
      }
      if (valueRaw !== "" && isNaN(Number(valueRaw))) {
        await EngageModal.alert({ title: "Validation Error", message: "Estimated value must be a number." }); return;
      }
      if (daysRaw !== "" && isNaN(Number(daysRaw))) {
        await EngageModal.alert({ title: "Validation Error", message: "Estimated days must be a number." }); return;
      }
      if (probRaw !== "" && (Number(probRaw) < 0 || Number(probRaw) > 100)) {
        await EngageModal.alert({ title: "Validation Error", message: "Probability must be between 0 and 100." }); return;
      }
      if (valueRaw !== "" && Number(valueRaw) < 0) {
        await EngageModal.alert({ title: "Validation Error", message: "Estimated value cannot be negative." }); return;
      }
      if (daysRaw !== "" && Number(daysRaw) < 0) {
        await EngageModal.alert({ title: "Validation Error", message: "Estimated days cannot be negative." }); return;
      }
      try {
        await EngageApi.createOpportunity({
          clientId,
          title,
          opportunityType: [...overlay.querySelectorAll("input[name='opp-types']:checked")].map((cb) => cb.value),
          estimatedValue: valueRaw !== "" ? Number(valueRaw) : null,
          probabilityPercent: probRaw !== "" ? Number(probRaw) : null,
          estimatedDays: daysRaw !== "" ? Number(daysRaw) : null,
          expectedStartDate: overlay.querySelector("#opp-start").value || null,
          notes: overlay.querySelector("#opp-notes").value.trim(),
        });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to create opportunity: " + err.message });
      }
    });
  }

  async function openOpp(oppId) {
    const section = document.querySelector('[data-engage-section="pipeline"]');
    if (!section) return;
    section.innerHTML = '<div class="engage-empty">Loading opportunity...</div>';
    try {
      const data = await EngageApi.getOpportunity(oppId);
      state.selectedOpp = data.opportunity;
      state.view = "detail";
      renderOppDetail(section, data.opportunity);
    } catch (err) {
      section.innerHTML = `<div class="engage-empty">Failed to load opportunity: ${esc(err.message)}</div>`;
    }
  }

  function renderOppDetail(section, opp) {
    let html = '<div class="engage-opp-detail">';
    html += '<div class="engage-opp-detail-header">';
    html += '<button type="button" class="btn-secondary text-sm opp-back-btn">Back to Pipeline</button>';
    html += `<h2 class="engage-opp-detail-title">${esc(opp.title)}</h2>`;
    html += `<div class="engage-opp-detail-meta">${esc(opp.client_display_name || opp.client_name || "")} &middot; ${renderTypeTags(opp.opportunity_type)} &middot; ${stagePill(opp.stage)}</div>`;

    html += '<div class="engage-opp-detail-actions">';
    if (ACTIVE_STAGES.includes(opp.stage)) {
      const currentIdx = ACTIVE_STAGES.indexOf(opp.stage);
      if (currentIdx < ACTIVE_STAGES.length - 1) {
        html += `<button type="button" class="btn-primary text-sm opp-advance-btn" data-next-stage="${ACTIVE_STAGES[currentIdx + 1]}">Advance to ${esc(OPP_STAGE_LABELS[ACTIVE_STAGES[currentIdx + 1]])}</button>`;
      }
      if (currentIdx > 0) {
        html += `<button type="button" class="btn-secondary text-sm opp-advance-btn" data-next-stage="${ACTIVE_STAGES[currentIdx - 1]}">Back to ${esc(OPP_STAGE_LABELS[ACTIVE_STAGES[currentIdx - 1]])}</button>`;
      }
    }
    html += '<button type="button" class="btn-secondary text-sm opp-link-proposal-btn">Link Proposal</button>';
    html += '<button type="button" class="btn-secondary text-sm opp-create-proposal-btn">Create Proposal</button>';
    html += '<button type="button" class="btn-secondary text-sm opp-note-btn">Add Note</button>';

    if (opp.stage !== "won" && opp.stage !== "lost" && opp.stage !== "rejected") {
      html += '<div class="engage-opp-outcome-group">';
      html += '<button type="button" class="btn-primary text-sm opp-outcome-btn" data-outcome="won">Mark Won</button>';
      html += '<button type="button" class="btn-danger text-sm opp-outcome-btn" data-outcome="lost">Mark Lost</button>';
      html += '<button type="button" class="btn-danger text-sm opp-outcome-btn" data-outcome="rejected">Reject</button>';
      html += '</div>';
    }

    if (opp.stage === "won") {
      html += '<button type="button" class="btn-primary text-sm opp-convert-btn">Convert to Engagement</button>';
    }

    html += '</div></div>';

    // Detail fields
    html += '<div class="engage-panel">';
    html += '<div class="engage-grid-2">';
    if (opp.estimated_value != null) {
      html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Estimated Value</span><div class="text-lg font-bold">${formatCurrency(opp.estimated_value)}</div></div>`;
    }
    if (opp.quoted_value != null) {
      html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Quoted Value</span><div class="text-lg font-bold">${formatCurrency(opp.quoted_value)}</div></div>`;
    }
    html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Probability</span><div>${opp.probability_percent != null ? opp.probability_percent + "%" : "---"}</div></div>`;
    html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Estimated Days</span><div>${opp.estimated_days != null ? opp.estimated_days : "---"}</div></div>`;
    html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Expected Start</span><div>${opp.expected_start_date || "---"}</div></div>`;
    html += `<div><span class="text-xs font-semibold uppercase tracking-wide text-muted">Decision Date</span><div>${opp.expected_decision_date || "---"}</div></div>`;
    html += '</div>';

    if (opp.reporter_proposal_id) {
      html += '<div class="mt-3" id="opp-proposal-card"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Proposal</span> <span class="text-sm text-muted">Loading...</span></div>';
    } else if (opp.proposal_reporter_doc_id) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Proposal Document</span> <span class="engage-link-badge">${esc(opp.proposal_reporter_doc_id)}</span></div>`;
    }
    if (opp.lost_reason) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Lost Reason</span><div>${esc(opp.lost_reason)}</div></div>`;
    }
    if (opp.rejected_reason) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Rejection Reason</span><div>${esc(opp.rejected_reason)}</div></div>`;
    }
    if (opp.notes) {
      html += `<div class="mt-3"><span class="text-xs font-semibold uppercase tracking-wide text-muted">Notes</span><div>${esc(opp.notes)}</div></div>`;
    }
    html += '</div>';
    html += '</div>';

    section.innerHTML = html;

    // Bind events
    section.querySelector(".opp-back-btn").addEventListener("click", () => { state.view = "list"; renderPipeline(); });

    section.querySelectorAll(".opp-advance-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await EngageApi.updateStage(opp.id, btn.dataset.nextStage);
          await openOpp(opp.id);
        } catch (err) {
          await EngageModal.alert({ title: "Error", message: "Failed to update stage: " + err.message });
        }
      });
    });

    section.querySelector(".opp-link-proposal-btn")?.addEventListener("click", async () => {
      openProposalPicker(opp);
    });

    section.querySelector(".opp-create-proposal-btn")?.addEventListener("click", async () => {
      openCreateProposalFromOpp(opp);
    });

    section.querySelector(".opp-note-btn")?.addEventListener("click", () => {
      EngageClients.openNoteModal("opportunity", opp.id);
    });

    section.querySelectorAll(".opp-outcome-btn").forEach((btn) => {
      btn.addEventListener("click", () => openOutcomeModal(opp, btn.dataset.outcome));
    });

    section.querySelector(".opp-convert-btn")?.addEventListener("click", () => openConvertModal(opp));

    // Load linked proposal metadata
    if (opp.reporter_proposal_id) {
      loadProposalCard(opp.reporter_proposal_id);
    }
  }

  async function loadProposalCard(proposalId) {
    const card = document.getElementById("opp-proposal-card");
    if (!card) return;
    try {
      const data = await EngageApi.listReporterProposals();
      const proposals = data.proposals || data || [];
      const p = proposals.find((x) => x.id === proposalId);
      if (!p) { card.innerHTML = '<span class="text-xs font-semibold uppercase tracking-wide text-muted">Proposal</span> <span class="text-sm text-muted">Not found</span>'; return; }
      const typeTags = (p.testTypes || []).map((t) => '<span class="badge badge-gray">' + esc(t) + '</span>').join(" ");
      card.innerHTML = `
        <div class="card mt-2">
          <div class="card-header flex justify-between items-center">
            <strong>${esc(p.title)}</strong>
            <span class="badge badge-${p.status === "draft" ? "gray" : "green"}">${esc(p.status || "draft")}</span>
          </div>
          ${p.clientName ? '<div class="text-sm text-muted">' + esc(p.clientName) + '</div>' : ""}
          ${typeTags ? '<div class="flex flex-wrap gap-1 mt-1">' + typeTags + '</div>' : ""}
          <div class="flex gap-4 mt-2 text-sm">
            ${p.estimatedDays != null ? '<span>Days: ' + esc(String(p.estimatedDays)) + '</span>' : ""}
            ${p.quotedValue != null ? '<span>Value: ' + esc(String(p.quotedValue)) + '</span>' : ""}
          </div>
          <a href="/reporter/?view=proposals" class="btn-secondary text-sm mt-2 inline-block" target="_blank">Open in Reporter</a>
        </div>
      `;
    } catch {
      card.innerHTML = '<span class="text-xs font-semibold uppercase tracking-wide text-muted">Proposal</span> <span class="text-sm text-muted">Failed to load</span>';
    }
  }

  function openOutcomeModal(opp, outcome) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const isWon = outcome === "won";
    const isLost = outcome === "lost";
    const label = isWon ? "Won" : isLost ? "Lost" : "Rejected";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Mark as ${label}</h3>
      <div class="confirm-modal-message">
        <p class="text-sm text-muted mb-3">Set opportunity "${esc(opp.title)}" to ${label}.</p>
        ${!isWon ? `<label class="block text-sm text-muted mb-1">Reason</label>
        <textarea id="outcome-reason" class="input-field w-full" rows="3" placeholder="Reason for ${label.toLowerCase()} outcome..."></textarea>` : ""}
        ${isWon ? `<label class="block text-sm text-muted mb-1 mt-3">Quoted Value</label>
        <input type="text" inputmode="numeric" id="outcome-quoted-value" class="input-field w-full" value="${opp.quoted_value || opp.estimated_value || ""}" placeholder="Final quoted value">` : ""}
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Confirm</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      try {
        if (isWon) {
          const qv = overlay.querySelector("#outcome-quoted-value");
          if (qv && qv.value) {
            await EngageApi.updateOpportunity(opp.id, { quotedValue: Number(qv.value) });
          }
        }
        if (!isWon) {
          const reason = overlay.querySelector("#outcome-reason");
          const updateData = {};
          if (isLost) updateData.lostReason = reason ? reason.value.trim() : "";
          else updateData.rejectedReason = reason ? reason.value.trim() : "";
          await EngageApi.updateOpportunity(opp.id, updateData);
        }
        await EngageApi.updateStage(opp.id, outcome);
        overlay.remove();
        await openOpp(opp.id);
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to update outcome: " + err.message });
      }
    });
  }

  function openConvertModal(opp) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Convert to Engagement</h3>
      <div class="confirm-modal-message">
        <p class="text-sm text-muted mb-3">Create an engagement from "${esc(opp.title)}".</p>
        <label class="block text-sm text-muted mb-1">Engagement Title</label>
        <input type="text" id="convert-title" class="input-field w-full" value="${esc(opp.title)}">
        <label class="block text-sm text-muted mb-1 mt-3">Engagement Type</label>
        <select id="convert-type" class="input-field w-full">
          ${OPP_TYPES.map((t) => {
            const oppTypes = parseOppTypes(opp.opportunity_type);
            return `<option value="${t}" ${oppTypes[0] === t ? "selected" : ""}>${esc(OPP_TYPE_LABELS[t] || t)}</option>`;
          }).join("")}
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Priority</label>
        <select id="convert-priority" class="input-field w-full">
          <option value="low">Low</option>
          <option value="normal" selected>Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Scheduled Start</label>
        <input type="date" id="convert-start" class="input-field w-full" value="${opp.expected_start_date || ""}">
        <label class="block text-sm text-muted mb-1 mt-3">Scope Summary</label>
        <textarea id="convert-scope" class="input-field w-full" rows="3" placeholder="High-level scope summary"></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Create Engagement</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const title = overlay.querySelector("#convert-title").value.trim();
      if (!title) { await EngageModal.alert({ title: "Validation Error", message: "Engagement title is required." }); return; }
      try {
        await EngageApi.convertToEngagement(opp.id, {
          title,
          engagementType: overlay.querySelector("#convert-type").value,
          priority: overlay.querySelector("#convert-priority").value,
          scheduledStartDate: overlay.querySelector("#convert-start").value || null,
          highLevelScopeSummary: overlay.querySelector("#convert-scope").value.trim(),
        });
        overlay.remove();
        await EngageModal.alert({ title: "Success", message: "Engagement created successfully." });
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to convert: " + err.message });
      }
    });
  }

  async function refresh() {
    try {
      const result = await EngageApi.listOpportunities();
      state.opportunities = result.opportunities || [];
      state.view = "list";
      state.selectedOpp = null;
      renderPipeline();
    } catch {
      state.opportunities = [];
    }
  }

  async function openProposalPicker(opp) {
    const data = await EngageApi.listReporterProposals();
    const proposals = (data.proposals || []).filter((p) => !p.archivedAt);
    if (!proposals.length) {
      await EngageModal.alert({ title: "No Proposals", message: "No active proposals found. Create one first." });
      return;
    }
    const items = proposals.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} — ${esc(p.clientName || "No client")}</option>`).join("");
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Select Proposal</label>
      <select id="opp-proposal-pick" class="input-field w-full"><option value="">Choose...</option>${items}</select>
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Link Proposal", message: html, confirmLabel: "Link" });
    if (!confirmed) return;
    const selectedId = document.getElementById("opp-proposal-pick")?.value;
    if (!selectedId) { await EngageModal.alert({ title: "Error", message: "Select a proposal." }); return; }
    try {
      await EngageApi.linkProposal(opp.id, { reporterProposalId: selectedId });
      await openOpp(opp.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to link: " + err.message });
    }
  }

  async function openCreateProposalFromOpp(opp) {
    const oppTypes = parseOppTypes(opp.opportunity_type);
    const typeChecks = OPP_TYPES.map((t) => {
      const checked = oppTypes.includes(t) ? "checked" : "";
      return `<label class="engage-type-checkbox"><input type="checkbox" value="${t}" ${checked}> ${esc(OPP_TYPE_LABELS[t] || t)}</label>`;
    }).join("");
    const html = `<div class="space-y-3">
      <label class="block text-sm text-muted mb-1">Proposal Title</label>
      <input type="text" id="opp-create-proposal-title" class="input-field w-full" value="${esc(opp.title + " - Proposal")}">
      <label class="block text-sm text-muted mb-1 mt-3">Test Types</label>
      <div id="opp-create-proposal-types" class="engage-type-checkboxes">${typeChecks}</div>
    </div>`;
    const confirmed = await EngageModal.confirm({ title: "Create Proposal", message: html, confirmLabel: "Create" });
    if (!confirmed) return;
    const title = document.getElementById("opp-create-proposal-title")?.value;
    const types = Array.from(document.getElementById("opp-create-proposal-types")?.querySelectorAll("input:checked") || []).map((cb) => cb.value);
    if (!title?.trim()) { await EngageModal.alert({ title: "Error", message: "Title is required." }); return; }
    try {
      const result = await EngageApi.createProposalFromOpportunity(opp.id, { title: title.trim(), testTypes: types });
      await EngageModal.alert({ title: "Proposal Created", message: `Created "${result.proposal.title}" with ${result.proposal.testTypes?.length || 0} test types.` });
      await openOpp(opp.id);
    } catch (err) {
      await EngageModal.alert({ title: "Error", message: "Failed to create: " + err.message });
    }
  }

  async function init() {
    await refresh();
  }

  return { init, refresh };
})();
