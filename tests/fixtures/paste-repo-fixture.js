const assert = require("node:assert/strict");
const { createRouteHarness } = require("../helpers/route-harness");

(async () => {
  const harness = await createRouteHarness({ name: "paste-repo-compat", routes: [] });
  try {
    const created = harness.database.createPaste({
      id: "paste-repo-compat-id",
      ciphertext: Buffer.from("ciphertext").toString("base64"),
      iv: Buffer.alloc(12, 1).toString("base64"),
      ivPassword: null,
      salt: null,
      hasPassword: false,
      burnAfterReading: true,
      expiresIn: 3600,
      sourceIp: "127.0.0.1",
      syntax: "markdown",
      userId: null,
      guestInvitedBy: null,
    });

    assert.equal(created.id, "paste-repo-compat-id");
    const listed = harness.database.listPastes(1, 10);
    assert.equal(listed.pastes.length, 1);
    assert.equal(listed.total, 1);
    assert.equal(listed.page, 1);
    assert.equal(listed.totalPages, 1);
    assert.equal(listed.pastes[0].syntax, "markdown");

    const firstRead = harness.database.getPaste("paste-repo-compat-id");
    assert.equal(firstRead.id, "paste-repo-compat-id");
    assert.equal(firstRead.burned, true);
    assert.equal(firstRead.ciphertext.toString("utf8"), "ciphertext");

    const secondRead = harness.database.getPaste("paste-repo-compat-id");
    assert.equal(secondRead, null);
  } finally {
    await harness.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
