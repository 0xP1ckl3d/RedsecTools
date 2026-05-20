const test = require("node:test");
const assert = require("node:assert/strict");

const {
  publicToolRegistry,
  normalizeDnsToolId,
  normalizeHostnameInput,
  normalizeIpInput,
  normalizeUrlInput,
  normalizeOptions,
  runDnsMiniTool,
} = require("../server/core/minitools/dns-lookup");

test("DNS lookup registry exposes all MVP tools as local provider tools", () => {
  const ids = publicToolRegistry().map((tool) => tool.id);
  assert.deepEqual(ids, [
    "dns_records",
    "security_dns_report",
    "dnssec_test",
    "reverse_dns",
    "mail_dns_health",
    "resolver_consistency",
    "http_headers",
    "site_availability",
    "light_port_check",
    "dnsbl_check",
    "url_decode",
  ]);
  assert.ok(publicToolRegistry().every((tool) => tool.provider.mode === "local" && tool.provider.requiresApiKey === false));
});

test("DNS lookup input normalization strips URLs and rejects ranges and wildcards", () => {
  assert.deepEqual(normalizeHostnameInput("https://WWW.Example.COM/path").target, "www.example.com");
  assert.equal(normalizeHostnameInput("*.example.com").ok, false);
  assert.equal(normalizeHostnameInput("example.com,example.net").ok, false);
  assert.equal(normalizeHostnameInput("example.com/24").ok, false);
  assert.equal(normalizeHostnameInput("localhost", { requireDomain: true }).ok, false);
});

test("DNS lookup IP and URL validation blocks private targets", () => {
  assert.equal(normalizeIpInput("8.8.8.8").ok, true);
  assert.equal(normalizeIpInput("10.0.0.1").ok, false);
  assert.equal(normalizeIpInput("2001:4860:4860::8888").ok, true);
  assert.equal(normalizeIpInput("192.0.2.10", { requireV4: true }).ok, false);
  assert.deepEqual(normalizeUrlInput("example.com").target, "https://example.com/");
  assert.equal(normalizeUrlInput("file:///etc/passwd").ok, false);
});

test("DNS lookup options are constrained per tool", () => {
  const dnsRecords = normalizeDnsToolId("dns_records").tool;
  const consistency = normalizeDnsToolId("resolver_consistency").tool;
  const mail = normalizeDnsToolId("mail_dns_health").tool;
  assert.equal(normalizeOptions(dnsRecords, { recordType: "TXT" }).options.recordType, "TXT");
  assert.equal(normalizeOptions(dnsRecords, { recordType: "ANY" }).options.recordType, "A");
  assert.equal(normalizeOptions(dnsRecords, {}).options.resolverProfile, "cloudflare");
  assert.equal(normalizeOptions(dnsRecords, { resolverProfile: "google" }).options.resolverProfile, "google");
  assert.equal(normalizeOptions(dnsRecords, { resolverProfile: "system" }).options.resolverProfile, "cloudflare");
  assert.equal(normalizeOptions(consistency, { recordType: "SOA" }).options.recordType, "A");
  assert.equal(normalizeOptions(mail, { dkimSelector: "selector1" }).options.dkimSelector, "selector1");
  assert.equal(normalizeOptions(mail, { dkimSelector: "bad selector" }).ok, false);
});

test("URL Decode runs without network and supports repeated decoding", async () => {
  const result = await runDnsMiniTool({
    toolId: "url_decode",
    target: "https%253A%252F%252Fexample.com%252Ftest%253Fa%253D1",
    options: { repeatDecode: true, plusToSpace: true },
    userId: "dns-test-user",
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "success");
  assert.equal(result.body.data.decoded, "https://example.com/test?a=1");
  assert.equal(result.body.meta.provider, "local");
});

test("Invalid DNS lookup requests return validation-shaped result bodies", async () => {
  const result = await runDnsMiniTool({
    toolId: "light_port_check",
    target: "127.0.0.1",
    userId: "dns-test-user-2",
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.status, "validation_error");
  assert.match(result.body.summary, /Private or reserved/i);
});

test("DNS lookup registry exposes public resolver controls without system resolver", () => {
  const registry = publicToolRegistry();
  const dnsRecords = registry.find((tool) => tool.id === "dns_records");
  const securityReport = registry.find((tool) => tool.id === "security_dns_report");
  assert.ok(securityReport.options.some((option) => option.id === "resolverProfile" && option.default === "cloudflare"));
  assert.ok(dnsRecords.options.some((option) => option.id === "resolverProfile"));
  assert.equal(registry.some((tool) => JSON.stringify(tool).includes("system resolver")), false);
});
