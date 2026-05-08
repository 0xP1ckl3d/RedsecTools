const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const {
  createCalendarProject,
  updateCalendarProject,
  listCalendarProjects,
  getCalendarProjectById,
  deleteCalendarProjectById,
  listCalendarUsersBasic,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntryById,
  getCalendarEntryById,
  listCalendarEntries,
  getSetting,
} = require("../database");

const router = Router();

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const FAR_FUTURE_UNIX = 4102444800;
const CALENDAR_PROJECT_STATUSES = new Set(["active", "proposed", "on_hold", "complete", "archived"]);
const CALENDAR_ENTRY_TYPES = new Set(["task", "assignment", "meeting", "leave", "personal_leave", "annual_leave", "public_holiday", "reminder", "project"]);
const CALENDAR_ENTRY_STATUSES = new Set(["scheduled", "tentative"]);
const CALENDAR_SCHEDULE_VIEWS = new Set(["week", "month"]);
const CALENDAR_STAT_PERIODS = new Set(["week", "month", "year"]);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: { error: "Too many calendar requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function requireCalendarView(req, res, next) {
  if (!req.access.permissionSet.has("calendar.view") && !req.access.permissionSet.has("calendar.view_team") && !req.access.permissionSet.has("calendar.manage")) {
    return res.status(403).json({ error: "Calendar access denied" });
  }
  next();
}

function requireCalendarCreate(req, res, next) {
  if (!req.access.permissionSet.has("calendar.create") && !req.access.permissionSet.has("calendar.manage")) {
    return res.status(403).json({ error: "Calendar create access denied" });
  }
  next();
}

function canManageCalendar(req) {
  return req.access.permissionSet.has("calendar.manage");
}

function canViewTeamCalendar(req) {
  return req.access.permissionSet.has("calendar.view_team") || canManageCalendar(req);
}

function canAssignOthers(req) {
  return canManageCalendar(req);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeUnix(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProjectStatus(value) {
  return CALENDAR_PROJECT_STATUSES.has(value) ? value : "active";
}

function normalizeEntryType(value) {
  if (value === "leave") return "personal_leave";
  return CALENDAR_ENTRY_TYPES.has(value) ? value : "task";
}

function normalizeEntryStatus(value) {
  return CALENDAR_ENTRY_STATUSES.has(value) ? value : "scheduled";
}

function parseClockTimeToMinutes(value, fallback) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  return (hours * 60) + minutes;
}

function getCalendarSettings() {
  const parsed = Number.parseFloat(getSetting("calendar_daily_hours"));
  const dailyHours = !Number.isFinite(parsed) ? 7.6 : clamp(Number(parsed.toFixed(2)), 1, 24);
  const workdayStart = String(getSetting("calendar_workday_start") || "08:30");
  const workdayEnd = String(getSetting("calendar_workday_end") || "17:30");
  const workdays = String(getSetting("calendar_workdays") || "1,2,3,4,5")
    .split(",")
    .map((value) => parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const startMinutes = parseClockTimeToMinutes(workdayStart, 8 * 60 + 30);
  const endMinutes = parseClockTimeToMinutes(workdayEnd, 17 * 60 + 30);
  const workdaySpanHours = Math.max(1, Number((((endMinutes - startMinutes) || (9 * 60)) / 60).toFixed(2)));
  return {
    dailyHours,
    workdayStart,
    workdayEnd,
    workdays: workdays.length ? workdays : [1, 2, 3, 4, 5],
    workdayStartMinutes: startMinutes,
    workdayEndMinutes: endMinutes,
    workdaySpanHours,
  };
}

function estimateHoursFromInput(mode, value, dailyHours) {
  const safeValue = Math.max(0, Number.parseFloat(value) || 0);
  if (mode === "days") {
    return Number((safeValue * dailyHours).toFixed(2));
  }
  return Number(safeValue.toFixed(2));
}

function startOfWeekUnix(value) {
  const date = value ? new Date(value * 1000) : new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return Math.floor(date.getTime() / 1000);
}

function parseWeekStart(raw) {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? startOfWeekUnix(parsed) : startOfWeekUnix();
}

function startOfMonthUnix(value) {
  const date = value ? new Date(value * 1000) : new Date();
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return Math.floor(start.getTime() / 1000);
}

function parseScheduleRange(viewMode, anchorUnix, rangeStartUnix = null, rangeEndUnix = null) {
  if (Number.isFinite(rangeStartUnix) && Number.isFinite(rangeEndUnix) && rangeEndUnix >= rangeStartUnix) {
    const rangeStartDate = new Date(rangeStartUnix * 1000);
    return {
      startsAt: rangeStartUnix,
      endsAt: rangeEndUnix,
      anchorUnix: rangeStartUnix,
      label: viewMode === "month"
        ? rangeStartDate.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
        : `${rangeStartDate.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} to ${new Date(rangeEndUnix * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
    };
  }

  if (viewMode === "month") {
    const monthStart = startOfMonthUnix(anchorUnix);
    const monthDate = new Date(monthStart * 1000);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      startsAt: monthStart,
      endsAt: Math.floor(monthEnd.getTime() / 1000),
      anchorUnix: monthStart,
      label: monthDate.toLocaleDateString("en-AU", { month: "long", year: "numeric" }),
    };
  }

  const weekStart = parseWeekStart(anchorUnix);
  return {
    startsAt: weekStart,
    endsAt: weekStart + WEEK_SECONDS - 1,
    anchorUnix: weekStart,
    label: `${new Date(weekStart * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} to ${new Date((weekStart + WEEK_SECONDS - DAY_SECONDS) * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
  };
}

function getPeriodRange(period, anchorUnix) {
  const date = anchorUnix ? new Date(anchorUnix * 1000) : new Date();
  date.setHours(0, 0, 0, 0);

  if (period === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      startsAt: Math.floor(start.getTime() / 1000),
      endsAt: Math.floor(end.getTime() / 1000),
      label: start.toLocaleDateString("en-AU", { month: "long", year: "numeric" }),
    };
  }

  if (period === "year") {
    const start = new Date(date.getFullYear(), 0, 1);
    const end = new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
    return {
      startsAt: Math.floor(start.getTime() / 1000),
      endsAt: Math.floor(end.getTime() / 1000),
      label: String(start.getFullYear()),
    };
  }

  const weekStart = startOfWeekUnix(Math.floor(date.getTime() / 1000));
  return {
    startsAt: weekStart,
    endsAt: weekStart + WEEK_SECONDS - 1,
    label: `${new Date(weekStart * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} - ${new Date((weekStart + WEEK_SECONDS - DAY_SECONDS) * 1000).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`,
  };
}

function getCalendarCapabilities(req) {
  return {
    canView: req.access.permissionSet.has("calendar.view") || canViewTeamCalendar(req),
    canCreate: req.access.permissionSet.has("calendar.create") || canManageCalendar(req),
    canViewTeam: canViewTeamCalendar(req),
    canAssignOthers: canAssignOthers(req),
    canManageProjects: canManageCalendar(req),
    canEditAny: canManageCalendar(req),
  };
}

function getAccessibleUsers(req) {
  const users = listCalendarUsersBasic();
  const me = users.find((user) => user.id === req.user.id) || {
    id: req.user.id,
    username: req.user.username || "You",
    roleId: null,
    roleKey: null,
    roleName: null,
  };
  return { users, me };
}

function resolveSelectedUser(req, rawUserId, users, me) {
  if (!canViewTeamCalendar(req)) return me;
  if (rawUserId === "all") return { id: "all", username: "All team members", roleName: "Team" };
  if (!rawUserId) return me;
  return users.find((user) => user.id === rawUserId) || me;
}

function resolveStatsScope(req, rawScope, users, me) {
  if (!canViewTeamCalendar(req)) {
    return { scope: "mine", users: [me] };
  }
  const scope = String(rawScope || "team");
  if (scope === "mine") {
    return { scope, users: [me] };
  }
  if (scope.startsWith("user:")) {
    const userId = scope.slice(5);
    const match = users.find((user) => user.id === userId);
    return { scope, users: match ? [match] : [me] };
  }
  return { scope: "team", users };
}

function filterEntriesForUsers(entries, userIds) {
  const visibleIds = new Set(userIds);
  return entries.filter((entry) => visibleIds.has(entry.assigneeUserId || entry.ownerId));
}

function calculateEntryOverlapSeconds(entry, startsAt, endsAt) {
  const overlapStart = Math.max(entry.startsAt, startsAt);
  const overlapEnd = Math.min(entry.endsAt, endsAt);
  return Math.max(0, overlapEnd - overlapStart);
}

function toHours(seconds) {
  return Number((seconds / 3600).toFixed(2));
}

function isWorkday(unix, settings) {
  const day = new Date(unix * 1000).getDay();
  return settings.workdays.includes(day);
}

function countWorkdaysBetween(startsAt, endsAt, settings) {
  const start = new Date(startsAt * 1000);
  const end = new Date(endsAt * 1000);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  let count = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (settings.workdays.includes(cursor.getDay())) count += 1;
  }
  return count;
}

function deriveEntryStatus(entry, nowUnix = Math.floor(Date.now() / 1000)) {
  if (entry.endsAt < nowUnix) return "complete";
  if (entry.startsAt <= nowUnix && entry.endsAt >= nowUnix) return "in_progress";
  return entry.status === "tentative" ? "tentative" : "scheduled";
}

function computeEntryScheduledHours(entry, settings) {
  const countsTowardsHours = !!entry.projectId || ["leave", "personal_leave", "annual_leave", "public_holiday"].includes(entry.type);
  if (!countsTowardsHours) return 0;
  if (entry.allDay) {
    return Number((countWorkdaysBetween(entry.startsAt, entry.endsAt, settings) * settings.dailyHours).toFixed(2));
  }
  const durationHours = Math.max(0, entry.endsAt - entry.startsAt) / 3600;
  return Number(durationHours.toFixed(2));
}

function isAvailabilityReductionEntry(entry) {
  return ["leave", "personal_leave", "annual_leave", "public_holiday"].includes(entry.type);
}

function calculateScheduledHoursOverlap(entry, startsAt, endsAt) {
  const overlapSeconds = calculateEntryOverlapSeconds(entry, startsAt, endsAt);
  if (!overlapSeconds || !entry.scheduledHours) return 0;
  const totalSeconds = Math.max(1, entry.endsAt - entry.startsAt);
  return Number(((entry.scheduledHours * overlapSeconds) / totalSeconds).toFixed(2));
}

function getProjectEntryTitle(project) {
  if (!project) return "";
  return project.code ? `${project.code} · ${project.name}` : project.name;
}

function serializeEntry(entry, settings = getCalendarSettings()) {
  return {
    ...entry,
    calendarUserId: entry.assigneeUserId || entry.ownerId,
    status: deriveEntryStatus(entry),
    plannedStatus: entry.status,
    scheduledHours: Number(entry.scheduledHours || computeEntryScheduledHours(entry, settings) || 0),
  };
}

function buildProjectSummaries(projects, entries, users, settings) {
  const userMap = new Map(users.map((user) => [user.id, user]));

  return projects.map((project) => {
    const projectEntries = entries.filter((entry) => entry.projectId === project.id);
    const scheduledHours = Number(projectEntries.reduce((total, entry) => total + Number(entry.scheduledHours || 0), 0).toFixed(2));
    const completedHours = Number(projectEntries
      .filter((entry) => deriveEntryStatus(entry) === "complete")
      .reduce((total, entry) => total + Number(entry.scheduledHours || 0), 0)
      .toFixed(2));
    const assignedUsers = [...new Map(
      projectEntries
        .map((entry) => {
          const user = userMap.get(entry.assigneeUserId || entry.ownerId);
          return user ? [user.id, { id: user.id, username: user.username }] : null;
        })
        .filter(Boolean)
    ).values()];
    const estimatedHours = Number(project.estimatedHours || 0);
    const estimatedDays = settings.dailyHours > 0 ? Number((estimatedHours / settings.dailyHours).toFixed(2)) : 0;
    const scheduledPercent = estimatedHours > 0 ? Math.min(100, Math.round((scheduledHours / estimatedHours) * 100)) : 0;
    const completedPercent = estimatedHours > 0 ? Math.min(100, Math.round((completedHours / estimatedHours) * 100)) : 0;
    const estimatedCost = Number((estimatedDays * Number(project.billableRate || 0)).toFixed(2));

    return {
      ...project,
      scheduledHours,
      completedHours,
      assignedUsers,
      assignmentCount: projectEntries.length,
      estimatedDays,
      estimatedCost,
      scheduledPercent,
      completedPercent,
    };
  });
}

function buildStats(entries, projects, users, settings, startsAt, endsAt) {
  const rangeEntries = entries.filter((entry) => entry.endsAt >= startsAt && entry.startsAt <= endsAt);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const projectEntries = rangeEntries.filter((entry) => entry.projectId);
  const workdayCount = countWorkdaysBetween(startsAt, endsAt, settings);

  const scheduledHours = Number(projectEntries.reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0).toFixed(2));
  const completedHours = Number(projectEntries
    .filter((entry) => deriveEntryStatus(entry) === "complete")
    .reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0)
    .toFixed(2));

  const revenue = projectEntries.reduce((sum, entry) => {
    if (!entry.projectId) return sum;
    const project = projectMap.get(entry.projectId);
    if (!project) return sum;
    const overlapHours = calculateScheduledHoursOverlap(entry, startsAt, endsAt);
    return sum + ((overlapHours / settings.dailyHours) * Number(project.billableRate || 0));
  }, 0);

  const userStats = users.map((user) => {
    const userEntries = projectEntries.filter((entry) => (entry.assigneeUserId || entry.ownerId) === user.id);
    const leaveEntries = rangeEntries.filter((entry) => isAvailabilityReductionEntry(entry) && (entry.assigneeUserId || entry.ownerId) === user.id);
    const userScheduled = Number(userEntries.reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0).toFixed(2));
    const userCompleted = Number(userEntries
      .filter((entry) => deriveEntryStatus(entry) === "complete")
      .reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0)
      .toFixed(2));
    const leaveHours = Number(leaveEntries.reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0).toFixed(2));
    const capacity = Number(Math.max(0, (workdayCount * settings.dailyHours) - leaveHours).toFixed(2));
    const projectCount = new Set(userEntries.map((entry) => entry.projectId)).size;
    const utilizationPercent = capacity > 0 ? Math.min(999, Math.round((userScheduled / capacity) * 100)) : 0;

    return {
      id: user.id,
      username: user.username,
      roleName: user.roleName || "",
      scheduledHours: userScheduled,
      completedHours: userCompleted,
      capacityHours: capacity,
      leaveHours,
      remainingHours: Number(Math.max(0, capacity - userScheduled).toFixed(2)),
      utilizationPercent,
      projectCount,
      assignmentCount: userEntries.length,
    };
  });

  const capacityHours = Number(userStats.reduce((sum, item) => sum + Number(item.capacityHours || 0), 0).toFixed(2));
  const leaveHours = Number(userStats.reduce((sum, item) => sum + Number(item.leaveHours || 0), 0).toFixed(2));

  const projectStats = projects.map((project) => {
    const relatedEntries = projectEntries.filter((entry) => entry.projectId === project.id);
    const projectScheduled = relatedEntries.reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0);
    const projectCompleted = relatedEntries
      .filter((entry) => deriveEntryStatus(entry) === "complete")
      .reduce((sum, entry) => sum + calculateScheduledHoursOverlap(entry, startsAt, endsAt), 0);
    const projectRevenue = projectEntries.reduce((sum, entry) => {
      if (entry.projectId !== project.id) return sum;
      const overlapHours = calculateScheduledHoursOverlap(entry, startsAt, endsAt);
      return sum + ((overlapHours / settings.dailyHours) * Number(project.billableRate || 0));
    }, 0);

    return {
      id: project.id,
      code: project.code || "",
      name: project.name,
      clientName: project.clientName || "",
      scheduledHours: Number(projectScheduled.toFixed(2)),
      completedHours: Number(projectCompleted.toFixed(2)),
      estimatedCost: Number((((project.estimatedHours || 0) / settings.dailyHours) * Number(project.billableRate || 0)).toFixed(2)),
      scheduledRevenue: Number(projectRevenue.toFixed(2)),
    };
  }).filter((item) => item.scheduledHours > 0 || item.completedHours > 0);

  return {
    summary: {
      scheduledHours,
      completedHours,
      capacityHours,
      leaveHours,
      remainingHours: Number(Math.max(0, capacityHours - scheduledHours).toFixed(2)),
      utilizationPercent: capacityHours > 0 ? Math.min(999, Math.round((scheduledHours / capacityHours) * 100)) : 0,
      estimatedRevenue: Number(revenue.toFixed(2)),
      activeProjects: new Set(projectEntries.map((entry) => entry.projectId)).size,
      activeUsers: new Set(projectEntries.map((entry) => entry.assigneeUserId || entry.ownerId)).size,
      workdayCount,
    },
    userStats,
    projectStats,
  };
}

function parseDateRangeToUnix(startDate, endDate, tzOffsetMinutes) {
  if (!startDate || !endDate) return null;
  const offset = typeof tzOffsetMinutes === "number" ? tzOffsetMinutes * 60 * 1000 : new Date().getTimezoneOffset() * -60 * 1000;
  const startsAt = Math.floor((new Date(`${startDate}T00:00`).getTime() + offset - (new Date().getTimezoneOffset() * 60 * 1000)) / 1000);
  const endsAt = Math.floor((new Date(`${endDate}T23:59`).getTime() + offset - (new Date().getTimezoneOffset() * 60 * 1000)) / 1000);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) return null;
  return { startsAt, endsAt };
}

function buildDailyAllocationSegments(startsAt, endsAt, hoursPerDay, workdaysOnly, settings, tzOffsetMinutes) {
  const tzMs = typeof tzOffsetMinutes === "number" ? tzOffsetMinutes * 60 * 1000 : 0;
  const start = new Date(startsAt * 1000 + tzMs);
  const end = new Date(endsAt * 1000 + tzMs);
  const segments = [];
  const clampedHours = clamp(Number(hoursPerDay || 0), 0.5, settings.dailyHours);
  const segmentSpanHours = clamp(Number(((clampedHours / settings.dailyHours) * settings.workdaySpanHours).toFixed(2)), 0.5, 24);
  const startHour = Math.floor(settings.workdayStartMinutes / 60);
  const startMinute = settings.workdayStartMinutes % 60;

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (workdaysOnly && !settings.workdays.includes(cursor.getDay())) continue;
    const segmentStart = new Date(cursor);
    segmentStart.setHours(startHour, startMinute, 0, 0);
    const segmentEnd = new Date(segmentStart);
    segmentEnd.setTime(segmentStart.getTime() + (segmentSpanHours * 60 * 60 * 1000));
    segments.push({
      startsAt: Math.floor((segmentStart.getTime() - tzMs) / 1000),
      endsAt: Math.floor((segmentEnd.getTime() - tzMs) / 1000),
      allDay: false,
      scheduledHours: clampedHours,
    });
  }
  return segments;
}

function getVisibleProjectEntries(req, allEntries, userIds) {
  const filtered = filterEntriesForUsers(allEntries, userIds);
  return canViewTeamCalendar(req) ? filtered : filtered;
}

router.get("/calendar/bootstrap", requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const capabilities = getCalendarCapabilities(req);
  const settings = getCalendarSettings();
  const viewMode = CALENDAR_SCHEDULE_VIEWS.has(String(req.query.viewMode || "week")) ? String(req.query.viewMode || "week") : "week";
  const scheduleRange = parseScheduleRange(
    viewMode,
    normalizeUnix(req.query.weekStart),
    normalizeUnix(req.query.rangeStart),
    normalizeUnix(req.query.rangeEnd),
  );
  const { users, me } = getAccessibleUsers(req);
  const selectedUser = resolveSelectedUser(req, req.query.scheduleUserId, users, me);
  const teamUsers = capabilities.canViewTeam ? users : [me];
  const selectedScopeUsers = selectedUser.id === "all" ? teamUsers : [selectedUser];
  const weekEntries = listCalendarEntries({
    startsAfter: scheduleRange.startsAt,
    endsBefore: scheduleRange.endsAt,
  }).map((entry) => serializeEntry(entry, settings));
  const scheduleEntries = filterEntriesForUsers(weekEntries, selectedScopeUsers.map((user) => user.id));
  const teamProjectEntries = getVisibleProjectEntries(req, weekEntries.filter((entry) => entry.projectId), teamUsers.map((user) => user.id));
  const allVisibleEntries = filterEntriesForUsers(
    listCalendarEntries({ startsAfter: 0, endsBefore: FAR_FUTURE_UNIX }).map((entry) => serializeEntry(entry, settings)),
    teamUsers.map((user) => user.id),
  );
  const projects = buildProjectSummaries(listCalendarProjects(), allVisibleEntries, teamUsers, settings);
  const overviewStats = buildStats(
    filterEntriesForUsers(weekEntries, selectedScopeUsers.map((user) => user.id)),
    projects,
    selectedScopeUsers,
    settings,
    scheduleRange.startsAt,
    scheduleRange.endsAt,
  );

  res.json({
    capabilities,
    settings: {
      ...settings,
    },
    currentUserId: req.user.id,
    weekStart: scheduleRange.anchorUnix,
    weekEnd: scheduleRange.endsAt,
    selectedUserId: selectedUser.id,
    selectedUser,
    availableUsers: teamUsers,
    scheduleEntries,
    teamProjectEntries,
    projects,
    overviewStats,
    scheduleView: viewMode,
    scheduleLabel: scheduleRange.label,
  });
});

router.get("/calendar/stats", requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const { users, me } = getAccessibleUsers(req);
  const settings = getCalendarSettings();
  const period = CALENDAR_STAT_PERIODS.has(String(req.query.period || "week")) ? String(req.query.period || "week") : "week";
  const anchorUnix = normalizeUnix(req.query.anchor);
  const { startsAt, endsAt, label } = getPeriodRange(period, anchorUnix);
  const scopeState = resolveStatsScope(req, req.query.scope, users, me);
  const entries = filterEntriesForUsers(
    listCalendarEntries({ startsAfter: startsAt, endsBefore: endsAt }).map((entry) => serializeEntry(entry, settings)),
    scopeState.users.map((user) => user.id),
  );
  const projects = buildProjectSummaries(
    listCalendarProjects(),
    filterEntriesForUsers(listCalendarEntries({ startsAfter: 0, endsBefore: FAR_FUTURE_UNIX }).map((entry) => serializeEntry(entry, settings)), scopeState.users.map((user) => user.id)),
    scopeState.users,
    settings,
  );

  res.json({
    period,
    label,
    startsAt,
    endsAt,
    scope: scopeState.scope,
    stats: buildStats(entries, projects, scopeState.users, settings, startsAt, endsAt),
  });
});

router.get("/calendar/projects", requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const { users, me } = getAccessibleUsers(req);
  const visibleUsers = canViewTeamCalendar(req) ? users : [me];
  const settings = getCalendarSettings();
  const entries = filterEntriesForUsers(
    listCalendarEntries({ startsAfter: 0, endsBefore: FAR_FUTURE_UNIX }).map((entry) => serializeEntry(entry, settings)),
    visibleUsers.map((user) => user.id),
  );
  res.json({
    projects: buildProjectSummaries(listCalendarProjects(), entries, visibleUsers, settings),
  });
});

router.post("/calendar/projects", writeLimiter, requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  if (!canManageCalendar(req)) {
    return res.status(403).json({ error: "Calendar project management denied" });
  }

  const settings = getCalendarSettings();
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 120) {
    return res.status(400).json({ error: "Project name is required" });
  }

  const startsAt = normalizeUnix(req.body?.startsAt);
  const endsAt = normalizeUnix(req.body?.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) {
    return res.status(400).json({ error: "Project end must be after the start date" });
  }

  const estimatedMode = String(req.body?.estimatedMode || "hours") === "days" ? "days" : "hours";
  const estimatedValue = Math.max(0, Number.parseFloat(req.body?.estimatedValue) || 0);
  const estimatedHours = estimateHoursFromInput(estimatedMode, estimatedValue, settings.dailyHours);
  const id = crypto.randomBytes(16).toString("base64url");

  createCalendarProject({
    id,
    code: String(req.body?.code || "").trim().slice(0, 40),
    name,
    clientName: String(req.body?.clientName || "").trim().slice(0, 120),
    projectType: String(req.body?.projectType || "").trim().slice(0, 60),
    description: String(req.body?.description || "").trim(),
    color: String(req.body?.color || "").trim().slice(0, 32),
    status: normalizeProjectStatus(String(req.body?.status || "active")),
    startsAt,
    endsAt,
    estimatedMode,
    estimatedValue,
    estimatedHours,
    billableRate: clamp(Number.parseFloat(req.body?.billableRate) || 0, 0, 1000000),
    notes: String(req.body?.notes || "").trim(),
    createdBy: req.user.id,
  });

  res.json({ success: true, project: getCalendarProjectById(id) });
});

router.put("/calendar/projects/:id", writeLimiter, requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  if (!canManageCalendar(req)) {
    return res.status(403).json({ error: "Calendar project management denied" });
  }

  const project = getCalendarProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const settings = getCalendarSettings();
  const name = String(req.body?.name ?? project.name).trim();
  if (!name || name.length > 120) {
    return res.status(400).json({ error: "Project name is required" });
  }

  const startsAt = normalizeUnix(req.body?.startsAt ?? project.startsAt);
  const endsAt = normalizeUnix(req.body?.endsAt ?? project.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) {
    return res.status(400).json({ error: "Project end must be after the start date" });
  }

  const estimatedMode = String(req.body?.estimatedMode ?? project.estimatedMode ?? "hours") === "days" ? "days" : "hours";
  const estimatedValue = Math.max(0, Number.parseFloat(req.body?.estimatedValue ?? project.estimatedValue) || 0);
  const estimatedHours = estimateHoursFromInput(estimatedMode, estimatedValue, settings.dailyHours);

  updateCalendarProject({
    id: project.id,
    code: String(req.body?.code ?? project.code).trim().slice(0, 40),
    name,
    clientName: String(req.body?.clientName ?? project.clientName).trim().slice(0, 120),
    projectType: String(req.body?.projectType ?? project.projectType).trim().slice(0, 60),
    description: String(req.body?.description ?? project.description).trim(),
    color: String(req.body?.color ?? project.color).trim().slice(0, 32),
    status: normalizeProjectStatus(String(req.body?.status ?? project.status)),
    startsAt,
    endsAt,
    estimatedMode,
    estimatedValue,
    estimatedHours,
    billableRate: clamp(Number.parseFloat(req.body?.billableRate ?? project.billableRate) || 0, 0, 1000000),
    notes: String(req.body?.notes ?? project.notes).trim(),
  });

  res.json({ success: true, project: getCalendarProjectById(project.id) });
});

router.delete("/calendar/projects/:id", writeLimiter, requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  if (!canManageCalendar(req)) {
    return res.status(403).json({ error: "Calendar project management denied" });
  }
  const deleted = deleteCalendarProjectById(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Project not found" });
  res.json({ success: true });
});

router.post("/calendar/allocations", writeLimiter, requireUser, attachUserAccess, requireCalendarCreate, (req, res) => {
  const settings = getCalendarSettings();
  const projectId = typeof req.body?.projectId === "string" && req.body.projectId ? req.body.projectId : null;
  const project = projectId ? getCalendarProjectById(projectId) : null;
  if (!project) return res.status(400).json({ error: "Project not found" });

  const users = listCalendarUsersBasic();
  const requestedAssignee = typeof req.body?.assigneeUserId === "string" && req.body.assigneeUserId ? req.body.assigneeUserId : req.user.id;
  const assigneeUserId = canAssignOthers(req) ? requestedAssignee : req.user.id;
  if (!users.some((user) => user.id === assigneeUserId)) {
    return res.status(400).json({ error: "Assignee not found" });
  }

  const allocationMode = String(req.body?.allocationMode || "daily") === "custom" ? "custom" : "daily";
  const baseTitle = String(req.body?.title || "").trim() || getProjectEntryTitle(project);
  const description = String(req.body?.description || "").trim() || project.description || "";
  const status = normalizeEntryStatus(String(req.body?.status || "scheduled"));
  const tzOffsetMinutes = typeof req.body?.tzOffsetMinutes === "number" ? req.body.tzOffsetMinutes : undefined;
  const entriesToCreate = [];

  if (allocationMode === "daily") {
    const dateRange = parseDateRangeToUnix(req.body?.startDate, req.body?.endDate, tzOffsetMinutes);
    if (!dateRange) {
      return res.status(400).json({ error: "Choose a valid allocation date range" });
    }
    const hoursPerDay = Number.parseFloat(req.body?.hoursPerDay) || settings.dailyHours;
    const segments = buildDailyAllocationSegments(dateRange.startsAt, dateRange.endsAt, hoursPerDay, req.body?.workdaysOnly !== false, settings, tzOffsetMinutes);
    if (!segments.length) {
      return res.status(400).json({ error: "No allocation days were generated for that range" });
    }
    segments.forEach((segment) => {
      entriesToCreate.push({
        id: crypto.randomBytes(16).toString("base64url"),
        type: "assignment",
        title: baseTitle.slice(0, 160),
        description,
        ownerId: req.user.id,
        assigneeUserId,
        projectId,
        startsAt: segment.startsAt,
        endsAt: segment.endsAt,
        allDay: false,
        scheduledHours: segment.scheduledHours,
        utilizationPercent: 100,
        status,
      });
    });
  } else {
    const startsAt = normalizeUnix(req.body?.startsAt);
    const endsAt = normalizeUnix(req.body?.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
      return res.status(400).json({ error: "Choose a valid custom time range" });
    }
    entriesToCreate.push({
      id: crypto.randomBytes(16).toString("base64url"),
      type: "assignment",
      title: baseTitle.slice(0, 160),
      description,
      ownerId: req.user.id,
      assigneeUserId,
      projectId,
      startsAt,
      endsAt,
      allDay: !!req.body?.allDay,
      scheduledHours: computeEntryScheduledHours({
        projectId,
        startsAt,
        endsAt,
        allDay: !!req.body?.allDay,
      }, settings),
      utilizationPercent: 100,
      status,
    });
  }

  entriesToCreate.forEach((entry) => createCalendarEntry(entry));
  res.json({ success: true, createdCount: entriesToCreate.length });
});

router.get("/calendar/entries", requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const { users, me } = getAccessibleUsers(req);
  const settings = getCalendarSettings();
  const scopeState = resolveStatsScope(req, req.query.scope, users, me);
  const startsAfter = normalizeUnix(req.query.startsAfter) || startOfWeekUnix();
  const endsBefore = normalizeUnix(req.query.endsBefore) || (startsAfter + WEEK_SECONDS - 1);
  const entries = filterEntriesForUsers(
    listCalendarEntries({ startsAfter, endsBefore }).map((entry) => serializeEntry(entry, settings)),
    scopeState.users.map((user) => user.id),
  );
  res.json({
    scope: scopeState.scope,
    entries,
  });
});

router.post("/calendar/entries", writeLimiter, requireUser, attachUserAccess, requireCalendarCreate, (req, res) => {
  const settings = getCalendarSettings();
  const startsAt = normalizeUnix(req.body?.startsAt);
  const endsAt = normalizeUnix(req.body?.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
    return res.status(400).json({ error: "Invalid calendar time range" });
  }

  const users = listCalendarUsersBasic();
  const requestedAssigneeIds = Array.isArray(req.body?.assigneeUserIds)
    ? req.body.assigneeUserIds.map((value) => String(value || "").trim()).filter(Boolean)
    : (typeof req.body?.assigneeUserId === "string" && req.body.assigneeUserId ? [req.body.assigneeUserId] : [req.user.id]);
  const assigneeUserIds = canAssignOthers(req)
    ? (requestedAssigneeIds.includes("__all__") ? users.map((user) => user.id) : requestedAssigneeIds)
    : [req.user.id];
  const validAssigneeUserIds = [...new Set(assigneeUserIds)].filter((userId) => users.some((user) => user.id === userId));
  if (!validAssigneeUserIds.length) {
    return res.status(400).json({ error: "Assignee not found" });
  }

  const projectId = typeof req.body?.projectId === "string" && req.body.projectId ? req.body.projectId : null;
  const project = projectId ? getCalendarProjectById(projectId) : null;
  if (projectId && !project) {
    return res.status(400).json({ error: "Project not found" });
  }

  const normalizedType = normalizeEntryType(String(req.body?.type || (projectId ? "assignment" : "task")));
  const title = String(req.body?.title || "").trim() || getProjectEntryTitle(project);
  if (!title) {
    return res.status(400).json({ error: "Entry title is required" });
  }

  const createdEntries = validAssigneeUserIds.map((assigneeUserId) => {
    const id = crypto.randomBytes(16).toString("base64url");
    createCalendarEntry({
      id,
      type: normalizedType,
      title: title.slice(0, 160),
      description: String(req.body?.description || "").trim() || (project?.description || ""),
      ownerId: req.user.id,
      assigneeUserId,
      projectId,
      startsAt,
      endsAt,
      allDay: !!req.body?.allDay,
      scheduledHours: computeEntryScheduledHours({
        projectId,
        type: normalizedType,
        startsAt,
        endsAt,
        allDay: !!req.body?.allDay,
      }, settings),
      utilizationPercent: projectId ? 100 : 0,
      status: normalizeEntryStatus(String(req.body?.status || "scheduled")),
    });
    return id;
  });

  const entries = listCalendarEntries({ startsAfter: startsAt, endsBefore: endsAt })
    .map((item) => serializeEntry(item, settings))
    .filter((item) => createdEntries.includes(item.id));
  res.json({ success: true, entry: entries[0] || null, entries, createdCount: entries.length });
});

router.put("/calendar/entries/:id", writeLimiter, requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const settings = getCalendarSettings();
  const existing = getCalendarEntryById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Entry not found" });

  const canEdit = canManageCalendar(req)
    || existing.owner_id === req.user.id
    || existing.assignee_user_id === req.user.id;
  if (!canEdit) {
    return res.status(403).json({ error: "Calendar edit access denied" });
  }

  const startsAt = normalizeUnix(req.body?.startsAt ?? existing.starts_at);
  const endsAt = normalizeUnix(req.body?.endsAt ?? existing.ends_at);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) {
    return res.status(400).json({ error: "Invalid calendar time range" });
  }

  const users = listCalendarUsersBasic();
  const requestedAssignee = typeof req.body?.assigneeUserId === "string" && req.body.assigneeUserId
    ? req.body.assigneeUserId
    : (existing.assignee_user_id || existing.owner_id);
  const assigneeUserId = canAssignOthers(req) ? requestedAssignee : (existing.assignee_user_id || req.user.id);
  if (!users.some((user) => user.id === assigneeUserId)) {
    return res.status(400).json({ error: "Assignee not found" });
  }

  const projectId = typeof req.body?.projectId === "string" ? (req.body.projectId || null) : existing.project_id;
  const project = projectId ? getCalendarProjectById(projectId) : null;
  if (projectId && !project) {
    return res.status(400).json({ error: "Project not found" });
  }

  const normalizedType = normalizeEntryType(String(req.body?.type || existing.type));
  const title = String(req.body?.title ?? existing.title).trim() || getProjectEntryTitle(project);
  if (!title) {
    return res.status(400).json({ error: "Entry title is required" });
  }

  updateCalendarEntry({
    id: existing.id,
    type: normalizedType,
    title: title.slice(0, 160),
    description: String(req.body?.description ?? existing.description).trim() || (project?.description || ""),
    assigneeUserId,
    projectId,
    startsAt,
    endsAt,
    allDay: req.body?.allDay !== undefined ? !!req.body.allDay : !!existing.all_day,
    scheduledHours: computeEntryScheduledHours({
      projectId,
      type: normalizedType,
      startsAt,
      endsAt,
      allDay: req.body?.allDay !== undefined ? !!req.body.allDay : !!existing.all_day,
    }, settings),
    utilizationPercent: projectId ? 100 : 0,
    status: normalizeEntryStatus(String(req.body?.status || existing.status)),
  });

  const entry = listCalendarEntries({ startsAfter: startsAt, endsBefore: endsAt }).map((item) => serializeEntry(item, settings)).find((item) => item.id === existing.id) || null;
  res.json({ success: true, entry });
});

router.delete("/calendar/entries/:id", writeLimiter, requireUser, attachUserAccess, requireCalendarView, (req, res) => {
  const existing = getCalendarEntryById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Entry not found" });

  const canDelete = canManageCalendar(req)
    || existing.owner_id === req.user.id
    || existing.assignee_user_id === req.user.id;
  if (!canDelete) {
    return res.status(403).json({ error: "Calendar edit access denied" });
  }

  deleteCalendarEntryById(existing.id);
  res.json({ success: true });
});

module.exports = router;
