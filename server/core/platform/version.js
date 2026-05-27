const fs = require("fs");
const path = require("path");

let cachedPackage = null;

function readPackage() {
  if (cachedPackage) return cachedPackage;
  try {
    const packagePath = path.join(__dirname, "..", "..", "..", "package.json");
    cachedPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    cachedPackage = {};
  }
  return cachedPackage;
}

function getBuildCommit() {
  return process.env.REDSECTOOLS_BUILD_COMMIT
    || process.env.APP_COMMIT
    || process.env.GIT_COMMIT
    || "";
}

function getVersionInfo({ latestMigration = null } = {}) {
  const pkg = readPackage();
  return {
    name: pkg.name || "redsectools",
    version: pkg.version || process.env.npm_package_version || "",
    buildCommit: getBuildCommit(),
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    latestMigration,
  };
}

module.exports = {
  getBuildCommit,
  getVersionInfo,
};
