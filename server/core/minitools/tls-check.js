const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const net = require("node:net");
const tls = require("node:tls");
const { X509Certificate } = require("node:crypto");
const { assertPublicHttpUrl, isBlockedIp } = require("../security/fetch-targets");
const { safeFetchPublicUrl, readResponseTextWithLimit } = require("../security/safe-fetch");

const SEVERITY_ORDER = Object.freeze({ critical: 0, high: 1, medium: 2, low: 3, info: 4 });
const DEFAULT_TIMEOUT_MS = 6000;
const MAX_CT_NAMES = 100;
const MAX_CIPHER_PROBES = 200;

const TLS_VERSION_OPTIONS = Object.freeze([
  { label: "TLSv1", value: "TLSv1", deprecated: true },
  { label: "TLSv1.1", value: "TLSv1.1", deprecated: true },
  { label: "TLSv1.2", value: "TLSv1.2", legacy: true },
  { label: "TLSv1.3", value: "TLSv1.3" },
]);

// Explicit cipher rating map aligned with Mozilla SSL Config, NIST SP 800-52r2,
// Qualys SSL Labs, and RFC 9325 (2025 consensus).
const CIPHER_RATINGS = {};
function _rate(ciphers, rating) { for (const c of ciphers) CIPHER_RATINGS[c] = rating; }

// BROKEN — actively exploitable: NULL, EXPORT, RC4, anon DH/ECDH, MD5 MAC
_rate([
  "NULL-MD5", "NULL-SHA", "NULL-SHA256",
  "ECDHE-RSA-NULL-SHA", "ECDHE-ECDSA-NULL-SHA",
  "EXP-RC4-MD5", "EXP-RC4-SHA", "EXP-DES-CBC-SHA",
  "EXP-EDH-RSA-DES-CBC-SHA", "EXP-EDH-DSS-DES-CBC-SHA",
  "EXP-ADH-RC4-MD5", "EXP-ADH-DES-CBC-SHA",
  "EXP-KRB5-DES-CBC-SHA", "EXP-KRB5-RC4-SHA",
  "EXP-KRB5-DES-CBC-MD5", "EXP-KRB5-RC4-MD5",
  "RC4-MD5", "RC4-SHA",
  "ECDHE-RSA-RC4-SHA", "ECDHE-ECDSA-RC4-SHA",
  "ADH-RC4-MD5",
  "KRB5-RC4-SHA", "KRB5-RC4-MD5",
  "ADH-AES128-SHA", "ADH-AES256-SHA",
  "ADH-AES128-SHA256", "ADH-AES256-SHA256",
  "ADH-AES128-GCM-SHA256", "ADH-AES256-GCM-SHA384",
  "ADH-CAMELLIA128-SHA", "ADH-CAMELLIA256-SHA",
  "ADH-DES-CBC3-SHA", "ADH-DES-CBC-SHA",
  "AECDH-AES128-SHA", "AECDH-AES256-SHA",
  "AECDH-NULL-SHA", "AECDH-RC4-SHA",
  "AECDH-DES-CBC3-SHA",
  "RC2-CBC-MD5",
], "broken");

// WEAK — CBC mode, 3DES (SWEET32), RSA key exchange (no FS), IDEA, SEED, CAMELLIA-CBC, DSS
_rate([
  "DES-CBC3-SHA",
  "EDH-RSA-DES-CBC3-SHA", "EDH-DSS-DES-CBC3-SHA",
  "ECDHE-RSA-DES-CBC3-SHA", "ECDHE-ECDSA-DES-CBC3-SHA",
  "KRB5-DES-CBC3-SHA", "KRB5-DES-CBC3-MD5",
  "DES-CBC-SHA", "DES-CBC-MD5",
  "IDEA-CBC-SHA",
  "SEED-SHA",
  "AES128-SHA", "AES256-SHA",
  "AES128-SHA256", "AES256-SHA256",
  "CAMELLIA128-SHA", "CAMELLIA256-SHA",
  "CAMELLIA128-SHA256", "CAMELLIA256-SHA256",
  "AES128-GCM-SHA256", "AES256-GCM-SHA384",
  "AES128-CCM", "AES256-CCM", "AES128-CCM8", "AES256-CCM8",
  "DHE-DSS-AES128-SHA", "DHE-DSS-AES256-SHA",
  "DHE-DSS-AES128-SHA256", "DHE-DSS-AES256-SHA256",
  "DHE-DSS-CAMELLIA128-SHA", "DHE-DSS-CAMELLIA256-SHA",
  "DHE-DSS-CAMELLIA128-SHA256", "DHE-DSS-CAMELLIA256-SHA256",
  "DHE-DSS-SEED-SHA",
  "ECDHE-RSA-AES128-SHA", "ECDHE-RSA-AES256-SHA",
  "ECDHE-ECDSA-AES128-SHA", "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES128-SHA256", "ECDHE-RSA-AES256-SHA384",
  "ECDHE-ECDSA-AES128-SHA256", "ECDHE-ECDSA-AES256-SHA384",
  "ECDHE-RSA-CAMELLIA128-SHA256", "ECDHE-RSA-CAMELLIA256-SHA384",
  "ECDHE-ECDSA-CAMELLIA128-SHA256", "ECDHE-ECDSA-CAMELLIA256-SHA384",
  "DHE-RSA-AES128-SHA", "DHE-RSA-AES256-SHA",
  "DHE-RSA-AES128-SHA256", "DHE-RSA-AES256-SHA256",
  "DHE-RSA-CAMELLIA128-SHA", "DHE-RSA-CAMELLIA256-SHA",
  "DHE-RSA-CAMELLIA128-SHA256", "DHE-RSA-CAMELLIA256-SHA256",
  "DHE-RSA-SEED-SHA",
  "PSK-AES128-CBC-SHA", "PSK-AES256-CBC-SHA",
  "PSK-3DES-EDE-CBC-SHA", "PSK-RC4-SHA",
], "weak");

// STRONG — AEAD (GCM / ChaCha20-Poly1305) + forward secrecy only
_rate([
  "ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-CHACHA20-POLY1305", "ECDHE-ECDSA-CHACHA20-POLY1305",
  "DHE-RSA-AES128-GCM-SHA256", "DHE-RSA-AES256-GCM-SHA384",
  "DHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CAMELLIA128-GCM-SHA256", "ECDHE-RSA-CAMELLIA256-GCM-SHA384",
  "ECDHE-ECDSA-CAMELLIA128-GCM-SHA256", "ECDHE-ECDSA-CAMELLIA256-GCM-SHA384",
  "DHE-DSS-AES128-GCM-SHA256", "DHE-DSS-AES256-GCM-SHA384",
], "strong");

// Comprehensive probe list ordered weakest-first (broken → weak → strong)
const TLS12_CIPHER_PROBES = Object.freeze([
  // BROKEN
  "NULL-MD5", "NULL-SHA", "NULL-SHA256",
  "ECDHE-RSA-NULL-SHA", "ECDHE-ECDSA-NULL-SHA",
  "EXP-RC4-MD5", "EXP-RC4-SHA", "EXP-DES-CBC-SHA",
  "EXP-EDH-RSA-DES-CBC-SHA", "EXP-EDH-DSS-DES-CBC-SHA",
  "EXP-ADH-RC4-MD5", "EXP-ADH-DES-CBC-SHA",
  "RC4-MD5", "RC4-SHA",
  "ECDHE-RSA-RC4-SHA", "ECDHE-ECDSA-RC4-SHA",
  "ADH-RC4-MD5",
  "ADH-AES128-SHA", "ADH-AES256-SHA",
  "ADH-AES128-SHA256", "ADH-AES256-SHA256",
  "ADH-AES128-GCM-SHA256", "ADH-AES256-GCM-SHA384",
  "ADH-CAMELLIA128-SHA", "ADH-CAMELLIA256-SHA",
  "ADH-DES-CBC3-SHA", "ADH-DES-CBC-SHA",
  "AECDH-AES128-SHA", "AECDH-AES256-SHA",
  "AECDH-NULL-SHA", "AECDH-RC4-SHA",
  "AECDH-DES-CBC3-SHA",
  "RC2-CBC-MD5",
  // WEAK — 3DES / DES
  "DES-CBC3-SHA",
  "EDH-RSA-DES-CBC3-SHA", "EDH-DSS-DES-CBC3-SHA",
  "ECDHE-RSA-DES-CBC3-SHA", "ECDHE-ECDSA-DES-CBC3-SHA",
  "DES-CBC-SHA",
  "IDEA-CBC-SHA",
  // WEAK — RSA key exchange (no forward secrecy)
  "AES128-SHA", "AES256-SHA",
  "AES128-SHA256", "AES256-SHA256",
  "CAMELLIA128-SHA", "CAMELLIA256-SHA",
  "CAMELLIA128-SHA256", "CAMELLIA256-SHA256",
  "AES128-GCM-SHA256", "AES256-GCM-SHA384",
  "AES128-CCM", "AES256-CCM", "AES128-CCM8", "AES256-CCM8",
  // WEAK — DSS key exchange
  "DHE-DSS-AES128-SHA", "DHE-DSS-AES256-SHA",
  "DHE-DSS-AES128-SHA256", "DHE-DSS-AES256-SHA256",
  "DHE-DSS-SEED-SHA",
  // WEAK — ECDHE + CBC (forward secret but CBC mode)
  "ECDHE-RSA-AES128-SHA", "ECDHE-RSA-AES256-SHA",
  "ECDHE-ECDSA-AES128-SHA", "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES128-SHA256", "ECDHE-RSA-AES256-SHA384",
  "ECDHE-ECDSA-AES128-SHA256", "ECDHE-ECDSA-AES256-SHA384",
  "ECDHE-RSA-CAMELLIA128-SHA256", "ECDHE-RSA-CAMELLIA256-SHA384",
  "ECDHE-ECDSA-CAMELLIA128-SHA256", "ECDHE-ECDSA-CAMELLIA256-SHA384",
  // WEAK — DHE + CBC
  "DHE-RSA-AES128-SHA", "DHE-RSA-AES256-SHA",
  "DHE-RSA-AES128-SHA256", "DHE-RSA-AES256-SHA256",
  "DHE-RSA-CAMELLIA128-SHA", "DHE-RSA-CAMELLIA256-SHA",
  "DHE-RSA-CAMELLIA128-SHA256", "DHE-RSA-CAMELLIA256-SHA256",
  "DHE-RSA-SEED-SHA",
  // STRONG — AEAD + forward secrecy
  "ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-CHACHA20-POLY1305", "ECDHE-ECDSA-CHACHA20-POLY1305",
  "DHE-RSA-AES128-GCM-SHA256", "DHE-RSA-AES256-GCM-SHA384",
  "DHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CAMELLIA128-GCM-SHA256", "ECDHE-RSA-CAMELLIA256-GCM-SHA384",
  "ECDHE-ECDSA-CAMELLIA128-GCM-SHA256", "ECDHE-ECDSA-CAMELLIA256-GCM-SHA384",
  "DHE-DSS-AES128-GCM-SHA256", "DHE-DSS-AES256-GCM-SHA384",
].slice(0, MAX_CIPHER_PROBES));

const TLS13_CIPHER_PROBES = Object.freeze([
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "TLS_AES_128_GCM_SHA256",
]);

function issue(severity, title, detail) {
  return { severity, title, detail };
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const sev = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    return sev || String(a.title).localeCompare(String(b.title));
  });
}

function normalizeTlsTarget(input) {
  const value = String(input || "").trim();
  if (!value) return { ok: false, error: "Target is required" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) {
    return { ok: false, error: "Only hostnames, IPs, or http(s) URLs are supported" };
  }

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "Valid hostname or URL is required" };
  }
  if (parsed.username || parsed.password) return { ok: false, error: "URL credentials are not allowed" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "Only HTTP(S) URLs are supported" };

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port ? Number(parsed.port) : 443;
  if (!host) return { ok: false, error: "Hostname is required" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: "Port must be between 1 and 65535" };
  return { ok: true, host, port, target: `${host}:${port}` };
}

function bracketHost(host) {
  return net.isIP(host) === 6 ? `[${host}]` : host;
}

async function assertPublicTlsTarget(target) {
  await assertPublicHttpUrl(`https://${bracketHost(target.host)}:${target.port}/`);
}

function connectTls({ host, port, servername = host, timeoutMs = DEFAULT_TIMEOUT_MS, tlsVersion = null, cipher = null, tls13Cipher = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      host,
      port,
      servername: net.isIP(servername) ? undefined : servername,
      rejectUnauthorized: false,
      ALPNProtocols: ["h2", "http/1.1"],
    };
    if (tlsVersion) {
      options.minVersion = tlsVersion;
      options.maxVersion = tlsVersion;
    }
    if (cipher) options.ciphers = cipher;
    if (tls13Cipher) options.ciphersuites = tls13Cipher;

    const socket = tls.connect(options);
    const timer = setTimeout(() => {
      socket.destroy(new Error("TLS connection timed out"));
    }, timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      const peer = socket.getPeerCertificate(true);
      const cipherInfo = socket.getCipher();
      const result = {
        remoteAddress: socket.remoteAddress || null,
        protocol: socket.getProtocol() || null,
        cipher: cipherInfo?.name || null,
        cipherBits: cipherInfo?.bits || null,
        alpn: socket.alpnProtocol || null,
        peer,
      };
      socket.end();
      resolve(result);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function parseDn(value) {
  const text = String(value || "");
  const pairs = [];
  for (const line of text.split(/\n+/)) {
    const idx = line.indexOf("=");
    if (idx > 0) pairs.push({ key: line.slice(0, idx), value: line.slice(idx + 1) });
  }
  return pairs;
}

function commonNames(subject) {
  return parseDn(subject).filter((item) => item.key === "CN").map((item) => item.value);
}

function parseSanEntries(subjectAltName) {
  const text = String(subjectAltName || "");
  if (!text) return [];
  return text
    .split(/,\s*(?=(?:DNS|IP Address|IP|email|URI):)/i)
    .map((item) => item.trim().replace(/^IP Address:/i, "IP:").replace(/^email:/i, "EMAIL:"))
    .filter(Boolean);
}

function sanDnsNames(entries) {
  return entries.filter((item) => item.startsWith("DNS:")).map((item) => item.slice(4));
}

function publicKeyDetails(publicKey) {
  const type = publicKey?.asymmetricKeyType || "unknown";
  const details = publicKey?.asymmetricKeyDetails || {};
  if (type === "rsa" || type === "rsa-pss") return { type: "RSA", size: details.modulusLength ? `${details.modulusLength} bits` : "Unknown" };
  if (type === "ec") return { type: details.namedCurve ? `EC (${details.namedCurve})` : "EC", size: details.namedCurve ? "N/A" : "Unknown" };
  if (type === "dsa") return { type: "DSA", size: details.modulusLength ? `${details.modulusLength} bits` : "Unknown" };
  if (type === "ed25519") return { type: "Ed25519", size: "N/A" };
  if (type === "ed448") return { type: "Ed448", size: "N/A" };
  return { type, size: "Unknown" };
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function pemSha(raw, algo) {
  const hex = crypto.createHash(algo).update(raw).digest("hex").toUpperCase();
  return hex.match(/.{1,2}/g).join(":");
}

function buildCertificateRecord(peer) {
  if (!peer?.raw) throw new Error("No certificate was presented by the remote server");
  const x509 = new X509Certificate(peer.raw);
  const sanEntries = parseSanEntries(peer.subjectaltname || x509.subjectAltName);
  const pk = publicKeyDetails(x509.publicKey);
  const legacy = typeof x509.toLegacyObject === "function" ? x509.toLegacyObject() : {};
  return {
    subject: x509.subject || peer.subject ? formatLegacySubject(peer.subject, x509.subject) : null,
    issuer: x509.issuer || peer.issuer ? formatLegacySubject(peer.issuer, x509.issuer) : null,
    commonNames: commonNames(x509.subject || formatLegacySubject(peer.subject, "")),
    sanEntries,
    sanDns: sanDnsNames(sanEntries),
    serialNumber: x509.serialNumber || peer.serialNumber || null,
    notBefore: formatDate(x509.validFromDate) || peer.valid_from || null,
    notAfter: formatDate(x509.validToDate) || peer.valid_to || null,
    sha1: x509.fingerprint || pemSha(peer.raw, "sha1"),
    sha256: x509.fingerprint256 || pemSha(peer.raw, "sha256"),
    sha512: x509.fingerprint512 || pemSha(peer.raw, "sha512"),
    signatureAlgorithm: legacy.signatureAlgorithm || legacy.sigalg || peer.sigalg || "Unknown",
    signatureAlgorithmOid: legacy.signatureAlgorithmOid || null,
    publicKeyType: pk.type,
    publicKeySize: pk.size,
    version: peer.version ? `v${peer.version}` : "v3",
    basicConstraints: `CA=${!!x509.ca}`,
    keyUsage: Array.isArray(x509.keyUsage) && x509.keyUsage.length ? x509.keyUsage.join(", ") : "<not present>",
    extendedKeyUsage: "<not present>",
    ca: !!x509.ca,
    raw: peer.raw,
  };
}

function formatLegacySubject(obj, fallback) {
  if (!obj || typeof obj !== "object") return fallback || null;
  return Object.entries(obj).map(([key, value]) => `${key}=${value}`).join(",");
}

function chainFromPeer(peer) {
  const chain = [];
  const seen = new Set();
  let current = peer;
  while (current?.raw) {
    const fp = pemSha(current.raw, "sha256");
    if (seen.has(fp)) break;
    seen.add(fp);
    const cert = buildCertificateRecord(current);
    chain.push({ subject: cert.subject, issuer: cert.issuer, sha256: cert.sha256, notAfter: cert.notAfter, ca: cert.ca });
    if (!current.issuerCertificate || current.issuerCertificate === current) break;
    current = current.issuerCertificate;
  }
  return chain;
}

function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).replace(" UTC", "Z").replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maybeInt(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function hostnameMatches(pattern, host) {
  const p = String(pattern || "").toLowerCase().replace(/\.$/, "");
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!p || !h) return false;
  if (p === h) return true;
  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    return h.endsWith(`.${suffix}`) && h.split(".").length === suffix.split(".").length + 1;
  }
  return false;
}

function internalNameIndicators(value) {
  const v = String(value || "").toLowerCase();
  if (!v) return false;
  if ([".local", ".corp", ".lan", ".internal", ".intra", ".home", ".ad"].some((suffix) => v.endsWith(suffix))) return true;
  return !v.includes(".") && !v.includes(":") && !v.includes(" ");
}

function isPrivateIpText(value) {
  return net.isIP(value) ? isBlockedIp(value) : false;
}

function analyzeCertificate(result) {
  const issues = [];
  const cert = result.certificate;
  const now = new Date();
  const notAfter = parseDate(cert.notAfter);
  const notBefore = parseDate(cert.notBefore);
  if (notAfter) {
    const daysLeft = Math.floor((notAfter.getTime() - now.getTime()) / 86400000);
    result.validity = { daysRemaining: daysLeft, expired: daysLeft < 0 };
    if (daysLeft < 0) issues.push(issue("critical", "Certificate expired", `Expired on ${cert.notAfter}`));
    else if (daysLeft <= 14) issues.push(issue("high", "Certificate expiring very soon", `Expires ${cert.notAfter} (${daysLeft}d remaining)`));
    else if (daysLeft <= 30) issues.push(issue("medium", "Certificate expiring soon", `Expires ${cert.notAfter} (${daysLeft}d remaining)`));
    else if (daysLeft <= 90) issues.push(issue("low", "Certificate expires within 90 days", `Expires ${cert.notAfter} (${daysLeft}d remaining)`));
  }
  if (notBefore && notBefore.getTime() > now.getTime()) issues.push(issue("high", "Certificate not yet valid", `Valid from ${cert.notBefore}`));

  const sig = String(cert.signatureAlgorithm || "").toLowerCase();
  if (sig.includes("md5")) issues.push(issue("critical", "Broken signature algorithm", cert.signatureAlgorithm));
  else if (sig.includes("sha1") && !/(sha256|sha384|sha512)/.test(sig)) issues.push(issue("high", "Weak signature algorithm", cert.signatureAlgorithm));

  const keySize = maybeInt(cert.publicKeySize);
  if (String(cert.publicKeyType).startsWith("RSA") && keySize) {
    if (keySize < 2048) issues.push(issue("high", "Weak RSA key size", `${keySize} bits`));
    else if (keySize === 2048) issues.push(issue("info", "RSA key at minimum recommended size", `${keySize} bits`));
  }
  if (String(cert.publicKeyType).startsWith("DSA")) issues.push(issue("high", "DSA key algorithm is deprecated", cert.publicKeySize));
  if (cert.subject && cert.issuer && cert.subject === cert.issuer) issues.push(issue("medium", "Self-signed certificate", cert.subject));

  const names = cert.sanDns.length ? cert.sanDns : cert.commonNames;
  if (!names.some((name) => hostnameMatches(name, result.host))) {
    issues.push(issue("high", "Hostname mismatch", `${result.host} is not covered by certificate CN/SAN`));
  }
  if (!cert.sanDns.length && cert.commonNames.length) {
    issues.push(issue("medium", "No Subject Alternative Name present", "Certificate relies on CN-only matching"));
  }
  const wildcard = [...cert.sanDns, ...cert.commonNames].filter((name) => String(name).startsWith("*."));
  if (wildcard.length) issues.push(issue("low", "Wildcard certificate", wildcard.join(", ")));
  if (cert.sanDns.length >= 20) issues.push(issue("low", "Broad SAN scope", `SAN contains ${cert.sanDns.length} DNS names`));
  if (cert.ca) issues.push(issue("high", "Leaf certificate marked as CA", cert.basicConstraints));

  const internalNames = [...cert.commonNames, ...cert.sanDns].filter(internalNameIndicators);
  for (const entry of cert.sanEntries) {
    if (entry.startsWith("IP:") && isPrivateIpText(entry.slice(3))) {
      issues.push(issue("medium", "Private IP exposed in certificate SAN", entry.slice(3)));
    }
  }
  if (internalNames.length) {
    issues.push(issue("medium", "Internal naming leakage in certificate", [...new Set(internalNames)].join(", ")));
  }
  return issues;
}

function analyzeTlsContext(tlsContext) {
  const issues = [];
  if (["SSLv2", "SSLv3", "TLSv1", "TLSv1.1"].includes(tlsContext.version)) {
    issues.push(issue("high", "Weak TLS protocol version", `Negotiated: ${tlsContext.version}`));
  } else if (tlsContext.version === "TLSv1.2") {
    issues.push(issue("low", "Legacy TLS version negotiated", "TLS 1.2 is acceptable but TLS 1.3 is preferred"));
  } else if (tlsContext.version === "TLSv1.3") {
    issues.push(issue("info", "TLS version negotiated", "TLS 1.3"));
  }
  if (tlsContext.cipher && /(RC4|3DES|DES|NULL|EXPORT|MD5)/i.test(tlsContext.cipher)) {
    issues.push(issue("high", "Weak cipher suite", `Negotiated: ${tlsContext.cipher}`));
  } else if (tlsContext.cipher) {
    issues.push(issue("info", "Cipher suite noted", `Negotiated: ${tlsContext.cipher}`));
  }
  return issues;
}

function analyzeChain(chain) {
  const issues = [];
  const now = Date.now();
  for (let i = 0; i < chain.length; i++) {
    const expiry = parseDate(chain[i].notAfter);
    if (expiry && expiry.getTime() < now) {
      issues.push(issue("high", `${i === 0 ? "Leaf" : "Intermediate"} certificate expired in chain`, chain[i].subject || "<unknown>"));
    }
  }
  for (let i = 0; i < chain.length - 1; i++) {
    if (chain[i].issuer && chain[i + 1].subject && chain[i].issuer !== chain[i + 1].subject) {
      issues.push(issue("medium", "Chain linkage anomaly", `Issuer/subject mismatch between positions ${i} and ${i + 1}`));
    }
  }
  return issues;
}

async function resolveHostIps(host) {
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  const ipv4 = [];
  const ipv6 = [];
  for (const entry of addresses) {
    if (entry.family === 4 && !ipv4.includes(entry.address)) ipv4.push(entry.address);
    if (entry.family === 6 && !ipv6.includes(entry.address)) ipv6.push(entry.address);
  }
  return { ipv4, ipv6 };
}

async function detectDnssec(host) {
  try {
    const { resolver } = require("node:dns").promises;
    const r = new resolver();
    r.setServers(["8.8.8.8", "1.1.1.1"]);
    await r.resolve(host, "DS");
    return true;
  } catch {
    return false;
  }
}

async function resolveRecords(host) {
  const [ns, mx, caa, spf, dmarc, dnssec, wildcard] = await Promise.all([
    dns.resolveNs(host).catch(() => []),
    dns.resolveMx(host).then((records) => records.map((r) => `${r.priority} ${r.exchange}`)).catch(() => []),
    resolveCaaWalk(host),
    resolveSpf(host),
    resolveDmarc(host),
    detectDnssec(host),
    checkWildcardDns(host),
  ]);
  const zoneTransfer = await attemptZoneTransfer(host, ns);
  return { nameservers: ns, mx, caa, spf, dmarc, dnssec, zoneTransfer, wildcard };
}

async function resolveCaaWalk(host) {
  const labels = host.replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const records = await dns.resolveCaa(candidate).catch(() => []);
    if (records.length) {
      return records.map((r) => `${r.critical || 0} ${r.issue || r.issuewild || r.iodef || ""}`.trim());
    }
  }
  return [];
}

async function resolveTxtJoined(name) {
  const records = await dns.resolveTxt(name).catch(() => []);
  return records.map((chunks) => chunks.join(""));
}

async function resolveSpf(host) {
  const records = await resolveTxtJoined(host);
  return records.find((record) => /^v=spf1/i.test(record)) || null;
}

async function resolveDmarc(host) {
  const records = await resolveTxtJoined(`_dmarc.${host}`);
  return records.find((record) => /^v=dmarc1/i.test(record)) || null;
}

async function checkWildcardDns(host) {
  const label = crypto.randomBytes(10).toString("hex");
  return dns.resolve4(`${label}.${host}`).then(() => true).catch(() => false);
}

function encodeDnsName(name) {
  return Buffer.concat(name.split(".").map((label) => Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)])).concat(Buffer.from([0])));
}

async function attemptZoneTransfer(host, nameservers) {
  if (!nameservers.length) return "skipped (no nameservers resolved)";
  for (const nsHost of nameservers.slice(0, 3)) {
    const addresses = await dns.lookup(nsHost, { all: true, family: 4 }).catch(() => []);
    for (const entry of addresses.slice(0, 1)) {
      if (isBlockedIp(entry.address)) continue;
      const result = await axfrProbe(host, nsHost, entry.address).catch(() => null);
      if (result) return result;
    }
  }
  return "blocked (all nameservers refused or timed out)";
}

function axfrProbe(domain, nsHost, nsIp) {
  return new Promise((resolve) => {
    const id = crypto.randomInt(0, 65535);
    const qname = encodeDnsName(domain);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(0x0100, 2);
    header.writeUInt16BE(1, 4);
    const question = Buffer.concat([qname, Buffer.from([0x00, 0xfc, 0x00, 0x01])]);
    const packet = Buffer.concat([header, question]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(packet.length, 0);
    const socket = net.connect({ host: nsIp, port: 53 });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 4000);
    socket.once("connect", () => socket.write(Buffer.concat([length, packet])));
    socket.once("data", (data) => {
      clearTimeout(timer);
      socket.destroy();
      if (data.length < 14) return resolve(null);
      const responseId = data.readUInt16BE(2);
      const flags = data.readUInt16BE(4);
      const rcode = flags & 0x000f;
      const ancount = data.readUInt16BE(8);
      if (responseId !== id) return resolve(null);
      if (ancount > 1 && rcode === 0) return resolve(`SUCCESS - ${ancount} answer records received from ${nsHost} (${nsIp})`);
      if (rcode === 5) return resolve(`blocked by ${nsHost} (${nsIp})`);
      resolve(null);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function checkIpCertificateConsistency(host, port, addresses, timeoutMs) {
  const fingerprints = {};
  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      fingerprints[ip] = "<blocked>";
      continue;
    }
    try {
      const fetched = await connectTls({ host: ip, port, servername: host, timeoutMs });
      const cert = buildCertificateRecord(fetched.peer);
      fingerprints[ip] = cert.sha256;
    } catch {
      fingerprints[ip] = "<unreachable>";
    }
  }
  const reachable = new Set(Object.values(fingerprints).filter((fp) => !String(fp).startsWith("<")));
  return { fingerprints, consistent: addresses.length <= 1 ? null : reachable.size <= 1 };
}

function analyzeDns(result) {
  const issues = [];
  const dnsInfo = result.dns || {};
  if (dnsInfo.certConsistent === false) {
    issues.push(issue("high", "Inconsistent certificates across resolved IPs", "Different TLS leaf certificates are served by different resolved IPs"));
  } else if (dnsInfo.ipCertFingerprints && Object.keys(dnsInfo.ipCertFingerprints).length > 1) {
    issues.push(issue("info", "Multiple IPs serve a consistent certificate", `${Object.keys(dnsInfo.ipCertFingerprints).length} IPs checked`));
  }
  if (Array.isArray(dnsInfo.caaRecords)) {
    if (!dnsInfo.caaRecords.length) issues.push(issue("medium", "No CAA records configured", "Any CA may issue a certificate for this domain"));
    else issues.push(issue("info", "CAA records present", dnsInfo.caaRecords.slice(0, 5).join("; ")));
  }
  if (dnsInfo.spfRecord === null) issues.push(issue("medium", "No SPF record found", "Spoofed email may not be rejected by receiving servers"));
  else if (dnsInfo.spfRecord) {
    const spf = dnsInfo.spfRecord.toLowerCase();
    if (spf.includes("+all") || spf.includes("?all")) issues.push(issue("high", "Permissive SPF policy", dnsInfo.spfRecord));
    else if (spf.includes("~all")) issues.push(issue("low", "SPF soft-fail policy", dnsInfo.spfRecord));
    else issues.push(issue("info", "SPF record present", dnsInfo.spfRecord));
  }
  if (dnsInfo.dmarcRecord === null) issues.push(issue("medium", "No DMARC record found", `No DMARC policy at _dmarc.${result.host}`));
  else if (dnsInfo.dmarcRecord) {
    const dmarc = dnsInfo.dmarcRecord.toLowerCase();
    if (dmarc.includes("p=none")) issues.push(issue("medium", "DMARC policy is monitor-only", dnsInfo.dmarcRecord));
    else if (dmarc.includes("p=quarantine")) issues.push(issue("low", "DMARC policy is quarantine, not reject", dnsInfo.dmarcRecord));
    else issues.push(issue("info", "DMARC record present", dnsInfo.dmarcRecord));
  }
  if (dnsInfo.dnssec === false) issues.push(issue("low", "DNSSEC not detected", "No DNSKEY records found"));
  if (dnsInfo.dnssec === true) issues.push(issue("info", "DNSSEC enabled", "DNSKEY records present"));
  if (String(dnsInfo.zoneTransfer || "").startsWith("SUCCESS")) issues.push(issue("high", "DNS zone transfer permitted", dnsInfo.zoneTransfer));
  if (dnsInfo.wildcardDns === true) issues.push(issue("low", "Wildcard DNS resolution active", `Random subdomains of ${result.host} resolve`));
  return issues;
}

async function ctLookup(host, timeoutMs) {
  const url = `https://crt.sh/?q=${encodeURIComponent(host)}&output=json`;
  const { response } = await safeFetchPublicUrl(url, {
    headers: { "user-agent": "RedSecTools-MiniTools/1.0" },
    timeoutMs,
  });
  const text = await readResponseTextWithLimit(response, 1024 * 1024);
  const data = JSON.parse(text || "[]");
  const rows = Array.isArray(data) ? data : [data];
  const names = new Set();
  for (const row of rows.slice(0, MAX_CT_NAMES)) {
    for (const key of ["common_name", "name_value"]) {
      for (const name of String(row?.[key] || "").split(/\n+/)) {
        const trimmed = name.trim();
        if (trimmed) names.add(trimmed);
      }
    }
  }
  return [...names].sort();
}

function rateCipher(cipher) {
  const c = String(cipher || "");
  if (CIPHER_RATINGS[c]) return CIPHER_RATINGS[c];
  const u = c.toUpperCase();
  if (/(NULL|EXPORT|RC4|MD5|ADH|AECDH)/.test(u)) return "broken";
  if (/(3DES|DES-CBC|CBC|RSA_WITH|^AES\d+-SHA$|DSS|SEED|CAMELLIA)/.test(u) && !/(GCM|CHACHA20|POLY1305)/.test(u)) return "weak";
  if (/(GCM|CHACHA20|POLY1305)/.test(u) && /(ECDHE|DHE|TLS_AES|TLS_CHACHA)/.test(u)) return "strong";
  return "unknown";
}

function cipherBits(name) {
  const n = String(name || "").toUpperCase();
  const m = n.match(/AES(\d{3})/);
  if (m) return Number(m[1]);
  if (n.includes("CHACHA20") || n.includes("CAMELLIA256")) return 256;
  if (n.includes("CAMELLIA128")) return 128;
  if (n.includes("3DES") || n.includes("DES-CBC3") || n.includes("DES_192")) return 112;
  if (n.includes("DES-CBC") || n.includes("DES_64")) return 56;
  if (n.includes("IDEA")) return 128;
  if (n.includes("RC4") || n.includes("RC2")) {
    if (n.includes("EXPORT") || n.includes("EXP-")) return 40;
    return 128;
  }
  if (n.includes("NULL")) return 0;
  if (n.includes("SEED")) return 128;
  return null;
}

async function probeCipher({ host, port, tlsVersion, cipher, tls13Cipher, timeoutMs }) {
  try {
    const fetched = await connectTls({ host, port, timeoutMs, tlsVersion, cipher, tls13Cipher });
    const name = fetched.cipher || cipher || tls13Cipher;
    return {
      tlsVersion: fetched.protocol || tlsVersion,
      cipher: name,
      requestedCipher: cipher || tls13Cipher,
      rating: rateCipher(name),
      bits: fetched.cipherBits || cipherBits(name),
    };
  } catch {
    return null;
  }
}

// SSLv2 cipher IDs (3 bytes) → (name, bits) — all BROKEN
const SSLV2_CIPHERS = Object.freeze([
  { id: Buffer.from([0x07, 0x00, 0xC0]), name: "SSL_CK_DES_192_EDE3_CBC_WITH_MD5", bits: 112 },
  { id: Buffer.from([0x05, 0x00, 0x80]), name: "SSL_CK_IDEA_128_CBC_WITH_MD5", bits: 128 },
  { id: Buffer.from([0x03, 0x00, 0x80]), name: "SSL_CK_RC2_128_CBC_WITH_MD5", bits: 128 },
  { id: Buffer.from([0x01, 0x00, 0x80]), name: "SSL_CK_RC4_128_WITH_MD5", bits: 128 },
  { id: Buffer.from([0x06, 0x00, 0x40]), name: "SSL_CK_DES_64_CBC_WITH_MD5", bits: 56 },
  { id: Buffer.from([0x04, 0x00, 0x80]), name: "SSL_CK_RC2_128_CBC_EXPORT40_WITH_MD5", bits: 40 },
  { id: Buffer.from([0x02, 0x00, 0x80]), name: "SSL_CK_RC4_128_EXPORT40_WITH_MD5", bits: 40 },
]);

// SSLv3/TLS cipher IDs (2 bytes) → (name, bits)
const SSLV3_CIPHERS = Object.freeze([
  { id: Buffer.from([0x00, 0x04]), name: "RC4-MD5", bits: 128 },
  { id: Buffer.from([0x00, 0x05]), name: "RC4-SHA", bits: 128 },
  { id: Buffer.from([0x00, 0x0A]), name: "DES-CBC3-SHA", bits: 112 },
  { id: Buffer.from([0x00, 0x2F]), name: "AES128-SHA", bits: 128 },
  { id: Buffer.from([0x00, 0x35]), name: "AES256-SHA", bits: 256 },
  { id: Buffer.from([0x00, 0x3C]), name: "AES128-SHA256", bits: 128 },
  { id: Buffer.from([0x00, 0x3D]), name: "AES256-SHA256", bits: 256 },
  { id: Buffer.from([0x00, 0x9C]), name: "AES128-GCM-SHA256", bits: 128 },
  { id: Buffer.from([0x00, 0x9D]), name: "AES256-GCM-SHA384", bits: 256 },
  { id: Buffer.from([0xC0, 0x09]), name: "ECDHE-ECDSA-AES128-SHA", bits: 128 },
  { id: Buffer.from([0xC0, 0x0A]), name: "ECDHE-ECDSA-AES256-SHA", bits: 256 },
  { id: Buffer.from([0xC0, 0x13]), name: "ECDHE-RSA-AES128-SHA", bits: 128 },
  { id: Buffer.from([0xC0, 0x14]), name: "ECDHE-RSA-AES256-SHA", bits: 256 },
  { id: Buffer.from([0xC0, 0x23]), name: "ECDHE-ECDSA-AES128-SHA256", bits: 128 },
  { id: Buffer.from([0xC0, 0x24]), name: "ECDHE-ECDSA-AES256-SHA384", bits: 256 },
  { id: Buffer.from([0xC0, 0x27]), name: "ECDHE-RSA-AES128-SHA256", bits: 128 },
  { id: Buffer.from([0xC0, 0x28]), name: "ECDHE-RSA-AES256-SHA384", bits: 256 },
  { id: Buffer.from([0xC0, 0x2B]), name: "ECDHE-ECDSA-AES128-GCM-SHA256", bits: 128 },
  { id: Buffer.from([0xC0, 0x2C]), name: "ECDHE-ECDSA-AES256-GCM-SHA384", bits: 256 },
  { id: Buffer.from([0xC0, 0x2F]), name: "ECDHE-RSA-AES128-GCM-SHA256", bits: 128 },
  { id: Buffer.from([0xC0, 0x30]), name: "ECDHE-RSA-AES256-GCM-SHA384", bits: 256 },
  { id: Buffer.from([0x00, 0x33]), name: "DHE-RSA-AES128-SHA", bits: 128 },
  { id: Buffer.from([0x00, 0x39]), name: "DHE-RSA-AES256-SHA", bits: 256 },
  { id: Buffer.from([0x00, 0x67]), name: "DHE-RSA-AES128-SHA256", bits: 128 },
  { id: Buffer.from([0x00, 0x6B]), name: "DHE-RSA-AES256-SHA256", bits: 256 },
  { id: Buffer.from([0x00, 0x09]), name: "DES-CBC-SHA", bits: 56 },
  { id: Buffer.from([0x00, 0x06]), name: "EXP-RC2-CBC-MD5", bits: 40 },
  { id: Buffer.from([0x00, 0x03]), name: "EXP-RC4-MD5", bits: 40 },
  { id: Buffer.from([0xCC, 0xA8]), name: "ECDHE-RSA-CHACHA20-POLY1305", bits: 256 },
  { id: Buffer.from([0xCC, 0xA9]), name: "ECDHE-ECDSA-CHACHA20-POLY1305", bits: 256 },
]);

function rawSslv2Baseline(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const cipherSpecs = Buffer.concat(SSLV2_CIPHERS.map((c) => c.id));
    const challenge = crypto.randomBytes(16);
    const bodyLen = 1 + 2 + 2 + 2 + 2 + cipherSpecs.length + challenge.length;
    const body = Buffer.alloc(bodyLen);
    let off = 0;
    body[off++] = 0x01; body[off++] = 0x00; body[off++] = 0x02;
    body[off++] = (cipherSpecs.length >> 8) & 0xFF; body[off++] = cipherSpecs.length & 0xFF;
    body[off++] = 0x00; body[off++] = 0x00;
    body[off++] = (challenge.length >> 8) & 0xFF; body[off++] = challenge.length & 0xFF;
    cipherSpecs.copy(body, off); off += cipherSpecs.length;
    challenge.copy(body, off);
    const pkt = Buffer.alloc(2 + body.length);
    pkt[0] = 0x80 | ((body.length >> 8) & 0x7F); pkt[1] = body.length & 0xFF;
    body.copy(pkt, 2);
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => socket.write(pkt));
    socket.once("data", (data) => { clearTimeout(timer); socket.destroy(); resolve(data.length >= 3 && (data[0] & 0x80) && data[2] === 0x04); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

function rawSslv2ProbeCipher(host, port, cipherId, timeoutMs) {
  return new Promise((resolve) => {
    const challenge = crypto.randomBytes(16);
    const bodyLen = 1 + 2 + 2 + 2 + 2 + cipherId.length + challenge.length;
    const body = Buffer.alloc(bodyLen);
    let off = 0;
    body[off++] = 0x01; body[off++] = 0x00; body[off++] = 0x02;
    body[off++] = (cipherId.length >> 8) & 0xFF; body[off++] = cipherId.length & 0xFF;
    body[off++] = 0x00; body[off++] = 0x00;
    body[off++] = (challenge.length >> 8) & 0xFF; body[off++] = challenge.length & 0xFF;
    cipherId.copy(body, off); off += cipherId.length;
    challenge.copy(body, off);
    const pkt = Buffer.alloc(2 + body.length);
    pkt[0] = 0x80 | ((body.length >> 8) & 0x7F); pkt[1] = body.length & 0xFF;
    body.copy(pkt, 2);
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => socket.write(pkt));
    socket.once("data", (data) => {
      clearTimeout(timer); socket.destroy();
      if (data.length < 2 || !(data[0] & 0x80)) return resolve(false);
      const msgLen = ((data[0] & 0x7F) << 8) | data[1];
      const b = data.slice(2, Math.min(data.length, 2 + Math.min(msgLen, 32)));
      resolve(b.length >= 1 && b[0] === 0x04);
    });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

function rawSslv3Baseline(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const rnd = crypto.randomBytes(32);
    const suites = Buffer.from([0x00, 0x35, 0x00, 0x2F, 0x00, 0x0A, 0x00, 0x05, 0x00, 0x04, 0x00, 0xFF]);
    const hello = Buffer.alloc(2 + 32 + 1 + 2 + suites.length + 2);
    let off = 0;
    hello[off++] = 0x03; hello[off++] = 0x00;
    rnd.copy(hello, off); off += 32;
    hello[off++] = 0x00;
    hello[off++] = (suites.length >> 8) & 0xFF; hello[off++] = suites.length & 0xFF;
    suites.copy(hello, off); off += suites.length;
    hello[off++] = 0x01; hello[off++] = 0x00;
    const hs = Buffer.alloc(4 + hello.length);
    hs[0] = 0x01; hs[1] = (hello.length >> 16) & 0xFF; hs[2] = (hello.length >> 8) & 0xFF; hs[3] = hello.length & 0xFF;
    hello.copy(hs, 4);
    const rec = Buffer.alloc(5 + hs.length);
    rec[0] = 0x16; rec[1] = 0x03; rec[2] = 0x00; rec[3] = (hs.length >> 8) & 0xFF; rec[4] = hs.length & 0xFF;
    hs.copy(rec, 5);
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => socket.write(rec));
    socket.once("data", (data) => { clearTimeout(timer); socket.destroy(); resolve(data.length >= 5 && data[0] === 0x16 && data[1] === 0x03 && data[2] === 0x00); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

function rawSslv3ProbeCipher(host, port, cipherId, timeoutMs) {
  return new Promise((resolve) => {
    const rnd = crypto.randomBytes(32);
    const suites = Buffer.concat([cipherId, Buffer.from([0x00, 0xFF])]);
    const hello = Buffer.alloc(2 + 32 + 1 + 2 + suites.length + 2);
    let off = 0;
    hello[off++] = 0x03; hello[off++] = 0x00;
    rnd.copy(hello, off); off += 32;
    hello[off++] = 0x00;
    hello[off++] = (suites.length >> 8) & 0xFF; hello[off++] = suites.length & 0xFF;
    suites.copy(hello, off); off += suites.length;
    hello[off++] = 0x01; hello[off++] = 0x00;
    const hs = Buffer.alloc(4 + hello.length);
    hs[0] = 0x01; hs[1] = (hello.length >> 16) & 0xFF; hs[2] = (hello.length >> 8) & 0xFF; hs[3] = hello.length & 0xFF;
    hello.copy(hs, 4);
    const rec = Buffer.alloc(5 + hs.length);
    rec[0] = 0x16; rec[1] = 0x03; rec[2] = 0x00; rec[3] = (hs.length >> 8) & 0xFF; rec[4] = hs.length & 0xFF;
    hs.copy(rec, 5);
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once("connect", () => socket.write(rec));
    socket.once("data", (data) => {
      clearTimeout(timer); socket.destroy();
      if (data.length < 5) return resolve(false);
      if (data[0] === 0x15 || data[0] !== 0x16) return resolve(false);
      const recLen = (data[3] << 8) | data[4];
      const b = data.slice(5, Math.min(data.length, 5 + Math.min(recLen, 64)));
      resolve(b.length >= 1 && b[0] === 0x02);
    });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}

const TLS_VERSION_NOTES = Object.freeze({
  SSLv2: "DEPRECATED — protocol broken, RFC 6176",
  SSLv3: "DEPRECATED — POODLE attack, RFC 7568",
  TLSv1: "DEPRECATED — BEAST/POODLE, RFC 8996",
  "TLSv1.1": "DEPRECATED — RFC 8996",
  "TLSv1.2": "Legacy — only AEAD+FS suites are recommended",
  "TLSv1.3": "CURRENT — AEAD only, forward secrecy mandatory",
});
const RATING_ORDER = Object.freeze({ broken: 0, weak: 1, strong: 2, unknown: 3 });

async function scanCiphers(host, port, timeoutMs) {
  const probeTimeout = Math.min(timeoutMs, 4000);
  const probes = [];
  for (const version of TLS_VERSION_OPTIONS) {
    probes.push(probeCipher({ host, port, tlsVersion: version.value, timeoutMs: probeTimeout }).then((r) => ({ version: version.label, result: r })));
  }
  for (const cipher of TLS12_CIPHER_PROBES.slice(0, MAX_CIPHER_PROBES)) {
    probes.push(probeCipher({ host, port, tlsVersion: "TLSv1.2", cipher, timeoutMs: probeTimeout }).then((r) => ({ version: "TLSv1.2", result: r })));
  }
  for (const suite of TLS13_CIPHER_PROBES) {
    probes.push(probeCipher({ host, port, tlsVersion: "TLSv1.3", tls13Cipher: suite, timeoutMs: probeTimeout }).then((r) => ({ version: "TLSv1.3", result: r })));
  }

  // Run TLS probes in parallel with SSLv2/SSLv3 baseline checks
  const [settled, sslv2Ok, sslv3Ok] = await Promise.all([
    Promise.all(probes),
    rawSslv2Baseline(host, port, probeTimeout),
    rawSslv3Baseline(host, port, probeTimeout),
  ]);

  const protocolSupport = { SSLv2: false, SSLv3: false };
  const accepted = [];
  const seen = new Set();
  for (const version of TLS_VERSION_OPTIONS) protocolSupport[version.label] = false;

  for (const item of settled) {
    if (!item.result) continue;
    protocolSupport[item.version] = true;
    const key = `${item.result.tlsVersion}:${item.result.cipher}`;
    if (!seen.has(key)) { seen.add(key); accepted.push(item.result); }
  }

  // SSLv2 per-cipher probes
  if (sslv2Ok) {
    protocolSupport.SSLv2 = true;
    const sslv2Results = await Promise.all(SSLV2_CIPHERS.map((c) =>
      rawSslv2ProbeCipher(host, port, c.id, probeTimeout).then((ok) => ok ? { tlsVersion: "SSLv2", cipher: c.name, rating: "broken", bits: c.bits } : null)
    ));
    for (const r of sslv2Results) {
      if (!r) continue;
      const key = `${r.tlsVersion}:${r.cipher}`;
      if (!seen.has(key)) { seen.add(key); accepted.push(r); }
    }
  }

  // SSLv3 per-cipher probes
  if (sslv3Ok) {
    protocolSupport.SSLv3 = true;
    const sslv3Results = await Promise.all(SSLV3_CIPHERS.map((c) =>
      rawSslv3ProbeCipher(host, port, c.id, probeTimeout).then((ok) => ok ? { tlsVersion: "SSLv3", cipher: c.name, rating: rateCipher(c.name), bits: c.bits } : null)
    ));
    for (const r of sslv3Results) {
      if (!r) continue;
      const key = `${r.tlsVersion}:${r.cipher}`;
      if (!seen.has(key)) { seen.add(key); accepted.push(r); }
    }
  }

  accepted.sort((a, b) => {
    const rv = RATING_ORDER[a.rating] - RATING_ORDER[b.rating];
    return rv || `${a.tlsVersion}:${a.cipher}`.localeCompare(`${b.tlsVersion}:${b.cipher}`);
  });

  // Group accepted ciphers by TLS version
  const grouped = {};
  for (const item of accepted) {
    const ver = item.tlsVersion || "unknown";
    if (!grouped[ver]) grouped[ver] = [];
    grouped[ver].push(item);
  }
  const versionOrder = ["TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1", "SSLv3", "SSLv2"];
  const sortedGrouped = {};
  for (const ver of versionOrder) {
    if (grouped[ver]) sortedGrouped[ver] = grouped[ver];
  }

  const findings = [];
  const deprecated = ["SSLv2", "SSLv3", "TLSv1", "TLSv1.1"].filter((version) => protocolSupport[version]);
  if (deprecated.length) findings.push(issue("high", "Deprecated TLS/SSL protocol version accepted", deprecated.join(", ")));
  if (!protocolSupport["TLSv1.3"]) findings.push(issue("low", "TLS 1.3 not supported", "Server does not accept TLS 1.3 connections"));
  if (protocolSupport["TLSv1.2"] && !accepted.some((item) => item.tlsVersion === "TLSv1.2" && item.rating === "strong")) {
    findings.push(issue("medium", "TLSv1.2 accepts no STRONG cipher suites", "Server only offers CBC-mode or non-FS suites on TLSv1.2"));
  }
  for (const [ver, ciphers] of Object.entries(sortedGrouped)) {
    const broken = ciphers.filter((c) => c.rating === "broken");
    const weak = ciphers.filter((c) => c.rating === "weak");
    if (broken.length) findings.push(issue("critical", `Broken cipher suite(s) accepted on ${ver}`, broken.map((c) => c.cipher).slice(0, 5).join(", ")));
    if (weak.length) findings.push(issue("high", `Weak cipher suite(s) accepted on ${ver}`, weak.map((c) => c.cipher).slice(0, 5).join(", ")));
  }
  return {
    protocolSupport,
    grouped: sortedGrouped,
    accepted,
    findings,
    versionNotes: TLS_VERSION_NOTES,
    notes: [
      "Cipher probing uses Node/OpenSSL for TLS 1.0–1.3 and raw socket probes for SSLv2/SSLv3.",
    ],
  };
}

function countsForIssues(issues) {
  return issues.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
}

async function analyzeTlsTarget(input, options = {}) {
  const normalized = normalizeTlsTarget(input);
  if (!normalized.ok) return { success: false, error: normalized.error };
  await assertPublicTlsTarget(normalized);

  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 2000), 15000);
  const result = {
    target: normalized.target,
    host: normalized.host,
    port: normalized.port,
    success: false,
    error: null,
  };

  try {
    const fetched = await connectTls({ host: normalized.host, port: normalized.port, timeoutMs });
    const certificate = buildCertificateRecord(fetched.peer);
    result.success = true;
    result.certSourceIp = fetched.remoteAddress;
    result.certificate = certificate;
    result.tls = {
      version: fetched.protocol,
      cipher: fetched.cipher,
      cipherBits: fetched.cipherBits,
      alpn: fetched.alpn || null,
    };
    result.chain = chainFromPeer(fetched.peer);
    result.chainLength = result.chain.length;
    result.discoveredSanDns = certificate.sanDns;
    let issues = [
      ...analyzeCertificate(result),
      ...analyzeTlsContext(result.tls),
      ...analyzeChain(result.chain),
    ];

    if (options.includeDns) {
      const { ipv4, ipv6 } = await resolveHostIps(normalized.host);
      const consistency = await checkIpCertificateConsistency(normalized.host, normalized.port, [...ipv4, ...ipv6], Math.min(timeoutMs, 5000));
      const records = await resolveRecords(normalized.host);
      result.dns = {
        certSourceIp: fetched.remoteAddress,
        resolvedIpv4: ipv4,
        resolvedIpv6: ipv6,
        nameservers: records.nameservers,
        mxRecords: records.mx,
        ipCertFingerprints: consistency.fingerprints,
        certConsistent: consistency.consistent,
        caaRecords: records.caa,
        spfRecord: records.spf,
        dmarcRecord: records.dmarc,
        dnssec: records.dnssec,
        zoneTransfer: records.zoneTransfer,
        wildcardDns: records.wildcard,
      };
      issues = issues.concat(analyzeDns(result));
    }

    if (options.includeCt) {
      try {
        result.ctNames = await ctLookup(normalized.host, Math.min(timeoutMs, 8000));
      } catch (error) {
        result.ctNames = [`<CT lookup failed: ${error.message}>`];
      }
    }

    if (options.includeCiphers) {
      result.cipherScan = await scanCiphers(normalized.host, normalized.port, timeoutMs);
      issues = issues.concat(result.cipherScan.findings);
    }

    delete certificate.raw;
    result.issues = sortIssues(issues);
    result.counts = countsForIssues(result.issues);
    return result;
  } catch (error) {
    return {
      ...result,
      success: false,
      error: error.message,
      issues: [issue("high", "TLS connection failed", error.message)],
      counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    };
  }
}

module.exports = {
  analyzeTlsTarget,
  normalizeTlsTarget,
  hostnameMatches,
  internalNameIndicators,
  rateCipher,
  sortIssues,
};
