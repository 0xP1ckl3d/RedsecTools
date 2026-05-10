// Global modal helper — loads confirm-modal.js once and exposes showAlertModal/showConfirmModal
var EngageModal = (() => {
  let _showAlert, _showConfirm;
  const ready = import("/js/confirm-modal.js").then((m) => {
    _showAlert = m.showAlertModal;
    _showConfirm = m.showConfirmModal;
  });

  async function alert(opts) {
    await ready;
    return _showAlert(opts);
  }

  async function confirm(opts) {
    await ready;
    return _showConfirm(opts);
  }

  return { alert, confirm };
})();

const EngageApi = (() => {
  async function api(path, options = {}) {
    const res = await fetch("/api" + path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function json(method, body) {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  return {
    // Bootstrap
    bootstrap: () => api("/engage/bootstrap"),
    dashboard: () => api("/engage/dashboard"),
    pipelineStats: () => api("/engage/pipeline-stats"),
    statusSummary: () => api("/engage/status-summary"),
    utilisation: (days) => api(`/engage/utilisation?days=${days || 30}`),

    // Clients
    listClients: (limit, offset) => api(`/engage/clients?limit=${limit || 50}&offset=${offset || 0}`),
    getClient: (id) => api(`/engage/clients/${id}`),
    getClientDetail: (id) => api(`/engage/clients/${id}/detail`),
    createClient: (data) => api("/engage/clients", json("POST", data)),
    updateClient: (id, data) => api(`/engage/clients/${id}`, json("PUT", data)),
    archiveClient: (id) => api(`/engage/clients/${id}/archive`, json("POST", {})),

    // Contacts
    listContacts: (clientId) => api(`/engage/clients/${clientId}/contacts`),
    createContact: (clientId, data) => api(`/engage/clients/${clientId}/contacts`, json("POST", data)),
    updateContact: (id, data) => api(`/engage/contacts/${id}`, json("PUT", data)),
    archiveContact: (id) => api(`/engage/contacts/${id}/archive`, json("POST", {})),

    // Opportunities
    listOpportunities: (clientId) => api(clientId ? `/engage/opportunities?clientId=${clientId}` : "/engage/opportunities"),
    getOpportunity: (id) => api(`/engage/opportunities/${id}`),
    createOpportunity: (data) => api("/engage/opportunities", json("POST", data)),
    updateOpportunity: (id, data) => api(`/engage/opportunities/${id}`, json("PUT", data)),
    updateStage: (id, stage) => api(`/engage/opportunities/${id}/stage`, json("POST", { stage })),
    linkProposal: (id, data) => api(`/engage/opportunities/${id}/link-proposal`, json("POST", data)),
    convertToEngagement: (id, data) => api(`/engage/opportunities/${id}/convert-to-engagement`, json("POST", data || {})),

    // Engagements
    listEngagements: (clientId) => api(clientId ? `/engage/engagements?clientId=${clientId}` : "/engage/engagements"),
    getEngagement: (id) => api(`/engage/engagements/${id}`),
    getEngagementDetail: (id) => api(`/engage/engagements/${id}/detail`),
    createEngagement: (data) => api("/engage/engagements", json("POST", data)),
    updateEngagement: (id, data) => api(`/engage/engagements/${id}`, json("PUT", data)),
    updateStatus: (id, status) => api(`/engage/engagements/${id}/status`, json("POST", { status })),
    archiveEngagement: (id) => api(`/engage/engagements/${id}/archive`, json("POST", {})),
    linkCalendar: (id, data) => api(`/engage/engagements/${id}/link-calendar`, json("POST", data)),
    linkReporter: (id, data) => api(`/engage/engagements/${id}/link-reporter`, json("POST", data)),
    createReporterProject: (id, data) => api(`/engage/engagements/${id}/create-reporter-project`, json("POST", data)),
    createCalendarProject: (id, data) => api(`/engage/engagements/${id}/create-calendar-project`, json("POST", data)),
    listReporterProjects: (query) => api(`/engage/reporter/projects${query ? "?query=" + encodeURIComponent(query) : ""}`),
    listCalendarProjects: (query) => api(`/engage/calendar/projects${query ? "?query=" + encodeURIComponent(query) : ""}`),
    listReporterProposals: (query) => api(`/engage/reporter/proposals${query ? "?query=" + encodeURIComponent(query) : ""}`),

    // Users
    listUsers: () => api("/engage/users"),

    // Team
    listTeam: (engagementId) => api(`/engage/engagements/${engagementId}/team`),
    addTeamMember: (engagementId, data) => api(`/engage/engagements/${engagementId}/team`, json("POST", data)),
    updateTeamMember: (engagementId, memberId, data) => api(`/engage/engagements/${engagementId}/team/${memberId}`, json("PUT", data)),
    removeTeamMember: (engagementId, memberId) => api(`/engage/engagements/${engagementId}/team/${memberId}`, { method: "DELETE" }),

    // QA
    listQa: (params) => {
      if (typeof params === "string") params = { status: params };
      const qs = [];
      if (params?.status) qs.push(`status=${encodeURIComponent(params.status)}`);
      if (params?.assignee) qs.push(`assignee=${encodeURIComponent(params.assignee)}`);
      const query = qs.join("&");
      return api(query ? `/engage/qa?${query}` : "/engage/qa");
    },
    requestQa: (engagementId, data) => api(`/engage/engagements/${engagementId}/qa/request`, json("POST", data)),
    assignQa: (engagementId, data) => api(`/engage/engagements/${engagementId}/qa/assign`, json("POST", data)),
    updateQaStatus: (id, data) => api(`/engage/qa/${id}/status`, json("POST", data)),
    updateQa: (id, data) => api(`/engage/qa/${id}`, json("PUT", data)),

    // Notes / Activity
    getEngagementActivity: (id) => api(`/engage/engagements/${id}/activity`),
    createEngagementNote: (id, content) => api(`/engage/engagements/${id}/notes`, json("POST", { content })),
    createOpportunityNote: (id, content) => api(`/engage/opportunities/${id}/notes`, json("POST", { content })),
    createClientNote: (id, content) => api(`/engage/clients/${id}/notes`, json("POST", { content })),

  };
})();
