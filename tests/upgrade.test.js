const test = require("node:test");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

function runFixture(name) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "fixtures", name), {
      env: {
        ...process.env,
        NODE_ENV: "test",
        COOKIE_SECRET: "legacy-upgrade-cookie-secret",
        REDSECAI_AUTOSTART: "false",
        REDSECAI_AUTO_PULL: "false",
      },
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}`));
    });
  });
}

test("sanitized legacy database snapshot upgrades additively and preserves ciphertext", async () => {
  await runFixture("legacy-upgrade-fixture.js");
});
