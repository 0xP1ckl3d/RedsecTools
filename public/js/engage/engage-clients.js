const EngageClients = (() => {
  let state = { clients: [], selectedClient: null, detail: null, view: "list" };

  const CLIENT_STATUSES = ["active", "inactive", "prospect"];
  const INDUSTRIES = ["Technology", "Finance", "Healthcare", "Government", "Education", "Retail", "Energy", "Manufacturing", "Other"];
  const CONTACT_TYPES = ["commercial", "technical", "security", "procurement", "executive", "other"];

  const OPP_TYPE_LABELS = { internal: "Internal", external: "External", webapp: "Web App", cloud: "Cloud", build_review: "Build Review", red_team: "Red Team", wireless: "Wireless", configuration_review: "Config Review", assumed_breach: "Assumed Breach", custom: "Custom" };

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

  const esc = (str) => window.RedSecUI.escapeHtml(str || "");

  function formatDate(ts) {
    if (!ts) return "---";
    return new Date(ts * 1000).toLocaleDateString();
  }

  function statusPill(status) {
    const colors = { active: "active", inactive: "closed", prospect: "draft" };
    const cls = colors[status] || "draft";
    return `<span class="engage-status-pill ${cls}"><span class="pill-dot"></span>${esc(status)}</span>`;
  }

  function renderList() {
    const section = document.querySelector('[data-engage-section="clients"]');
    if (!section) return;
    const clients = state.clients;
    if (!clients || clients.length === 0) {
      section.innerHTML = `<div class="engage-clients-header">
        <div class="engage-section-title">Clients</div>
        <button type="button" class="btn-primary text-sm engage-create-client-btn">New Client</button>
      </div>
      <div class="engage-panel"><div class="engage-empty">No clients yet. Create your first client to get started.</div></div>`;
      bindCreateBtn(section);
      return;
    }
    let html = '<div class="engage-clients-header">';
    html += '<div class="engage-section-title">Clients</div>';
    html += '<button type="button" class="btn-primary text-sm engage-create-client-btn">New Client</button>';
    html += '</div>';
    html += '<div class="engage-client-grid">';
    for (const c of clients) {
      html += `<div class="engage-client-card" data-client-id="${c.id}">
        <div class="engage-client-card-name">${esc(c.display_name || c.name)}</div>
        <div class="engage-client-card-meta">${esc(c.industry || "")} &middot; ${statusPill(c.status)}</div>
        <div class="engage-client-card-meta">${esc(c.website || "")}</div>
      </div>`;
    }
    html += '</div>';
    section.innerHTML = html;
    bindCreateBtn(section);
    section.querySelectorAll(".engage-client-card").forEach((el) => {
      el.addEventListener("click", () => openClient(el.dataset.clientId));
    });
  }

  function bindCreateBtn(container) {
    const btn = container.querySelector(".engage-create-client-btn");
    if (btn) btn.addEventListener("click", openCreateModal);
  }

  function openCreateModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">New Client</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Name *</label>
        <input type="text" id="client-name" class="input-field w-full" placeholder="Organisation name">
        <label class="block text-sm text-muted mb-1 mt-3">Display Name</label>
        <input type="text" id="client-display-name" class="input-field w-full" placeholder="Friendly name">
        <label class="block text-sm text-muted mb-1 mt-3">Industry</label>
        <select id="client-industry" class="input-field w-full">
          <option value="">---</option>
          ${INDUSTRIES.map((i) => `<option value="${i}">${i}</option>`).join("")}
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Website</label>
        <input type="text" id="client-website" class="input-field w-full" placeholder="https://">
        <label class="block text-sm text-muted mb-1 mt-3">Status</label>
        <select id="client-status" class="input-field w-full">
          ${CLIENT_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Notes</label>
        <textarea id="client-notes" class="input-field w-full" rows="3"></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Create Client</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const name = overlay.querySelector("#client-name").value.trim();
      if (!name) { await EngageModal.alert({ title: "Validation Error", message: "Client name is required." }); return; }
      try {
        await EngageApi.createClient({
          name,
          displayName: overlay.querySelector("#client-display-name").value.trim(),
          industry: overlay.querySelector("#client-industry").value,
          website: overlay.querySelector("#client-website").value.trim(),
          status: overlay.querySelector("#client-status").value,
          notes: overlay.querySelector("#client-notes").value.trim(),
        });
        overlay.remove();
        await refresh();
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to create client: " + err.message });
      }
    });
  }

  function openEditModal(client) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Edit Client</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Name *</label>
        <input type="text" id="edit-client-name" class="input-field w-full" value="${esc(client.name)}">
        <label class="block text-sm text-muted mb-1 mt-3">Display Name</label>
        <input type="text" id="edit-client-display" class="input-field w-full" value="${esc(client.display_name || "")}">
        <label class="block text-sm text-muted mb-1 mt-3">Industry</label>
        <select id="edit-client-industry" class="input-field w-full">
          <option value="">---</option>
          ${INDUSTRIES.map((i) => `<option value="${i}" ${client.industry === i ? "selected" : ""}>${i}</option>`).join("")}
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Website</label>
        <input type="text" id="edit-client-website" class="input-field w-full" value="${esc(client.website || "")}">
        <label class="block text-sm text-muted mb-1 mt-3">Status</label>
        <select id="edit-client-status" class="input-field w-full">
          ${CLIENT_STATUSES.map((s) => `<option value="${s}" ${client.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <label class="block text-sm text-muted mb-1 mt-3">Notes</label>
        <textarea id="edit-client-notes" class="input-field w-full" rows="3">${esc(client.notes || "")}</textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Save</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const name = overlay.querySelector("#edit-client-name").value.trim();
      if (!name) { await EngageModal.alert({ title: "Validation Error", message: "Client name is required." }); return; }
      try {
        await EngageApi.updateClient(client.id, {
          name,
          displayName: overlay.querySelector("#edit-client-display").value.trim(),
          industry: overlay.querySelector("#edit-client-industry").value,
          website: overlay.querySelector("#edit-client-website").value.trim(),
          status: overlay.querySelector("#edit-client-status").value,
          notes: overlay.querySelector("#edit-client-notes").value.trim(),
        });
        overlay.remove();
        await refresh(client.id);
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to update client: " + err.message });
      }
    });
  }

  async function openClient(clientId) {
    const section = document.querySelector('[data-engage-section="clients"]');
    if (!section) return;
    section.innerHTML = '<div class="engage-empty">Loading client...</div>';
    try {
      const data = await EngageApi.getClientDetail(clientId);
      state.selectedClient = data.client;
      state.detail = data;
      state.view = "detail";
      renderDetail(section, data);
    } catch (err) {
      section.innerHTML = `<div class="engage-empty">Failed to load client: ${esc(err.message)}</div>`;
    }
  }

  function renderDetail(section, data) {
    const c = data.client;
    let html = '<div class="engage-client-detail">';
    html += '<div class="engage-client-detail-header">';
    html += `<button type="button" class="btn-secondary text-sm client-back-btn">Back to Clients</button>`;
    html += `<h2 class="engage-client-detail-name">${esc(c.display_name || c.name)}</h2>`;
    html += `<div class="engage-client-detail-meta">${esc(c.industry || "")} &middot; ${statusPill(c.status)} &middot; ${esc(c.website || "")}</div>`;
    html += '<div class="engage-client-detail-actions">';
    html += '<button type="button" class="btn-secondary text-sm client-edit-btn">Edit</button>';
    html += '<button type="button" class="btn-primary text-sm client-add-contact-btn">Add Contact</button>';
    html += '<button type="button" class="btn-primary text-sm client-add-note-btn">Add Note</button>';
    html += '</div></div>';

    html += '<div class="engage-tabs">';
    ["Contacts", "Opportunities", "Engagements", "Notes"].forEach((tab, i) => {
      html += `<button type="button" class="engage-tab ${i === 0 ? "active" : ""}" data-client-tab="${tab.toLowerCase()}">${tab}</button>`;
    });
    html += '</div>';

    html += `<div data-client-panel="contacts">${renderContacts(data.contacts)}</div>`;
    html += `<div data-client-panel="opportunities" class="hidden">${renderOpportunities(data.opportunities)}</div>`;
    html += `<div data-client-panel="engagements" class="hidden">${renderEngagements(data.engagements)}</div>`;
    html += `<div data-client-panel="notes" class="hidden">${renderNotes(data.notes)}</div>`;

    html += '</div>';
    section.innerHTML = html;

    section.querySelector(".client-back-btn").addEventListener("click", () => { state.view = "list"; renderList(); });
    section.querySelector(".client-edit-btn").addEventListener("click", () => openEditModal(c));
    section.querySelector(".client-add-contact-btn").addEventListener("click", () => openCreateContactModal(c.id));
    section.querySelector(".client-add-note-btn").addEventListener("click", () => openNoteModal("client", c.id));

    section.querySelectorAll(".engage-tab[data-client-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        section.querySelectorAll(".engage-tab[data-client-tab]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        section.querySelectorAll("[data-client-panel]").forEach((p) => p.classList.add("hidden"));
        const panel = section.querySelector(`[data-client-panel="${tab.dataset.clientTab}"]`);
        if (panel) panel.classList.remove("hidden");
      });
    });

    // Click opportunity items to open in pipeline view
    section.querySelectorAll("[data-opp-id]").forEach((el) => {
      el.addEventListener("click", () => {
        if (typeof switchEngageView === "function") switchEngageView("pipeline");
        if (typeof EngageOpportunities !== "undefined" && EngageOpportunities.openOpp) {
          setTimeout(() => EngageOpportunities.openOpp(el.dataset.oppId), 100);
        }
      });
    });

    // Click engagement items to open in engagements view
    section.querySelectorAll("[data-eng-id]").forEach((el) => {
      el.addEventListener("click", () => {
        if (typeof switchEngageView === "function") switchEngageView("engagements");
        if (typeof EngageEngagements !== "undefined" && EngageEngagements.openEng) {
          setTimeout(() => EngageEngagements.openEng(el.dataset.engId), 100);
        }
      });
    });
  }

  function renderContacts(contacts) {
    if (!contacts || contacts.length === 0) return '<div class="engage-empty">No contacts</div>';
    return '<div class="engage-contacts-list">' + contacts.map((ct) =>
      `<div class="engage-contact-item">
        <div>
          <strong>${esc(ct.name)}</strong>
          <div class="engage-list-item-meta">${esc(ct.title || "")} &middot; ${esc(ct.contact_type || "")} ${ct.is_primary ? '<span class="engage-status-pill active"><span class="pill-dot"></span>Primary</span>' : ""}</div>
          <div class="engage-list-item-meta">${esc(ct.email || "")} ${ct.phone ? "&middot; " + esc(ct.phone) : ""}</div>
        </div>
      </div>`
    ).join("") + '</div>';
  }

  function renderOpportunities(opportunities) {
    if (!opportunities || opportunities.length === 0) return '<div class="engage-empty">No opportunities</div>';
    return opportunities.map((o) => `<div class="engage-list-item engage-clickable-item" data-opp-id="${esc(o.id)}">
      <div>
        <strong>${esc(o.title)}</strong>
        <div class="engage-list-item-meta">${renderTypeTags(o.opportunity_type)} &middot; Stage: ${esc(o.stage)}</div>
      </div>
      ${statusPill(o.stage === "won" ? "delivered" : o.stage === "lost" || o.stage === "rejected" ? "closed" : "active")}
    </div>`).join("");
  }

  function renderEngagements(engagements) {
    if (!engagements || engagements.length === 0) return '<div class="engage-empty">No engagements</div>';
    const STATUS_CLASSES = { draft: "draft", testing_in_progress: "testing", testing_blocked: "blocked",
      ready_for_qa: "qa", delivered: "delivered", closed: "closed" };
    return engagements.map((e) => `<div class="engage-list-item engage-clickable-item" data-eng-id="${esc(e.id)}">
      <div>
        <strong>${esc(e.title)}</strong>
        <div class="engage-list-item-meta">${renderTypeTags(e.engagement_type)}</div>
      </div>
      <span class="engage-status-pill ${STATUS_CLASSES[e.status] || "draft"}"><span class="pill-dot"></span>${esc(e.status)}</span>
    </div>`).join("");
  }

  function renderNotes(notes) {
    if (!notes || notes.length === 0) return '<div class="engage-empty">No notes</div>';
    return notes.map((n) => `<div class="engage-note-item">
      <div class="engage-note-content">${esc(n.content)}</div>
      <div class="engage-list-item-meta">${esc(n.username || n.user_id || "")} &middot; ${formatDate(n.created_at)}</div>
    </div>`).join("");
  }

  function openCreateContactModal(clientId) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Add Contact</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Name *</label>
        <input type="text" id="contact-name" class="input-field w-full" placeholder="Full name">
        <label class="block text-sm text-muted mb-1 mt-3">Title</label>
        <input type="text" id="contact-title" class="input-field w-full" placeholder="Job title">
        <label class="block text-sm text-muted mb-1 mt-3">Email</label>
        <input type="email" id="contact-email" class="input-field w-full" placeholder="email@example.com">
        <label class="block text-sm text-muted mb-1 mt-3">Phone</label>
        <input type="text" id="contact-phone" class="input-field w-full" placeholder="+1 555 000 0000">
        <label class="block text-sm text-muted mb-1 mt-3">Type</label>
        <select id="contact-type" class="input-field w-full">
          ${CONTACT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
        <label class="block mt-3"><input type="checkbox" id="contact-primary"> Primary contact</label>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Add Contact</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const name = overlay.querySelector("#contact-name").value.trim();
      if (!name) { await EngageModal.alert({ title: "Validation Error", message: "Contact name is required." }); return; }
      try {
        await EngageApi.createContact(clientId, {
          name,
          title: overlay.querySelector("#contact-title").value.trim(),
          email: overlay.querySelector("#contact-email").value.trim(),
          phone: overlay.querySelector("#contact-phone").value.trim(),
          contactType: overlay.querySelector("#contact-type").value,
          isPrimary: overlay.querySelector("#contact-primary").checked,
        });
        overlay.remove();
        await refresh(clientId);
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to add contact: " + err.message });
      }
    });
  }

  function openNoteModal(entityType, entityId) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Add Note</h3>
      <div class="confirm-modal-message">
        <textarea id="note-content" class="input-field w-full" rows="5" placeholder="Write a note..."></textarea>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary modal-confirm-btn">Save Note</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector(".modal-cancel-btn").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector(".modal-confirm-btn").addEventListener("click", async () => {
      const content = overlay.querySelector("#note-content").value.trim();
      if (!content) { await EngageModal.alert({ title: "Validation Error", message: "Note content is required." }); return; }
      try {
        if (entityType === "client") {
          await EngageApi.createClientNote(entityId, content);
        } else if (entityType === "opportunity") {
          await EngageApi.createOpportunityNote(entityId, content);
        } else if (entityType === "engagement") {
          await EngageApi.createEngagementNote(entityId, content);
        }
        overlay.remove();
        if (entityType === "opportunity") {
          if (typeof EngageOpportunities !== "undefined" && EngageOpportunities.openOpp) {
            await EngageOpportunities.openOpp(entityId);
          }
        } else if (entityType === "engagement") {
          if (typeof EngageEngagements !== "undefined" && EngageEngagements.openEng) {
            await EngageEngagements.openEng(entityId);
          }
        } else {
          await refresh(entityId);
        }
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to save note: " + err.message });
      }
    });
  }

  async function refresh(clientId) {
    try {
      if (clientId && state.view === "detail") {
        const data = await EngageApi.getClientDetail(clientId);
        state.selectedClient = data.client;
        state.detail = data;
        const section = document.querySelector('[data-engage-section="clients"]');
        if (section) renderDetail(section, data);
      } else {
        const result = await EngageApi.listClients();
        state.clients = result.clients || [];
        state.view = "list";
        renderList();
      }
    } catch {
      // best-effort
    }
  }

  async function init() {
    try {
      const result = await EngageApi.listClients();
      state.clients = result.clients || [];
    } catch {
      state.clients = [];
    }
    renderList();
  }

  return { init, refresh, openNoteModal };
})();
