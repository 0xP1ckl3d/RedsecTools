const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const contracts = require("../docs/security/route-contracts.json").contracts;

const ROUTE_MOUNTS = {
  "admin.js": "/admin",
  "admin-collab.js": "/admin",
  "avatar.js": "/api",
  "auth.js": "/api",
  "calendar.js": "/api",
  "chat.js": "/api/chat",
  "engage.js": "/api",
  "extension.js": "/api/ext",
  "homepage.js": "/api/homepage",
  "homepage-dashboard.js": "/api/homepage",
  "integrations.js": "/api",
  "notifications.js": "/api",
  "paste.js": "/api",
  "redsecai.js": "/api",
  "reporter.js": "/api",
  "share.js": "/api",
  "survey.js": "/api",
  "threat.js": "/api",
  "vault.js": "/api",
  "wiki.js": "/api",
  "minitools.js": "/api",
};

function joinRoute(prefix, routePath) {
  return `${prefix.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`.replace(/\/+/g, "/");
}

function expandBraces(pattern) {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match) return [pattern];
  return match[1].split(",").flatMap((part) => expandBraces(pattern.slice(0, match.index) + part + pattern.slice(match.index + match[0].length)));
}

function patternToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

const compiledContracts = contracts.flatMap((contract) => expandBraces(contract.routePattern).map((pattern) => ({
  ...contract,
  regex: patternToRegex(pattern),
})));

function covered(route) {
  return compiledContracts.some((contract) => {
    if (!contract.methods.includes(route.method)) return false;
    return contract.regex.test(route.path);
  });
}

function extractRoutesFromFile(filePath, mount) {
  const source = fs.readFileSync(filePath, "utf8");
  const routes = [];
  const routeRegex = /\brouter\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(routeRegex)) {
    routes.push({ method: match[1].toUpperCase(), path: joinRoute(mount, match[2]), file: path.relative(ROOT, filePath) });
  }
  return routes;
}

function extractIndexRoutes() {
  const source = fs.readFileSync(path.join(ROOT, "server", "index.js"), "utf8");
  const routes = [];
  const appRouteRegex = /\bapp\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(appRouteRegex)) {
    const routePath = match[2];
    if (routePath.startsWith("/api/") || routePath.startsWith("/admin/") || routePath === "/healthz" || routePath === "/readyz") {
      routes.push({ method: match[1].toUpperCase(), path: routePath, file: "server/index.js" });
    }
  }
  return routes;
}

test("route protection contracts cover every Express API route", () => {
  const routesDir = path.join(ROOT, "server", "routes");
  const routes = [
    ...extractIndexRoutes(),
    ...fs.readdirSync(routesDir)
      .filter((file) => file.endsWith(".js"))
      .flatMap((file) => extractRoutesFromFile(path.join(routesDir, file), ROUTE_MOUNTS[file] || "/api")),
  ];

  const uncovered = routes.filter((route) => !covered(route));
  assert.deepEqual(uncovered, []);
});
