import { ensureHljs, highlightCode } from "./hljs-loader.js";
import { showConfirmModal } from "./confirm-modal.js";
import { escapeHtml, stateBlock } from "./ui-components.js";

const state = {
  currentView: "team",
  currentUserId: null,
  currentUsername: null,
  settings: {
    personalSpacesEnabled: true,
    searchResultLimit: 20,
    teamHomePageId: "",
  },
  capabilities: {
    canUseWiki: false,
    canViewTeam: false,
    canViewPersonal: false,
    canCreatePersonal: false,
    canCreateTeam: false,
    canEditTeam: false,
    canManage: false,
  },
  stats: {
    total: 0,
    teamTotal: 0,
    personalTotal: 0,
    revisions: 0,
  },
  teamPages: [],
  personalPages: [],
  recentPages: [],
  selectedPageId: "",
  selectedPage: null,
  revisions: [],
  searchQuery: "",
  searchScope: "all",
  searchResults: [],
  previewTimer: null,
  searchTimer: null,
  editorSlugTouched: false,
  editorSelection: null,
  collapsedNodes: new Set(),
};

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function getCombinedPages() {
  return [...state.teamPages, ...state.personalPages];
}

function getPageById(pageId) {
  return getCombinedPages().find((page) => page.id === pageId) || null;
}

function getPagesForScope(scope) {
  return scope === "personal" ? state.personalPages : state.teamPages;
}

function formatDateTime(unix) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getCurrentWorkspaceScope() {
  return state.currentView === "personal" ? "personal" : "team";
}

function canCreateInScope(scope) {
  return scope === "personal" ? state.capabilities.canCreatePersonal : state.capabilities.canCreateTeam;
}

function canEditPage(page) {
  if (!page) return false;
  if (page.scope === "personal") {
    return state.capabilities.canCreatePersonal && page.ownerId === state.currentUserId;
  }
  return state.capabilities.canManage
    || state.capabilities.canEditTeam
    || (state.capabilities.canCreateTeam && page.authorId === state.currentUserId);
}

function getVisibleViews() {
  return [
    state.capabilities.canViewTeam && "team",
    state.settings.personalSpacesEnabled && state.capabilities.canViewPersonal && "personal",
    state.capabilities.canUseWiki && "search",
    state.capabilities.canUseWiki && "recent",
    state.capabilities.canUseWiki && "about",
  ].filter(Boolean);
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set("view", state.currentView);
  if (state.selectedPageId) {
    params.set("page", state.selectedPageId);
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", next);
}

function setCurrentView(view) {
  const visibleViews = new Set(getVisibleViews());
  state.currentView = visibleViews.has(view) ? view : (visibleViews.values().next().value || "team");
  const isAbout = state.currentView === "about";
  document.querySelectorAll("[data-wiki-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.wikiView === state.currentView);
    if (button.dataset.wikiView === "personal") {
      button.classList.toggle("hidden", !state.settings.personalSpacesEnabled || !state.capabilities.canViewPersonal);
    }
  });
  const aboutSection = document.getElementById("wiki-view-about");
  if (aboutSection) aboutSection.classList.toggle("hidden", !isAbout);
  const main = document.querySelector(".wiki-dashboard-shell .dashboard-main");
  if (main) {
    main.querySelectorAll(":scope > *:not(#wiki-view-about)").forEach((el) => {
      el.classList.toggle("hidden", isAbout);
    });
  }
  if (!isAbout) {
    renderShell();
    renderPrimaryList();
  }
  syncUrl();
}

function buildTreeHtml(pages, parentId = null, depth = 0) {
  const children = pages.filter((page) => (page.parentPageId || null) === parentId);
  if (!children.length) return "";
  return children.map((page) => {
    const childHtml = buildTreeHtml(pages, page.id, depth + 1);
    const hasChildren = childHtml.length > 0;
    const collapsed = hasChildren && state.collapsedNodes.has(page.id);
    return `
      <div class="wiki-tree-node" data-node-id="${escapeHtml(page.id)}">
        <div class="wiki-tree-row wiki-tree-depth-${Math.min(depth, 6)}" draggable="true" data-node-id="${escapeHtml(page.id)}" data-parent-id="${escapeHtml(page.parentPageId || "")}" data-sort-order="${page.sortOrder || 0}">
          <button type="button"
            class="wiki-tree-toggle${hasChildren ? "" : " wiki-tree-leaf"}"
            data-toggle-id="${escapeHtml(page.id)}"
            aria-label="${hasChildren ? (collapsed ? "Expand" : "Collapse") : ""}"
            ${hasChildren ? "" : "tabindex=\"-1\""}>&#8203;</button>
          <button type="button"
            class="wiki-tree-item${page.id === state.selectedPageId ? " active" : ""}"
            data-wiki-page-id="${escapeHtml(page.id)}">
            <span class="wiki-tree-item-title">${escapeHtml(page.title)}</span>
            <span class="wiki-tree-item-meta">${escapeHtml(page.scope === "personal" ? "Personal" : "Team")} · ${escapeHtml(page.slug)}</span>
          </button>
        </div>
        ${hasChildren ? `<div class="wiki-tree-children${collapsed ? " collapsed" : ""}">${childHtml}</div>` : ""}
      </div>
    `;
  }).join("");
}

function expandPathToPage(pageId) {
  const pages = getCombinedPages();
  const byId = new Map(pages.map((p) => [p.id, p]));
  let cursor = byId.get(pageId);
  while (cursor && cursor.parentPageId) {
    state.collapsedNodes.delete(cursor.parentPageId);
    cursor = byId.get(cursor.parentPageId);
  }
}

function renderTreeList(scope) {
  const pages = getPagesForScope(scope);
  if (!pages.length) {
    return `<div class="text-sm text-muted">${scope === "personal" ? "Your personal wiki has no pages yet." : "The team wiki has no pages yet."}</div>`;
  }
  return buildTreeHtml(pages);
}

function renderSearchResults() {
  if (!state.searchQuery.trim()) {
    return '<div class="text-sm text-muted">Search the team wiki, your personal wiki, or both to jump straight to matching pages.</div>';
  }
  if (!state.searchResults.length) {
    return '<div class="text-sm text-muted">No pages matched this search.</div>';
  }
  return state.searchResults.map((page) => `
    <button type="button" class="wiki-result-card${page.id === state.selectedPageId ? " active" : ""}" data-wiki-page-id="${escapeHtml(page.id)}">
      <div class="wiki-result-top">
        <span class="wiki-result-title">${escapeHtml(page.title)}</span>
        <span class="wiki-result-scope">${escapeHtml(page.scope === "personal" ? "Personal" : "Team")}</span>
      </div>
      <div class="wiki-result-meta">${escapeHtml(page.slug)}</div>
      <div class="wiki-result-excerpt">${escapeHtml(page.excerpt || "No summary available.")}</div>
    </button>
  `).join("");
}

function renderRecentList() {
  if (!state.recentPages.length) {
    return stateBlock("No recent wiki activity yet.");
  }
  return state.recentPages.map((page) => `
    <button type="button" class="wiki-result-card${page.id === state.selectedPageId ? " active" : ""}" data-wiki-page-id="${escapeHtml(page.id)}">
      <div class="wiki-result-top">
        <span class="wiki-result-title">${escapeHtml(page.title)}</span>
        <span class="wiki-result-scope">${escapeHtml(page.scope === "personal" ? "Personal" : "Team")}</span>
      </div>
      <div class="wiki-result-meta">Updated ${escapeHtml(formatDateTime(page.updatedAt))}</div>
      <div class="wiki-result-excerpt">${escapeHtml(page.excerpt || "No summary available.")}</div>
    </button>
  `).join("");
}

function renderPrimaryList() {
  const heading = document.getElementById("wiki-list-heading");
  const body = document.getElementById("wiki-list-body");
  const searchControls = document.getElementById("wiki-search-controls");
  if (!heading || !body || !searchControls) return;

  searchControls.classList.toggle("hidden", state.currentView !== "search");
  if (state.currentView === "search") {
    heading.textContent = "Search Results";
    body.innerHTML = renderSearchResults();
  } else if (state.currentView === "recent") {
    heading.textContent = "Recent Changes";
    body.innerHTML = renderRecentList();
  } else {
    heading.textContent = state.currentView === "personal" ? "Personal Wiki" : "Team Wiki";
    if (state.selectedPageId) expandPathToPage(state.selectedPageId);
    body.innerHTML = renderTreeList(getCurrentWorkspaceScope());
  }

  body.querySelectorAll("[data-wiki-page-id]").forEach((button) => {
    button.addEventListener("click", () => {
      loadPage(button.dataset.wikiPageId);
    });
  });

  body.querySelectorAll("[data-toggle-id]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const nodeId = toggle.dataset.toggleId;
      const node = toggle.closest(".wiki-tree-node");
      const children = node && node.querySelector(":scope > .wiki-tree-children");
      if (!children) return;
      const isCollapsed = state.collapsedNodes.has(nodeId);
      if (isCollapsed) {
        state.collapsedNodes.delete(nodeId);
        children.classList.remove("collapsed");
        toggle.classList.remove("collapsed");
      } else {
        state.collapsedNodes.add(nodeId);
        children.classList.add("collapsed");
        toggle.classList.add("collapsed");
      }
    });
  });

  initTreeDragDrop(body);
}

let wikiDragNodeId = null;
let wikiDropIndicator = null;

function clearWikiDropIndicators(body) {
  body.querySelectorAll(".wiki-drop-before, .wiki-drop-after, .wiki-drop-inside").forEach((el) => {
    el.classList.remove("wiki-drop-before", "wiki-drop-after", "wiki-drop-inside");
  });
  wikiDropIndicator = null;
}

function initTreeDragDrop(body) {
  if (body._wikiDragInit) return;
  body._wikiDragInit = true;

  body.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".wiki-tree-row[draggable]");
    if (!row) return e.preventDefault();
    wikiDragNodeId = row.dataset.nodeId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", wikiDragNodeId);
    row.closest(".wiki-tree-node").classList.add("wiki-dragging");
  });

  body.addEventListener("dragend", () => {
    if (wikiDragNodeId) {
      const node = body.querySelector(`[data-node-id="${CSS.escape(wikiDragNodeId)}"].wiki-tree-node`);
      if (node) node.classList.remove("wiki-dragging");
    }
    wikiDragNodeId = null;
    clearWikiDropIndicators(body);
  });

  body.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const row = e.target.closest(".wiki-tree-row[draggable]");
    if (!row || row.dataset.nodeId === wikiDragNodeId) return;

    clearWikiDropIndicators(body);

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (y < h * 0.25) {
      row.classList.add("wiki-drop-before");
      wikiDropIndicator = "before";
    } else if (y > h * 0.75) {
      row.classList.add("wiki-drop-after");
      wikiDropIndicator = "after";
    } else {
      row.classList.add("wiki-drop-inside");
      wikiDropIndicator = "inside";
    }
  });

  body.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".wiki-tree-row[draggable]");
    if (row && !row.contains(e.relatedTarget)) {
      row.classList.remove("wiki-drop-before", "wiki-drop-after", "wiki-drop-inside");
    }
  });

  body.addEventListener("drop", async (e) => {
    e.preventDefault();
    const targetRow = e.target.closest(".wiki-tree-row[draggable]");
    if (!targetRow || !wikiDragNodeId || !wikiDropIndicator) return;

    const targetId = targetRow.dataset.nodeId;
    if (targetId === wikiDragNodeId) return;

    const pages = getPagesForScope(getCurrentWorkspaceScope());
    const draggedPage = pages.find((p) => p.id === wikiDragNodeId);
    if (!draggedPage) return;

    const descendantIds = getDescendantIds(wikiDragNodeId, getCombinedPages(), new Set([wikiDragNodeId]));
    if (descendantIds.has(targetId)) return;

    const targetPage = pages.find((p) => p.id === targetId);
    if (!targetPage) return;

    let newParentId, newSortOrder;

    if (wikiDropIndicator === "inside") {
      newParentId = targetId;
      const children = pages.filter((p) => (p.parentPageId || null) === targetId);
      newSortOrder = children.length ? Math.max(...children.map((p) => p.sortOrder || 0)) + 1 : 0;
    } else {
      newParentId = targetPage.parentPageId || null;
      const siblings = pages.filter((p) => (p.parentPageId || null) === newParentId && p.id !== wikiDragNodeId);
      const targetSort = targetPage.sortOrder || 0;

      if (wikiDropIndicator === "before") {
        newSortOrder = targetSort;
        siblings.filter((p) => (p.sortOrder || 0) >= targetSort).forEach((p) => p._bumpSort = true);
      } else {
        newSortOrder = targetSort + 1;
        siblings.filter((p) => (p.sortOrder || 0) > targetSort).forEach((p) => p._bumpSort = true);
      }
    }

    const items = [{ id: wikiDragNodeId, parentPageId: newParentId, sortOrder: newSortOrder }];
    pages.forEach((p) => {
      if (p._bumpSort) {
        items.push({ id: p.id, parentPageId: p.parentPageId || null, sortOrder: (p.sortOrder || 0) + 1 });
        delete p._bumpSort;
      }
    });

    clearWikiDropIndicators(body);

    try {
      await fetchJson("/api/wiki/pages/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      await loadBootstrap(wikiDragNodeId);
    } catch (error) {
      console.error("Wiki reorder failed:", error);
    }
  });
}

function buildBreadcrumbs(page) {
  if (!page) return "";
  const pages = getPagesForScope(page.scope);
  const byId = new Map(pages.map((entry) => [entry.id, entry]));
  const trail = [];
  let cursor = page;
  while (cursor) {
    trail.unshift(cursor);
    cursor = cursor.parentPageId ? byId.get(cursor.parentPageId) : null;
  }
  return trail.map((entry) => `
    <button type="button" class="wiki-breadcrumb-btn" data-wiki-page-id="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</button>
  `).join('<span class="wiki-breadcrumb-sep">/</span>');
}

function buildMetaList(page) {
  if (!page) {
    return '<div class="text-sm text-muted">Page details will appear here once a page is selected.</div>';
  }
  return `
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Scope</span>
      <span class="wiki-meta-value">${escapeHtml(page.scope === "personal" ? "Personal Wiki" : "Team Wiki")}</span>
    </div>
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Slug</span>
      <span class="wiki-meta-value">${escapeHtml(page.slug)}</span>
    </div>
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Created By</span>
      <span class="wiki-meta-value">${escapeHtml(page.authorUsername || "Unknown")}</span>
    </div>
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Last Edited</span>
      <span class="wiki-meta-value">${escapeHtml(page.lastEditorUsername || page.authorUsername || "Unknown")}</span>
    </div>
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Updated</span>
      <span class="wiki-meta-value">${escapeHtml(formatDateTime(page.updatedAt))}</span>
    </div>
    <div class="wiki-meta-row">
      <span class="wiki-meta-label">Published</span>
      <span class="wiki-meta-value">${escapeHtml(formatDateTime(page.publishedAt))}</span>
    </div>
    <div class="wiki-meta-summary">
      ${escapeHtml(page.excerpt || "No summary available.")}
    </div>
  `;
}

function renderRevisions() {
  const container = document.getElementById("wiki-revisions-list");
  if (!container) return;
  if (!state.revisions.length) {
    container.innerHTML = stateBlock("No revisions yet.");
    return;
  }
  container.innerHTML = state.revisions.map((revision) => `
    <div class="wiki-revision-card">
      <div class="wiki-revision-top">
        <strong>${escapeHtml(revision.title)}</strong>
        <span class="wiki-result-meta">${escapeHtml(formatDateTime(revision.createdAt))}</span>
      </div>
      <div class="wiki-revision-meta">${escapeHtml(revision.authorUsername || "Unknown")}</div>
      ${canEditPage(state.selectedPage) ? `<button type="button" class="btn-secondary text-xs wiki-revision-restore" data-revision-id="${escapeHtml(revision.id)}">Restore</button>` : ""}
    </div>
  `).join("");

  container.querySelectorAll(".wiki-revision-restore").forEach((button) => {
    button.addEventListener("click", () => restoreRevision(button.dataset.revisionId));
  });
}

async function enhanceRenderedMarkdown(container) {
  if (!container) return;
  const codeBlocks = [...container.querySelectorAll("pre code[data-code-lang]")];
  const languages = [...new Set(codeBlocks.map((block) => block.dataset.codeLang).filter((lang) => lang && lang !== "plaintext"))];
  await Promise.all(languages.map((lang) => ensureHljs(lang).catch(() => false)));
  codeBlocks.forEach((block) => {
    const lang = block.dataset.codeLang || "plaintext";
    const highlighted = highlightCode(block.textContent || "", lang);
    if (highlighted) {
      block.innerHTML = highlighted;
    }
  });
  container.querySelectorAll('a[href^="/wiki"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "";
      const url = new URL(href, window.location.origin);
      const pageId = url.searchParams.get("page");
      if (pageId) {
        event.preventDefault();
        loadPage(pageId);
      }
    });
  });
}

async function renderSelectedPage() {
  const breadcrumbs = document.getElementById("wiki-breadcrumbs");
  const title = document.getElementById("wiki-page-title");
  const subtitle = document.getElementById("wiki-page-subtitle");
  const rendered = document.getElementById("wiki-page-rendered");
  const meta = document.getElementById("wiki-page-meta");
  if (!breadcrumbs || !title || !subtitle || !rendered || !meta) return;

  if (!state.selectedPage) {
    breadcrumbs.innerHTML = "";
    title.textContent = "Select a page";
    subtitle.textContent = "Choose a page from the wiki tree, search results, or recent changes.";
    rendered.innerHTML = '<p class="text-sm text-muted">No page selected.</p>';
    meta.innerHTML = buildMetaList(null);
    renderRevisions();
    syncToolbarActions();
    return;
  }

  breadcrumbs.innerHTML = buildBreadcrumbs(state.selectedPage);
  breadcrumbs.querySelectorAll("[data-wiki-page-id]").forEach((button) => {
    button.addEventListener("click", () => loadPage(button.dataset.wikiPageId));
  });
  title.textContent = state.selectedPage.title;
  subtitle.textContent = state.selectedPage.scope === "personal"
    ? "Personal wiki page"
    : "Team wiki page";
  rendered.innerHTML = state.selectedPage.bodyHtml || '<p class="text-sm text-muted">This page is empty.</p>';
  await enhanceRenderedMarkdown(rendered);
  meta.innerHTML = buildMetaList(state.selectedPage);
  renderRevisions();
  syncToolbarActions();
}

function renderShell() {
  const sidebarTitle = document.getElementById("wiki-sidebar-title");
  const sidebarCopy = document.getElementById("wiki-sidebar-copy");
  const sidebarStats = document.getElementById("wiki-sidebar-stats");
  const toolbarKicker = document.getElementById("wiki-toolbar-kicker");
  const toolbarHeading = document.getElementById("wiki-toolbar-heading");
  const toolbarDescription = document.getElementById("wiki-toolbar-description");

  if (state.currentView === "team") {
    sidebarTitle.textContent = "Team Wiki";
    sidebarCopy.textContent = "Shared process docs, runbooks, project knowledge, and living team documentation.";
    toolbarKicker.textContent = "Team Wiki";
    toolbarHeading.textContent = state.selectedPage?.title || "Team knowledge base";
    toolbarDescription.textContent = "Structured team pages, subpages, Markdown publishing, and revision history.";
  } else if (state.currentView === "personal") {
    sidebarTitle.textContent = "Personal Wiki";
    sidebarCopy.textContent = "Private notes, personal checklists, one-on-one prep, and individual working pages.";
    toolbarKicker.textContent = "Personal Wiki";
    toolbarHeading.textContent = state.selectedPage?.title || "Personal workspace";
    toolbarDescription.textContent = "Your own Markdown wiki space with subpages, previews, and revision history.";
  } else if (state.currentView === "search") {
    sidebarTitle.textContent = "Wiki Search";
    sidebarCopy.textContent = "Search across the visible team wiki and your personal notes from a single place.";
    toolbarKicker.textContent = "Search";
    toolbarHeading.textContent = state.searchQuery ? `Results for "${state.searchQuery}"` : "Search the wiki";
    toolbarDescription.textContent = "Jump directly to pages by title, notes, or body content.";
  } else {
    sidebarTitle.textContent = "Recent Changes";
    sidebarCopy.textContent = "Track what changed recently across the team wiki and your personal space.";
    toolbarKicker.textContent = "Recent Changes";
    toolbarHeading.textContent = "Latest wiki activity";
    toolbarDescription.textContent = "Recently updated pages ordered by freshness and ready to reopen.";
  }

  sidebarStats.innerHTML = [
    { label: "Team Pages", value: state.stats.teamTotal },
    { label: "Personal Pages", value: state.stats.personalTotal },
    { label: "Revisions", value: state.stats.revisions },
    { label: "Search Limit", value: state.settings.searchResultLimit },
  ].map((item) => `
    <div class="wiki-sidebar-stat">
      <span class="wiki-sidebar-stat-label">${escapeHtml(item.label)}</span>
      <span class="wiki-sidebar-stat-value">${escapeHtml(item.value)}</span>
    </div>
  `).join("");
}

function syncToolbarActions() {
  const selectedPage = state.selectedPage;
  const currentScope = getCurrentWorkspaceScope();
  const canCreateCurrent = canCreateInScope(currentScope);

  document.getElementById("wiki-new-page-btn")?.classList.toggle("hidden", !(state.currentView === "team" || state.currentView === "personal") || !canCreateCurrent);
  document.getElementById("wiki-new-subpage-btn")?.classList.toggle("hidden", !(state.currentView === "team" || state.currentView === "personal") || !selectedPage || selectedPage.scope !== currentScope || !canCreateCurrent);
  document.getElementById("wiki-edit-page-btn")?.classList.toggle("hidden", !selectedPage || !canEditPage(selectedPage));
  document.getElementById("wiki-delete-page-btn")?.classList.toggle("hidden", !selectedPage || !canEditPage(selectedPage));
}

function applyBootstrap(data) {
  state.currentUserId = data.currentUserId;
  state.currentUsername = data.currentUsername;
  state.settings = data.settings || state.settings;
  state.capabilities = data.capabilities || state.capabilities;
  state.stats = data.stats || state.stats;
  state.teamPages = Array.isArray(data.teamPages) ? data.teamPages : [];
  state.personalPages = Array.isArray(data.personalPages) ? data.personalPages : [];
  state.recentPages = Array.isArray(data.recentPages) ? data.recentPages : [];
  state.selectedPage = data.selectedPage || null;
  state.selectedPageId = data.selectedPage?.id || "";
  state.revisions = Array.isArray(data.revisions) ? data.revisions : [];
  if (state.selectedPage && (state.currentView === "team" || state.currentView === "personal")) {
    state.currentView = state.selectedPage.scope === "personal" ? "personal" : "team";
  }
}

async function loadBootstrap(pageId = state.selectedPageId) {
  const data = await fetchJson(`/api/wiki/bootstrap?scope=${encodeURIComponent(getCurrentWorkspaceScope())}${pageId ? `&pageId=${encodeURIComponent(pageId)}` : ""}`);
  applyBootstrap(data);
  if (!getVisibleViews().includes(state.currentView)) {
    state.currentView = getVisibleViews()[0] || "team";
  }
  setCurrentView(state.currentView);
  if (new URLSearchParams(window.location.search).get("view") === "about") {
    setCurrentView("about");
  }
  await renderSelectedPage();
}

async function loadPage(pageId) {
  const data = await fetchJson(`/api/wiki/pages/${encodeURIComponent(pageId)}`);
  state.selectedPage = data.page;
  state.selectedPageId = data.page.id;
  state.revisions = Array.isArray(data.revisions) ? data.revisions : [];
  const pageCollection = data.page.scope === "personal" ? state.personalPages : state.teamPages;
  const index = pageCollection.findIndex((page) => page.id === data.page.id);
  if (index >= 0) {
    pageCollection[index] = data.page;
  }
  await renderSelectedPage();
  syncUrl();
}

function openEditor(options = {}) {
  const page = options.page || null;
  const scope = options.scope || page?.scope || getCurrentWorkspaceScope();
  const modal = document.getElementById("wiki-editor-modal");
  const scopeSelect = document.getElementById("wiki-editor-scope");
  document.getElementById("wiki-editor-modal-title").textContent = page ? "Edit Page" : "Create Page";
  document.getElementById("wiki-editor-title").value = page?.title || "";
  document.getElementById("wiki-editor-slug").value = page?.slug || "";
  document.getElementById("wiki-editor-body").value = page?.bodyMarkdown || "";
  scopeSelect.querySelector('option[value="team"]').disabled = !state.capabilities.canCreateTeam && !page;
  scopeSelect.querySelector('option[value="personal"]').disabled = !state.capabilities.canCreatePersonal && !page;
  document.getElementById("wiki-editor-scope").value = scope;
  state.editorSlugTouched = !!page;
  modal.dataset.editingId = page?.id || "";
  modal.dataset.parentId = options.parentPageId || page?.parentPageId || "";
  scopeSelect.disabled = !!page;
  renderParentOptions(scope, page);
  document.getElementById("wiki-editor-parent").value = options.parentPageId || page?.parentPageId || "";
  modal.classList.remove("hidden");
  renderEditorPreview(true);
}

function closeEditor() {
  const modal = document.getElementById("wiki-editor-modal");
  modal.classList.add("hidden");
  modal.dataset.editingId = "";
  modal.dataset.parentId = "";
  document.getElementById("wiki-editor-msg").classList.add("hidden");
}

function openLinkModal() {
  const textarea = document.getElementById("wiki-editor-body");
  state.editorSelection = textarea ? {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  } : null;
  document.getElementById("wiki-link-modal").classList.remove("hidden");
  document.getElementById("wiki-link-label").value = "";
  document.getElementById("wiki-link-href").value = "";
}

function closeLinkModal() {
  document.getElementById("wiki-link-modal").classList.add("hidden");
}

function getDescendantIds(pageId, pages, set = new Set()) {
  pages
    .filter((page) => page.parentPageId === pageId)
    .forEach((page) => {
      if (!set.has(page.id)) {
        set.add(page.id);
        getDescendantIds(page.id, pages, set);
      }
    });
  return set;
}

function renderParentOptions(scope, editingPage = null) {
  const parentSelect = document.getElementById("wiki-editor-parent");
  const pages = getPagesForScope(scope);
  const excludeIds = editingPage ? getDescendantIds(editingPage.id, pages, new Set([editingPage.id])) : new Set();
  parentSelect.innerHTML = '<option value="">Top-level page</option>' + pages
    .filter((page) => !excludeIds.has(page.id))
    .map((page) => `<option value="${escapeHtml(page.id)}">${escapeHtml(page.title)}</option>`)
    .join("");
}

async function renderEditorPreview(immediate = false) {
  const markdown = document.getElementById("wiki-editor-body").value;
  const target = document.getElementById("wiki-editor-preview-body");
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
  }
  const run = async () => {
    try {
      const preview = await fetchJson("/api/wiki/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: markdown }),
      });
      target.innerHTML = preview.html || '<p class="text-sm text-muted">This page is empty.</p>';
      await enhanceRenderedMarkdown(target);
    } catch (error) {
      target.innerHTML = `<p class="text-sm text-error">${escapeHtml(error.message)}</p>`;
    }
  };
  if (immediate) {
    await run();
    return;
  }
  state.previewTimer = setTimeout(run, 250);
}

async function savePage() {
  const modal = document.getElementById("wiki-editor-modal");
  const editingId = modal.dataset.editingId || "";
  const title = document.getElementById("wiki-editor-title").value.trim();
  const slug = document.getElementById("wiki-editor-slug").value.trim();
  const bodyMarkdown = document.getElementById("wiki-editor-body").value;
  const scope = document.getElementById("wiki-editor-scope").value;
  const parentPageId = document.getElementById("wiki-editor-parent").value || null;
  const msg = document.getElementById("wiki-editor-msg");
  msg.classList.add("hidden");

  try {
    if (!title) {
      throw new Error("Page title is required");
    }
    const payload = {
      title,
      slug: slug || slugify(title),
      bodyMarkdown,
      scope,
      parentPageId,
    };
    if (editingId) {
      await fetchJson(`/api/wiki/pages/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.selectedPageId = editingId;
    } else {
      const created = await fetchJson("/api/wiki/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.selectedPageId = created.id;
      state.currentView = scope;
    }
    closeEditor();
    await loadBootstrap(state.selectedPageId);
  } catch (error) {
    msg.textContent = error.message;
    msg.className = "text-sm text-error";
    msg.classList.remove("hidden");
  }
}

async function deleteSelectedPage() {
  if (!state.selectedPage || !canEditPage(state.selectedPage)) return;
  if (!await showConfirmModal({
    title: "Delete Page",
    message: "This will delete this page and any subpages beneath it. This cannot be undone.",
    confirmLabel: "Delete",
    danger: true,
  })) return;
  await fetchJson(`/api/wiki/pages/${encodeURIComponent(state.selectedPage.id)}`, { method: "DELETE" });
  state.selectedPageId = "";
  state.selectedPage = null;
  await loadBootstrap();
}

async function restoreRevision(revisionId) {
  if (!state.selectedPage || !revisionId) return;
  if (!await showConfirmModal({
    title: "Restore Revision",
    message: "This will replace the current page content with this revision.",
    confirmLabel: "Restore",
  })) return;
  await fetchJson(`/api/wiki/pages/${encodeURIComponent(state.selectedPage.id)}/restore/${encodeURIComponent(revisionId)}`, {
    method: "POST",
  });
  await loadPage(state.selectedPage.id);
  await loadBootstrap(state.selectedPage.id);
}

async function runSearch() {
  state.searchQuery = document.getElementById("wiki-search-input").value.trim();
  state.searchScope = document.getElementById("wiki-search-scope").value;
  if (!state.searchQuery) {
    state.searchResults = [];
    renderShell();
    renderPrimaryList();
    return;
  }
  const data = await fetchJson(`/api/wiki/search?q=${encodeURIComponent(state.searchQuery)}&scope=${encodeURIComponent(state.searchScope)}`);
  state.searchResults = Array.isArray(data.results) ? data.results : [];
  renderShell();
  renderPrimaryList();
}

function applyMarkdownAction(action) {
  const textarea = document.getElementById("wiki-editor-body");
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || action.dataset.mdLabel || "text";
  let replacement = selected;
  if (action.dataset.mdWrap) {
    replacement = `${action.dataset.mdWrap}${selected}${action.dataset.mdWrap}`;
  } else if (action.dataset.mdPrefix) {
    replacement = `${action.dataset.mdPrefix}${selected}`;
  } else if (action.dataset.mdBlock === "code") {
    replacement = `\n\`\`\`\n${selected}\n\`\`\`\n`;
  }
  textarea.setRangeText(replacement, start, end, "end");
  textarea.focus();
  renderEditorPreview();
}

function initToolbar() {
  document.querySelectorAll(".wiki-md-btn[data-md-wrap], .wiki-md-btn[data-md-prefix], .wiki-md-btn[data-md-block]").forEach((button) => {
    button.addEventListener("click", () => applyMarkdownAction(button));
  });
}

function initEvents() {
  document.querySelectorAll("[data-wiki-view]").forEach((button) => {
    button.addEventListener("click", () => setCurrentView(button.dataset.wikiView));
  });
  document.getElementById("wiki-sidebar-collapse-btn")?.addEventListener("click", () => {
    document.getElementById("wiki-sidebar")?.classList.toggle("collapsed");
  });
  document.getElementById("wiki-list-refresh-btn")?.addEventListener("click", () => loadBootstrap(state.selectedPageId));
  document.getElementById("wiki-new-page-btn")?.addEventListener("click", () => openEditor({ scope: getCurrentWorkspaceScope() }));
  document.getElementById("wiki-new-subpage-btn")?.addEventListener("click", () => {
    if (!state.selectedPage) return;
    openEditor({ scope: state.selectedPage.scope, parentPageId: state.selectedPage.id });
  });
  document.getElementById("wiki-edit-page-btn")?.addEventListener("click", () => {
    if (state.selectedPage) openEditor({ page: state.selectedPage });
  });
  document.getElementById("wiki-delete-page-btn")?.addEventListener("click", deleteSelectedPage);
  document.getElementById("wiki-editor-close")?.addEventListener("click", closeEditor);
  document.getElementById("wiki-editor-cancel")?.addEventListener("click", closeEditor);
  document.getElementById("wiki-editor-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "wiki-editor-modal") closeEditor();
  });
  document.getElementById("wiki-editor-save")?.addEventListener("click", savePage);
  document.getElementById("wiki-editor-title")?.addEventListener("input", (event) => {
    if (!state.editorSlugTouched) {
      document.getElementById("wiki-editor-slug").value = slugify(event.target.value);
    }
  });
  document.getElementById("wiki-editor-slug")?.addEventListener("input", () => {
    state.editorSlugTouched = true;
  });
  document.getElementById("wiki-editor-body")?.addEventListener("input", () => renderEditorPreview());
  document.getElementById("wiki-editor-scope")?.addEventListener("change", (event) => {
    renderParentOptions(event.target.value);
  });
  document.getElementById("wiki-search-input")?.addEventListener("input", () => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      runSearch().catch((error) => {
        document.getElementById("wiki-list-body").innerHTML = `<div class="text-sm text-error">${escapeHtml(error.message)}</div>`;
      });
    }, 250);
  });
  document.getElementById("wiki-search-scope")?.addEventListener("change", () => runSearch());
  document.getElementById("wiki-insert-link-btn")?.addEventListener("click", openLinkModal);
  document.getElementById("wiki-link-close")?.addEventListener("click", closeLinkModal);
  document.getElementById("wiki-link-cancel")?.addEventListener("click", closeLinkModal);
  document.getElementById("wiki-link-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "wiki-link-modal") closeLinkModal();
  });
  document.getElementById("wiki-link-save")?.addEventListener("click", () => {
    const label = document.getElementById("wiki-link-label").value.trim() || "Link";
    const href = document.getElementById("wiki-link-href").value.trim() || "/wiki";
    const textarea = document.getElementById("wiki-editor-body");
    const insertion = `[${label}](${href})`;
    const start = state.editorSelection?.start ?? textarea.selectionStart;
    const end = state.editorSelection?.end ?? textarea.selectionEnd;
    textarea.setRangeText(insertion, start, end, "end");
    textarea.focus();
    state.editorSelection = null;
    closeLinkModal();
    renderEditorPreview();
  });
}

async function init() {
  initToolbar();
  initEvents();
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  if (requestedView) {
    state.currentView = requestedView;
  }
  state.selectedPageId = params.get("page") || "";
  await loadBootstrap(state.selectedPageId);
}

init().catch((error) => {
  const target = document.getElementById("wiki-list-body");
  if (target) {
    target.innerHTML = `<div class="text-sm text-error">${escapeHtml(error.message)}</div>`;
  }
});
