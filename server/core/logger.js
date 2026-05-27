const SENSITIVE_KEY_PATTERN = /(password|pass|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|totp|recovery|smtpPass|session)/i;
const RECENT_WARNING_LIMIT = 50;
const recentWarnings = [];

function redactValue(value) {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactObject(value);
  if (typeof value === "string" && value.length > 256) return `${value.slice(0, 256)}...`;
  return value;
}

function redactObject(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(value);
  }
  return output;
}

function requestFields(req) {
  return {
    ip: req?.ip || req?.connection?.remoteAddress || null,
    userAgent: typeof req?.get === "function" ? req.get("user-agent") || null : null,
    actorUserId: req?.user?.id || null,
    actorUsername: req?.user?.username || null,
  };
}

function logEvent(action, req, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    ...requestFields(req),
    ...redactObject(extra),
  };
  console.log(JSON.stringify(entry));
}

function logWarn(action, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: "warn",
    action,
    ...redactObject(extra),
  };
  recentWarnings.push(entry);
  while (recentWarnings.length > RECENT_WARNING_LIMIT) recentWarnings.shift();
  console.warn(JSON.stringify(entry));
}

function getRecentWarnings(limit = 10) {
  const count = Math.min(RECENT_WARNING_LIMIT, Math.max(1, parseInt(limit, 10) || 10));
  return recentWarnings.slice(-count).reverse();
}

module.exports = {
  getRecentWarnings,
  logEvent,
  logWarn,
  redactObject,
  requestFields,
};
