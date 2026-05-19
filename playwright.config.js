const os = require("os");
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const PORT = 3211;
const DB_PATH = path.join(os.tmpdir(), `redsectools-playwright-${process.pid}.sqlite`);

module.exports = defineConfig({
  testDir: "./tests/playwright",
  timeout: 30 * 1000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    bypassCSP: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server/index.js",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 30 * 1000,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DB_PATH,
      COOKIE_SECRET: "playwright-cookie-secret-change-me-32-bytes",
      ADMIN_PASSWORD: "playwright-admin-password",
      REDSECAI_ENABLED: "false",
      REDSECAI_AUTOSTART: "false",
      REDSECAI_AUTO_PULL: "false",
      THREAT_AUTO_FETCH_ENABLED: "false",
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
