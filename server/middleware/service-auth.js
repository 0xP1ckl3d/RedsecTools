const crypto = require("crypto");
const {
  getSetting,
  getServiceAccountTokenByHash,
  touchServiceAccountToken,
  createAuditEvent,
} = require("../database");
const { getFeatureFlag } = require("../core/config/feature-flags");
const { redactObject } = require("../core/logger");

const TOKEN_PREFIX = "rst_sa";

function hashApiToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function createPlainApiToken() {
  return `${TOKEN_PREFIX}_${crypto.randomBytes(32).toString("base64url")}`;
}

function tokenDisplayPrefix(token) {
  return String(token).slice(0, 14);
}

function auditServiceAuth(req, outcome, metadata = {}) {
  try {
    createAuditEvent({
      actorType: "service_account",
      actorUserId: req.serviceAccount?.id || null,
      actorUsername: req.serviceAccount?.name || null,
      ipAddress: req.ip || null,
      userAgent: req.get("user-agent") || null,
      category: "api",
      action: "service_account_auth",
      targetType: "api_route",
      targetId: req.originalUrl || req.url,
      outcome,
      metadata: redactObject(metadata),
    });
  } catch {}
}

function requireServiceAccount(scopes = []) {
  const requiredScopes = Array.isArray(scopes) ? scopes : [scopes];
  return (req, res, next) => {
    if (!getFeatureFlag("serviceAccountsEnabled", { getSetting })) {
      return res.status(404).json({ error: "Service account API is disabled" });
    }

    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "Bearer token required" });
    }

    const token = match[1].trim();
    if (!token.startsWith(`${TOKEN_PREFIX}_`)) {
      auditServiceAuth(req, "failure", { reason: "invalid_prefix" });
      return res.status(401).json({ error: "Invalid bearer token" });
    }

    const record = getServiceAccountTokenByHash(hashApiToken(token));
    const now = Math.floor(Date.now() / 1000);
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= now)) {
      auditServiceAuth(req, "failure", { reason: "missing_revoked_or_expired", prefix: tokenDisplayPrefix(token) });
      return res.status(401).json({ error: "Invalid bearer token" });
    }
    if (!record.serviceAccount?.enabled) {
      auditServiceAuth(req, "failure", { reason: "disabled_account", serviceAccountId: record.serviceAccount?.id || null });
      return res.status(403).json({ error: "Service account disabled" });
    }

    const granted = new Set(record.serviceAccount.scopes || []);
    const hasScope = requiredScopes.length === 0 || requiredScopes.some((scope) => granted.has(scope) || granted.has("*"));
    if (!hasScope) {
      req.serviceAccount = record.serviceAccount;
      auditServiceAuth(req, "failure", { reason: "missing_scope", requiredScopes });
      return res.status(403).json({ error: "Insufficient API token scope", requiredScopes });
    }

    req.serviceAccount = record.serviceAccount;
    req.apiToken = { id: record.id, prefix: record.prefix };
    touchServiceAccountToken(record.id);
    auditServiceAuth(req, "success", { scopes: requiredScopes });
    next();
  };
}

module.exports = {
  TOKEN_PREFIX,
  createPlainApiToken,
  hashApiToken,
  requireServiceAccount,
  tokenDisplayPrefix,
};
