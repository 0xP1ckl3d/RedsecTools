// RedSecTools — Homepage dashboard orchestrator

import { loadShortcuts, initShortcutModal, onShortcutChange } from "./homepage-shortcuts.js";
import { loadWeather } from "./homepage-weather.js";

async function init() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();

    if (!data.authenticated || data.guest) {
      window.location.href = "/login";
      return;
    }

    // Personalized greeting
    const greetingEl = document.getElementById("greeting-text");
    if (greetingEl && data.user?.username) {
      greetingEl.textContent = "Welcome back, " + data.user.username;
    }

    // Set greeting date
    const dateEl = document.getElementById("current-date");
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }

    // Ticking clock
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

    loadWeather();
    loadShortcuts();
    initShortcutModal();
    initViewSwitching();
    initSidebarCollapse();
    initSidebarToggles();

    // Live sidebar sync: update sidebar whenever shortcuts change
    onShortcutChange(updateSidebarFromShortcuts);
  } catch {
    window.location.href = "/login";
  }
}

function initViewSwitching() {
  const sidebarItems = document.querySelectorAll(".sidebar-nav-item[data-view]");
  const mobileTabs = document.querySelectorAll(".mobile-tab[data-view]");
  const views = document.querySelectorAll(".dashboard-view");

  function switchView(viewId) {
    views.forEach((v) => v.classList.toggle("hidden", v.id !== `view-${viewId}`));
    sidebarItems.forEach((i) => i.classList.toggle("active", i.dataset.view === viewId));
    mobileTabs.forEach((t) => t.classList.toggle("active", t.dataset.view === viewId));
  }

  sidebarItems.forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  mobileTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
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
  renderFavouritesInQuickAccess(allShortcuts);
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
      : '<span class="sidebar-link-icon">' + (s.icon || "🔗") + '</span>';
    return '<a href="' + escapeHtml(s.url) + '" class="sidebar-link" target="' + (s.url.startsWith("/") ? "" : "_blank") + '" rel="noopener">' +
      iconHtml +
      escapeHtml(s.title) +
    '</a>';
  }).join("");
}

function renderFavouritesInQuickAccess(allShortcuts) {
  const grid = document.getElementById("quick-access-grid");
  if (!grid) return;

  // Build the base tool cards
  const toolCards = [
    { href: "/paste", icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>', name: "Paste", desc: "Encrypted text sharing" },
    { href: "/share", icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.783A6 6 0 1111.41 4.283 4 4 0 017 16zm10-5a4 4 0 01-4.283 5.717A6 6 0 0111.717 4 4 4 0 0117 11z"/></svg>', name: "Share", desc: "Encrypted file sharing" },
    { href: "/chat", icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>', name: "Team", desc: "E2E encrypted chat" },
    { href: "/vault", icon: '<svg class="quick-tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>', name: "Vault", desc: "Credential manager" },
  ];

  const favs = allShortcuts.filter((s) => s.isFavourite);

  let html = toolCards.map((t) =>
    '<a href="' + t.href + '" class="quick-tool-card">' + t.icon +
    '<span class="quick-tool-name">' + t.name + '</span>' +
    '<span class="quick-tool-desc text-muted">' + t.desc + '</span></a>'
  ).join("");

  html += favs.map((s) => {
    const iconHtml = s.iconUrl
      ? '<img src="' + escapeHtml(s.iconUrl) + '" class="quick-tool-icon" alt="">'
      : '<span class="quick-tool-icon-emoji">' + (s.icon || "\uD83D\uDD17") + '</span>';
    return '<a href="' + escapeHtml(s.url) + '" class="quick-tool-card" target="' + (s.url.startsWith("/") ? "" : "_blank") + '" rel="noopener">' +
      iconHtml +
      '<span class="quick-tool-name">' + escapeHtml(s.title) + '</span>' +
      (s.description ? '<span class="quick-tool-desc text-muted">' + escapeHtml(s.description) + '</span>' : '') +
    '</a>';
  }).join("");

  grid.innerHTML = html;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
