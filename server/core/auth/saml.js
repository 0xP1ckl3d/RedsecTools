const { SAML, generateServiceProviderMetadata } = require("@node-saml/node-saml");
const { buildAbsoluteUrl } = require("../../public-origin");

const DEFAULT_LOGIN_PATH = "/api/auth/sso/saml/login";
const DEFAULT_ACS_PATH = "/api/auth/sso/saml/acs";
const DEFAULT_METADATA_PATH = "/api/auth/sso/saml/metadata";
const DEFAULT_EMAIL_ATTRIBUTE = "email";
const DEFAULT_USERNAME_ATTRIBUTE = "username";
const DEFAULT_FULL_NAME_ATTRIBUTE = "displayName";
const requestCache = new Map();

const cacheProvider = {
  async saveAsync(key, value) {
    const item = { value, createdAt: Date.now() };
    requestCache.set(key, item);
    return item;
  },
  async getAsync(key) {
    const item = requestCache.get(key);
    if (!item) return null;
    if ((Date.now() - item.createdAt) > 8 * 60 * 60 * 1000) {
      requestCache.delete(key);
      return null;
    }
    return item.value;
  },
  async removeAsync(key) {
    const item = requestCache.get(key);
    requestCache.delete(key);
    return item?.value || null;
  },
};

function isSamlEnabled(settings) {
  return settings.enabled && settings.provider === "saml";
}

function normalizePemOrBase64List(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (blocks && blocks.length > 0) return blocks.map((block) => block.trim());
  return text;
}

function readAttribute(profile, names) {
  for (const name of names.filter(Boolean)) {
    const value = profile?.[name];
    if (Array.isArray(value) && value.length > 0) return String(value[0]).trim();
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getProfileEmail(profile, settings) {
  return readAttribute(profile, [
    settings.emailAttribute,
    "email",
    "mail",
    "Email",
    "emailAddress",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "urn:oid:0.9.2342.19200300.100.1.3",
    "nameID",
  ]).toLowerCase();
}

function getProfileUsername(profile, settings) {
  return readAttribute(profile, [
    settings.usernameAttribute,
    "username",
    "uid",
    "name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "nameID",
  ]);
}

function getProfileFullName(profile, settings) {
  return readAttribute(profile, [
    settings.fullNameAttribute,
    "displayName",
    "cn",
    "name",
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  ]);
}

function sanitizeUsername(value, fallbackEmail) {
  const seed = String(value || fallbackEmail || "saml_user").split("@")[0] || "saml_user";
  const cleaned = seed.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const normalized = (cleaned || "saml_user").slice(0, 30);
  return normalized.length >= 3 ? normalized : `${normalized}___`.slice(0, 3);
}

function getSamlSettings({ getSetting, decryptValue = (value) => value }) {
  const provider = String(getSetting("sso_provider") || "none").trim().toLowerCase();
  const privateKeyStored = getSetting("sso_sp_private_key") || "";
  return {
    enabled: getSetting("sso_enabled") === "true",
    provider,
    requireForLogin: getSetting("sso_require_for_login") === "true",
    autoProvision: getSetting("sso_auto_provision") === "true",
    loginPath: DEFAULT_LOGIN_PATH,
    acsPath: DEFAULT_ACS_PATH,
    metadataPath: DEFAULT_METADATA_PATH,
    entityId: getSetting("sso_entity_id") || "",
    idpEntityId: getSetting("sso_idp_entity_id") || "",
    idpMetadataUrl: getSetting("sso_idp_metadata_url") || "",
    entryPoint: getSetting("sso_saml_entry_point") || "",
    idpCert: getSetting("sso_idp_cert") || "",
    emailAttribute: getSetting("sso_email_attribute") || DEFAULT_EMAIL_ATTRIBUTE,
    usernameAttribute: getSetting("sso_username_attribute") || DEFAULT_USERNAME_ATTRIBUTE,
    fullNameAttribute: getSetting("sso_full_name_attribute") || DEFAULT_FULL_NAME_ATTRIBUTE,
    defaultRoleId: getSetting("sso_default_role_id") || "",
    signRequests: getSetting("sso_sign_requests") === "true",
    publicCert: getSetting("sso_sp_public_cert") || "",
    privateKey: privateKeyStored ? decryptValue(privateKeyStored) : "",
    forceAuthn: getSetting("sso_force_authn") === "true",
  };
}

function validateSamlReady(settings, req = null) {
  if (!isSamlEnabled(settings)) return "SAML is not enabled";
  if (!settings.entryPoint) return "SAML IdP SSO URL is required";
  if (!settings.idpCert) return "SAML IdP signing certificate is required";
  const callbackUrl = req ? buildAbsoluteUrl(req, settings.acsPath) : null;
  const issuer = settings.entityId || (req ? buildAbsoluteUrl(req, settings.metadataPath) : "");
  if (req && !callbackUrl) return "Unable to build SAML ACS URL from trusted public origins";
  if (!issuer) return "SAML SP Entity ID is required";
  if (settings.signRequests && (!settings.privateKey || !settings.publicCert)) {
    return "Signed SAML requests require both SP private key and public certificate";
  }
  return null;
}

function createSamlClient(settings, req) {
  const error = validateSamlReady(settings, req);
  if (error) {
    const err = new Error(error);
    err.code = "saml_not_ready";
    throw err;
  }

  const callbackUrl = buildAbsoluteUrl(req, settings.acsPath);
  const issuer = settings.entityId || buildAbsoluteUrl(req, settings.metadataPath);
  const options = {
    callbackUrl,
    entryPoint: settings.entryPoint,
    issuer,
    audience: issuer,
    idpCert: normalizePemOrBase64List(settings.idpCert),
    idpIssuer: settings.idpEntityId || undefined,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    acceptedClockSkewMs: 120000,
    maxAssertionAgeMs: 5 * 60 * 1000,
    validateInResponseTo: "always",
    requestIdExpirationPeriodMs: 8 * 60 * 60 * 1000,
    cacheProvider,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    forceAuthn: !!settings.forceAuthn,
  };

  if (settings.signRequests) {
    options.privateKey = settings.privateKey;
    options.publicCert = settings.publicCert;
  }

  return new SAML(options);
}

function getServiceProviderMetadata(settings, req) {
  if (settings.provider !== "saml") {
    const err = new Error("SAML is not configured");
    err.code = "saml_not_ready";
    throw err;
  }
  const callbackUrl = buildAbsoluteUrl(req, settings.acsPath);
  const issuer = settings.entityId || buildAbsoluteUrl(req, settings.metadataPath);
  if (!callbackUrl) {
    const err = new Error("Unable to build SAML ACS URL from trusted public origins");
    err.code = "saml_not_ready";
    throw err;
  }
  if (!issuer) {
    const err = new Error("SAML SP Entity ID is required");
    err.code = "saml_not_ready";
    throw err;
  }
  const canSign = !!(settings.signRequests && settings.privateKey && settings.publicCert);
  return generateServiceProviderMetadata({
    issuer,
    callbackUrl,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    wantAssertionsSigned: true,
    privateKey: canSign ? settings.privateKey : null,
    publicCerts: canSign ? settings.publicCert : null,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
  });
}

module.exports = {
  DEFAULT_ACS_PATH,
  DEFAULT_EMAIL_ATTRIBUTE,
  DEFAULT_FULL_NAME_ATTRIBUTE,
  DEFAULT_LOGIN_PATH,
  DEFAULT_METADATA_PATH,
  DEFAULT_USERNAME_ATTRIBUTE,
  createSamlClient,
  getProfileEmail,
  getProfileFullName,
  getProfileUsername,
  getSamlSettings,
  getServiceProviderMetadata,
  isSamlEnabled,
  sanitizeUsername,
  validateSamlReady,
};
