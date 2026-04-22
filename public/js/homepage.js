import { EMOJI_DATA, loadShortcuts, initShortcutModal, onShortcutChange } from "./homepage-shortcuts.js";
import { showConfirmModal } from "./confirm-modal.js";
import { loadWeather } from "./homepage-weather.js";

const TOOL_MAP = {
  paste: {
    key: "paste",
    href: "/paste",
    name: "RedSecPaste",
    shortName: "Paste",
    desc: "Encrypted text sharing",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
  },
  share: {
    key: "share",
    href: "/share",
    name: "RedSecShare",
    shortName: "Share",
    desc: "Encrypted file sharing",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.783A6 6 0 1111.41 4.283 4 4 0 017 16zm10-5a4 4 0 01-4.283 5.717A6 6 0 0111.717 4 4 4 0 0117 11z"/></svg>',
  },
  chat: {
    key: "chat",
    href: "/chat",
    name: "RedSecTeam",
    shortName: "Team",
    desc: "E2E encrypted chat",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>',
  },
  vault: {
    key: "vault",
    href: "/vault",
    name: "RedSecVault",
    shortName: "Vault",
    desc: "Credential manager",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>',
  },
  calendar: {
    key: "calendar",
    href: "/calendar",
    name: "RedSecCal",
    shortName: "Cal",
    desc: "Scheduling and utilisation",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>',
  },
  survey: {
    key: "survey",
    href: "/survey",
    name: "RedSecSurvey",
    shortName: "Survey",
    desc: "Surveys and response stats",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-6m3 6V7m3 10v-4m3 4V5M4 19h16"/></svg>',
  },
  wiki: {
    key: "wiki",
    href: "/wiki",
    name: "RedSecWiki",
    shortName: "Wiki",
    desc: "Internal documentation",
    icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5 4.186 5 1.5 6.79 1.5 9v9c0-2.21 2.686-4 6-4 1.746 0 3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c3.314 0 6 1.79 6 4v9c0-2.21-2.686-4-6-4-1.746 0-3.332.477-4.5 1.253"/></svg>',
  },
};

let authState = null;
let currentBulletinPage = 1;
let selectedToolKeys = [];
let toolsEditMode = false;
let homeDataPromise = null;
let bulletinDataPromise = null;
let shortcutsDataPromise = null;
let bulletinCapabilities = {
  canView: false,
  canCreate: false,
  canPin: false,
  canEditAny: false,
  canManage: false,
};
let switchViewFn = null;
let bulletinEditingId = null;
let bulletinEmojiCategory = "Smileys";
let pendingBulletinFocusId = null;
let savedBulletinRange = null;
let bulletinAnimationSyncFrame = null;
let activeBulletinTimeFieldId = null;
let activeBulletinTimeView = "hour";
let pendingBulletinTimeValue = null;
const BULLETIN_SLIDE_BUCKETS = [0, 12, 24, 36, 48, 64, 80, 96, 128, 160, 192, 224, 256, 320, 384, 448, 512];

async function init() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();

    if (!data.authenticated || data.guest) {
      window.location.href = "/login";
      return;
    }

    authState = data;
    hydrateBulletinCapabilitiesFromAuth();

    const greetingEl = document.getElementById("greeting-text");
    if (greetingEl && data.user?.username) {
      greetingEl.textContent = "Welcome back, " + data.user.username;
    }

    const dateEl = document.getElementById("current-date");
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    const timeEl = document.getElementById("current-time");
    if (timeEl) {
      function updateClock() {
        timeEl.textContent = new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        });
      }
      updateClock();
      setInterval(updateClock, 1000);
    }

    onShortcutChange((allShortcuts) => {
      updateSidebarFromShortcuts(allShortcuts);
      renderShortcutFavourites(allShortcuts);
    });

    applyToolVisibility();
    initShortcutModal();
    initViewSwitching();
    initSidebarCollapse();
    initSidebarToggles();
    initToolsView();
    initBulletinView();

    await ensureHomeData();
    window.setTimeout(() => {
      ensureShortcutsData().catch(() => {});
    }, 0);
  } catch {
    window.location.href = "/login";
  }
}

function applyToolVisibility() {
  const availableKeys = new Set((authState?.availableTools || []).map((tool) => tool.key));
  document.querySelectorAll("[data-tool-key]").forEach((card) => {
    card.classList.toggle("hidden", !availableKeys.has(card.dataset.toolKey));
  });
  const permissions = new Set(authState?.permissions || []);
  const bulletinAllowed = permissions.has("bulletin.view")
    || permissions.has("bulletin.create")
    || permissions.has("bulletin.edit_any")
    || permissions.has("bulletin.manage");
  document.querySelectorAll('[data-view="bulletin"]').forEach((node) => {
    node.classList.toggle("hidden", !bulletinAllowed);
  });
  const bulletinPreview = document.getElementById("bulletin-preview-list");
  if (!permissions.has("bulletin.view") && bulletinPreview) {
    const homeArea = document.getElementById("bulletin-home-area");
    if (homeArea) homeArea.classList.add("hidden");
    bulletinPreview.closest(".animate-fade-in-up")?.classList.add("hidden");
  }
}

function hydrateBulletinCapabilitiesFromAuth() {
  const permissionSet = new Set(authState?.permissions || []);
  bulletinCapabilities = {
    canView: permissionSet.has("bulletin.view"),
    canCreate: permissionSet.has("bulletin.create"),
    canPin: permissionSet.has("bulletin.pin"),
    canEditAny: permissionSet.has("bulletin.edit_any"),
    canManage: permissionSet.has("bulletin.manage"),
  };
}

function initViewSwitching() {
  const sidebarItems = document.querySelectorAll(".sidebar-nav-item[data-view]");
  const mobileTabs = document.querySelectorAll(".mobile-tab[data-view]");
  const views = document.querySelectorAll(".dashboard-view");

  async function switchView(viewId) {
    views.forEach((v) => v.classList.toggle("hidden", v.id !== `view-${viewId}`));
    sidebarItems.forEach((i) => i.classList.toggle("active", i.dataset.view === viewId));
    mobileTabs.forEach((t) => t.classList.toggle("active", t.dataset.view === viewId));
    window.scrollTo({ top: 0, behavior: "auto" });
    await ensureViewData(viewId);
  }

  switchViewFn = switchView;

  sidebarItems.forEach((item) => item.addEventListener("click", () => { switchView(item.dataset.view); }));
  mobileTabs.forEach((tab) => tab.addEventListener("click", () => { switchView(tab.dataset.view); }));
}

function initSidebarCollapse() {
  const btn = document.getElementById("sidebar-collapse-btn");
  const sidebar = document.getElementById("dashboard-sidebar");
  if (!btn || !sidebar) return;
  btn.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

function initSidebarToggles() {
  document.querySelectorAll(".sidebar-links-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".sidebar-links-section");
      if (section) section.classList.toggle("collapsed");
    });
  });
}

function updateSidebarFromShortcuts(allShortcuts) {
  const teamLinks = allShortcuts.filter((s) => s.category === "team");
  const personalLinks = allShortcuts.filter((s) => s.category !== "team");
  renderSidebarLinks("sidebar-team-links", teamLinks);
  renderSidebarLinks("sidebar-personal-links", personalLinks);
}

function renderSidebarLinks(containerId, links) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (links.length === 0) {
    container.innerHTML = '<span class="sidebar-section-empty">No links</span>';
    return;
  }

  container.innerHTML = links.map((s) => {
    const iconHtml = s.iconUrl
      ? '<img src="' + escapeHtml(s.iconUrl) + '" class="w-4 h-4 rounded" alt="">'
      : '<span class="sidebar-link-icon">' + (s.icon || "🔗") + "</span>";
    return '<a href="' + escapeHtml(s.url) + '" class="sidebar-link" target="' + (s.url.startsWith("/") ? "" : "_blank") + '" rel="noopener">' +
      iconHtml +
      escapeHtml(s.title) +
    "</a>";
  }).join("");
}

async function ensureViewData(viewId) {
  if (viewId === "home") {
    await ensureHomeData();
    return;
  }
  if (viewId === "bulletin") {
    await ensureBulletinData();
    return;
  }
  if (viewId === "shortcuts") {
    await ensureShortcutsData();
  }
}

async function ensureHomeData() {
  if (!homeDataPromise) {
    homeDataPromise = Promise.all([
      loadWeather(),
      loadHomeTabData(),
    ]);
  }
  await homeDataPromise;
}

async function ensureBulletinData() {
  if (!bulletinDataPromise) {
    bulletinDataPromise = Promise.all([
      loadBulletinFeed(true),
    ]);
  }
  await bulletinDataPromise;
}

async function ensureShortcutsData() {
  if (!shortcutsDataPromise) {
    shortcutsDataPromise = loadShortcuts();
  }
  await shortcutsDataPromise;
}

async function loadHomeTabData() {
  const data = await fetchJson("/api/homepage/home-tab");
  selectedToolKeys = Array.isArray(data.selectedTools) ? data.selectedTools : [];
  renderToolFavourites(selectedToolKeys);
  syncToolFavouriteButtons(selectedToolKeys);
  renderShortcutFavourites(data.shortcutFavourites || []);
  renderBulletinPreview(data.bulletinPreview || []);
}

function renderToolFavourites(selectedKeys) {
  const grid = document.getElementById("quick-access-tools-grid");
  if (!grid) return;
  const tools = selectedKeys.map((key) => TOOL_MAP[key]).filter(Boolean);
  grid.innerHTML = tools.length
    ? tools.map((tool) =>
      '<a href="' + tool.href + '" class="quick-tool-card">' + tool.icon +
      '<span class="quick-tool-name">' + escapeHtml(tool.shortName) + "</span>" +
      '<span class="quick-tool-desc text-muted">' + escapeHtml(tool.desc) + "</span></a>"
    ).join("")
    : '<div class="card text-sm text-muted quick-access-empty">No favourite tools selected.</div>';
}

function renderShortcutFavourites(allShortcuts) {
  const grid = document.getElementById("quick-access-shortcuts-grid");
  if (!grid) return;

  const favourites = (allShortcuts || [])
    .filter((shortcut) => (shortcut.isFavourite === undefined ? true : shortcut.isFavourite))
    .slice(0, 5);
  grid.innerHTML = favourites.length
    ? favourites.map((shortcut) => {
      const iconHtml = shortcut.iconUrl
        ? '<img src="' + escapeHtml(shortcut.iconUrl) + '" class="quick-tool-icon-image" alt="">'
        : `<span class="quick-tool-icon-emoji">${escapeHtml(shortcut.icon || "🔗")}</span>`;

      return '<a href="' + escapeHtml(shortcut.url) + '" class="quick-tool-card" target="' + (shortcut.url.startsWith("/") ? "" : "_blank") + '" rel="noopener">' +
        iconHtml +
        '<span class="quick-tool-name">' + escapeHtml(shortcut.title) + "</span>" +
        '<span class="quick-tool-desc text-muted">' + escapeHtml(shortcut.description || "Favourite shortcut") + "</span></a>";
    }).join("")
    : '<div class="card text-sm text-muted quick-access-empty">No favourite shortcuts selected.</div>';
}

function initToolsView() {
  const editBtn = document.getElementById("tools-edit-btn");
  const toolCards = document.querySelectorAll(".tool-card[data-tool-key]");
  if (!editBtn || !toolCards.length) return;

  editBtn.addEventListener("click", () => {
    toolsEditMode = !toolsEditMode;
    editBtn.textContent = toolsEditMode ? "Done" : "Edit";
    editBtn.dataset.editing = toolsEditMode ? "true" : "false";
    syncToolFavouriteButtons(selectedToolKeys);
  });

  toolCards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (!toolsEditMode) return;
      if (event.target.closest(".tool-fav-btn")) return;
      event.preventDefault();
      event.stopPropagation();
    });
  });

  document.querySelectorAll(".tool-fav-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const toolKey = button.dataset.toolFavId;
      const selectedSet = new Set(selectedToolKeys);
      if (selectedSet.has(toolKey)) {
        selectedSet.delete(toolKey);
      } else {
        if (selectedSet.size >= 5) {
          showFavLimitModal("Maximum 5 tool favourites allowed");
          return;
        }
        selectedSet.add(toolKey);
      }

      const selected = [...selectedSet];
      await fetchJson("/api/homepage/tool-favourites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected }),
      });
      selectedToolKeys = selected;
      renderToolFavourites(selectedToolKeys);
      syncToolFavouriteButtons(selectedToolKeys);
    });
  });
}

function syncToolFavouriteButtons(selectedKeys) {
  const selectedSet = new Set(selectedKeys);
  document.querySelectorAll(".tool-fav-btn").forEach((button) => {
    const active = selectedSet.has(button.dataset.toolFavId);
    button.classList.toggle("visible", toolsEditMode);
    button.classList.toggle("active", active);
    button.textContent = active ? "★" : "☆";
    button.title = active ? "Remove from favourites" : "Add to favourites";
  });
}

function renderBulletinPreview(bulletins) {
  const container = document.getElementById("bulletin-preview-list");
  if (!container) return;
  container.innerHTML = bulletins.length
    ? bulletins.map((b) => renderBulletinPreviewCard(b)).join("")
    : '<div class="card text-sm text-muted bulletin-preview-empty">No active bulletin messages.</div>';

  container.querySelectorAll(".bulletin-preview-clickable").forEach((card) => {
    card.addEventListener("click", () => {
      pendingBulletinFocusId = card.dataset.bulletinId;
      if (switchViewFn) switchViewFn("bulletin");
    });
  });
  scheduleBulletinAnimationSync();
}

function initBulletinView() {
  const loadMoreBtn = document.getElementById("bulletin-load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", async () => {
      currentBulletinPage += 1;
      await loadBulletinFeed(false);
    });
  }

  document.getElementById("bulletin-refresh-manage-btn")?.addEventListener("click", async () => {
    await loadBulletinFeed(true);
  });

  document.getElementById("bulletin-cancel-btn")?.addEventListener("click", () => {
    resetBulletinComposer();
  });

  const toggleBtn = document.querySelector(".bulletin-composer-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const composer = document.getElementById("bulletin-composer-card");
      if (!composer) return;
      const isCollapsed = composer.classList.contains("composer-collapsed");
      composer.classList.toggle("composer-collapsed", !isCollapsed);
      composer.classList.toggle("composer-expanded", isCollapsed);
    });
  }

  document.getElementById("bulletin-save-btn")?.addEventListener("click", async () => {
    await saveBulletin();
  });

  document.getElementById("bulletin-recurrence-type")?.addEventListener("change", syncBulletinScheduleFields);
  document.getElementById("bulletin-schedule-mode")?.addEventListener("change", syncBulletinScheduleFields);
  document.getElementById("bulletin-duration-preset")?.addEventListener("change", () => {
    const preset = document.getElementById("bulletin-duration-preset");
    const customWrap = document.getElementById("bulletin-duration-custom-wrap");
    if (!preset || !customWrap) return;
    if (preset.value === "custom") {
      customWrap.classList.remove("hidden");
    } else {
      customWrap.classList.add("hidden");
      document.getElementById("bulletin-duration-minutes").value = preset.value;
    }
  });
  initBulletinTimePickerModal();
  initBulletinEmojiPicker();
  initBulletinEditorTools();
  initBulletinLinkModal();
  initBulletinImageUpload();
  initBulletinEditorSelectionTracking();
  window.addEventListener("resize", scheduleBulletinAnimationSync);
  resetBulletinComposer();
  syncBulletinScheduleFields();
  syncBulletinComposerVisibility();
}

async function loadBulletinFeed(reset) {
  const feed = document.getElementById("bulletin-feed");
  if (!feed) return;
  const loadMoreBtn = document.getElementById("bulletin-load-more-btn");
  if (reset) {
    currentBulletinPage = 1;
    feed.innerHTML = '<div class="skeleton skeleton-card"></div>';
  }

  const data = await fetchJson(`/api/homepage/bulletins?page=${currentBulletinPage}&limit=20`);
  bulletinCapabilities = data.capabilities || bulletinCapabilities;
  syncBulletinComposerVisibility();

  const html = data.bulletins.length
    ? data.bulletins.map(renderBulletinCard).join("")
    : '<div class="card text-sm text-muted">No bulletin items are visible right now.</div>';
  if (reset) {
    feed.innerHTML = html;
  } else if (data.bulletins.length) {
    feed.insertAdjacentHTML("beforeend", html);
  }

  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle("hidden", !data.hasMore);
    loadMoreBtn.disabled = !data.hasMore;
  }

  scheduleBulletinAnimationSync();

  feed.querySelectorAll(".bulletin-feed-edit-btn").forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      const data = await fetchJson(`/api/homepage/bulletins/${button.dataset.bulletinId}`);
      populateBulletinComposer(data.bulletin);
      const composer = document.getElementById("bulletin-composer-card");
      if (composer) {
        composer.classList.remove("composer-collapsed");
        composer.classList.add("composer-expanded");
      }
    });
  });

  feed.querySelectorAll(".bulletin-feed-delete-btn").forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await showConfirmModal({ title: "Delete Message", message: "Delete this bulletin message?", confirmLabel: "Delete", danger: true })) return;
      await fetchJson(`/api/homepage/bulletins/${button.dataset.bulletinId}`, { method: "DELETE" });
      resetBulletinComposer();
      await refreshBulletinData();
    });
  });

  if (pendingBulletinFocusId) {
    const selectedCard = feed.querySelector(`[data-bulletin-id="${cssEscape(pendingBulletinFocusId)}"]`);
    if (selectedCard) {
      selectedCard.classList.add("bulletin-card-focus");
      selectedCard.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => selectedCard.classList.remove("bulletin-card-focus"), 1800);
      pendingBulletinFocusId = null;
    }
  }

  bulletinDataPromise = Promise.resolve();
}

function syncBulletinComposerVisibility() {
  const composer = document.getElementById("bulletin-composer-card");
  const pinFields = document.getElementById("bulletin-pin-grid");
  const canManageSurface = bulletinCapabilities.canCreate || bulletinEditingId !== null;

  if (composer) composer.classList.toggle("hidden", !canManageSurface);
  if (pinFields) pinFields.classList.toggle("hidden", !bulletinCapabilities.canPin);
}

function populateBulletinComposer(bulletin) {
  bulletinEditingId = bulletin.id;
  const composer = document.getElementById("bulletin-composer-card");
  if (composer) {
    composer.classList.remove("composer-collapsed");
    composer.classList.add("composer-expanded");
  }
  document.getElementById("bulletin-form-heading").textContent = "Edit Bulletin";
  document.getElementById("bulletin-title").value = bulletin.title || "";
  document.getElementById("bulletin-style").value = bulletin.stylePreset || "default";
  document.getElementById("bulletin-animation").value = bulletin.animationPreset || "none";

  const hasRecurrence = bulletin.recurrenceType && bulletin.recurrenceType !== "none";
  const hasSchedule = bulletin.startsAt || bulletin.endsAt;
  const mode = hasRecurrence ? "recurring" : (hasSchedule ? "once" : "always");
  document.getElementById("bulletin-schedule-mode").value = mode;

  const startsVal = bulletin.startsAt ? toDateTimeParts(bulletin.startsAt) : null;
  const endsVal = bulletin.endsAt ? toDateTimeParts(bulletin.endsAt) : null;

  if (mode === "recurring") {
    setBulletinDateTimePair("bulletin-starts-date-r", "bulletin-starts-time-r", startsVal);
    setBulletinDateTimePair("bulletin-ends-date-r", "bulletin-ends-time-r", endsVal);
    setBulletinDateTimePair("bulletin-starts-date", "bulletin-starts-time", null);
    setBulletinDateTimePair("bulletin-ends-date", "bulletin-ends-time", null);
  } else {
    setBulletinDateTimePair("bulletin-starts-date", "bulletin-starts-time", startsVal);
    setBulletinDateTimePair("bulletin-ends-date", "bulletin-ends-time", endsVal);
    setBulletinDateTimePair("bulletin-starts-date-r", "bulletin-starts-time-r", null);
    setBulletinDateTimePair("bulletin-ends-date-r", "bulletin-ends-time-r", null);
  }

  const pinEnabled = Boolean(bulletin.pinStartsAt || bulletin.pinEndsAt);
  document.getElementById("bulletin-pin-enabled").checked = pinEnabled;
  document.getElementById("bulletin-recurrence-type").value = bulletin.recurrenceType || "none";

  const recurrenceConfig = bulletin.recurrenceConfig || {};
  document.getElementById("bulletin-duration-minutes").value = recurrenceConfig.durationMinutes || 1440;
  document.querySelectorAll("[data-bulletin-weekday]").forEach((checkbox) => {
    checkbox.checked = Array.isArray(recurrenceConfig.weekdays) && recurrenceConfig.weekdays.includes(parseInt(checkbox.value, 10));
  });

  const editor = document.getElementById("bulletin-editor");
  savedBulletinRange = null;
  if (editor) {
    editor.innerHTML = bulletin.bodySource || bulletin.bodyHtml || "";
    editor.focus();
    saveBulletinSelection();
  }
  syncBulletinScheduleFields();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetBulletinComposer() {
  bulletinEditingId = null;
  const composer = document.getElementById("bulletin-composer-card");
  if (composer) {
    composer.classList.add("composer-collapsed");
    composer.classList.remove("composer-expanded");
  }
  document.getElementById("bulletin-form-heading").textContent = "Create Bulletin";
  document.getElementById("bulletin-title").value = "";
  document.getElementById("bulletin-style").value = "default";
  document.getElementById("bulletin-animation").value = "none";
  setBulletinDateTimePair("bulletin-starts-date", "bulletin-starts-time", null);
  setBulletinDateTimePair("bulletin-ends-date", "bulletin-ends-time", null);
  setBulletinDateTimePair("bulletin-starts-date-r", "bulletin-starts-time-r", null);
  setBulletinDateTimePair("bulletin-ends-date-r", "bulletin-ends-time-r", null);
  document.getElementById("bulletin-pin-enabled").checked = false;
  document.getElementById("bulletin-schedule-mode").value = "always";
  document.getElementById("bulletin-recurrence-type").value = "none";
  document.getElementById("bulletin-duration-preset").value = "1440";
  document.getElementById("bulletin-duration-minutes").value = "1440";
  document.querySelectorAll("[data-bulletin-weekday]").forEach((checkbox) => {
    checkbox.checked = false;
  });
  const editor = document.getElementById("bulletin-editor");
  if (editor) editor.innerHTML = "";
  savedBulletinRange = null;
  const result = document.getElementById("bulletin-result");
  if (result) result.classList.add("hidden");
  syncBulletinScheduleFields();
  syncBulletinComposerVisibility();
}

function syncBulletinScheduleFields() {
  const mode = document.getElementById("bulletin-schedule-mode")?.value || "always";
  const onceSection = document.getElementById("bulletin-schedule-once");
  const recurringSection = document.getElementById("bulletin-schedule-recurring");
  const pinFields = document.getElementById("bulletin-pin-grid");

  if (onceSection) onceSection.classList.toggle("hidden", mode !== "once");
  if (recurringSection) recurringSection.classList.toggle("hidden", mode !== "recurring");
  if (pinFields) pinFields.classList.toggle("hidden", !bulletinCapabilities.canPin);

  if (mode === "recurring") {
    const recurrenceType = document.getElementById("bulletin-recurrence-type")?.value || "none";
    document.getElementById("bulletin-recurrence-duration-wrap")?.classList.toggle("hidden", recurrenceType === "none");
    document.getElementById("bulletin-weekday-group")?.classList.toggle("hidden", recurrenceType !== "weekly");
  }
}

function initBulletinEditorTools() {
  const editor = document.getElementById("bulletin-editor");
  if (!editor) return;

  document.querySelectorAll("[data-bulletin-command]").forEach((button) => {
    button.addEventListener("click", () => {
      editor.focus();
      restoreBulletinSelection();
      const command = button.dataset.bulletinCommand;
      if (command === "insertUnorderedList") {
        insertBulletinList("ul");
        return;
      }
      if (command === "insertOrderedList") {
        insertBulletinList("ol");
        return;
      }
      document.execCommand(command, false, null);
      saveBulletinSelection();
    });
  });
}

function initBulletinLinkModal() {
  const trigger = document.getElementById("bulletin-link-btn");
  const modal = document.getElementById("bulletin-link-modal");
  const urlInput = document.getElementById("bulletin-link-url");
  const textInput = document.getElementById("bulletin-link-text");
  const saveBtn = document.getElementById("bulletin-link-save");
  const closeBtn = document.getElementById("bulletin-link-modal-close");
  const cancelBtn = document.getElementById("bulletin-link-cancel");
  if (!trigger || !modal || !urlInput || !textInput || !saveBtn || !closeBtn || !cancelBtn) return;

  const closeModal = () => {
    modal.classList.add("hidden");
    urlInput.value = "";
    textInput.value = "";
  };

  trigger.addEventListener("click", () => {
    saveBulletinSelection();
    textInput.value = getSelectedBulletinText();
    urlInput.value = "";
    modal.classList.remove("hidden");
    window.setTimeout(() => urlInput.focus(), 0);
  });

  saveBtn.addEventListener("click", () => {
    const normalizedUrl = normalizeBulletinLinkUrl(urlInput.value);
    if (!normalizedUrl) {
      showBulletinResult("Please enter a valid link URL.", true);
      urlInput.focus();
      return;
    }
    insertBulletinLink(normalizedUrl, textInput.value.trim());
    closeModal();
  });

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

function initBulletinTimePickerModal() {
  const modal = document.getElementById("bulletin-time-modal");
  const closeBtn = document.getElementById("bulletin-time-modal-close");
  const cancelBtn = document.getElementById("bulletin-time-cancel");
  const saveBtn = document.getElementById("bulletin-time-save");
  const heading = document.getElementById("bulletin-time-modal-heading");
  const hourDisplay = document.getElementById("bulletin-time-hour-display");
  const minuteDisplay = document.getElementById("bulletin-time-minute-display");
  const amBtn = document.getElementById("bulletin-time-am");
  const pmBtn = document.getElementById("bulletin-time-pm");
  const hourFace = document.getElementById("bulletin-clock-hour-face");
  const minuteFace = document.getElementById("bulletin-clock-minute-face");
  const hand = document.getElementById("bulletin-clock-hand");
  const triggers = document.querySelectorAll(".bulletin-time-trigger");
  if (!modal || !closeBtn || !cancelBtn || !saveBtn || !heading || !hourDisplay || !minuteDisplay || !amBtn || !pmBtn || !hourFace || !minuteFace || !hand || !triggers.length) return;

  hourFace.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    return `<button type="button" class="bulletin-clock-option" data-time-hour="${value}">${value}</button>`;
  }).join("");

  minuteFace.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const value = String(index * 5).padStart(2, "0");
    return `<button type="button" class="bulletin-clock-option bulletin-clock-minute-option" data-time-minute="${value}">${value}</button>`;
  }).join("");

  const closeModal = () => {
    modal.classList.add("hidden");
    activeBulletinTimeFieldId = null;
    activeBulletinTimeView = "hour";
    pendingBulletinTimeValue = null;
  };

  const syncDisplay = () => {
    if (!pendingBulletinTimeValue) return;
    const hour24 = parseInt(pendingBulletinTimeValue.hour24, 10) || 0;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    hourDisplay.textContent = String(hour12).padStart(2, "0");
    minuteDisplay.textContent = pendingBulletinTimeValue.minute;
    hourDisplay.classList.toggle("active", activeBulletinTimeView === "hour");
    minuteDisplay.classList.toggle("active", activeBulletinTimeView === "minute");
    amBtn.classList.toggle("active", period === "AM");
    pmBtn.classList.toggle("active", period === "PM");
    hourFace.classList.toggle("hidden", activeBulletinTimeView !== "hour");
    minuteFace.classList.toggle("hidden", activeBulletinTimeView !== "minute");

    hourFace.querySelectorAll("[data-time-hour]").forEach((button) => {
      button.classList.toggle("active", parseInt(button.dataset.timeHour, 10) === hour12);
    });
    minuteFace.querySelectorAll("[data-time-minute]").forEach((button) => {
      button.classList.toggle("active", button.dataset.timeMinute === pendingBulletinTimeValue.minute);
    });

    const minuteValue = parseInt(pendingBulletinTimeValue.minute, 10) || 0;
    hand.dataset.clockAngle = String(activeBulletinTimeView === "hour"
      ? (hour12 % 12)
      : (Math.round(minuteValue / 5) % 12));
  };

  const setPeriod = (period) => {
    if (!pendingBulletinTimeValue) return;
    let hour24 = parseInt(pendingBulletinTimeValue.hour24, 10) || 0;
    const hour12 = hour24 % 12 || 12;
    hour24 = period === "PM"
      ? (hour12 === 12 ? 12 : hour12 + 12)
      : (hour12 === 12 ? 0 : hour12);
    pendingBulletinTimeValue.hour24 = String(hour24).padStart(2, "0");
    syncDisplay();
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      activeBulletinTimeFieldId = trigger.id;
      activeBulletinTimeView = "hour";
      const defaults = getBulletinTimeDefaults(trigger.id);
      const existingMinute = trigger.dataset.minute || defaults.minute;
      const roundedMinute = String(Math.round((parseInt(existingMinute, 10) || 0) / 5) * 5).padStart(2, "0").replace(/^60$/, "55");
      pendingBulletinTimeValue = {
        hour24: trigger.dataset.hour24 || defaults.hour24,
        minute: roundedMinute,
      };
      heading.textContent = trigger.dataset.timeLabel || "Choose time";
      modal.classList.remove("hidden");
      syncDisplay();
    });
  });

  hourDisplay.addEventListener("click", () => {
    activeBulletinTimeView = "hour";
    syncDisplay();
  });

  minuteDisplay.addEventListener("click", () => {
    activeBulletinTimeView = "minute";
    syncDisplay();
  });

  amBtn.addEventListener("click", () => setPeriod("AM"));
  pmBtn.addEventListener("click", () => setPeriod("PM"));

  hourFace.addEventListener("click", (event) => {
    const button = event.target.closest("[data-time-hour]");
    if (!button || !pendingBulletinTimeValue) return;
    const selectedHour = parseInt(button.dataset.timeHour, 10);
    const currentPeriod = (parseInt(pendingBulletinTimeValue.hour24, 10) || 0) >= 12 ? "PM" : "AM";
    const hour24 = currentPeriod === "PM"
      ? (selectedHour === 12 ? 12 : selectedHour + 12)
      : (selectedHour === 12 ? 0 : selectedHour);
    pendingBulletinTimeValue.hour24 = String(hour24).padStart(2, "0");
    activeBulletinTimeView = "minute";
    syncDisplay();
  });

  minuteFace.addEventListener("click", (event) => {
    const button = event.target.closest("[data-time-minute]");
    if (!button || !pendingBulletinTimeValue) return;
    pendingBulletinTimeValue.minute = button.dataset.timeMinute;
    syncDisplay();
  });

  saveBtn.addEventListener("click", () => {
    if (!activeBulletinTimeFieldId || !pendingBulletinTimeValue) {
      closeModal();
      return;
    }
    setBulletinDateTimePair("", activeBulletinTimeFieldId, pendingBulletinTimeValue);
    closeModal();
  });

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

function initBulletinEditorSelectionTracking() {
  const editor = document.getElementById("bulletin-editor");
  if (!editor) return;

  ["mouseup", "keyup", "focus", "input"].forEach((eventName) => {
    editor.addEventListener(eventName, () => {
      saveBulletinSelection();
    });
  });

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      saveBulletinSelection();
    }
  });
}

function initBulletinEmojiPicker() {
  const trigger = document.getElementById("bulletin-emoji-btn");
  const picker = document.getElementById("bulletin-emoji-picker");
  const grid = document.getElementById("bulletin-emoji-grid");
  const categories = document.getElementById("bulletin-emoji-categories");
  if (!trigger || !picker || !grid || !categories) return;

  function renderCategory(category) {
    grid.innerHTML = "";
    (EMOJI_DATA[category] || []).forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-item";
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener("click", () => {
        insertBulletinHtmlAtCursor(emoji);
        picker.classList.add("hidden");
      });
      grid.appendChild(btn);
    });
  }

  function renderPicker() {
    categories.innerHTML = "";
    Object.keys(EMOJI_DATA).forEach((category) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-category-tab" + (category === bulletinEmojiCategory ? " active" : "");
      btn.textContent = category;
      btn.addEventListener("click", () => {
        bulletinEmojiCategory = category;
        categories.querySelectorAll(".emoji-category-tab").forEach((node) => node.classList.remove("active"));
        btn.classList.add("active");
        renderCategory(category);
      });
      categories.appendChild(btn);
    });
    renderCategory(bulletinEmojiCategory);
  }

  trigger.addEventListener("click", () => {
    if (picker.classList.contains("hidden")) {
      renderPicker();
      picker.classList.remove("hidden");
    } else {
      picker.classList.add("hidden");
    }
  });

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target) && event.target !== trigger && !trigger.contains(event.target)) {
      picker.classList.add("hidden");
    }
  });
}

function initBulletinImageUpload() {
  const input = document.getElementById("bulletin-image-upload");
  if (!input) return;
  input.addEventListener("click", () => {
    saveBulletinSelection();
  });
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    try {
      const data = await fetchJson("/api/homepage/bulletin-assets", {
        method: "POST",
        body: formData,
      });
      insertBulletinHtmlAtCursor(`<p><img src="${escapeHtml(data.asset.url)}" alt=""></p>`);
    } catch (error) {
      showBulletinResult(error.message, true);
    } finally {
      input.value = "";
    }
  });
}

function insertBulletinList(listTag) {
  const selectedText = getSelectedBulletinText();
  if (selectedText) {
    const items = selectedText.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
    const html = `<${listTag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${listTag}><p></p>`;
    insertBulletinHtmlAtCursor(html);
    return;
  }

  const editor = document.getElementById("bulletin-editor");
  if (!editor) return;
  editor.focus();
  restoreBulletinSelection();
  const selection = window.getSelection();
  let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  range.deleteContents();
  const list = document.createElement(listTag);
  const item = document.createElement("li");
  item.appendChild(document.createTextNode("\u200b"));
  list.appendChild(item);
  range.insertNode(list);

  const caretRange = document.createRange();
  caretRange.selectNodeContents(item);
  caretRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caretRange);
  saveBulletinSelection();
}

function insertBulletinLink(url, linkText) {
  const text = linkText || getSelectedBulletinText() || url;
  insertBulletinHtmlAtCursor(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
}

function insertBulletinHtmlAtCursor(html) {
  const editor = document.getElementById("bulletin-editor");
  if (!editor) return;
  editor.focus();
  restoreBulletinSelection();

  const selection = window.getSelection();
  let range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  range.deleteContents();
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const fragment = document.createDocumentFragment();
  let child = null;
  while ((child = temp.firstChild)) fragment.appendChild(child);
  range.insertNode(fragment);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  saveBulletinSelection();
}

function getSelectedBulletinText() {
  const editor = document.getElementById("bulletin-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  return selection.toString().trim();
}

function hasBulletinContent(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  const hasImage = !!div.querySelector("img");
  const text = (div.textContent || "").replace(/\u00a0/g, " ").trim();
  return hasImage || text.length > 0;
}

function saveBulletinSelection() {
  const editor = document.getElementById("bulletin-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  savedBulletinRange = range.cloneRange();
}

function restoreBulletinSelection() {
  const editor = document.getElementById("bulletin-editor");
  const selection = window.getSelection();
  if (!editor || !selection) return;
  selection.removeAllRanges();
  if (savedBulletinRange && editor.contains(savedBulletinRange.commonAncestorContainer)) {
    selection.addRange(savedBulletinRange.cloneRange());
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.addRange(range);
}

function getBulletinRecurrenceConfig() {
  const recurrenceType = document.getElementById("bulletin-recurrence-type").value;
  if (recurrenceType === "none") return null;
  const weekdays = [...document.querySelectorAll("[data-bulletin-weekday]:checked")].map((checkbox) => parseInt(checkbox.value, 10));
  return {
    interval: 1,
    durationMinutes: parseInt(document.getElementById("bulletin-duration-minutes").value, 10) || 1440,
    weekdays,
  };
}

async function saveBulletin() {
  const scheduleMode = document.getElementById("bulletin-schedule-mode")?.value || "always";
  let startsAt = null;
  let endsAt = null;
  let recurrenceType = "none";

  if (scheduleMode === "once") {
    startsAt = unixFromDateTimePair("bulletin-starts-date", "bulletin-starts-time");
    endsAt = unixFromDateTimePair("bulletin-ends-date", "bulletin-ends-time");
  } else if (scheduleMode === "recurring") {
    startsAt = unixFromDateTimePair("bulletin-starts-date-r", "bulletin-starts-time-r");
    endsAt = unixFromDateTimePair("bulletin-ends-date-r", "bulletin-ends-time-r");
    recurrenceType = document.getElementById("bulletin-recurrence-type").value;
  }

  const payload = {
    title: document.getElementById("bulletin-title").value.trim(),
    bodyHtml: document.getElementById("bulletin-editor").innerHTML,
    bodySource: document.getElementById("bulletin-editor").innerHTML,
    stylePreset: document.getElementById("bulletin-style").value,
    animationPreset: document.getElementById("bulletin-animation").value,
    startsAt,
    endsAt,
    isPinned: document.getElementById("bulletin-pin-enabled").checked,
    recurrenceType,
    recurrenceConfig: getBulletinRecurrenceConfig(),
  };

  if (!payload.title) {
    showBulletinResult("Bulletin title is required.", true);
    return;
  }
  if (!hasBulletinContent(payload.bodyHtml)) {
    showBulletinResult("Bulletin content cannot be empty.", true);
    return;
  }
  if (scheduleMode !== "always" && !startsAt) {
    showBulletinResult("Please choose both a show date and show time.", true);
    return;
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    showBulletinResult("Hide time must be after the show time.", true);
    return;
  }

  try {
    if (bulletinEditingId) {
      await fetchJson(`/api/homepage/bulletins/${bulletinEditingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      await fetchJson("/api/homepage/bulletins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    resetBulletinComposer();
    showBulletinResult("Bulletin saved.");
    await refreshBulletinData();
  } catch (error) {
    showBulletinResult(error.message, true);
  }
}

async function refreshBulletinData() {
  bulletinDataPromise = null;
  await loadHomeTabData();
  await ensureBulletinData();
}

function showBulletinResult(message, isError = false) {
  const result = document.getElementById("bulletin-result");
  if (!result) return;
  result.textContent = message;
  result.className = isError ? "text-sm text-error" : "text-sm text-accent";
  result.classList.remove("hidden");
}

function toDateInputValue(unix) {
  const date = new Date(unix * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateTimeParts(unix) {
  const value = toDateInputValue(unix);
  const [date = "", time = ""] = value.split("T");
  const [hour24 = "09", minute = "00"] = time.split(":");
  return { date, hour24, minute };
}

function getBulletinTimeDefaults(timeFieldId) {
  return timeFieldId.includes("ends")
    ? { hour24: "17", minute: "00" }
    : { hour24: "09", minute: "00" };
}

function setBulletinDateTimePair(dateId, timeFieldId, value) {
  const dateInput = document.getElementById(dateId);
  const timeButton = document.getElementById(timeFieldId);
  const defaults = getBulletinTimeDefaults(timeFieldId);
  if (dateInput) dateInput.value = value?.date || "";
  if (!timeButton) return;
  const hour24 = value?.hour24 || defaults.hour24;
  const minute = value?.minute || defaults.minute;
  timeButton.dataset.hour24 = hour24;
  timeButton.dataset.minute = minute;
  timeButton.textContent = formatBulletinTime(hour24, minute);
}

function unixFromDateTimePair(dateId, timeFieldId) {
  const dateValue = document.getElementById(dateId)?.value || "";
  const timeButton = document.getElementById(timeFieldId);
  const hourValue = timeButton?.dataset.hour24 || "00";
  const minuteValue = timeButton?.dataset.minute || "00";
  if (!dateValue) return null;
  return unixFromDateInput(`${dateValue}T${hourValue}:${minuteValue}`);
}

function formatBulletinTime(hour24, minute) {
  const numericHour = parseInt(hour24, 10) || 0;
  const period = numericHour >= 12 ? "PM" : "AM";
  const hour12 = numericHour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute || "00").padStart(2, "0")} ${period}`;
}

function unixFromDateInput(value) {
  return value ? Math.floor(new Date(value).getTime() / 1000) : null;
}

function renderBulletinPreviewCard(bulletin) {
  const styleClass = `bulletin-style-${escapeHtml(bulletin.stylePreset || "default")}`;
  const animationClass = `bulletin-anim-${escapeHtml(bulletin.animationPreset || "none")}`;
  const pinned = bulletin.isPinned ? '<span class="badge badge-red">Pinned</span>' : '';
  const previewImage = getFirstBulletinImage(bulletin.bodyHtml || "");
  const bodyText = stripHtml((bulletin.bodyHtml || "").replace(/<img\b[^>]*>/gi, " "));

  return `<button type="button" class="card bulletin-preview-card bulletin-preview-clickable ${styleClass}" data-bulletin-id="${escapeHtml(bulletin.id)}">` +
    (pinned ? '<div class="bulletin-preview-badges">' + pinned + '</div>' : '') +
    '<div class="bulletin-preview-content">' +
    (previewImage ? `<img src="${escapeHtml(previewImage)}" alt="" class="bulletin-preview-image">` : "") +
    `<div class="bulletin-animation-frame"><div class="bulletin-preview-text ${animationClass}">` +
    '<span class="bulletin-preview-title">' + escapeHtml(bulletin.title) + '</span>' +
    (bodyText ? '<span class="bulletin-preview-snippet">' + escapeHtml(bodyText) + '</span>' : "") +
    "</div></div>" +
    "</div>" +
  '</button>';
}

function renderBulletinCard(bulletin) {
  const createdAt = bulletin.sortAt || bulletin.createdAt;
  const createdLabel = createdAt ? new Date(createdAt * 1000).toLocaleString() : "";
  const styleClass = `bulletin-style-${escapeHtml(bulletin.stylePreset || "default")}`;
  const animationClass = `bulletin-anim-${escapeHtml(bulletin.animationPreset || "none")}`;
  const canEdit = bulletinCapabilities.canCreate
    && authState?.user?.id
    && bulletin.authorId === authState.user.id;
  const manageHtml = canEdit
    ? '<div class="bulletin-manage-actions">' +
      `<button type="button" class="btn-secondary text-xs bulletin-feed-edit-btn" data-bulletin-id="${escapeHtml(bulletin.id)}">Edit</button>` +
      `<button type="button" class="btn-danger text-xs bulletin-feed-delete-btn" data-bulletin-id="${escapeHtml(bulletin.id)}">Delete</button>` +
      '</div>'
    : "";
  return `
    <article class="card bulletin-card ${styleClass}">
      <div class="flex justify-between items-start gap-3 mb-3">
        <div>
          <h3 class="text-base font-semibold">${escapeHtml(bulletin.title)}</h3>
          <p class="text-xs text-muted">${escapeHtml(bulletin.authorUsername || "")}${createdLabel ? " • " + escapeHtml(createdLabel) : ""}</p>
        </div>
        <div class="flex gap-2 flex-wrap justify-end items-start">
          ${bulletin.isPinned ? '<span class="badge badge-red">Pinned</span>' : ""}
          ${bulletin.recurrenceType && bulletin.recurrenceType !== "none" ? `<span class="badge badge-gray">${escapeHtml(bulletin.recurrenceType)}</span>` : ""}
          ${manageHtml}
        </div>
      </div>
      <div class="bulletin-animation-frame">
        <div class="bulletin-body bulletin-animated-content text-sm ${animationClass}">${bulletin.bodyHtml || ""}</div>
      </div>
    </article>
  `;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

function getFirstBulletinImage(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  const image = div.querySelector("img");
  return image?.getAttribute("src") || "";
}

function normalizeBulletinLinkUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function scheduleBulletinAnimationSync() {
  if (bulletinAnimationSyncFrame) window.cancelAnimationFrame(bulletinAnimationSyncFrame);
  bulletinAnimationSyncFrame = window.requestAnimationFrame(() => {
    bulletinAnimationSyncFrame = null;
    syncBulletinAnimationMetrics();
  });
}

function syncBulletinAnimationMetrics() {
  document.querySelectorAll(".bulletin-animation-frame").forEach((frame) => {
    const animated = frame.querySelector(".bulletin-anim-slide-left-right");
    if (!animated) return;
    const frameWidth = frame.clientWidth || 0;
    const contentWidth = animated.scrollWidth || 0;
    animated.dataset.slideBucket = String(getBulletinSlideBucket(Math.max(frameWidth - contentWidth, 0) / 2));
  });
}

function getBulletinSlideBucket(distance) {
  let bucket = 0;
  for (let index = 0; index < BULLETIN_SLIDE_BUCKETS.length; index += 1) {
    if (distance >= BULLETIN_SLIDE_BUCKETS[index]) {
      bucket = index;
    } else {
      break;
    }
  }
  return bucket;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\#.;?+*~':!^$\[\]()=>|/@]/g, "\\$&");
}

init();
