const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const cookieParser = require("cookie-parser");
const signature = require("cookie-signature");

function assertDatabaseNotLoaded() {
  const loaded = Object.keys(require.cache).some((key) => key.endsWith(`${path.sep}server${path.sep}database.js`));
  if (loaded) {
    throw new Error("Route harness must be created before server/database.js is loaded. Run it in an isolated child process.");
  }
}

function createTempDbPath(name = "redsectools-route-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  return {
    dir,
    dbPath: path.join(dir, "test.sqlite"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function signedCookieValue(value, secret) {
  return `s:${signature.sign(value, secret)}`;
}

function requestJson(baseUrl, { method = "GET", path: requestPath, cookie = "", body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const url = new URL(requestPath, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_) {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json, text });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createRouteHarness(options = {}) {
  assertDatabaseNotLoaded();
  const temp = createTempDbPath(options.name);
  const cookieSecret = options.cookieSecret || "route-harness-cookie-secret";
  process.env.DB_PATH = temp.dbPath;
  process.env.COOKIE_SECRET = cookieSecret;
  process.env.REDSECAI_ENABLED = "true";
  process.env.REDSECAI_AUTOSTART = "false";
  process.env.REDSECAI_AUTO_PULL = "false";

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(cookieSecret));

  const database = require("../../server/database");
  const routers = {
    redsecai: () => require("../../server/routes/redsecai"),
    homepage: () => require("../../server/routes/homepage").router,
    reporter: () => require("../../server/routes/reporter"),
    engage: () => require("../../server/routes/engage"),
    integrations: () => require("../../server/routes/integrations"),
    admin: () => require("../../server/routes/admin").router,
  };
  for (const routeName of options.routes || []) {
    const routerFactory = routers[routeName];
    if (!routerFactory) throw new Error(`Unknown route harness router: ${routeName}`);
    const mountPath = routeName === "homepage" ? "/api/homepage" : (routeName === "admin" ? "/admin" : "/api");
    app.use(mountPath, routerFactory());
  }

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.REDSECAI_INTERNAL_ORIGIN = baseUrl;

  function createRoleWithPermissions(id, permissions) {
    database.createRole({
      id,
      roleKey: id,
      name: id,
      description: "Test role",
      permissions,
      isSystem: false,
    });
    return id;
  }

  function createUserWithSession({ id, username, roleId, permissions = [] }) {
    const actualRoleId = roleId || createRoleWithPermissions(`role-${id}`, permissions);
    database.createUser({
      id,
      email: `${id}@example.test`,
      username: username || id,
      passwordHash: "test-password-hash",
      roleId: actualRoleId,
    });
    const sessionId = `session-${id}-${crypto.randomBytes(6).toString("hex")}`;
    database.createSession({
      id: sessionId,
      userId: id,
      expiresIn: 3600,
      ipAddress: "127.0.0.1",
      userAgent: "route-harness",
    });
    return {
      id,
      username: username || id,
      sessionId,
      cookie: `redsec_session=${encodeURIComponent(signedCookieValue(sessionId, cookieSecret))}`,
    };
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    database.db.close();
    temp.cleanup();
  }

  return {
    app,
    baseUrl,
    close,
    cookieSecret,
    createRoleWithPermissions,
    createUserWithSession,
    database,
    requestJson: (request) => requestJson(baseUrl, request),
    server,
    temp,
  };
}

module.exports = {
  createRouteHarness,
  createTempDbPath,
  requestJson,
  signedCookieValue,
};
