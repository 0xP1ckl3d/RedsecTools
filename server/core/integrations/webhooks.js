const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { assertPublicHttpUrl } = require("../security/fetch-targets");
const { logWarn } = require("../logger");

const MAX_ATTEMPTS = 5;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;

function computeWebhookSignature(secret, deliveryId, eventType, body) {
  return `sha256=${crypto
    .createHmac("sha256", String(secret || ""))
    .update(`${deliveryId}.${eventType}.${body}`)
    .digest("hex")}`;
}

function buildWebhookHeaders({ deliveryId, eventType, secret, body }) {
  return {
    "content-type": "application/json",
    "user-agent": "RedSecTools-Webhook/1.0",
    "x-redsec-delivery": deliveryId,
    "x-redsec-event": eventType,
    "x-redsec-signature": computeWebhookSignature(secret, deliveryId, eventType, body),
  };
}

function backoffSeconds(attemptCount) {
  return Math.min(3600, Math.pow(2, Math.max(0, attemptCount)) * 60);
}

async function postJsonWithRedirectValidation(targetUrl, body, headers, { timeoutMs = DEFAULT_TIMEOUT_MS, redirects = 0 } = {}) {
  if (redirects > 3) throw new Error("Webhook redirect limit exceeded");
  const parsed = await assertPublicHttpUrl(targetUrl);
  const client = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(parsed, {
      method: "POST",
      timeout: timeoutMs,
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body),
      },
    }, async (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        try {
          const redirected = new URL(res.headers.location, parsed).toString();
          resolve(await postJsonWithRedirectValidation(redirected, body, headers, { timeoutMs, redirects: redirects + 1 }));
        } catch (error) {
          reject(error);
        }
        return;
      }

      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_BYTES),
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function deliverWebhookDelivery(delivery, { decryptValue, updatePlatformWebhookDelivery }) {
  const body = JSON.stringify(delivery.payload);
  const secret = decryptValue(delivery.secretEncrypted);
  const headers = buildWebhookHeaders({
    deliveryId: delivery.id,
    eventType: delivery.eventType,
    secret,
    body,
  });
  const nextAttempt = delivery.attemptCount + 1;
  const now = Math.floor(Date.now() / 1000);
  try {
    const response = await postJsonWithRedirectValidation(delivery.url, body, headers);
    const ok = response.statusCode >= 200 && response.statusCode < 300;
    updatePlatformWebhookDelivery({
      id: delivery.id,
      status: ok ? "delivered" : (nextAttempt >= MAX_ATTEMPTS ? "failed" : "retrying"),
      attemptCount: nextAttempt,
      nextAttemptAt: ok ? now : now + backoffSeconds(nextAttempt),
      lastAttemptAt: now,
      responseStatus: response.statusCode,
      responseBody: response.body,
      error: ok ? "" : `HTTP ${response.statusCode}`,
    });
    return { ok, statusCode: response.statusCode };
  } catch (error) {
    updatePlatformWebhookDelivery({
      id: delivery.id,
      status: nextAttempt >= MAX_ATTEMPTS ? "failed" : "retrying",
      attemptCount: nextAttempt,
      nextAttemptAt: now + backoffSeconds(nextAttempt),
      lastAttemptAt: now,
      responseStatus: null,
      responseBody: "",
      error: error.message,
    });
    return { ok: false, error: error.message };
  }
}

async function deliverPendingWebhooks(database, { limit = 25 } = {}) {
  const deliveries = database.listPendingPlatformWebhookDeliveries(limit);
  for (const delivery of deliveries) {
    await deliverWebhookDelivery(delivery, database);
  }
  return deliveries.length;
}

function enqueueWebhookEvent(database, eventType, payload) {
  const webhooks = database.listPlatformWebhooksForEvent(eventType);
  const created = [];
  for (const webhook of webhooks) {
    const id = database.createPlatformWebhookDelivery({
      webhookId: webhook.id,
      eventType,
      payload: {
        id: crypto.randomBytes(16).toString("base64url"),
        type: eventType,
        createdAt: new Date().toISOString(),
        data: payload || {},
      },
    });
    created.push(id);
  }
  return created;
}

function startWebhookWorker(database, { intervalMs = 60 * 1000 } = {}) {
  const timer = setInterval(() => {
    deliverPendingWebhooks(database).catch((error) => {
      logWarn("webhook:worker_failed", { message: error.message });
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  buildWebhookHeaders,
  computeWebhookSignature,
  deliverPendingWebhooks,
  deliverWebhookDelivery,
  enqueueWebhookEvent,
  startWebhookWorker,
};
