const crypto = require("node:crypto");
const dgram = require("node:dgram");
const dns = require("node:dns").promises;
const net = require("node:net");
const { domainToASCII } = require("node:url");
const { safeFetchPublicUrl } = require("../security/safe-fetch");
const { assertPublicHttpUrl, isBlockedIp } = require("../security/fetch-targets");
const { analyzeSecurityHeaders, headersObjectFromFetchHeaders } = require("./security-headers");

const DNS_TIMEOUT_MS = 3000;
const DNSBL_TIMEOUT_MS = 2000;
const HTTP_TIMEOUT_MS = 5000;
const PORT_TIMEOUT_MS = 1500;
const CACHE_MAX_ITEMS = 250;
const TOOL_RATE_STATE = new Map();
const TOOL_CACHE = new Map();
const ACTIVE_BY_PROFILE = new Map();

const COMMON_RECORD_TYPES = Object.freeze(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "CAA", "SRV", "DS", "DNSKEY", "RRSIG"]);
const DNS_RECORD_TYPES = Object.freeze([...COMMON_RECORD_TYPES, "PTR", "ALL_COMMON"]);
const CONSISTENCY_RECORD_TYPES = Object.freeze(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]);
const ALLOWED_PORTS = Object.freeze([
  { port: 21, service: "FTP" },
  { port: 22, service: "SSH" },
  { port: 53, service: "DNS" },
  { port: 80, service: "HTTP" },
  { port: 443, service: "HTTPS" },
  { port: 25, service: "SMTP" },
  { port: 587, service: "SMTP submission" },
  { port: 993, service: "IMAPS" },
  { port: 995, service: "POP3S" },
]);
const DNSBL_ZONES = Object.freeze(["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org"]);
const RESOLVERS = Object.freeze([
  { id: "cloudflare", label: "Cloudflare", servers: ["1.1.1.1"] },
  { id: "google", label: "Google", servers: ["8.8.8.8"] },
  { id: "quad9", label: "Quad9", servers: ["9.9.9.9"] },
  { id: "opendns", label: "OpenDNS", servers: ["208.67.222.222"] },
]);
const DEFAULT_RESOLVER_PROFILE = "cloudflare";
const RESOLVER_OPTIONS = Object.freeze(RESOLVERS.map((resolver) => resolver.id));
const DNS_QUERY_TYPES = Object.freeze({ DS: 43, DNSKEY: 48, RRSIG: 46 });

function toolInfo(whatItDoes, acceptedInput, returnedData, securityValue, limitations) {
  return { whatItDoes, acceptedInput, returnedData, securityValue, limitations };
}

const DNS_LOOKUP_TOOLS = Object.freeze([
  {
    id: "dns_records",
    label: "DNS Record Lookup",
    category: "dns",
    inputKind: "hostname",
    placeholder: "example.com, www.example.com, _dmarc.example.com",
    renderer: "table",
    rateLimit: { maxRequests: 60, windowSeconds: 3600 },
    cacheTtlMs: 5 * 60 * 1000,
    loadProfile: "dns",
    options: [
      { id: "recordType", label: "Record type", type: "select", default: "A", values: DNS_RECORD_TYPES },
      { id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS },
    ],
    info: toolInfo(
      "Retrieves selected DNS record types for a domain or hostname.",
      "A public domain or hostname. URLs are accepted and reduced to their hostname.",
      ["Record values", "Resolver status", "Record-specific fields such as MX priority or SOA values"],
      ["Validate public DNS configuration", "Review mail and security records", "Spot missing or risky records"],
      ["No passive DNS, historical DNS, brute forcing, or paid data sources are used", "ANY queries are not used", "Lookups use selected public recursive resolvers rather than the server's system DNS settings"]
    ),
  },
  {
    id: "security_dns_report",
    label: "Security DNS Report",
    category: "dns",
    inputKind: "domain",
    placeholder: "example.com",
    renderer: "groupedChecks",
    rateLimit: { maxRequests: 20, windowSeconds: 3600 },
    cacheTtlMs: 10 * 60 * 1000,
    loadProfile: "dns_report",
    options: [
      { id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS },
      { id: "dkimSelector", label: "DKIM selector", type: "text", placeholder: "selector1 (optional)" },
    ],
    info: toolInfo(
      "Runs a security-focused DNS review for a domain.",
      "A public domain name.",
      ["Authoritative DNS checks", "DNSSEC posture", "CAA records", "Mail security checks", "Optional DKIM selector check", "Zone transfer exposure", "Wildcard DNS behaviour"],
      ["Identify spoofing risk", "Catch delegation and DNSSEC gaps", "Find risky records without brute forcing"],
      ["No subdomain brute forcing, passive DNS, historical DNS analysis, or paid API enrichment is performed", "Wildcard checks use only two random labels", "DKIM is only checked when a selector is supplied"]
    ),
  },
  {
    id: "dnssec_test",
    label: "DNSSEC Test",
    category: "dns",
    inputKind: "domain",
    placeholder: "example.com",
    renderer: "groupedChecks",
    rateLimit: { maxRequests: 30, windowSeconds: 3600 },
    cacheTtlMs: 10 * 60 * 1000,
    loadProfile: "dns",
    options: [{ id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS }],
    info: toolInfo(
      "Checks whether DNSSEC is configured and appears to validate.",
      "A public domain name.",
      ["DS records", "DNSKEY records", "RRSIG presence", "Validation-style resolver result"],
      ["DNSSEC can protect DNS answers from tampering when configured correctly"],
      ["Validation is inferred through live DNS queries available to the server runtime"]
    ),
  },
  {
    id: "reverse_dns",
    label: "Reverse DNS / PTR Lookup",
    category: "dns",
    inputKind: "ip",
    placeholder: "8.8.8.8 or 2001:4860:4860::8888",
    renderer: "keyValue",
    rateLimit: { maxRequests: 60, windowSeconds: 3600 },
    cacheTtlMs: 30 * 60 * 1000,
    loadProfile: "dns",
    options: [{ id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS }],
    info: toolInfo(
      "Looks up PTR records for an IP and checks forward-confirmed reverse DNS.",
      "A single public IPv4 or IPv6 address.",
      ["PTR hostnames", "Forward lookup addresses", "Forward-confirmed status"],
      ["Useful for mail server hygiene and infrastructure diagnostics"],
      ["CIDR/range input is not accepted"]
    ),
  },
  {
    id: "mail_dns_health",
    label: "Mail DNS Health Check",
    category: "mail",
    inputKind: "domain",
    placeholder: "example.com",
    renderer: "groupedChecks",
    rateLimit: { maxRequests: 30, windowSeconds: 3600 },
    cacheTtlMs: 10 * 60 * 1000,
    loadProfile: "dns",
    options: [
      { id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS },
      { id: "dkimSelector", label: "DKIM selector", type: "text", placeholder: "selector1 (optional)" },
    ],
    info: toolInfo(
      "Reviews DNS records used for mail delivery and anti-spoofing.",
      "A public domain name. DKIM is checked only when a selector is provided.",
      ["MX", "SPF", "DMARC", "Optional DKIM", "MX PTR sanity"],
      ["Identify gaps that make spoofing or mail delivery failures more likely"],
      ["No selector brute forcing or email sending is performed"]
    ),
  },
  {
    id: "resolver_consistency",
    label: "DNS Resolver Consistency Check",
    category: "dns",
    inputKind: "hostname",
    placeholder: "example.com or www.example.com",
    renderer: "statusMatrix",
    rateLimit: { maxRequests: 20, windowSeconds: 3600 },
    cacheTtlMs: 2 * 60 * 1000,
    loadProfile: "resolver_consistency",
    options: [{ id: "recordType", label: "Record type", type: "select", default: "A", values: CONSISTENCY_RECORD_TYPES }],
    info: toolInfo(
      "Queries several recursive resolvers and compares their answers.",
      "A public domain or hostname.",
      ["Resolver", "Values", "Response time", "Error state"],
      ["Spot resolver disagreement or recent DNS change propagation issues"],
      ["This is not a true global propagation test and does not query from different countries"]
    ),
  },
  {
    id: "http_headers",
    label: "HTTP Headers",
    category: "web",
    inputKind: "url",
    placeholder: "example.com or https://example.com",
    renderer: "table",
    rateLimit: { maxRequests: 30, windowSeconds: 3600 },
    cacheTtlMs: 2 * 60 * 1000,
    loadProfile: "http",
    info: toolInfo(
      "Fetches HTTP response headers and highlights common browser security controls.",
      "A public domain or HTTP(S) URL. Bare hosts default to HTTPS.",
      ["Final URL", "HTTP status", "Headers", "Security header findings"],
      ["Review HSTS, CSP, clickjacking, MIME sniffing, referrer, permissions, and cookie flags"],
      ["Response bodies are not collected beyond the minimum needed by the fetch runtime"]
    ),
  },
  {
    id: "site_availability",
    label: "Site Availability Check",
    category: "web",
    inputKind: "url",
    placeholder: "example.com or https://example.com",
    renderer: "groupedChecks",
    rateLimit: { maxRequests: 30, windowSeconds: 3600 },
    cacheTtlMs: 60 * 1000,
    loadProfile: "http",
    options: [{ id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS }],
    info: toolInfo(
      "Checks whether a domain resolves and responds over HTTPS or HTTP.",
      "A public domain or HTTP(S) URL.",
      ["DNS status", "TCP connect", "TLS result", "HTTP status", "Final URL"],
      ["Fast one-off availability diagnosis"],
      ["This is not continuous monitoring"]
    ),
  },
  {
    id: "light_port_check",
    label: "Light Port Check",
    category: "web",
    inputKind: "hostname",
    placeholder: "example.com or 203.0.113.10",
    renderer: "table",
    rateLimit: { maxRequests: 5, windowSeconds: 3600 },
    cacheTtlMs: 60 * 1000,
    loadProfile: "port_check",
    options: [{ id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS }],
    info: toolInfo(
      "Checks a fixed, tiny set of common TCP ports.",
      "A single public hostname or IP address.",
      ["Port", "Service", "Open/filtered/closed", "Latency"],
      ["Quick connectivity triage for DNS, web, and mail service ports"],
      ["Not a general-purpose port scanner. Custom ports and port ranges are not supported. No banner grabbing is performed."]
    ),
  },
  {
    id: "dnsbl_check",
    label: "DNSBL / Spam Database Check",
    category: "mail",
    inputKind: "ip",
    placeholder: "8.8.8.8",
    renderer: "table",
    rateLimit: { maxRequests: 10, windowSeconds: 3600 },
    cacheTtlMs: 30 * 60 * 1000,
    loadProfile: "dns",
    options: [{ id: "resolverProfile", label: "Resolver", type: "select", default: DEFAULT_RESOLVER_PROFILE, values: RESOLVER_OPTIONS }],
    info: toolInfo(
      "Checks one IP against a small curated set of DNS-based spam blocklists.",
      "A single public IPv4 address.",
      ["Blocklist", "Listed state", "Returned code", "TXT reason"],
      ["Mail delivery diagnostics"],
      ["No reputation scoring, CIDR/range input, or large commercial reputation datasets are used"]
    ),
  },
  {
    id: "url_decode",
    label: "URL Decode",
    category: "utility",
    inputKind: "string",
    placeholder: "https%3A%2F%2Fexample.com%2Ftest%3Fa%3D1",
    renderer: "rawText",
    rateLimit: { maxRequests: 300, windowSeconds: 3600 },
    cacheTtlMs: 0,
    loadProfile: "very_low",
    options: [
      { id: "plusToSpace", label: "Convert + to spaces", type: "boolean", default: true },
      { id: "repeatDecode", label: "Repeated decode, max 3 passes", type: "boolean", default: false },
    ],
    info: toolInfo(
      "Decodes percent-encoded URL strings locally on the server.",
      "A URL-encoded string.",
      ["Original input", "Decoded output", "Decode passes", "Malformed encoding errors"],
      ["Useful for triaging encoded URLs and payloads"],
      ["No network requests are made"]
    ),
  },
]);

const TOOL_BY_ID = new Map(DNS_LOOKUP_TOOLS.map((tool) => [tool.id, tool]));
const CONCURRENCY_LIMITS = Object.freeze({
  dns_report: 10,
  resolver_consistency: 5,
  port_check: 3,
  http: 5,
});

function publicToolRegistry() {
  return DNS_LOOKUP_TOOLS.map((tool) => ({
    id: tool.id,
    label: tool.label,
    category: tool.category,
    inputKind: tool.inputKind,
    placeholder: tool.placeholder,
    renderer: tool.renderer,
    enabled: true,
    cost: "local",
    provider: { id: "local", name: "Local resolver/runtime", mode: "local", requiresApiKey: false },
    rateLimit: tool.rateLimit,
    info: tool.info,
    options: tool.options || [],
  }));
}

function normalizeDnsToolId(value) {
  const toolId = String(value || "").trim();
  const tool = TOOL_BY_ID.get(toolId);
  return tool ? { ok: true, toolId, tool } : { ok: false, error: "Unknown DNS lookup type" };
}

function hasRangeSyntax(value) {
  return /[,/\\]|\.{2}|\s+-\s+/.test(String(value || ""));
}

function normalizeHostnameInput(value, { stripUrl = true, requireDomain = false } = {}) {
  let raw = String(value || "").trim();
  if (!raw) return { ok: false, error: "Target is required" };
  if (raw.length > 253) return { ok: false, error: "Target is too long" };
  if (raw.startsWith("*.")) return { ok: false, error: "Wildcard targets are not supported for this lookup" };
  if (stripUrl && /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).hostname;
    } catch {
      return { ok: false, error: "Invalid URL" };
    }
  }
  if (hasRangeSyntax(raw)) return { ok: false, error: "Ranges, CIDR notation, and multiple targets are not supported" };
  raw = raw.replace(/\.$/, "").toLowerCase();
  if (net.isIP(raw)) return { ok: false, error: "A domain or hostname is required" };
  const ascii = domainToASCII(raw);
  if (!ascii || ascii.length > 253) return { ok: false, error: "Invalid domain or hostname" };
  const labels = ascii.split(".");
  if (requireDomain && labels.length < 2) return { ok: false, error: "A registrable domain is required" };
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    return { ok: false, error: "Invalid domain label" };
  }
  return { ok: true, target: ascii };
}

function normalizeIpInput(value, { requireV4 = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, error: "IP address is required" };
  if (hasRangeSyntax(raw)) return { ok: false, error: "CIDR, ranges, and multiple IPs are not supported" };
  const family = net.isIP(raw);
  if (!family) return { ok: false, error: "Valid IP address required" };
  if (requireV4 && family !== 4) return { ok: false, error: "A single IPv4 address is required" };
  if (isBlockedIp(raw)) return { ok: false, error: "Private or reserved IP targets are not allowed" };
  return { ok: true, target: raw, family };
}

function normalizeUrlInput(value) {
  let raw = String(value || "").trim();
  if (!raw) return { ok: false, error: "URL or hostname is required" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, error: "Only HTTP(S) URLs are supported" };
    if (parsed.username || parsed.password) return { ok: false, error: "URL credentials are not allowed" };
    if (parsed.hostname === "localhost" || parsed.hostname.endsWith(".localhost")) return { ok: false, error: "Localhost targets are not allowed" };
    return { ok: true, target: parsed.href };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

function validateToolInput(tool, target, options = {}) {
  if (tool.inputKind === "ip") return normalizeIpInput(target, { requireV4: tool.id === "dnsbl_check" });
  if (tool.inputKind === "url") return normalizeUrlInput(target);
  if (tool.inputKind === "domain") return normalizeHostnameInput(target, { requireDomain: true });
  if (tool.inputKind === "hostname") {
    if (tool.id === "light_port_check" && net.isIP(String(target || "").trim())) return normalizeIpInput(target);
    return normalizeHostnameInput(target, { requireDomain: false });
  }
  const text = String(target || "").trim();
  if (!text) return { ok: false, error: "Input is required" };
  if (text.length > 12000) return { ok: false, error: "Input must be 12KB or less" };
  return { ok: true, target: text };
}

function normalizeOptions(tool, options = {}) {
  const output = {};
  if ((tool.options || []).some((option) => option.id === "resolverProfile")) {
    const profile = String(options.resolverProfile || DEFAULT_RESOLVER_PROFILE).trim().toLowerCase();
    output.resolverProfile = RESOLVERS.some((resolver) => resolver.id === profile) ? profile : DEFAULT_RESOLVER_PROFILE;
  }
  if (tool.id === "dns_records") {
    const type = String(options.recordType || "A").trim().toUpperCase();
    output.recordType = DNS_RECORD_TYPES.includes(type) ? type : "A";
  }
  if (tool.id === "resolver_consistency") {
    const type = String(options.recordType || "A").trim().toUpperCase();
    output.recordType = CONSISTENCY_RECORD_TYPES.includes(type) ? type : "A";
  }
  if (tool.id === "security_dns_report" || tool.id === "mail_dns_health") {
    const selector = String(options.dkimSelector || "").trim().toLowerCase();
    if (selector) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(selector)) {
        return { ok: false, error: "Invalid DKIM selector" };
      }
      output.dkimSelector = selector;
    }
  }
  if (tool.id === "url_decode") {
    output.plusToSpace = options.plusToSpace !== false;
    output.repeatDecode = !!options.repeatDecode;
  }
  return { ok: true, options: output };
}

function resolverProfile(profileId) {
  return RESOLVERS.find((resolver) => resolver.id === profileId) || RESOLVERS.find((resolver) => resolver.id === DEFAULT_RESOLVER_PROFILE);
}

function resolverFromOptions(options = {}) {
  const profile = resolverProfile(options.resolverProfile || DEFAULT_RESOLVER_PROFILE);
  const resolver = new dns.Resolver();
  resolver.setServers(profile.servers);
  return { resolver, profile };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function newResolver(servers) {
  const resolver = new dns.Resolver();
  resolver.setServers(servers);
  return resolver;
}

async function resolveRecord(name, type, { resolver = dns, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  const started = Date.now();
  try {
    let values = [];
    if (type === "A") values = (await withTimeout(resolver.resolve4(name, { ttl: true }), timeoutMs, `${type} query`)).map((r) => ({ value: r.address, ttl: r.ttl }));
    else if (type === "AAAA") values = (await withTimeout(resolver.resolve6(name, { ttl: true }), timeoutMs, `${type} query`)).map((r) => ({ value: r.address, ttl: r.ttl }));
    else if (type === "MX") values = (await withTimeout(resolver.resolveMx(name), timeoutMs, `${type} query`)).map((r) => ({ value: r.exchange, priority: r.priority }));
    else if (type === "TXT") values = (await withTimeout(resolver.resolveTxt(name), timeoutMs, `${type} query`)).map((parts) => ({ value: parts.join("") }));
    else if (type === "NS") values = (await withTimeout(resolver.resolveNs(name), timeoutMs, `${type} query`)).map((value) => ({ value }));
    else if (type === "SOA") values = [await withTimeout(resolver.resolveSoa(name), timeoutMs, `${type} query`)];
    else if (type === "CAA") values = (await withTimeout(resolver.resolveCaa(name), timeoutMs, `${type} query`)).map((r) => ({ value: `${r.critical ? "critical " : ""}${r.issue || r.issuewild || r.iodef || ""}`.trim(), ...r }));
    else if (type === "SRV") values = (await withTimeout(resolver.resolveSrv(name), timeoutMs, `${type} query`)).map((r) => ({ value: `${r.target}:${r.port}`, priority: r.priority, weight: r.weight, port: r.port }));
    else if (type === "CNAME") values = (await withTimeout(resolver.resolveCname(name), timeoutMs, `${type} query`)).map((value) => ({ value }));
    else if (type === "PTR") values = (await withTimeout(resolver.resolvePtr(name), timeoutMs, `${type} query`)).map((value) => ({ value }));
    else if (DNS_QUERY_TYPES[type]) values = await resolveRawDnsRecords(name, type, resolver, timeoutMs);
    else values = (await withTimeout(resolver.resolve(name, type), timeoutMs, `${type} query`)).map((value) => ({ value: typeof value === "string" ? value : JSON.stringify(value), raw: value }));
    return { type, status: "success", values, durationMs: Date.now() - started };
  } catch (error) {
    const errorInfo = dnsErrorInfo(error);
    return { type, status: errorInfo.status, values: [], error: errorInfo.message, durationMs: Date.now() - started };
  }
}

function dnsErrorInfo(error) {
  if (!error) return { status: "error", message: "DNS query failed" };
  if (["ENODATA", "ENOTFOUND", "ENODOMAIN", "ENOTIMP", "NXDOMAIN", "NODATA"].includes(error.code || error.message)) {
    return { status: "no_data", message: "No data" };
  }
  return { status: "error", message: error.message || String(error) };
}

async function resolveRawDnsRecords(name, type, resolver, timeoutMs) {
  const servers = typeof resolver.getServers === "function" ? resolver.getServers() : [];
  const server = servers[0] || resolverProfile(DEFAULT_RESOLVER_PROFILE).servers[0];
  const response = await rawDnsQuery(name, DNS_QUERY_TYPES[type], server, timeoutMs);
  if (response.rcode === 3 || response.answerCount === 0) {
    const err = new Error("No data");
    err.code = "NODATA";
    throw err;
  }
  if (response.rcode !== 0) throw new Error(`DNS query failed with rcode ${response.rcode}`);
  return response.records.map((record) => ({ value: formatRawDnsRecord(type, record.rdata), raw: record }));
}

function rawDnsQuery(name, qtype, server, timeoutMs = DNS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket(net.isIP(server) === 6 ? "udp6" : "udp4");
    const { id, packet } = dnsQuestionPacket(name, qtype);
    const chunks = [];
    const timer = setTimeout(() => {
      client.close();
      reject(new Error("DNS query timed out"));
    }, timeoutMs);
    client.once("message", (message) => {
      clearTimeout(timer);
      client.close();
      try {
        const parsed = parseDnsResponse(message, id);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
    client.once("error", (error) => {
      clearTimeout(timer);
      client.close();
      reject(error);
    });
    client.send(packet, 53, server);
  });
}

function readDnsName(buffer, offset, depth = 0) {
  if (depth > 12) throw new Error("DNS compression pointer loop");
  const labels = [];
  let cursor = offset;
  let consumed = 0;
  while (cursor < buffer.length) {
    const len = buffer[cursor];
    if ((len & 0xc0) === 0xc0) {
      const pointer = ((len & 0x3f) << 8) | buffer[cursor + 1];
      const pointed = readDnsName(buffer, pointer, depth + 1);
      labels.push(pointed.name);
      consumed += 2;
      return { name: labels.filter(Boolean).join("."), nextOffset: offset + consumed };
    }
    cursor += 1;
    consumed += 1;
    if (len === 0) break;
    labels.push(buffer.slice(cursor, cursor + len).toString("ascii"));
    cursor += len;
    consumed += len;
  }
  return { name: labels.join("."), nextOffset: cursor };
}

function parseDnsResponse(buffer, expectedId) {
  if (buffer.length < 12) throw new Error("Short DNS response");
  const id = buffer.readUInt16BE(0);
  if (id !== expectedId) throw new Error("Mismatched DNS response");
  const flags = buffer.readUInt16BE(2);
  const rcode = flags & 0x000f;
  const qdcount = buffer.readUInt16BE(4);
  const ancount = buffer.readUInt16BE(6);
  let offset = 12;
  for (let i = 0; i < qdcount; i += 1) {
    const qname = readDnsName(buffer, offset);
    offset = qname.nextOffset + 4;
  }
  const records = [];
  for (let i = 0; i < ancount; i += 1) {
    const name = readDnsName(buffer, offset);
    offset = name.nextOffset;
    const rrtype = buffer.readUInt16BE(offset); offset += 2;
    const rrclass = buffer.readUInt16BE(offset); offset += 2;
    const ttl = buffer.readUInt32BE(offset); offset += 4;
    const rdlength = buffer.readUInt16BE(offset); offset += 2;
    const rdataOffset = offset;
    const rdata = buffer.slice(offset, offset + rdlength);
    offset += rdlength;
    records.push({ name: name.name, rrtype, rrclass, ttl, rdata, rdataOffset, packet: buffer });
  }
  return { rcode, answerCount: ancount, records };
}

function formatRawDnsRecord(type, rdata) {
  if (type === "DS" && rdata.length >= 4) {
    return `keyTag=${rdata.readUInt16BE(0)} algorithm=${rdata[2]} digestType=${rdata[3]} digest=${rdata.slice(4).toString("hex").toUpperCase()}`;
  }
  if (type === "DNSKEY" && rdata.length >= 4) {
    return `flags=${rdata.readUInt16BE(0)} protocol=${rdata[2]} algorithm=${rdata[3]} publicKey=${rdata.slice(4).toString("base64")}`;
  }
  if (type === "RRSIG" && rdata.length >= 18) {
    return `typeCovered=${rdata.readUInt16BE(0)} algorithm=${rdata[2]} labels=${rdata[3]} originalTtl=${rdata.readUInt32BE(4)} keyTag=${rdata.readUInt16BE(16)} signature=${rdata.slice(18).toString("base64")}`;
  }
  return rdata.toString("hex").toUpperCase();
}

function flattenDnsRows(name, responses, resolverLabel = "Cloudflare") {
  return responses.flatMap((response) => {
    if (!response.values.length) return [{ name, type: response.type, resolver: resolverLabel, status: response.status, error: response.error || "" }];
    return response.values.map((record) => ({
      name,
      type: response.type,
      resolver: resolverLabel,
      ttl: record.ttl ?? "",
      priority: record.priority ?? "",
      value: record.value ?? JSON.stringify(record),
      status: response.status,
      error: response.error || "",
      raw: record,
    }));
  });
}

function check(status, category, title, evidence, impact, recommendation) {
  return { category, status, title, evidence, impact, recommendation };
}

function statusRank(status) {
  return { fail: 0, error: 1, warning: 2, info: 3, pass: 4 }[status] ?? 5;
}

function summarizeChecks(checks) {
  const counts = { pass: 0, info: 0, warning: 0, fail: 0, error: 0 };
  for (const item of checks) counts[item.status] = (counts[item.status] || 0) + 1;
  const parts = [];
  if (counts.fail) parts.push(`${counts.fail} failed`);
  if (counts.error) parts.push(`${counts.error} errors`);
  if (counts.warning) parts.push(`${counts.warning} warnings`);
  if (counts.pass) parts.push(`${counts.pass} passed`);
  if (counts.info) parts.push(`${counts.info} info`);
  return { counts, summary: parts.join(", ") || "No checks returned" };
}

async function runDnsRecords(target, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const types = options.recordType === "ALL_COMMON" ? COMMON_RECORD_TYPES : [options.recordType];
  const responses = await Promise.all(types.map((type) => resolveRecord(target, type, { resolver })));
  const rows = flattenDnsRows(target, responses, profile.label);
  const insights = [];
  const byType = Object.fromEntries(responses.map((r) => [r.type, r]));
  if (types.includes("A") && byType.A?.values.length === 0) insights.push(check("warning", "Record Hygiene", "No A records found", "No IPv4 A records were returned.", "IPv4-only clients may not reach the host.", "Publish A records if IPv4 reachability is required."));
  if (types.includes("CAA") && byType.CAA?.values.length === 0) insights.push(check("warning", "CAA", "CAA record missing", "No CAA records were returned.", "Any CA may issue for this name unless constrained higher in the DNS tree.", "Publish CAA issue/issuewild records for approved CAs."));
  return {
    renderer: "table",
    summary: `${rows.filter((row) => row.value).length} DNS record values returned across ${types.length} type(s).`,
    data: { rows, insights },
    raw: { responses },
  };
}

async function resolveTxtJoined(name, resolver) {
  const result = await resolveRecord(name, "TXT", { resolver });
  return result.values.map((r) => String(r.value || ""));
}

async function resolveCaaWalk(domain, resolver) {
  const labels = domain.split(".");
  for (let i = 0; i <= labels.length - 2; i += 1) {
    const candidate = labels.slice(i).join(".");
    const result = await resolveRecord(candidate, "CAA", { resolver });
    if (result.values.length) return { name: candidate, records: result.values, error: null };
  }
  return { name: domain, records: [], error: null };
}

function parseDmarc(record) {
  const output = {};
  for (const part of String(record || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) output[key.toLowerCase()] = rest.join("=");
  }
  return output;
}

function estimateSpfLookups(record) {
  const text = String(record || "").toLowerCase();
  const mechanisms = ["include:", " a", " mx", "exists:", "redirect="];
  return mechanisms.reduce((count, token) => count + (text.split(token).length - 1), 0);
}

async function resolveIpsForHost(host, resolver = resolverFromOptions().resolver) {
  const [ipv4, ipv6] = await Promise.all([
    resolveRecord(host, "A", { resolver }).catch(() => ({ values: [] })),
    resolveRecord(host, "AAAA", { resolver }).catch(() => ({ values: [] })),
  ]);
  return [...(ipv4.values || []), ...(ipv6.values || [])].map((row) => row.value).filter(Boolean);
}

async function mailChecks(domain, options = {}, resolver = resolverFromOptions(options).resolver) {
  const checks = [];
  const [mx, txtRecords, dmarcRecords] = await Promise.all([
    resolveRecord(domain, "MX", { resolver }),
    resolveTxtJoined(domain, resolver).catch(() => []),
    resolveTxtJoined(`_dmarc.${domain}`, resolver).catch(() => []),
  ]);
  const spfRecords = txtRecords.filter((record) => /^v=spf1\b/i.test(record));
  checks.push(mx.values.length
    ? check("pass", "Mail Security", "MX records exist", `${mx.values.length} MX record(s) returned.`, "Mail exchangers are published for the domain.", "Keep MX targets resolving directly to mail hosts.")
    : check("warning", "Mail Security", "MX records missing", "No MX records were returned.", "The domain may not receive mail or may rely on implicit fallback behaviour.", "Publish MX records if this domain sends or receives email."));

  for (const mxRecord of mx.values.slice(0, 8)) {
    const exchange = mxRecord.value;
    const cname = await resolveRecord(exchange, "CNAME", { resolver });
    const ips = await resolveIpsForHost(exchange, resolver);
    checks.push(ips.length
      ? check("pass", "Mail Security", `MX target resolves: ${exchange}`, ips.join(", "), "Mail delivery can resolve the MX target.", "Monitor mail-host DNS changes.")
      : check("fail", "Mail Security", `MX target does not resolve: ${exchange}`, "No A/AAAA addresses were resolved.", "Mail delivery to this domain can fail.", "Fix or remove the broken MX target."));
    if (cname.values.length) {
      checks.push(check("warning", "Mail Security", `MX target uses CNAME: ${exchange}`, cname.values.map((r) => r.value).join(", "), "MX targets pointing to CNAMEs can cause interoperability issues.", "Point MX records directly at canonical hostnames."));
    }
  }

  if (!spfRecords.length) {
    checks.push(check("fail", "Mail Security", "SPF record missing", `No SPF TXT record found at ${domain}.`, "Spoofed email using this domain may be harder for recipients to reject.", "Publish an SPF record listing authorised senders."));
  } else if (spfRecords.length > 1) {
    checks.push(check("fail", "Mail Security", "Multiple SPF records", spfRecords.join(" | "), "Multiple SPF records produce permerror in SPF evaluation.", "Merge SPF mechanisms into one TXT record."));
  } else {
    const spf = spfRecords[0];
    const lookups = estimateSpfLookups(spf);
    const status = /\+all|\?all/i.test(spf) ? "fail" : /~all/i.test(spf) ? "warning" : "pass";
    checks.push(check(status, "Mail Security", "SPF record present", spf, "SPF helps receivers identify authorised senders.", lookups > 10 ? "Reduce DNS-querying SPF mechanisms to stay within the 10 lookup limit." : "Review authorised senders periodically."));
    checks.push(check(lookups > 10 ? "fail" : lookups >= 8 ? "warning" : "info", "Mail Security", "SPF DNS lookup estimate", `${lookups} lookup-causing mechanism(s) estimated.`, "SPF evaluation fails when more than 10 DNS lookups are required.", "Keep SPF includes and redirects minimal."));
  }

  const dmarcRecord = dmarcRecords.find((record) => /^v=dmarc1\b/i.test(record));
  if (!dmarcRecord) {
    checks.push(check("fail", "Mail Security", "DMARC record missing", `No TXT record was found at _dmarc.${domain}.`, "Spoofed email using this domain may be harder for recipients to reject.", "Publish a DMARC record and move towards p=quarantine or p=reject after monitoring."));
  } else {
    const parsed = parseDmarc(dmarcRecord);
    const policy = String(parsed.p || "").toLowerCase();
    const status = policy === "reject" ? "pass" : policy === "quarantine" ? "warning" : "fail";
    checks.push(check(status, "Mail Security", `DMARC policy is ${policy || "not set"}`, dmarcRecord, "DMARC policy tells receivers how to handle failing aligned mail.", "Move towards p=quarantine or p=reject once reporting is reviewed."));
    checks.push(check(parsed.rua || parsed.ruf ? "info" : "warning", "Mail Security", "DMARC reporting URIs", `rua=${parsed.rua || "-"}; ruf=${parsed.ruf || "-"}`, "Reports help measure spoofing and deployment impact.", "Publish rua reporting during rollout where appropriate."));
  }

  if (options.dkimSelector) {
    const name = `${options.dkimSelector}._domainkey.${domain}`;
    const dkim = await resolveTxtJoined(name, resolver).catch(() => []);
    const dkimRecord = dkim.find((record) => /v=dkim1/i.test(record));
    checks.push(dkimRecord
      ? check("pass", "Mail Security", "DKIM selector record exists", `${name}: ${dkimRecord}`, "DKIM allows receivers to validate signed mail for this selector.", "Rotate DKIM keys according to policy.")
      : check("warning", "Mail Security", "DKIM selector record missing", `No DKIM TXT record found at ${name}.`, "Mail signed with this selector will fail DKIM validation.", "Verify the selector or publish the DKIM public key."));
  }
  return checks;
}

async function dnssecChecks(domain, resolver = resolverFromOptions().resolver) {
  const [ds, dnskey, rrsig] = await Promise.all([
    resolveRecord(domain, "DS", { resolver }),
    resolveRecord(domain, "DNSKEY", { resolver }),
    resolveRecord(domain, "RRSIG", { resolver }),
  ]);
  const checks = [];
  checks.push(ds.values.length
    ? check("pass", "DNSSEC", "DS record present", `${ds.values.length} DS record(s) returned.`, "Parent delegation advertises DNSSEC for this domain.", "Keep DS records aligned with active KSK material.")
    : check("warning", "DNSSEC", "DS record missing", "No DS record was returned.", "Resolvers cannot build a signed chain from the parent zone.", "Publish DS records if DNSSEC is intended."));
  checks.push(dnskey.values.length
    ? check("pass", "DNSSEC", "DNSKEY record present", `${dnskey.values.length} DNSKEY record(s) returned.`, "The child zone publishes DNSSEC keys.", "Monitor key rollovers.")
    : check("warning", "DNSSEC", "DNSKEY record missing", "No DNSKEY record was returned.", "The child zone does not appear signed.", "Enable DNSSEC at the authoritative DNS provider if required."));
  checks.push(rrsig.values.length
    ? check("pass", "DNSSEC", "RRSIG records present", `${rrsig.values.length} RRSIG record(s) returned.`, "Signed RRsets were observed.", "Ensure signatures refresh before expiry.")
    : check("info", "DNSSEC", "RRSIG records not observed", rrsig.error || "No RRSIG values returned.", "Some recursive resolvers may not expose signatures for every query.", "Validate using authoritative tooling when needed."));
  const validationState = ds.values.length && dnskey.values.length ? "Signed and appears configured" : ds.values.length || dnskey.values.length ? "Partially configured" : "Unsigned";
  checks.push(check(validationState.startsWith("Signed") ? "pass" : validationState.startsWith("Partially") ? "warning" : "info", "DNSSEC", validationState, `DS=${ds.values.length}; DNSKEY=${dnskey.values.length}; RRSIG=${rrsig.values.length}`, "DNSSEC only protects clients when the chain is complete and validates.", "Complete DNSSEC setup or document why the domain is intentionally unsigned."));
  return { checks, raw: { ds, dnskey, rrsig } };
}

function encodeDnsName(name) {
  return Buffer.concat(name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])).concat(Buffer.from([0])));
}

function dnsQuestionPacket(name, qtype) {
  const id = crypto.randomInt(1, 65535);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const question = Buffer.concat([encodeDnsName(name), Buffer.from([(qtype >> 8) & 0xff, qtype & 0xff, 0x00, 0x01])]);
  return { id, packet: Buffer.concat([header, question]) };
}

function udpDnsProbe(name, serverIp, timeoutMs = DNS_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const client = dgram.createSocket("udp4");
    const { id, packet } = dnsQuestionPacket(name, 1);
    const started = Date.now();
    const timer = setTimeout(() => { client.close(); resolve({ ok: false, error: "timeout", durationMs: Date.now() - started }); }, timeoutMs);
    client.once("message", (message) => {
      clearTimeout(timer);
      client.close();
      resolve({ ok: message.length >= 12 && message.readUInt16BE(0) === id, durationMs: Date.now() - started });
    });
    client.once("error", (error) => {
      clearTimeout(timer);
      client.close();
      resolve({ ok: false, error: error.message, durationMs: Date.now() - started });
    });
    client.send(packet, 53, serverIp);
  });
}

function tcpDnsProbe(name, serverIp, qtype = 1, timeoutMs = DNS_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: serverIp, port: 53 });
    const { id, packet } = dnsQuestionPacket(name, qtype);
    const framed = Buffer.concat([Buffer.from([(packet.length >> 8) & 0xff, packet.length & 0xff]), packet]);
    const started = Date.now();
    const timer = setTimeout(() => { socket.destroy(); resolve({ ok: false, error: "timeout", durationMs: Date.now() - started }); }, timeoutMs);
    let data = Buffer.alloc(0);
    socket.once("connect", () => socket.write(framed));
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length >= 14) {
        clearTimeout(timer);
        socket.destroy();
        const body = data.slice(2);
        const responseId = body.readUInt16BE(0);
        const rcode = body.readUInt16BE(2) & 0x000f;
        const ancount = body.readUInt16BE(6);
        resolve({ ok: responseId === id && rcode === 0, answerCount: ancount, rcode, durationMs: Date.now() - started });
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, durationMs: Date.now() - started });
    });
  });
}

async function axfrProbe(domain, nsHost, nsIp) {
  const result = await tcpDnsProbe(domain, nsIp, 252, DNS_TIMEOUT_MS).catch((error) => ({ ok: false, error: error.message }));
  if (result.ok && Number(result.answerCount || 0) > 1) return { status: "fail", evidence: `AXFR returned ${result.answerCount} answer records from ${nsHost} (${nsIp}).` };
  if (result.rcode === 5 || result.ok === false) return { status: "pass", evidence: `AXFR refused or failed for ${nsHost} (${nsIp}).` };
  return { status: "warning", evidence: `AXFR test was inconclusive for ${nsHost} (${nsIp}).` };
}

async function wildcardChecks(domain, resolver = resolverFromOptions().resolver) {
  const checks = [];
  const names = [crypto.randomBytes(4).toString("hex"), crypto.randomBytes(4).toString("hex")].map((label) => `redsec-random-${label}.${domain}`);
  const results = await Promise.all(names.map((name) => resolveRecord(name, "A", { resolver })));
  const resolved = results.filter((r) => r.values.length);
  checks.push(resolved.length
    ? check("warning", "Wildcard DNS", "Wildcard DNS resolution active", `${resolved.length} random subdomain(s) resolved.`, "Wildcard DNS expands the addressable attack surface and can complicate phishing/hijack triage.", "Use wildcard DNS only where there is a clear operational need.")
    : check("pass", "Wildcard DNS", "Wildcard DNS not detected", "Two random labels did not resolve.", "Unexpected subdomain resolution was not observed.", "No action required."));
  return checks;
}

async function authoritativeChecks(domain, resolver = resolverFromOptions().resolver) {
  const checks = [];
  const [ns, soa] = await Promise.all([resolveRecord(domain, "NS", { resolver }), resolveRecord(domain, "SOA", { resolver })]);
  checks.push(ns.values.length
    ? check(ns.values.length >= 2 ? "pass" : "warning", "Authoritative DNS", "Nameserver records exist", `${ns.values.length} NS record(s) returned.`, "Multiple authoritative nameservers improve resilience.", "Use at least two authoritative nameservers on independent infrastructure where practical.")
    : check("fail", "Authoritative DNS", "Nameserver records missing", "No NS records were returned.", "Delegation may be broken.", "Publish authoritative NS records."));
  checks.push(soa.values.length
    ? check("pass", "Authoritative DNS", "SOA record exists", JSON.stringify(soa.values[0]), "SOA identifies authoritative zone metadata.", "Monitor serial and timing values.")
    : check("fail", "Authoritative DNS", "SOA record missing", soa.error || "No SOA record returned.", "Zone authority cannot be confirmed.", "Fix authoritative zone configuration."));
  for (const record of ns.values.slice(0, 8)) {
    const nsHost = record.value;
    const ips = await resolveIpsForHost(nsHost, resolver);
    checks.push(ips.length
      ? check("pass", "Authoritative DNS", `Nameserver resolves: ${nsHost}`, ips.join(", "), "Recursive resolvers can find the authoritative server.", "Monitor NS target DNS.")
      : check("fail", "Authoritative DNS", `Nameserver does not resolve: ${nsHost}`, "No A/AAAA records resolved.", "Delegation can fail when NS hostnames do not resolve.", "Fix the NS target address records."));
    const ipv4 = ips.find((ip) => net.isIP(ip) === 4 && !isBlockedIp(ip));
    if (ipv4) {
      const [udp, tcp, axfr] = await Promise.all([udpDnsProbe(domain, ipv4), tcpDnsProbe(domain, ipv4), axfrProbe(domain, nsHost, ipv4)]);
      checks.push(check(udp.ok ? "pass" : "warning", "Authoritative DNS", `UDP/53 responds: ${nsHost}`, udp.ok ? `${udp.durationMs}ms` : (udp.error || "No UDP response"), "Authoritative DNS is normally served over UDP.", "Check firewall and authoritative DNS health if this fails."));
      checks.push(check(tcp.ok ? "pass" : "warning", "Authoritative DNS", `TCP/53 responds: ${nsHost}`, tcp.ok ? `${tcp.durationMs}ms` : (tcp.error || "No TCP response"), "TCP is required for large DNS answers and zone operations.", "Allow TCP/53 to authoritative servers."));
      checks.push(check(axfr.status, "Zone Transfer", `AXFR check: ${nsHost}`, axfr.evidence, "Open zone transfers expose full zone contents.", "Refuse AXFR except to authorised secondary nameservers."));
    } else {
      checks.push(check("warning", "Authoritative DNS", `Authoritative probe skipped: ${nsHost}`, "No public IPv4 address resolved for low-impact UDP/TCP/AXFR probes.", "Verify authoritative reachability separately if this domain uses IPv6-only nameservers."));
    }
  }
  return { checks, raw: { ns, soa } };
}

async function caaChecks(domain, resolver = resolverFromOptions().resolver) {
  const caa = await resolveCaaWalk(domain, resolver);
  const checks = [];
  if (!caa.records.length) {
    checks.push(check("warning", "CAA", "CAA records missing", `No CAA records found while walking from ${domain}.`, "Any CA may issue for this domain unless constrained elsewhere.", "Publish CAA issue and issuewild records for approved certificate authorities."));
  } else {
    const values = caa.records.map((record) => record.value || JSON.stringify(record));
    const hasIssue = values.some((value) => /\bissue\b/i.test(value));
    checks.push(check("pass", "CAA", "CAA records present", `${caa.name}: ${values.join(" | ")}`, "CAA restricts certificate issuance.", hasIssue ? "Keep issuer list current." : "Add issue records in addition to issuewild where appropriate."));
  }
  return { checks, raw: caa };
}

async function recordHygieneChecks(domain, resolver = resolverFromOptions().resolver) {
  const checks = [];
  const [cname, txt] = await Promise.all([resolveRecord(domain, "CNAME", { resolver }), resolveTxtJoined(domain, resolver).catch(() => [])]);
  for (const record of cname.values) {
    const ips = await resolveIpsForHost(record.value, resolver);
    if (!ips.length) {
      checks.push(check("fail", "Record Hygiene", "Dangling CNAME target", `${domain} -> ${record.value}`, "Dangling CNAMEs can break service and may support takeover in some providers.", "Remove or fix the CNAME target."));
    }
  }
  const riskyTxt = txt.filter((value) => /(internal|staging|dev|uat|corp|localhost|\.local|password|secret|token)/i.test(value));
  checks.push(riskyTxt.length
    ? check("warning", "Record Hygiene", "TXT records expose environment-like metadata", riskyTxt.slice(0, 3).join(" | "), "TXT records can leak implementation details.", "Remove sensitive metadata from public DNS.")
    : check("pass", "Record Hygiene", "TXT metadata review", "No obvious internal environment keywords were found.", "Public TXT records did not expose common risky keywords.", "Continue reviewing TXT records before publishing."));
  return checks;
}

async function runSecurityDnsReport(domain, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const [auth, dnssec, caa, mail, hygiene, wildcard] = await Promise.all([
    authoritativeChecks(domain, resolver),
    dnssecChecks(domain, resolver),
    caaChecks(domain, resolver),
    mailChecks(domain, options, resolver),
    recordHygieneChecks(domain, resolver),
    wildcardChecks(domain, resolver),
  ]);
  const checks = [...auth.checks, ...dnssec.checks, ...caa.checks, ...mail, ...hygiene, ...wildcard].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.category.localeCompare(b.category));
  const summary = summarizeChecks(checks);
  return { renderer: "groupedChecks", summary: `${summary.summary}. Resolver: ${profile.label}.`, data: { checks, counts: summary.counts, resolver: profile.label }, raw: { resolver: profile, authoritative: auth.raw, dnssec: dnssec.raw, caa: caa.raw } };
}

async function runDnssecTest(domain, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const dnssec = await dnssecChecks(domain, resolver);
  const summary = summarizeChecks(dnssec.checks);
  return { renderer: "groupedChecks", summary: `${summary.summary}. Resolver: ${profile.label}.`, data: { checks: dnssec.checks, counts: summary.counts, resolver: profile.label }, raw: dnssec.raw };
}

async function runReverseDns(ip, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const ptrName = dns.reverse ? "" : "";
  const ptrs = await withTimeout(resolver.reverse(ip), DNS_TIMEOUT_MS, "reverse DNS").catch(() => []);
  const forward = {};
  for (const host of ptrs.slice(0, 5)) forward[host] = await resolveIpsForHost(host, resolver);
  const forwardConfirmed = Object.values(forward).some((ips) => ips.includes(ip));
  return {
    renderer: "keyValue",
    summary: ptrs.length ? `${ptrs.length} PTR hostname(s) returned${forwardConfirmed ? " and forward-confirmed" : ""}. Resolver: ${profile.label}.` : `No PTR records returned. Resolver: ${profile.label}.`,
    data: { ip, ptrName, ptrs, forward, forwardConfirmed, resolver: profile.label },
    raw: { resolver: profile, ptrs, forward },
  };
}

async function runMailDnsHealth(domain, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const checks = await mailChecks(domain, options, resolver);
  const summary = summarizeChecks(checks);
  return { renderer: "groupedChecks", summary: `${summary.summary}. Resolver: ${profile.label}.`, data: { checks, counts: summary.counts, resolver: profile.label }, raw: { checks, resolver: profile } };
}

async function runResolverConsistency(target, options) {
  const type = options.recordType || "A";
  const rows = await Promise.all(RESOLVERS.map(async (entry) => {
    const resolver = newResolver(entry.servers);
    const started = Date.now();
    const result = await resolveRecord(target, type, { resolver, timeoutMs: DNS_TIMEOUT_MS });
    return {
      resolver: entry.label,
      type,
      status: result.status,
      values: result.values.map((value) => value.value).sort(),
      durationMs: Date.now() - started,
      error: result.error || "",
    };
  }));
  const signatures = rows.map((row) => row.values.join("|")).filter(Boolean);
  const unique = new Set(signatures);
  return {
    renderer: "statusMatrix",
    summary: unique.size <= 1 ? `Resolver answers are consistent for ${type}.` : `${unique.size} different resolver answer set(s) observed for ${type}.`,
    data: { rows, consistent: unique.size <= 1 },
    raw: { rows },
  };
}

async function fetchHeaders(url) {
  const head = await safeFetchPublicUrl(url, { method: "HEAD", timeoutMs: HTTP_TIMEOUT_MS, maxRedirects: 3, headers: { "user-agent": "RedSecTools-MiniTools/1.0" } });
  if (![405, 501].includes(head.response.status)) return head;
  const get = await safeFetchPublicUrl(url, { method: "GET", timeoutMs: HTTP_TIMEOUT_MS, maxRedirects: 3, headers: { "user-agent": "RedSecTools-MiniTools/1.0" } });
  try { await get.response.body?.cancel?.(); } catch (_) { /* headers only */ }
  return get;
}

async function runHttpHeaders(url) {
  let result;
  try {
    result = await fetchHeaders(url);
  } catch (error) {
    if (/https:\/\//i.test(url)) {
      const fallback = url.replace(/^https:/i, "http:");
      result = await fetchHeaders(fallback);
    } else {
      throw error;
    }
  }
  const headers = headersObjectFromFetchHeaders(result.response.headers);
  const analysis = analyzeSecurityHeaders(headers);
  const rows = Object.entries(headers).map(([name, value]) => ({ header: name, value }));
  return {
    renderer: "table",
    summary: `HTTP ${result.response.status}; security grade ${analysis.grade || "?"} (${analysis.score || 0}/100).`,
    data: { finalUrl: result.finalUrl, status: result.response.status, rows, security: analysis },
    raw: { headers, analysis },
  };
}

function tcpConnect(host, port, timeoutMs = PORT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve({ status: "filtered", durationMs: Date.now() - started }); }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ status: "open", durationMs: Date.now() - started });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve({ status: error.code === "ECONNREFUSED" ? "closed" : "error", error: error.code || error.message, durationMs: Date.now() - started });
    });
  });
}

async function runSiteAvailability(url, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const parsed = await assertPublicHttpUrl(url);
  const hostname = parsed.hostname;
  const dnsStarted = Date.now();
  const ips = await resolveIpsForHost(hostname, resolver);
  const dnsMs = Date.now() - dnsStarted;
  const checks = [];
  checks.push(ips.length
    ? check("pass", "Availability", "DNS resolution succeeded", `${ips.join(", ")} (${dnsMs}ms)`, "Clients can resolve the site hostname.", "No DNS action required.")
    : check("fail", "Availability", "DNS resolution failed", `${dnsMs}ms`, "Clients cannot connect without a resolved address.", "Fix public DNS records."));
  const tcp443 = await tcpConnect(hostname, 443);
  checks.push(check(tcp443.status === "open" ? "pass" : "warning", "Availability", "TCP/443 connectivity", `${tcp443.status} (${tcp443.durationMs}ms)`, "HTTPS requires TCP/443 reachability.", "Open or troubleshoot TCP/443 if HTTPS should be available."));
  let httpResult = null;
  try {
    httpResult = await fetchHeaders(parsed.href);
    checks.push(check(httpResult.response.status < 500 ? "pass" : "warning", "Availability", "HTTP response received", `HTTP ${httpResult.response.status} at ${httpResult.finalUrl}`, "The web server responded to a lightweight request.", "Investigate 5xx responses if persistent."));
  } catch (error) {
    checks.push(check("warning", "Availability", "HTTPS request failed", error.message, "The site may not be reachable over HTTPS.", "Check TLS and web server health."));
    if (parsed.protocol === "https:") {
      try {
        const fallback = await fetchHeaders(parsed.href.replace(/^https:/i, "http:"));
        httpResult = fallback;
        checks.push(check("info", "Availability", "HTTP fallback response received", `HTTP ${fallback.response.status} at ${fallback.finalUrl}`, "HTTP fallback responded when HTTPS did not.", "Prefer HTTPS with HSTS where possible."));
      } catch (_) { /* already reported */ }
    }
  }
  const summary = summarizeChecks(checks);
  return { renderer: "groupedChecks", summary: `${summary.summary}. Resolver: ${profile.label}.`, data: { checks, ips, resolver: profile.label, httpStatus: httpResult?.response?.status || null, finalUrl: httpResult?.finalUrl || null }, raw: { checks, ips, resolver: profile } };
}

async function runLightPortCheck(target, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const host = target;
  const addresses = net.isIP(host) ? [host] : await resolveIpsForHost(host, resolver);
  if (!addresses.length) throw new Error("Target did not resolve to a public address");
  if (addresses.some((ip) => isBlockedIp(ip))) throw new Error("Private or reserved DNS targets are not allowed");
  const address = addresses[0];
  const rows = [];
  for (let i = 0; i < ALLOWED_PORTS.length; i += 3) {
    const batch = ALLOWED_PORTS.slice(i, i + 3);
    const results = await Promise.all(batch.map(async (entry) => ({ ...entry, ...(await tcpConnect(address, entry.port, PORT_TIMEOUT_MS)) })));
    rows.push(...results);
  }
  const open = rows.filter((row) => row.status === "open").length;
  return { renderer: "table", summary: `${open} of ${rows.length} fixed common ports are reachable. Resolver: ${profile.label}.`, data: { host, address, resolver: profile.label, rows }, raw: { rows, resolver: profile } };
}

async function runDnsblCheck(ip, options) {
  const { resolver, profile } = resolverFromOptions(options);
  const reversed = ip.split(".").reverse().join(".");
  const rows = await Promise.all(DNSBL_ZONES.map(async (zone) => {
    const query = `${reversed}.${zone}`;
    const a = await resolveRecord(query, "A", { resolver, timeoutMs: DNSBL_TIMEOUT_MS });
    const txt = await resolveRecord(query, "TXT", { resolver, timeoutMs: DNSBL_TIMEOUT_MS });
    return {
      blocklist: zone,
      listed: a.values.length ? "yes" : a.status === "no_data" ? "no" : "unknown",
      returnedCode: a.values.map((r) => r.value).join(", "),
      reason: txt.values.map((r) => r.value).join(" | "),
      error: a.values.length ? "" : a.error || "",
    };
  }));
  const listed = rows.filter((row) => row.listed === "yes").length;
  return { renderer: "table", summary: listed ? `${listed} DNSBL listing(s) observed. Resolver: ${profile.label}.` : `No DNSBL listings observed across the curated list. Resolver: ${profile.label}.`, data: { resolver: profile.label, rows }, raw: { rows, resolver: profile } };
}

function runUrlDecode(input, options) {
  let current = String(input || "");
  if (options.plusToSpace) current = current.replace(/\+/g, " ");
  const maxPasses = options.repeatDecode ? 3 : 1;
  let passes = 0;
  for (let i = 0; i < maxPasses; i += 1) {
    const next = decodeURIComponent(current);
    passes += 1;
    if (next === current) break;
    current = next;
  }
  return {
    renderer: "rawText",
    summary: `Decoded in ${passes} pass(es).`,
    data: { original: input, decoded: current, passes },
    raw: { original: input, decoded: current, passes },
  };
}

async function enforceToolRateLimit(userId, tool) {
  const key = `${userId || "anonymous"}:${tool.id}`;
  const now = Date.now();
  const windowMs = tool.rateLimit.windowSeconds * 1000;
  const state = TOOL_RATE_STATE.get(key) || { start: now, count: 0 };
  if (now - state.start >= windowMs) {
    state.start = now;
    state.count = 0;
  }
  if (state.count >= tool.rateLimit.maxRequests) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - state.start)) / 1000);
    return { ok: false, retryAfterSeconds };
  }
  state.count += 1;
  TOOL_RATE_STATE.set(key, state);
  return { ok: true };
}

async function withConcurrency(profile, fn) {
  const limit = CONCURRENCY_LIMITS[profile];
  if (!limit) return fn();
  const active = ACTIVE_BY_PROFILE.get(profile) || 0;
  if (active >= limit) {
    const err = new Error("This lookup type is currently busy. Try again shortly.");
    err.status = "rate_limited";
    throw err;
  }
  ACTIVE_BY_PROFILE.set(profile, active + 1);
  try {
    return await fn();
  } finally {
    ACTIVE_BY_PROFILE.set(profile, Math.max(0, (ACTIVE_BY_PROFILE.get(profile) || 1) - 1));
  }
}

function cacheKey(toolId, target, options) {
  return `${toolId}:${target}:${JSON.stringify(options || {})}`;
}

function getCached(tool, key) {
  if (!tool.cacheTtlMs) return null;
  const cached = TOOL_CACHE.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    TOOL_CACHE.delete(key);
    return null;
  }
  return { ...cached.value, meta: { ...cached.value.meta, cached: true } };
}

function setCached(tool, key, value) {
  if (!tool.cacheTtlMs) return;
  if (TOOL_CACHE.size > CACHE_MAX_ITEMS) {
    const firstKey = TOOL_CACHE.keys().next().value;
    if (firstKey) TOOL_CACHE.delete(firstKey);
  }
  TOOL_CACHE.set(key, { expiresAt: Date.now() + tool.cacheTtlMs, value });
}

async function executeTool(tool, target, options) {
  if (tool.id === "dns_records") return runDnsRecords(target, options);
  if (tool.id === "security_dns_report") return runSecurityDnsReport(target, options);
  if (tool.id === "dnssec_test") return runDnssecTest(target, options);
  if (tool.id === "reverse_dns") return runReverseDns(target, options);
  if (tool.id === "mail_dns_health") return runMailDnsHealth(target, options);
  if (tool.id === "resolver_consistency") return runResolverConsistency(target, options);
  if (tool.id === "http_headers") return runHttpHeaders(target);
  if (tool.id === "site_availability") return runSiteAvailability(target, options);
  if (tool.id === "light_port_check") return runLightPortCheck(target, options);
  if (tool.id === "dnsbl_check") return runDnsblCheck(target, options);
  if (tool.id === "url_decode") return runUrlDecode(target, options);
  throw new Error("Unknown DNS lookup type");
}

async function runDnsMiniTool({ toolId, target, options = {}, userId = null } = {}) {
  const normalizedTool = normalizeDnsToolId(toolId);
  if (!normalizedTool.ok) return { statusCode: 400, body: errorResult(toolId, target, "validation_error", normalizedTool.error) };
  const { tool } = normalizedTool;
  const normalizedOptions = normalizeOptions(tool, options);
  if (!normalizedOptions.ok) return { statusCode: 400, body: errorResult(tool.id, target, "validation_error", normalizedOptions.error) };
  const normalizedTarget = validateToolInput(tool, target, normalizedOptions.options);
  if (!normalizedTarget.ok) return { statusCode: 400, body: errorResult(tool.id, target, "validation_error", normalizedTarget.error) };
  const rate = await enforceToolRateLimit(userId, tool);
  if (!rate.ok) return { statusCode: 429, body: errorResult(tool.id, normalizedTarget.target, "rate_limited", `Rate limit reached. Try again in ${rate.retryAfterSeconds} seconds.`) };

  const key = cacheKey(tool.id, normalizedTarget.target, normalizedOptions.options);
  const cached = getCached(tool, key);
  if (cached) return { statusCode: 200, body: cached };

  const started = Date.now();
  try {
    const executed = await withConcurrency(tool.loadProfile, () => executeTool(tool, normalizedTarget.target, normalizedOptions.options));
    const body = {
      toolId: tool.id,
      toolLabel: tool.label,
      target: normalizedTarget.target,
      status: "success",
      summary: executed.summary,
      renderer: executed.renderer || tool.renderer,
      data: executed.data || {},
      raw: executed.raw || executed.data || {},
      meta: {
        durationMs: Date.now() - started,
        timestamp: new Date().toISOString(),
        provider: "local",
        cached: false,
      },
    };
    setCached(tool, key, body);
    return { statusCode: 200, body };
  } catch (error) {
    const status = error.status === "rate_limited" ? "rate_limited" : "server_error";
    return { statusCode: status === "rate_limited" ? 429 : 502, body: errorResult(tool.id, normalizedTarget.target, status, error.message || "Lookup failed", Date.now() - started) };
  }
}

function errorResult(toolId, target, status, message, durationMs = 0) {
  return {
    toolId: toolId || "",
    target: target || "",
    status,
    summary: message,
    renderer: "rawText",
    data: { error: message },
    raw: { error: message },
    meta: {
      durationMs,
      timestamp: new Date().toISOString(),
      provider: "local",
      cached: false,
    },
  };
}

module.exports = {
  DNS_LOOKUP_TOOLS,
  publicToolRegistry,
  normalizeDnsToolId,
  normalizeHostnameInput,
  normalizeIpInput,
  normalizeUrlInput,
  normalizeOptions,
  validateToolInput,
  runDnsMiniTool,
  enforceToolRateLimit,
};
