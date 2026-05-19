function mapPasteListRow(row) {
  return {
    id: row.id,
    hasPassword: !!row.has_password,
    burnAfterReading: !!row.burn_after_reading,
    sourceIp: row.source_ip || "unknown",
    syntax: row.syntax || "plaintext",
    size: row.size,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userId: row.user_id || null,
    guestInvitedBy: row.guest_invited_by || null,
    username: row.username || null,
  };
}

function createPasteRepository(db, { validExpiryOptions }) {
  const stmts = {
    createPaste: db.prepare(`
      INSERT INTO pastes (id, ciphertext, iv, iv_password, salt, has_password, burn_after_reading, source_ip, syntax, expires_at, user_id, guest_invited_by)
      VALUES (@id, @ciphertext, @iv, @ivPassword, @salt, @hasPassword, @burnAfterReading, @sourceIp, @syntax, @expiresAt, @userId, @guestInvitedBy)
    `),
    getPasteById: db.prepare("SELECT * FROM pastes WHERE id = ?"),
    deletePasteById: db.prepare("DELETE FROM pastes WHERE id = ?"),
    deleteExpiredPastes: db.prepare("DELETE FROM pastes WHERE expires_at < unixepoch()"),
    countAllPastes: db.prepare("SELECT COUNT(*) as total FROM pastes"),
    countActivePastes: db.prepare("SELECT COUNT(*) as total FROM pastes WHERE expires_at >= unixepoch()"),
    countExpiredPastes: db.prepare("SELECT COUNT(*) as total FROM pastes WHERE expires_at < unixepoch()"),
    listPastes: db.prepare(`
      SELECT p.id, p.has_password, p.burn_after_reading, p.source_ip, p.syntax, length(p.ciphertext) as size,
             p.created_at, p.expires_at, p.user_id, p.guest_invited_by, u.username
      FROM pastes p LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `),
  };

  const consumePaste = db.transaction((id) => {
    const row = stmts.getPasteById.get(id);
    if (!row) return null;
    stmts.deletePasteById.run(id);
    return row;
  });

  function createPaste({ id, ciphertext, iv, ivPassword, salt, hasPassword, burnAfterReading, expiresIn, sourceIp, syntax, userId, guestInvitedBy }) {
    if (!validExpiryOptions.includes(expiresIn)) {
      throw new Error("Invalid expiry");
    }
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    stmts.createPaste.run({
      id,
      ciphertext: Buffer.from(ciphertext, "base64"),
      iv: Buffer.from(iv, "base64"),
      ivPassword: ivPassword ? Buffer.from(ivPassword, "base64") : null,
      salt: salt ? Buffer.from(salt, "base64") : null,
      hasPassword: hasPassword ? 1 : 0,
      burnAfterReading: burnAfterReading ? 1 : 0,
      sourceIp: sourceIp || null,
      syntax: syntax || "plaintext",
      expiresAt,
      userId: userId || null,
      guestInvitedBy: guestInvitedBy || null,
    });
    return { id, expiresAt };
  }

  function getPaste(id) {
    const row = stmts.getPasteById.get(id);
    if (!row) return null;
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      stmts.deletePasteById.run(id);
      return { expired: true };
    }
    if (row.burn_after_reading && !row.burned) {
      const consumed = consumePaste(id);
      if (consumed) return { ...consumed, burned: true };
    }
    return row;
  }

  function deleteExpiredPastes() {
    return stmts.deleteExpiredPastes.run().changes;
  }

  function getPasteStats() {
    return {
      total: stmts.countAllPastes.get().total,
      active: stmts.countActivePastes.get().total,
      expired: stmts.countExpiredPastes.get().total,
    };
  }

  function listPastes(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const rows = stmts.listPastes.all(limit, offset);
    const total = stmts.countAllPastes.get().total;
    return {
      pastes: rows.map(mapPasteListRow),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  function deletePaste(id) {
    return stmts.deletePasteById.run(id).changes > 0;
  }

  return {
    createPaste,
    getPaste,
    deleteExpiredPastes,
    getPasteStats,
    listPastes,
    deletePaste,
  };
}

module.exports = {
  createPasteRepository,
};
