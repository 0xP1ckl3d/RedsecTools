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
  {
    key: "threat.view",
    category: "Threat Intel",
    label: "View",
    description: "Use the personal threat dashboard, manage your own keywords and tags, and review your own alerts and IOC data.",
  },
  {
    key: "threat.manage",
    category: "Threat Intel",
    label: "Manage",
    description: "Legacy elevated RedSecThreat access. Global feed, template, and notification policy changes still require the admin panel.",
  },
  {
    key: "reporter.view",
    category: "Reporter",
    label: "View",
    description: "Open RedSecReporter and view assigned projects only, plus shared designs and finding templates. Does not grant visibility into every project.",
  },
  {
    key: "reporter.create",
    category: "Reporter",
    label: "Create",
    description: "Create new report projects.",
  },
  {
    key: "reporter.edit_own",
    category: "Reporter",
    label: "Edit Own",
    description: "Edit assigned reports and findings the user created. Project membership is still required.",
  },
  {
    key: "reporter.edit_assigned",
    category: "Reporter",
    label: "Edit Assigned",
    description: "Edit reports where the user is assigned as a project member.",
  },
  {
    key: "reporter.review",
    category: "Reporter",
    label: "Review",
    description: "Review and change finding statuses.",
  },
  {
    key: "reporter.approve",
    category: "Reporter",
    label: "Approve",
    description: "Approve final report status.",
  },
  {
    key: "reporter.manage_templates",
    category: "Reporter",
    label: "Manage Templates",
    description: "Create, edit, and delete report designs and finding templates.",
  },
  {
    key: "reporter.manage_all",
    category: "Reporter",
    label: "Manage All",
    description: "View and manage every report project regardless of project membership, including global Reporter stats.",
  },
  {
    key: "engage.view_own",
    category: "Engage",
    label: "View Own",
    description: "View engagements and opportunities where you are a team member or owner.",
  },
  {
    key: "engage.view_team",
    category: "Engage",
    label: "View Team",
    description: "View all team engagements, opportunities, and clients.",
  },
  {
    key: "engage.view_all",
    category: "Engage",
    label: "View All",
    description: "View all engagements, opportunities, clients, and commercial data across the organisation.",
  },
  {
    key: "engage.create_client",
    category: "Engage",
    label: "Create Client",
    description: "Create new clients and client contacts.",
  },
  {
    key: "engage.edit_client",
    category: "Engage",
    label: "Edit Client",
    description: "Edit existing clients and client contacts.",
  },
  {
    key: "engage.create_opportunity",
    category: "Engage",
    label: "Create Opportunity",
    description: "Create new opportunities in the pipeline.",
  },
  {
    key: "engage.edit_opportunity",
    category: "Engage",
    label: "Edit Opportunity",
    description: "Edit existing opportunities and change stages.",
  },
  {
    key: "engage.manage_commercials",
    category: "Engage",
    label: "Manage Commercials",
    description: "View and edit commercial values, quoted amounts, and pipeline financials.",
  },
  {
    key: "engage.create_engagement",
    category: "Engage",
    label: "Create Engagement",
    description: "Create new engagements from won opportunities or directly.",
  },
  {
    key: "engage.edit_engagement",
    category: "Engage",
    label: "Edit Engagement",
    description: "Edit existing engagements, update statuses, and manage engagement details.",
  },
  {
    key: "engage.assign_team",
    category: "Engage",
    label: "Assign Team",
    description: "Assign and manage team members on engagements.",
  },
  {
    key: "engage.manage_qa",
    category: "Engage",
    label: "Manage QA",
    description: "Assign QA reviewers and manage QA workflow.",
  },
  {
    key: "engage.perform_qa",
    category: "Engage",
    label: "Perform QA",
    description: "Perform QA reviews on engagements assigned to you.",
  },
  {
    key: "engage.manage_all",
    category: "Engage",
    label: "Manage All",
    description: "Full administrative access to all Engage features including archiving and deletion.",
  },
  {
    key: "minitools.view",
    category: "MiniTools",
    label: "View",
    description: "Access MiniTools: CVSS calculator, breach lookup, and Azure tenant mapping.",
  },
];

const ALL_PERMISSIONS = PERMISSION_DEFINITIONS.map((permission) => permission.key);

const SYSTEM_ROLE_DEFINITIONS = [
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to shared collaboration content, personal calendar views, and assigned Reporter projects. No threat intel access.",
    permissions: [
      "bulletin.view",
      "calendar.view",
      "wiki.view",
      "reporter.view",
      "engage.view_own",
      "minitools.view",
    ],
  },
  {
    key: "member",
    name: "Member",
    description: "Standard team member with self-service calendar, content creation, threat intel read access, and assigned Reporter project access.",
    permissions: [
      "bulletin.view",
      "bulletin.create",
      "calendar.view",
      "calendar.create",
      "survey.create",
      "survey.respond_public",
      "threat.view",
      "wiki.view",
      "wiki.create_personal",
      "wiki.create_team",
      "reporter.view",
      "reporter.create",
      "reporter.edit_own",
      "engage.view_own",
      "engage.perform_qa",
      "minitools.view",
    ],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Team-level visibility and operational management across all tools, including threat intel feed management and all Reporter projects.",
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
      "threat.view",
      "threat.manage",
      "wiki.view",
      "wiki.create_personal",
      "wiki.create_team",
      "wiki.edit_team",
      "wiki.manage",
      "reporter.view",
      "reporter.create",
      "reporter.edit_own",
      "reporter.edit_assigned",
      "reporter.review",
      "reporter.approve",
      "reporter.manage_templates",
      "reporter.manage_all",
      "engage.view_team",
      "engage.create_client",
      "engage.edit_client",
      "engage.create_opportunity",
      "engage.edit_opportunity",
      "engage.create_engagement",
      "engage.edit_engagement",
      "engage.assign_team",
      "engage.manage_qa",
      "engage.perform_qa",
      "minitools.view",
    ],
  },
];

const TOOL_DEFINITIONS = [
  { key: "paste", name: "RedSecPaste", href: "/paste" },
  { key: "share", name: "RedSecShare", href: "/share" },
  { key: "chat", name: "RedSecTeam", href: "/chat" },
  { key: "vault", name: "RedSecVault", href: "/vault" },
  { key: "calendar", name: "RedSecCal", href: "/calendar", permissionsAny: ["calendar.view", "calendar.view_team", "calendar.manage"] },
  { key: "survey", name: "RedSecSurvey", href: "/survey", permissionsAny: ["survey.create", "survey.manage_any", "survey.view_results_any"] },
  { key: "wiki", name: "RedSecWiki", href: "/wiki", permissionsAny: ["wiki.view", "wiki.create_personal", "wiki.create_team", "wiki.edit_team", "wiki.manage"] },
  { key: "threat", name: "RedSecThreat", href: "/threat", permissionsAny: ["threat.view", "threat.manage"] },
  { key: "reporter", name: "RedSecReporter", href: "/reporter", permissionsAny: ["reporter.view", "reporter.create", "reporter.edit_own", "reporter.edit_assigned", "reporter.review", "reporter.approve", "reporter.manage_templates", "reporter.manage_all"] },
  { key: "engage", name: "RedSecEngage", href: "/engage", permissionsAny: ["engage.view_own", "engage.view_team", "engage.view_all"] },
  { key: "minitools", name: "RedSecMiniTools", href: "/minitools", permissionsAny: ["minitools.view"] },
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
