import { showAlertModal, showConfirmModal } from "./confirm-modal.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  currentView: "dashboard",
  feeds: [],
  keywords: [],
  tags: [],
  alerts: [],
  notifications: [],
  userNotifications: [],
  templates: [],
  feedHealth: null,
  feedErrors: [],
  stats: null,
  recentAlerts: [],
  newsItems: [],
  mitreOverview: null,
  settings: {},
  notificationPolicy: {},
  allowedChannels: [],
  accountEmail: "",
  canManage: false,
  selectedFeedIds: new Set(),
  selectedKeywordIds: new Set(),
  selectedAlertIds: new Set(),
  alertOffset: 0,
  alertLimit: 50,
  alertTotal: 0,
  autoRefreshTimer: null,
  logsRefreshTimer: null,
};

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch("/api/threat" + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

let runtimeSheet = null;
const runtimeRuleCache = new Set();

function getRuntimeSheet() {
  if (runtimeSheet) return runtimeSheet;
  for (const sheet of document.styleSheets) {
    try {
      const href = sheet.href || "";
      if (!href || href.startsWith(window.location.origin) || href.startsWith("/")) {
        runtimeSheet = sheet;
        return runtimeSheet;
      }
    } catch (_) {
      // Ignore cross-origin or inaccessible stylesheets.
    }
  }
  return null;
}

function ensureRuntimeRule(className, declaration) {
  const cacheKey = className + "::" + declaration;
  if (runtimeRuleCache.has(cacheKey)) return;
  const sheet = getRuntimeSheet();
  if (!sheet) return;
  try {
    sheet.insertRule(`.${className}{${declaration}}`, sheet.cssRules.length);
    runtimeRuleCache.add(cacheKey);
  } catch (_) {
    // Ignore invalid dynamic rule attempts.
  }
}

function normalizeHexColor(color) {
  const value = String(color || "").trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value.toUpperCase() : "#E53935";
}

function hashToken(value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function applyDynamicClass(el, prefix, declaration, token) {
  if (!el) return;
  const className = `${prefix}-${hashToken(token)}`;
  ensureRuntimeRule(className, declaration);
  const previous = el.dataset[prefix];
  if (previous) {
    el.classList.remove(previous);
  }
  el.classList.add(className);
  el.dataset[prefix] = className;
}

function applyTagColors(root) {
  root.querySelectorAll("[data-tag-color]").forEach((el) => {
    const color = normalizeHexColor(el.dataset.tagColor);
    applyDynamicClass(el, "threatTagColorClass", `background-color:${color};`, color);
  });
}

function applySwatchColors(root) {
  root.querySelectorAll(".threat-color-swatch[data-color]").forEach((el) => {
    const color = normalizeHexColor(el.dataset.color);
    applyDynamicClass(el, "threatSwatchColorClass", `background-color:${color};`, color);
  });
}

function relativeTime(timestamp) {
  if (!timestamp) return "-";
  const now = Date.now();
  const then = typeof timestamp === "number"
    ? (timestamp > 1e12 ? timestamp : timestamp * 1000)
    : new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(then).toLocaleDateString();
}

function formatLocalDateTime(timestamp) {
  const then = toTimestampMs(timestamp);
  if (!then) return "-";
  return new Date(then).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRelativeTimeWithTitle(timestamp) {
  const local = formatLocalDateTime(timestamp);
  return '<span title="' + escapeHtml(local) + '">' + escapeHtml(relativeTime(timestamp)) + "</span>";
}

function getSourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch (_) {
    return "";
  }
}

function dedupeKeywordList(keywords) {
  if (!Array.isArray(keywords)) return [];
  const deduped = [];
  const seen = new Set();
  for (const keyword of keywords) {
    const text = typeof keyword === "string" ? keyword : (keyword?.keyword || keyword?.text || "");
    const key = typeof keyword === "string"
      ? text.toLowerCase()
      : `${keyword?.keywordId || ""}:${text.toLowerCase()}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    deduped.push(keyword);
  }
  return deduped;
}

function getAlertHeadline(alert) {
  return (
    alert?.apiMetadata?.title
    || alert?.matchedContent
    || dedupeKeywordList(alert?.keywords || [])[0]?.keyword
    || "Threat match"
  );
}

function getAlertSummary(alert, max = 140) {
  const text = alert?.context || alert?.matchedContent || alert?.apiMetadata?.record?.description || "";
  return truncate(String(text || "").replace(/\s+/g, " ").trim(), max);
}

function criticalityBadge(level) {
  const label = String(level || "medium").toLowerCase();
  const classes = {
    critical: "threat-badge-critical",
    high: "threat-badge-high",
    medium: "threat-badge-medium",
    low: "threat-badge-low",
  };
  return '<span class="threat-badge ' + (classes[label] || "threat-badge-medium") + '">' + escapeHtml(label) + "</span>";
}

function feedTypeBadge(type) {
  const label = String(type || "rss").toLowerCase();
  const classes = {
    rss: "threat-badge-rss",
    api: "threat-badge-api",
    website: "threat-badge-website",
    onion: "threat-badge-onion",
  };
  return '<span class="threat-badge ' + (classes[label] || "threat-badge-rss") + '">' + escapeHtml(label) + "</span>";
}

function channelTypeBadge(type) {
  const label = String(type || "webhook").toLowerCase();
  const classes = {
    webhook: "threat-badge-webhook",
    email: "threat-badge-email",
    discord: "threat-badge-discord",
  };
  return '<span class="threat-badge ' + (classes[label] || "threat-badge-webhook") + '">' + escapeHtml(label) + "</span>";
}

function tagChips(tags) {
  if (!Array.isArray(tags) || !tags.length) return '<span class="text-muted text-sm">-</span>';
  return tags.map((tag) => {
    const name = tag.name || tag;
    const colorAttr = tag.color ? ' data-tag-color="' + escapeHtml(tag.color) + '"' : "";
    return '<span class="threat-tag-chip"' + colorAttr + '>' + escapeHtml(name) + '</span>';
  }).join(" ");
}

function keywordChips(keywords) {
  const deduped = dedupeKeywordList(keywords);
  if (!deduped.length) return '<span class="text-muted text-sm">-</span>';
  return deduped.map((kw) => {
    const text = typeof kw === "string" ? kw : (kw.keyword || kw.text || "");
    return '<span class="threat-keyword-chip">' + escapeHtml(text) + "</span>";
  }).join(" ");
}

function iocChips(iocs) {
  if (!iocs || typeof iocs !== "object") return "";
  const groups = Object.entries(iocs);
  if (!groups.length) return "";
  return groups.map(([type, values]) => {
    if (!Array.isArray(values) || !values.length) return "";
    const items = values.map((val) =>
      '<button type="button" class="threat-ioc-chip threat-ioc-' + escapeHtml(type) + '" data-ioc-value="' + escapeHtml(val) + '" title="Click to copy">' + escapeHtml(val) + "</button>"
    ).join(" ");
    return (
      '<div class="threat-ioc-group">' +
        '<div class="threat-ioc-type">' + escapeHtml(type) + "</div>" +
        '<div class="threat-ioc-values">' + items + "</div>" +
      "</div>"
    );
  }).join("");
}

function highlightKeywords(text, keywords) {
  if (!text || !keywords || !keywords.length) return escapeHtml(text);
  let result = escapeHtml(text);
  keywords.forEach((kw) => {
    const word = typeof kw === "string" ? kw : (kw.keyword || kw.text || "");
    if (!word) return;
    const escaped = escapeHtml(word);
    const regex = new RegExp("(" + escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    result = result.replace(regex, '<span class="threat-highlight-match">$1</span>');
  });
  return result;
}

function formatAlertContextHtml(text, keywords) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  let normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.includes("\n")) {
    normalized = normalized.replace(/([.!?])\s+(?=[A-Z0-9])/g, "$1\n\n");
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return highlightKeywords(normalized, keywords);
  }

  return paragraphs
    .map((part) => '<p class="threat-detail-paragraph">' + highlightKeywords(part.replace(/\n/g, " "), keywords) + "</p>")
    .join("");
}

function enabledBadge(enabled) {
  return enabled
    ? '<span class="threat-badge threat-badge-enabled">Enabled</span>'
    : '<span class="threat-badge threat-badge-disabled">Disabled</span>';
}

function readBadge(isRead) {
  return isRead
    ? '<span class="threat-badge threat-badge-read">Read</span>'
    : '<span class="threat-badge threat-badge-unread">Unread</span>';
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.substring(0, max) + "..." : str;
}

function formatInterval(seconds) {
  if (!seconds) return "-";
  if (seconds < 60) return seconds + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m ? h + "h " + m + "m" : h + "h";
  }
  return Math.floor(seconds / 86400) + "d";
}

function statusBadge(status) {
  const s = String(status || "unknown").toLowerCase();
  const classes = {
    healthy: "threat-badge-healthy",
    warning: "threat-badge-warning",
    error: "threat-badge-error",
    disabled: "threat-badge-disabled",
    ok: "threat-badge-healthy",
  };
  return '<span class="threat-badge ' + (classes[s] || "threat-badge-medium") + '">' + escapeHtml(s) + "</span>";
}

function toTimestampMs(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp === "number") {
    return timestamp > 1e12 ? timestamp : timestamp * 1000;
  }
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCriticalityChart(dist) {
  const levels = [
    { key: "low", label: "Low", color: "#3B82F6" },
    { key: "medium", label: "Medium", color: "#F59E0B" },
    { key: "high", label: "High", color: "#EF4444" },
    { key: "critical", label: "Critical", color: "#8B5CF6" },
  ];
  const data = levels
    .map((level) => ({ ...level, value: Number(dist?.[level.key] || 0) }))
    .filter((level) => level.value > 0);

  if (!data.length) {
    return '<div class="threat-chart-empty"><p class="text-sm text-muted">No alerts yet.</p></div>';
  }

  const total = data.reduce((sum, level) => sum + level.value, 0);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = data.map((level) => {
    const segmentLength = (level.value / total) * circumference;
    const dashArray = `${segmentLength} ${Math.max(circumference - segmentLength, 0)}`;
    const segment = '<circle class="threat-pie-segment" cx="110" cy="110" r="' + radius + '" stroke="' + level.color + '" stroke-dasharray="' + dashArray + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 110 110)"></circle>';
    offset += segmentLength;
    return segment;
  }).join("");

  const legend = data.map((level) => {
    const percent = Math.round((level.value / total) * 100);
    return (
      '<div class="threat-pie-legend-row">' +
        '<span class="threat-pie-legend-label">' +
          '<span class="threat-pie-legend-swatch threat-color-swatch" data-color="' + level.color + '"></span>' +
          escapeHtml(level.label) +
        "</span>" +
        '<span class="threat-pie-legend-value">' + level.value + ' <span class="text-muted">(' + percent + '%)</span></span>' +
      "</div>"
    );
  }).join("");

  return (
    '<div class="threat-pie-layout">' +
      '<div class="threat-pie-visual">' +
        '<svg class="threat-pie-chart" viewBox="0 0 220 220" role="img" aria-label="Alert criticality distribution">' +
          '<circle class="threat-pie-track" cx="110" cy="110" r="' + radius + '"></circle>' +
          segments +
          '<text class="threat-pie-total" x="110" y="104" text-anchor="middle">' + total + "</text>" +
          '<text class="threat-pie-caption" x="110" y="126" text-anchor="middle">alerts</text>' +
        "</svg>" +
      "</div>" +
      '<div class="threat-pie-legend">' + legend + "</div>" +
    "</div>"
  );
}

function mitreBadges(matches) {
  if (!Array.isArray(matches) || !matches.length) return "";
  return matches.map((match) =>
    '<span class="threat-mitre-chip">' +
      '<span class="threat-mitre-chip-id">' + escapeHtml(match.techniqueId || match.tacticId || "") + "</span>" +
      '<span class="threat-mitre-chip-label">' + escapeHtml(match.technique || match.tactic || "ATT&CK") + "</span>" +
    "</span>"
  ).join("");
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

const MANAGE_VIEWS = new Set();

async function showFeedAdminOnlyMessage() {
  await showAlertModal({
    title: "Admin Only",
    message: "Feed source changes are handled in the admin panel. This page is read-only for feed sources.",
  });
}

function setCurrentView(view) {
  if (MANAGE_VIEWS.has(view) && !state.canManage) {
    view = "dashboard";
  }
  state.currentView = view;
  document.querySelectorAll("[data-threat-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.threatView === view);
  });
  document.querySelectorAll(".threat-dashboard-view").forEach((section) => {
    section.classList.toggle("hidden", section.id !== "threat-view-" + view);
  });
  loadCurrentView();
}

function loadCurrentView() {
  clearAutoRefresh();
  switch (state.currentView) {
    case "dashboard": loadDashboard(); break;
    case "news": loadNews(); break;
    case "feeds": loadFeeds(); break;
    case "keywords": loadKeywords(); break;
    case "tags": loadTags(); break;
    case "alerts": loadAlerts(); break;
    case "mitre": loadMitre(); break;
    case "notifications": loadNotifications(); break;
    case "logs": loadLogs(); break;
  }
}

function clearAutoRefresh() {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (state.logsRefreshTimer) {
    clearInterval(state.logsRefreshTimer);
    state.logsRefreshTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Sidebar collapse
// ---------------------------------------------------------------------------

function initSidebarCollapse() {
  const sidebar = document.getElementById("threat-sidebar");
  const button = document.getElementById("threat-sidebar-collapse-btn");
  if (!sidebar || !button) return;
  button.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

async function loadDashboard() {
  try {
    const data = await api("/bootstrap");
    state.stats = data.stats || null;
    state.settings = data.settings || {};
    state.userNotifications = data.userNotifications || [];
    state.notificationPolicy = data.notificationPolicy || state.notificationPolicy || {};
    state.accountEmail = data.accountEmail || state.accountEmail || "";
    const recentAlerts = data.recentAlerts || [];
    state.recentAlerts = recentAlerts;
    const feedHealth = data.feedHealth || null;
    renderDashboard(state.stats, recentAlerts, feedHealth);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
  }
}

function renderDashboard(stats, recentAlerts, feedHealth) {
  const totalAlertsEl = document.getElementById("threat-dash-total-alerts");
  const keywordsEl = document.getElementById("threat-dash-keywords");
  const unreadEl = document.getElementById("threat-dash-unread");
  const healthyFeedsEl = document.getElementById("threat-dash-healthy-feeds");

  if (totalAlertsEl) totalAlertsEl.textContent = stats?.totalAlerts ?? "-";
  if (keywordsEl) keywordsEl.textContent = stats?.activeKeywords ?? "-";
  if (unreadEl) unreadEl.textContent = stats?.unreadAlerts ?? "-";
  if (healthyFeedsEl) {
    const healthy = stats?.healthyFeeds;
    const total = stats?.totalFeeds;
    healthyFeedsEl.textContent = Number.isFinite(healthy) && Number.isFinite(total) ? `${healthy}/${total}` : "-";
  }

  // Criticality distribution chart
  const chartEl = document.getElementById("threat-dash-chart");
  if (chartEl) {
    chartEl.innerHTML = buildCriticalityChart(stats?.criticalityDistribution || {});
  }

  // Recent alerts
  const alertsEl = document.getElementById("threat-dash-recent-alerts");
  if (alertsEl) {
    const top5 = (recentAlerts || []).slice(0, 5);
    if (top5.length) {
      alertsEl.innerHTML = top5.map((alert) =>
        '<button type="button" class="threat-recent-item threat-recent-item-button" data-action="view-alert" data-id="' + escapeHtml(alert.id) + '">' +
          '<div class="threat-recent-item-header">' +
            '<div class="threat-recent-item-heading">' +
              criticalityBadge(alert.criticality) +
              '<span class="threat-recent-item-title">' + escapeHtml(getAlertHeadline(alert)) + "</span>" +
            "</div>" +
            '<span class="text-xs text-muted">' + formatRelativeTimeWithTitle(alert.createdAt) + "</span>" +
          "</div>" +
          '<div class="threat-recent-item-source">' + escapeHtml(alert.feedName || "Unknown feed") + "</div>" +
          '<div class="threat-recent-item-body"><span class="text-sm">' + escapeHtml(getAlertSummary(alert, 120)) + "</span></div>" +
          '<div class="threat-recent-item-keywords">' + keywordChips(alert.keywords || []) + "</div>" +
        "</button>"
      ).join("");
    } else {
      alertsEl.innerHTML = stats?.activeKeywords
        ? '<p class="text-sm text-muted">No alerts yet.</p>'
        : '<p class="text-sm text-muted">No alerts yet. Add or enable keywords to start generating matches.</p>';
    }
  }

  // Feed activity
  const feedEl = document.getElementById("threat-dash-feed-activity");
  if (feedEl) {
    const feeds = [...(feedHealth?.feeds || [])].sort((left, right) => toTimestampMs(right.lastChecked) - toTimestampMs(left.lastChecked));
    const top5 = feeds.slice(0, 5);
    if (top5.length) {
      feedEl.innerHTML = top5.map((feed) =>
        '<div class="threat-feed-activity-item">' +
          '<div class="threat-feed-activity-top">' +
            '<span class="threat-feed-activity-name">' + escapeHtml(feed.name) + "</span>" +
            feedTypeBadge(feed.feedType) +
          "</div>" +
          '<div class="threat-feed-activity-status">' + statusBadge(feed.status || "unknown") + "</div>" +
          '<div class="threat-feed-activity-time">Last checked: ' + relativeTime(feed.lastChecked) + "</div>" +
        "</div>"
      ).join("");
    } else {
      feedEl.innerHTML = '<p class="text-sm text-muted">No feed activity.</p>';
    }
  }

  applySwatchColors(document.getElementById("threat-dash-chart") || document.body);

  // Make stat cards clickable
  document.querySelectorAll("[data-threat-nav]").forEach((card) => {
    if (card.dataset.threatNavBound === "true") return;
    card.dataset.threatNavBound = "true";
    card.addEventListener("click", () => setCurrentView(card.dataset.threatNav));
  });
}

// ---------------------------------------------------------------------------
// Intel Brief
// ---------------------------------------------------------------------------

async function loadNews() {
  try {
    const data = await api("/news?limit=24");
    state.newsItems = data.items || [];
    renderNews(state.newsItems);
  } catch (err) {
    console.error("Failed to load intel brief:", err);
  }
}

function renderNews(items) {
  const gridEl = document.getElementById("threat-news-grid");
  const emptyEl = document.getElementById("threat-news-empty");
  if (!gridEl) return;

  if (!Array.isArray(items) || !items.length) {
    gridEl.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");
  gridEl.innerHTML = items.map((item) => {
    const imageSrc = item.imageUrl && item.alertId ? ("/api/threat/news-image/" + encodeURIComponent(item.alertId)) : "";
    const image = item.imageUrl
      ? '<div class="threat-news-media"><img src="' + escapeHtml(imageSrc) + '" alt="' + escapeHtml(item.headline || item.feedName || "Threat article") + '" loading="lazy"></div>'
      : '<div class="threat-news-media threat-news-placeholder"><span>' + escapeHtml((item.feedName || "Intel").slice(0, 32)) + "</span></div>";
    const sourceHost = getSourceHost(item.articleUrl);
    const keywordText = keywordChips(item.keywords || []);
    const mitreText = mitreBadges(item.mitre || []);
    return (
      '<article class="threat-news-card">' +
        image +
        '<div class="threat-news-content">' +
          '<div class="threat-news-meta">' +
            feedTypeBadge(item.feedType) +
            '<span class="text-xs text-muted">' + escapeHtml(item.feedName || "Threat feed") + "</span>" +
            '<span class="text-xs text-muted">' + formatRelativeTimeWithTitle(item.createdAt) + "</span>" +
          "</div>" +
          '<h3 class="threat-news-title">' + escapeHtml(item.headline || "Threat intelligence article") + "</h3>" +
          '<p class="threat-news-summary">' + escapeHtml(item.summary || "Open the article for the full write-up.") + "</p>" +
          '<div class="threat-news-taxonomy">' +
            (keywordText !== '<span class="text-muted text-sm">-</span>' ? keywordText : "") +
            (mitreText || "") +
          "</div>" +
          '<div class="threat-news-actions">' +
            '<button type="button" class="btn-secondary btn-xs" data-action="view-alert" data-id="' + escapeHtml(item.alertId || item.id) + '">Open Alert</button>' +
            '<a class="btn-primary btn-xs" href="' + escapeHtml(item.articleUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(sourceHost ? "Read " + sourceHost : "Open Article") + "</a>" +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }).join("");

  applyTagColors(gridEl);
}

// ---------------------------------------------------------------------------
// MITRE ATT&CK
// ---------------------------------------------------------------------------

async function loadMitre() {
  try {
    const data = await api("/mitre");
    state.mitreOverview = data || null;
    renderMitre(data || {});
  } catch (err) {
    console.error("Failed to load MITRE overview:", err);
  }
}

function renderMitre(data) {
  const summary = data?.summary || {};
  const tactics = Array.isArray(data?.tactics) ? data.tactics : [];
  const techniques = Array.isArray(data?.techniques) ? data.techniques : [];
  const recentAlerts = Array.isArray(data?.recentAlerts) ? data.recentAlerts : [];

  const mappedAlertsEl = document.getElementById("threat-mitre-mapped-alerts");
  const tacticCountEl = document.getElementById("threat-mitre-tactic-count");
  const techniqueCountEl = document.getElementById("threat-mitre-technique-count");
  const topTechniqueEl = document.getElementById("threat-mitre-top-technique");
  if (mappedAlertsEl) mappedAlertsEl.textContent = summary.mappedAlerts ?? 0;
  if (tacticCountEl) tacticCountEl.textContent = summary.uniqueTactics ?? 0;
  if (techniqueCountEl) techniqueCountEl.textContent = summary.uniqueTechniques ?? 0;
  if (topTechniqueEl) topTechniqueEl.textContent = summary.topTechnique?.techniqueId || "-";

  const tacticsEl = document.getElementById("threat-mitre-tactics");
  if (tacticsEl) {
    tacticsEl.innerHTML = tactics.length
      ? tactics.slice(0, 12).map((item) =>
        '<div class="threat-mitre-row">' +
          '<div class="threat-mitre-row-title">' + escapeHtml(item.tactic) + "</div>" +
          '<div class="threat-mitre-row-meta">' +
            '<span class="threat-mitre-id">' + escapeHtml(item.tacticId) + "</span>" +
            '<span class="threat-mitre-count">' + escapeHtml(String(item.count)) + " alerts</span>" +
          "</div>" +
        "</div>"
      ).join("")
      : '<p class="text-sm text-muted">No ATT&CK mappings yet.</p>';
  }

  const techniquesEl = document.getElementById("threat-mitre-techniques");
  if (techniquesEl) {
    techniquesEl.innerHTML = techniques.length
      ? techniques.slice(0, 12).map((item) =>
        '<div class="threat-mitre-row">' +
          '<div class="threat-mitre-row-title">' + escapeHtml(item.technique) + "</div>" +
          '<div class="threat-mitre-row-meta">' +
            '<span class="threat-mitre-id">' + escapeHtml(item.techniqueId) + "</span>" +
            '<span class="text-xs text-muted">' + escapeHtml(item.tactic) + "</span>" +
            '<span class="threat-mitre-count">' + escapeHtml(String(item.count)) + " alerts</span>" +
          "</div>" +
        "</div>"
      ).join("")
      : '<p class="text-sm text-muted">No ATT&CK mappings yet.</p>';
  }

  const recentEl = document.getElementById("threat-mitre-recent");
  if (recentEl) {
    recentEl.innerHTML = recentAlerts.length
      ? recentAlerts.slice(0, 12).map((alert) =>
        '<button type="button" class="threat-recent-item threat-recent-item-button" data-action="view-alert" data-id="' + escapeHtml(alert.id) + '">' +
          '<div class="threat-recent-item-header">' +
            '<div class="threat-recent-item-heading">' +
              criticalityBadge(alert.criticality) +
              '<span class="threat-recent-item-title">' + escapeHtml(getAlertHeadline(alert)) + "</span>" +
            "</div>" +
            '<span class="text-xs text-muted">' + formatRelativeTimeWithTitle(alert.createdAt) + "</span>" +
          "</div>" +
          '<div class="threat-recent-item-source">' + escapeHtml(alert.feedName || "Threat feed") + "</div>" +
          '<div class="threat-news-taxonomy">' + mitreBadges(alert.mitre || []) + "</div>" +
        "</button>"
      ).join("")
      : '<p class="text-sm text-muted">No ATT&CK-mapped alerts yet.</p>';
  }
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

async function loadFeeds() {
  try {
    const data = await api("/feeds");
    state.feeds = data.feeds || [];
    renderFeeds(state.feeds);
  } catch (err) {
    console.error("Failed to load feeds:", err);
  }
}

function renderFeeds(feeds) {
  const filterText = (document.getElementById("threat-feeds-filter")?.value || "").toLowerCase();
  const filterStatus = document.getElementById("threat-feeds-status-filter")?.value || "all";

  const filtered = feeds.filter((feed) => {
    if (filterStatus === "enabled" && !feed.enabled) return false;
    if (filterStatus === "disabled" && feed.enabled) return false;
    if (filterText) {
      const haystack = (feed.name + " " + feed.url + " " + feed.feedType).toLowerCase();
      if (!haystack.includes(filterText)) return false;
    }
    return true;
  });

  const tbody = document.getElementById("threat-feeds-tbody");
  const emptyEl = document.getElementById("threat-feeds-empty");

  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  tbody.innerHTML = filtered.map((feed) => {
    const tags = Array.isArray(feed.tags) ? feed.tags : [];
    return (
      '<tr>' +
        "<td>" + escapeHtml(feed.name) + "</td>" +
        "<td>" + feedTypeBadge(feed.feedType) + "</td>" +
        '<td class="text-sm"><span title="' + escapeHtml(feed.url) + '">' + escapeHtml(truncate(feed.url, 40)) + "</span></td>" +
        "<td>" + enabledBadge(feed.enabled) + "</td>" +
        "<td>" + formatInterval(feed.fetchInterval) + "</td>" +
        "<td>" + tagChips(tags) + "</td>" +
        '<td class="text-sm">' + relativeTime(feed.lastChecked) + "</td>" +
      "</tr>"
    );
  }).join("");

  applyTagColors(tbody);
}

function updateFeedsBulkBar() {
  const bar = document.getElementById("threat-feeds-bulk-bar");
  const countEl = document.getElementById("threat-feeds-selected-count");
  if (!bar || !countEl) return;
  const count = state.selectedFeedIds.size;
  countEl.textContent = count + " selected";
  bar.classList.toggle("hidden", count === 0);
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

async function loadKeywords() {
  try {
    const data = await api("/keywords");
    state.keywords = data.keywords || [];
    renderKeywords(state.keywords);
  } catch (err) {
    console.error("Failed to load keywords:", err);
  }
}

function renderKeywords(keywords) {
  const filterText = (document.getElementById("threat-keywords-filter")?.value || "").toLowerCase();
  const filterStatus = document.getElementById("threat-keywords-status-filter")?.value || "all";

  const filtered = keywords.filter((kw) => {
    if (filterStatus === "enabled" && !kw.enabled) return false;
    if (filterStatus === "disabled" && kw.enabled) return false;
    if (filterText && !kw.keyword.toLowerCase().includes(filterText)) return false;
    return true;
  });

  const tbody = document.getElementById("threat-keywords-tbody");
  const emptyEl = document.getElementById("threat-keywords-empty");

  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  tbody.innerHTML = filtered.map((kw) => {
    const checked = state.selectedKeywordIds.has(kw.id) ? " checked" : "";
    const tags = Array.isArray(kw.tags) ? kw.tags : [];
    return (
      '<tr>' +
        '<td><input type="checkbox" class="threat-row-check" data-keyword-id="' + escapeHtml(kw.id) + '"' + checked + "></td>" +
        "<td>" + escapeHtml(kw.keyword) + "</td>" +
        "<td>" + criticalityBadge(kw.criticality) + "</td>" +
        "<td>" + (kw.isRegex ? '<span class="threat-badge threat-badge-medium">Regex</span>' : '<span class="text-muted text-sm">No</span>') + "</td>" +
        "<td>" + enabledBadge(kw.enabled) + "</td>" +
        "<td>" + tagChips(tags) + "</td>" +
        '<td class="threat-actions-cell">' +
          '<button type="button" class="btn-secondary btn-xs" data-action="toggle-keyword" data-id="' + escapeHtml(kw.id) + '">' + (kw.enabled ? "Disable" : "Enable") + "</button> " +
          '<button type="button" class="btn-secondary btn-xs" data-action="edit-keyword" data-id="' + escapeHtml(kw.id) + '">Edit</button> ' +
          '<button type="button" class="btn-danger btn-xs" data-action="delete-keyword" data-id="' + escapeHtml(kw.id) + '">Delete</button>' +
        "</td>" +
      "</tr>"
    );
  }).join("");

  applyTagColors(tbody);
  updateKeywordsBulkBar();
}

function updateKeywordsBulkBar() {
  const bar = document.getElementById("threat-keywords-bulk-bar");
  const countEl = document.getElementById("threat-keywords-selected-count");
  if (!bar || !countEl) return;
  const count = state.selectedKeywordIds.size;
  countEl.textContent = count + " selected";
  bar.classList.toggle("hidden", count === 0);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function loadTags() {
  try {
    const data = await api("/tags");
    state.tags = data.tags || [];
    renderTags(state.tags);
  } catch (err) {
    console.error("Failed to load tags:", err);
  }
}

function renderTags(tags) {
  const tbody = document.getElementById("threat-tags-tbody");
  const emptyEl = document.getElementById("threat-tags-empty");

  if (!tbody) return;

  if (!tags.length) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  tbody.innerHTML = tags.map((tag) =>
    "<tr>" +
      "<td>" + tagChips([tag]) + "</td>" +
      "<td>" + escapeHtml(tag.description || "-") + "</td>" +
      '<td><div class="threat-color-swatch" data-color="' + escapeHtml(tag.color || "#E53935") + '"></div></td>' +
      '<td class="threat-actions-cell">' +
        '<button type="button" class="btn-secondary btn-xs" data-action="edit-tag" data-id="' + escapeHtml(tag.id) + '">Edit</button> ' +
        '<button type="button" class="btn-danger btn-xs" data-action="delete-tag" data-id="' + escapeHtml(tag.id) + '">Delete</button>' +
      "</td>" +
    "</tr>"
  ).join("");

  // Apply dynamic colors via CSSOM
  applyTagColors(tbody);
  applySwatchColors(tbody);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

async function loadAlerts() {
  try {
    const params = new URLSearchParams({ limit: String(state.alertLimit), offset: String(state.alertOffset) });
    const statusFilter = document.getElementById("threat-alerts-status-filter")?.value;
    const critFilter = document.getElementById("threat-alerts-criticality-filter")?.value;

    if (statusFilter === "unread") params.set("isRead", "false");
    else if (statusFilter === "read") params.set("isRead", "true");
    if (critFilter && critFilter !== "all") params.set("criticality", critFilter);

    const data = await api("/alerts?" + params.toString());
    state.alerts = data.alerts || [];
    state.alertTotal = state.alerts.length;
    renderAlerts(state.alerts);

    // Auto-refresh every 10s
    state.autoRefreshTimer = setInterval(() => loadAlerts(), 10000);
  } catch (err) {
    console.error("Failed to load alerts:", err);
  }
}

function renderAlerts(alerts) {
  const filterText = (document.getElementById("threat-alerts-filter")?.value || "").toLowerCase();
  const critFilter = document.getElementById("threat-alerts-criticality-filter")?.value;
  const statusFilter = document.getElementById("threat-alerts-status-filter")?.value;

  const filtered = alerts.filter((alert) => {
    if (critFilter && critFilter !== "all" && alert.criticality !== critFilter) return false;
    if (statusFilter === "unread" && alert.isRead) return false;
    if (statusFilter === "read" && !alert.isRead) return false;
    if (filterText) {
      const haystack = (
        (alert.feedName || "") + " " +
        (alert.matchedContent || "") + " " +
        (alert.context || "") + " " +
        dedupeKeywordList(alert.keywords || []).map((k) => typeof k === "string" ? k : (k.keyword || "")).join(" ")
      ).toLowerCase();
      if (!haystack.includes(filterText)) return false;
    }
    return true;
  });

  const tbody = document.getElementById("threat-alerts-tbody");
  const emptyEl = document.getElementById("threat-alerts-empty");

  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    renderAlertsPagination();
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  tbody.innerHTML = filtered.map((alert) => {
    const checked = state.selectedAlertIds.has(alert.id) ? " checked" : "";
    const unreadClass = !alert.isRead ? " threat-unread-row" : "";
    const tags = Array.isArray(alert.tags) ? alert.tags : [];
    const kwList = dedupeKeywordList(alert.keywords || []);
    const contentPreview = getAlertHeadline(alert);
    const localTime = formatLocalDateTime(alert.createdAt);
    return (
      '<tr class="threat-alert-row' + unreadClass + '" data-open-alert-id="' + escapeHtml(alert.id) + '">' +
        '<td><input type="checkbox" class="threat-row-check" data-alert-id="' + escapeHtml(alert.id) + '"' + checked + "></td>" +
        "<td>" + criticalityBadge(alert.criticality) + "</td>" +
        '<td class="text-sm">' + escapeHtml(alert.feedName || "-") + "</td>" +
        "<td>" + keywordChips(kwList) + "</td>" +
        '<td class="text-sm">' + escapeHtml(truncate(contentPreview, 80)) + "</td>" +
        '<td class="text-sm" title="' + escapeHtml(localTime) + '">' + escapeHtml(relativeTime(alert.createdAt)) + "</td>" +
        "<td>" + readBadge(alert.isRead) + "</td>" +
        "<td>" + tagChips(tags) + "</td>" +
        '<td class="threat-actions-cell">' +
          '<button type="button" class="btn-secondary btn-xs" data-action="toggle-alert-read" data-id="' + escapeHtml(alert.id) + '">' + (alert.isRead ? "Mark Unread" : "Mark Read") + "</button> " +
          '<button type="button" class="btn-danger btn-xs" data-action="delete-alert" data-id="' + escapeHtml(alert.id) + '">Delete</button>' +
        "</td>" +
      "</tr>"
    );
  }).join("");

  applyTagColors(tbody);
  updateAlertsBulkBar();
  renderAlertsPagination();
}

function renderAlertsPagination() {
  const paginationEl = document.getElementById("threat-alerts-pagination");
  if (!paginationEl) return;
  const hasPrev = state.alertOffset > 0;
  const hasNext = state.alerts.length >= state.alertLimit;
  if (!hasPrev && !hasNext) {
    paginationEl.classList.add("hidden");
    return;
  }
  paginationEl.classList.remove("hidden");
  paginationEl.innerHTML =
    (hasPrev ? '<button type="button" class="btn-secondary btn-xs" data-alert-page="prev">Previous</button>' : "") +
    '<span class="text-sm text-muted">Showing ' + (state.alertOffset + 1) + " - " + (state.alertOffset + state.alerts.length) + "</span>" +
    (hasNext ? '<button type="button" class="btn-secondary btn-xs" data-alert-page="next">Next</button>' : "");
}

function updateAlertsBulkBar() {
  const bar = document.getElementById("threat-alerts-bulk-bar");
  const countEl = document.getElementById("threat-alerts-selected-count");
  if (!bar || !countEl) return;
  const count = state.selectedAlertIds.size;
  countEl.textContent = count + " selected";
  bar.classList.toggle("hidden", count === 0);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function loadNotifications() {
  try {
    const data = await api("/user-notifications");
    state.notifications = [];
    state.userNotifications = data.notifications || [];
    state.notificationPolicy = data.notificationPolicy || state.notificationPolicy || {};
    state.allowedChannels = data.allowedChannels || state.allowedChannels || [];
    state.accountEmail = data.accountEmail || state.accountEmail || "";
    renderNotifications(state.notifications);
    renderUserNotifications(state.userNotifications);
  } catch (err) {
    console.error("Failed to load notifications:", err);
  }
}

function renderNotifications(configs) {
  const container = document.getElementById("threat-notification-policy");
  if (!container) return;

  const policy = state.notificationPolicy || {};
  const cards = ["email", "webhook", "discord"].map((channelType) => {
    const config = policy[channelType] || {};
    const enabled = config.enabled !== false;
    const details = [];
    if (channelType === "email") {
      details.push(state.accountEmail ? `Uses your account email: ${state.accountEmail}` : "Uses your account email");
      if (config.fromOverride) {
        details.push(`Admin sender override: ${config.fromOverride}`);
      }
    }
    if (channelType === "webhook") {
      details.push("Users can configure their own webhook endpoint.");
    }
    if (channelType === "discord") {
      details.push("Users can configure their own Discord webhook.");
      if (config.username) {
        details.push(`Sender name: ${config.username}`);
      }
    }

    return '<div class="rounded-lg border border-primary/10 p-4">' +
      '<div class="flex flex-wrap items-center justify-between gap-3">' +
        '<div class="flex items-center gap-2">' +
          channelTypeBadge(channelType) +
          enabledBadge(enabled) +
        '</div>' +
      '</div>' +
      '<div class="text-sm text-muted mt-2">' + escapeHtml(details.join(" ")) + "</div>" +
    "</div>";
  });

  container.innerHTML = cards.join("");
}

function renderUserNotifications(notifs) {
  const container = document.getElementById("threat-user-notifs-container");
  if (!container) return;

  if (!notifs.length) {
    container.innerHTML = '<p class="text-sm text-muted">No personal notification channels configured.</p>';
    return;
  }

  container.innerHTML = '<table class="threat-table">' +
    "<thead><tr><th>Type</th><th>Destination</th><th>Status</th><th>Actions</th></tr></thead>" +
    "<tbody>" +
    notifs.map((n) =>
      "<tr>" +
        "<td>" + channelTypeBadge(n.channelType) + "</td>" +
        '<td class="text-sm">' + escapeHtml(truncate(n.channelType === "email" ? (state.accountEmail || n.destination) : n.destination, 50)) + "</td>" +
        "<td>" + enabledBadge(n.enabled) + "</td>" +
        '<td class="threat-actions-cell">' +
          '<button type="button" class="btn-secondary btn-xs" data-action="edit-user-notif" data-id="' + escapeHtml(n.id) + '">Edit</button> ' +
          '<button type="button" class="btn-danger btn-xs" data-action="delete-user-notif" data-id="' + escapeHtml(n.id) + '">Delete</button>' +
        "</td>" +
      "</tr>"
    ).join("") +
    "</tbody></table>";
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

async function loadTemplates() {
  try {
    const data = await api("/templates");
    state.templates = data.templates || [];
    renderTemplates(state.templates);
  } catch (err) {
    console.error("Failed to load templates:", err);
  }
}

function renderTemplates(templates) {
  const tbody = document.getElementById("threat-templates-tbody");
  const emptyEl = document.getElementById("threat-templates-empty");

  if (!tbody) return;

  if (!templates.length) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");

  tbody.innerHTML = templates.map((tpl) => {
    const endpoint = tpl.configuration?.endpoint || "";
    const typeLabel = tpl.isSystem ? "system" : "custom";
    const typeBadge = tpl.isSystem
      ? '<span class="threat-badge threat-badge-medium">System</span>'
      : '<span class="threat-badge threat-badge-webhook">Custom</span>';
    return (
      "<tr>" +
        "<td>" + escapeHtml(tpl.name) + "</td>" +
        '<td class="text-sm"><span title="' + escapeHtml(endpoint) + '">' + escapeHtml(truncate(endpoint, 40)) + "</span></td>" +
        "<td>" + typeBadge + "</td>" +
        "<td>" + enabledBadge(tpl.enabled) + "</td>" +
        '<td class="threat-actions-cell">' +
          '<button type="button" class="btn-secondary btn-xs" data-action="test-template" data-id="' + escapeHtml(tpl.id) + '">Test</button> ' +
          '<button type="button" class="btn-secondary btn-xs" data-action="edit-template" data-id="' + escapeHtml(tpl.id) + '">Edit</button> ' +
          (tpl.isSystem
            ? '<button type="button" class="btn-danger btn-xs" disabled title="Cannot delete system templates">Delete</button>'
            : '<button type="button" class="btn-danger btn-xs" data-action="delete-template" data-id="' + escapeHtml(tpl.id) + '">Delete</button>') +
        "</td>" +
      "</tr>"
    );
  }).join("");
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

async function loadLogs() {
  try {
    const [healthData, errorData] = await Promise.all([
      api("/health"),
      api("/feed-errors"),
    ]);
    state.feedHealth = healthData.health || null;
    state.feedErrors = errorData.errors || [];
    renderLogs(state.feedHealth, state.feedErrors);

    // Auto-refresh every 30s
    state.logsRefreshTimer = setInterval(() => loadLogs(), 30000);
  } catch (err) {
    console.error("Failed to load logs:", err);
  }
}

function renderLogs(health, feedErrors) {
  // Populate health stat cards
  const overallEl = document.getElementById("threat-log-overall-status");
  const healthyEl = document.getElementById("threat-log-healthy");
  const warningEl = document.getElementById("threat-log-warning");
  const errorEl = document.getElementById("threat-log-error");
  const disabledEl = document.getElementById("threat-log-disabled");

  const counts = health?.counts || {};
  const overall = counts.healthy > 0 && counts.error === 0 ? "OK" : (counts.error > 0 ? "Issues" : "-");

  if (overallEl) overallEl.textContent = overall;
  if (healthyEl) healthyEl.textContent = counts.healthy ?? "-";
  if (warningEl) warningEl.textContent = counts.warning ?? "-";
  if (errorEl) errorEl.textContent = counts.error ?? "-";
  if (disabledEl) disabledEl.textContent = counts.disabled ?? "-";

  // Feed status table
  const tbody = document.getElementById("threat-logs-tbody");
  if (!tbody) return;

  const errors = feedErrors || [];
  const rows = errors.length ? errors : (health?.feeds || []);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No feed status data.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((feed) => {
    const disabledClass = feed.enabled === false ? " threat-disabled-row" : "";
    const failureClass = (feed.consecutiveFailures || 0) >= 3 ? "threat-text-critical" : ((feed.consecutiveFailures || 0) >= 1 ? "threat-text-warning" : "");
    return (
      '<tr class="' + disabledClass + '">' +
        "<td>" + statusBadge(feed.status) + "</td>" +
        "<td>" + escapeHtml(feed.name) + "</td>" +
        "<td>" + feedTypeBadge(feed.feedType) + "</td>" +
        '<td class="' + failureClass + '">' + (feed.consecutiveFailures || 0) + "</td>" +
        '<td class="text-sm">' + relativeTime(feed.lastChecked) + "</td>" +
        '<td class="text-sm font-mono">' + escapeHtml(truncate(feed.lastError || "-", 60)) + "</td>" +
      "</tr>"
    );
  }).join("");
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function closeModal(name) {
  const modal = document.getElementById("threat-" + name + "-modal");
  if (modal) modal.classList.add("hidden");
}

function openModal(name) {
  const modal = document.getElementById("threat-" + name + "-modal");
  if (modal) modal.classList.remove("hidden");
}

function closeAllModals() {
  document.querySelectorAll("[data-threat-close-modal]").forEach((btn) => {
    const name = btn.dataset.threatCloseModal;
    if (name) closeModal(name);
  });
}

// --- Feed Modal ---

async function openFeedModal() {
  await showFeedAdminOnlyMessage();
}

// --- Keyword Modal ---

function openKeywordModal(keyword) {
  const titleEl = document.getElementById("threat-keyword-modal-title");
  const editIdEl = document.getElementById("threat-keyword-edit-id");
  const textEl = document.getElementById("threat-keyword-text");
  const critEl = document.getElementById("threat-keyword-criticality");
  const regexEl = document.getElementById("threat-keyword-regex");
  const caseEl = document.getElementById("threat-keyword-case");
  const enabledEl = document.getElementById("threat-keyword-enabled");
  const tagsEl = document.getElementById("threat-keyword-tags");

  if (titleEl) titleEl.textContent = keyword ? "Edit Keyword" : "Add Keyword";
  if (editIdEl) editIdEl.value = keyword ? keyword.id : "";
  if (textEl) textEl.value = keyword ? keyword.keyword : "";
  if (critEl) critEl.value = keyword ? keyword.criticality : "medium";
  if (regexEl) regexEl.checked = keyword ? keyword.isRegex : false;
  if (caseEl) caseEl.checked = keyword ? keyword.caseSensitive : false;
  if (enabledEl) enabledEl.checked = keyword ? keyword.enabled : true;

  if (tagsEl) {
    const currentTags = keyword ? (keyword.tags || []) : [];
    tagsEl.innerHTML = state.tags.map((tag) => {
      const selected = currentTags.some((t) => (t.id || t) === tag.id) ? " selected" : "";
      return '<option value="' + escapeHtml(tag.id) + '"' + selected + ">" + escapeHtml(tag.name) + "</option>";
    }).join("");
  }

  openModal("keyword");
}

// --- Tag Modal ---

function openTagModal(tag) {
  const titleEl = document.getElementById("threat-tag-modal-title");
  const editIdEl = document.getElementById("threat-tag-edit-id");
  const nameEl = document.getElementById("threat-tag-name");
  const colorEl = document.getElementById("threat-tag-color");
  const hexEl = document.getElementById("threat-tag-color-hex");
  const descEl = document.getElementById("threat-tag-desc");
  const previewEl = document.getElementById("threat-tag-preview");

  if (titleEl) titleEl.textContent = tag ? "Edit Tag" : "Add Tag";
  if (editIdEl) editIdEl.value = tag ? tag.id : "";
  if (nameEl) nameEl.value = tag ? tag.name : "";
  if (colorEl) colorEl.value = tag ? tag.color : "#E53935";
  if (hexEl) hexEl.value = tag ? tag.color : "#E53935";
  if (descEl) descEl.value = tag ? (tag.description || "") : "";
  if (previewEl) {
    const color = normalizeHexColor(tag?.color || colorEl?.value || "#E53935");
    applyDynamicClass(previewEl, "threatPreviewColorClass", `background-color:${color};`, color);
  }

  openModal("tag");
}

// --- Alert Detail Modal ---

async function openAlertDetail(alert) {
  const contentEl = document.getElementById("threat-alert-detail-content");
  if (!contentEl) return;

  // If partial data, fetch full alert
  if (!alert.iocs && (!alert.context || alert.context.length < 200)) {
    try {
      const data = await api("/alerts/" + alert.id);
      alert = data.alert || alert;
    } catch (_) { /* use what we have */ }
  }

  const iocs = alert.iocs || {};
  const hasIocs = Object.values(iocs).some((v) => Array.isArray(v) && v.length);
  const kwList = dedupeKeywordList(alert.keywords || []);
  const context = alert.context || alert.matchedContent || "";
  const tags = Array.isArray(alert.tags) ? alert.tags : [];
  const apiMeta = alert.apiMetadata || {};
  const sourceUrl = alert.articleUrl || apiMeta.link || apiMeta.sourceUrl || null;
  const hasMetaContent = apiMeta.title || apiMeta.link || apiMeta.pubDate || apiMeta.record;
  const headline = getAlertHeadline(alert);
  const mitreMatches = Array.isArray(alert.mitre) ? alert.mitre : [];
  const matchedTexts = (() => {
    const seen = new Set();
    const keywordNames = new Set(kwList.map((keyword) => String(keyword?.keyword || keyword?.text || "").trim().toLowerCase()).filter(Boolean));
    return kwList
      .map((keyword) => String(keyword?.matchedText || "").trim())
      .filter((value) => {
        const normalized = value.toLowerCase();
        if (!normalized) return false;
        if (keywordNames.has(normalized)) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .map((value) => '<span class="threat-keyword-chip">' + escapeHtml(value) + "</span>")
      .join(" ");
  })();

  contentEl.innerHTML =
    '<div class="threat-detail-section">' +
      '<h3 class="threat-detail-heading">Alert Summary</h3>' +
      '<div class="threat-detail-summary">' + escapeHtml(headline) + "</div>" +
    "</div>" +

    // Feed info
    '<div class="threat-detail-section">' +
      '<h3 class="threat-detail-heading">Feed Information</h3>' +
      '<div class="threat-detail-grid">' +
        '<span class="text-muted">Feed:</span><span>' + escapeHtml(alert.feedName || "-") + "</span>" +
        '<span class="text-muted">Type:</span><span>' + feedTypeBadge(alert.feedType) + "</span>" +
        '<span class="text-muted">Criticality:</span><span>' + criticalityBadge(alert.criticality) + "</span>" +
        '<span class="text-muted">Time:</span><span>' + escapeHtml(formatLocalDateTime(alert.createdAt)) + "</span>" +
        (sourceUrl
          ? '<span class="text-muted">Source:</span><span><a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer" class="text-accent underline">' + escapeHtml(truncate(sourceUrl, 100)) + "</a></span>"
          : "") +
      "</div>" +
    "</div>" +

    // Matched keywords
    (kwList.length
      ? '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Matched Keywords</h3>' +
          '<div class="threat-detail-keywords">' + keywordChips(kwList) + "</div>" +
          (matchedTexts ? '<div class="threat-detail-subgroup"><div class="threat-detail-subheading">Matched Text</div><div class="threat-detail-keywords">' + matchedTexts + "</div></div>" : "") +
        "</div>"
      : "") +

    // IOCs
    (hasIocs
      ? '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Indicators of Compromise</h3>' +
          '<div class="threat-detail-iocs">' + iocChips(iocs) + "</div>" +
        "</div>"
      : "") +

    // MITRE
    (mitreMatches.length
      ? '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">MITRE ATT&amp;CK Mapping</h3>' +
          '<div class="threat-detail-iocs">' + mitreBadges(mitreMatches) + "</div>" +
        "</div>"
      : "") +

    // Context
    (context
      ? '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Full Content</h3>' +
          '<div class="threat-detail-context">' + formatAlertContextHtml(context, kwList) + "</div>" +
        "</div>"
      : "") +

    // Tags
    '<div class="threat-detail-section">' +
      '<h3 class="threat-detail-heading">Tags</h3>' +
      '<div class="threat-detail-tags" id="threat-alert-detail-tags">' + tagChips(tags) + "</div>" +
    "</div>" +

    // Metadata
    (hasMetaContent
      ? '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Details</h3>' +
          '<div class="threat-detail-grid">' +
            (apiMeta.title ? '<span class="text-muted">Title:</span><span>' + escapeHtml(apiMeta.title) + "</span>" : "") +
            (apiMeta.pubDate ? '<span class="text-muted">Published:</span><span>' + escapeHtml(apiMeta.pubDate) + "</span>" : "") +
            (apiMeta.link && !sourceUrl ? '<span class="text-muted">Link:</span><span><a href="' + escapeHtml(apiMeta.link) + '" target="_blank" rel="noopener noreferrer" class="text-accent underline">' + escapeHtml(truncate(apiMeta.link, 100)) + "</a></span>" : "") +
          "</div>" +
          (apiMeta.record ? '<pre class="threat-detail-meta">' + escapeHtml(JSON.stringify(apiMeta.record, null, 2)) + "</pre>" : "") +
        "</div>"
      : "");

  // Mark alert as read
  if (!alert.isRead) {
    alert.isRead = true;
    state.alerts = state.alerts.map((item) => item.id === alert.id ? { ...item, isRead: true } : item);
    api("/alerts/" + alert.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isRead: true }),
    }).then(() => {
      if (state.currentView === "alerts") {
        renderAlerts(state.alerts);
      }
      loadDashboard();
    }).catch(() => {});
  }

  applyTagColors(contentEl);
  openModal("alert");
}

// --- Notification Modal ---

function openNotificationModal(config) {
  const titleEl = document.getElementById("threat-notif-modal-title");
  const editIdEl = document.getElementById("threat-notif-edit-id");
  const nameEl = document.getElementById("threat-notif-name");
  const typeEl = document.getElementById("threat-notif-type");
  const destEl = document.getElementById("threat-notif-dest");
  const enabledEl = document.getElementById("threat-notif-enabled");

  if (titleEl) titleEl.textContent = config ? "Edit Channel" : "Add Channel";
  if (editIdEl) editIdEl.value = config ? config.id : "";
  if (nameEl) nameEl.value = config ? config.name : "";
  if (typeEl) typeEl.value = config ? config.channelType : "webhook";
  if (destEl) destEl.value = config ? config.destination : "";
  if (enabledEl) enabledEl.checked = config ? config.enabled : true;

  // Update placeholder based on type
  function updatePlaceholder() {
    if (!destEl || !typeEl) return;
    const placeholders = {
      webhook: "https://hooks.example.com/...",
      email: "alerts@example.com",
      discord: "https://discord.com/api/webhooks/...",
    };
    destEl.placeholder = placeholders[typeEl.value] || "URL or email address";
  }
  updatePlaceholder();
  if (typeEl) typeEl.onchange = updatePlaceholder;

  openModal("notif");
}

// --- Template Modal ---

function openTemplateModal(template) {
  const titleEl = document.getElementById("threat-template-modal-title");
  const editIdEl = document.getElementById("threat-template-edit-id");
  const nameEl = document.getElementById("threat-template-name");
  const descEl = document.getElementById("threat-template-desc");
  const enabledEl = document.getElementById("threat-template-enabled");
  const configEl = document.getElementById("threat-template-config");
  const errorEl = document.getElementById("threat-template-json-error");

  if (titleEl) titleEl.textContent = template ? "Edit Template" : "Add Template";
  if (editIdEl) editIdEl.value = template ? template.id : "";
  if (nameEl) nameEl.value = template ? template.name : "";
  if (descEl) descEl.value = template ? (template.description || "") : "";
  if (enabledEl) enabledEl.checked = template ? template.enabled : true;
  if (configEl) configEl.value = template ? JSON.stringify(template.configuration || {}, null, 2) : "";
  if (errorEl) errorEl.classList.add("hidden");

  openModal("template");
}

// --- Template Test Dialog ---

async function openTemplateTestDialog(template) {
  const contentEl = document.getElementById("threat-template-test-content");
  openModal("template-test");

  if (contentEl) {
    contentEl.innerHTML = '<p class="text-muted">Running test for "' + escapeHtml(template.name) + '"...</p>';
  }

  try {
    const result = await api("/templates/" + template.id + "/test", { method: "POST" });
    if (contentEl) {
      contentEl.innerHTML =
        '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Test Result</h3>' +
          '<div class="threat-detail-grid">' +
            '<span class="text-muted">Status:</span><span class="threat-badge threat-badge-enabled">Success</span>' +
          "</div>" +
          (result.result
            ? '<pre class="threat-detail-meta mt-2">' + escapeHtml(JSON.stringify(result.result, null, 2)) + "</pre>"
            : "") +
        "</div>";
    }
  } catch (err) {
    if (contentEl) {
      contentEl.innerHTML =
        '<div class="threat-detail-section">' +
          '<h3 class="threat-detail-heading">Test Result</h3>' +
          '<div class="threat-detail-grid">' +
            '<span class="text-muted">Status:</span><span class="threat-badge threat-badge-critical">Failed</span>' +
          "</div>" +
          '<p class="text-sm text-error mt-2">' + escapeHtml(err.message) + "</p>" +
        "</div>";
    }
  }
}

// --- User Notification Modal ---

function updateUserNotificationModalState() {
  const typeEl = document.getElementById("threat-user-notif-type");
  const destEl = document.getElementById("threat-user-notif-dest");
  const helpEl = document.getElementById("threat-user-notif-help");
  const selectedType = typeEl?.value || "webhook";

  if (!destEl || !helpEl) return;

  if (selectedType === "email") {
    destEl.value = state.accountEmail || "";
    destEl.disabled = true;
    destEl.required = false;
    destEl.placeholder = state.accountEmail || "Uses your account email";
    helpEl.textContent = state.accountEmail
      ? `Email alerts will be sent to ${state.accountEmail}.`
      : "Email alerts use your account email address.";
    return;
  }

  destEl.disabled = false;
  destEl.required = true;
  if (selectedType === "discord") {
    destEl.placeholder = "https://discord.com/api/webhooks/...";
    helpEl.textContent = "Enter your Discord webhook URL.";
  } else {
    destEl.placeholder = "https://hooks.example.com/...";
    helpEl.textContent = "Enter your webhook destination.";
  }
}

function openUserNotifModal(notification) {
  const titleEl = document.getElementById("threat-user-notif-modal-title");
  const editIdEl = document.getElementById("threat-user-notif-edit-id");
  const typeEl = document.getElementById("threat-user-notif-type");
  const destEl = document.getElementById("threat-user-notif-dest");
  const enabledEl = document.getElementById("threat-user-notif-enabled");
  const allowedChannels = new Set(state.allowedChannels || []);

  if (titleEl) titleEl.textContent = notification ? "Update Personal Channel" : "Add Personal Channel";
  if (editIdEl) editIdEl.value = notification ? notification.id : "";

  if (typeEl) {
    typeEl.innerHTML = ["email", "webhook", "discord"]
      .filter((channelType) => notification?.channelType === channelType || allowedChannels.size === 0 || allowedChannels.has(channelType))
      .map((channelType) => '<option value="' + channelType + '">' + escapeHtml(channelType.charAt(0).toUpperCase() + channelType.slice(1)) + "</option>")
      .join("");
    if (!typeEl.options.length) {
      showAlertModal({ title: "Notifications Disabled", message: "No notification types are currently enabled by an administrator." });
      return;
    }
    typeEl.value = notification?.channelType || (typeEl.options[0]?.value || "webhook");
    typeEl.disabled = !!notification;
  }

  if (destEl) {
    destEl.value = notification
      ? (notification.channelType === "email" ? state.accountEmail : notification.destination || "")
      : "";
  }
  if (enabledEl) enabledEl.checked = notification ? notification.enabled !== false : true;

  updateUserNotificationModalState();
  openModal("user-notif");
}

// ---------------------------------------------------------------------------
// Form submissions
// ---------------------------------------------------------------------------

async function handleFeedFormSubmit(e) {
  e.preventDefault();
  await showFeedAdminOnlyMessage();
}

async function handleKeywordFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById("threat-keyword-edit-id")?.value;
  const body = {
    keyword: document.getElementById("threat-keyword-text")?.value || "",
    criticality: document.getElementById("threat-keyword-criticality")?.value || "medium",
    isRegex: document.getElementById("threat-keyword-regex")?.checked ?? false,
    caseSensitive: document.getElementById("threat-keyword-case")?.checked ?? false,
    enabled: document.getElementById("threat-keyword-enabled")?.checked ?? true,
    tagIds: getMultiSelectValues(document.getElementById("threat-keyword-tags")),
  };

  try {
    if (editId) {
      await api("/keywords/" + editId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    closeModal("keyword");
    loadKeywords();
  } catch (err) {
    await showAlertModal({ title: "Keyword Save Failed", message: err.message });
  }
}

async function handleTagFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById("threat-tag-edit-id")?.value;
  const body = {
    name: document.getElementById("threat-tag-name")?.value || "",
    color: document.getElementById("threat-tag-color")?.value || "#E53935",
    description: document.getElementById("threat-tag-desc")?.value || "",
  };

  try {
    if (editId) {
      await api("/tags/" + editId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    closeModal("tag");
    await loadTags();
  } catch (err) {
    await showAlertModal({ title: "Tag Save Failed", message: err.message });
  }
}

async function handleNotifFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById("threat-notif-edit-id")?.value;
  const body = {
    name: document.getElementById("threat-notif-name")?.value || "",
    channelType: document.getElementById("threat-notif-type")?.value || "webhook",
    destination: document.getElementById("threat-notif-dest")?.value || "",
    enabled: document.getElementById("threat-notif-enabled")?.checked ?? true,
  };

  try {
    if (editId) {
      await api("/notifications/" + editId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    closeModal("notif");
    loadNotifications();
  } catch (err) {
    await showAlertModal({ title: "Notification Save Failed", message: err.message });
  }
}

async function handleTemplateFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById("threat-template-edit-id")?.value;
  const configText = document.getElementById("threat-template-config")?.value || "{}";
  const errorEl = document.getElementById("threat-template-json-error");

  let configuration;
  try {
    configuration = JSON.parse(configText);
  } catch (parseErr) {
    if (errorEl) {
      errorEl.textContent = "Invalid JSON: " + parseErr.message;
      errorEl.classList.remove("hidden");
    }
    return;
  }

  if (errorEl) errorEl.classList.add("hidden");

  const body = {
    name: document.getElementById("threat-template-name")?.value || "",
    description: document.getElementById("threat-template-desc")?.value || "",
    enabled: document.getElementById("threat-template-enabled")?.checked ?? true,
    configuration,
  };

  try {
    if (editId) {
      await api("/templates/" + editId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    closeModal("template");
    loadTemplates();
  } catch (err) {
    await showAlertModal({ title: "Template Save Failed", message: err.message });
  }
}

async function handleUserNotifFormSubmit(e) {
  e.preventDefault();
  const selectedType = document.getElementById("threat-user-notif-type")?.value || "webhook";
  const body = {
    channelType: selectedType,
    destination: selectedType === "email" ? state.accountEmail : (document.getElementById("threat-user-notif-dest")?.value || ""),
    enabled: document.getElementById("threat-user-notif-enabled")?.checked ?? true,
  };

  try {
    await api("/user-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    closeModal("user-notif");
    loadNotifications();
  } catch (err) {
    await showAlertModal({ title: "Notification Save Failed", message: err.message });
  }
}

function getMultiSelectValues(select) {
  if (!select) return [];
  return [...select.options].filter((opt) => opt.selected).map((opt) => opt.value);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleAction(action, id) {
  switch (action) {
    // Feeds
    case "check-feed": {
      await showFeedAdminOnlyMessage();
      break;
    }
    case "toggle-feed": {
      await showFeedAdminOnlyMessage();
      break;
    }
    case "edit-feed": {
      await showFeedAdminOnlyMessage();
      break;
    }
    case "delete-feed": {
      await showFeedAdminOnlyMessage();
      break;
    }

    // Keywords
    case "toggle-keyword": {
      const kw = state.keywords.find((k) => k.id === id);
      if (!kw) break;
      try {
        await api("/keywords/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !kw.enabled }),
        });
        loadKeywords();
      } catch (err) {
        await showAlertModal({ title: "Keyword Update Failed", message: err.message });
      }
      break;
    }
    case "edit-keyword": {
      const kw = state.keywords.find((k) => k.id === id);
      if (kw) openKeywordModal(kw);
      break;
    }
    case "delete-keyword": {
      if (await showConfirmModal({ title: "Delete Keyword", message: "Are you sure you want to delete this keyword?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/keywords/" + id, { method: "DELETE" });
          loadKeywords();
        } catch (err) {
          await showAlertModal({ title: "Keyword Delete Failed", message: err.message });
        }
      }
      break;
    }

    // Tags
    case "edit-tag": {
      const tag = state.tags.find((t) => t.id === id);
      if (tag) openTagModal(tag);
      break;
    }
    case "delete-tag": {
      if (await showConfirmModal({ title: "Delete Tag", message: "Are you sure you want to delete this tag?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/tags/" + id, { method: "DELETE" });
          loadTags();
        } catch (err) {
          await showAlertModal({ title: "Tag Delete Failed", message: err.message });
        }
      }
      break;
    }

    // Alerts
    case "view-alert": {
      const mitreAlert = Array.isArray(state.mitreOverview?.recentAlerts)
        ? state.mitreOverview.recentAlerts.find((a) => a.id === id)
        : null;
      const newsAlert = Array.isArray(state.newsItems)
        ? state.newsItems.find((item) => item.alertId === id || item.id === id)
        : null;
      const alert = state.alerts.find((a) => a.id === id)
        || state.recentAlerts.find((a) => a.id === id)
        || mitreAlert
        || null;
      if (alert) openAlertDetail(alert);
      else if (newsAlert?.alertId) {
        openAlertDetail({ id: newsAlert.alertId });
      }
      break;
    }
    case "toggle-alert-read": {
      const alert = state.alerts.find((a) => a.id === id);
      if (!alert) break;
      try {
        await api("/alerts/" + id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: !alert.isRead }),
        });
        loadAlerts();
        loadDashboard();
      } catch (err) {
        await showAlertModal({ title: "Alert Update Failed", message: err.message });
      }
      break;
    }
    case "delete-alert": {
      if (await showConfirmModal({ title: "Delete Alert", message: "Are you sure you want to delete this alert?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/alerts/" + id, { method: "DELETE" });
          state.selectedAlertIds.delete(id);
          loadAlerts();
          loadDashboard();
        } catch (err) {
          await showAlertModal({ title: "Alert Delete Failed", message: err.message });
        }
      }
      break;
    }

    // Notifications
    case "test-notif": {
      const cfg = state.notifications.find((n) => n.id === id);
      if (!cfg) break;
      try {
        const result = await api("/notifications/" + id + "/test", { method: "POST" });
        await showAlertModal({ title: "Notification Test", message: "Test notification sent" + (result.message ? ": " + result.message : "") });
      } catch (err) {
        await showAlertModal({ title: "Notification Test Failed", message: err.message });
      }
      break;
    }
    case "edit-notif": {
      const cfg = state.notifications.find((n) => n.id === id);
      if (cfg) openNotificationModal(cfg);
      break;
    }
    case "delete-notif": {
      if (await showConfirmModal({ title: "Delete Channel", message: "Are you sure you want to delete this notification channel?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/notifications/" + id, { method: "DELETE" });
          loadNotifications();
        } catch (err) {
          await showAlertModal({ title: "Notification Delete Failed", message: err.message });
        }
      }
      break;
    }
    case "edit-user-notif": {
      const notification = state.userNotifications.find((item) => item.id === id);
      if (notification) openUserNotifModal(notification);
      break;
    }
    case "delete-user-notif": {
      if (await showConfirmModal({ title: "Delete Personal Channel", message: "Are you sure you want to delete this personal notification channel?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/user-notifications/" + id, { method: "DELETE" });
          loadNotifications();
        } catch (err) {
          await showAlertModal({ title: "Notification Delete Failed", message: err.message });
        }
      }
      break;
    }

    // Templates
    case "test-template": {
      const tpl = state.templates.find((t) => t.id === id);
      if (tpl) openTemplateTestDialog(tpl);
      break;
    }
    case "edit-template": {
      const tpl = state.templates.find((t) => t.id === id);
      if (tpl) openTemplateModal(tpl);
      break;
    }
    case "delete-template": {
      if (await showConfirmModal({ title: "Delete Template", message: "Are you sure you want to delete this template?", confirmLabel: "Delete", danger: true })) {
        try {
          await api("/templates/" + id, { method: "DELETE" });
          loadTemplates();
        } catch (err) {
          await showAlertModal({ title: "Template Delete Failed", message: err.message });
        }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

async function handleBulkAction(section, action) {
  if (section === "feeds") {
    await showFeedAdminOnlyMessage();
  } else if (section === "keywords") {
    const ids = [...state.selectedKeywordIds];
    if (!ids.length) return;

    if (action === "enable" || action === "disable") {
      const enabled = action === "enable";
      try {
        await Promise.all(ids.map((id) =>
          api("/keywords/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
          })
        ));
        state.selectedKeywordIds.clear();
        loadKeywords();
      } catch (err) {
        await showAlertModal({ title: "Bulk Keyword Update Failed", message: err.message });
      }
    } else if (action === "delete") {
      if (await showConfirmModal({ title: "Delete Keywords", message: "Delete " + ids.length + " selected keywords?", confirmLabel: "Delete", danger: true })) {
        try {
          await Promise.all(ids.map((id) => api("/keywords/" + id, { method: "DELETE" })));
          state.selectedKeywordIds.clear();
          loadKeywords();
        } catch (err) {
          await showAlertModal({ title: "Bulk Keyword Delete Failed", message: err.message });
        }
      }
    }
  } else if (section === "alerts") {
    const ids = [...state.selectedAlertIds];
    if (!ids.length) return;

    if (action === "read" || action === "unread") {
      const isRead = action === "read";
      try {
        await Promise.all(ids.map((id) =>
          api("/alerts/" + id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead }),
          })
        ));
        state.selectedAlertIds.clear();
        loadAlerts();
        loadDashboard();
      } catch (err) {
        await showAlertModal({ title: "Bulk Alert Update Failed", message: err.message });
      }
    } else if (action === "delete") {
      if (await showConfirmModal({ title: "Delete Alerts", message: "Delete " + ids.length + " selected alerts?", confirmLabel: "Delete", danger: true })) {
        try {
          await Promise.all(ids.map((id) => api("/alerts/" + id, { method: "DELETE" })));
          state.selectedAlertIds.clear();
          loadAlerts();
          loadDashboard();
        } catch (err) {
          await showAlertModal({ title: "Bulk Alert Delete Failed", message: err.message });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------

function initEvents() {
  // View switching
  document.querySelectorAll("[data-threat-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentView(button.dataset.threatView);
    });
  });

  // Modal close buttons
  document.querySelectorAll("[data-threat-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(button.dataset.threatCloseModal);
    });
  });

  // Form submissions
  const feedForm = document.getElementById("threat-feed-form");
  if (feedForm) feedForm.addEventListener("submit", handleFeedFormSubmit);

  const keywordForm = document.getElementById("threat-keyword-form");
  if (keywordForm) keywordForm.addEventListener("submit", handleKeywordFormSubmit);

  const tagForm = document.getElementById("threat-tag-form");
  if (tagForm) tagForm.addEventListener("submit", handleTagFormSubmit);

  const notifForm = document.getElementById("threat-notif-form");
  if (notifForm) notifForm.addEventListener("submit", handleNotifFormSubmit);

  const templateForm = document.getElementById("threat-template-form");
  if (templateForm) templateForm.addEventListener("submit", handleTemplateFormSubmit);

  const userNotifForm = document.getElementById("threat-user-notif-form");
  if (userNotifForm) userNotifForm.addEventListener("submit", handleUserNotifFormSubmit);
  const userNotifType = document.getElementById("threat-user-notif-type");
  if (userNotifType) userNotifType.addEventListener("change", updateUserNotificationModalState);

  // Add buttons
  const keywordAddBtn = document.getElementById("threat-keyword-add-btn");
  if (keywordAddBtn) keywordAddBtn.addEventListener("click", () => openKeywordModal());

  const tagAddBtn = document.getElementById("threat-tag-add-btn");
  if (tagAddBtn) tagAddBtn.addEventListener("click", () => openTagModal());

  const notifAddBtn = document.getElementById("threat-notif-add-btn");
  if (notifAddBtn) notifAddBtn.addEventListener("click", () => openNotificationModal());

  const templateAddBtn = document.getElementById("threat-template-add-btn");
  if (templateAddBtn) templateAddBtn.addEventListener("click", () => openTemplateModal());

  const userNotifAddBtn = document.getElementById("threat-user-notif-add-btn");
  if (userNotifAddBtn) userNotifAddBtn.addEventListener("click", openUserNotifModal);

  // Logs refresh
  const logsRefreshBtn = document.getElementById("threat-logs-refresh-btn");
  if (logsRefreshBtn) logsRefreshBtn.addEventListener("click", () => loadLogs());

  // Alert mark all read
  const readAllBtn = document.getElementById("threat-alerts-read-all-btn");
  if (readAllBtn) readAllBtn.addEventListener("click", async () => {
    try {
      await api("/alerts/read-all", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      });
      loadAlerts();
      loadDashboard();
    } catch (err) {
      await showAlertModal({ title: "Mark All Read Failed", message: err.message });
    }
  });

  // Tag modal color sync
  const tagColorEl = document.getElementById("threat-tag-color");
  const tagHexEl = document.getElementById("threat-tag-color-hex");
  const tagPreviewEl = document.getElementById("threat-tag-preview");
  if (tagColorEl && tagHexEl) {
    tagColorEl.addEventListener("input", () => {
      tagHexEl.value = tagColorEl.value;
      if (tagPreviewEl) {
        const color = normalizeHexColor(tagColorEl.value);
        applyDynamicClass(tagPreviewEl, "threatPreviewColorClass", `background-color:${color};`, color);
      }
    });
    tagHexEl.addEventListener("input", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(tagHexEl.value)) {
        tagColorEl.value = tagHexEl.value;
        if (tagPreviewEl) {
          const color = normalizeHexColor(tagHexEl.value);
          applyDynamicClass(tagPreviewEl, "threatPreviewColorClass", `background-color:${color};`, color);
        }
      }
    });
  }

  // Table action delegation (clicks on action buttons inside tbody)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn) {
      handleAction(btn.dataset.action, btn.dataset.id);
      return;
    }

    // Row checkboxes - feeds
    const feedCheck = e.target.closest('[data-feed-id].threat-row-check');
    if (feedCheck) {
      const id = feedCheck.dataset.feedId;
      if (feedCheck.checked) state.selectedFeedIds.add(id);
      else state.selectedFeedIds.delete(id);
      updateFeedsBulkBar();
      return;
    }

    // Row checkboxes - keywords
    const kwCheck = e.target.closest('[data-keyword-id].threat-row-check');
    if (kwCheck) {
      const id = kwCheck.dataset.keywordId;
      if (kwCheck.checked) state.selectedKeywordIds.add(id);
      else state.selectedKeywordIds.delete(id);
      updateKeywordsBulkBar();
      return;
    }

    // Row checkboxes - alerts
    const alertCheck = e.target.closest('[data-alert-id].threat-row-check');
    if (alertCheck) {
      const id = alertCheck.dataset.alertId;
      if (alertCheck.checked) state.selectedAlertIds.add(id);
      else state.selectedAlertIds.delete(id);
      updateAlertsBulkBar();
      return;
    }

    const openAlertRow = e.target.closest("[data-open-alert-id]");
    if (openAlertRow) {
      handleAction("view-alert", openAlertRow.dataset.openAlertId);
      return;
    }

    // Alert pagination
    const pageBtn = e.target.closest("[data-alert-page]");
    if (pageBtn) {
      if (pageBtn.dataset.alertPage === "prev") {
        state.alertOffset = Math.max(0, state.alertOffset - state.alertLimit);
      } else if (pageBtn.dataset.alertPage === "next") {
        state.alertOffset += state.alertLimit;
      }
      loadAlerts();
      return;
    }

    const iocBtn = e.target.closest("[data-ioc-value]");
    if (iocBtn) {
      const value = iocBtn.dataset.iocValue || "";
      navigator.clipboard.writeText(value)
        .then(() => showAlertModal({ title: "IOC Copied", message: "Copied: " + value }))
        .catch(() => showAlertModal({ title: "Copy Failed", message: "Clipboard access is not available right now." }));
      return;
    }
  });

  // Check-all checkboxes
  const keywordsCheckAll = document.getElementById("threat-keywords-check-all");
  if (keywordsCheckAll) {
    keywordsCheckAll.addEventListener("change", () => {
      const checked = keywordsCheckAll.checked;
      state.selectedKeywordIds.clear();
      if (checked) state.keywords.forEach((k) => state.selectedKeywordIds.add(k.id));
      renderKeywords(state.keywords);
    });
  }

  const alertsCheckAll = document.getElementById("threat-alerts-check-all");
  if (alertsCheckAll) {
    alertsCheckAll.addEventListener("change", () => {
      const checked = alertsCheckAll.checked;
      state.selectedAlertIds.clear();
      if (checked) state.alerts.forEach((a) => state.selectedAlertIds.add(a.id));
      renderAlerts(state.alerts);
    });
  }

  // Bulk action buttons (delegated)
  document.querySelectorAll("[data-threat-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.threatBulk;
      // Determine which section the button belongs to
      const feedsBar = document.getElementById("threat-feeds-bulk-bar");
      const keywordsBar = document.getElementById("threat-keywords-bulk-bar");
      const alertsBar = document.getElementById("threat-alerts-bulk-bar");

      if (feedsBar && feedsBar.contains(btn)) {
        handleBulkAction("feeds", action);
      } else if (keywordsBar && keywordsBar.contains(btn)) {
        handleBulkAction("keywords", action);
      } else if (alertsBar && alertsBar.contains(btn)) {
        handleBulkAction("alerts", action);
      }
    });
  });

  // Filter inputs
  const feedsFilter = document.getElementById("threat-feeds-filter");
  const feedsStatusFilter = document.getElementById("threat-feeds-status-filter");
  if (feedsFilter) feedsFilter.addEventListener("input", () => renderFeeds(state.feeds));
  if (feedsStatusFilter) feedsStatusFilter.addEventListener("change", () => renderFeeds(state.feeds));

  const keywordsFilter = document.getElementById("threat-keywords-filter");
  const keywordsStatusFilter = document.getElementById("threat-keywords-status-filter");
  if (keywordsFilter) keywordsFilter.addEventListener("input", () => renderKeywords(state.keywords));
  if (keywordsStatusFilter) keywordsStatusFilter.addEventListener("change", () => renderKeywords(state.keywords));

  const alertsFilter = document.getElementById("threat-alerts-filter");
  const alertsStatusFilter = document.getElementById("threat-alerts-status-filter");
  const alertsCritFilter = document.getElementById("threat-alerts-criticality-filter");
  if (alertsFilter) alertsFilter.addEventListener("input", () => renderAlerts(state.alerts));
  if (alertsStatusFilter) alertsStatusFilter.addEventListener("change", () => loadAlerts());
  if (alertsCritFilter) alertsCritFilter.addEventListener("change", () => loadAlerts());
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  setCurrentView("dashboard");
  initSidebarCollapse();
  initEvents();
  await loadBootstrap();
}

async function loadBootstrap() {
  const data = await api("/bootstrap");
  state.stats = data.stats || null;
  state.settings = data.settings || {};
  state.userNotifications = data.userNotifications || [];
  state.notificationPolicy = data.notificationPolicy || {};
  state.allowedChannels = Object.entries(state.notificationPolicy)
    .filter(([, config]) => config?.enabled !== false)
    .map(([channelType]) => channelType);
  state.accountEmail = data.accountEmail || "";
  const recentAlerts = data.recentAlerts || [];
  state.recentAlerts = recentAlerts;
  const feedHealth = data.feedHealth || null;
  state.canManage = !!data.canManage;

  // Load tags for modal dropdowns
  try {
    const tagData = await api("/tags");
    state.tags = tagData.tags || [];
  } catch (_) { /* ignore */ }

  renderDashboard(state.stats, recentAlerts, feedHealth);
}

init().catch((error) => {
  const target = document.getElementById("threat-view-dashboard");
  if (target) {
    const p = document.createElement("p");
    p.className = "text-sm text-error";
    p.textContent = error.message || "Failed to initialize threat module";
    target.prepend(p);
  }
});
