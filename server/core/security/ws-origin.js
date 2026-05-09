"use strict";

const { getConfiguredTrustedOrigins } = require("../../public-origin");

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") return null;
  try {
    const url = new URL(origin);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_) {
    return null;
  }
}

function getHeader(req, name) {
  return req?.headers?.[name] || req?.headers?.[name.toLowerCase()] || "";
}

function sameHostOrigin(req, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  let url;
  try {
    url = new URL(normalized);
  } catch (_) {
    return false;
  }
  const forwardedHost = String(getHeader(req, "x-forwarded-host") || "").split(",")[0].trim();
  const host = forwardedHost || String(getHeader(req, "host") || "").trim();
  if (!host) return false;
  return url.host.toLowerCase() === host.toLowerCase();
}

function isDevSafeOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1";
  } catch (_) {
    return false;
  }
}

function isAllowedWebSocketOrigin(req, options = {}) {
  const origin = String(getHeader(req, "origin") || "").trim();
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (sameHostOrigin(req, normalized)) return true;
  const trustedOrigins = Array.isArray(options.trustedOrigins)
    ? options.trustedOrigins
    : getConfiguredTrustedOrigins();
  if (trustedOrigins.map(normalizeOrigin).filter(Boolean).includes(normalized)) return true;
  return process.env.NODE_ENV !== "production" && isDevSafeOrigin(normalized);
}

module.exports = {
  isAllowedWebSocketOrigin,
  normalizeOrigin,
};
