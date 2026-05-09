const test = require("node:test");
const assert = require("node:assert/strict");

test("audit event storage redacts sensitive metadata before persistence", () => {
  const { createAuditEvent, listAuditEvents } = require("../server/database");
  const id = createAuditEvent({
    actorUserId: "audit-test-user",
    actorUsername: "audit-test-user",
    category: "test",
    action: "redaction_check",
    targetType: "test",
    targetId: "audit-redaction",
    metadata: {
      safe: "visible",
      password: "super-secret",
      nested: {
        apiToken: "token-value",
      },
    },
  });
  assert.ok(id);
  const events = listAuditEvents({
    category: "test",
    action: "redaction_check",
    targetType: "test",
    targetId: "audit-redaction",
    limit: 5,
  }).events;
  const event = events.find((item) => item.id === id);
  assert.ok(event);
  assert.equal(event.metadata.safe, "visible");
  assert.equal(event.metadata.password, "[redacted]");
  assert.equal(event.metadata.nested.apiToken, "[redacted]");
});
