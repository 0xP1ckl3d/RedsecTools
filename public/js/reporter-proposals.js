(function () {
  "use strict";

  var ProposalsModal = (() => {
    let _showAlert, _showConfirm;
    const ready = import("/js/confirm-modal.js").then((m) => {
      _showAlert = m.showAlertModal;
      _showConfirm = m.showConfirmModal;
    });
    async function alert(opts) { await ready; return _showAlert(opts); }
    async function confirm(opts) { await ready; return _showConfirm(opts); }
    return { alert, confirm };
  })();

  const TEST_TYPE_OPTIONS = [
    { value: "external", label: "External" },
    { value: "internal", label: "Internal" },
    { value: "webapp", label: "Web Application" },
    { value: "cloud", label: "Cloud" },
    { value: "build_review", label: "Build Review" },
    { value: "wireless", label: "Wireless" },
    { value: "configuration_review", label: "Configuration Review" },
    { value: "assumed_breach", label: "Assumed Breach" },
    { value: "red_team", label: "Red Team" },
    { value: "custom", label: "Custom" },
  ];

  const STATUS_LABELS = {
    draft: "Draft",
    in_review: "In Review",
    changes_required: "Changes Required",
    approved: "Approved",
    sent: "Sent",
    accepted: "Accepted",
    rejected: "Rejected",
    archived: "Archived",
  };

  const STATUS_BADGES = {
    draft: "badge-gray",
    in_review: "badge-yellow",
    changes_required: "badge-orange",
    approved: "badge-green",
    sent: "badge-blue",
    accepted: "badge-green",
    rejected: "badge-red",
    archived: "badge-gray",
  };

  let state = {
    proposals: [],
    currentProposal: null,
    sections: [],
    generations: [],
    users: [],
    activeSectionId: null,
    searchQuery: "",
    filter: "active",
    capabilities: {},
    initialised: false,
  };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatDateTime(ts) {
    if (!ts) return "-";
    const d = new Date(ts * 1000);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString();
  }

  function dateInputValue(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    return res.json();
  }

  async function renderMarkdownPreview(markdown, targetEl) {
    if (!targetEl) return;
    if (!markdown.trim()) {
      targetEl.innerHTML = '<span class="text-muted text-sm">No content</span>';
      return;
    }
    try {
      const res = await fetch("/api/reporter/markdown-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const data = await res.json();
      targetEl.innerHTML = data.html || "";
    } catch {
      targetEl.innerHTML = '<span class="text-muted text-sm">Preview unavailable</span>';
    }
  }

  function showEl(id) {
    document.getElementById(id)?.classList.remove("hidden");
  }

  function hideEl(id) {
    document.getElementById(id)?.classList.add("hidden");
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setProposalPreviewVisible(visible) {
    const builder = document.querySelector(".reporter-proposal-builder");
    const preview = document.getElementById("reporter-proposal-builder-preview");
    const iframe = document.getElementById("reporter-proposal-preview-iframe");
    if (builder) builder.classList.toggle("proposal-preview-open", !!visible);
    if (preview) preview.classList.toggle("hidden", !visible);
    if (!visible && iframe) iframe.removeAttribute("src");
  }

  function typeCheckboxesHtml(selectedTypes) {
    return TEST_TYPE_OPTIONS.map((t) => {
      const checked = (selectedTypes || []).includes(t.value) ? "checked" : "";
      return `<label class="reporter-type-checkbox ${checked ? "checked" : ""}">
        <input type="checkbox" value="${t.value}" ${checked}>
        ${t.label}
      </label>`;
    }).join("");
  }

  function bindTypeCheckboxToggle(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener("change", (e) => {
      if (e.target.type === "checkbox") {
        e.target.parentElement.classList.toggle("checked", e.target.checked);
      }
    });
  }

  function getSelectedTypes(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
  }

  // --- API calls ---

  async function fetchProposals() {
    const data = await api("/api/reporter/proposals");
    state.proposals = data.proposals || [];
    state.capabilities = data.capabilities || {};
    return state.proposals;
  }

  async function fetchProposalDetail(id) {
    const data = await api("/api/reporter/proposals/" + id);
    state.currentProposal = data.proposal;
    state.sections = data.sections || [];
    state.generations = data.generations || [];
    state.capabilities = data.capabilities || {};
    state.engageOpportunity = data.engageOpportunity || null;
    return data;
  }

  async function fetchTemplates() {
    return api("/api/reporter/proposals/templates");
  }

  async function fetchTestTypes() {
    return api("/api/reporter/proposals/test-types");
  }

  async function fetchUsers() {
    if (state.users.length) return state.users;
    const data = await api("/api/reporter/users");
    state.users = data.users || [];
    return state.users;
  }

  // --- List view ---

  function renderProposalsList() {
    const list = document.getElementById("reporter-proposals-list");
    if (!list) return;

    let proposals = state.proposals;

    if (state.filter === "active") {
      proposals = proposals.filter((p) => !p.archivedAt);
    } else if (state.filter === "archived") {
      proposals = proposals.filter((p) => p.archivedAt);
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      proposals = proposals.filter(
        (p) =>
          (p.title || "").toLowerCase().includes(q) ||
          (p.clientName || "").toLowerCase().includes(q)
      );
    }

    if (!proposals.length) {
      list.innerHTML = '<p class="text-sm text-muted">No proposals found.</p>';
      return;
    }

    list.innerHTML = proposals
      .map((p) => {
        const testTypes = Array.isArray(p.testTypes) ? p.testTypes : [];
        return `
      <div class="reporter-list-item" data-proposal-id="${escapeHtml(p.id)}">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(p.title)}</strong>
          <span class="text-sm text-muted ml-2">${escapeHtml(p.clientName || "Not set")}</span>
          ${p.archivedAt ? '<span class="badge badge-gray ml-2">Archived</span>' : ""}
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">${escapeHtml(testTypes.length ? testTypes.join(", ") : "No types")}</span>
          <span class="badge ${STATUS_BADGES[p.status] || "badge-gray"}">${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span>
          ${p.creatorUsername ? `<span class="text-sm text-muted">${escapeHtml(p.creatorUsername)}</span>` : ""}
          <span class="text-sm text-muted">${formatDateTime(p.updatedAt)}</span>
          ${p.quotedValue ? `<span class="text-sm text-muted">${escapeHtml(String(p.quotedValue))}</span>` : ""}
        </div>
      </div>`;
      })
      .join("");

    list.querySelectorAll("[data-proposal-id]").forEach((card) => {
      card.addEventListener("click", () => {
        openProposalDetail(card.dataset.proposalId);
      });
    });
  }

  async function showListView() {
    document.querySelectorAll(".reporter-view").forEach((el) => el.classList.add("hidden"));
    hideEl("reporter-view-proposal-detail");
    setProposalPreviewVisible(false);
    hideEl("reporter-proposal-toggle-preview-btn");

    showEl("reporter-proposals-list");
    showEl("reporter-view-proposals");

    const btn = document.getElementById("reporter-new-proposal-btn");
    if (btn && state.capabilities.canCreate) btn.classList.remove("hidden");

    await fetchProposals();
    renderProposalsList();

    if (btn && state.capabilities.canCreate) btn.classList.remove("hidden");
  }

  // --- Detail view ---

  async function openProposalDetail(id) {
    await fetchProposalDetail(id);

    // Switch to proposal-detail view
    document.querySelectorAll(".reporter-view").forEach((el) => el.classList.add("hidden"));
    showEl("reporter-view-proposal-detail");

    document.querySelectorAll("[data-reporter-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.reporterView === "proposals");
    });

    renderProposalHeader();
    renderProposalSections();
    renderProposalOverview();
    showPanel("overview");
    showEl("reporter-proposal-toggle-preview-btn");
    setProposalPreviewVisible(false);
  }

  function renderProposalHeader() {
    const p = state.currentProposal;
    if (!p) return;

    setText("reporter-proposal-title", p.title);
    setText("reporter-proposal-meta", `Client: ${p.clientName || "Not set"} | Created: ${formatDateTime(p.createdAt)} | Types: ${(p.testTypes || []).join(", ")}`);

    const badge = document.getElementById("reporter-proposal-status-badge");
    if (badge) {
      badge.textContent = STATUS_LABELS[p.status] || p.status;
      badge.className = "badge " + (STATUS_BADGES[p.status] || "badge-gray");
    }

    const actions = document.getElementById("reporter-proposal-actions");
    if (!actions) return;

    let html = "";
    if (state.capabilities.canCreate && !p.archivedAt) {
      html += `<select id="reporter-proposal-status-select" class="input-field text-sm">
        ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}
      </select>`;
      html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-preview-btn">Preview</button>`;
    }
    if (p.archivedAt) {
      html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-unarchive-btn">Unarchive</button>`;
    } else if (state.capabilities.canCreate) {
      html += `<button type="button" class="btn-danger text-sm" id="reporter-proposal-archive-btn">Archive</button>`;
    }
    actions.innerHTML = html;

    document.getElementById("reporter-proposal-status-select")?.addEventListener("change", async (e) => {
      await api("/api/reporter/proposals/" + p.id + "/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: e.target.value }),
      });
      await fetchProposalDetail(p.id);
      renderProposalHeader();
    });

    document.getElementById("reporter-proposal-archive-btn")?.addEventListener("click", async () => {
      await api("/api/reporter/proposals/" + p.id + "/archive", { method: "POST" });
      await fetchProposalDetail(p.id);
      renderProposalHeader();
    });

    document.getElementById("reporter-proposal-unarchive-btn")?.addEventListener("click", async () => {
      await api("/api/reporter/proposals/" + p.id + "/unarchive", { method: "POST" });
      await fetchProposalDetail(p.id);
      renderProposalHeader();
    });

    document.getElementById("reporter-proposal-preview-btn")?.addEventListener("click", () => {
      const preview = document.getElementById("reporter-proposal-builder-preview");
      const showPreview = !preview || preview.classList.contains("hidden");
      setProposalPreviewVisible(showPreview);
      const iframe = document.getElementById("reporter-proposal-preview-iframe");
      if (iframe && showPreview) {
        iframe.src = "/api/reporter/proposals/" + p.id + "/preview.pdf?t=" + Date.now();
      }
    });
  }

  function renderProposalSections() {
    const tree = document.getElementById("reporter-proposal-tree-sections");
    if (!tree) return;

    tree.innerHTML = state.sections
      .map(
        (s) => `
      <button type="button" class="reporter-tree-item ${s.id === state.activeSectionId ? "active" : ""}" data-section-id="${escapeHtml(s.id)}">
        <span class="reporter-tree-item-label">${escapeHtml(s.title)}</span>
        ${!s.isIncluded ? '<span class="text-muted text-xs">(excl.)</span>' : ""}
      </button>`
      )
      .join("");

    tree.querySelectorAll("[data-section-id]").forEach((btn) => {
      btn.addEventListener("click", () => openSectionEditor(btn.dataset.sectionId));
    });
  }

  function renderProposalOverview() {
    const content = document.getElementById("reporter-proposal-overview-content");
    if (!content || !state.currentProposal) return;

    const p = state.currentProposal;
    content.innerHTML = `
      <div class="reporter-stat-grid reporter-stat-grid-4">
        <div class="stat-card">
          <div class="stat-value">${state.sections.length}</div>
          <div class="stat-label">Sections</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${p.testTypes.length}</div>
          <div class="stat-label">Test Types</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${p.estimatedDays || "-"}</div>
          <div class="stat-label">Estimated Days</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${state.generations.length}</div>
          <div class="stat-label">PDF Generations</div>
        </div>
      </div>
      ${state.engageOpportunity ? `<div class="card mt-3"><div class="card-header"><h3 class="font-semibold">Engage Opportunity</h3></div><div class="p-3"><a href="/engage/" class="text-accent" target="_blank">${escapeHtml(state.engageOpportunity.title)}</a> — ${escapeHtml(state.engageOpportunity.stage)} — ${escapeHtml(state.engageOpportunity.clientName || "")}</div></div>` : ""}`;
  }

  // --- Section editor ---

  function openSectionEditor(sectionId) {
    const section = state.sections.find((s) => s.id === sectionId);
    if (!section) return;

    state.activeSectionId = sectionId;
    renderProposalSections();

    const titleInput = document.getElementById("reporter-proposal-section-title");
    const contentInput = document.getElementById("reporter-proposal-section-content");
    const includedCb = document.getElementById("reporter-proposal-section-included");
    if (titleInput) titleInput.value = section.title;
    if (contentInput) contentInput.value = section.content;
    if (includedCb) includedCb.checked = section.isIncluded;

    showPanel("section");
    renderMarkdownPreview(section.content, document.getElementById("reporter-proposal-section-preview"));
  }

  async function saveSection() {
    if (!state.activeSectionId) return;
    const title = document.getElementById("reporter-proposal-section-title")?.value || "";
    const content = document.getElementById("reporter-proposal-section-content")?.value || "";
    const isIncluded = document.getElementById("reporter-proposal-section-included")?.checked ?? true;

    await api("/api/reporter/proposals/sections/" + state.activeSectionId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, isIncluded }),
    });

    state.sections = (await api("/api/reporter/proposals/" + state.currentProposal.id + "/sections")).sections || [];
    renderProposalSections();
  }

  async function deleteSection() {
    if (!state.activeSectionId) return;
    await api("/api/reporter/proposals/sections/" + state.activeSectionId, { method: "DELETE" });
    state.activeSectionId = null;
    state.sections = (await api("/api/reporter/proposals/" + state.currentProposal.id + "/sections")).sections || [];
    renderProposalSections();
    showPanel("overview");
    renderProposalOverview();
  }

  async function addSection() {
    if (!state.currentProposal) return;
    await api("/api/reporter/proposals/" + state.currentProposal.id + "/sections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Section", sectionType: "markdown", content: "" }),
    });
    state.sections = (await api("/api/reporter/proposals/" + state.currentProposal.id + "/sections")).sections || [];
    renderProposalSections();
    const last = state.sections[state.sections.length - 1];
    if (last) openSectionEditor(last.id);
  }

  // --- Metadata editor ---

  async function openMetadataEditor() {
    const p = state.currentProposal;
    if (!p) return;

    const titleEl = document.getElementById("reporter-proposal-edit-title");
    const clientEl = document.getElementById("reporter-proposal-edit-client");
    const preparedForNameEl = document.getElementById("reporter-proposal-edit-prepared-for-name");
    const preparedForEmailEl = document.getElementById("reporter-proposal-edit-prepared-for-email");
    const contactNameEl = document.getElementById("reporter-proposal-edit-contact-name");
    const contactEmailEl = document.getElementById("reporter-proposal-edit-contact-email");
    const preparedByEl = document.getElementById("reporter-proposal-edit-prepared-by");
    const proposalTypeEl = document.getElementById("reporter-proposal-edit-type");
    const daysEl = document.getElementById("reporter-proposal-edit-days");
    const valueEl = document.getElementById("reporter-proposal-edit-value");
    const validUntilEl = document.getElementById("reporter-proposal-edit-valid-until");

    if (titleEl) titleEl.value = p.title;
    if (clientEl) clientEl.value = p.clientName;
    if (preparedForNameEl) preparedForNameEl.value = p.preparedForName || "";
    if (preparedForEmailEl) preparedForEmailEl.value = p.preparedForEmail || "";
    if (contactNameEl) contactNameEl.value = p.primaryContactName;
    if (contactEmailEl) contactEmailEl.value = p.primaryContactEmail;
    if (proposalTypeEl) proposalTypeEl.value = p.proposalType || "security_assessment";
    if (daysEl) daysEl.value = p.estimatedDays || "";
    if (valueEl) valueEl.value = p.quotedValue || "";
    if (validUntilEl) validUntilEl.value = dateInputValue(p.validUntil);

    if (preparedByEl) {
      try {
        const users = await fetchUsers();
        preparedByEl.innerHTML = '<option value="">Not set</option>' + users
          .map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === p.preparedByUserId ? "selected" : ""}>${escapeHtml(user.username || user.email || user.id)}</option>`)
          .join("");
      } catch {
        preparedByEl.innerHTML = `<option value="${escapeHtml(p.preparedByUserId || "")}">${escapeHtml(p.preparedByUsername || "Current preparer")}</option>`;
      }
    }

    const typesEl = document.getElementById("reporter-proposal-edit-types");
    if (typesEl) typesEl.innerHTML = typeCheckboxesHtml(p.testTypes);

    showPanel("metadata");
  }

  async function saveMetadata() {
    const p = state.currentProposal;
    if (!p) return;

    const title = document.getElementById("reporter-proposal-edit-title")?.value;
    const clientName = document.getElementById("reporter-proposal-edit-client")?.value;
    const preparedForName = document.getElementById("reporter-proposal-edit-prepared-for-name")?.value;
    const preparedForEmail = document.getElementById("reporter-proposal-edit-prepared-for-email")?.value;
    const primaryContactName = document.getElementById("reporter-proposal-edit-contact-name")?.value;
    const primaryContactEmail = document.getElementById("reporter-proposal-edit-contact-email")?.value;
    const preparedByUserId = document.getElementById("reporter-proposal-edit-prepared-by")?.value;
    const proposalType = document.getElementById("reporter-proposal-edit-type")?.value;
    const estimatedDays = document.getElementById("reporter-proposal-edit-days")?.value;
    const quotedValue = document.getElementById("reporter-proposal-edit-value")?.value;
    const validUntil = document.getElementById("reporter-proposal-edit-valid-until")?.value;
    const testTypes = getSelectedTypes("reporter-proposal-edit-types");

    await api("/api/reporter/proposals/" + p.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        clientName,
        preparedForName,
        preparedForEmail,
        primaryContactName,
        primaryContactEmail,
        preparedByUserId,
        proposalType,
        estimatedDays: estimatedDays ? parseFloat(estimatedDays) : null,
        quotedValue: quotedValue ? parseFloat(quotedValue) : null,
        validUntil: validUntil ? Math.floor(new Date(validUntil).getTime() / 1000) : null,
        testTypes,
      }),
    });

    await fetchProposalDetail(p.id);
    renderProposalHeader();
    renderProposalSections();
    renderProposalOverview();
    if (state.activeSectionId) openSectionEditor(state.activeSectionId);
  }

  // --- Generations ---

  function renderGenerations() {
    const list = document.getElementById("reporter-proposal-generations-list");
    if (!list) return;

    if (!state.generations.length) {
      list.innerHTML = '<p class="text-sm text-muted">No PDF generations yet.</p>';
      return;
    }

    list.innerHTML = state.generations
      .map(
        (g) => `
      <div class="reporter-pdf-item">
        <div class="reporter-pdf-info">
          <span class="text-sm font-semibold">v${g.version}</span>
          <span class="badge ${g.status === "completed" ? "badge-green" : g.status === "failed" ? "badge-red" : "badge-yellow"}">${escapeHtml(g.status)}</span>
          <span class="text-sm text-muted">${formatDateTime(g.created_at || g.createdAt)}</span>
          ${g.error_message ? '<span class="text-sm text-error">' + escapeHtml(g.error_message) + "</span>" : ""}
        </div>
        <div class="reporter-pdf-actions">
          ${g.status === "completed" ? `<a href="/api/reporter/proposals/generations/${g.id}/download" class="btn-secondary text-sm" target="_blank">Download</a>` : ""}
          <button type="button" class="btn-danger text-sm reporter-delete-gen-btn" data-gen-id="${g.id}">Delete</button>
        </div>
      </div>`
      )
      .join("");

    list.querySelectorAll(".reporter-delete-gen-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api("/api/reporter/proposals/generations/" + btn.dataset.genId, { method: "DELETE" });
        await fetchProposalDetail(state.currentProposal.id);
        renderGenerations();
      });
    });
  }

  async function generatePdf() {
    if (!state.currentProposal) return;
    await api("/api/reporter/proposals/" + state.currentProposal.id + "/render-pdf", { method: "POST" });
    setTimeout(async () => {
      await fetchProposalDetail(state.currentProposal.id);
      renderGenerations();
    }, 2000);
  }

  // --- Panel switching ---

  function showPanel(panel) {
    hideEl("reporter-proposal-editor-overview");
    hideEl("reporter-proposal-editor-section");
    hideEl("reporter-proposal-editor-metadata");
    hideEl("reporter-proposal-editor-generations");

    if (panel === "overview") showEl("reporter-proposal-editor-overview");
    if (panel === "section") showEl("reporter-proposal-editor-section");
    if (panel === "metadata") showEl("reporter-proposal-editor-metadata");
    if (panel === "generations") {
      showEl("reporter-proposal-editor-generations");
      renderGenerations();
    }
  }

  // --- Create proposal modal ---

  async function openCreateProposalModal() {
    let templates = [];
    let testTypes = [];
    try {
      const [tData, ttData] = await Promise.all([fetchTemplates(), fetchTestTypes()]);
      templates = tData.templates || [];
      testTypes = ttData.testTypes || [];
    } catch {}

    // Build the modal content using the reporter modal
    const templateOptions = templates
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
      .join("");

    const typeChecks = testTypes
      .map((t) => `<label class="reporter-type-checkbox"><input type="checkbox" value="${escapeHtml(t.test_type)}"> ${escapeHtml(t.name)}</label>`)
      .join("");

    const bodyHtml = `
      <div class="space-y-3">
        <div><label class="block text-sm text-muted mb-1">Proposal Title</label>
          <input type="text" id="modal-proposal-title" class="input-field w-full" placeholder="e.g. Security Assessment Proposal"></div>
        <div><label class="block text-sm text-muted mb-1">Client Name</label>
          <input type="text" id="modal-proposal-client" class="input-field w-full" placeholder="Client name"></div>
        <div><label class="block text-sm text-muted mb-1">Template</label>
          <select id="modal-proposal-template" class="input-field w-full">${templateOptions}</select></div>
        <div><label class="block text-sm text-muted mb-1">Test Types</label>
          <div id="modal-proposal-types" class="reporter-type-checkboxes">${typeChecks}</div></div>
      </div>`;

    window.ReporterModal = window.ReporterModal || {};
    window.ReporterModal.open = function (title, body, onConfirm, label) {
      document.getElementById("reporter-modal-card")?.classList.remove("reporter-modal-wide");
      setText("reporter-modal-title", title);
      document.getElementById("reporter-modal-body").innerHTML = body;
      const confirmBtn = document.getElementById("reporter-modal-confirm");
      confirmBtn.textContent = label || "Save";
      confirmBtn.onclick = onConfirm;
      document.getElementById("reporter-modal").classList.remove("hidden");
    };

    window.ReporterModal.open("Create Proposal", bodyHtml, async () => {
      const title = document.getElementById("modal-proposal-title")?.value;
      const clientName = document.getElementById("modal-proposal-client")?.value;
      const templateId = document.getElementById("modal-proposal-template")?.value;
      const types = Array.from(
        document.getElementById("modal-proposal-types")?.querySelectorAll("input:checked") || []
      ).map((cb) => cb.value);

      if (!title || !title.trim()) {
        ProposalsModal.alert({ title: "Validation Error", message: "Title is required." });
        return;
      }

      try {
        const data = await api("/api/reporter/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            clientName: clientName || "",
            templateId: templateId || undefined,
            testTypes: types,
          }),
        });

        document.getElementById("reporter-modal").classList.add("hidden");
        if (data.proposal) openProposalDetail(data.proposal.id);
      } catch (err) {
        ProposalsModal.alert({ title: "Error", message: err.message });
      }
    }, "Create");

    bindTypeCheckboxToggle("modal-proposal-types");

    bindTypeCheckboxToggle("modal-proposal-types");
  }

  // --- Event binding ---

  function bindEvents() {
    document.getElementById("reporter-proposals-search")?.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderProposalsList();
    });

    document.getElementById("reporter-proposals-filter")?.addEventListener("change", (e) => {
      state.filter = e.target.value;
      renderProposalsList();
    });

    document.getElementById("reporter-new-proposal-btn")?.addEventListener("click", () => openCreateProposalModal());

    document.getElementById("reporter-proposal-back-btn")?.addEventListener("click", () => {
      state.currentProposal = null;
      state.activeSectionId = null;
      showListView();
    });

    document.getElementById("reporter-proposal-add-section-btn")?.addEventListener("click", () => addSection());

    document.getElementById("reporter-proposal-save-section-btn")?.addEventListener("click", () => saveSection());

    document.getElementById("reporter-proposal-delete-section-btn")?.addEventListener("click", async () => {
      const confirmed = await ProposalsModal.confirm({
        title: "Delete Section",
        message: "Are you sure you want to delete this section?",
        confirmLabel: "Delete",
        danger: true,
      });
      if (confirmed) deleteSection();
    });

    document.getElementById("reporter-proposal-section-content")?.addEventListener("input", (e) => {
      renderMarkdownPreview(e.target.value, document.getElementById("reporter-proposal-section-preview"));
    });

    document.querySelectorAll("[data-proposal-meta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const meta = btn.dataset.proposalMeta;
        if (meta === "metadata") openMetadataEditor();
        if (meta === "generations") showPanel("generations");
      });
    });

    document.getElementById("reporter-proposal-save-metadata-btn")?.addEventListener("click", () => saveMetadata());

    document.getElementById("reporter-proposal-generate-pdf-btn")?.addEventListener("click", () => generatePdf());

    document.getElementById("reporter-proposal-refresh-gens-btn")?.addEventListener("click", async () => {
      if (state.currentProposal) {
        await fetchProposalDetail(state.currentProposal.id);
        renderGenerations();
      }
    });

    document.getElementById("reporter-proposal-close-preview-btn")?.addEventListener("click", () => {
      setProposalPreviewVisible(false);
    });

    bindTypeCheckboxToggle("reporter-proposal-edit-types");
  }

  // --- Public API ---

  window.ReporterProposals = {
    init: function (capabilities) {
      if (state.initialised) return;
      state.initialised = true;
      state.capabilities = capabilities || {};
      bindEvents();
    },
    showListView: showListView,
    showDetailView: openProposalDetail,
    openProposal: openProposalDetail,
  };
})();
