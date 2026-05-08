const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

const state = {
  currentView: "personal",
  weekStart: getStartOfWeekUnix(),
  scheduleView: "week",
  capabilities: {
    canView: false,
    canCreate: false,
    canViewTeam: false,
    canAssignOthers: false,
    canManageProjects: false,
    canEditAny: false,
  },
  settings: {
    dailyHours: 7.6,
    workdayStart: "08:30",
    workdayEnd: "17:30",
    workdays: [1, 2, 3, 4, 5],
  },
  currentUserId: null,
  selectedUserId: null,
  availableUsers: [],
  scheduleEntries: [],
  teamProjectEntries: [],
  projects: [],
  overviewStats: null,
  statsPeriod: "week",
  statsScope: "team",
  statsAnchor: getStartOfWeekUnix(),
  statsData: null,
  editingEntryId: null,
  editingProjectId: null,
  entryModalReadOnly: false,
  entryAutoEnd: true,
  entryLastProjectId: "",
  activeTimeFieldId: null,
  activeTimeView: "hour",
  pendingTimeValue: null,
};

function getStartOfWeekUnix(seed = Date.now()) {
  const date = new Date(seed);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return Math.floor(date.getTime() / 1000);
}

function getStartOfMonthUnix(seed = Date.now()) {
  const date = new Date(seed);
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), 1).getTime() / 1000);
}

function getCurrentScheduleAnchor() {
  return state.scheduleView === "month" ? getStartOfMonthUnix() : getStartOfWeekUnix();
}

function shiftScheduleAnchor(delta) {
  const anchor = new Date(state.weekStart * 1000);
  if (state.scheduleView === "month") {
    return Math.floor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1).getTime() / 1000);
  }
  return getStartOfWeekUnix((state.weekStart + (delta * WEEK_SECONDS)) * 1000);
}

function getScheduleRangeUnix() {
  const start = new Date(state.weekStart * 1000);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (state.scheduleView === "month") {
    end.setMonth(end.getMonth() + 1, 1);
  } else {
    end.setDate(end.getDate() + 7);
  }
  return {
    startsAt: Math.floor(start.getTime() / 1000),
    endsAt: Math.floor(end.getTime() / 1000) - 1,
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function formatShortDate(unix) {
  return new Date(unix * 1000).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function formatLongDate(unix) {
  return new Date(unix * 1000).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatWeekLabel(startUnix) {
  const endUnix = startUnix + WEEK_SECONDS - DAY_SECONDS;
  return `${formatShortDate(startUnix)} to ${formatShortDate(endUnix)}`;
}

function formatMonthLabel(anchorUnix) {
  return new Date(anchorUnix * 1000).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });
}

function getCurrentStatsAnchor(period) {
  const now = new Date();
  if (period === "year") {
    return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  }
  if (period === "month") {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  }
  return getStartOfWeekUnix();
}

function shiftStatsAnchor(anchorUnix, period, delta) {
  const anchor = new Date(anchorUnix * 1000);
  if (period === "year") {
    return Math.floor(new Date(anchor.getFullYear() + delta, 0, 1).getTime() / 1000);
  }
  if (period === "month") {
    return Math.floor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1).getTime() / 1000);
  }
  return anchorUnix + (delta * WEEK_SECONDS);
}

function formatHoursLabel(value) {
  return `${Number(value || 0).toFixed(1)}h`;
}

function formatEntryStatusLabel(status) {
  if (status === "scheduled") return "Confirmed";
  if (status === "in_progress") return "Underway";
  if (status === "complete") return "Completed";
  if (status === "tentative") return "Tentative";
  return String(status || "").replaceAll("_", " ");
}

function formatEntryTypeLabel(type) {
  if (type === "personal_leave") return "Personal Leave";
  if (type === "annual_leave") return "Annual Leave";
  if (type === "public_holiday") return "Public Holiday";
  if (type === "assignment") return "Assignment";
  if (type === "project") return "Project";
  return String(type || "").replaceAll("_", " ");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatTimeLabel(hour24, minute) {
  const numericHour = parseInt(hour24, 10) || 0;
  const period = numericHour >= 12 ? "PM" : "AM";
  const hour12 = numericHour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute || "00").padStart(2, "0")} ${period}`;
}

function formatEntryRange(entry) {
  if (entry.allDay) {
    const start = formatShortDate(entry.startsAt);
    const end = formatShortDate(entry.endsAt);
    return start === end ? "All day" : `${start} to ${end}`;
  }
  const start = new Date(entry.startsAt * 1000);
  const end = new Date(entry.endsAt * 1000);
  const startLabel = start.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  const endLabel = end.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return `${startLabel} - ${endLabel}`;
}

function toDateInputValue(unix) {
  const date = new Date(unix * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateParts(unix) {
  const date = new Date(unix * 1000);
  return {
    date: toDateInputValue(unix),
    hour24: String(date.getHours()).padStart(2, "0"),
    minute: String(Math.round(date.getMinutes() / 5) * 5).padStart(2, "0").replace(/^60$/, "55"),
  };
}

function getDefaultTimeForField(fieldId) {
  const fallback = fieldId.includes("end") ? state.settings.workdayEnd : state.settings.workdayStart;
  const [hour24, minute] = String(fallback || (fieldId.includes("end") ? "17:30" : "08:30")).split(":");
  return {
    hour24: String(hour24 || "08").padStart(2, "0"),
    minute: String(minute || "00").padStart(2, "0"),
  };
}

function setDateTimePair(dateId, timeId, value) {
  const dateInput = dateId ? document.getElementById(dateId) : null;
  const timeButton = document.getElementById(timeId);
  const defaults = getDefaultTimeForField(timeId);
  if (dateInput) dateInput.value = value?.date || "";
  if (!timeButton) return;
  const hour24 = value?.hour24 || defaults.hour24;
  const minute = value?.minute || defaults.minute;
  timeButton.dataset.hour24 = hour24;
  timeButton.dataset.minute = minute;
  timeButton.textContent = formatTimeLabel(hour24, minute);
}

function openNativeDatePicker(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.disabled) return;
  input.focus();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch (_) {
      // Some browsers only allow showPicker from direct user activation.
    }
  }
}

function unixFromDateTimePair(dateId, timeId, allDay = false, asEnd = false) {
  const dateValue = document.getElementById(dateId)?.value || "";
  if (!dateValue) return null;
  if (allDay) {
    return Math.floor(new Date(`${dateValue}T${asEnd ? "23:59" : "00:00"}`).getTime() / 1000);
  }
  const button = document.getElementById(timeId);
  const hour24 = button?.dataset.hour24 || "00";
  const minute = button?.dataset.minute || "00";
  return Math.floor(new Date(`${dateValue}T${hour24}:${minute}`).getTime() / 1000);
}

function getProjectById(projectId) {
  return state.projects.find((project) => project.id === projectId) || null;
}

function getSelectedUser() {
  return state.availableUsers.find((user) => user.id === state.selectedUserId) || state.availableUsers[0] || null;
}

function getMultiSelectValues(select) {
  if (!select) return [];
  return [...select.options].filter((option) => option.selected).map((option) => option.value);
}

function getProjectTitle(project) {
  if (!project) return "";
  return project.code ? `${project.code} · ${project.name}` : project.name;
}

function canEditEntry(entry) {
  return state.capabilities.canEditAny
    || entry.ownerId === state.currentUserId
    || entry.assigneeUserId === state.currentUserId;
}

function setCurrentView(view) {
  state.currentView = view;
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.calendarView === view);
  });
  document.querySelectorAll(".calendar-dashboard-view").forEach((section) => {
    section.classList.toggle("hidden", section.id !== `calendar-view-${view}`);
  });
  if (state.overviewStats) {
    renderShell();
  }
  syncActionButtons();
  if (view === "stats" && !state.statsData) {
    loadStats().catch((error) => {
      renderStatsError(error.message);
    });
  }
}

function initViewSwitching() {
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentView(button.dataset.calendarView);
    });
  });
}

function initSidebarCollapse() {
  const sidebar = document.getElementById("calendar-sidebar");
  const button = document.getElementById("calendar-sidebar-collapse-btn");
  if (!sidebar || !button) return;
  button.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });
}

async function loadBootstrap() {
  const browserTimeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {
      return "";
    }
  })();
  const scheduleRange = getScheduleRangeUnix();
  const params = new URLSearchParams({
    weekStart: String(scheduleRange.startsAt),
    rangeStart: String(scheduleRange.startsAt),
    rangeEnd: String(scheduleRange.endsAt),
    scheduleUserId: state.selectedUserId || "",
    viewMode: state.scheduleView,
    timeZone: browserTimeZone,
  });
  const data = await fetchJson(`/api/calendar/bootstrap?${params.toString()}`);
  state.capabilities = data.capabilities || state.capabilities;
  state.settings.dailyHours = Number(data.settings?.dailyHours || 7.6);
  state.settings.workdayStart = data.settings?.workdayStart || "08:30";
  state.settings.workdayEnd = data.settings?.workdayEnd || "17:30";
  state.settings.workdays = Array.isArray(data.settings?.workdays) ? data.settings.workdays : [1, 2, 3, 4, 5];
  state.currentUserId = data.currentUserId;
  state.weekStart = data.weekStart;
  state.scheduleView = data.scheduleView || state.scheduleView;
  state.selectedUserId = data.selectedUserId || state.currentUserId;
  state.availableUsers = Array.isArray(data.availableUsers) ? data.availableUsers : [];
  state.scheduleEntries = Array.isArray(data.scheduleEntries) ? data.scheduleEntries : [];
  state.teamProjectEntries = Array.isArray(data.teamProjectEntries) ? data.teamProjectEntries : [];
  state.projects = Array.isArray(data.projects) ? data.projects : [];
  state.overviewStats = data.overviewStats || null;
  if (!state.capabilities.canViewTeam) {
    state.statsScope = "mine";
    if (state.currentView === "team") {
      state.currentView = "personal";
    }
  } else if (!["team", "mine"].includes(state.statsScope) && !state.statsScope.startsWith("user:")) {
    state.statsScope = "team";
  }

  renderShell();
  renderPersonalView();
  renderProjectView();
  renderTeamView();
  populateScheduleUserSelect();
  populateStatsScopeSelect();
  populateEntryAssigneeSelect();
  populateEntryProjectSelect();
  populateAllocationProjectSelect();
  populateAllocationAssigneeSelect();
  syncActionButtons();
  setCurrentView(state.currentView);
  if (new URLSearchParams(window.location.search).get("view") === "about") {
    setCurrentView("about");
  }
}

async function loadStats() {
  const data = await fetchJson(`/api/calendar/stats?period=${encodeURIComponent(state.statsPeriod)}&scope=${encodeURIComponent(state.statsScope)}&anchor=${state.statsAnchor}`);
  state.statsData = data;
  renderStatsView();
}

function renderShell() {
  const selectedUser = getSelectedUser();
  const rangeLabel = state.scheduleView === "month" ? formatMonthLabel(state.weekStart) : formatWeekLabel(state.weekStart);
  const personalLabel = state.selectedUserId === "all"
    ? "The whole team's"
    : selectedUser ? `${selectedUser.username}'s` : "Your";

  document.getElementById("calendar-week-label").textContent = rangeLabel;
  document.getElementById("calendar-sidebar-week-label").textContent = rangeLabel;
  document.getElementById("calendar-range-kicker").textContent = state.scheduleView === "month" ? "Month" : "Week";
  document.querySelectorAll("[data-schedule-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.scheduleView === state.scheduleView);
  });
  document.getElementById("calendar-sidebar-week-copy").textContent = state.capabilities.canViewTeam
    ? `Focused on ${personalLabel.toLowerCase()} schedule with linked delivery allocations and team project visibility.`
    : "Focused on your schedule with linked delivery allocations.";
  document.getElementById("calendar-scope-copy").textContent = state.currentView === "projects"
    ? "Project pipeline, planned effort, scheduled delivery, completed effort, and estimated value"
    : state.currentView === "team"
      ? "Cross-team project schedule for the selected range"
      : state.currentView === "stats"
        ? "Capacity, assigned project time, revenue, and delivery reporting across selectable periods"
        : `${personalLabel} schedule`;

  const sidebarOverview = document.getElementById("calendar-sidebar-overview");
  const summary = state.overviewStats?.summary || {};
  if (sidebarOverview) {
    sidebarOverview.innerHTML = [
      { label: "Assigned", value: formatHoursLabel(summary.scheduledHours || 0) },
      { label: "Capacity", value: formatHoursLabel(summary.capacityHours || 0) },
      { label: "Utilisation", value: `${summary.utilizationPercent || 0}%` },
      { label: "Open Capacity", value: formatHoursLabel(summary.remainingHours || 0) },
    ].map((item) => `
      <div class="calendar-sidebar-stat">
        <span class="calendar-sidebar-stat-label">${escapeHtml(item.label)}</span>
        <span class="calendar-sidebar-stat-value">${escapeHtml(item.value)}</span>
      </div>
    `).join("");
  }
}

function populateScheduleUserSelect() {
  const select = document.getElementById("calendar-schedule-user");
  const optionsContainer = document.getElementById("calendar-schedule-user-options");
  if (!select || !optionsContainer) return;
  const options = [];
  if (state.capabilities.canViewTeam) {
    options.push('<option value="all">All team members</option>');
  }
  select.innerHTML = state.availableUsers.length
    ? options.concat(state.availableUsers.map((user) => (
      `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`
    ))).join("")
    : '<option value="">No users available</option>';
  select.value = state.selectedUserId || state.currentUserId || "";
  select.disabled = !state.capabilities.canViewTeam || !state.availableUsers.length;
  select.classList.toggle("calendar-scope-readonly", select.disabled);

  const scopeOptions = [];
  if (state.capabilities.canViewTeam) {
    scopeOptions.push(`
      <label class="calendar-scope-option${select.value === "all" ? " is-active" : ""}">
        <input type="checkbox" data-schedule-scope-value="all" ${select.value === "all" ? "checked" : ""}>
        <span class="calendar-scope-option-copy">
          <span class="calendar-scope-option-label">Everyone</span>
          <span class="calendar-scope-option-meta">Full team calendar</span>
        </span>
      </label>
    `);
  }
  state.availableUsers.forEach((user) => {
    const isActive = select.value === user.id;
    const isCurrentUser = user.id === state.currentUserId;
    scopeOptions.push(`
      <label class="calendar-scope-option${isActive ? " is-active" : ""}">
        <input type="checkbox" data-schedule-scope-value="${escapeHtml(user.id)}" ${isActive ? "checked" : ""}>
        <span class="calendar-scope-option-copy">
          <span class="calendar-scope-option-label">${escapeHtml(user.username)}${isCurrentUser ? ' <span class="calendar-scope-option-badge">You</span>' : ""}</span>
          <span class="calendar-scope-option-meta">Individual calendar</span>
        </span>
      </label>
    `);
  });
  optionsContainer.innerHTML = scopeOptions.join("");
  syncScheduleScopeTriggerLabel();
}

function syncScheduleScopeTriggerLabel() {
  const trigger = document.getElementById("calendar-schedule-user-trigger");
  const select = document.getElementById("calendar-schedule-user");
  if (!trigger || !select) return;
  if (select.disabled) {
    const currentUser = state.availableUsers.find((user) => user.id === (state.selectedUserId || state.currentUserId));
    trigger.textContent = currentUser?.username || "My calendar";
    trigger.disabled = true;
    return;
  }

  trigger.disabled = false;
  if (select.value === "all") {
    trigger.textContent = "Everyone";
    return;
  }

  const activeUser = state.availableUsers.find((user) => user.id === select.value);
  trigger.textContent = activeUser?.username || "Select calendar scope";
}

function toggleScheduleScopeDropdown(forceState = null) {
  const dropdown = document.getElementById("calendar-schedule-user-dropdown");
  const trigger = document.getElementById("calendar-schedule-user-trigger");
  const select = document.getElementById("calendar-schedule-user");
  if (!dropdown || !trigger || !select || select.disabled) return;
  const shouldOpen = typeof forceState === "boolean" ? forceState : dropdown.classList.contains("hidden");
  dropdown.classList.toggle("hidden", !shouldOpen);
}

async function applyScheduleScopeSelection(value) {
  const select = document.getElementById("calendar-schedule-user");
  if (!select || !value || select.value === value) {
    toggleScheduleScopeDropdown(false);
    return;
  }
  select.value = value;
  state.selectedUserId = value;
  populateScheduleUserSelect();
  toggleScheduleScopeDropdown(false);
  await refreshCalendarData();
}

function populateStatsScopeSelect() {
  const select = document.getElementById("calendar-stats-scope");
  if (!select) return;
  const options = [];
  if (state.capabilities.canViewTeam) {
    options.push('<option value="team">Team</option>');
  }
  options.push('<option value="mine">Myself</option>');
  if (state.capabilities.canViewTeam) {
    state.availableUsers.forEach((user) => {
      options.push(`<option value="user:${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`);
    });
  }
  select.innerHTML = options.join("");
  if (![...select.options].some((option) => option.value === state.statsScope)) {
    state.statsScope = state.capabilities.canViewTeam ? "team" : "mine";
  }
  select.value = state.statsScope;
  select.disabled = !state.capabilities.canViewTeam;
}

function buildSummaryCards(items) {
  return items.map((card) => `
    <div class="calendar-summary-card">
      <div class="calendar-summary-label">${escapeHtml(card.label)}</div>
      <div class="calendar-summary-value">${escapeHtml(card.value)}</div>
      <div class="calendar-summary-copy">${escapeHtml(card.copy)}</div>
    </div>
  `).join("");
}

function renderPersonalView() {
  renderPersonalSummary();
  renderPersonalGrid();
}

function renderPersonalSummary() {
  const container = document.getElementById("calendar-personal-summary");
  if (!container) return;
  const projectEntries = state.scheduleEntries.filter((entry) => entry.projectId);
  const leaveEntries = state.scheduleEntries.filter((entry) => ["personal_leave", "annual_leave", "public_holiday", "leave"].includes(entry.type));
  const workdayCount = countWorkdaysInVisibleRange();
  const visibleUsers = getScheduleUsersForSelectedScope();
  const leaveHours = leaveEntries.reduce((sum, entry) => sum + Number(entry.scheduledHours || 0), 0);
  const capacityHours = Math.max(0, (workdayCount * Number(state.settings.dailyHours || 7.6) * visibleUsers.length) - leaveHours);
  const scheduledHours = projectEntries.reduce((sum, entry) => sum + Number(entry.scheduledHours || 0), 0);
  const completedHours = projectEntries
    .filter((entry) => entry.status === "complete")
    .reduce((sum, entry) => sum + Number(entry.scheduledHours || 0), 0);
  const utilisationPercent = capacityHours > 0 ? Math.round((scheduledHours / capacityHours) * 100) : 0;

  container.innerHTML = buildSummaryCards([
    {
      label: "Visible Items",
      value: state.scheduleEntries.length,
      copy: "Everything on the selected calendar for the active range",
    },
    {
      label: "Assigned Project Time",
      value: formatHoursLabel(scheduledHours),
      copy: "Only project-linked time counts toward utilisation",
    },
    {
      label: "Unavailable Time",
      value: formatHoursLabel(leaveHours),
      copy: "Leave and public holiday time reduces trackable capacity",
    },
    {
      label: "Capacity Used",
      value: `${utilisationPercent}%`,
      copy: `${formatHoursLabel(Math.max(0, capacityHours - scheduledHours))} unassigned capacity remaining · ${formatHoursLabel(completedHours)} completed`,
    },
  ]);
}

function getVisibleDays() {
  if (state.scheduleView === "month") {
    const anchor = new Date(state.weekStart * 1000);
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const totalDays = end.getDate();
    return Array.from({ length: totalDays }, (_, index) => {
      const dayStart = Math.floor(new Date(anchor.getFullYear(), anchor.getMonth(), index + 1).getTime() / 1000);
      return {
        start: dayStart,
        end: dayStart + DAY_SECONDS - 1,
        weekday: new Date(dayStart * 1000).toLocaleDateString("en-AU", { weekday: "short" }),
        label: new Date(dayStart * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
        longLabel: formatLongDate(dayStart),
      };
    });
  }

  return Array.from({ length: 7 }, (_, index) => {
    const dayStart = state.weekStart + (index * DAY_SECONDS);
    return {
      start: dayStart,
      end: dayStart + DAY_SECONDS - 1,
      weekday: new Date(dayStart * 1000).toLocaleDateString("en-AU", { weekday: "short" }),
      label: new Date(dayStart * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
      longLabel: formatLongDate(dayStart),
    };
  });
}

function countWorkdaysInVisibleRange() {
  return getVisibleDays().filter((day) => {
    const weekday = new Date(day.start * 1000).getDay();
    return state.settings.workdays.includes(weekday);
  }).length;
}

function getEntriesForDay(entries, dayStart, dayEnd) {
  return entries
    .filter((entry) => entry.startsAt >= dayStart && entry.startsAt <= dayEnd)
    .sort((left, right) => left.startsAt - right.startsAt);
}

function getUserMap() {
  return new Map(state.availableUsers.map((user) => [user.id, user]));
}

function getEntryUserLabel(entry) {
  const user = getUserMap().get(entry.calendarUserId);
  return user?.username || "Team";
}

function getScheduleUsersForSelectedScope() {
  if (state.selectedUserId === "all") {
    return state.availableUsers;
  }
  const selectedUser = getSelectedUser();
  return selectedUser ? [selectedUser] : [];
}

function renderPersonalGrid() {
  const container = document.getElementById("calendar-personal-grid");
  if (!container) return;
  if (state.scheduleView === "month") {
    container.innerHTML = renderMonthCalendar(state.scheduleEntries, {
      emptyMessage: "No calendar items are scheduled in this month.",
      showUserLabel: state.selectedUserId === "all",
    });
  } else {
    const users = getScheduleUsersForSelectedScope();
    container.innerHTML = renderScheduleGrid(state.scheduleEntries, users, {
      emptyMessage: "No calendar items are scheduled in this range.",
      emptyCell: "Nothing booked",
    });
  }
  bindEntryCardClicks(container);
}

function renderEntryCard(entry) {
  const project = entry.projectId ? getProjectById(entry.projectId) : null;
  const entryKind = entry.projectId
    ? "project"
    : ["personal_leave", "annual_leave", "public_holiday", "leave"].includes(entry.type)
      ? "leave"
      : "personal";
  return `
    <button type="button" class="calendar-entry-card" data-calendar-entry-id="${escapeHtml(entry.id)}" data-entry-status="${escapeHtml(entry.status)}" data-entry-kind="${entryKind}">
      <div class="calendar-entry-title">${escapeHtml(entry.title)}</div>
      <div class="calendar-entry-meta">
        <span class="calendar-entry-type">${escapeHtml(formatEntryTypeLabel(entry.type))}</span>
        ${project ? `<span class="calendar-entry-project">${escapeHtml(project.code || project.name)}</span>` : ""}
      </div>
      <div class="calendar-entry-meta">
        <span>${escapeHtml(formatEntryRange(entry))}</span>
        <span>${escapeHtml(formatEntryStatusLabel(entry.status))}</span>
      </div>
    </button>
  `;
}

function getMonthGridDays() {
  const anchor = new Date(state.weekStart * 1000);
  const firstDay = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalVisible = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startOffset);
  return Array.from({ length: totalVisible }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const unix = Math.floor(date.getTime() / 1000);
    return {
      start: unix,
      end: unix + DAY_SECONDS - 1,
      dayNumber: date.getDate(),
      weekday: date.toLocaleDateString("en-AU", { weekday: "short" }),
      inCurrentMonth: date.getMonth() === anchor.getMonth(),
      isToday: toDateInputValue(unix) === toDateInputValue(Math.floor(Date.now() / 1000)),
    };
  });
}

function renderMonthCalendar(entries, options = {}) {
  const days = getMonthGridDays();
  const weekdayHeader = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => `
    <div class="calendar-month-weekday">${escapeHtml(label)}</div>
  `).join("");

  const cells = days.map((day) => {
    const dayEntries = getEntriesForDay(entries, day.start, day.end);
    const renderedEntries = options.showUserLabel
      ? renderAggregatedMonthEntries(dayEntries)
      : dayEntries.slice(0, 4).map((entry) => renderMonthEntryChip(entry, false)).join("");
    const renderedCount = options.showUserLabel
      ? countAggregatedMonthEntries(dayEntries)
      : Math.min(dayEntries.length, 4);
    const remaining = Math.max(0, dayEntries.length - renderedCount);
    return `
      <div class="calendar-month-cell${day.inCurrentMonth ? "" : " is-outside-month"}${day.isToday ? " is-today" : ""}">
        <div class="calendar-month-cell-header">
          <span class="calendar-month-day-number">${escapeHtml(day.dayNumber)}</span>
        </div>
        <div class="calendar-month-cell-body">
          ${renderedEntries}
          ${remaining > 0 ? `<button type="button" class="calendar-month-more" data-calendar-day-unix="${day.start}" data-calendar-day-show-user-label="${options.showUserLabel ? "1" : "0"}">+ ${remaining} more</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="calendar-month-grid-shell">
      <div class="calendar-month-grid-header">${weekdayHeader}</div>
      <div class="calendar-month-grid">${cells}</div>
      ${entries.length ? "" : `<p class="text-sm text-muted">${escapeHtml(options.emptyMessage || "No calendar items are scheduled in this month.")}</p>`}
    </div>
  `;
}

function getMonthAggregationGroups(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    const key = [
      entry.title,
      entry.type,
      entry.status,
      entry.projectId || "",
      entry.startsAt,
      entry.endsAt,
      entry.allDay ? 1 : 0,
    ].join("|");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  });
  return [...groups.values()];
}

function countAggregatedMonthEntries(entries) {
  return Math.min(getMonthAggregationGroups(entries).length, 4);
}

function renderAggregatedMonthEntries(entries) {
  return getMonthAggregationGroups(entries).slice(0, 4).map((group) => {
    const lead = group[0];
    const everyone = state.availableUsers.length > 1 && group.length === state.availableUsers.length;
    const label = everyone ? "Everyone" : group.map((entry) => getEntryUserLabel(entry)).join(", ");
    return renderMonthEntryChip(lead, true, label);
  }).join("");
}

function renderMonthEntryChip(entry, showUserLabel = false, overrideUserLabel = "") {
  const entryKind = entry.projectId
    ? "project"
    : ["personal_leave", "annual_leave", "public_holiday", "leave"].includes(entry.type)
      ? "leave"
      : "personal";
  const userLabel = showUserLabel ? `<span class="calendar-month-chip-user">${escapeHtml(overrideUserLabel || getEntryUserLabel(entry))}</span>` : "";
  return `
    <button type="button" class="calendar-month-entry-chip" data-calendar-entry-id="${escapeHtml(entry.id)}" data-entry-status="${escapeHtml(entry.status)}" data-entry-kind="${entryKind}">
      <span class="calendar-month-chip-time">${escapeHtml(entry.allDay ? "All day" : new Date(entry.startsAt * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }))}</span>
      <span class="calendar-month-chip-title">${escapeHtml(entry.title)}</span>
      ${userLabel}
    </button>
  `;
}

function renderScheduleGrid(entries, users, options = {}) {
  if (!users.length) {
    return `<p class="text-sm text-muted">${escapeHtml(options.emptyMessage || "No schedule data is available.")}</p>`;
  }
  const days = getVisibleDays();
  const dayCountClass = `calendar-grid-days-${days.length}`;
  const header = `
    <div class="calendar-grid-header">
      <div class="calendar-grid-header-cell">
        <span class="calendar-grid-header-label">Calendar</span>
        <span class="calendar-grid-header-date">${escapeHtml(state.scheduleView === "month" ? "Monthly view" : "Weekly view")}</span>
      </div>
      ${days.map((day) => `
        <div class="calendar-grid-header-cell">
          <span class="calendar-grid-header-label">${escapeHtml(day.weekday)}</span>
          <span class="calendar-grid-header-date">${escapeHtml(day.label)}</span>
        </div>
      `).join("")}
    </div>
  `;

  const rows = users.map((user) => `
    <div class="calendar-user-row">
      <div class="calendar-user-label">
        <div class="calendar-user-name">${escapeHtml(user.username)}</div>
        <div class="calendar-user-role">${escapeHtml(user.roleName || (user.id === state.currentUserId ? "Your calendar" : "Consultant"))}</div>
      </div>
      ${days.map((day) => {
        const dayEntries = entries
          .filter((entry) => entry.calendarUserId === user.id && entry.startsAt >= day.start && entry.startsAt <= day.end)
          .sort((left, right) => left.startsAt - right.startsAt);
        return `
          <div class="calendar-day-cell">
            ${dayEntries.length ? dayEntries.map(renderEntryCard).join("") : `<div class="calendar-day-empty">${escapeHtml(options.emptyCell || "No items")}</div>`}
          </div>
        `;
      }).join("")}
    </div>
  `).join("");

  return `<div class="calendar-grid-frame ${dayCountClass}">${header}${rows}</div>`;
}

function renderProjectView() {
  renderProjectSummary();
  renderProjectTable();
}

function renderProjectSummary() {
  const container = document.getElementById("calendar-project-summary");
  if (!container) return;
  const activeProjects = state.projects.filter((project) => project.status === "active").length;
  const scheduledHours = state.projects.reduce((sum, project) => sum + Number(project.scheduledHours || 0), 0);
  const completedHours = state.projects.reduce((sum, project) => sum + Number(project.completedHours || 0), 0);
  const estimatedValue = state.projects.reduce((sum, project) => sum + Number(project.estimatedCost || 0), 0);
  container.innerHTML = buildSummaryCards([
    { label: "Active Projects", value: activeProjects, copy: "Projects currently moving through delivery" },
    { label: "Scheduled Effort", value: formatHoursLabel(scheduledHours), copy: "Project-linked effort reserved against delivery" },
    { label: "Completed Effort", value: formatHoursLabel(completedHours), copy: "Completed project effort against scheduled work" },
    { label: "Estimated Value", value: formatCurrency(estimatedValue), copy: "Estimated full-project value based on daily rate" },
  ]);
}

function renderProjectTable() {
  const tbody = document.getElementById("calendar-project-table-body");
  if (!tbody) return;
  tbody.innerHTML = state.projects.length
    ? state.projects.map((project) => renderProjectRow(project)).join("")
    : '<tr><td colspan="11" class="text-muted">No projects configured yet.</td></tr>';

  tbody.querySelectorAll(".calendar-project-edit-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const project = getProjectById(button.dataset.projectId);
      if (project) openProjectModal(project);
    });
  });
  tbody.querySelectorAll(".calendar-project-assign-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const project = getProjectById(button.dataset.projectId);
      openAllocationModal(project);
    });
  });
}

function renderProjectRow(project) {
  const consultants = (project.assignedUsers || []).length
    ? project.assignedUsers.map((user) => escapeHtml(user.username)).join(", ")
    : "Unassigned";
  const windowLabel = project.startsAt || project.endsAt
    ? `${project.startsAt ? formatShortDate(project.startsAt) : "Open"} - ${project.endsAt ? formatShortDate(project.endsAt) : "Open"}`
    : "No dates";
  const estimateLabel = project.estimatedMode === "days"
    ? `${Number(project.estimatedValue || 0).toFixed(1)} days`
    : `${Number(project.estimatedValue || 0).toFixed(1)} hours`;
  return `
    <tr class="calendar-project-row">
      <td class="calendar-project-code-cell">${escapeHtml(project.code || "—")}</td>
      <td class="calendar-project-client-cell">${escapeHtml(project.clientName || "—")}</td>
      <td>
        <div class="calendar-project-title">${escapeHtml(project.name)}</div>
        <div class="calendar-project-meta">${escapeHtml(project.projectType || "General")} · ${escapeHtml(project.description || "No description")}</div>
      </td>
      <td><span class="calendar-status-pill" data-status="${escapeHtml(project.status)}">${escapeHtml(project.status.replaceAll("_", " "))}</span></td>
      <td>${consultants}</td>
      <td>
        <div class="calendar-project-title">${escapeHtml(estimateLabel)}</div>
        <div class="calendar-project-meta">${escapeHtml(formatHoursLabel(project.estimatedHours || 0))}</div>
      </td>
      <td>
        <div class="calendar-project-title">${escapeHtml(formatHoursLabel(project.scheduledHours || 0))} / ${escapeHtml(formatHoursLabel(project.completedHours || 0))}</div>
        <div class="calendar-project-meta">${escapeHtml(project.assignmentCount || 0)} allocation blocks</div>
      </td>
      <td>
        <div class="calendar-progress-stack">
          <div class="calendar-progress-label-row">
            <span>Scheduled</span>
            <span>${escapeHtml(project.scheduledPercent || 0)}%</span>
          </div>
          <progress class="calendar-progress" max="100" value="${escapeHtml(project.scheduledPercent || 0)}"></progress>
          <div class="calendar-progress-label-row">
            <span>Completed</span>
            <span>${escapeHtml(project.completedPercent || 0)}%</span>
          </div>
          <progress class="calendar-progress calendar-progress-complete" max="100" value="${escapeHtml(project.completedPercent || 0)}"></progress>
        </div>
      </td>
      <td>
        <div class="calendar-project-title">${escapeHtml(formatCurrency(project.billableRate || 0))}</div>
        <div class="calendar-project-meta">${escapeHtml(formatCurrency(project.estimatedCost || 0))}</div>
      </td>
      <td>${escapeHtml(windowLabel)}</td>
      <td>
        <div class="calendar-project-actions">
          ${state.capabilities.canCreate ? `<button type="button" class="btn-secondary text-xs calendar-project-assign-btn" data-project-id="${escapeHtml(project.id)}">Assign Time</button>` : ""}
          ${state.capabilities.canManageProjects ? `<button type="button" class="btn-secondary text-xs calendar-project-edit-btn" data-project-id="${escapeHtml(project.id)}">Edit</button>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function renderTeamView() {
  const summary = document.getElementById("calendar-team-summary");
  const container = document.getElementById("calendar-team-grid");
  if (summary) {
    const scheduledHours = state.teamProjectEntries.reduce((sum, entry) => sum + Number(entry.scheduledHours || 0), 0);
    const completedHours = state.teamProjectEntries
      .filter((entry) => entry.status === "complete")
      .reduce((sum, entry) => sum + Number(entry.scheduledHours || 0), 0);
    const consultants = new Set(state.teamProjectEntries.map((entry) => entry.calendarUserId)).size;
    const projects = new Set(state.teamProjectEntries.map((entry) => entry.projectId).filter(Boolean)).size;
    const workdayCount = countWorkdaysInVisibleRange();
    const capacity = workdayCount * Number(state.settings.dailyHours || 7.6) * state.availableUsers.length;
    const utilisation = capacity > 0 ? Math.round((scheduledHours / capacity) * 100) : 0;
    summary.innerHTML = buildSummaryCards([
      { label: "Project Blocks", value: state.teamProjectEntries.length, copy: "Linked project allocations in the selected range" },
      { label: "Assigned Hours", value: formatHoursLabel(scheduledHours), copy: "Team project effort currently planned" },
      { label: "Completed Hours", value: formatHoursLabel(completedHours), copy: "Completed project effort in the visible range" },
      { label: "Capacity Used", value: `${utilisation}%`, copy: `${consultants} consultants across ${projects} active projects` },
    ]);
  }
  if (!container) return;
  if (!state.capabilities.canViewTeam) {
    container.innerHTML = '<p class="text-sm text-muted">Team project scheduling is available to calendar roles with team visibility.</p>';
    return;
  }
  container.innerHTML = state.scheduleView === "month"
    ? renderMonthCalendar(state.teamProjectEntries, {
      emptyMessage: "No team project entries are visible in this month.",
      showUserLabel: true,
    })
    : renderScheduleGrid(state.teamProjectEntries, state.availableUsers, {
      emptyMessage: "No team project entries are visible for this range.",
      emptyCell: "No project work",
    });
  bindEntryCardClicks(container);
}

function renderStatsError(message) {
  const summary = document.getElementById("calendar-stats-summary");
  const userStats = document.getElementById("calendar-user-stats");
  const projectStats = document.getElementById("calendar-project-stats");
  if (summary) summary.innerHTML = `<div class="calendar-summary-card"><div class="calendar-summary-copy text-error">${escapeHtml(message)}</div></div>`;
  if (userStats) userStats.innerHTML = `<p class="text-sm text-error">${escapeHtml(message)}</p>`;
  if (projectStats) projectStats.innerHTML = `<p class="text-sm text-error">${escapeHtml(message)}</p>`;
}

function renderStatsView() {
  const data = state.statsData;
  const summaryContainer = document.getElementById("calendar-stats-summary");
  const userContainer = document.getElementById("calendar-user-stats");
  const projectContainer = document.getElementById("calendar-project-stats");
  const statsLabel = document.getElementById("calendar-stats-label");
  if (!summaryContainer || !userContainer || !projectContainer) return;
  if (!data?.stats) {
    renderStatsError("Statistics are not available yet.");
    return;
  }
  if (statsLabel) {
    statsLabel.textContent = data.label || "Current period";
  }

  const summary = data.stats.summary || {};
  summaryContainer.innerHTML = buildSummaryCards([
    { label: "Assigned", value: formatHoursLabel(summary.scheduledHours || 0), copy: `Project-linked time in the ${data.label || state.statsPeriod} window` },
    { label: "Capacity", value: formatHoursLabel(summary.capacityHours || 0), copy: `${summary.workdayCount || 0} working days across the selected staff scope` },
    { label: "Utilisation", value: `${summary.utilizationPercent || 0}%`, copy: `${formatHoursLabel(summary.remainingHours || 0)} capacity still unassigned · ${formatHoursLabel(summary.leaveHours || 0)} on leave/holiday` },
    { label: "Estimated Revenue", value: formatCurrency(summary.estimatedRevenue || 0), copy: `${summary.activeProjects || 0} projects · ${summary.activeUsers || 0} active users` },
  ]);

  userContainer.innerHTML = data.stats.userStats?.length
    ? data.stats.userStats.map((item) => `
      <article class="calendar-stat-card">
        <div class="calendar-stat-card-top">
          <div>
            <h3 class="calendar-stat-card-title">${escapeHtml(item.username)}</h3>
            <p class="calendar-stat-card-copy">${escapeHtml(item.roleName || "Consultant")} · ${escapeHtml(item.projectCount)} project${item.projectCount === 1 ? "" : "s"}</p>
          </div>
          <span class="calendar-stat-badge">${escapeHtml(item.utilizationPercent)}%</span>
        </div>
        <div class="calendar-stat-metrics">
          <div><span>Assigned</span><strong>${escapeHtml(formatHoursLabel(item.scheduledHours || 0))}</strong></div>
          <div><span>Capacity</span><strong>${escapeHtml(formatHoursLabel(item.capacityHours || 0))}</strong></div>
          <div><span>Open</span><strong>${escapeHtml(formatHoursLabel(item.remainingHours || 0))}</strong></div>
          <div><span>Leave</span><strong>${escapeHtml(formatHoursLabel(item.leaveHours || 0))}</strong></div>
        </div>
      </article>
    `).join("")
    : '<p class="text-sm text-muted">No utilisation data for this period.</p>';

  projectContainer.innerHTML = data.stats.projectStats?.length
    ? data.stats.projectStats.map((item) => `
      <article class="calendar-stat-card">
        <div class="calendar-stat-card-top">
          <div>
            <h3 class="calendar-stat-card-title">${escapeHtml(item.code ? `${item.code} · ${item.name}` : item.name)}</h3>
            <p class="calendar-stat-card-copy">${escapeHtml(item.clientName || "Internal")} project</p>
          </div>
          <span class="calendar-stat-badge">${escapeHtml(formatCurrency(item.scheduledRevenue || 0))}</span>
        </div>
        <div class="calendar-stat-metrics">
          <div><span>Scheduled</span><strong>${escapeHtml(formatHoursLabel(item.scheduledHours || 0))}</strong></div>
          <div><span>Completed</span><strong>${escapeHtml(formatHoursLabel(item.completedHours || 0))}</strong></div>
          <div><span>Est. Cost</span><strong>${escapeHtml(formatCurrency(item.estimatedCost || 0))}</strong></div>
        </div>
      </article>
    `).join("")
    : '<p class="text-sm text-muted">No project data for this period.</p>';
}

function syncActionButtons() {
  const hideMainToolbar = state.currentView === "stats" || state.currentView === "about";
  document.getElementById("calendar-main-toolbar")?.classList.toggle("hidden", hideMainToolbar);
  document.getElementById("calendar-add-entry-btn")?.classList.toggle("hidden", !(state.capabilities.canCreate && state.currentView === "personal"));
  document.getElementById("calendar-add-project-btn")?.classList.toggle("hidden", !(state.capabilities.canManageProjects && state.currentView === "projects"));
  document.getElementById("calendar-add-allocation-btn")?.classList.toggle("hidden", !(state.capabilities.canCreate && (state.currentView === "projects" || state.currentView === "team")));
  document.getElementById("calendar-scope-wrap")?.classList.toggle("hidden", state.currentView !== "personal");

  document.querySelector('[data-calendar-view="team"]')?.classList.toggle("hidden", !state.capabilities.canViewTeam);
  document.querySelector('.mobile-tab[data-calendar-view="team"]')?.classList.toggle("hidden", !state.capabilities.canViewTeam);
}

function bindEntryCardClicks(root) {
  root.querySelectorAll("[data-calendar-entry-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = [...state.scheduleEntries, ...state.teamProjectEntries].find((item) => item.id === button.dataset.calendarEntryId);
      if (entry) openEntryModal(entry);
    });
  });
  root.querySelectorAll("[data-calendar-day-unix]").forEach((button) => {
    button.addEventListener("click", () => {
      openDayModal(Number(button.dataset.calendarDayUnix || 0), button.dataset.calendarDayShowUserLabel === "1");
    });
  });
}

function openDayModal(dayUnix, showUserLabel = false) {
  const modal = document.getElementById("calendar-day-modal");
  const title = document.getElementById("calendar-day-modal-title");
  const body = document.getElementById("calendar-day-modal-body");
  if (!modal || !title || !body || !dayUnix) return;
  const dayEnd = dayUnix + DAY_SECONDS - 1;
  const entries = getEntriesForDay([...state.scheduleEntries, ...state.teamProjectEntries], dayUnix, dayEnd);
  title.textContent = formatLongDate(dayUnix);
  body.innerHTML = entries.length
    ? entries.map((entry) => {
      const userLabel = showUserLabel ? `<div class="calendar-day-modal-user">${escapeHtml(getEntryUserLabel(entry))}</div>` : "";
      return `${userLabel}${renderEntryCard(entry)}`;
    }).join("")
    : '<p class="text-sm text-muted">No items scheduled for this day.</p>';
  bindEntryCardClicks(body);
  modal.classList.remove("hidden");
}

function closeDayModal() {
  document.getElementById("calendar-day-modal")?.classList.add("hidden");
}

function resetMessage(id) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = "";
  element.className = "text-sm hidden";
}

function setMessage(id, message, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = message;
  element.className = isError ? "text-sm text-error" : "text-sm text-accent";
  element.classList.remove("hidden");
}

function populateEntryAssigneeSelect(selectedId = "") {
  const select = document.getElementById("calendar-entry-assignee");
  const wrap = document.getElementById("calendar-entry-owner-wrap");
  const optionsHost = document.getElementById("calendar-entry-assignee-options");
  const trigger = document.getElementById("calendar-entry-assignee-trigger");
  if (!select || !wrap || !optionsHost || !trigger) return;
  const users = state.capabilities.canAssignOthers ? state.availableUsers : state.availableUsers.filter((user) => user.id === state.currentUserId);
  const selectedIds = Array.isArray(selectedId)
    ? selectedId
    : [selectedId || (state.selectedUserId !== "all" ? state.selectedUserId : "") || state.currentUserId || ""].filter(Boolean);
  const options = [];
  if (state.capabilities.canAssignOthers) {
    options.push('<option value="__all__">Everyone</option>');
  }
  options.push(...users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`));
  select.innerHTML = options.join("");
  [...select.options].forEach((option) => {
    option.selected = selectedIds.includes(option.value);
  });
  if (![...select.options].some((option) => option.selected) && select.options.length) {
    select.options[0].selected = true;
  }
  optionsHost.innerHTML = [...select.options].map((option) => `
    <label class="custom-checkbox gap-2">
      <input type="checkbox" value="${escapeHtml(option.value)}" ${option.selected ? "checked" : ""}>
      <span class="checkmark"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></span>
      <span class="text-sm">${escapeHtml(option.textContent || "")}</span>
    </label>
  `).join("");
  syncEntryAssigneeTriggerLabel();
  wrap.classList.toggle("hidden", users.length <= 1 && !state.capabilities.canAssignOthers);
}

function syncEntryAssigneeTriggerLabel() {
  const trigger = document.getElementById("calendar-entry-assignee-trigger");
  const select = document.getElementById("calendar-entry-assignee");
  if (!trigger || !select) return;
  const selectedOptions = [...select.options].filter((option) => option.selected);
  if (!selectedOptions.length) {
    trigger.textContent = "Select assigned users";
    return;
  }
  if (selectedOptions.some((option) => option.value === "__all__")) {
    trigger.textContent = "Everyone";
    return;
  }
  trigger.textContent = selectedOptions.length === 1
    ? selectedOptions[0].textContent
    : `${selectedOptions.length} users selected`;
}

function populateEntryProjectSelect(selectedId = "") {
  const select = document.getElementById("calendar-entry-project");
  if (!select) return;
  select.innerHTML = ['<option value="">No linked project</option>'].concat(
    state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(getProjectTitle(project))}</option>`)
  ).join("");
  select.value = selectedId || "";
}

function syncEntryFormAllDay() {
  const allDay = !!document.getElementById("calendar-entry-all-day")?.checked;
  document.getElementById("calendar-entry-start-time-wrap")?.classList.toggle("hidden", allDay);
  document.getElementById("calendar-entry-end-time-wrap")?.classList.toggle("hidden", allDay);
  syncEntryEndFromStart();
}

function syncEntryEndFromStart(force = false) {
  const allDay = !!document.getElementById("calendar-entry-all-day")?.checked;
  const startDate = document.getElementById("calendar-entry-start-date")?.value || "";
  const endDateInput = document.getElementById("calendar-entry-end-date");
  const currentStart = unixFromDateTimePair("calendar-entry-start-date", "calendar-entry-start-time", allDay, false);
  const currentEnd = unixFromDateTimePair("calendar-entry-end-date", "calendar-entry-end-time", allDay, true);
  if (!startDate || !endDateInput || !currentStart) return;

  if (allDay) {
    if (force || !endDateInput.value || currentEnd == null || currentEnd < currentStart) {
      endDateInput.value = startDate;
    }
    return;
  }

  if (force || state.entryAutoEnd || !endDateInput.value || currentEnd == null || currentEnd <= currentStart) {
    const autoEnd = new Date((currentStart * 1000) + (30 * 60 * 1000));
    setDateTimePair("calendar-entry-end-date", "calendar-entry-end-time", {
      date: toDateInputValue(Math.floor(autoEnd.getTime() / 1000)),
      hour24: String(autoEnd.getHours()).padStart(2, "0"),
      minute: String(autoEnd.getMinutes()).padStart(2, "0"),
    });
  }
}

function toggleEntryAssigneeDropdown(forceState = null) {
  const dropdown = document.getElementById("calendar-entry-assignee-dropdown");
  if (!dropdown) return;
  const shouldOpen = forceState == null ? dropdown.classList.contains("hidden") : forceState;
  dropdown.classList.toggle("hidden", !shouldOpen);
}

function syncEntryAssigneeSelectionFromCheckboxes() {
  const select = document.getElementById("calendar-entry-assignee");
  const optionsHost = document.getElementById("calendar-entry-assignee-options");
  if (!select || !optionsHost) return;
  const checkedValues = [...optionsHost.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const everyoneSelected = checkedValues.includes("__all__");
  [...select.options].forEach((option) => {
    option.selected = everyoneSelected ? option.value === "__all__" : checkedValues.includes(option.value);
  });
  if (!everyoneSelected && ![...select.options].some((option) => option.selected) && select.options.length) {
    const fallback = [...select.options].find((option) => option.value !== "__all__") || select.options[0];
    fallback.selected = true;
    const fallbackCheckbox = optionsHost.querySelector(`input[value="${CSS.escape(fallback.value)}"]`);
    if (fallbackCheckbox) fallbackCheckbox.checked = true;
  }
  if (everyoneSelected) {
    optionsHost.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = input.value === "__all__";
    });
  } else {
    const everyoneCheckbox = optionsHost.querySelector('input[value="__all__"]');
    if (everyoneCheckbox) everyoneCheckbox.checked = false;
  }
  syncEntryAssigneeTriggerLabel();
}

function setEntryFormDisabled(disabled) {
  [
    "calendar-entry-title",
    "calendar-entry-type",
    "calendar-entry-assignee",
    "calendar-entry-project",
    "calendar-entry-status",
    "calendar-entry-all-day",
    "calendar-entry-start-date",
    "calendar-entry-start-time",
    "calendar-entry-end-date",
    "calendar-entry-end-time",
    "calendar-entry-description",
  ].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.disabled = disabled;
  });
}

function syncEntryProjectDefaults() {
  const select = document.getElementById("calendar-entry-project");
  const titleInput = document.getElementById("calendar-entry-title");
  const descInput = document.getElementById("calendar-entry-description");
  if (!select || !titleInput || !descInput) return;

  const previousProject = getProjectById(state.entryLastProjectId);
  const project = getProjectById(select.value);
  const previousTitle = getProjectTitle(previousProject);
  const nextTitle = getProjectTitle(project);

  if (project) {
    if (!titleInput.value.trim() || titleInput.value.trim() === previousTitle) {
      titleInput.value = nextTitle;
    }
    if (!descInput.value.trim() || descInput.value.trim() === (previousProject?.description || "")) {
      descInput.value = project.description || "";
    }
  } else {
    if (previousTitle && titleInput.value.trim() === previousTitle) {
      titleInput.value = "";
    }
    if (descInput.value.trim() === (previousProject?.description || "")) {
      descInput.value = "";
    }
  }

  state.entryLastProjectId = select.value;
}

function openEntryModal(entry = null, options = {}) {
  state.editingEntryId = entry?.id || null;
  state.entryModalReadOnly = entry ? !canEditEntry(entry) : false;
  state.entryAutoEnd = !entry;
  state.entryLastProjectId = entry?.projectId || options.project?.id || "";
  resetMessage("calendar-entry-msg");

  document.getElementById("calendar-entry-modal-title").textContent = entry ? "Edit Calendar Item" : "Create Calendar Item";
  document.getElementById("calendar-entry-title").value = entry?.title || (options.project ? getProjectTitle(options.project) : "");
  document.getElementById("calendar-entry-type").value = entry?.type || (options.project ? "assignment" : "task");
  populateEntryAssigneeSelect(entry ? [entry.assigneeUserId || entry.ownerId] : (options.assigneeUserIds || options.assigneeUserId || state.selectedUserId || state.currentUserId));
  populateEntryProjectSelect(entry?.projectId || options.project?.id || "");
  document.getElementById("calendar-entry-status").value = entry?.plannedStatus || "scheduled";
  document.getElementById("calendar-entry-all-day").checked = !!entry?.allDay;
  document.getElementById("calendar-entry-description").value = entry?.description || options.project?.description || "";

  if (entry) {
    setDateTimePair("calendar-entry-start-date", "calendar-entry-start-time", toDateParts(entry.startsAt));
    setDateTimePair("calendar-entry-end-date", "calendar-entry-end-time", toDateParts(entry.endsAt));
  } else {
    const start = new Date(Math.max(state.weekStart * 1000, Date.now()));
    start.setMinutes(Math.round(start.getMinutes() / 5) * 5, 0, 0);
    const end = new Date(start.getTime() + (60 * 60 * 1000));
    setDateTimePair("calendar-entry-start-date", "calendar-entry-start-time", {
      date: toDateInputValue(Math.floor(start.getTime() / 1000)),
      hour24: String(start.getHours()).padStart(2, "0"),
      minute: String(start.getMinutes()).padStart(2, "0"),
    });
    setDateTimePair("calendar-entry-end-date", "calendar-entry-end-time", {
      date: toDateInputValue(Math.floor(end.getTime() / 1000)),
      hour24: String(end.getHours()).padStart(2, "0"),
      minute: String(end.getMinutes()).padStart(2, "0"),
    });
    syncEntryEndFromStart(true);
  }

  setEntryFormDisabled(state.entryModalReadOnly);
  document.getElementById("calendar-entry-save-btn")?.classList.toggle("hidden", state.entryModalReadOnly);
  document.getElementById("calendar-entry-delete-btn")?.classList.toggle("hidden", !entry || state.entryModalReadOnly);
  syncEntryFormAllDay();
  syncEntryProjectDefaults();
  document.getElementById("calendar-entry-modal")?.classList.remove("hidden");
}

function closeEntryModal() {
  document.getElementById("calendar-entry-modal")?.classList.add("hidden");
  state.editingEntryId = null;
  state.entryModalReadOnly = false;
  state.entryAutoEnd = true;
  state.entryLastProjectId = "";
}

async function saveEntry() {
  const allDay = document.getElementById("calendar-entry-all-day").checked;
  const assigneeValues = getMultiSelectValues(document.getElementById("calendar-entry-assignee"));
  const payload = {
    title: document.getElementById("calendar-entry-title").value.trim(),
    type: document.getElementById("calendar-entry-type").value,
    assigneeUserIds: assigneeValues,
    projectId: document.getElementById("calendar-entry-project").value || null,
    status: document.getElementById("calendar-entry-status").value,
    allDay,
    description: document.getElementById("calendar-entry-description").value.trim(),
  };
  if (state.editingEntryId) {
    payload.assigneeUserId = assigneeValues.find((value) => value !== "__all__") || state.currentUserId;
  }
  payload.startsAt = unixFromDateTimePair("calendar-entry-start-date", "calendar-entry-start-time", allDay, false);
  payload.endsAt = unixFromDateTimePair("calendar-entry-end-date", "calendar-entry-end-time", allDay, true);

  if (!payload.title) {
    setMessage("calendar-entry-msg", "Title is required.", true);
    return;
  }
  if (!payload.assigneeUserIds.length) {
    setMessage("calendar-entry-msg", "Choose at least one assigned user.", true);
    return;
  }
  if (!payload.startsAt || !payload.endsAt || payload.endsAt < payload.startsAt) {
    setMessage("calendar-entry-msg", "Please choose a valid start and end.", true);
    return;
  }

  try {
    const url = state.editingEntryId ? `/api/calendar/entries/${state.editingEntryId}` : "/api/calendar/entries";
    const method = state.editingEntryId ? "PUT" : "POST";
    await fetchJson(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeEntryModal();
    await refreshCalendarData();
  } catch (error) {
    setMessage("calendar-entry-msg", error.message, true);
  }
}

async function deleteEntry() {
  if (!state.editingEntryId) return;
  try {
    await fetchJson(`/api/calendar/entries/${state.editingEntryId}`, { method: "DELETE" });
    closeEntryModal();
    await refreshCalendarData();
  } catch (error) {
    setMessage("calendar-entry-msg", error.message, true);
  }
}

function updateProjectEstimatePreview() {
  const estimateMode = document.getElementById("calendar-project-estimate-mode")?.value || "hours";
  const estimateValue = Number.parseFloat(document.getElementById("calendar-project-estimate-value")?.value) || 0;
  const dailyRate = Number.parseFloat(document.getElementById("calendar-project-rate")?.value) || 0;
  const dailyHours = Number(state.settings.dailyHours || 7.6);
  const estimatedDays = estimateMode === "days" ? estimateValue : (dailyHours > 0 ? estimateValue / dailyHours : 0);
  document.getElementById("calendar-project-estimated-cost").textContent = formatCurrency(estimatedDays * dailyRate);
}

function openProjectModal(project = null) {
  state.editingProjectId = project?.id || null;
  resetMessage("calendar-project-msg");
  document.getElementById("calendar-project-modal-title").textContent = project ? "Edit Project" : "Create Project";
  document.getElementById("calendar-project-code").value = project?.code || "";
  document.getElementById("calendar-project-name").value = project?.name || "";
  document.getElementById("calendar-project-client").value = project?.clientName || "";
  document.getElementById("calendar-project-type").value = project?.projectType || "";
  document.getElementById("calendar-project-status").value = project?.status || "active";
  document.getElementById("calendar-project-color").value = project?.color || "slate";
  document.getElementById("calendar-project-estimate-mode").value = project?.estimatedMode || "hours";
  document.getElementById("calendar-project-estimate-value").value = project?.estimatedValue || 0;
  document.getElementById("calendar-project-rate").value = project?.billableRate || 0;
  document.getElementById("calendar-project-start-date").value = project?.startsAt ? toDateInputValue(project.startsAt) : "";
  document.getElementById("calendar-project-end-date").value = project?.endsAt ? toDateInputValue(project.endsAt) : "";
  document.getElementById("calendar-project-description").value = project?.description || "";
  document.getElementById("calendar-project-notes").value = project?.notes || "";
  document.getElementById("calendar-project-delete-btn")?.classList.toggle("hidden", !project);
  updateProjectEstimatePreview();
  document.getElementById("calendar-project-modal")?.classList.remove("hidden");
}

function closeProjectModal() {
  document.getElementById("calendar-project-modal")?.classList.add("hidden");
  state.editingProjectId = null;
}

async function saveProject() {
  const payload = {
    code: document.getElementById("calendar-project-code").value.trim(),
    name: document.getElementById("calendar-project-name").value.trim(),
    clientName: document.getElementById("calendar-project-client").value.trim(),
    projectType: document.getElementById("calendar-project-type").value.trim(),
    status: document.getElementById("calendar-project-status").value,
    color: document.getElementById("calendar-project-color").value,
    estimatedMode: document.getElementById("calendar-project-estimate-mode").value,
    estimatedValue: Number.parseFloat(document.getElementById("calendar-project-estimate-value").value) || 0,
    billableRate: Number.parseFloat(document.getElementById("calendar-project-rate").value) || 0,
    startsAt: document.getElementById("calendar-project-start-date").value ? Math.floor(new Date(`${document.getElementById("calendar-project-start-date").value}T00:00`).getTime() / 1000) : null,
    endsAt: document.getElementById("calendar-project-end-date").value ? Math.floor(new Date(`${document.getElementById("calendar-project-end-date").value}T23:59`).getTime() / 1000) : null,
    description: document.getElementById("calendar-project-description").value.trim(),
    notes: document.getElementById("calendar-project-notes").value.trim(),
  };

  if (!payload.name) {
    setMessage("calendar-project-msg", "Project name is required.", true);
    return;
  }

  try {
    const url = state.editingProjectId ? `/api/calendar/projects/${state.editingProjectId}` : "/api/calendar/projects";
    const method = state.editingProjectId ? "PUT" : "POST";
    await fetchJson(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeProjectModal();
    await refreshCalendarData();
  } catch (error) {
    setMessage("calendar-project-msg", error.message, true);
  }
}

async function deleteProject() {
  if (!state.editingProjectId) return;
  try {
    await fetchJson(`/api/calendar/projects/${state.editingProjectId}`, { method: "DELETE" });
    closeProjectModal();
    await refreshCalendarData();
  } catch (error) {
    setMessage("calendar-project-msg", error.message, true);
  }
}

function populateAllocationProjectSelect(selectedId = "") {
  const select = document.getElementById("calendar-allocation-project");
  if (!select) return;
  select.innerHTML = state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(getProjectTitle(project))}</option>`).join("");
  if (selectedId) select.value = selectedId;
}

function populateAllocationAssigneeSelect(selectedId = "") {
  const select = document.getElementById("calendar-allocation-assignee");
  if (!select) return;
  const users = state.capabilities.canAssignOthers ? state.availableUsers : state.availableUsers.filter((user) => user.id === state.currentUserId);
  select.innerHTML = users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.username)}</option>`).join("");
  const fallbackId = selectedId || (state.selectedUserId !== "all" ? state.selectedUserId : "") || state.currentUserId || "";
  select.value = users.some((user) => user.id === fallbackId) ? fallbackId : (state.currentUserId || users[0]?.id || "");
}

function syncAllocationProjectDefaults() {
  const project = getProjectById(document.getElementById("calendar-allocation-project")?.value || "");
  if (!project) return;
  const titleInput = document.getElementById("calendar-allocation-title");
  const descInput = document.getElementById("calendar-allocation-description");
  if (titleInput && !titleInput.value.trim()) {
    titleInput.value = getProjectTitle(project);
  }
  if (descInput && !descInput.value.trim()) {
    descInput.value = project.description || "";
  }
}

function syncAllocationMode() {
  const mode = document.getElementById("calendar-allocation-mode")?.value || "daily";
  document.getElementById("calendar-allocation-daily-fields")?.classList.toggle("hidden", mode !== "daily");
  document.getElementById("calendar-allocation-hours-wrap")?.classList.toggle("hidden", mode !== "daily");
  document.getElementById("calendar-allocation-workdays-wrap")?.classList.toggle("hidden", mode !== "daily");
  document.getElementById("calendar-allocation-custom-fields")?.classList.toggle("hidden", mode !== "custom");
}

function openAllocationModal(project = null) {
  resetMessage("calendar-allocation-msg");
  populateAllocationProjectSelect(project?.id || "");
  populateAllocationAssigneeSelect(state.selectedUserId || state.currentUserId);
  document.getElementById("calendar-allocation-title").value = project ? getProjectTitle(project) : "";
  document.getElementById("calendar-allocation-description").value = project?.description || "";
  document.getElementById("calendar-allocation-mode").value = "daily";
  document.getElementById("calendar-allocation-status").value = "scheduled";
  document.getElementById("calendar-allocation-hours-per-day").value = Number(state.settings.dailyHours || 7.6).toFixed(1);
  document.getElementById("calendar-allocation-workdays-only").checked = true;

  const start = new Date(Math.max(state.weekStart * 1000, Date.now()));
  const end = new Date(start.getTime() + DAY_SECONDS * 1000);
  document.getElementById("calendar-allocation-start-date").value = toDateInputValue(Math.floor(start.getTime() / 1000));
  document.getElementById("calendar-allocation-end-date").value = toDateInputValue(Math.floor(end.getTime() / 1000));
  document.getElementById("calendar-allocation-custom-start-date").value = toDateInputValue(Math.floor(start.getTime() / 1000));
  document.getElementById("calendar-allocation-custom-end-date").value = toDateInputValue(Math.floor(end.getTime() / 1000));
  setDateTimePair("", "calendar-allocation-custom-start-time", { hour24: "09", minute: "00" });
  setDateTimePair("", "calendar-allocation-custom-end-time", { hour24: "17", minute: "00" });
  syncAllocationMode();
  document.getElementById("calendar-allocation-modal")?.classList.remove("hidden");
}

function closeAllocationModal() {
  document.getElementById("calendar-allocation-modal")?.classList.add("hidden");
}

async function saveAllocation() {
  const allocationMode = document.getElementById("calendar-allocation-mode").value;
  const payload = {
    projectId: document.getElementById("calendar-allocation-project").value,
    assigneeUserId: document.getElementById("calendar-allocation-assignee").value,
    allocationMode,
    title: document.getElementById("calendar-allocation-title").value.trim(),
    description: document.getElementById("calendar-allocation-description").value.trim(),
    status: document.getElementById("calendar-allocation-status").value,
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  };

  if (!payload.projectId) {
    setMessage("calendar-allocation-msg", "Project selection is required.", true);
    return;
  }

  if (allocationMode === "daily") {
    payload.startDate = document.getElementById("calendar-allocation-start-date").value;
    payload.endDate = document.getElementById("calendar-allocation-end-date").value;
    payload.hoursPerDay = Number.parseFloat(document.getElementById("calendar-allocation-hours-per-day").value) || Number(state.settings.dailyHours || 7.6);
    payload.workdaysOnly = document.getElementById("calendar-allocation-workdays-only").checked;
  } else {
    payload.startsAt = unixFromDateTimePair("calendar-allocation-custom-start-date", "calendar-allocation-custom-start-time", false, false);
    payload.endsAt = unixFromDateTimePair("calendar-allocation-custom-end-date", "calendar-allocation-custom-end-time", false, false);
  }

  try {
    await fetchJson("/api/calendar/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeAllocationModal();
    await refreshCalendarData();
  } catch (error) {
    setMessage("calendar-allocation-msg", error.message, true);
  }
}

function initTimeModal() {
  const modal = document.getElementById("calendar-time-modal");
  const closeBtn = document.getElementById("calendar-time-modal-close");
  const cancelBtn = document.getElementById("calendar-time-cancel");
  const saveBtn = document.getElementById("calendar-time-save");
  const heading = document.getElementById("calendar-time-modal-heading");
  const hourDisplay = document.getElementById("calendar-time-hour-display");
  const minuteDisplay = document.getElementById("calendar-time-minute-display");
  const amBtn = document.getElementById("calendar-time-am");
  const pmBtn = document.getElementById("calendar-time-pm");
  const hourFace = document.getElementById("bulletin-clock-hour-face");
  const minuteFace = document.getElementById("bulletin-clock-minute-face");
  const hand = document.getElementById("bulletin-clock-hand");
  if (!modal || !closeBtn || !cancelBtn || !saveBtn || !heading || !hourDisplay || !minuteDisplay || !amBtn || !pmBtn || !hourFace || !minuteFace || !hand) return;

  hourFace.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const value = index + 1;
    return `<button type="button" class="bulletin-clock-option" data-time-hour="${value}">${value}</button>`;
  }).join("");
  minuteFace.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const value = String(index * 5).padStart(2, "0");
    return `<button type="button" class="bulletin-clock-option bulletin-clock-minute-option" data-time-minute="${value}">${value}</button>`;
  }).join("");

  function closeModal() {
    modal.classList.add("hidden");
    state.activeTimeFieldId = null;
    state.activeTimeView = "hour";
    state.pendingTimeValue = null;
  }

  function syncDisplay() {
    if (!state.pendingTimeValue) return;
    const hour24 = parseInt(state.pendingTimeValue.hour24, 10) || 0;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    hourDisplay.textContent = String(hour12).padStart(2, "0");
    minuteDisplay.textContent = state.pendingTimeValue.minute;
    hourDisplay.classList.toggle("active", state.activeTimeView === "hour");
    minuteDisplay.classList.toggle("active", state.activeTimeView === "minute");
    amBtn.classList.toggle("active", period === "AM");
    pmBtn.classList.toggle("active", period === "PM");
    hourFace.classList.toggle("hidden", state.activeTimeView !== "hour");
    minuteFace.classList.toggle("hidden", state.activeTimeView !== "minute");

    hourFace.querySelectorAll("[data-time-hour]").forEach((button) => {
      button.classList.toggle("active", parseInt(button.dataset.timeHour, 10) === hour12);
    });
    minuteFace.querySelectorAll("[data-time-minute]").forEach((button) => {
      button.classList.toggle("active", button.dataset.timeMinute === state.pendingTimeValue.minute);
    });

    const hourAngle = hour12 === 12 ? 0 : hour12;
    const minuteAngle = Math.round((parseInt(state.pendingTimeValue.minute, 10) || 0) / 5) % 12;
    hand.dataset.clockAngle = String(state.activeTimeView === "hour" ? hourAngle : minuteAngle);
  }

  function setPeriod(period) {
    if (!state.pendingTimeValue) return;
    let hour24 = parseInt(state.pendingTimeValue.hour24, 10) || 0;
    const hour12 = hour24 % 12 || 12;
    hour24 = period === "PM"
      ? (hour12 === 12 ? 12 : hour12 + 12)
      : (hour12 === 12 ? 0 : hour12);
    state.pendingTimeValue.hour24 = String(hour24).padStart(2, "0");
    syncDisplay();
  }

  document.querySelectorAll(".bulletin-time-trigger").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      if (trigger.disabled) return;
      state.activeTimeFieldId = trigger.id;
      state.activeTimeView = "hour";
      const defaults = getDefaultTimeForField(trigger.id);
      const existingMinute = trigger.dataset.minute || defaults.minute;
      state.pendingTimeValue = {
        hour24: trigger.dataset.hour24 || defaults.hour24,
        minute: String(Math.round((parseInt(existingMinute, 10) || 0) / 5) * 5).padStart(2, "0").replace(/^60$/, "55"),
      };
      heading.textContent = trigger.dataset.timeLabel || "Choose time";
      modal.classList.remove("hidden");
      syncDisplay();
    });
  });

  hourDisplay.addEventListener("click", () => {
    state.activeTimeView = "hour";
    syncDisplay();
  });
  minuteDisplay.addEventListener("click", () => {
    state.activeTimeView = "minute";
    syncDisplay();
  });
  amBtn.addEventListener("click", () => setPeriod("AM"));
  pmBtn.addEventListener("click", () => setPeriod("PM"));

  hourFace.addEventListener("click", (event) => {
    const button = event.target.closest("[data-time-hour]");
    if (!button || !state.pendingTimeValue) return;
    const selectedHour = parseInt(button.dataset.timeHour, 10);
    const currentPeriod = (parseInt(state.pendingTimeValue.hour24, 10) || 0) >= 12 ? "PM" : "AM";
    const hour24 = currentPeriod === "PM"
      ? (selectedHour === 12 ? 12 : selectedHour + 12)
      : (selectedHour === 12 ? 0 : selectedHour);
    state.pendingTimeValue.hour24 = String(hour24).padStart(2, "0");
    state.activeTimeView = "minute";
    syncDisplay();
  });

  minuteFace.addEventListener("click", (event) => {
    const button = event.target.closest("[data-time-minute]");
    if (!button || !state.pendingTimeValue) return;
    state.pendingTimeValue.minute = button.dataset.timeMinute;
    syncDisplay();
  });

  saveBtn.addEventListener("click", () => {
    if (!state.activeTimeFieldId || !state.pendingTimeValue) {
      closeModal();
      return;
    }
    const activeFieldId = state.activeTimeFieldId;
    setDateTimePair("", state.activeTimeFieldId, state.pendingTimeValue);
    closeModal();
    if (activeFieldId === "calendar-entry-start-time") {
      syncEntryEndFromStart(true);
    } else if (activeFieldId === "calendar-entry-end-time") {
      state.entryAutoEnd = false;
    }
  });

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
}

async function refreshCalendarData() {
  state.statsData = null;
  await loadBootstrap();
  if (state.currentView === "stats") {
    await loadStats();
  }
  setCurrentView(state.currentView);
}

function initEvents() {
  document.getElementById("calendar-prev-range")?.addEventListener("click", async () => {
    state.weekStart = shiftScheduleAnchor(-1);
    await refreshCalendarData();
  });
  document.getElementById("calendar-next-range")?.addEventListener("click", async () => {
    state.weekStart = shiftScheduleAnchor(1);
    await refreshCalendarData();
  });
  document.getElementById("calendar-current-range")?.addEventListener("click", async () => {
    state.weekStart = getCurrentScheduleAnchor();
    await refreshCalendarData();
  });
  document.querySelectorAll("[data-schedule-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll("[data-schedule-view]").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      state.scheduleView = button.dataset.scheduleView;
      state.weekStart = getCurrentScheduleAnchor();
      await refreshCalendarData();
    });
  });
  document.getElementById("calendar-schedule-user-trigger")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleScheduleScopeDropdown();
  });
  document.getElementById("calendar-schedule-user-options")?.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.scheduleScopeValue) return;
    await applyScheduleScopeSelection(input.dataset.scheduleScopeValue);
  });
  document.getElementById("calendar-add-entry-btn")?.addEventListener("click", () => openEntryModal());
  document.getElementById("calendar-add-project-btn")?.addEventListener("click", () => openProjectModal());
  document.getElementById("calendar-add-allocation-btn")?.addEventListener("click", () => openAllocationModal());

  document.getElementById("calendar-entry-all-day")?.addEventListener("change", syncEntryFormAllDay);
  document.getElementById("calendar-entry-start-date")?.addEventListener("change", () => syncEntryEndFromStart(true));
  document.getElementById("calendar-entry-end-date")?.addEventListener("change", () => {
    state.entryAutoEnd = false;
    syncEntryEndFromStart();
  });
  document.querySelectorAll("[data-calendar-date-picker]").forEach((button) => {
    button.addEventListener("click", () => openNativeDatePicker(button.dataset.calendarDatePicker));
  });
  document.getElementById("calendar-entry-assignee-trigger")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleEntryAssigneeDropdown();
  });
  document.getElementById("calendar-entry-assignee-options")?.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
      syncEntryAssigneeSelectionFromCheckboxes();
    }
  });
  document.getElementById("calendar-entry-project")?.addEventListener("change", syncEntryProjectDefaults);
  document.getElementById("calendar-entry-save-btn")?.addEventListener("click", saveEntry);
  document.getElementById("calendar-entry-delete-btn")?.addEventListener("click", deleteEntry);
  document.getElementById("calendar-entry-cancel-btn")?.addEventListener("click", closeEntryModal);
  document.getElementById("calendar-entry-modal-close")?.addEventListener("click", closeEntryModal);
  document.getElementById("calendar-entry-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "calendar-entry-modal") closeEntryModal();
  });
  document.getElementById("calendar-day-modal-close")?.addEventListener("click", closeDayModal);
  document.getElementById("calendar-day-modal-cancel")?.addEventListener("click", closeDayModal);
  document.getElementById("calendar-day-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "calendar-day-modal") closeDayModal();
  });
  document.addEventListener("click", (event) => {
    const dropdown = document.getElementById("calendar-entry-assignee-dropdown");
    const trigger = document.getElementById("calendar-entry-assignee-trigger");
    const wrap = document.getElementById("calendar-entry-owner-wrap");
    if (!dropdown || !trigger || !wrap) return;
    if (wrap.contains(event.target)) return;
    dropdown.classList.add("hidden");
  });
  document.addEventListener("click", (event) => {
    const dropdown = document.getElementById("calendar-schedule-user-dropdown");
    const wrap = document.getElementById("calendar-scope-wrap");
    if (!dropdown || !wrap) return;
    if (wrap.contains(event.target)) return;
    dropdown.classList.add("hidden");
  });

  ["calendar-project-estimate-mode", "calendar-project-estimate-value", "calendar-project-rate"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateProjectEstimatePreview);
    document.getElementById(id)?.addEventListener("change", updateProjectEstimatePreview);
  });
  document.getElementById("calendar-project-save-btn")?.addEventListener("click", saveProject);
  document.getElementById("calendar-project-delete-btn")?.addEventListener("click", deleteProject);
  document.getElementById("calendar-project-cancel-btn")?.addEventListener("click", closeProjectModal);
  document.getElementById("calendar-project-modal-close")?.addEventListener("click", closeProjectModal);
  document.getElementById("calendar-project-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "calendar-project-modal") closeProjectModal();
  });

  document.getElementById("calendar-allocation-project")?.addEventListener("change", syncAllocationProjectDefaults);
  document.getElementById("calendar-allocation-mode")?.addEventListener("change", syncAllocationMode);
  document.getElementById("calendar-allocation-save-btn")?.addEventListener("click", saveAllocation);
  document.getElementById("calendar-allocation-cancel-btn")?.addEventListener("click", closeAllocationModal);
  document.getElementById("calendar-allocation-modal-close")?.addEventListener("click", closeAllocationModal);
  document.getElementById("calendar-allocation-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "calendar-allocation-modal") closeAllocationModal();
  });

  document.querySelectorAll(".calendar-period-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".calendar-period-btn").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      state.statsPeriod = button.dataset.period;
      state.statsAnchor = getCurrentStatsAnchor(state.statsPeriod);
      await loadStats();
    });
  });
  document.getElementById("calendar-stats-prev")?.addEventListener("click", async () => {
    state.statsAnchor = shiftStatsAnchor(state.statsAnchor, state.statsPeriod, -1);
    await loadStats();
  });
  document.getElementById("calendar-stats-next")?.addEventListener("click", async () => {
    state.statsAnchor = shiftStatsAnchor(state.statsAnchor, state.statsPeriod, 1);
    await loadStats();
  });
  document.getElementById("calendar-stats-current")?.addEventListener("click", async () => {
    state.statsAnchor = getCurrentStatsAnchor(state.statsPeriod);
    await loadStats();
  });
  document.getElementById("calendar-stats-scope")?.addEventListener("change", async (event) => {
    state.statsScope = event.target.value;
    await loadStats();
  });
}

async function init() {
  setCurrentView("personal");
  initViewSwitching();
  initSidebarCollapse();
  initTimeModal();
  initEvents();
  await loadBootstrap();
}

init().catch((error) => {
  const target = document.getElementById("calendar-personal-grid");
  if (target) target.innerHTML = `<p class="text-sm text-error">${escapeHtml(error.message)}</p>`;
});
