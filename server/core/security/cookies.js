function getCookieSecure() {
  const raw = process.env.COOKIE_SECURE;
  if (raw != null && String(raw).trim() !== "") {
    const normalized = String(raw).trim().toLowerCase();
    return ["true", "1", "yes", "on"].includes(normalized);
  }
  return process.env.NODE_ENV === "production";
}

function describeCookieSecureSource() {
  return process.env.COOKIE_SECURE == null || String(process.env.COOKIE_SECURE).trim() === ""
    ? "default"
    : "env";
}

module.exports = {
  getCookieSecure,
  describeCookieSecureSource,
};
