function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") return null;
  try {
    const url = new URL(origin);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function getConfiguredTrustedOrigins() {
  const raw = process.env.TRUSTED_PUBLIC_ORIGINS || "";
  const seen = new Set();
  const origins = [];

  for (const value of raw.split(",")) {
    const normalized = normalizeOrigin(value.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    origins.push(normalized);
  }

  return origins;
}

function isPrivateIpv4(hostname) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;

  const octets = match.slice(1).map((part) => parseInt(part, 10));
  if (octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
  );
}

function isDevSafeOrigin(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      isPrivateIpv4(hostname)
    );
  } catch {
    return false;
  }
}

function getRequestOrigin(req) {
  const forwardedProto = (req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = (req.get("x-forwarded-host") || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");

  if (!proto || !host) return null;
  return normalizeOrigin(`${proto}://${host}`);
}

function resolveTrustedOrigin(req) {
  const configuredOrigins = getConfiguredTrustedOrigins();
  const requestOrigin = getRequestOrigin(req);

  if (requestOrigin && configuredOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  if (configuredOrigins.length === 1) {
    return configuredOrigins[0];
  }

  if (configuredOrigins.length > 1) {
    return null;
  }

  if (process.env.NODE_ENV !== "production" && requestOrigin && isDevSafeOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return null;
}

function buildAbsoluteUrl(req, pathname) {
  const origin = resolveTrustedOrigin(req);
  if (!origin) return null;
  return new URL(pathname, `${origin}/`).toString();
}

function isTrustedAbsoluteUrl(url, req) {
  const normalized = normalizeOrigin(url);
  if (!normalized) return false;

  const targetOrigin = normalizeOrigin(url);
  const configuredOrigins = getConfiguredTrustedOrigins();

  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(targetOrigin);
  }

  return process.env.NODE_ENV !== "production" && isDevSafeOrigin(targetOrigin);
}

module.exports = {
  buildAbsoluteUrl,
  getConfiguredTrustedOrigins,
  getRequestOrigin,
  resolveTrustedOrigin,
  isTrustedAbsoluteUrl,
};
