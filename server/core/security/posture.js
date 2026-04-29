const os = require("os");
const { describeCookieSecureSource, getCookieSecure } = require("./cookies");
const { getConfiguredTrustedOrigins } = require("../../public-origin");

function getGitCommit() {
  return process.env.APP_COMMIT || process.env.GIT_COMMIT || "";
}

function buildDeploymentWarnings({ trustedOrigins = getConfiguredTrustedOrigins(), host = process.env.HOST || "0.0.0.0" } = {}) {
  const warnings = [];
  const cookieSecure = getCookieSecure();

  if (process.env.NODE_ENV === "production" && !cookieSecure) {
    warnings.push({
      level: "high",
      code: "cookie_secure_disabled_production",
      message: "COOKIE_SECURE is disabled while NODE_ENV is production.",
    });
  }

  if (trustedOrigins.some((origin) => /^https:\/\//i.test(origin)) && !cookieSecure) {
    warnings.push({
      level: "high",
      code: "https_origin_cookie_secure_disabled",
      message: "HTTPS trusted origins are configured but secure cookies are disabled.",
    });
  }

  if (host === "0.0.0.0" && process.env.NODE_ENV !== "production") {
    warnings.push({
      level: "medium",
      code: "dev_host_all_interfaces",
      message: "HOST=0.0.0.0 exposes a development server on all interfaces.",
    });
  }

  if (!process.env.TRUSTED_PUBLIC_ORIGINS && process.env.NODE_ENV === "production") {
    warnings.push({
      level: "medium",
      code: "trusted_public_origins_missing",
      message: "TRUSTED_PUBLIC_ORIGINS is not configured in production.",
    });
  }

  return warnings;
}

function buildBasePosture() {
  return {
    app: {
      version: process.env.npm_package_version || "",
      commit: getGitCommit(),
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      environment: process.env.NODE_ENV || "development",
    },
    deployment: {
      host: process.env.HOST || "0.0.0.0",
      port: parseInt(process.env.PORT, 10) || 3000,
      trustProxy: process.env.TRUST_PROXY || "",
      trustedOrigins: getConfiguredTrustedOrigins(),
      cookieSecure: getCookieSecure(),
      cookieSecureSource: describeCookieSecureSource(),
    },
    warnings: buildDeploymentWarnings(),
  };
}

module.exports = {
  buildBasePosture,
  buildDeploymentWarnings,
};
