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
    supportingImages: [],
    notes: [],
    comments: [],
    history: [],
    users: [],
    activeSectionId: null,
    searchQuery: "",
    treeSearch: "",
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || "Request failed");
    }
    return data;
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
        body: JSON.stringify({
          markdown,
          proposalId: state.currentProposal?.id || "",
          sectionId: state.activeSectionId || "preview",
          sectionTitle: document.getElementById("reporter-proposal-section-title")?.value || "Preview",
        }),
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

  function testTypeLabel(value) {
    const found = TEST_TYPE_OPTIONS.find((t) => t.value === value);
    return found ? found.label : String(value || "Test Type");
  }

  function metadataValue(metadata, snakeName, camelName) {
    if (!metadata) return "";
    return metadata[snakeName] ?? metadata[camelName] ?? "";
  }

  function dateInputFromValue(value) {
    if (!value) return "";
    if (typeof value === "number") return dateInputValue(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }

  function numericInputValue(value) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return Number.isInteger(number) ? String(number) : String(number).replace(/\.?0+$/, "");
  }

  function readNumber(id) {
    const raw = document.getElementById(id)?.value;
    if (raw === undefined || raw === null || raw === "") return 0;
    const number = Number(raw);
    return Number.isFinite(number) ? number : 0;
  }

  function renderProposalTypeAllocation(selectedTypes, existingAllocations) {
    const target = document.getElementById("reporter-proposal-type-allocation");
    if (!target) return;
    const allocations = existingAllocations || {};
    if (!selectedTypes.length) {
      target.innerHTML = '<p class="text-sm text-muted">Select proposal test types to allocate delivery days.</p>';
      return;
    }
    target.innerHTML = selectedTypes.map((type) => `
      <div>
        <label class="block text-sm text-muted mb-1">${escapeHtml(testTypeLabel(type))} Days</label>
        <input type="text" inputmode="numeric" class="input-field w-full reporter-proposal-type-days" data-proposal-type-days="${escapeHtml(type)}" value="${escapeHtml(numericInputValue(allocations[type]))}">
      </div>
    `).join("");
    target.querySelectorAll(".reporter-proposal-type-days").forEach((input) => {
      input.addEventListener("input", updateProposalQuoteTotals);
    });
  }

  function updateProposalQuoteTotals() {
    let total = 0;
    document.querySelectorAll("[data-proposal-type-days]").forEach((input) => {
      total += Number(input.value || 0) || 0;
    });
    total += readNumber("reporter-proposal-edit-reporting-days");
    total += readNumber("reporter-proposal-edit-retest-days");
    total += readNumber("reporter-proposal-edit-management-days");

    const dailyRate = readNumber("reporter-proposal-edit-day-rate");
    const totalEl = document.getElementById("reporter-proposal-edit-days");
    const valueEl = document.getElementById("reporter-proposal-edit-value");
    if (totalEl) totalEl.value = numericInputValue(total);
    if (valueEl) valueEl.value = dailyRate ? numericInputValue(total * dailyRate) : "";
  }

  function collectProposalTypeAllocations() {
    const allocations = {};
    document.querySelectorAll("[data-proposal-type-days]").forEach((input) => {
      const type = input.dataset.proposalTypeDays;
      const number = Number(input.value || 0);
      if (type && Number.isFinite(number) && number > 0) allocations[type] = number;
    });
    return allocations;
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    renderMarkdownPreview(textarea.value, document.getElementById("reporter-proposal-section-preview"));
  }

  function proposalImageUrl(imageId) {
    return `/api/reporter/proposals/supporting-images/${encodeURIComponent(imageId)}/download`;
  }

  function markdownImageAlt(text) {
    return String(text || "Supporting image").replace(/[\r\n[\]()]/g, " ").replace(/\s+/g, " ").trim() || "Supporting image";
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

    const canEdit = !!state.capabilities.canCreate;
    let html = `<div class="reporter-project-actionbar">`;
    html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-preview-btn">Preview</button>`;
    if (canEdit && !p.archivedAt) {
      html += `<button type="button" class="btn-primary text-sm" id="reporter-proposal-header-generate-pdf-btn">Generate PDF</button>`;
    }
    html += `<details class="reporter-action-menu"><summary class="btn-secondary text-sm">Actions</summary><div class="reporter-action-menu-panel">`;
    if (canEdit && !p.archivedAt) {
      html += `<select id="reporter-proposal-status-select" class="input-field text-sm">
        ${Object.entries(STATUS_LABELS).filter(([k]) => k !== "archived").map(([k, v]) => `<option value="${k}" ${k === p.status ? "selected" : ""}>${v}</option>`).join("")}
      </select>`;
    }
    html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-side-preview-btn">Open Preview</button>`;
    if (p.archivedAt && canEdit) {
      html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-unarchive-btn">Unarchive</button>`;
    } else if (canEdit) {
      html += `<button type="button" class="btn-secondary text-sm" id="reporter-proposal-archive-btn">Archive</button>`;
    }
    html += `</div></details></div>`;
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
      window.open("/api/reporter/proposals/" + p.id + "/preview.pdf", "_blank", "noopener");
    });

    document.getElementById("reporter-proposal-side-preview-btn")?.addEventListener("click", () => {
      const preview = document.getElementById("reporter-proposal-builder-preview");
      const showPreview = !preview || preview.classList.contains("hidden");
      setProposalPreviewVisible(showPreview);
      const iframe = document.getElementById("reporter-proposal-preview-iframe");
      if (iframe && showPreview) {
        iframe.src = "/api/reporter/proposals/" + p.id + "/preview.pdf?t=" + Date.now();
      }
    });

    document.getElementById("reporter-proposal-header-generate-pdf-btn")?.addEventListener("click", async () => {
      await generatePdf();
      showPanel("generations");
    });
  }

  function renderProposalSections() {
    const tree = document.getElementById("reporter-proposal-tree-sections");
    if (!tree) return;

    let sections = state.sections || [];
    if (state.treeSearch) {
      sections = sections.filter((s) => (s.title || "").toLowerCase().includes(state.treeSearch));
    }
    if (!sections.length) {
      tree.innerHTML = `<div class="text-sm text-muted reporter-tree-empty">No sections</div>`;
      return;
    }

    tree.innerHTML = sections
      .map(
        (s) => `
      <button type="button" class="reporter-tree-item ${s.id === state.activeSectionId ? "active" : ""}" data-section-id="${escapeHtml(s.id)}">
        <span class="reporter-tree-badge reporter-tree-badge-section">${escapeHtml((s.sectionType || "sec").slice(0, 3))}</span>
        <span class="reporter-tree-item-title">${escapeHtml(s.title)}</span>
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
    const dayRateEl = document.getElementById("reporter-proposal-edit-day-rate");
    const valueEl = document.getElementById("reporter-proposal-edit-value");
    const validUntilEl = document.getElementById("reporter-proposal-edit-valid-until");
    const metadata = p.proposalMetadata || {};

    if (titleEl) titleEl.value = p.title;
    if (clientEl) clientEl.value = p.clientName;
    if (preparedForNameEl) preparedForNameEl.value = p.preparedForName || "";
    if (preparedForEmailEl) preparedForEmailEl.value = p.preparedForEmail || "";
    if (contactNameEl) contactNameEl.value = p.primaryContactName;
    if (contactEmailEl) contactEmailEl.value = p.primaryContactEmail;
    if (proposalTypeEl) proposalTypeEl.value = p.proposalType || "security_assessment";
    if (daysEl) daysEl.value = numericInputValue(p.estimatedDays);
    if (dayRateEl) dayRateEl.value = numericInputValue(metadataValue(metadata, "daily_rate", "dailyRate"));
    if (valueEl) valueEl.value = numericInputValue(p.quotedValue);
    if (validUntilEl) validUntilEl.value = dateInputValue(p.validUntil);
    const reportingDaysEl = document.getElementById("reporter-proposal-edit-reporting-days");
    const retestDaysEl = document.getElementById("reporter-proposal-edit-retest-days");
    const managementDaysEl = document.getElementById("reporter-proposal-edit-management-days");
    const startDateEl = document.getElementById("reporter-proposal-edit-start-date");
    const endDateEl = document.getElementById("reporter-proposal-edit-end-date");
    const draftDateEl = document.getElementById("reporter-proposal-edit-draft-date");
    const finalDateEl = document.getElementById("reporter-proposal-edit-final-date");
    if (reportingDaysEl) reportingDaysEl.value = numericInputValue(metadataValue(metadata, "reporting_days", "reportingDays"));
    if (retestDaysEl) retestDaysEl.value = numericInputValue(metadataValue(metadata, "retest_days", "retestDays"));
    if (managementDaysEl) managementDaysEl.value = numericInputValue(metadataValue(metadata, "management_days", "managementDays"));
    if (startDateEl) startDateEl.value = dateInputFromValue(metadataValue(metadata, "start_date", "startDate"));
    if (endDateEl) endDateEl.value = dateInputFromValue(metadataValue(metadata, "end_date", "endDate"));
    if (draftDateEl) draftDateEl.value = dateInputFromValue(metadataValue(metadata, "draft_date", "draftDate"));
    if (finalDateEl) finalDateEl.value = dateInputFromValue(metadataValue(metadata, "final_date", "finalDate"));

    if (preparedByEl) {
      try {
        const users = await fetchUsers();
        preparedByEl.innerHTML = '<option value="">Not set</option>' + users
          .map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === p.preparedByUserId ? "selected" : ""}>${escapeHtml(user.fullName || user.username || user.email || user.id)}${user.email ? ` (${escapeHtml(user.email)})` : ""}</option>`)
          .join("");
      } catch {
        preparedByEl.innerHTML = `<option value="${escapeHtml(p.preparedByUserId || "")}">${escapeHtml(p.preparedByUsername || "Current preparer")}</option>`;
      }
    }

    const preparedByNameOverride = document.getElementById("reporter-proposal-edit-prepared-by-name");
    const preparedByEmailOverride = document.getElementById("reporter-proposal-edit-prepared-by-email");
    if (preparedByNameOverride) preparedByNameOverride.value = metadataValue(metadata, "prepared_by_name_override", "preparedByNameOverride");
    if (preparedByEmailOverride) preparedByEmailOverride.value = metadataValue(metadata, "prepared_by_email_override", "preparedByEmailOverride");

    const sameContact = document.getElementById("reporter-proposal-prepared-for-same-contact");
    const syncPreparedFor = () => {
      if (!sameContact?.checked) return;
      const name = document.getElementById("reporter-proposal-edit-contact-name")?.value || "";
      const email = document.getElementById("reporter-proposal-edit-contact-email")?.value || "";
      const preparedName = document.getElementById("reporter-proposal-edit-prepared-for-name");
      const preparedEmail = document.getElementById("reporter-proposal-edit-prepared-for-email");
      if (preparedName) preparedName.value = name;
      if (preparedEmail) preparedEmail.value = email;
    };
    if (sameContact) {
      sameContact.checked = !!metadataValue(metadata, "prepared_for_same_as_primary", "preparedForSameAsPrimary");
      sameContact.onchange = syncPreparedFor;
      document.getElementById("reporter-proposal-edit-contact-name")?.addEventListener("input", syncPreparedFor);
      document.getElementById("reporter-proposal-edit-contact-email")?.addEventListener("input", syncPreparedFor);
      syncPreparedFor();
    }

    const typesEl = document.getElementById("reporter-proposal-edit-types");
    if (typesEl) {
      typesEl.innerHTML = typeCheckboxesHtml(p.testTypes);
      typesEl.onchange = () => {
        const selected = getSelectedTypes("reporter-proposal-edit-types");
        const currentAllocations = collectProposalTypeAllocations();
        renderProposalTypeAllocation(selected, currentAllocations);
        updateProposalQuoteTotals();
      };
    }
    renderProposalTypeAllocation(p.testTypes || [], metadataValue(metadata, "type_allocations", "typeAllocations") || {});
    ["reporter-proposal-edit-day-rate", "reporter-proposal-edit-reporting-days", "reporter-proposal-edit-retest-days", "reporter-proposal-edit-management-days"].forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.oninput = updateProposalQuoteTotals;
    });
    updateProposalQuoteTotals();

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
    const dailyRate = document.getElementById("reporter-proposal-edit-day-rate")?.value;
    const quotedValue = document.getElementById("reporter-proposal-edit-value")?.value;
    const validUntil = document.getElementById("reporter-proposal-edit-valid-until")?.value;
    const testTypes = getSelectedTypes("reporter-proposal-edit-types");
    const proposalMetadata = {
      ...(p.proposalMetadata || {}),
      type_allocations: collectProposalTypeAllocations(),
      reporting_days: readNumber("reporter-proposal-edit-reporting-days"),
      retest_days: readNumber("reporter-proposal-edit-retest-days"),
      management_days: readNumber("reporter-proposal-edit-management-days"),
      daily_rate: dailyRate ? Number(dailyRate) : null,
      prepared_by_name_override: document.getElementById("reporter-proposal-edit-prepared-by-name")?.value.trim() || "",
      prepared_by_email_override: document.getElementById("reporter-proposal-edit-prepared-by-email")?.value.trim() || "",
      prepared_for_same_as_primary: !!document.getElementById("reporter-proposal-prepared-for-same-contact")?.checked,
      start_date: document.getElementById("reporter-proposal-edit-start-date")?.value || "",
      end_date: document.getElementById("reporter-proposal-edit-end-date")?.value || "",
      draft_date: document.getElementById("reporter-proposal-edit-draft-date")?.value || "",
      final_date: document.getElementById("reporter-proposal-edit-final-date")?.value || "",
    };

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
        proposalMetadata,
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

  // --- Supporting images / notes / comments / history ---

  async function loadSupportingImages() {
    if (!state.currentProposal) return;
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/supporting-images`);
    state.supportingImages = data.images || [];
    renderSupportingImages();
  }

  function renderSupportingImages() {
    const list = document.getElementById("reporter-proposal-supporting-images-list");
    if (!list) return;
    if (!state.supportingImages.length) {
      list.innerHTML = '<p class="text-sm text-muted">No supporting images uploaded.</p>';
      return;
    }
    list.innerHTML = state.supportingImages.map((img) => `
      <div class="reporter-list-item">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(img.filename || "Image")}</strong>
          ${img.caption ? `<span class="text-sm text-muted ml-2">${escapeHtml(img.caption)}</span>` : ""}
          <div class="mt-2"><img src="${proposalImageUrl(img.id)}" alt="${escapeHtml(img.caption || img.filename || "")}" style="max-width: 220px; max-height: 140px; border: 1px solid var(--border); border-radius: 4px;"></div>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary text-sm" data-proposal-image-insert="${escapeHtml(img.id)}">Insert</button>
          <button type="button" class="btn-danger text-sm" data-proposal-image-delete="${escapeHtml(img.id)}">Delete</button>
        </div>
      </div>
    `).join("");
    list.querySelectorAll("[data-proposal-image-insert]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const image = state.supportingImages.find((item) => item.id === btn.dataset.proposalImageInsert);
        const textarea = document.getElementById("reporter-proposal-section-content");
        if (!textarea || document.getElementById("reporter-proposal-editor-section")?.classList.contains("hidden")) {
          await ProposalsModal.alert({ title: "Open a Section", message: "Open the section you want to insert this image into first." });
          return;
        }
        const alt = markdownImageAlt(image?.caption || image?.filename);
        insertAtCursor(textarea, `\n\n![${alt}](${proposalImageUrl(btn.dataset.proposalImageInsert)})\n`);
      });
    });
    list.querySelectorAll("[data-proposal-image-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await ProposalsModal.confirm({ title: "Delete Image", message: "Remove this supporting image?", confirmLabel: "Delete", danger: true });
        if (!ok) return;
        await api(`/api/reporter/proposals/supporting-images/${btn.dataset.proposalImageDelete}`, { method: "DELETE" });
        await loadSupportingImages();
      });
    });
  }

  async function uploadSupportingImage() {
    if (!state.currentProposal) return;
    const fileInput = document.getElementById("reporter-proposal-image-file");
    if (!fileInput?.files.length) {
      await ProposalsModal.alert({ title: "Validation Error", message: "Choose an image first." });
      return;
    }
    const form = new FormData();
    form.append("file", fileInput.files[0]);
    form.append("caption", document.getElementById("reporter-proposal-image-caption")?.value.trim() || "");
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/supporting-images`, { method: "POST", body: form });
    if (data.error) {
      await ProposalsModal.alert({ title: "Upload Failed", message: data.error });
      return;
    }
    fileInput.value = "";
    const caption = document.getElementById("reporter-proposal-image-caption");
    if (caption) caption.value = "";
    await loadSupportingImages();
  }

  async function loadProposalNotes() {
    if (!state.currentProposal) return;
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/notes`);
    state.notes = data.notes || [];
    renderProposalNotes();
  }

  function renderProposalNotes() {
    const list = document.getElementById("reporter-proposal-notes-list");
    if (!list) return;
    if (!state.notes.length) {
      list.innerHTML = '<p class="text-sm text-muted">No notes yet.</p>';
      return;
    }
    list.innerHTML = state.notes.map((note) => `
      <div class="reporter-list-item">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(note.title || "Untitled Note")}</strong>
          <span class="text-sm text-muted ml-2">${escapeHtml(note.username || "unknown")} · ${formatDateTime(note.updatedAt || note.createdAt)}</span>
          <p class="text-sm mt-2">${escapeHtml(note.content || "")}</p>
        </div>
      </div>
    `).join("");
  }

  async function addProposalNote() {
    if (!state.currentProposal) return;
    const titleEl = document.getElementById("reporter-proposal-note-title");
    const contentEl = document.getElementById("reporter-proposal-note-content");
    const title = titleEl?.value.trim() || "Untitled Note";
    const content = contentEl?.value || "";
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (data.error) {
      await ProposalsModal.alert({ title: "Error", message: data.error });
      return;
    }
    if (titleEl) titleEl.value = "";
    if (contentEl) contentEl.value = "";
    await loadProposalNotes();
  }

  async function loadProposalComments() {
    if (!state.currentProposal) return;
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/comments`);
    state.comments = data.comments || [];
    renderProposalComments();
  }

  function renderProposalComments() {
    const list = document.getElementById("reporter-proposal-comments-list");
    if (!list) return;
    if (!state.comments.length) {
      list.innerHTML = '<p class="text-sm text-muted">No comments yet.</p>';
      return;
    }
    list.innerHTML = state.comments.map((comment) => `
      <div class="reporter-list-item">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(comment.username || "unknown")}</strong>
          <span class="text-sm text-muted ml-2">${formatDateTime(comment.updatedAt || comment.createdAt)}</span>
          <p class="text-sm mt-2">${escapeHtml(comment.content || "")}</p>
        </div>
      </div>
    `).join("");
  }

  async function addProposalComment() {
    if (!state.currentProposal) return;
    const contentEl = document.getElementById("reporter-proposal-comment-content");
    const content = contentEl?.value.trim() || "";
    if (!content) {
      await ProposalsModal.alert({ title: "Validation Error", message: "Comment is required." });
      return;
    }
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (data.error) {
      await ProposalsModal.alert({ title: "Error", message: data.error });
      return;
    }
    if (contentEl) contentEl.value = "";
    await loadProposalComments();
  }

  async function loadProposalHistory() {
    if (!state.currentProposal) return;
    const data = await api(`/api/reporter/proposals/${state.currentProposal.id}/history`);
    state.history = data.history || [];
    renderProposalHistory();
  }

  function renderProposalHistory() {
    const list = document.getElementById("reporter-proposal-history-list");
    if (!list) return;
    if (!state.history.length) {
      list.innerHTML = '<p class="text-sm text-muted">No history yet.</p>';
      return;
    }
    list.innerHTML = state.history.map((item) => `
      <div class="reporter-list-item">
        <div class="reporter-list-item-main">
          <strong>${escapeHtml(item.changeSummary || item.change_summary || "Change")}</strong>
          <span class="text-sm text-muted ml-2">${escapeHtml(item.username || "system")} · ${formatDateTime(item.createdAt || item.created_at)}</span>
        </div>
      </div>
    `).join("");
  }

  // --- Panel switching ---

  function showPanel(panel) {
    hideEl("reporter-proposal-editor-overview");
    hideEl("reporter-proposal-editor-section");
    hideEl("reporter-proposal-editor-metadata");
    hideEl("reporter-proposal-editor-generations");
    hideEl("reporter-proposal-editor-supporting-images");
    hideEl("reporter-proposal-editor-notes");
    hideEl("reporter-proposal-editor-comments");
    hideEl("reporter-proposal-editor-history");
    document.querySelectorAll("[data-proposal-meta]").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll("#reporter-proposal-tree-sections .reporter-tree-item").forEach((item) => {
      item.classList.toggle("active", panel === "section" && item.dataset.sectionId === state.activeSectionId);
    });

    if (panel === "overview") showEl("reporter-proposal-editor-overview");
    if (panel === "section") showEl("reporter-proposal-editor-section");
    if (panel === "metadata") {
      showEl("reporter-proposal-editor-metadata");
      document.querySelector('[data-proposal-meta="metadata"]')?.classList.add("active");
    }
    if (panel === "generations") {
      showEl("reporter-proposal-editor-generations");
      document.querySelector('[data-proposal-meta="generations"]')?.classList.add("active");
      renderGenerations();
    }
    if (panel === "supporting-images") {
      showEl("reporter-proposal-editor-supporting-images");
      document.querySelector('[data-proposal-meta="supporting-images"]')?.classList.add("active");
      loadSupportingImages().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
    }
    if (panel === "notes") {
      showEl("reporter-proposal-editor-notes");
      document.querySelector('[data-proposal-meta="notes"]')?.classList.add("active");
      loadProposalNotes().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
    }
    if (panel === "comments") {
      showEl("reporter-proposal-editor-comments");
      document.querySelector('[data-proposal-meta="comments"]')?.classList.add("active");
      loadProposalComments().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
    }
    if (panel === "history") {
      showEl("reporter-proposal-editor-history");
      document.querySelector('[data-proposal-meta="history"]')?.classList.add("active");
      loadProposalHistory().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
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
    document.getElementById("reporter-proposal-tree-search")?.addEventListener("input", (e) => {
      state.treeSearch = e.target.value.toLowerCase();
      renderProposalSections();
    });

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
        else showPanel(meta);
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

    document.getElementById("reporter-proposal-upload-image-btn")?.addEventListener("click", () => {
      uploadSupportingImage().catch((err) => ProposalsModal.alert({ title: "Upload Failed", message: err.message }));
    });

    document.getElementById("reporter-proposal-save-note-btn")?.addEventListener("click", () => {
      addProposalNote().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
    });

    document.getElementById("reporter-proposal-save-comment-btn")?.addEventListener("click", () => {
      addProposalComment().catch((err) => ProposalsModal.alert({ title: "Error", message: err.message }));
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
    openCreateProposalModal,
  };
})();
