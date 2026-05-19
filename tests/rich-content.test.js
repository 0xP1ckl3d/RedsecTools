const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeBulletinHtml,
  extractBulletinAssetIds,
  normalizeBulletinPresentation,
} = require("../server/rich-content");

test("sanitizeBulletinHtml strips unsafe tags, attributes, and external image sources", () => {
  const html = sanitizeBulletinHtml(`
    <p class="x" style="color:red" onclick="alert(1)">Hello</p>
    <script>alert(1)</script>
    <img src="https://evil.example/a.png" onerror="alert(2)" alt="bad">
    <img src="/api/homepage/bulletin-assets/asset_1" style="width:100px" alt="good">
    <a href="javascript:alert(3)" onclick="alert(4)">Click</a>
    <a href="/wiki">Wiki</a>
  `);

  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onclick="));
  assert.ok(!html.includes("style="));
  assert.ok(!html.includes("https://evil.example"));
  assert.ok(html.includes('/api/homepage/bulletin-assets/asset_1'));
  assert.ok(html.includes('<a rel="noopener noreferrer" target="_blank">Click</a>'));
  assert.ok(html.includes('href="/wiki"'));
});

test("sanitizeBulletinHtml handles malformed and namespace payloads without active content", () => {
  const html = sanitizeBulletinHtml(`
    <ScRiPt>alert(1)</sCrIpT>
    <svg><a xlink:href="javascript:alert(1)">x</a></svg>
    <math><mi//xlink:href="data:x,<script>alert(1)</script>"></math>
    <template><img src=x onerror=alert(1)></template>
    <a href=//evil.example/path onmouseover=alert(1)>protocol relative</a>
    <a href="java&#x0A;script:alert(1)">encoded control</a>
    <img src="data:image/svg+xml;base64,PHN2Zy8+" alt="data">
    <img SRC="/api/homepage/bulletin-assets/good_asset" OnError="alert(1)" class="x">
    <div><strong>safe</strong></div>
  `);

  assert.ok(!/script/i.test(html));
  assert.ok(!/svg/i.test(html));
  assert.ok(!/math/i.test(html));
  assert.ok(!/template/i.test(html));
  assert.ok(!/onmouseover|onerror|style=|class=/i.test(html));
  assert.ok(!html.includes("//evil.example"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("data:image"));
  assert.ok(html.includes('/api/homepage/bulletin-assets/good_asset'));
  assert.ok(html.includes("<strong>safe</strong>"));
});

test("extractBulletinAssetIds returns unique internal asset identifiers", () => {
  const ids = extractBulletinAssetIds(`
    <img src="/api/homepage/bulletin-assets/abc123">
    <img src="/api/homepage/bulletin-assets/abc123">
    <img src="/api/homepage/bulletin-assets/xyz_789">
  `);

  assert.deepEqual(ids, ["abc123", "xyz_789"]);
});

test("normalizeBulletinPresentation falls back to safe presets", () => {
  const value = normalizeBulletinPresentation({
    stylePreset: "totally-custom",
    animationPreset: "spin-forever",
  });

  assert.deepEqual(value, {
    stylePreset: "default",
    animationPreset: "none",
  });
});
