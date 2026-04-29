const { URL } = require("url");
const { decodeBase64Strict } = require("../base64");

const BASE64URL_ID_REGEX = /^[A-Za-z0-9_-]{22}$/;
const MIME_REGEX = /^[a-z0-9][a-z0-9!#$&\-^_.+]*\/[a-z0-9][a-z0-9!#$&\-^_.+]*$/i;

function validateBase64Field(value, name, requiredLength) {
  if (typeof value !== "string") return `${name} must be a string`;
  if (!value.length) return `${name} is empty`;
  try {
    const decoded = decodeBase64Strict(value);
    if (requiredLength && decoded.length !== requiredLength) {
      return `${name} must decode to ${requiredLength} bytes (got ${decoded.length})`;
    }
    return null;
  } catch {
    return `${name} is not valid base64`;
  }
}

function decodeBase64Field(value, name, requiredLength) {
  const error = validateBase64Field(value, name, requiredLength);
  if (error) return { error };
  return { value: decodeBase64Strict(value) };
}

function isBase64UrlId(value) {
  return typeof value === "string" && BASE64URL_ID_REGEX.test(value);
}

function validateBase64UrlId(value, label = "ID") {
  return isBase64UrlId(value) ? null : `${label} is invalid`;
}

function parseInteger(value, { min, max, fallback } = {}) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (min != null && parsed < min) return fallback;
  if (max != null && parsed > max) return fallback;
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function validateExpiry(value, allowedValues) {
  const parsed = parseInt(value, 10);
  if (!allowedValues.includes(parsed)) return { error: "Invalid expiration value" };
  return { value: parsed };
}

function sanitizeMimeType(value, fallback = "application/octet-stream", maxLength = 128) {
  return typeof value === "string" && value.length <= maxLength && MIME_REGEX.test(value)
    ? value
    : fallback;
}

function normalizeHttpOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function validateDateRange({ startsAt, endsAt }) {
  const start = startsAt == null || startsAt === "" ? null : parseInteger(startsAt, { min: 0, fallback: null });
  const end = endsAt == null || endsAt === "" ? null : parseInteger(endsAt, { min: 0, fallback: null });
  if (start != null && end != null && end < start) {
    return { error: "End date must be after start date" };
  }
  return { startsAt: start, endsAt: end };
}

module.exports = {
  BASE64URL_ID_REGEX,
  MIME_REGEX,
  validateBase64Field,
  decodeBase64Field,
  isBase64UrlId,
  validateBase64UrlId,
  parseInteger,
  parseBoolean,
  validateExpiry,
  sanitizeMimeType,
  normalizeHttpOrigin,
  validateDateRange,
};
