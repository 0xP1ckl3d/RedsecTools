const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { computeWebhookSignature, buildWebhookHeaders } = require("../server/core/integrations/webhooks");

test("webhook signatures are stable HMAC-SHA256 over delivery, event, and body", () => {
  const body = JSON.stringify({ ok: true });
  const expected = `sha256=${crypto
    .createHmac("sha256", "secret-value")
    .update(`delivery-1.webhook.test.${body}`)
    .digest("hex")}`;
  assert.equal(computeWebhookSignature("secret-value", "delivery-1", "webhook.test", body), expected);

  const headers = buildWebhookHeaders({
    deliveryId: "delivery-1",
    eventType: "webhook.test",
    secret: "secret-value",
    body,
  });
  assert.equal(headers["x-redsec-delivery"], "delivery-1");
  assert.equal(headers["x-redsec-event"], "webhook.test");
  assert.equal(headers["x-redsec-signature"], expected);
});
