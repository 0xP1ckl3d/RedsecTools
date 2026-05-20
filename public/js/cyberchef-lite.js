// cyberchef-lite.js — Lightweight CyberChef for RedSecMiniTools
// All operations run client-side using browser APIs

// --- Byte/string helpers ---

function textToBytes(text) {
  return new TextEncoder().encode(text);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = hex.replace(/[\s:,-]/g, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  return bytes;
}

// --- Base32 (RFC 4648) ---

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(input) {
  const bytes = textToBytes(input);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = (bits.substr(i, 5) + "00000").substr(0, 5);
    out += B32[parseInt(chunk, 2)];
  }
  const pad = [0, 6, 4, 3, 1][bits.length % 5] || 0;
  return out + "=".repeat(pad);
}

function base32Decode(input) {
  const clean = input.toUpperCase().replace(/[=\s]/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) throw new Error("Invalid Base32 character: " + c);
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
  return new TextDecoder().decode(bytes);
}

// --- MD5 (compact implementation) ---

function md5(input) {
  const bytes = textToBytes(input);
  const len = bytes.length;
  // Pre-processing: adding padding bits
  const bitLen = len * 8;
  const padLen = ((56 - (len + 1) % 64) + 64) % 64;
  const buf = new Uint8Array(len + 1 + padLen + 8);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, bitLen >>> 0, true);
  view.setUint32(buf.length - 4, 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);

  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)      { F = (B & C) | (~B & D); g = i; }
      else if (i < 32)  { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48)  { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else              { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const result = new Uint8Array(16);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, a0, true); rv.setUint32(4, b0, true); rv.setUint32(8, c0, true); rv.setUint32(12, d0, true);
  return bytesToHex(result);
}

// --- SHA (Web Crypto API) ---

async function shaHash(algo, input) {
  const data = textToBytes(input);
  const hash = await crypto.subtle.digest(algo, data);
  return bytesToHex(new Uint8Array(hash));
}

// --- CRC32 (ISO 3309 / ITU-T V.42) ---
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c;
}
function crc32(input) {
  const bytes = textToBytes(input);
  let crc = 0xFFFFFFFF;
  for (const b of bytes) crc = CRC32_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

// --- Shannon entropy ---
function shannonEntropy(input) {
  const bytes = textToBytes(input);
  if (!bytes.length) return "0";
  const freq = new Float64Array(256);
  for (const b of bytes) freq[b]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / bytes.length;
    entropy -= p * Math.log2(p);
  }
  const pct = ((entropy / 8) * 100).toFixed(1);
  let rating = "Low";
  if (entropy >= 7.5) rating = "Very High (encrypted/compressed)";
  else if (entropy >= 6) rating = "High";
  else if (entropy >= 4) rating = "Moderate";
  return `${entropy.toFixed(4)} bits/byte (${pct}%)\nRating: ${rating}\nSize: ${bytes.length} bytes`;
}

// --- RC4 stream cipher ---
function rc4(input, key) {
  const keyBytes = textToBytes(key);
  if (!keyBytes.length) throw new Error("RC4 key is required");
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xFF; [S[i], S[j]] = [S[j], S[i]]; }
  const inputBytes = textToBytes(input);
  const out = new Uint8Array(inputBytes.length);
  let si = 0, sj = 0;
  for (let n = 0; n < inputBytes.length; n++) {
    si = (si + 1) & 0xFF; sj = (sj + S[si]) & 0xFF; [S[si], S[sj]] = [S[sj], S[si]];
    out[n] = inputBytes[n] ^ S[(S[si] + S[sj]) & 0xFF];
  }
  return new TextDecoder().decode(out);
}

// --- AES encrypt/decrypt (Web Crypto API) ---
async function aesOp(input, keyHex, ivHex, mode, encrypt) {
  const keyBytes = hexToBytes(keyHex);
  if (![16, 24, 32].includes(keyBytes.length)) throw new Error("Key must be 16, 24, or 32 bytes (AES-128/192/256)");
  const ivBytes = ivHex ? hexToBytes(ivHex) : new Uint8Array(mode === "GCM" ? 12 : 16);
  const inputBytes = textToBytes(input);
  const algoName = mode === "CTR" ? "AES-CTR" : mode === "GCM" ? "AES-GCM" : `AES-${mode}`;
  const algoParams = mode === "CTR"
    ? { name: "AES-CTR", counter: ivBytes, length: 64 }
    : { name: algoName, iv: ivBytes };
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: algoName }, false, [encrypt ? "encrypt" : "decrypt"]);
  const result = encrypt
    ? await crypto.subtle.encrypt(algoParams, cryptoKey, inputBytes)
    : await crypto.subtle.decrypt(algoParams, cryptoKey, inputBytes);
  return bytesToHex(new Uint8Array(result));
}

// --- Magic autodetect ---
function magicDetect(input) {
  const findings = [];
  const trimmed = input.trim();

  // Base64 detection
  if (/^[A-Za-z0-9+/\r\n]+=*$/m.test(trimmed) && trimmed.length > 4 && trimmed.length % 4 <= 1) {
    try { const d = atob(trimmed.replace(/\s/g, "")); if (d.length > 0) findings.push("Base64 — try Base64 Decode"); } catch {}
  }
  if (/^[A-Za-z0-9_-]+$/m.test(trimmed) && trimmed.length > 8) {
    try { const pad = trimmed.length % 4; const p = pad ? "=".repeat(4 - pad) : ""; const d = atob((trimmed + p).replace(/-/g, "+").replace(/_/g, "/")); if (d.length > 0) findings.push("Base64URL — try Base64 Decode with URL-safe alphabet"); } catch {}
  }
  // Hex detection
  if (/^(0x)?[0-9a-fA-F\s:]+$/.test(trimmed) && trimmed.replace(/[\s:0x]/g, "").length % 2 === 0 && trimmed.replace(/[\s:0x]/g, "").length >= 4) {
    findings.push("Hex — try From Hex");
  }
  // URL encoding
  if (/%[0-9A-Fa-f]{2}/.test(trimmed)) findings.push("URL encoded — try URL Decode");
  // HTML entities
  if (/&#[0-9]+;|&[a-zA-Z]+;/.test(trimmed)) findings.push("HTML entities — try HTML Decode");
  // JWT
  if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) findings.push("JWT — try JWT Decode");
  // Hash identification
  const hexOnly = trimmed.replace(/[\s:]/g, "").toLowerCase();
  if (/^[0-9a-f]+$/.test(hexOnly)) {
    if (hexOnly.length === 32) findings.push("MD5 hash (32 hex chars)");
    if (hexOnly.length === 40) findings.push("SHA-1 hash (40 hex chars)");
    if (hexOnly.length === 56) findings.push("SHA-224 or SHA3-224 (56 hex chars)");
    if (hexOnly.length === 64) findings.push("SHA-256 or SHA3-256 (64 hex chars)");
    if (hexOnly.length === 96) findings.push("SHA-384 or SHA3-384 (96 hex chars)");
    if (hexOnly.length === 128) findings.push("SHA-512 or SHA3-512 (128 hex chars)");
  }
  // JSON
  if (/^\s*[\[{]/.test(trimmed)) {
    try { JSON.parse(trimmed); findings.push("JSON — try JSON Pretty Print"); } catch {}
  }
  // Defanged IOCs
  if (/\[\.\]|\[@\]/.test(trimmed)) findings.push("Defanged — try Fang (Refang)");
  // ROT13
  const rotTest = trimmed.replace(/[a-zA-Z]/g, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - b + 13) % 26 + b); });
  if (/[a-zA-Z]/.test(trimmed) && rotTest !== trimmed && /[a-zA-Z]{4,}/.test(rotTest)) findings.push("Possibly ROT13 encoded");
  // Binary
  if (/^[01\s]+$/.test(trimmed) && trimmed.replace(/\s/g, "").length % 8 === 0) findings.push("Binary — convert from binary");
  // Decimal numbers
  if (/^\d[\d\s]+$/.test(trimmed) && trimmed.length > 3) findings.push("Decimal — may be decimal-encoded bytes");

  if (!findings.length) return "No patterns detected. Try manual operation selection.";
  return findings.map((f, i) => `${i + 1}. ${f}`).join("\n");
}

// Parse key from various formats into hex
function parseKeyToHex(keyStr, format) {
  if (!keyStr) return "";
  const f = (format || "utf8").toLowerCase();
  if (f === "hex") { const h = keyStr.replace(/[\s:]/g, ""); if (!/^[0-9a-f]*$/i.test(h)) throw new Error("Invalid hex key"); return h; }
  if (f === "base64") { const bytes = Uint8Array.from(atob(keyStr), (c) => c.charCodeAt(0)); return bytesToHex(bytes); }
  return bytesToHex(textToBytes(keyStr));
}

// --- Operation definitions ---

const OPERATIONS = [
  // Encode / Decode
  { id: "base64-encode", name: "Base64 Encode", cat: "Encode/Decode",
    run: async (input) => btoa(unescape(encodeURIComponent(input))) },
  { id: "base64-decode", name: "Base64 Decode", cat: "Encode/Decode",
    args: [{ id: "alphabet", label: "Alphabet", type: "select", options: ["standard", "url-safe"], default: "standard" }],
    run: async (input, args) => {
      const clean = input.replace(/\s/g, "");
      if (args.alphabet === "url-safe") {
        const std = clean.replace(/-/g, "+").replace(/_/g, "/");
        const pad = std.length % 4;
        return decodeURIComponent(escape(atob(pad ? std + "=".repeat(4 - pad) : std)));
      }
      return decodeURIComponent(escape(atob(clean)));
    } },
  { id: "base64url-encode", name: "Base64 URL-safe Encode", cat: "Encode/Decode",
    run: async (input) => btoa(unescape(encodeURIComponent(input))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
  { id: "base64url-decode", name: "Base64 URL-safe Decode", cat: "Encode/Decode",
    run: async (input) => {
      const std = input.replace(/-/g, "+").replace(/_/g, "/");
      const pad = std.length % 4;
      return decodeURIComponent(escape(atob(pad ? std + "=".repeat(4 - pad) : std)));
    } },
  { id: "base32-encode", name: "Base32 Encode", cat: "Encode/Decode",
    run: async (input) => base32Encode(input) },
  { id: "base32-decode", name: "Base32 Decode", cat: "Encode/Decode",
    run: async (input) => base32Decode(input) },
  { id: "hex-encode", name: "To Hex", cat: "Encode/Decode",
    args: [{ id: "delimiter", label: "Delimiter", type: "select", options: ["none", "space", "colon", "0x"], default: "none" }],
    run: async (input, args) => {
      const hex = bytesToHex(textToBytes(input));
      const d = args.delimiter || "none";
      if (d === "space") return hex.match(/.{2}/g).join(" ");
      if (d === "colon") return hex.match(/.{2}/g).join(":");
      if (d === "0x") return hex.match(/.{2}/g).map(b => "0x" + b).join(" ");
      return hex;
    } },
  { id: "hex-decode", name: "From Hex", cat: "Encode/Decode",
    run: async (input) => new TextDecoder().decode(hexToBytes(input)) },
  { id: "url-encode", name: "URL Encode", cat: "Encode/Decode",
    run: async (input) => encodeURIComponent(input) },
  { id: "url-decode", name: "URL Decode", cat: "Encode/Decode",
    run: async (input) => decodeURIComponent(input) },
  { id: "html-encode", name: "HTML Encode", cat: "Encode/Decode",
    run: async (input) => input.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) },
  { id: "html-decode", name: "HTML Decode", cat: "Encode/Decode",
    run: async (input) => { const t = document.createElement("textarea"); t.innerHTML = input; return t.value; } },

  // Hashing
  { id: "md5", name: "MD5", cat: "Hashing",
    run: async (input) => md5(input) },
  { id: "sha1", name: "SHA-1", cat: "Hashing",
    run: async (input) => shaHash("SHA-1", input) },
  { id: "sha256", name: "SHA-256", cat: "Hashing",
    run: async (input) => shaHash("SHA-256", input) },
  { id: "sha384", name: "SHA-384", cat: "Hashing",
    run: async (input) => shaHash("SHA-384", input) },
  { id: "sha512", name: "SHA-512", cat: "Hashing",
    run: async (input) => shaHash("SHA-512", input) },
  { id: "crc32", name: "CRC32", cat: "Hashing",
    run: async (input) => crc32(input) },
  { id: "entropy", name: "Entropy", cat: "Hashing",
    run: async (input) => shannonEntropy(input) },
  { id: "hmac", name: "HMAC", cat: "Hashing",
    args: [
      { id: "key", label: "Key", type: "text", default: "" },
      { id: "hash", label: "Hash", type: "select", options: ["SHA-1", "SHA-256", "SHA-384", "SHA-512"], default: "SHA-256" },
      { id: "outputFormat", label: "Output", type: "select", options: ["hex", "base64"], default: "hex" }
    ],
    run: async (input, args) => {
      const hashAlgo = args.hash || "SHA-256";
      const key = await crypto.subtle.importKey("raw", textToBytes(args.key || ""), { name: "HMAC", hash: hashAlgo }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, textToBytes(input));
      const bytes = new Uint8Array(sig);
      return args.outputFormat === "base64" ? btoa(String.fromCharCode(...bytes)) : bytesToHex(bytes);
    } },

  // Ciphers
  { id: "rot13", name: "ROT13", cat: "Ciphers",
    run: async (input) => input.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    }) },
  { id: "xor", name: "XOR", cat: "Ciphers",
    args: [
      { id: "key", label: "Key", type: "text", default: "secret" },
      { id: "keyFormat", label: "Key format", type: "select", options: ["utf8", "hex", "base64"], default: "utf8" },
      { id: "outputFormat", label: "Output", type: "select", options: ["hex", "base64"], default: "hex" }
    ],
    run: async (input, args) => {
      const keyHex = parseKeyToHex(args.key, args.keyFormat || "utf8");
      if (!keyHex) throw new Error("XOR key is required");
      const keyBytes = hexToBytes(keyHex);
      const inputBytes = textToBytes(input);
      const out = new Uint8Array(inputBytes.length);
      for (let i = 0; i < inputBytes.length; i++) out[i] = inputBytes[i] ^ keyBytes[i % keyBytes.length];
      return args.outputFormat === "base64" ? btoa(String.fromCharCode(...out)) : bytesToHex(out);
    } },
  { id: "xor-decode", name: "XOR Decode", cat: "Ciphers",
    args: [
      { id: "key", label: "Key", type: "text", default: "secret" },
      { id: "keyFormat", label: "Key format", type: "select", options: ["utf8", "hex", "base64"], default: "utf8" },
      { id: "inputFormat", label: "Input format", type: "select", options: ["hex", "base64"], default: "hex" }
    ],
    run: async (input, args) => {
      const keyHex = parseKeyToHex(args.key, args.keyFormat || "utf8");
      if (!keyHex) throw new Error("XOR key is required");
      const keyBytes = hexToBytes(keyHex);
      const inputBytes = args.inputFormat === "base64" ? Uint8Array.from(atob(input.trim()), (c) => c.charCodeAt(0)) : hexToBytes(input);
      const out = new Uint8Array(inputBytes.length);
      for (let i = 0; i < inputBytes.length; i++) out[i] = inputBytes[i] ^ keyBytes[i % keyBytes.length];
      return new TextDecoder().decode(out);
    } },
  { id: "caesar", name: "Caesar Shift", cat: "Ciphers",
    args: [{ id: "shift", label: "Shift", type: "number", default: 3 }],
    run: async (input, args) => {
      const shift = parseInt(args.shift, 10) || 3;
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + ((shift % 26) + 26) % 26) % 26 + base);
      });
    } },
  { id: "reverse", name: "Reverse", cat: "Ciphers",
    run: async (input) => input.split("").reverse().join("") },
  { id: "aes-encrypt", name: "AES Encrypt", cat: "Ciphers",
    args: [
      { id: "key", label: "Key (hex)", type: "text", default: "" },
      { id: "iv", label: "IV (hex)", type: "text", default: "" },
      { id: "mode", label: "Mode", type: "select", options: ["CBC", "CTR", "GCM"], default: "CBC" }
    ],
    run: async (input, args) => aesOp(input, args.key, args.iv, args.mode || "CBC", true) },
  { id: "aes-decrypt", name: "AES Decrypt", cat: "Ciphers",
    args: [
      { id: "key", label: "Key (hex)", type: "text", default: "" },
      { id: "iv", label: "IV (hex)", type: "text", default: "" },
      { id: "mode", label: "Mode", type: "select", options: ["CBC", "CTR", "GCM"], default: "CBC" }
    ],
    run: async (input, args) => {
      const keyBytes = hexToBytes(args.key);
      if (![16, 24, 32].includes(keyBytes.length)) throw new Error("Key must be 16, 24, or 32 bytes (AES-128/192/256)");
      const mode = args.mode || "CBC";
      const ivBytes = args.iv ? hexToBytes(args.iv) : new Uint8Array(mode === "GCM" ? 12 : 16);
      const inputBytes = hexToBytes(input.trim());
      const algoName = mode === "CTR" ? "AES-CTR" : mode === "GCM" ? "AES-GCM" : `AES-${mode}`;
      const algoParams = mode === "CTR"
        ? { name: "AES-CTR", counter: ivBytes, length: 64 }
        : { name: algoName, iv: ivBytes };
      const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: algoName }, false, ["decrypt"]);
      const result = await crypto.subtle.decrypt(algoParams, cryptoKey, inputBytes);
      return new TextDecoder().decode(new Uint8Array(result));
    } },
  { id: "rc4", name: "RC4", cat: "Ciphers",
    args: [{ id: "key", label: "Key", type: "text", default: "" }],
    run: async (input, args) => {
      const result = rc4(input, args.key);
      return bytesToHex(textToBytes(result));
    } },
  { id: "rc4-decode", name: "RC4 Decode", cat: "Ciphers",
    args: [{ id: "key", label: "Key", type: "text", default: "" }],
    run: async (input, args) => rc4(new TextDecoder().decode(hexToBytes(input.trim())), args.key) },

  // Data Format
  { id: "json-pretty", name: "JSON Pretty Print", cat: "Data Format",
    run: async (input) => JSON.stringify(JSON.parse(input), null, 2) },
  { id: "json-minify", name: "JSON Minify", cat: "Data Format",
    run: async (input) => JSON.stringify(JSON.parse(input)) },
  { id: "jwt-decode", name: "JWT Decode", cat: "Data Format",
    run: async (input) => {
      const parts = input.trim().split(".");
      if (parts.length < 2) throw new Error("Invalid JWT format");
      const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      const result = { header, payload };
      if (payload.exp) {
        const expDate = new Date(payload.exp * 1000);
        result.expired = Date.now() > payload.exp * 1000;
        result.expiresAt = expDate.toISOString();
      }
      if (payload.iat) result.issuedAt = new Date(payload.iat * 1000).toISOString();
      if (payload.nbf) result.notBefore = new Date(payload.nbf * 1000).toISOString();
      return JSON.stringify(result, null, 2);
    } },
  { id: "url-parse", name: "Parse URL", cat: "Data Format",
    run: async (input) => {
      const u = new URL(input.trim());
      const params = {};
      u.searchParams.forEach((v, k) => { params[k] = params[k] ? (Array.isArray(params[k]) ? [...params[k], v] : [params[k], v]) : v; });
      return JSON.stringify({ protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port || null, pathname: u.pathname, search: u.search || null, hash: u.hash || null, origin: u.origin, params: Object.keys(params).length ? params : null }, null, 2);
    } },

  // Defang / Fang
  { id: "defang", name: "Defang", cat: "Defang",
    run: async (input) => input.replace(/https?:\/\//gi, (m) => m[0] + "[" + m.slice(1, -2) + "]" + m.slice(-2)).replace(/\./g, "[.]").replace(/@/g, "[@]") },
  { id: "fang", name: "Fang (Refang)", cat: "Defang",
    run: async (input) => input.replace(/\[\.\]/g, ".").replace(/\[@\]/g, "@").replace(/\[dot\]/gi, ".").replace(/\[at\]/gi, "@").replace(/\[\/\]/g, "/").replace(/h\[ttp/gi, "http") },

  // Extract
  { id: "extract-ips", name: "Extract IPs", cat: "Extract",
    run: async (input) => { const m = input.match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g); return m ? [...new Set(m)].join("\n") : "No IPs found"; } },
  { id: "extract-ipv6", name: "Extract IPv6", cat: "Extract",
    run: async (input) => { const m = input.match(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g); return m ? [...new Set(m)].join("\n") : "No IPv6 addresses found"; } },
  { id: "extract-urls", name: "Extract URLs", cat: "Extract",
    run: async (input) => { const m = input.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi); return m ? [...new Set(m)].join("\n") : "No URLs found"; } },
  { id: "extract-emails", name: "Extract Emails", cat: "Extract",
    run: async (input) => { const m = input.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g); return m ? [...new Set(m)].join("\n") : "No emails found"; } },
  { id: "extract-domains", name: "Extract Domains", cat: "Extract",
    run: async (input) => { const m = input.match(/\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g); return m ? [...new Set(m)].join("\n") : "No domains found"; } },
  { id: "extract-hashes", name: "Extract Hashes", cat: "Extract",
    run: async (input) => {
      const m = input.match(/\b[a-fA-F0-9]{32,128}\b/g);
      if (!m) return "No hashes found";
      return [...new Set(m)].map(h => {
        const len = h.length;
        let type = "Unknown";
        if (len === 32) type = "MD5";
        else if (len === 40) type = "SHA-1";
        else if (len === 56) type = "SHA-224/SHA3-224";
        else if (len === 64) type = "SHA-256/SHA3-256";
        else if (len === 96) type = "SHA-384/SHA3-384";
        else if (len === 128) type = "SHA-512/SHA3-512";
        return `${h}  [${type}]`;
      }).join("\n");
    } },

  // Analysis
  { id: "magic", name: "Magic (Autodetect)", cat: "Analysis",
    run: async (input) => magicDetect(input) },

  // Text
  { id: "uppercase", name: "Uppercase", cat: "Text",
    run: async (input) => input.toUpperCase() },
  { id: "lowercase", name: "Lowercase", cat: "Text",
    run: async (input) => input.toLowerCase() },
  { id: "remove-whitespace", name: "Remove Whitespace", cat: "Text",
    run: async (input) => input.replace(/\s+/g, "") },
  { id: "remove-null", name: "Remove Null Bytes", cat: "Text",
    run: async (input) => input.replace(/\x00/g, "") },
  { id: "line-count", name: "Line Count", cat: "Text",
    run: async (input) => `Lines: ${input.split("\n").length}\nCharacters: ${input.length}\nWords: ${input.trim() ? input.trim().split(/\s+/).length : 0}` },
  { id: "regex-match", name: "Regex Match", cat: "Text",
    args: [{ id: "pattern", label: "Pattern", type: "text", default: "" }, { id: "flags", label: "Flags", type: "text", default: "gi" }],
    run: async (input, args) => {
      if (!args.pattern) throw new Error("Regex pattern is required");
      const re = new RegExp(args.pattern, args.flags || "gi");
      const m = [...input.matchAll(re)];
      return m.length ? m.map((match, i) => `${i + 1}. ${match[0]}${match[1] !== undefined ? " (groups: " + match.slice(1).join(", ") + ")" : ""}`).join("\n") : "No matches";
    } },
  { id: "find-replace", name: "Find / Replace", cat: "Text",
    args: [
      { id: "find", label: "Find", type: "text", default: "" },
      { id: "replace", label: "Replace with", type: "text", default: "" },
      { id: "isRegex", label: "Regex", type: "select", options: ["no", "yes"], default: "no" },
      { id: "caseSensitive", label: "Case sensitive", type: "select", options: ["yes", "no"], default: "yes" },
      { id: "multiline", label: "Multiline", type: "select", options: ["no", "yes"], default: "no" }
    ],
    run: async (input, args) => {
      if (!args.find) return input;
      let flags = "g";
      if (args.caseSensitive !== "yes") flags += "i";
      if (args.multiline === "yes") flags += "m";
      const pattern = args.isRegex === "yes" ? args.find : args.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return input.replace(new RegExp(pattern, flags), args.replace || "");
    } },
  { id: "sort-lines", name: "Sort Lines", cat: "Text",
    args: [
      { id: "order", label: "Order", type: "select", options: ["ascending", "descending"], default: "ascending" },
      { id: "mode", label: "Mode", type: "select", options: ["alphabetical", "numeric", "length"], default: "alphabetical" }
    ],
    run: async (input, args) => {
      const lines = input.split("\n");
      const reverse = args.order === "descending";
      const mode = args.mode || "alphabetical";
      const sorted = lines.sort((a, b) => {
        let cmp = 0;
        if (mode === "numeric") cmp = parseFloat(a) - parseFloat(b);
        else if (mode === "length") cmp = a.length - b.length;
        else cmp = a.localeCompare(b);
        return reverse ? -cmp : cmp;
      });
      return sorted.join("\n");
    } },
  { id: "unique-lines", name: "Unique Lines", cat: "Text",
    run: async (input) => [...new Set(input.split("\n"))].join("\n") },
];

// Build lookup and category list
const OP_MAP = Object.fromEntries(OPERATIONS.map((op) => [op.id, op]));
const CATEGORIES = [...new Set(OPERATIONS.map((op) => op.cat))];

// --- Recipe engine ---

async function executeRecipe(input, recipe) {
  let current = input;
  let stepNum = 0;
  for (let i = 0; i < recipe.length; i++) {
    const step = recipe[i];
    if (step.disabled) continue;
    stepNum++;
    const op = OP_MAP[step.opId];
    if (!op) throw new Error(`Unknown operation: ${step.opId}`);
    try {
      current = await op.run(current, step.args || {});
    } catch (e) {
      throw new Error(`Step ${stepNum} (${op.name}) failed: ${e.message}`);
    }
  }
  return current;
}

// --- UI ---

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function initCyberChef() {
  const searchEl = document.getElementById("cyberchef-search");
  const catFilterEl = document.getElementById("cyberchef-cat-filter");
  const opsListEl = document.getElementById("cyberchef-ops-list");
  const recipeEl = document.getElementById("cyberchef-recipe");
  const inputEl = document.getElementById("cyberchef-input");
  const outputEl = document.getElementById("cyberchef-output");
  const bakeBtn = document.getElementById("cyberchef-bake");
  const copyBtn = document.getElementById("cyberchef-copy");
  const swapBtn = document.getElementById("cyberchef-swap");
  const clearRecipeBtn = document.getElementById("cyberchef-clear-recipe");
  if (!searchEl || !bakeBtn || !outputEl) return;

  const recipe = [];
  let activeCat = null;
  let debounceTimer = null;

  function renderOps(filter = "") {
    const f = filter.toLowerCase();
    const filtered = OPERATIONS.filter((op) => {
      if (activeCat && op.cat !== activeCat) return false;
      if (f && !op.name.toLowerCase().includes(f) && !op.cat.toLowerCase().includes(f)) return false;
      return true;
    });
    opsListEl.innerHTML = filtered.map((op) =>
      `<button type="button" class="cyberchef-op-btn" data-cyberchef-add="${escapeHtml(op.id)}" title="${escapeHtml(op.cat)}">${escapeHtml(op.name)}</button>`
    ).join("");
  }

  function renderCatFilter() {
    catFilterEl.innerHTML = `<button type="button" class="cyberchef-cat-btn ${!activeCat ? "active" : ""}" data-cyberchef-cat="">All</button>` +
      CATEGORIES.map((cat) =>
        `<button type="button" class="cyberchef-cat-btn ${activeCat === cat ? "active" : ""}" data-cyberchef-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
      ).join("");
  }

  function renderRecipe() {
    if (!recipe.length) {
      recipeEl.innerHTML = '<span class="text-xs text-muted">Click operations to build a recipe chain.</span>';
      return;
    }
    recipeEl.innerHTML = recipe.map((step, i) => {
      const op = OP_MAP[step.opId];
      const disCls = step.disabled ? " cyberchef-step-disabled" : "";
      const toggleIcon = step.disabled ? "▶" : "⏸";
      const toggleCls = step.disabled ? "cyberchef-step-toggle cyberchef-step-toggle-off" : "cyberchef-step-toggle";
      const argsHtml = (op.args || []).map((arg) => {
        if (arg.type === "select") {
          return `<select data-step="${i}" data-arg="${escapeHtml(arg.id)}">${(arg.options || []).map((o) => `<option value="${escapeHtml(o)}" ${step.args[arg.id] === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
        }
        return `<input type="${arg.type}" data-step="${i}" data-arg="${escapeHtml(arg.id)}" value="${escapeHtml(String(step.args[arg.id] ?? arg.default ?? ""))}" placeholder="${escapeHtml(arg.label)}">`;
      }).join("");
      return `<div class="cyberchef-step${disCls}" draggable="true" data-cyberchef-step-idx="${i}"><div class="cyberchef-step-header"><span class="cyberchef-step-num">${i + 1}.</span><span class="cyberchef-step-name">${escapeHtml(op.name)}</span><span class="${toggleCls}" data-cyberchef-toggle="${i}" title="${step.disabled ? "Enable step" : "Disable step"}">${toggleIcon}</span><span class="cyberchef-step-remove" data-cyberchef-remove="${i}" title="Remove">&times;</span></div>${argsHtml ? `<div class="cyberchef-step-args">${argsHtml}</div>` : ""}</div>`;
    }).join("");
  }

  function scheduleAutoBake() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(bake, 300);
  }

  async function bake() {
    const input = inputEl.value;
    if (!recipe.length) { outputEl.value = input; return; }
    bakeBtn.disabled = true;
    bakeBtn.textContent = "Baking...";
    try {
      const result = await executeRecipe(input, recipe);
      outputEl.value = result;
    } catch (e) {
      outputEl.value = `Error: ${e.message}`;
    } finally {
      bakeBtn.disabled = false;
      bakeBtn.textContent = "Bake";
    }
  }

  // --- Event binding ---

  searchEl.addEventListener("input", () => renderOps(searchEl.value));

  catFilterEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cyberchef-cat]");
    if (!btn) return;
    activeCat = btn.dataset.cyberchefCat || null;
    renderCatFilter();
    renderOps(searchEl.value);
  });

  opsListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cyberchef-add]");
    if (!btn) return;
    const op = OP_MAP[btn.dataset.cyberchefAdd];
    if (!op) return;
    const args = {};
    for (const a of op.args || []) args[a.id] = a.default ?? "";
    recipe.push({ opId: op.id, args });
    renderRecipe();
    scheduleAutoBake();
  });

  recipeEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-cyberchef-remove]");
    if (removeBtn) {
      recipe.splice(Number(removeBtn.dataset.cyberchefRemove), 1);
      renderRecipe();
      scheduleAutoBake();
      return;
    }
    const toggleBtn = e.target.closest("[data-cyberchef-toggle]");
    if (toggleBtn) {
      const idx = Number(toggleBtn.dataset.cyberchefToggle);
      recipe[idx].disabled = !recipe[idx].disabled;
      renderRecipe();
      scheduleAutoBake();
    }
  });

  // --- Drag-and-drop reorder ---
  let dragSrcIdx = null;

  recipeEl.addEventListener("dragstart", (e) => {
    const step = e.target.closest("[data-cyberchef-step-idx]");
    if (!step) return;
    dragSrcIdx = Number(step.dataset.cyberchefStepIdx);
    step.classList.add("cyberchef-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragSrcIdx));
  });

  recipeEl.addEventListener("dragend", (e) => {
    const step = e.target.closest("[data-cyberchef-step-idx]");
    if (step) step.classList.remove("cyberchef-dragging");
    dragSrcIdx = null;
    recipeEl.querySelectorAll(".cyberchef-drag-over").forEach(el => el.classList.remove("cyberchef-drag-over"));
  });

  recipeEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const step = e.target.closest("[data-cyberchef-step-idx]");
    recipeEl.querySelectorAll(".cyberchef-drag-over").forEach(el => el.classList.remove("cyberchef-drag-over"));
    if (step && Number(step.dataset.cyberchefStepIdx) !== dragSrcIdx) {
      step.classList.add("cyberchef-drag-over");
    }
  });

  recipeEl.addEventListener("dragleave", (e) => {
    const step = e.target.closest("[data-cyberchef-step-idx]");
    if (step) step.classList.remove("cyberchef-drag-over");
  });

  recipeEl.addEventListener("drop", (e) => {
    e.preventDefault();
    recipeEl.querySelectorAll(".cyberchef-drag-over").forEach(el => el.classList.remove("cyberchef-drag-over"));
    const targetStep = e.target.closest("[data-cyberchef-step-idx]");
    if (!targetStep || dragSrcIdx === null) return;
    const targetIdx = Number(targetStep.dataset.cyberchefStepIdx);
    if (targetIdx === dragSrcIdx) return;
    const [moved] = recipe.splice(dragSrcIdx, 1);
    recipe.splice(targetIdx, 0, moved);
    renderRecipe();
    scheduleAutoBake();
  });

  recipeEl.addEventListener("input", (e) => {
    const el = e.target.closest("[data-step]");
    if (!el) return;
    const step = Number(el.dataset.step);
    const argId = el.dataset.arg;
    if (recipe[step] && argId) recipe[step].args[argId] = el.value;
    scheduleAutoBake();
  });

  recipeEl.addEventListener("change", (e) => {
    const el = e.target.closest("[data-step]");
    if (!el) return;
    const step = Number(el.dataset.step);
    const argId = el.dataset.arg;
    if (recipe[step] && argId) recipe[step].args[argId] = el.value;
    scheduleAutoBake();
  });

  bakeBtn.addEventListener("click", bake);
  inputEl.addEventListener("input", scheduleAutoBake);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) bake(); });

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(outputEl.value).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    });
  });

  swapBtn.addEventListener("click", () => {
    inputEl.value = outputEl.value;
    outputEl.value = "";
    scheduleAutoBake();
  });

  clearRecipeBtn.addEventListener("click", () => {
    recipe.length = 0;
    renderRecipe();
    outputEl.value = "";
  });

  // Initial render
  renderCatFilter();
  renderOps();
  renderRecipe();
}

export { initCyberChef, OPERATIONS, CATEGORIES };
