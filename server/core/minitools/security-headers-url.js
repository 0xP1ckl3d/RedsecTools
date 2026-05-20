function normalizeSecurityHeadersTargetUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    return { ok: false, error: "URL is required" };
  }

  let normalized = value;
  if (value.startsWith("//")) {
    normalized = `https:${value}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    normalized = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, error: "Valid HTTP(S) URL is required" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only HTTP(S) URLs are allowed" };
  }

  return { ok: true, url: parsed.href };
}

module.exports = {
  normalizeSecurityHeadersTargetUrl,
};
