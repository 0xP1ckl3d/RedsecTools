const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePermissionList,
  getAvailableTools,
  isToolAvailable,
} = require("../server/access");

test("normalizePermissionList removes duplicates and invalid permissions", () => {
  const permissions = normalizePermissionList([
    "wiki.view",
    "wiki.create",
    "wiki.edit_any",
    "not.real",
    "calendar.view",
  ]);

  assert.deepEqual(permissions, ["calendar.view", "wiki.create_team", "wiki.edit_team", "wiki.view"]);
});

test("getAvailableTools exposes only tools allowed by current permissions", () => {
  const tools = getAvailableTools(new Set(["calendar.view", "wiki.view"]));
  const keys = tools.map((tool) => tool.key);

  assert.ok(keys.includes("paste"));
  assert.ok(keys.includes("share"));
  assert.ok(keys.includes("chat"));
  assert.ok(keys.includes("vault"));
  assert.ok(keys.includes("calendar"));
  assert.ok(keys.includes("wiki"));
  assert.ok(!keys.includes("survey"));
});

test("survey tool availability supports any configured permission", () => {
  assert.equal(
    isToolAvailable(
      {
        key: "survey",
        permissionsAny: ["survey.create", "survey.manage_any", "survey.view_results_any"],
      },
      new Set(["survey.view_results_any"])
    ),
    true
  );
});
