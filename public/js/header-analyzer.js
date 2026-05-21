// header-analyzer.js — Email Header Analyzer for RedSecMiniTools
// Parses raw email headers and produces MXToolbox-style analysis

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

function badgeHtml(label, tone) {
  const cls = {
    green: "badge badge-green",
    red: "badge badge-red",
    amber: "badge badge-amber",
    gray: "badge badge-gray",
    blue: "badge badge-blue",
  };
  return `<span class="${cls[tone] || cls.gray}">${escapeHtml(label)}</span>`;
}

function checkRow(status, title, detail) {
  const tone = status === "ok" ? "green" : status === "warn" ? "amber" : status === "fail" ? "red" : "gray";
  const statusLabel = status === "ok" ? "Ok" : status === "warn" ? "Warning" : status === "fail" ? "Problem" : "Info";
  return `<div class="border border-border rounded p-3 bg-elevated">
    <div class="flex items-center gap-2 flex-wrap">
      ${badgeHtml(statusLabel, tone)}
      <h4 class="font-bold text-sm">${escapeHtml(title)}</h4>
    </div>
    ${detail ? `<p class="text-xs text-muted mt-2">${escapeHtml(detail)}</p>` : ""}
  </div>`;
}

// --- RFC 5322 Header Parsing ---

function parseHeaders(raw) {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === "") break;
    if (/^\s/.test(line) && headers.length) {
      headers[headers.length - 1].value += " " + line.trim();
    } else {
      const colon = line.indexOf(":");
      if (colon > 0) {
        headers.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
      }
    }
  }
  return headers;
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  return headers.find((h) => h.key.toLowerCase() === lower)?.value || "";
}

function getAllHeaders(headers, name) {
  const lower = name.toLowerCase();
  return headers.filter((h) => h.key.toLowerCase() === lower).map((h) => h.value);
}

// --- Received Header Parsing ---

function parseReceivedHeader(value) {
  const result = { from: "", by: "", with: "", via: "", id: "", date: "" };
  const dateMatch = value.match(/;\s*(.+)$/);
  if (dateMatch) {
    result.date = dateMatch[1].trim();
    value = value.slice(0, dateMatch.index).trim();
  }
  const fromMatch = value.match(/from\s+([^\s)]+(?:\s*\([^)]*\))?)/i);
  if (fromMatch) result.from = fromMatch[1].trim();
  const byMatch = value.match(/by\s+([^\s;)]+)/i);
  if (byMatch) result.by = byMatch[1].trim();
  const withMatch = value.match(/with\s+([^\s;)]+)/i);
  if (withMatch) result.with = withMatch[1].trim();
  const viaMatch = value.match(/via\s+([^\s;)]+)/i);
  if (viaMatch) result.via = viaMatch[1].trim();
  const idMatch = value.match(/\bid\s+([^\s;)]+)/i);
  if (idMatch) result.id = idMatch[1].trim();
  return result;
}

function parseDateSafe(dateStr) {
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function buildHopAnalysis(receivedHeaders) {
  const hops = receivedHeaders.map(parseReceivedHeader);
  for (let i = 0; i < hops.length; i++) {
    const dt = parseDateSafe(hops[i].date);
    hops[i].parsedDate = dt;
    hops[i].dateFormatted = dt ? dt.toISOString().replace("T", " ").slice(0, 19) : hops[i].date || "Unknown";
  }
  // Reverse so oldest-first for timeline readability
  hops.reverse();
  for (let i = 0; i < hops.length; i++) {
    if (i > 0 && hops[i].parsedDate && hops[i - 1].parsedDate) {
      const diff = Math.abs(hops[i].parsedDate - hops[i - 1].parsedDate) / 1000;
      hops[i].delaySec = diff;
      if (diff < 60) hops[i].delayFormatted = `${diff.toFixed(0)}s`;
      else if (diff < 3600) hops[i].delayFormatted = `${(diff / 60).toFixed(1)}m`;
      else hops[i].delayFormatted = `${(diff / 3600).toFixed(1)}h`;
    } else {
      hops[i].delayFormatted = "—";
    }
  }
  return hops;
}

// --- Authentication Parsing ---

function parseAuthResults(value) {
  const results = {};
  const parts = value.split(/;\s*/);
  for (const part of parts) {
    const trimmed = part.trim();
    const spfMatch = trimmed.match(/^spf=(\S+)/i);
    if (spfMatch) results.spf = spfMatch[1].toLowerCase();
    const dkimMatch = trimmed.match(/^dkim=(\S+)/i);
    if (dkimMatch) results.dkim = dkimMatch[1].toLowerCase();
    const dmarcMatch = trimmed.match(/^dmarc=(\S+)/i);
    if (dmarcMatch) results.dmarc = dmarcMatch[1].toLowerCase();
    const arcMatch = trimmed.match(/^arc=(\S+)/i);
    if (arcMatch) results.arc = arcMatch[1].toLowerCase();
    const dkimHeader = trimmed.match(/^header\.(?:i|from|d|s)=(\S+)/i);
    if (dkimHeader && !results.dkimHeaderFrom) results.dkimHeaderFrom = dkimHeader[1];
  }
  return results;
}

function parseReceivedSpf(value) {
  const result = { result: "", clientIp: "", envelopeFrom: "", receiver: "", mechanism: "" };
  const parts = value.split(/\s*;\s*/);
  for (const part of parts) {
    const kv = part.match(/^([a-z][\w-]*)=(.+)$/i);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === "result") result.result = kv[2].trim().toLowerCase();
      else if (key === "client-ip") result.clientIp = kv[2].trim();
      else if (key === "envelope-from") result.envelopeFrom = kv[2].trim();
      else if (key === "receiver") result.receiver = kv[2].trim();
      else if (key === "mechanism") result.mechanism = kv[2].trim();
    }
  }
  if (!result.result) {
    const firstWord = value.trim().split(/\s/)[0].toLowerCase();
    if (["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror"].includes(firstWord)) {
      result.result = firstWord;
    }
  }
  return result;
}

function parseDkimSignature(value) {
  const result = { domain: "", selector: "", algorithm: "", headers: "", bodyHash: "", canonicalization: "", expire: "", length: "" };
  const tags = value.split(/\s*;\s*/);
  const seenKeys = new Set();
  for (const tag of tags) {
    const eq = tag.indexOf("=");
    if (eq > 0) {
      const key = tag.slice(0, eq).trim().toLowerCase();
      const val = tag.slice(eq + 1).trim();
      if (seenKeys.has(key)) {
        result._duplicateTag = key;
      }
      seenKeys.add(key);
      if (key === "d") result.domain = val;
      else if (key === "s") result.selector = val;
      else if (key === "a") result.algorithm = val;
      else if (key === "h") result.headers = val;
      else if (key === "bh") result.bodyHash = val;
      else if (key === "c") result.canonicalization = val;
      else if (key === "x") result.expire = val;
      else if (key === "l") result.length = val;
    }
  }
  result._valid = !!(result.domain && result.selector && result.algorithm);
  return result;
}

// --- SPF Checks ---

function buildSpfChecks(auth, receivedSpf) {
  const checks = [];
  const result = auth.spf || receivedSpf?.result || "none";
  checks.push({
    status: result === "pass" ? "ok" : result === "none" ? "info" : result === "neutral" ? "info" : "fail",
    title: "SPF Record Lookup",
    detail: result === "pass"
      ? `SPF verified the sending IP is authorised to send on behalf of the domain.${receivedSpf?.clientIp ? ` Client IP: ${receivedSpf.clientIp}` : ""}`
      : result === "none"
        ? "No SPF result was found in the headers. The sending server may not have published an SPF record."
        : result === "neutral"
          ? "The SPF record explicitly returned neutral. The domain owner does not assert whether the IP is authorised."
          : `SPF check returned: ${result}. This may indicate unauthorised sending or a misconfigured SPF record.`,
  });
  if (receivedSpf?.clientIp) {
    checks.push({ status: "info", title: "SPF Client IP", detail: receivedSpf.clientIp });
  }
  if (receivedSpf?.envelopeFrom) {
    checks.push({ status: "info", title: "SPF Envelope-From", detail: receivedSpf.envelopeFrom });
  }
  if (receivedSpf?.mechanism) {
    checks.push({ status: "info", title: "SPF Matching Mechanism", detail: receivedSpf.mechanism });
  }
  return checks;
}

// --- DKIM Checks ---

function extractDomain(fromHeader) {
  if (!fromHeader) return "";
  const angleMatch = fromHeader.match(/<([^@>]+)@([^>]+)>/);
  if (angleMatch) return angleMatch[2].toLowerCase().trim();
  const bareMatch = fromHeader.match(/([^\s,;]+)@([^\s,;>]+)/);
  if (bareMatch) return bareMatch[2].toLowerCase().trim();
  return fromHeader.toLowerCase().trim();
}

function extractMailbox(headerValue) {
  if (!headerValue) return "";
  const angleMatch = headerValue.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();
  const bareMatch = headerValue.match(/([^\s,;]+@[^\s,;>]+)/);
  if (bareMatch) return bareMatch[1].trim().toLowerCase();
  return headerValue.trim().toLowerCase();
}

function buildDkimChecks(auth, dkimSig, fromHeader) {
  const checks = [];

  if (!dkimSig && !auth.dkim) {
    checks.push({ status: "info", title: "DKIM Signature", detail: "No DKIM-Signature header was found in the message." });
    return checks;
  }

  const dkimResult = auth.dkim || "none";
  const cryptoVerified = dkimResult === "pass";

  // DKIM-Signature present
  checks.push({
    status: dkimSig ? "ok" : "info",
    title: "DKIM-Signature Header Present",
    detail: dkimSig
      ? cryptoVerified
        ? `DKIM-Signature header found for domain "${dkimSig.domain}" with selector "${dkimSig.selector}". Authentication-Results confirm cryptographic pass.`
        : `DKIM-Signature header found for domain "${dkimSig.domain}" with selector "${dkimSig.selector}". Not cryptographically verified by this tool.`
      : "No DKIM-Signature header present.",
  });

  // Body hash
  if (dkimSig?.bodyHash) {
    checks.push({
      status: "info",
      title: "DKIM Signature Body Hash",
      detail: `Body hash (bh) tag is present: ${dkimSig.bodyHash.slice(0, 24)}${dkimSig.bodyHash.length > 24 ? "..." : ""}. Body hash verification requires the full message body, which is not available in a header-only analysis.`,
    });
  }

  // Syntax check
  checks.push({
    status: dkimSig?._valid ? "ok" : dkimSig ? "warn" : "info",
    title: "DKIM Syntax Check",
    detail: dkimSig?._valid
      ? "The DKIM-Signature header contains the required tags (d, s, a) and appears syntactically valid."
      : dkimSig
        ? "The DKIM-Signature header may be missing required tags (domain, selector, or algorithm)."
        : "No DKIM signature to validate.",
  });

  // Public key note
  checks.push({
    status: dkimSig?.selector ? "ok" : "info",
    title: "DKIM Public Key Lookup",
    detail: dkimSig?.selector
      ? `Selector "${dkimSig.selector}" is specified. The public key would be looked up at ${dkimSig.selector}._domainkey.${dkimSig.domain}. DNS lookup is not performed by this tool.`
      : "No selector tag found in the DKIM signature.",
  });

  // Signature syntax check
  if (dkimSig) {
    checks.push({
      status: cryptoVerified ? "ok" : dkimResult === "fail" ? "fail" : "warn",
      title: "DKIM Signature Validation",
      detail: cryptoVerified
        ? "The signature validated successfully against the message headers (per Authentication-Results)."
        : `Signature validation result: ${dkimResult}.`,
    });
  }

  // Identifier match
  if (dkimSig?.domain) {
    const fromDomain = extractDomain(fromHeader);
    checks.push({
      status: cryptoVerified ? "ok" : "info",
      title: "DKIM Signature Identifier Match",
      detail: `Signing domain: ${dkimSig.domain}${fromDomain ? `, Header From domain: ${fromDomain}` : ""}.`,
    });
  }

  // Alignment
  if (dkimSig?.domain) {
    const fromDomain = extractDomain(fromHeader);
    const dkimDomain = dkimSig.domain.toLowerCase().trim();
    const aligned = fromDomain === dkimDomain || fromDomain.endsWith(`.${dkimDomain}`) || dkimDomain.endsWith(`.${fromDomain}`);
    checks.push({
      status: aligned ? "ok" : "warn",
      title: "DKIM Signature Alignment",
      detail: aligned
        ? `The signing domain (${dkimDomain}) is aligned with the From header domain (${fromDomain || "unknown"}).`
        : `The signing domain (${dkimDomain}) does not align with the From header domain (${fromDomain || "unknown"}). This may affect DMARC pass.`,
    });
  }

  // Duplicate tags
  if (dkimSig?._duplicateTag) {
    checks.push({
      status: "warn",
      title: "DKIM Signature Duplicate Tags",
      detail: `Duplicate tag "${dkimSig._duplicateTag}" found in the DKIM-Signature header. Tags should be unique.`,
    });
  } else if (dkimSig) {
    checks.push({ status: "ok", title: "DKIM Signature Duplicate Tags", detail: "All signature tags are unique." });
  }

  // Expiration — x= is Unix epoch seconds, not a date string
  if (dkimSig?.expire) {
    const expTs = parseInt(dkimSig.expire, 10);
    if (!isNaN(expTs) && expTs > 0) {
      const expDate = new Date(expTs * 1000);
      const expired = expDate < new Date();
      checks.push({
        status: expired ? "fail" : "ok",
        title: "DKIM Signature Expiration",
        detail: expired
          ? `The signature expired at ${expDate.toISOString().replace("T", " ").slice(0, 19)} UTC.`
          : `The signature is valid until ${expDate.toISOString().replace("T", " ").slice(0, 19)} UTC.`,
      });
    } else {
      checks.push({ status: "warn", title: "DKIM Signature Expiration", detail: `Could not parse x= value: ${dkimSig.expire}` });
    }
  }

  // Algorithm
  if (dkimSig?.algorithm) {
    checks.push({
      status: dkimSig.algorithm.includes("sha256") || dkimSig.algorithm.includes("ed25519") ? "ok" : "warn",
      title: "DKIM Signing Algorithm",
      detail: `Algorithm: ${dkimSig.algorithm}${dkimSig.algorithm.includes("sha1") ? ". SHA-1 is deprecated; SHA-256 or Ed25519 is recommended." : ""}`,
    });
  }

  return checks;
}

// --- ARC Checks ---

function buildArcChecks(auth) {
  const checks = [];
  const result = auth.arc || "none";
  if (result === "none") return checks;
  checks.push({
    status: result === "pass" ? "ok" : result === "fail" ? "fail" : "warn",
    title: "ARC Result",
    detail: result === "pass"
      ? "ARC validation passed. The message passed through intermediary forwarding without breaking authentication."
      : `ARC check returned: ${result}.`,
  });
  return checks;
}

// --- DMARC Checks ---

function buildDmarcChecks(auth) {
  const checks = [];
  const result = auth.dmarc || "none";
  checks.push({
    status: result === "pass" ? "ok" : result === "none" ? "info" : "fail",
    title: "DMARC Policy Check",
    detail: result === "pass"
      ? "DMARC alignment check passed. The message satisfies both SPF and/or DKIM alignment with the From domain."
      : result === "none"
        ? "No DMARC result was found. The sending domain may not have a DMARC policy published."
        : `DMARC check returned: ${result}. The message did not pass DMARC alignment or policy evaluation.`,
  });
  return checks;
}

// --- Issue Detection ---

function detectIssues(headers, hops, auth) {
  const issues = [];
  if (!getHeader(headers, "date")) issues.push({ status: "warn", title: "Missing Date Header", detail: "The Date header is required by RFC 5322. Its absence may indicate a forged or malformed message." });
  if (hops.length > 5) issues.push({ status: "warn", title: "High Hop Count", detail: `${hops.length} hops detected. Excessive hops may indicate mail forwarding chains or routing issues.` });
  for (const hop of hops) {
    if (hop.delaySec && hop.delaySec > 3600) {
      issues.push({ status: "warn", title: "Large Hop Delay", detail: `Delay of ${hop.delayFormatted} detected between hops. This may indicate queuing or delivery issues.` });
      break;
    }
  }
  // Compare mailbox addresses, not raw header strings
  const fromAddr = getHeader(headers, "from");
  const replyTo = getHeader(headers, "reply-to");
  if (fromAddr && replyTo) {
    const fromMailbox = extractMailbox(fromAddr);
    const replyMailbox = extractMailbox(replyTo);
    if (fromMailbox && replyMailbox && fromMailbox !== replyMailbox) {
      issues.push({ status: "warn", title: "From / Reply-To Mismatch", detail: `From: ${fromMailbox} vs Reply-To: ${replyMailbox}. Differing addresses can indicate phishing.` });
    }
  }
  if (!auth.spf && !auth.dkim && !auth.dmarc) {
    issues.push({ status: "warn", title: "No Authentication Results", detail: "No SPF, DKIM, or DMARC results were found. The message origin cannot be verified." });
  }
  for (const hop of hops) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(hop.from)) {
      issues.push({ status: "warn", title: "Localhost Relay Detected", detail: `A Received hop shows relay from ${hop.from}. This may indicate an open relay or test environment.` });
      break;
    }
  }
  return issues;
}

// --- Score Computation ---

function computeScore(auth, issues) {
  let score = 0;
  let max = 0;
  if (auth.spf) { max += 25; if (auth.spf === "pass") score += 25; }
  if (auth.dkim) { max += 25; if (auth.dkim === "pass") score += 25; }
  if (auth.dmarc) { max += 25; if (auth.dmarc === "pass") score += 25; }
  if (max === 0) return { score: 0, max: 100, level: "warn", label: "No Auth Data" };
  max += 25;
  const warnCount = issues.length;
  score += Math.max(0, 25 - warnCount * 8);
  const pct = Math.round((score / max) * 100);
  let level, label;
  if (pct >= 80) { level = "green"; label = "Good"; }
  else if (pct >= 50) { level = "amber"; label = "Fair"; }
  else { level = "red"; label = "Poor"; }
  return { score: pct, max: 100, level, label };
}

// --- Full Analysis ---

function analyze(raw) {
  const headers = parseHeaders(raw);
  if (!headers.length) return null;

  const received = getAllHeaders(headers, "Received");
  const hops = buildHopAnalysis(received);

  const authResultsRaw = getHeader(headers, "Authentication-Results");
  const authResults = authResultsRaw ? parseAuthResults(authResultsRaw) : {};

  const receivedSpfRaw = getHeader(headers, "Received-SPF");
  const receivedSpf = receivedSpfRaw ? parseReceivedSpf(receivedSpfRaw) : null;

  const dkimSigRaw = getHeader(headers, "DKIM-Signature");
  const dkimSig = dkimSigRaw ? parseDkimSignature(dkimSigRaw) : null;

  if (!authResults.spf && receivedSpf?.result) authResults.spf = receivedSpf.result;
  if (!authResults.dkim && dkimSig?.domain) authResults.dkim = "signed";

  const metadata = {
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    replyTo: getHeader(headers, "Reply-To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    messageId: getHeader(headers, "Message-ID"),
    returnPath: getHeader(headers, "Return-Path"),
    xMailer: getHeader(headers, "X-Mailer"),
    xOriginatingIp: getHeader(headers, "X-Originating-IP"),
    mimeVersion: getHeader(headers, "MIME-Version"),
    contentType: getHeader(headers, "Content-Type"),
    listUnsubscribe: getHeader(headers, "List-Unsubscribe"),
  };

  const spfChecks = buildSpfChecks(authResults, receivedSpf);
  const dkimChecks = buildDkimChecks(authResults, dkimSig, metadata.from);
  const dmarcChecks = buildDmarcChecks(authResults);
  const arcChecks = buildArcChecks(authResults);
  const issues = detectIssues(headers, hops, authResults);
  const score = computeScore(authResults, issues);

  const rawAuthResults = authResultsRaw || "";
  const rawReceivedSpf = receivedSpfRaw || "";
  const rawDkimSignature = dkimSigRaw || "";

  return { headers, hops, authResults, receivedSpf, dkimSig, metadata, spfChecks, dkimChecks, dmarcChecks, arcChecks, issues, score, rawAuthResults, rawReceivedSpf, rawDkimSignature };
}

// --- Rendering ---

function copyBtnHtml(text, label) {
  const id = "ha-copy-" + Math.random().toString(36).slice(2, 8);
  return `<button type="button" class="btn-secondary text-xs" data-ha-copy-id="${id}" data-ha-copy="${escapeHtml(text)}">${escapeHtml(label)}</button>`;
}

function renderCheckGroup(title, checks, rawValue) {
  if (!checks.length) return "";
  const id = `ha-grp-${title.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`;
  const warnCount = checks.filter((c) => c.status === "warn" || c.status === "fail").length;
  const summaryTone = warnCount > 0 ? "red" : "green";
  return `<div class="card p-0 overflow-hidden">
    <button type="button" class="w-full flex items-center justify-between gap-2 p-4 text-left" data-ha-toggle="${id}" aria-expanded="false">
      <div class="flex items-center gap-2">
        ${badgeHtml(warnCount > 0 ? `${warnCount} issue${warnCount === 1 ? "" : "s"}` : "All pass", summaryTone)}
        <h3 class="font-bold text-sm">${escapeHtml(title)}</h3>
        <span class="text-xs text-muted">${checks.length} check${checks.length === 1 ? "" : "s"}</span>
      </div>
      <svg class="w-4 h-4 text-muted transition-transform ha-chevron-collapsed" data-ha-chevron="${id}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
    </button>
    <div id="${id}" class="px-4 pb-4 hidden">
      ${rawValue ? `<div class="mb-3"><code class="text-xs break-all text-muted block p-2 rounded border border-border bg-elevated">${escapeHtml(rawValue)}</code></div>` : ""}
      <div class="grid gap-3">
        ${checks.map((c) => checkRow(c.status, c.title, c.detail)).join("")}
      </div>
    </div>
  </div>`;
}

function renderAuthSummary(auth) {
  const items = [
    { label: "SPF", value: auth.spf || "none" },
    { label: "DKIM", value: auth.dkim || "none" },
    { label: "DMARC", value: auth.dmarc || "none" },
  ];
  if (auth.arc) items.push({ label: "ARC", value: auth.arc });
  return items.map((item) => {
    let tone = "gray";
    if (item.value === "pass") tone = "green";
    else if (["fail", "softfail", "permerror"].includes(item.value)) tone = "red";
    else if (item.value !== "none" && item.value !== "signed") tone = "amber";
    return `<div class="flex items-center justify-between gap-3 p-3 rounded border border-border bg-elevated">
      <span class="text-sm font-semibold">${item.label}</span>
      ${badgeHtml(item.value.toUpperCase(), tone)}
    </div>`;
  }).join("");
}

function renderHopTable(hops) {
  if (!hops.length) return '<p class="text-sm text-muted">No Received headers found.</p>';
  const rows = hops.map((hop, i) => {
    const delayTone = hop.delaySec > 3600 ? "amber" : "gray";
    return `<tr>
      <td class="text-xs text-muted font-mono">${i + 1}</td>
      <td class="text-xs font-mono">${escapeHtml(hop.from || "—")}</td>
      <td class="text-xs font-mono">${escapeHtml(hop.by || "—")}</td>
      <td class="text-xs">${escapeHtml(hop.with || "—")}</td>
      <td class="text-xs text-muted">${hop.dateFormatted}</td>
      <td class="text-xs">${badgeHtml(hop.delayFormatted, delayTone)}</td>
    </tr>`;
  }).join("");
  return `<div class="threat-table-wrap"><table class="threat-table">
    <thead><tr><th>#</th><th>From</th><th>By</th><th>Protocol</th><th>Date</th><th>Delay</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderAllHeadersTable(headers) {
  if (!headers.length) return '<p class="text-sm text-muted">No headers found.</p>';
  const rows = headers.map((h) => `<tr>
    <td class="text-xs text-muted whitespace-nowrap font-semibold">${escapeHtml(h.key)}</td>
    <td class="text-xs font-mono break-all">${escapeHtml(h.value)}</td>
  </tr>`).join("");
  return `<div class="threat-table-wrap"><table class="threat-table">
    <thead><tr><th>Header</th><th>Value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderAnalysis(result) {
  const scoreCls = result.score.level === "green" ? "ha-score-green" : result.score.level === "amber" ? "ha-score-amber" : "ha-score-red";

  // Build summary text for copy
  const summaryText = [
    "Header Trust Score: " + result.score.score + "/100 (" + result.score.label + ")",
    "SPF: " + (result.authResults.spf || "none").toUpperCase(),
    "DKIM: " + (result.authResults.dkim || "none").toUpperCase(),
    "DMARC: " + (result.authResults.dmarc || "none").toUpperCase(),
    result.authResults.arc ? "ARC: " + result.authResults.arc.toUpperCase() : "",
    "Hops: " + result.hops.length,
  ].filter(Boolean).join("\n");

  const authSummaryText = [
    "SPF: " + (result.authResults.spf || "none").toUpperCase(),
    "DKIM: " + (result.authResults.dkim || "none").toUpperCase(),
    "DMARC: " + (result.authResults.dmarc || "none").toUpperCase(),
    result.authResults.arc ? "ARC: " + result.authResults.arc.toUpperCase() : "",
  ].filter(Boolean).join("\n");

  const hopTimelineText = result.hops.map((hop, i) =>
    (i + 1) + ". " + (hop.from || "—") + " -> " + (hop.by || "—") + " [" + (hop.with || "?") + "] " + hop.dateFormatted + " delay:" + hop.delayFormatted
  ).join("\n");

  const metadataJson = JSON.stringify(result.metadata, null, 2);

  return `<div class="grid gap-4">
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-sm">Header Trust Score</h3>
        ${copyBtnHtml(summaryText, "Copy Summary")}
      </div>
      <div class="flex items-center gap-6 flex-wrap">
        <div class="text-center min-w-[80px]">
          <div class="text-3xl font-bold ${scoreCls}">${result.score.score}</div>
          <div class="text-muted text-sm">/100</div>
          <div class="text-sm font-semibold mt-1 ${scoreCls}">${escapeHtml(result.score.label)}</div>
        </div>
        <div class="flex-1 grid grid-cols-3 gap-2 min-w-[280px]">
          ${renderAuthSummary(result.authResults)}
        </div>
      </div>
    </div>

    ${renderCheckGroup("SPF Checks", result.spfChecks, result.rawReceivedSpf || result.rawAuthResults)}
    ${renderCheckGroup("DKIM Checks", result.dkimChecks, result.rawDkimSignature)}
    ${renderCheckGroup("DMARC Checks", result.dmarcChecks, result.rawAuthResults)}
    ${result.arcChecks.length ? renderCheckGroup("ARC Checks", result.arcChecks, result.rawAuthResults) : ""}
    ${result.issues.length ? renderCheckGroup("Warnings", result.issues) : ""}

    <div class="card p-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <h3 class="font-bold text-sm">Hop Analysis</h3>
          ${badgeHtml(`${result.hops.length} hop${result.hops.length === 1 ? "" : "s"}`, "gray")}
          <span class="text-xs text-muted">(oldest first)</span>
        </div>
        ${copyBtnHtml(hopTimelineText, "Copy Timeline")}
      </div>
      ${renderHopTable(result.hops)}
    </div>

    <div class="card p-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <h3 class="font-bold text-sm">All Headers</h3>
          ${badgeHtml(`${result.headers.length} header${result.headers.length === 1 ? "" : "s"}`, "gray")}
        </div>
        ${copyBtnHtml(metadataJson, "Copy Metadata JSON")}
      </div>
      ${renderAllHeadersTable(result.headers)}
    </div>
  </div>`;
}

// --- Sample Data ---

const SAMPLE_HEADERS = `Delivered-To: analyst@redsectools.com
Return-Path: <noreply@github.com>
Received: from outbound.github.com (outbound.github.com [192.30.252.203])
\tby mx.google.com with ESMTPS id abc123
\tfor <analyst@redsectools.com>
\tTue, 20 May 2025 14:32:10 +0000
Received-SPF: pass (google.com: domain of noreply@github.com designates 192.30.252.203 as permitted sender) client-ip=192.30.252.203;
Authentication-Results: mx.google.com;
\tdkim=pass header.i=@github.com;
\tspf=pass (google.com: domain of noreply@github.com designates 192.30.252.203 as permitted sender) smtp.mailfrom=noreply@github.com;
\tdmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=github.com
DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=github.com;
\ts=pf2014; t=1747749130;
\tbh=abc123def456=;
\tb=signedvalue123
Received: from filter.github.com (filter.github.com [10.0.0.1])
\tby outbound.github.com with ESMTP id def456
\tTue, 20 May 2025 14:32:08 +0000
From: GitHub <noreply@github.com>
To: analyst@redsectools.com
Subject: [RedSecTools] New security advisory published
Date: Tue, 20 May 2025 14:32:00 +0000
Message-ID: <abc123@github.com>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
X-Mailer: GitHub Notification Service`;

// --- Init ---

var _haInitialized = false;

function initHeaderAnalyzer() {
  if (_haInitialized) return;
  const inputEl = document.getElementById("header-analyzer-input");
  const analyzeBtn = document.getElementById("header-analyzer-btn");
  const sampleBtn = document.getElementById("header-analyzer-sample-btn");
  const clearBtn = document.getElementById("header-analyzer-clear-btn");
  const resultsEl = document.getElementById("header-analyzer-results");
  if (!inputEl || !analyzeBtn || !resultsEl) return;
  _haInitialized = true;

  analyzeBtn.addEventListener("click", () => {
    const raw = inputEl.value.trim();
    if (!raw) {
      resultsEl.innerHTML = '<div class="info-box text-sm mt-2">Paste email headers above to analyze.</div>';
      return;
    }
    const result = analyze(raw);
    if (!result) {
      resultsEl.innerHTML = '<div class="info-box text-sm mt-2">No valid headers found. Paste the raw email headers (everything above the blank line before the body).</div>';
      return;
    }
    resultsEl.innerHTML = renderAnalysis(result);
  });

  // Collapsible check group toggle + copy buttons
  resultsEl.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-ha-copy-id]");
    if (copyBtn) {
      navigator.clipboard.writeText(copyBtn.dataset.haCopy || "").catch(() => {});
      return;
    }
    const btn = e.target.closest("[data-ha-toggle]");
    if (!btn) return;
    const id = btn.dataset.haToggle;
    const body = document.getElementById(id);
    const chevron = document.querySelector(`[data-ha-chevron="${id}"]`);
    if (!body) return;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", !expanded);
    body.classList.toggle("hidden", expanded);
    if (chevron) chevron.classList.toggle("ha-chevron-collapsed", expanded);
  });

  sampleBtn.addEventListener("click", () => {
    inputEl.value = SAMPLE_HEADERS;
    resultsEl.innerHTML = "";
  });

  clearBtn.addEventListener("click", () => {
    inputEl.value = "";
    resultsEl.innerHTML = "";
  });
}

export { initHeaderAnalyzer };
