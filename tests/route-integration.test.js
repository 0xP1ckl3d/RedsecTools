const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

function runFixture(name) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "fixtures", name), {
      env: {
        ...process.env,
        NODE_ENV: "test",
        COOKIE_SECRET: "route-integration-cookie-secret",
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

test("RedSecAI HTTP routes handle status, chat, confirm/reject, cross-user, stale, schema, and permission failures", async () => {
  await runFixture("redsecai-route-integration.js");
});

test("Reporter route access control protects project membership, member management, readonly edits, and related records", async () => {
  await runFixture("reporter-route-integration.js");
});
