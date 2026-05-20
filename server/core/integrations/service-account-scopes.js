const { ALL_PERMISSIONS } = require("../../access");

const API_OPERATIONAL_SCOPES = Object.freeze([
  "audit.read",
  "deployment.read",
  "webhooks.manage",
]);

const LEGACY_API_SCOPE_ALIASES = Object.freeze({
  "threat.read": ["threat.view"],
});

const SERVICE_ACCOUNT_SCOPES = Object.freeze([
  ...API_OPERATIONAL_SCOPES,
  ...ALL_PERMISSIONS,
  ...Object.keys(LEGACY_API_SCOPE_ALIASES),
]);

function expandScopeAliases(scopes = []) {
  const expanded = new Set();
  for (const scope of Array.isArray(scopes) ? scopes : []) {
    const normalized = String(scope || "").trim();
    if (!normalized) continue;
    expanded.add(normalized);
    for (const aliasTarget of LEGACY_API_SCOPE_ALIASES[normalized] || []) {
      expanded.add(aliasTarget);
    }
  }
  return [...expanded];
}

function hasServiceScope(grantedScopes = [], requiredScopes = []) {
  const granted = new Set(expandScopeAliases(grantedScopes));
  if (granted.has("*")) return true;
  const required = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
  return required.length === 0 || required.some((scope) => granted.has(scope));
}

function isValidServiceAccountScope(scope) {
  return scope === "*" || SERVICE_ACCOUNT_SCOPES.includes(String(scope || "").trim());
}

module.exports = {
  API_OPERATIONAL_SCOPES,
  LEGACY_API_SCOPE_ALIASES,
  SERVICE_ACCOUNT_SCOPES,
  expandScopeAliases,
  hasServiceScope,
  isValidServiceAccountScope,
};
