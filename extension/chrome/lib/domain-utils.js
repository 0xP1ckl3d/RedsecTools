const MULTI_PART_SUFFIXES = new Set([
  "ac.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.tr",
  "gov.uk",
  "net.au",
  "org.au",
  "org.uk",
]);

function normalizeHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}

function safeUrl(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function getHostname(input) {
  const parsed = safeUrl(input);
  return parsed ? normalizeHostname(parsed.hostname) : "";
}

function getBaseDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return host;

  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;

  const tail = parts.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(tail) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function getMatchLevel(candidateUrl, pageUrl) {
  const candidateHost = getHostname(candidateUrl);
  const pageHost = getHostname(pageUrl);
  if (!candidateHost || !pageHost) return "none";
  if (candidateHost === pageHost) return "exact";
  return getBaseDomain(candidateHost) === getBaseDomain(pageHost) ? "base" : "none";
}

export {
  normalizeHostname,
  safeUrl,
  getHostname,
  getBaseDomain,
  getMatchLevel,
};
