const test = require("node:test");
const assert = require("node:assert/strict");

const { canEditBulletin, canDeleteBulletin } = require("../server/bulletin-service");

function buildRequest(userId, permissions) {
  return {
    user: { id: userId },
    access: { permissionSet: new Set(permissions) },
  };
}

test("bulletin team editors can edit other users' bulletins but cannot delete them", () => {
  const bulletin = { authorId: "author-1" };
  const editorReq = buildRequest("editor-1", ["bulletin.edit_any"]);

  assert.equal(canEditBulletin(editorReq, bulletin), true);
  assert.equal(canDeleteBulletin(editorReq, bulletin), false);
});

test("bulletin managers can edit and delete other users' bulletins", () => {
  const bulletin = { authorId: "author-1" };
  const managerReq = buildRequest("manager-1", ["bulletin.manage"]);

  assert.equal(canEditBulletin(managerReq, bulletin), true);
  assert.equal(canDeleteBulletin(managerReq, bulletin), true);
});
