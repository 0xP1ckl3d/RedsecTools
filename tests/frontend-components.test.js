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

test("public policies page exposes privacy and terms tabs without inline scripts", () => {
  const html = read("public/policies.html");
  const script = read("public/js/policies.js");
  const server = read("server/index.js");

  assert.match(server, /app\.get\("\/policies"/, "public /policies route should be registered");
  assert.match(html, /data-policy-view="privacy"/, "privacy tab should use the shared page-tab style pattern");
  assert.match(html, /data-policy-view="tos"/, "terms tab should use the shared page-tab style pattern");
  assert.match(html, /data-policy-panel="privacy"/, "privacy panel should be present");
  assert.match(html, /data-policy-panel="tos"/, "terms panel should be present");
  assert.match(html, /RedSecTools is designed so plaintext content is encrypted in the browser/, "approved crypto wording should be present");
  assert.doesNotMatch(html, /<script(?![^>]+src=)/i, "policies page should not use inline scripts");
  assert.match(script, /hashchange/, "policy tab script should support hash-routed tabs");
});

test("policy links are available from login-only link row and shared sidebar injection", () => {
  const login = read("public/login.html");
  const burger = read("public/js/burger-menu.js");

  for (const source of [login, burger]) {
    assert.match(source, /\/policies#policy=privacy/, "privacy policy hash link should be present");
    assert.match(source, /\/policies#policy=tos/, "terms hash link should be present");
  }
  assert.match(login, /RedSec<\/a> Offensive Security &mdash; RedSecTools/, "login footer should match shared footer wording");
  assert.match(login, /login-policy-links/, "login should expose a subtle policy row under the footer");
  assert.match(burger, /sidebar-policy-links/, "shared sidebar policy links should be injected");
  assert.match(read("public/css/input.css"), /\.sidebar-policy-links\s*{[\s\S]*margin-top:\s*auto/, "sidebar policy links should stay pinned to the bottom of tool sidebars");
  assert.doesNotMatch(burger, /footer\.innerHTML[\s\S]*policies#policy/, "shared page footer should not include policy links");
});

test("About sidebar entries are separated from primary navigation", () => {
  const separatedAboutPages = [
    ["public/index.html", "data-view=\"about\""],
    ["public/ai/index.html", "data-redsecai-view=\"about\""],
    ["public/paste/index.html", "data-paste-view=\"about\""],
    ["public/share/index.html", "data-share-view=\"about\""],
    ["public/engage/index.html", "data-engage-view=\"about\""],
    ["public/calendar/index.html", "data-calendar-view=\"about\""],
    ["public/minitools/index.html", "data-minitools-view=\"about\""],
    ["public/reporter/index.html", "data-reporter-view=\"about\""],
    ["public/survey/index.html", "data-survey-view=\"about\""],
    ["public/threat/index.html", "data-threat-view=\"about\""],
    ["public/vault/index.html", "data-vault-view=\"about\""],
    ["public/wiki/index.html", "data-wiki-view=\"about\""],
  ];

  for (const [relativePath, marker] of separatedAboutPages) {
    const html = read(relativePath);
    const markerIndex = html.indexOf(marker);
    assert.notEqual(markerIndex, -1, `${relativePath} should expose an About sidebar entry`);
    const beforeAbout = html.slice(Math.max(0, markerIndex - 260), markerIndex);
    assert.match(beforeAbout, /<div class="sidebar-divider"><\/div>\s*<nav class="sidebar-nav">\s*<button/, `${relativePath} should place About in its own sidebar group after a divider`);
  }

  const engageHtml = read("public/engage/index.html");
  const engageScript = read("public/js/engage/engage-app.js");
  assert.match(engageHtml, /class="mobile-tab" data-engage-view="about"/, "Engage should expose About on mobile tabs");
  assert.match(engageScript, /function renderEngageAbout/, "Engage should render a real About section");
  assert.match(engageScript, /data-engage-section="about"/, "Engage About should participate in the normal view switching mechanism");

  const teamHtml = read("public/chat/index.html");
  assert.match(teamHtml, /id="chat-about-btn"[\s\S]*<span class="sidebar-nav-text">About<\/span>/, "RedSecTeam should expose an About control");
  assert.match(teamHtml, /id="new-conversation-btn"[\s\S]*<div class="sidebar-divider"><\/div>[\s\S]*id="chat-about-btn"/, "RedSecTeam About should be separated from conversation actions");
});

test("RedSecTeam uses the shared dashboard sidebar shell without dropping chat hooks", () => {
  const html = read("public/chat/index.html");
  const script = read("public/js/chat.js");
  const css = read("public/css/input.css");

  assert.match(html, /id="chat-app" class="dashboard-layout chat-dashboard-shell hidden"/, "RedSecTeam should use the shared dashboard layout shell");
  assert.match(html, /id="chat-sidebar" class="dashboard-sidebar chat-team-sidebar"/, "RedSecTeam sidebar should use dashboard-sidebar");
  assert.match(html, /id="chat-sidebar-collapse-btn" class="sidebar-collapse-btn"/, "RedSecTeam sidebar should use the shared collapse control");
  assert.match(html, /id="chat-main" class="dashboard-main chat-team-main"/, "RedSecTeam main content should use dashboard-main");
  for (const id of [
    "conversation-list",
    "conversation-search",
    "new-conversation-btn",
    "chat-about-btn",
    "chat-about-panel",
    "chat-content-area",
    "chat-empty",
    "chat-active",
    "messages-container",
    "message-input",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `RedSecTeam must preserve #${id}`);
  }
  assert.match(script, /chat-sidebar-collapse-btn/, "RedSecTeam collapse control should be wired in chat.js");
  assert.match(script, /chat-mobile-conversation-open/, "RedSecTeam mobile conversation state should be explicit");
  assert.match(css, /\.chat-dashboard-shell \.dashboard-sidebar\s*{[\s\S]*width:\s*240px/, "RedSecTeam sidebar should use the standard expanded sidebar width");
  assert.match(css, /\.chat-dashboard-shell \.dashboard-sidebar\.collapsed\s*{[\s\S]*width:\s*64px/, "RedSecTeam collapsed sidebar should use the standard collapsed sidebar width");
  assert.match(css, /\.chat-conversation-list/, "RedSecTeam conversation list should have scoped sidebar list CSS");
  assert.match(css, /\.chat-dashboard-shell \.dashboard-sidebar\.collapsed \.chat-conversation-list\s*{[\s\S]*display:\s*block/, "Collapsed RedSecTeam sidebar should still show recent conversation avatars");
  assert.match(css, /\.chat-dashboard-shell \.dashboard-sidebar\.collapsed \.chat-conversation-item > \.flex-1\s*{[\s\S]*display:\s*none/, "Collapsed RedSecTeam conversation rows should hide text labels");
  assert.match(css, /\.chat-conversation-list\s*{[\s\S]*overflow-y:\s*auto/, "Expanded RedSecTeam conversation area should own its scroll");
});

test("RedSecTeam preserves multiline and fenced-code message rendering", () => {
  const script = read("public/js/chat.js");
  const css = read("public/css/input.css");

  assert.match(script, /function appendMarkdownBlock/, "RedSecTeam editor conversion should keep block-level newlines");
  assert.match(script, /function normalizeMessageNewlines/, "RedSecTeam should normalise pasted/editor newlines before encrypting text");
  assert.match(script, /CHAT_CODE_BLOCK_/, "RedSecTeam markdown rendering should protect fenced code blocks from inline processing");
  assert.match(script, /function insertCodeBlock/, "RedSecTeam should expose a block-code toolbar action");
  assert.match(script, /fmt-code-block/, "RedSecTeam should wire the block-code toolbar action");
  assert.match(script, /unwrapElement\(existingCode\)/, "RedSecTeam inline-code toolbar should toggle inline code off when pressed again");
  assert.match(script, /<pre class="chat-code-block"><code>/, "RedSecTeam should render fenced code as pre/code blocks");
  assert.match(read("public/chat/index.html"), /id="fmt-code-block"/, "RedSecTeam toolbar should include a code block control");
  assert.doesNotMatch(css, /\.chat-message-bubble \.message-text br \+ br\s*{[\s\S]*display:\s*none/, "RedSecTeam must not hide consecutive line breaks");
  assert.match(css, /\.chat-code-block code\s*{[\s\S]*white-space:\s*inherit/, "RedSecTeam code block inner code should preserve whitespace");
});

test("RedSecTeam supports sender-owned message edit and delete tombstones", () => {
  const html = read("public/chat/index.html");
  const script = read("public/js/chat.js");
  const state = read("public/js/chat-state.js");
  const routes = read("server/routes/chat.js");
  const db = read("server/database.js");
  const css = read("public/css/input.css");

  assert.match(html, /id="chat-edit-banner"/, "RedSecTeam should expose an edit-mode banner");
  assert.match(script, /data-chat-edit-message/, "Own messages should expose an edit action");
  assert.match(script, /data-chat-delete-message/, "Own messages should expose a delete action");
  assert.match(script, /chat-message-edited/, "Edited messages should render an edited marker beside the timestamp");
  assert.match(script, /Message deleted/, "Deleted messages should render a tombstone in the thread");
  assert.match(state, /ChatWS\.on\("message_edited"/, "Edited messages should sync over WebSocket");
  assert.match(state, /ChatWS\.on\("message_deleted"/, "Deleted messages should sync over WebSocket");
  assert.match(state, /msg\.conversationId = msg\.conversationId \|\| conversationId/, "History-loaded messages should retain conversationId for edit/delete routes");
  assert.match(state, /editMessage: editMessage/, "ChatState should publish editMessage");
  assert.match(state, /deleteMessage: deleteMessage/, "ChatState should publish deleteMessage");
  assert.match(routes, /router\.put\("\/conversations\/:id\/messages\/:messageId"/, "Server should expose an edit route");
  assert.match(routes, /router\.delete\("\/conversations\/:id\/messages\/:messageId"/, "Server should expose a delete route");
  assert.match(routes, /existing\.sender_id !== req\.user\.id/, "Server must enforce sender ownership for edits/deletes");
  assert.match(db, /updateMessageForSender/, "Database layer should update messages through sender-scoped statements");
  assert.match(db, /deleteMessageForSender/, "Database layer should delete messages through sender-scoped tombstones");
  assert.match(css, /\.chat-message-bubble\.deleted/, "Deleted message tombstones should have explicit styling");
});

test("RedSecTeam message sends create generic notification-center unread items", () => {
  const routes = read("server/routes/chat.js");
  const notifications = read("server/core/notifications.js");

  assert.match(notifications, /"team"/, "Notification categories should allow RedSecTeam notifications");
  assert.match(routes, /createNotification, markNotificationReadByDedupe/, "Chat routes should use the notification center");
  assert.match(routes, /function notifyConversationMembersOfMessage/, "Chat routes should fan out message notifications");
  assert.match(routes, /body: "You received an encrypted message\."/,"Chat notification body must stay generic and avoid plaintext message content");
  assert.match(routes, /dedupeKey: `chat:conversation:\$\{conversationId\}:\$\{member\.user_id\}`/, "Unread chat notifications should dedupe per conversation and recipient");
  assert.match(routes, /notifyConversationMembersOfMessage\(id, req\.user\.id\)/, "Message send should trigger notification fan-out");
  assert.match(routes, /\/conversations\/:id\/notifications\/read/, "Chat routes should clear notification unread state when a conversation is read");
  assert.match(read("public/js/chat-state.js"), /\/notifications\/read/, "ChatState should mark matching notification-center entries read when opening a conversation");
});
