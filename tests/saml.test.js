const test = require("node:test");
const assert = require("node:assert/strict");
const saml = require("../server/core/auth/saml");

function mockReq() {
  return {
    protocol: "https",
    get(name) {
      const headers = {
        host: "tools.example.test",
        "x-forwarded-proto": "",
        "x-forwarded-host": "",
      };
      return headers[String(name).toLowerCase()] || "";
    },
  };
}

test("SAML metadata uses real SP routes without requiring IdP configuration", () => {
  const previous = process.env.TRUSTED_PUBLIC_ORIGINS;
  process.env.TRUSTED_PUBLIC_ORIGINS = "https://tools.example.test";
  try {
    const metadata = saml.getServiceProviderMetadata({
      provider: "saml",
      acsPath: saml.DEFAULT_ACS_PATH,
      metadataPath: saml.DEFAULT_METADATA_PATH,
      entityId: "https://tools.example.test/saml",
      signRequests: false,
    }, mockReq());
    assert.match(metadata, /EntityDescriptor/);
    assert.match(metadata, /https:\/\/tools\.example\.test\/api\/auth\/sso\/saml\/acs/);
    assert.match(metadata, /https:\/\/tools\.example\.test\/saml/);
  } finally {
    process.env.TRUSTED_PUBLIC_ORIGINS = previous;
  }
});

test("SAML login readiness requires IdP URL, certificate, and SP entity ID", () => {
  assert.equal(
    saml.validateSamlReady({ enabled: true, provider: "saml" }),
    "SAML IdP SSO URL is required",
  );
  assert.equal(
    saml.validateSamlReady({ enabled: true, provider: "saml", entryPoint: "https://idp.example.test/sso" }),
    "SAML IdP signing certificate is required",
  );
});

test("SAML username derivation creates local-safe names", () => {
  assert.equal(saml.sanitizeUsername("Jane.User+Security", "jane@example.test"), "Jane_User_Security");
  assert.equal(saml.sanitizeUsername("", "ab@example.test"), "ab_");
});
