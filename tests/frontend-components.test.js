const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("shared frontend component module exposes the common polish primitives", () => {
  const source = read("public/js/ui-components.js");
  for (const name of [
    "escapeHtml",
    "badge",
    "statusBadge",
    "booleanBadge",
    "tableStateRow",
    "setTableState",
    "stateBlock",
    "setInlineResult",
  ]) {
    assert.match(source, new RegExp(`\\b${name}\\b`), `${name} should stay available from ui-components.js`);
  }
});

test("migrated frontend modules use shared component primitives instead of local escape helpers", () => {
  const migrated = [
    "public/js/admin.js",
    "public/js/calendar.js",
    "public/js/homepage.js",
    "public/js/homepage-shortcuts.js",
    "public/js/homepage-weather.js",
    "public/js/reporter.js",
    "public/js/redsecai.js",
    "public/js/share-create.js",
    "public/js/share-view.js",
    "public/js/survey-builder.js",
    "public/js/survey-respond.js",
    "public/js/survey-results.js",
    "public/js/threat.js",
    "public/js/vault.js",
    "public/js/wiki.js",
    "public/js/engage/engage-app.js",
  ];

  for (const relativePath of migrated) {
    const source = read(relativePath);
    assert.match(source, /from "\.{1,2}\/ui-components\.js"/, `${relativePath} should import shared UI helpers`);
    assert.doesNotMatch(source, /function\s+escapeHtml\s*\(/, `${relativePath} should not redeclare escapeHtml`);
    assert.doesNotMatch(source, /function\s+esc(Html|Attr)?\s*\(/, `${relativePath} should not redeclare local escape wrappers`);
  }
});

test("classic frontend scripts consume shared UI globals instead of local escape helpers", () => {
  const migratedClassic = [
    "public/js/chat.js",
    "public/js/notifications.js",
    "public/js/reporter-proposals.js",
    "public/js/engage/engage-clients.js",
    "public/js/engage/engage-engagements.js",
    "public/js/engage/engage-opportunities.js",
    "public/js/engage/engage-qa.js",
    "public/js/engage/engage-utilisation.js",
  ];

  for (const relativePath of migratedClassic) {
    const source = read(relativePath);
    assert.match(source, /RedSecUI|ui-components\.js/, `${relativePath} should consume shared UI helpers`);
    assert.doesNotMatch(source, /function\s+escapeHtml\s*\(/, `${relativePath} should not redeclare escapeHtml`);
    assert.doesNotMatch(source, /function\s+esc\s*\(/, `${relativePath} should not redeclare local esc helpers`);
  }
});
