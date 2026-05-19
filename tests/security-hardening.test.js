const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function routeLine(routeSource, method, routePath) {
  const pattern = new RegExp(`router\\.${method}\\("${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^\\n]+`);
  return routeSource.match(pattern)?.[0] || "";
}

test("high-risk admin writes require recent admin authentication middleware", () => {
  const admin = source("server/routes/admin.js");
  const adminCollab = source("server/routes/admin-collab.js");
  const routes = [
    [admin, "post", "/api/backup/export"],
    [admin, "post", "/api/settings/smtp"],
    [admin, "post", "/api/settings/security"],
    [admin, "post", "/api/settings/sso"],
    [admin, "post", "/api/users/:id/reset-mfa"],
    [admin, "delete", "/api/users/:id"],
    [admin, "put", "/api/vaults/:id/members/:userId"],
    [admin, "delete", "/api/vaults/:id"],
    [adminCollab, "post", "/api/roles"],
    [adminCollab, "put", "/api/users/:id/role"],
    [adminCollab, "post", "/api/threat/templates"],
    [adminCollab, "put", "/api/threat/notifications/:id"],
  ];

  for (const [routeSource, method, routePath] of routes) {
    assert.match(
      routeLine(routeSource, method, routePath),
      /requireRecentAdminAuth/,
      `${method.toUpperCase()} ${routePath} should require recent admin auth`,
    );
  }
});

test("helmet CSP remains deny-by-default for scripts, objects, frames, and base URIs", () => {
  const index = source("server/index.js");
  assert.match(index, /defaultSrc:\s*\["'self'"\]/);
  assert.match(index, /scriptSrc:\s*\["'self'",\s*"https:\/\/static\.cloudflareinsights\.com"\]/);
  assert.match(index, /objectSrc:\s*\["'none'"\]/);
  assert.match(index, /frameAncestors:\s*\["'none'"\]/);
  assert.match(index, /baseUri:\s*\["'self'"\]/);
  assert.doesNotMatch(index, /scriptSrc:[^\n]+unsafe-inline/);
  assert.doesNotMatch(index, /styleSrc:[^\n]+unsafe-inline/);
});
