const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

test("server WebP image transforms auto-apply EXIF orientation before resize", () => {
  const routeFiles = [
    "server/routes/admin.js",
    "server/routes/avatar.js",
    "server/routes/homepage.js",
    "server/routes/homepage-dashboard.js",
  ];

  const missing = [];
  for (const relativePath of routeFiles) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    const pipelines = source.match(/sharp\([\s\S]*?\.webp\([\s\S]*?\.toBuffer\(\)/g) || [];
    for (const pipeline of pipelines) {
      if (!pipeline.includes(".rotate()")) {
        missing.push(relativePath);
      }
    }
  }

  assert.deepEqual(missing, []);
});
