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

// --- Operation definitions ---

const OPERATIONS = [
  // Encode / Decode
  { id: "base64-encode", name: "Base64 Encode", cat: "Encode/Decode",
    run: async (input) => btoa(unescape(encodeURIComponent(input))) },
  { id: "base64-decode", name: "Base64 Decode", cat: "Encode/Decode",
    run: async (input) => decodeURIComponent(escape(atob(input.replace(/\s/g, "")))) },
  { id: "base32-encode", name: "Base32 Encode", cat: "Encode/Decode",
    run: async (input) => base32Encode(input) },
  { id: "base32-decode", name: "Base32 Decode", cat: "Encode/Decode",
    run: async (input) => base32Decode(input) },
  { id: "hex-encode", name: "To Hex", cat: "Encode/Decode",
    run: async (input) => bytesToHex(textToBytes(input)) },
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
  { id: "hmac-sha256", name: "HMAC-SHA256", cat: "Hashing",
    args: [{ id: "key", label: "Key", type: "text", default: "" }],
    run: async (input, args) => {
      const key = await crypto.subtle.importKey("raw", textToBytes(args.key || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, textToBytes(input));
      return bytesToHex(new Uint8Array(sig));
    } },

  // Ciphers
  { id: "rot13", name: "ROT13", cat: "Ciphers",
    run: async (input) => input.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
    }) },
  { id: "xor", name: "XOR", cat: "Ciphers",
    args: [{ id: "key", label: "Key", type: "text", default: "secret" }],
    run: async (input, args) => {
      const key = args.key || "secret";
      if (!key) throw new Error("XOR key is required");
      const inputBytes = textToBytes(input);
      const keyBytes = textToBytes(key);
      const out = new Uint8Array(inputBytes.length);
      for (let i = 0; i < inputBytes.length; i++) out[i] = inputBytes[i] ^ keyBytes[i % keyBytes.length];
      return bytesToHex(out);
    } },
  { id: "xor-decode", name: "XOR Decode", cat: "Ciphers",
    args: [{ id: "key", label: "Key", type: "text", default: "secret" }, { id: "inputFormat", label: "Input format", type: "select", options: ["hex", "base64"], default: "hex" }],
    run: async (input, args) => {
      const key = args.key || "secret";
      if (!key) throw new Error("XOR key is required");
      const inputBytes = args.inputFormat === "base64" ? Uint8Array.from(atob(input.trim()), (c) => c.charCodeAt(0)) : hexToBytes(input);
      const keyBytes = textToBytes(key);
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
      return JSON.stringify({ header, payload }, null, 2);
    } },
  { id: "url-parse", name: "Parse URL", cat: "Data Format",
    run: async (input) => {
      const u = new URL(input.trim());
      return JSON.stringify({ protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port || null, pathname: u.pathname, search: u.search || null, hash: u.hash || null, origin: u.origin }, null, 2);
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
    run: async (input) => { const m = input.match(/\b[a-fA-F0-9]{32,64}\b/g); return m ? [...new Set(m)].join("\n") : "No hashes found"; } },

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
    args: [{ id: "find", label: "Find", type: "text", default: "" }, { id: "replace", label: "Replace with", type: "text", default: "" }, { id: "isRegex", label: "Regex", type: "select", options: ["no", "yes"], default: "no" }],
    run: async (input, args) => {
      if (!args.find) return input;
      const re = args.isRegex === "yes" ? new RegExp(args.find, "g") : new RegExp(args.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      return input.replace(re, args.replace || "");
    } },
  { id: "sort-lines", name: "Sort Lines", cat: "Text",
    run: async (input) => input.split("\n").sort().join("\n") },
  { id: "unique-lines", name: "Unique Lines", cat: "Text",
    run: async (input) => [...new Set(input.split("\n"))].join("\n") },
];

// Build lookup and category list
const OP_MAP = Object.fromEntries(OPERATIONS.map((op) => [op.id, op]));
const CATEGORIES = [...new Set(OPERATIONS.map((op) => op.cat))];

// --- Recipe engine ---

async function executeRecipe(input, recipe) {
  let current = input;
  for (let i = 0; i < recipe.length; i++) {
    const step = recipe[i];
    const op = OP_MAP[step.opId];
    if (!op) throw new Error(`Unknown operation: ${step.opId}`);
    try {
      current = await op.run(current, step.args || {});
    } catch (e) {
      throw new Error(`Step ${i + 1} (${op.name}) failed: ${e.message}`);
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
      const argsHtml = (op.args || []).map((arg) => {
        if (arg.type === "select") {
          return `<select data-step="${i}" data-arg="${escapeHtml(arg.id)}">${(arg.options || []).map((o) => `<option value="${escapeHtml(o)}" ${step.args[arg.id] === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select>`;
        }
        return `<input type="${arg.type}" data-step="${i}" data-arg="${escapeHtml(arg.id)}" value="${escapeHtml(String(step.args[arg.id] ?? arg.default ?? ""))}" placeholder="${escapeHtml(arg.label)}">`;
      }).join("");
      return `<div class="cyberchef-step"><span class="cyberchef-step-num">${i + 1}.</span><span class="cyberchef-step-name">${escapeHtml(op.name)}</span>${argsHtml}<span class="cyberchef-step-remove" data-cyberchef-remove="${i}" title="Remove">&times;</span></div>`;
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
    const btn = e.target.closest("[data-cyberchef-remove]");
    if (!btn) return;
    recipe.splice(Number(btn.dataset.cyberchefRemove), 1);
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
