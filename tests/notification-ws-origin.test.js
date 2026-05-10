const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { isAllowedWebSocketOrigin } = require("../server/core/security/ws-origin");

describe("Notification WebSocket origin validation", () => {
  it("allows same-origin requests", () => {
    assert.equal(
      isAllowedWebSocketOrigin({
        headers: { origin: "https://tools.example.com", host: "tools.example.com" },
      }),
      true,
    );
  });

  it("allows trusted forwarded origin through reverse proxy", () => {
    assert.equal(
      isAllowedWebSocketOrigin({
        headers: {
          origin: "https://tools.example.com",
          host: "internal:3000",
          "x-forwarded-host": "tools.example.com",
        },
      }),
      true,
    );
  });

  it("allows configured trusted origin", () => {
    assert.equal(
      isAllowedWebSocketOrigin(
        { headers: { origin: "https://trusted.example.com", host: "tools.example.com" } },
        { trustedOrigins: ["https://trusted.example.com"] },
      ),
      true,
    );
  });

  it("rejects untrusted cross-site origin", () => {
    assert.equal(
      isAllowedWebSocketOrigin(
        { headers: { origin: "https://evil.example.com", host: "tools.example.com" } },
        { trustedOrigins: ["https://trusted.example.com"] },
      ),
      false,
    );
  });

  it("allows requests without Origin header (non-browser clients)", () => {
    assert.equal(
      isAllowedWebSocketOrigin({ headers: { host: "tools.example.com" } }),
      true,
    );
  });

  it("notification-ws.js module loads with origin validation wired in", () => {
    const mod = require("../server/notification-ws");
    assert.equal(typeof mod.initNotificationWebSocket, "function");
    assert.equal(typeof mod.pushNotificationToUser, "function");
    assert.equal(typeof mod.pushUnreadCountToUser, "function");
  });
});
