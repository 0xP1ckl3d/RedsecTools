"use strict";

const ENCRYPTED_TOOL_DOMAIN_PATTERN = /^(vault|paste|share|chat)\./;
const HIGH_RISK_TOOL_PATTERN = /\.(delete|archive|unarchive|restore|readonly|status)$|\.member\.|\.template\.|\.finding\.delete$|\.section\.delete$/;

const DATA_CLASS_BY_DOMAIN = Object.freeze({
  users: "user_directory",
  calendar: "schedule_and_project_operations",
  homepage: "homepage_preferences_and_bulletins",
  wiki: "team_and_personal_wiki_metadata",
  threat: "threat_intelligence",
  reporter: "reporting_project_data",
  engage: "engagement_operations",
  survey: "survey_metadata_and_results",
  minitools: "security_diagnostics",
});

function getToolDomain(toolName) {
  return String(toolName || "").split(".")[0] || "unknown";
}

function getToolRiskLevel(toolName, tool = {}) {
  if (HIGH_RISK_TOOL_PATTERN.test(String(toolName || ""))) return "high";
  if (tool.confirmRequired) return "medium";
  return "low";
}

function getToolCategory(tool = {}) {
  if (tool.confirmRequired) return "write";
  if (String(tool.capability || "").endsWith(".search")) return "search";
  return "read";
}

function getRedSecAiToolGovernance(toolName, tool = {}) {
  const domain = getToolDomain(toolName);
  const confirmRequired = !!tool.confirmRequired;
  return {
    domain,
    category: getToolCategory(tool),
    confirmRequired,
    requiredPermissions: Array.isArray(tool.permissionsAny) ? tool.permissionsAny.slice() : [],
    dataClass: DATA_CLASS_BY_DOMAIN[domain] || "application_metadata",
    riskLevel: getToolRiskLevel(toolName, tool),
    cloudWarning: true,
    encryptedProductExcluded: ENCRYPTED_TOOL_DOMAIN_PATTERN.test(String(toolName || "")),
  };
}

function buildRedSecAiToolGovernanceMatrix(toolAllowlist = {}) {
  return Object.fromEntries(Object.entries(toolAllowlist).map(([name, tool]) => [
    name,
    getRedSecAiToolGovernance(name, tool),
  ]));
}

function findEncryptedRedSecAiTools(toolAllowlist = {}) {
  return Object.keys(toolAllowlist).filter((name) => ENCRYPTED_TOOL_DOMAIN_PATTERN.test(name));
}

function isHighImpactRedSecAiTool(toolName, tool = {}) {
  return getRedSecAiToolGovernance(toolName, tool).riskLevel === "high";
}

module.exports = {
  buildRedSecAiToolGovernanceMatrix,
  findEncryptedRedSecAiTools,
  getRedSecAiToolGovernance,
  isHighImpactRedSecAiTool,
};
