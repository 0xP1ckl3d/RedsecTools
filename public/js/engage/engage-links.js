const EngageLinks = (() => {
  function openProposalPicker(callback) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Link Proposal Document</h3>
      <div class="confirm-modal-message">
        <p class="text-sm text-muted mb-3">Select an existing Reporter proposal project, or create a new one from a template.</p>
        <div id="link-proposal-list" class="mb-3"><p class="text-sm text-muted">Loading proposals...</p></div>
        <div class="mt-3">
          <label class="block text-sm text-muted mb-1">Or enter Reporter Project ID</label>
          <input type="text" id="link-proposal-doc-id" class="input-field w-full" placeholder="Reporter project ID">
        </div>
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary" id="link-proposal-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="link-proposal-confirm">Link</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector("#link-proposal-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector("#link-proposal-confirm").addEventListener("click", () => {
      const input = overlay.querySelector("#link-proposal-doc-id");
      if (input.value.trim()) {
        overlay.remove();
        callback({ proposalReporterDocId: input.value.trim() });
      }
    });

    EngageApi.listProposalProjects().then((projects) => {
      const container = overlay.querySelector("#link-proposal-list");
      if (!projects || projects.length === 0) {
        container.innerHTML = '<p class="text-sm text-muted">No proposal projects found.</p>';
        return;
      }
      container.innerHTML = projects.map((p) =>
        `<div class="engage-list-item" data-proposal-id="${p.id}">
          <div><strong>${p.title}</strong><div class="engage-list-item-meta">${p.status} &middot; ${p.reportType}</div></div>
          <button type="button" class="btn-secondary text-sm link-pick-btn" data-pick-id="${p.id}">Select</button>
        </div>`
      ).join("");
      container.querySelectorAll(".link-pick-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          overlay.remove();
          callback({ proposalReporterDocId: btn.dataset.pickId });
        });
      });
    }).catch(() => {
      const container = overlay.querySelector("#link-proposal-list");
      container.innerHTML = '<p class="text-sm text-muted">Failed to load proposals.</p>';
    });
  }

  function openCreateProposal(opportunityData, callback) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal-card">
      <h3 class="confirm-modal-title">Create Proposal</h3>
      <div class="confirm-modal-message">
        <label class="block text-sm text-muted mb-1">Proposal Template *</label>
        <select id="create-proposal-design" class="input-field w-full"><option value="">Loading templates...</option></select>
        <label class="block text-sm text-muted mb-1 mt-3">Proposal Title *</label>
        <input type="text" id="create-proposal-title" class="input-field w-full" value="${opportunityData.title || "Proposal"}">
        <label class="block text-sm text-muted mb-1 mt-3">Client Name</label>
        <input type="text" id="create-proposal-client" class="input-field w-full" value="${opportunityData.clientName || ""}">
      </div>
      <div class="confirm-modal-actions">
        <button type="button" class="btn-secondary" id="create-proposal-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="create-proposal-confirm">Create</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector("#create-proposal-cancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

    EngageApi.listProposalDesigns().then((designs) => {
      const select = overlay.querySelector("#create-proposal-design");
      if (!designs || designs.length === 0) {
        select.innerHTML = '<option value="">No proposal templates available</option>';
        return;
      }
      select.innerHTML = designs.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
    }).catch(() => {
      const select = overlay.querySelector("#create-proposal-design");
      select.innerHTML = '<option value="">Failed to load templates</option>';
    });

    overlay.querySelector("#create-proposal-confirm").addEventListener("click", async () => {
      const designId = overlay.querySelector("#create-proposal-design").value;
      const title = overlay.querySelector("#create-proposal-title").value.trim();
      const clientName = overlay.querySelector("#create-proposal-client").value.trim();
      if (!designId) { await EngageModal.alert({ title: "Validation Error", message: "Select a template." }); return; }
      if (!title) { await EngageModal.alert({ title: "Validation Error", message: "Proposal title is required." }); return; }
      overlay.remove();
      try {
        const result = await EngageApi.createReporterProject({ designId, title, clientName });
        if (result.id) {
          callback({ proposalReporterDocId: result.id });
        }
      } catch (err) {
        await EngageModal.alert({ title: "Error", message: "Failed to create proposal: " + err.message });
      }
    });
  }

  return { openProposalPicker, openCreateProposal };
})();
