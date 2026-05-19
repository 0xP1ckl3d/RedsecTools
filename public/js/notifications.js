// Shared notification component — mounts a bell icon and dropdown panel
// Include this after the header on authenticated pages.
// Requires: <link rel="stylesheet" href="/css/notifications.css">
// Container: add <div id="notification-container" class="notification-container"></div> inside the header.

(function () {
  "use strict";

  const uiReady = import("/js/ui-components.js");

  const NOTIFICATION_ICONS = {
    bell: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>',
  };

  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  let unreadCount = 0;
  let panelOpen = false;
  let loadedNotifications = [];

  function getOrCreateContainer() {
    let container = document.getElementById("notification-container");
    if (!container) {
      const header = document.querySelector(".dashboard-header .flex.items-center.gap-2");
      if (!header) return null;
      container = document.createElement("div");
      container.id = "notification-container";
      container.className = "relative";
      header.insertBefore(container, header.firstChild);
    }
    return container;
  }

  function timeAgo(ts) {
    const seconds = Math.floor(Date.now() / 1000) - ts;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }

  function renderBell(container) {
    container.innerHTML = `
      <button type="button" class="notification-bell" id="notification-bell" aria-label="Notifications">
        ${NOTIFICATION_ICONS.bell}
        <span class="notification-badge" id="notification-badge" data-count="0"></span>
      </button>
      <div class="notification-panel hidden" id="notification-panel">
        <div class="notification-panel-header">
          <span>Notifications</span>
          <button type="button" id="notification-mark-all-read">Mark all read</button>
        </div>
        <div class="notification-list" id="notification-list"></div>
      </div>
    `;
  }

  function updateBadge(count) {
    unreadCount = count;
    const badge = document.getElementById("notification-badge");
    if (badge) {
      badge.textContent = count > 99 ? "99+" : count > 0 ? String(count) : "";
      badge.dataset.count = String(count);
    }
  }

  function renderNotifications(notifications) {
    loadedNotifications = notifications;
    const list = document.getElementById("notification-list");
    if (!list) return;

    if (notifications.length === 0) {
      list.innerHTML = '<div class="notification-empty">No notifications</div>';
      return;
    }

    list.innerHTML = notifications.map((n) => `
      <div class="notification-item ${n.read_at ? "" : "unread"}" data-id="${n.id}">
        <div class="notification-item-title">
          <span class="notification-severity ${n.severity}"></span>
          ${window.RedSecUI.escapeHtml(n.title)}
        </div>
        ${n.body ? `<div class="notification-item-body">${window.RedSecUI.escapeHtml(n.body)}</div>` : ""}
        <div class="notification-item-meta">
          <span class="notification-item-time">${timeAgo(n.created_at)}</span>
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".notification-item").forEach((item) => {
      item.addEventListener("click", () => handleNotificationClick(item.dataset.id));
    });
  }

  async function handleNotificationClick(id) {
    const notification = loadedNotifications.find((n) => n.id === id);
    if (!notification) return;

    if (!notification.read_at) {
      try {
        await fetch(`/api/notifications/${id}/read`, { method: "POST" });
        notification.read_at = Math.floor(Date.now() / 1000);
        updateBadge(Math.max(0, unreadCount - 1));
        renderNotifications(loadedNotifications);
      } catch {
        // Silently fail
      }
    }

    if (notification.link_url) {
      window.location.href = notification.link_url;
    }
  }

  async function markAllRead() {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) return;
      updateBadge(0);
      renderNotifications(loadedNotifications.map((n) => ({ ...n, read_at: n.read_at || Math.floor(Date.now() / 1000) })));
    } catch {
      // Silently fail
    }
  }

  async function fetchNotifications() {
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (!res.ok) return;
      const data = await res.json();
      updateBadge(data.unreadCount || 0);
      renderNotifications(data.notifications || []);
    } catch {
      // Silently fail
    }
  }

  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/ws/notifications`);

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "notification") {
          loadedNotifications.unshift(msg.notification);
          if (loadedNotifications.length > 30) loadedNotifications.pop();
          renderNotifications(loadedNotifications);
          updateBadge(unreadCount + 1);
        } else if (msg.type === "unread_count") {
          updateBadge(msg.count);
        }
      } catch {
        // Ignore
      }
    });

    ws.addEventListener("close", () => {
      ws = null;
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
        setTimeout(connectWebSocket, delay);
      }
    });

    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
    });
  }

  function togglePanel() {
    const panel = document.getElementById("notification-panel");
    if (!panel) return;
    panelOpen = !panelOpen;
    panel.classList.toggle("hidden", !panelOpen);
  }

  async function initNotifications() {
    await uiReady;
    const container = getOrCreateContainer();
    if (!container) return;

    renderBell(container);

    const bell = document.getElementById("notification-bell");
    if (bell) {
      bell.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanel();
        if (panelOpen) fetchNotifications();
      });
    }

    const markAllBtn = document.getElementById("notification-mark-all-read");
    if (markAllBtn) {
      markAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        markAllRead();
      });
    }

    document.addEventListener("click", (e) => {
      const panel = document.getElementById("notification-panel");
      const bell = document.getElementById("notification-bell");
      if (panel && panelOpen && !panel.contains(e.target) && bell && !bell.contains(e.target)) {
        panelOpen = false;
        panel.classList.add("hidden");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panelOpen) {
        const panel = document.getElementById("notification-panel");
        if (panel) {
          panelOpen = false;
          panel.classList.add("hidden");
        }
      }
    });

    fetchNotifications();
    connectWebSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNotifications);
  } else {
    initNotifications();
  }
})();
