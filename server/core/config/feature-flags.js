const FLAG_DEFINITIONS = Object.freeze({
  adminReauthRequired: {
    settingKey: "admin_reauth_required",
    envKey: "ADMIN_REAUTH_REQUIRED",
    defaultValue: false,
  },
  ssoEnabled: {
    settingKey: "sso_enabled",
    envKey: "SSO_ENABLED",
    defaultValue: false,
  },
  ssoRequiredForLogin: {
    settingKey: "sso_require_for_login",
    envKey: "SSO_REQUIRE_FOR_LOGIN",
    defaultValue: false,
  },
  openApiEnabled: {
    settingKey: "openapi_enabled",
    envKey: "OPENAPI_ENABLED",
    defaultValue: false,
  },
  serviceAccountsEnabled: {
    settingKey: "service_accounts_enabled",
    envKey: "SERVICE_ACCOUNTS_ENABLED",
    defaultValue: false,
  },
  webhooksEnabled: {
    settingKey: "webhooks_enabled",
    envKey: "WEBHOOKS_ENABLED",
    defaultValue: false,
  },
});

function parseBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function getFeatureFlag(name, { getSetting } = {}) {
  const definition = FLAG_DEFINITIONS[name];
  if (!definition) throw new Error(`Unknown feature flag: ${name}`);

  const stored = typeof getSetting === "function" ? getSetting(definition.settingKey) : null;
  if (stored === "true" || stored === "false") return stored === "true";
  return parseBoolean(process.env[definition.envKey], definition.defaultValue);
}

function listFeatureFlags({ getSetting } = {}) {
  return Object.fromEntries(
    Object.keys(FLAG_DEFINITIONS).map((name) => [name, getFeatureFlag(name, { getSetting })]),
  );
}

function featureFlagDefaults() {
  return Object.fromEntries(
    Object.values(FLAG_DEFINITIONS).map((definition) => [
      definition.settingKey,
      process.env[definition.envKey] ?? String(definition.defaultValue),
    ]),
  );
}

module.exports = {
  FLAG_DEFINITIONS,
  featureFlagDefaults,
  getFeatureFlag,
  listFeatureFlags,
  parseBoolean,
};
