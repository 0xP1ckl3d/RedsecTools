const BULLETIN_STYLE_PRESETS = ["default", "notice", "alert", "success", "reminder"];
const BULLETIN_ANIMATION_PRESETS = ["none", "slide-left-right", "slide-through", "fade-in", "pulse-soft"];

const LEGACY_PERMISSION_ALIASES = {
  "calendar.edit_any": "calendar.view_team",
  "wiki.create": "wiki.create_team",
  "wiki.edit_any": "wiki.edit_team",
};

const PERMISSION_DEFINITIONS = [
  {
    key: "bulletin.view",
    category: "Bulletin",
    label: "View",
    description: "Read the bulletin board and homepage bulletin cards.",
  },
  {
    key: "bulletin.create",
    category: "Bulletin",
    label: "Create Own",
    description: "Create, edit, and delete your own bulletin messages.",
  },
  {
    key: "bulletin.edit_any",
    category: "Bulletin",
    label: "Edit Team",
    description: "Edit bulletin messages created by other users.",
  },
  {
    key: "bulletin.pin",
    category: "Bulletin",
    label: "Pin",
    description: "Pin or unpin bulletin messages.",
  },
  {
    key: "bulletin.manage",
    category: "Bulletin",
    label: "Manage",
    description: "Administrative bulletin management, retention, and purge controls.",
  },
  {
    key: "calendar.view",
    category: "Calendar",
    label: "View Own",
    description: "View your own calendar, personal schedule, linked projects, and personal statistics.",
  },
  {
    key: "calendar.create",
    category: "Calendar",
    label: "Create Own",
    description: "Create, edit, and delete your own calendar items, and assign project time to yourself.",
  },
  {
    key: "calendar.view_team",
    category: "Calendar",
    label: "View Team",
    description: "View team calendars, team project schedule, and team statistics without editing other users' items.",
  },
  {
    key: "calendar.manage",
    category: "Calendar",
    label: "Manage Team",
    description: "Manage projects, assign time to others, and edit or delete team calendar items.",
  },
  {
    key: "survey.create",
    category: "Survey",
    label: "Create Own",
    description: "Create and manage your own surveys and polls.",
  },
  {
    key: "survey.manage_any",
    category: "Survey",
    label: "Manage Team",
    description: "Manage other users' surveys and review wider survey operations.",
  },
  {
    key: "survey.respond_public",
    category: "Survey",
    label: "Public Responses",
    description: "Allow public response flows for created surveys.",
  },
  {
    key: "survey.view_results_any",
    category: "Survey",
    label: "View Team Results",
    description: "View results across surveys you do not own.",
  },
  {
    key: "wiki.view",
    category: "Wiki",
    label: "View",
    description: "Read the team wiki and any personal wiki pages you own.",
  },
  {
    key: "wiki.create_personal",
    category: "Wiki",
    label: "Create Personal",
    description: "Create, edit, and delete pages in your own personal wiki.",
  },
  {
    key: "wiki.create_team",
    category: "Wiki",
    label: "Create Team",
    description: "Create team wiki pages and edit or delete the team pages you created.",
  },
  {
    key: "wiki.edit_team",
    category: "Wiki",
    label: "Edit Team",
    description: "Edit, move, restore, and delete team wiki pages created by other users.",
  },
  {
    key: "wiki.manage",
    category: "Wiki",
    label: "Manage",
    description: "Manage wiki settings, structure, search defaults, and all wiki spaces.",
  },
];

const ALL_PERMISSIONS = PERMISSION_DEFINITIONS.map((permission) => permission.key);

const SYSTEM_ROLE_DEFINITIONS = [
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to shared collaboration content and personal calendar views.",
    permissions: [
      "bulletin.view",
      "calendar.view",
      "wiki.view",
    ],
  },
  {
    key: "member",
    name: "Member",
    description: "Standard team member access with self-service calendar and content creation.",
    permissions: [
      "bulletin.view",
      "bulletin.create",
      "calendar.view",
      "calendar.create",
      "survey.create",
      "survey.respond_public",
      "wiki.view",
      "wiki.create_personal",
      "wiki.create_team",
    ],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Team-level visibility and operational management across collaboration tools.",
    permissions: [
      "bulletin.view",
      "bulletin.create",
      "bulletin.edit_any",
      "bulletin.pin",
      "bulletin.manage",
      "calendar.view",
      "calendar.create",
      "calendar.view_team",
      "calendar.manage",
      "survey.create",
      "survey.manage_any",
      "survey.respond_public",
      "survey.view_results_any",
      "wiki.view",
      "wiki.create_personal",
      "wiki.create_team",
      "wiki.edit_team",
      "wiki.manage",
    ],
  },
];

const TOOL_DEFINITIONS = [
  { key: "paste", name: "RedSecPaste", href: "/paste" },
  { key: "share", name: "RedSecShare", href: "/share" },
  { key: "chat", name: "RedSecTeam", href: "/chat" },
  { key: "vault", name: "RedSecVault", href: "/vault" },
  { key: "calendar", name: "RedSecCal", href: "/calendar", permissionsAny: ["calendar.view"] },
  { key: "survey", name: "RedSecSurvey", href: "/survey", permissionsAny: ["survey.create", "survey.manage_any", "survey.view_results_any"] },
  { key: "wiki", name: "RedSecWiki", href: "/wiki", permissionsAny: ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"] },
];

function canonicalizePermission(permission) {
  return LEGACY_PERMISSION_ALIASES[String(permission || "").trim()] || String(permission || "").trim();
}

function isValidPermission(permission) {
  return ALL_PERMISSIONS.includes(canonicalizePermission(permission));
}

function normalizePermissionList(permissions) {
  if (!Array.isArray(permissions)) return [];
  return [...new Set(
    permissions
      .map(canonicalizePermission)
      .filter(isValidPermission)
  )].sort();
}

function hasPermission(permissionSet, permission) {
  const canonicalPermission = canonicalizePermission(permission);
  return permissionSet instanceof Set
    ? permissionSet.has(canonicalPermission)
    : Array.isArray(permissionSet)
      ? permissionSet.includes(canonicalPermission)
      : false;
}

function isToolAvailable(tool, permissionSet) {
  if (!tool.permission && !Array.isArray(tool.permissionsAny)) return true;
  if (tool.permission) return hasPermission(permissionSet, tool.permission);
  return tool.permissionsAny.some((permission) => hasPermission(permissionSet, permission));
}

function getAvailableTools(permissionSet) {
  return TOOL_DEFINITIONS.filter((tool) => isToolAvailable(tool, permissionSet)).map((tool) => ({
    key: tool.key,
    name: tool.name,
    href: tool.href,
  }));
}

function isValidBulletinStylePreset(value) {
  return BULLETIN_STYLE_PRESETS.includes(value);
}

function isValidBulletinAnimationPreset(value) {
  return BULLETIN_ANIMATION_PRESETS.includes(value);
}

module.exports = {
  ALL_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLE_DEFINITIONS,
  TOOL_DEFINITIONS,
  BULLETIN_STYLE_PRESETS,
  BULLETIN_ANIMATION_PRESETS,
  canonicalizePermission,
  isValidPermission,
  normalizePermissionList,
  getAvailableTools,
  isToolAvailable,
  isValidBulletinStylePreset,
  isValidBulletinAnimationPreset,
};
