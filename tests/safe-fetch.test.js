const test = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns").promises;
const { safeFetchPublicUrl, readResponseBufferWithLimit } = require("../server/core/security/safe-fetch");

test("safeFetchPublicUrl validates redirect targets before following them", async () => {
  const originalLookup = dns.lookup;
  const originalFetch = global.fetch;
  dns.lookup = async (hostname) => {
    if (hostname === "public.example") return [{ address: "93.184.216.34", family: 4 }];
    if (hostname === "private.example") return [{ address: "127.0.0.1", family: 4 }];
    return originalLookup(hostname, { all: true, verbatim: true });
  };
  global.fetch = async () => new Response("", {
    status: 302,
    headers: { location: "http://private.example/secret" },
  });

  try {
    await assert.rejects(
      () => safeFetchPublicUrl("https://public.example/start"),
      /Private or reserved DNS targets/,
    );
  } finally {
    dns.lookup = originalLookup;
    global.fetch = originalFetch;
  }
});

test("readResponseBufferWithLimit rejects oversized responses before buffering", async () => {
  const response = new Response("small", {
    headers: { "content-length": String(2 * 1024 * 1024) },
  });

  await assert.rejects(
    () => readResponseBufferWithLimit(response, 1024),
    /too large/,
  );
});
