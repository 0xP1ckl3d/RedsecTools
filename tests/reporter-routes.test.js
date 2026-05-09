const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../server/routes/reporter.js"), "utf8");

function routeLine(method, route) {
  return source.split(/\r?\n/).find((line) => line.includes(`router.${method}("${route}"`)) || "";
}

test("Reporter mutating routes keep rate limiting, session auth, and access attachment", () => {
  for (const line of source.split(/\r?\n/).filter((item) => /router\.(post|put|delete)\("\/reporter\//.test(item))) {
    if (line.includes("/reporter/cvss/parse") || line.includes("/reporter/markdown-preview") || line.includes("/reporter/projects/:id/md2html")) {
      continue;
    }
    assert.ok(line.includes("writeLimiter"), `Missing writeLimiter: ${line}`);
    assert.ok(line.includes("requireUser"), `Missing requireUser: ${line}`);
    assert.ok(line.includes("attachUserAccess"), `Missing attachUserAccess: ${line}`);
  }
});

test("Reporter PDF and preview routes enforce project membership before rendering or download", () => {
  for (const route of [
    "/reporter/projects/:id/render-preview",
    "/reporter/projects/:id/render-preview.pdf",
    "/reporter/projects/:id/render-preview.css",
    "/reporter/projects/:id/pdfs",
    "/reporter/projects/:id/check",
    "/reporter/pdfs/:id/download",
  ]) {
    assert.ok(routeLine("get", route).includes("canViewReporter"), `${route} should require reporter view access`);
  }
  assert.ok(routeLine("post", "/reporter/projects/:id/md2html").includes("canViewReporter"), "md2html should require reporter view access");
  assert.match(source, /render-preview"[\s\S]*?canAccessProject\(req, input\.project\)/);
  assert.match(source, /render-preview\.pdf"[\s\S]*?canAccessProject\(req, input\.project\)/);
  assert.match(source, /render-preview\.css"[\s\S]*?canAccessProject\(req, project\)/);
  assert.match(source, /\/reporter\/pdfs\/:id\/download"[\s\S]*?canAccessProject\(req, project\)/);
});

test("Reporter PDF downloads remain path-confined to the configured PDF directory", () => {
  assert.match(source, /const resolvedDir = path\.resolve\(REPORTER_PDF_DIR\)/);
  assert.match(source, /const resolvedFile = path\.resolve\(generation\.filePath\)/);
  assert.match(source, /!resolvedFile\.startsWith\(resolvedDir \+ path\.sep\)/);
});

test("Reporter design and template management routes require template/design management permission", () => {
  for (const [method, route] of [
    ["post", "/reporter/designs"],
    ["post", "/reporter/designs/:id/duplicate"],
    ["put", "/reporter/designs/:id"],
    ["delete", "/reporter/designs/:id"],
    ["post", "/reporter/templates"],
    ["put", "/reporter/templates/:id"],
    ["delete", "/reporter/templates/:id"],
  ]) {
    assert.ok(routeLine(method, route).includes("canManageTemplates"), `${method.toUpperCase()} ${route} should require template/design management`);
  }
});
