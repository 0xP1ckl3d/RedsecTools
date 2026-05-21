/**
 * JWT Analyzer / Editor — fully client-side JWT processing.
 * No JWT content is ever sent to the server.
 */

/* ---------- helpers ---------- */

function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function badgeHtml(tone, text) {
  const map = { green: "badge-green", red: "badge-red", amber: "badge-amber", gray: "badge-gray", blue: "badge-blue", purple: "badge-purple" };
  return '<span class="badge ' + (map[tone] || map.gray) + '">' + escapeHtml(text) + "</span>";
}

/* ---------- base64url ---------- */

function b64UrlDecode(str) {
  let b = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad) b += "=".repeat(4 - pad);
  try { return decodeURIComponent(escape(atob(b))); }
  catch { return atob(b); }
}

function textToB64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function bufToB64Url(buf) {
  const u8 = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64UrlToBuf(b64url) {
  let b = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad) b += "=".repeat(4 - pad);
  const bin = atob(b);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

function pemToSpki(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "").replace(/\s/g, "");
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

/* ---------- parse ---------- */

function parseJwt(raw) {
  const parts = raw.trim().split(".");
  if (parts.length === 5) throw new Error("JWE (encrypted JWT) detected — only JWS tokens are supported");
  if (parts.length < 2 || parts.length > 3) throw new Error("JWT must have 2 or 3 dot-separated parts");

  let header, payload;
  try { header = JSON.parse(b64UrlDecode(parts[0])); }
  catch (e) { throw new Error("Cannot decode header: " + e.message); }
  try { payload = JSON.parse(b64UrlDecode(parts[1])); }
  catch (e) { throw new Error("Cannot decode payload: " + e.message); }

  return { raw, headerB64: parts[0], payloadB64: parts[1], signatureB64: parts[2] || "", header, payload, parts: parts.length };
}

/* ---------- claim metadata ---------- */

const CLAIM_META = {
  iss:              { label: "Issuer",            type: "uri" },
  sub:              { label: "Subject",           type: "string" },
  aud:              { label: "Audience",          type: "uri" },
  exp:              { label: "Expires At",        type: "time" },
  nbf:              { label: "Not Before",        type: "time" },
  iat:              { label: "Issued At",         type: "time" },
  jti:              { label: "JWT ID",            type: "string" },
  scope:            { label: "Scope",             type: "scope" },
  scp:              { label: "Scope (scp)",       type: "scope" },
  roles:            { label: "Roles",             type: "list" },
  appid:            { label: "Application ID",    type: "string" },
  azp:              { label: "Authorized Party",  type: "string" },
  client_id:        { label: "Client ID",         type: "string" },
  tid:              { label: "Tenant ID",         type: "string" },
  tenant_id:        { label: "Tenant ID",         type: "string" },
  name:             { label: "Name",              type: "string" },
  email:            { label: "Email",             type: "string" },
  preferred_username: { label: "Username",        type: "string" },
  nonce:            { label: "Nonce",             type: "string" },
  at_hash:          { label: "Access Token Hash", type: "hash" },
  c_hash:           { label: "Code Hash",         type: "hash" },
  /* Entra / OAuth claims */
  oid:              { label: "Object ID",         type: "string" },
  upn:              { label: "User Principal Name", type: "string" },
  unique_name:      { label: "Unique Name",       type: "string" },
  appidacr:         { label: "App Auth Context",  type: "string" },
  acr:              { label: "Auth Context Ref",  type: "string" },
  amr:              { label: "Auth Methods",      type: "list" },
  ver:              { label: "Token Version",     type: "string" },
  idp:              { label: "Identity Provider", type: "string" },
  groups:           { label: "Groups",            type: "list" },
  wids:             { label: "Directory Role Template IDs", type: "list" },
  ipaddr:           { label: "IP Address",        type: "string" },
  deviceid:         { label: "Device ID",         type: "string" },
  onprem_sid:       { label: "On-Prem SID",       type: "string" },
};

function fmtDuration(s) {
  if (s < 60) return Math.round(s) + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

function interpretClaim(key, value) {
  const meta = CLAIM_META[key];
  if (!meta) return "";
  if (meta.type === "time") {
    const ts = typeof value === "number" ? value : parseInt(value, 10);
    if (isNaN(ts)) return "Invalid timestamp";
    const d = new Date(ts * 1000);
    const formatted = d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    const diff = ts - Date.now() / 1000;
    const rel = diff > 0 ? "in " + fmtDuration(diff) : fmtDuration(-diff) + " ago";
    return formatted + " (" + rel + ")";
  }
  if (meta.type === "scope") return String(value).split(/[\s,]+/).join(", ");
  if (meta.type === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  return "";
}

/* ---------- time analysis ---------- */

function analyzeTimestamps(payload) {
  const out = [];
  const now = Date.now() / 1000;

  if (payload.exp !== undefined) {
    const exp = typeof payload.exp === "number" ? payload.exp : parseFloat(payload.exp);
    if (!isNaN(exp)) {
      if (exp < now) out.push({ status: "expired", msg: "Token expired " + fmtDuration(now - exp) + " ago", tone: "red" });
      else out.push({ status: "valid", msg: "Not expired — expires in " + fmtDuration(exp - now), tone: "green" });
      if (payload.iat && typeof payload.iat === "number") {
        const life = exp - payload.iat;
        if (life > 86400 * 365) out.push({ status: "long-expiry", msg: "Token validity is " + fmtDuration(life) + " (> 1 year)", tone: "amber" });
      }
    }
  } else {
    out.push({ status: "no-exp", msg: "No expiration (exp) claim — token never expires", tone: "amber" });
  }

  if (payload.nbf !== undefined) {
    const nbf = typeof payload.nbf === "number" ? payload.nbf : parseFloat(payload.nbf);
    if (!isNaN(nbf) && nbf > now) out.push({ status: "not-yet-valid", msg: "Token not valid for another " + fmtDuration(nbf - now), tone: "amber" });
  }
  return out;
}

/* ---------- security analysis ---------- */

function analyzeSecurity(header, payload) {
  const out = [];
  const alg = (header.alg || "").toLowerCase();

  if (alg === "none") out.push({ sev: "critical", msg: "Algorithm is 'none' — token is unsigned and cannot be trusted", tone: "red" });

  const known = ["hs256","hs384","hs512","rs256","rs384","rs512","es256","es384","es512","ps256","ps384","ps512","eddsa","ed25519","none"];
  if (alg && !known.includes(alg)) out.push({ sev: "warning", msg: "Uncommon algorithm: " + header.alg, tone: "amber" });

  if (alg.startsWith("hs")) out.push({ sev: "info", msg: "Algorithm " + header.alg + " uses HMAC — verification requires the actual shared secret, not a public key", tone: "blue" });

  if (payload.exp === undefined) out.push({ sev: "warning", msg: "Missing exp claim — token has no expiration", tone: "amber" });
  if (payload.aud === undefined) out.push({ sev: "info", msg: "Missing aud claim — no audience restriction", tone: "blue" });

  if (payload.exp !== undefined && payload.iat !== undefined) {
    const exp = typeof payload.exp === "number" ? payload.exp : parseFloat(payload.exp);
    const iat = typeof payload.iat === "number" ? payload.iat : parseFloat(payload.iat);
    if (!isNaN(exp) && !isNaN(iat) && (exp - iat) > 86400 * 90)
      out.push({ sev: "warning", msg: "Token lifespan is " + fmtDuration(exp - iat) + " — consider shorter-lived tokens", tone: "amber" });
  }

  if (payload.iss && payload.aud) {
    try {
      const issD = new URL(payload.iss).hostname;
      const audS = Array.isArray(payload.aud) ? payload.aud[0] : String(payload.aud);
      const audD = new URL(audS).hostname;
      if (issD && audD && issD !== audD) out.push({ sev: "info", msg: "Issuer (" + issD + ") and audience (" + audD + ") domains differ", tone: "blue" });
    } catch { /* not URLs */ }
  }

  out.push({ sev: "info", msg: "Decoding a JWT does not verify its signature or establish trust — verification requires a known secret or public key", tone: "gray" });
  return out;
}

/* ---------- signature verification ---------- */

function hmacHash(alg) { return { hs256: "SHA-256", hs384: "SHA-384", hs512: "SHA-512" }[alg.toLowerCase()] || null; }
function rsaParams(alg) {
  return { rs256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, rs384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, rs512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, ps256: { name: "RSA-PSS", hash: "SHA-256" }, ps384: { name: "RSA-PSS", hash: "SHA-384" }, ps512: { name: "RSA-PSS", hash: "SHA-512" } }[alg.toLowerCase()] || null;
}
function ecParams(alg) {
  return { es256: { name: "ECDSA", namedCurve: "P-256" }, es384: { name: "ECDSA", namedCurve: "P-384" }, es512: { name: "ECDSA", namedCurve: "P-521" } }[alg.toLowerCase()] || null;
}

async function verifyHmac(token, secret, hashName) {
  const parts = token.split(".");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: hashName }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(parts[0] + "." + parts[1]));
  return bufToB64Url(sig) === parts[2];
}

async function verifyPublicKey(token, pemOrJwk, alg) {
  const parts = token.split(".");
  const message = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const signature = b64UrlToBuf(parts[2]);
  let key;

  if (typeof pemOrJwk === "string" && pemOrJwk.trim().startsWith("{")) {
    const jwk = JSON.parse(pemOrJwk);
    const rp = rsaParams(alg) || ecParams(alg);
    if (!rp) throw new Error("Unsupported algorithm for JWK: " + alg);
    key = await crypto.subtle.importKey("jwk", jwk, rp, false, ["verify"]);
  } else {
    const spki = pemToSpki(pemOrJwk);
    const rp = rsaParams(alg);
    if (rp) { key = await crypto.subtle.importKey("spki", spki, rp, false, ["verify"]); }
    else {
      const ep = ecParams(alg);
      if (!ep) throw new Error("Unsupported algorithm for PEM: " + alg);
      key = await crypto.subtle.importKey("spki", spki, ep, false, ["verify"]);
    }
  }

  const rp = rsaParams(alg);
  if (rp) return crypto.subtle.verify(rsaParams(alg), key, signature, message);
  const ecMap = { es256: "SHA-256", es384: "SHA-384", es512: "SHA-512" };
  return crypto.subtle.verify({ name: "ECDSA", hash: ecMap[alg.toLowerCase()] || "SHA-256" }, key, signature, message);
}

/* ---------- copy ---------- */

function copyText(text) { navigator.clipboard.writeText(text).catch(() => {}); }

/* ---------- sample JWT — dynamic expiry so sample is never stale ---------- */

function buildSampleJwt() {
  const now = Math.floor(Date.now() / 1000);
  const hdr = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const pld = JSON.stringify({ iss: "https://auth.example.com", sub: "user-42", aud: "https://api.example.com", exp: now + 3600, iat: now - 1000, nbf: now - 1000, jti: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", scope: "read write admin", roles: ["admin", "editor"], appid: "app-42-demo", tid: "tenant-23456", name: "Jane Smith", email: "jane@example.com" });
  return textToB64Url(hdr) + "." + textToB64Url(pld) + ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
}

/* ---------- text summary ---------- */

function buildSummary(parsed) {
  const alg = parsed.header.alg || "none";
  const lines = ["JWT Analysis Summary", "=".repeat(40), "Algorithm: " + alg, "Type: " + (parsed.header.typ || "JWT"), ""];
  analyzeTimestamps(parsed.payload).forEach(f => lines.push("Time: " + f.status + " — " + f.msg));
  lines.push("");
  analyzeSecurity(parsed.header, parsed.payload).forEach(f => lines.push("[" + f.sev.toUpperCase() + "] " + f.msg));
  lines.push("", "Claims:");
  Object.entries(parsed.payload).forEach(([k, v]) => {
    const interp = interpretClaim(k, v);
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push("  " + k + ": " + val + (interp ? " (" + interp + ")" : ""));
  });
  return lines.join("\n");
}

/* ---------- color-coded token html ---------- */

function colorTokenHtml(hB64, pB64, sB64) {
  return '<span class="jwt-color-header">' + escapeHtml(hB64) + '</span>' +
    '<span class="jwt-color-dot">.</span>' +
    '<span class="jwt-color-payload">' + escapeHtml(pB64) + '</span>' +
    (sB64 ? '<span class="jwt-color-dot">.</span><span class="jwt-color-signature">' + escapeHtml(sB64) + '</span>' : "");
}

/* ---------- render ---------- */

function renderResults(container, parsed) {
  const alg = parsed.header.alg || "none";
  const typ = parsed.header.typ || "JWT";
  const timeFindings = analyzeTimestamps(parsed.payload);
  const secFindings = analyzeSecurity(parsed.header, parsed.payload);
  const timeBadge = timeFindings[0] || { tone: "gray", status: "unknown" };
  const statusLabel = { expired: "Expired", valid: "Not Expired", "no-exp": "No Expiry", "not-yet-valid": "Not Yet Valid" }[timeBadge.status] || "Unknown";

  const hdrJson = JSON.stringify(parsed.header, null, 2);
  const pldJson = JSON.stringify(parsed.payload, null, 2);

  /* claims table rows */
  let claimRows = "";
  for (const [k, v] of Object.entries(parsed.payload)) {
    const interp = interpretClaim(k, v);
    const meta = CLAIM_META[k];
    const dispVal = typeof v === "object" ? JSON.stringify(v) : String(v);
    const label = meta ? badgeHtml("blue", meta.label) : '<span class="opacity-70">' + escapeHtml(k) + "</span>";
    const interpCell = interp ? escapeHtml(interp) : '<span class="opacity-50">—</span>';
    claimRows += "<tr><td>" + label + "</td><td class=\"jwt-mono\">" + escapeHtml(dispVal) + "</td><td>" + interpCell + "</td></tr>";
  }

  /* time findings */
  let timeHtml = "";
  timeFindings.forEach(f => { timeHtml += '<div class="mb-2">' + badgeHtml(f.tone, f.status) + ' <span class="ml-2">' + escapeHtml(f.msg) + "</span></div>"; });

  /* security findings */
  let secHtml = "";
  secFindings.forEach(f => { secHtml += '<div class="mb-2">' + badgeHtml(f.tone, f.sev) + ' <span class="ml-2">' + escapeHtml(f.msg) + "</span></div>"; });

  container.innerHTML =
    /* summary */
    '<div class="card p-4 mb-4">' +
      '<h3 class="text-lg font-semibold mb-3">Token Summary</h3>' +
      '<div class="jwt-summary-grid">' +
        '<div><span class="text-sm opacity-70">Algorithm</span><br><span class="jwt-mono">' + escapeHtml(alg) + "</span></div>" +
        '<div><span class="text-sm opacity-70">Type</span><br><span class="jwt-mono">' + escapeHtml(typ) + "</span></div>" +
        "<div><span class=\"text-sm opacity-70\">Structure</span><br>" + (parsed.parts === 3 ? badgeHtml("green", "JWS (3 parts)") : badgeHtml("amber", "Unsigned / no signature segment")) + "</div>" +
        "<div><span class=\"text-sm opacity-70\">Time Status</span><br>" + badgeHtml(timeBadge.tone, statusLabel) + "</div>" +
      "</div>" +
    "</div>" +

    /* color-coded encoded token */
    '<div class="card p-4 mb-4">' +
      '<h3 class="text-lg font-semibold mb-3">Encoded Token</h3>' +
      '<div class="jwt-token-display">' + colorTokenHtml(parsed.headerB64, parsed.payloadB64, parsed.signatureB64) + "</div>" +
      '<div class="jwt-legend">' +
        '<span class="jwt-legend-item"><span class="jwt-legend-swatch jwt-swatch-header"></span> Header</span>' +
        '<span class="jwt-legend-item"><span class="jwt-legend-swatch jwt-swatch-payload"></span> Payload</span>' +
        '<span class="jwt-legend-item"><span class="jwt-legend-swatch jwt-swatch-signature"></span> Signature</span>' +
      "</div>" +
    "</div>" +

    /* decoded editors */
    '<div class="jwt-editor-grid mb-4">' +
      '<div class="card p-4">' +
        '<div class="flex items-center justify-between mb-2">' +
          '<h3 class="text-lg font-semibold">Header</h3>' +
          '<button type="button" class="btn-secondary text-xs" data-jwt-copy="header">Copy</button>' +
        "</div>" +
        '<textarea id="jwt-edit-header" class="jwt-editor" rows="14">' + escapeHtml(hdrJson) + "</textarea>" +
      "</div>" +
      '<div class="card p-4">' +
        '<div class="flex items-center justify-between mb-2">' +
          '<h3 class="text-lg font-semibold">Payload</h3>' +
          '<button type="button" class="btn-secondary text-xs" data-jwt-copy="payload">Copy</button>' +
        "</div>" +
        '<textarea id="jwt-edit-payload" class="jwt-editor" rows="14">' + escapeHtml(pldJson) + "</textarea>" +
      "</div>" +
    "</div>" +

    /* dynamic rebuilt token — directly below editors */
    '<div class="card p-4 mb-4">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h3 class="text-lg font-semibold">Rebuilt Token</h3>' +
        '<button type="button" class="btn-secondary text-xs" data-jwt-copy="rebuilt">Copy</button>' +
      "</div>" +
      '<div class="flex items-center gap-3 mb-2">' +
        '<label class="custom-checkbox gap-2 text-xs"><input type="checkbox" id="jwt-preserve-sig"><span class="checkmark"><svg viewBox="0 0 12 12"><polyline points="2 6 5 9 10 3"/></svg></span><span>Preserve original signature</span></label>' +
        '<span class="text-xs opacity-50">Signature will be invalid if header or payload changed</span>' +
      "</div>" +
      '<div class="jwt-rebuilt-bar">' +
        '<div id="jwt-rebuilt-display" class="jwt-token-display"></div>' +
        '<span id="jwt-rebuilt-badge" class="jwt-rebuilt-warn hidden">Edited / Unverified</span>' +
      "</div>" +
    "</div>" +

    /* claims table */
    '<div class="card p-4 mb-4">' +
      '<h3 class="text-lg font-semibold mb-3">Claims Analysis</h3>' +
      '<div class="overflow-x-auto"><table class="threat-table"><thead><tr><th>Claim</th><th>Value</th><th>Interpretation</th></tr></thead><tbody>' + claimRows + "</tbody></table></div>" +
    "</div>" +

    /* time */
    (timeHtml ? '<div class="card p-4 mb-4"><h3 class="text-lg font-semibold mb-3">Time Analysis</h3>' + timeHtml + "</div>" : "") +

    /* security */
    '<div class="card p-4 mb-4"><h3 class="text-lg font-semibold mb-3">Security Observations</h3>' + secHtml + "</div>" +

    /* verification */
    '<div class="card p-4 mb-4">' +
      '<h3 class="text-lg font-semibold mb-3">Signature Verification</h3>' +
      '<div class="info-box info-box-amber mb-3">Decoded tokens are untrusted unless signature verification succeeds with the expected key.</div>' +
      '<textarea id="jwt-verify-key" class="jwt-editor" rows="3" placeholder="HMAC secret, PEM public key, or JWK JSON"></textarea>' +
      '<div class="mt-3"><button type="button" id="jwt-verify-btn" class="btn-primary">Verify Signature</button></div>' +
      '<div id="jwt-verify-result" class="mt-3"></div>' +
    "</div>" +

    /* copy summary */
    '<div class="card p-4 mb-4"><div class="flex items-center justify-between">' +
      '<h3 class="text-lg font-semibold">Analysis Summary</h3>' +
      '<button type="button" class="btn-secondary text-xs" data-jwt-copy="summary">Copy Summary</button>' +
    "</div></div>";

  wireEvents(container, parsed);
}

/* ---------- event wiring ---------- */

function rebuildLive(parsed) {
  var hdrTa = document.getElementById("jwt-edit-header");
  var pldTa = document.getElementById("jwt-edit-payload");
  var display = document.getElementById("jwt-rebuilt-display");
  var badge = document.getElementById("jwt-rebuilt-badge");
  var chk = document.getElementById("jwt-preserve-sig");
  if (!hdrTa || !pldTa || !display || !badge) return;

  try {
    var hdrObj = JSON.parse(hdrTa.value);
    var pldObj = JSON.parse(pldTa.value);
    var newH = textToB64Url(JSON.stringify(hdrObj));
    var newP = textToB64Url(JSON.stringify(pldObj));
    var sig = (chk && chk.checked) ? parsed.signatureB64 : "";
    display.innerHTML = colorTokenHtml(newH, newP, sig);

    var rebuilt = newH + "." + newP + (sig ? "." + sig : "");
    if (rebuilt !== parsed.raw) badge.classList.remove("hidden");
    else badge.classList.add("hidden");
  } catch {
    display.innerHTML = '<span class="opacity-50">Invalid JSON in editor</span>';
    badge.classList.remove("hidden");
  }
}

function wireEvents(container, parsed) {
  /* copy buttons */
  container.querySelectorAll("[data-jwt-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var t = btn.getAttribute("data-jwt-copy");
      if (t === "header") { var el = document.getElementById("jwt-edit-header"); if (el) copyText(el.value); }
      else if (t === "payload") { var el = document.getElementById("jwt-edit-payload"); if (el) copyText(el.value); }
      else if (t === "rebuilt") {
        var display = document.getElementById("jwt-rebuilt-display");
        if (display) copyText(display.textContent);
      }
      else if (t === "summary") { copyText(buildSummary(parsed)); }
    });
  });

  /* live rebuild on editor input */
  var hdrTa = document.getElementById("jwt-edit-header");
  var pldTa = document.getElementById("jwt-edit-payload");
  var chk = document.getElementById("jwt-preserve-sig");
  if (hdrTa) hdrTa.addEventListener("input", function () { rebuildLive(parsed); });
  if (pldTa) pldTa.addEventListener("input", function () { rebuildLive(parsed); });
  if (chk) chk.addEventListener("change", function () { rebuildLive(parsed); });

  /* initial render — no signature by default */
  rebuildLive(parsed);

  /* signature verification */
  var verifyBtn = document.getElementById("jwt-verify-btn");
  if (verifyBtn) {
    verifyBtn.addEventListener("click", function () {
      var keyInput = document.getElementById("jwt-verify-key");
      var resultEl = document.getElementById("jwt-verify-result");
      if (!keyInput || !resultEl) return;
      var key = keyInput.value.trim();
      if (!key) { resultEl.innerHTML = '<div class="info-box info-box-amber">Please enter a secret or public key</div>'; return; }
      var alg = (parsed.header.alg || "").toLowerCase();
      if (alg === "none") { resultEl.innerHTML = '<div class="info-box info-box-red">' + badgeHtml("red", "FAIL") + " Token uses alg:none — no signature to verify</div>"; return; }

      var hh = hmacHash(alg);
      var promise;
      if (hh) { promise = verifyHmac(parsed.raw, key, hh); }
      else { promise = verifyPublicKey(parsed.raw, key, alg); }

      promise.then(function (ok) {
        if (ok) resultEl.innerHTML = '<div class="info-box info-box-green">' + badgeHtml("green", "VALID") + " Signature verified with " + escapeHtml(alg.toUpperCase()) + "</div>";
        else resultEl.innerHTML = '<div class="info-box info-box-red">' + badgeHtml("red", "INVALID") + " Signature does not match</div>";
      }).catch(function (e) {
        resultEl.innerHTML = '<div class="info-box info-box-amber">' + badgeHtml("amber", "ERROR") + " " + escapeHtml(e.message) + "</div>";
      });
    });
  }
}

/* ---------- init ---------- */

function syncInputColors(input, backdrop) {
  var raw = input.value;
  if (!raw.trim()) { backdrop.innerHTML = ""; return; }
  var parts = raw.trim().split(".");
  if (parts.length >= 2 && parts.length <= 3) {
    backdrop.innerHTML = colorTokenHtml(parts[0], parts[1], parts[2] || "") + "\n";
  } else {
    backdrop.innerHTML = escapeHtml(raw) + (raw.endsWith("\n") ? "" : "\n");
  }
}

var _jwtInitialized = false;

export function initJwtAnalyzer() {
  if (_jwtInitialized) return;
  var input = document.getElementById("jwt-input");
  var analyzeBtn = document.getElementById("jwt-analyze-btn");
  var clearBtn = document.getElementById("jwt-clear-btn");
  var sampleBtn = document.getElementById("jwt-sample-btn");
  var results = document.getElementById("jwt-results");
  if (!input || !analyzeBtn || !results) return;
  _jwtInitialized = true;

  /* wrap textarea with color overlay */
  var wrapper = document.createElement("div");
  wrapper.className = "jwt-input-wrap";
  input.parentNode.insertBefore(wrapper, input);
  var backdrop = document.createElement("div");
  backdrop.className = "jwt-input-backdrop";
  backdrop.id = "jwt-input-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  wrapper.appendChild(backdrop);
  wrapper.appendChild(input);

  input.addEventListener("input", function () { syncInputColors(input, backdrop); });
  input.addEventListener("scroll", function () { backdrop.scrollTop = input.scrollTop; backdrop.scrollLeft = input.scrollLeft; });
  syncInputColors(input, backdrop);

  analyzeBtn.addEventListener("click", function () {
    var raw = input.value.trim();
    if (!raw) return;
    try { renderResults(results, parseJwt(raw)); }
    catch (e) { results.innerHTML = '<div class="info-box info-box-red"><p>Invalid JWT: ' + escapeHtml(e.message) + "</p></div>"; }
  });

  clearBtn.addEventListener("click", function () { input.value = ""; results.innerHTML = ""; syncInputColors(input, backdrop); });

  sampleBtn.addEventListener("click", function () { input.value = buildSampleJwt(); syncInputColors(input, backdrop); });
}
