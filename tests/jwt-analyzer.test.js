const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

test("JWT Analyzer — minitools HTML contains jwt-analyzer tab and view section", () => {
  const html = fs.readFileSync(path.join(ROOT, "public", "minitools", "index.html"), "utf8");
  assert.ok(html.includes('data-minitools-view="jwt-analyzer"'), "sidebar or mobile tab missing");
  assert.ok(html.includes('id="minitools-view-jwt-analyzer"'), "view section missing");
  // Script tag is imported by minitools.js, not included directly in HTML
});

test("JWT Analyzer — module exports initJwtAnalyzer", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  assert.ok(src.includes("export function initJwtAnalyzer"), "named export missing");
});

test("JWT Analyzer — processing is purely client-side (no fetch/XHR/axios)", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(src), "contains fetch() — must be client-side only");
  assert.ok(!/XMLHttpRequest/.test(src), "contains XMLHttpRequest — must be client-side only");
  assert.ok(!/axios/.test(src), "contains axios — must be client-side only");
});

test("JWT Analyzer — warns that decoded tokens are not trusted unless verified", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  assert.ok(src.includes("does not verify its signature or establish trust"), "verification warning missing");
  assert.ok(src.includes("Edited / Unverified"), "rebuilt token warning label missing");
});

test("JWT Analyzer — covers required claims", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  const required = ["iss", "sub", "aud", "exp", "nbf", "iat", "jti", "scope", "roles", "appid", "tid"];
  for (const claim of required) {
    assert.ok(src.includes(claim), "missing claim: " + claim);
  }
});

test("JWT Analyzer — supports HMAC verification (HS256/HS384/HS512)", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  assert.ok(src.includes("SHA-256"), "HS256 hash missing");
  assert.ok(src.includes("SHA-384"), "HS384 hash missing");
  assert.ok(src.includes("SHA-512"), "HS512 hash missing");
  assert.ok(src.includes("crypto.subtle"), "Web Crypto usage missing");
});

test("JWT Analyzer — no inline styles (CSP compliance)", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "js", "jwt-analyzer.js"), "utf8");
  assert.ok(!/style\s*=/.test(src), "contains inline style= attributes — CSP violation");
});
