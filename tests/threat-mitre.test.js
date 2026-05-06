const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMitreCatalogue, buildMitreOverview, enrichAlert } = require("../server/threat-intel-insights");

test("MITRE overview includes a tactic/technique catalogue for filters", () => {
  const catalogue = buildMitreCatalogue();
  assert.equal(catalogue.tactics.length, 15);
  assert.ok(catalogue.techniques.length > 650);
  assert.ok(catalogue.tactics.some((item) => item.tacticId === "TA0005" && item.tactic === "Stealth"));

  const defenseEvasionTechniques = catalogue.techniques.filter((item) => item.tacticIds.includes("TA0005"));
  assert.ok(defenseEvasionTechniques.length > 40);
  assert.ok(defenseEvasionTechniques.some((item) => item.techniqueId === "T1027"));

  const overview = buildMitreOverview([]);
  assert.deepEqual(overview.catalogue.tactics, catalogue.tactics);
  assert.deepEqual(overview.catalogue.techniques, catalogue.techniques);
});

test("MITRE mapping keeps Defense Evasion compatibility while using current Stealth tactic", () => {
  const alert = enrichAlert({ matchedContent: "Observed defense evasion with T1027 payload obfuscation" });
  assert.ok(alert.mitre.some((item) => item.tacticId === "TA0005" && item.tactic === "Stealth"));
  assert.ok(alert.mitre.some((item) => item.techniqueId === "T1027"));
});
