const dns = require("dns").promises;
const net = require("net");

function ipv4ToNumber(address) {
  return address.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function ipv4InCidr(address, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(base) & mask);
}

function isBlockedIpv4(address) {
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([base, bits]) => ipv4InCidr(address, base, bits));
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff");
}

function isBlockedIp(address) {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

async function assertPublicHttpUrl(targetUrl, { allowPorts = null } = {}) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP(S) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL credentials are not allowed");
  }
  if (allowPorts && parsed.port && !allowPorts.has(parsed.port)) {
    throw new Error("URL port is not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost targets are not allowed");
  }
  if (hostname === "metadata.google.internal") {
    throw new Error("Cloud metadata targets are not allowed");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("Private or reserved IP targets are not allowed");
    return parsed;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isBlockedIp(entry.address))) {
    throw new Error("Private or reserved DNS targets are not allowed");
  }

  return parsed;
}

module.exports = {
  assertPublicHttpUrl,
  isBlockedIp,
};
