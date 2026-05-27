"use strict";

module.exports = {
  id: "037_chat_message_edit_delete",
  description: "Add RedSecTeam message edit and delete tombstone metadata",
  up(db) {
    const columns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);

    if (!columns.includes("edited_at")) {
      db.exec("ALTER TABLE messages ADD COLUMN edited_at INTEGER");
    }

    if (!columns.includes("deleted_at")) {
      db.exec("ALTER TABLE messages ADD COLUMN deleted_at INTEGER");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at);
    `);
  },
};
