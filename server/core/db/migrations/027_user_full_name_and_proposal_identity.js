module.exports = {
  id: "027_user_full_name_and_proposal_identity",
  description: "Add user full names for professional Reporter prepared-by identities.",
  up(db) {
    const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
    if (!columns.includes("full_name")) {
      db.exec("ALTER TABLE users ADD COLUMN full_name TEXT");
    }
  },
};
