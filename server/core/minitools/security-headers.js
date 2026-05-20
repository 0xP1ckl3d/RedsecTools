const SECURITY_HEADER_FIXES = Object.freeze({
  "strict-transport-security": "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
  "content-security-policy": "Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "x-frame-options": "X-Frame-Options: DENY",
  "x-content-type-options": "X-Content-Type-Options: nosniff",
  "referrer-policy": "Referrer-Policy: strict-origin-when-cross-origin",
  "permissions-policy": "Permissions-Policy: camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "Cross-Origin-Opener-Policy: same-origin",
  "cross-origin-resource-policy": "Cross-Origin-Resource-Policy: same-origin",
});

function parseRawHeaders(rawHeaders) {
  const headers = {};
  const order = [];
  for (const rawLine of String(rawHeaders || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^HTTP\/\d(?:\.\d)?\s+\d{3}/i.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    if (!headers[key]) {
      headers[key] = [];
      order.push(key);
    }
    headers[key].push(value);
  }
  return { headers, order };
}

function headersObjectFromFetchHeaders(fetchHeaders) {
  const headers = {};
  const order = [];
  for (const [key, value] of fetchHeaders.entries()) {
    const normalized = key.toLowerCase();
    if (!headers[normalized]) {
      headers[normalized] = [];
      order.push(normalized);
    }
    headers[normalized].push(value);
  }
  return { headers, order };
}

function headerValue(headers, name) {
  return (headers[name] || []).join(", ");
}

function hasDirective(value, directive) {
  return new RegExp(`(?:^|;)\\s*${directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value || "");
}

function maxAgeSeconds(value) {
  const match = String(value || "").match(/max-age\s*=\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function finding({ status, weight, header, title, observed = "", recommendation, fix = "" }) {
  return { status, weight, header, title, observed, recommendation, fix };
}

function analyzeSecurityHeaders(inputHeaders) {
  const headers = inputHeaders?.headers || {};
  const findings = [];

  const hsts = headerValue(headers, "strict-transport-security");
  if (!hsts) {
    findings.push(finding({
      status: "fail",
      weight: 14,
      header: "Strict-Transport-Security",
      title: "HSTS is missing",
      recommendation: "Send HSTS on HTTPS responses so browsers remember to use HTTPS.",
      fix: SECURITY_HEADER_FIXES["strict-transport-security"],
    }));
  } else if (maxAgeSeconds(hsts) < 15552000 || !/includesubdomains/i.test(hsts)) {
    findings.push(finding({
      status: "warn",
      weight: 7,
      header: "Strict-Transport-Security",
      title: "HSTS is present but could be stronger",
      observed: hsts,
      recommendation: "Use a long max-age and includeSubDomains when every subdomain supports HTTPS.",
      fix: SECURITY_HEADER_FIXES["strict-transport-security"],
    }));
  } else {
    findings.push(finding({ status: "pass", weight: 0, header: "Strict-Transport-Security", title: "HSTS is configured", observed: hsts, recommendation: "Keep this policy aligned with HTTPS coverage." }));
  }

  const csp = headerValue(headers, "content-security-policy");
  if (!csp) {
    findings.push(finding({
      status: "fail",
      weight: 18,
      header: "Content-Security-Policy",
      title: "Content Security Policy is missing",
      recommendation: "Define a CSP to limit script, object, frame, and base URI abuse.",
      fix: SECURITY_HEADER_FIXES["content-security-policy"],
    }));
  } else {
    const weakCsp = /'unsafe-inline'|'unsafe-eval'|\*/i.test(csp) || !hasDirective(csp, "object-src") || !hasDirective(csp, "base-uri");
    findings.push(finding({
      status: weakCsp ? "warn" : "pass",
      weight: weakCsp ? 9 : 0,
      header: "Content-Security-Policy",
      title: weakCsp ? "CSP is present but has weak directives" : "CSP is configured",
      observed: csp,
      recommendation: weakCsp ? "Avoid unsafe script directives and include object-src plus base-uri restrictions." : "Review CSP whenever frontend asset origins change.",
      fix: weakCsp ? SECURITY_HEADER_FIXES["content-security-policy"] : "",
    }));
  }

  const frameAncestors = csp && hasDirective(csp, "frame-ancestors");
  const xfo = headerValue(headers, "x-frame-options");
  if (!frameAncestors && !xfo) {
    findings.push(finding({
      status: "fail",
      weight: 10,
      header: "X-Frame-Options / CSP frame-ancestors",
      title: "Clickjacking protection is missing",
      recommendation: "Use CSP frame-ancestors or X-Frame-Options to control who can embed the app.",
      fix: SECURITY_HEADER_FIXES["x-frame-options"],
    }));
  } else {
    findings.push(finding({ status: "pass", weight: 0, header: "X-Frame-Options / CSP frame-ancestors", title: "Clickjacking protection is configured", observed: frameAncestors ? "CSP frame-ancestors" : xfo, recommendation: "Prefer CSP frame-ancestors for modern policy control." }));
  }

  const nosniff = headerValue(headers, "x-content-type-options");
  findings.push(nosniff.toLowerCase() === "nosniff"
    ? finding({ status: "pass", weight: 0, header: "X-Content-Type-Options", title: "MIME sniffing protection is configured", observed: nosniff, recommendation: "Keep nosniff enabled." })
    : finding({ status: "fail", weight: 8, header: "X-Content-Type-Options", title: "MIME sniffing protection is missing", observed: nosniff, recommendation: "Send nosniff to stop browsers guessing content types.", fix: SECURITY_HEADER_FIXES["x-content-type-options"] }));

  const referrer = headerValue(headers, "referrer-policy").toLowerCase();
  const strongReferrer = ["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin"].includes(referrer);
  findings.push(strongReferrer
    ? finding({ status: "pass", weight: 0, header: "Referrer-Policy", title: "Referrer policy is configured", observed: referrer, recommendation: "Keep the policy aligned with analytics and cross-origin needs." })
    : finding({ status: referrer ? "warn" : "fail", weight: referrer ? 4 : 7, header: "Referrer-Policy", title: referrer ? "Referrer policy could leak more than necessary" : "Referrer policy is missing", observed: referrer, recommendation: "Use strict-origin-when-cross-origin or a stricter policy.", fix: SECURITY_HEADER_FIXES["referrer-policy"] }));

  const permissions = headerValue(headers, "permissions-policy");
  findings.push(permissions
    ? finding({ status: "pass", weight: 0, header: "Permissions-Policy", title: "Browser feature policy is configured", observed: permissions, recommendation: "Keep disabled capabilities explicit and minimal." })
    : finding({ status: "warn", weight: 5, header: "Permissions-Policy", title: "Permissions policy is missing", recommendation: "Disable unused browser capabilities such as camera, microphone, and geolocation.", fix: SECURITY_HEADER_FIXES["permissions-policy"] }));

  const coop = headerValue(headers, "cross-origin-opener-policy");
  findings.push(coop
    ? finding({ status: "pass", weight: 0, header: "Cross-Origin-Opener-Policy", title: "COOP is configured", observed: coop, recommendation: "Keep cross-origin isolation behavior intentional." })
    : finding({ status: "warn", weight: 3, header: "Cross-Origin-Opener-Policy", title: "COOP is missing", recommendation: "Consider same-origin for apps that do not need opener access.", fix: SECURITY_HEADER_FIXES["cross-origin-opener-policy"] }));

  const corp = headerValue(headers, "cross-origin-resource-policy");
  findings.push(corp
    ? finding({ status: "pass", weight: 0, header: "Cross-Origin-Resource-Policy", title: "CORP is configured", observed: corp, recommendation: "Keep resource sharing intentional." })
    : finding({ status: "warn", weight: 3, header: "Cross-Origin-Resource-Policy", title: "CORP is missing", recommendation: "Consider same-origin or same-site for non-public resources.", fix: SECURITY_HEADER_FIXES["cross-origin-resource-policy"] }));

  const cookies = headers["set-cookie"] || [];
  if (cookies.length) {
    const weakCookies = cookies.filter((cookie) => !/;\s*secure/i.test(cookie) || !/;\s*httponly/i.test(cookie) || !/;\s*samesite=/i.test(cookie));
    findings.push(weakCookies.length
      ? finding({ status: "warn", weight: Math.min(10, weakCookies.length * 3), header: "Set-Cookie", title: "Some cookies are missing security attributes", observed: `${weakCookies.length}/${cookies.length} cookie(s) missing Secure, HttpOnly, or SameSite`, recommendation: "Set Secure, HttpOnly, and SameSite on session and sensitive cookies.", fix: "Set-Cookie: session=<value>; Secure; HttpOnly; SameSite=Lax" })
      : finding({ status: "pass", weight: 0, header: "Set-Cookie", title: "Cookies include core security attributes", observed: `${cookies.length} cookie(s) checked`, recommendation: "Use SameSite=Strict where product flows allow it." }));
  }

  const server = headerValue(headers, "server");
  const poweredBy = headerValue(headers, "x-powered-by");
  if (server || poweredBy) {
    findings.push(finding({ status: "info", weight: 1, header: "Server / X-Powered-By", title: "Server technology disclosure is present", observed: [server, poweredBy].filter(Boolean).join(" / "), recommendation: "Remove or reduce framework/version disclosure where your stack allows it." }));
  }

  const xss = headerValue(headers, "x-xss-protection");
  if (xss && xss !== "0") {
    findings.push(finding({ status: "info", weight: 0, header: "X-XSS-Protection", title: "Legacy XSS auditor header is present", observed: xss, recommendation: "Modern browsers rely on CSP. Consider disabling this legacy header with X-XSS-Protection: 0." }));
  }

  const hpKP = headerValue(headers, "public-key-pins");
  if (hpKP) {
    findings.push(finding({ status: "warn", weight: 8, header: "Public-Key-Pins", title: "Deprecated HPKP header is present", observed: hpKP, recommendation: "Remove HPKP; it is deprecated and can create availability risk." }));
  }

  const penalty = findings.reduce((sum, item) => sum + (item.status === "info" ? 0 : item.weight || 0), 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : score >= 50 ? "E" : "F";
  const counts = findings.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, info: 0 });

  return {
    grade,
    score,
    counts,
    findings,
    observedHeaders: Object.fromEntries(Object.entries(headers).map(([key, values]) => [key, values.join(", ")])),
  };
}

module.exports = {
  analyzeSecurityHeaders,
  headersObjectFromFetchHeaders,
  parseRawHeaders,
};
