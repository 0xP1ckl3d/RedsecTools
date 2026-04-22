const { getSession, deleteSessionById, getExtensionSession, deleteExtensionSessionById } = require("../database");

function getValidUserSession(req) {
  const sessionId = req.signedCookies.redsec_session;
  if (!sessionId) return null;

  const session = getSession(sessionId);
  if (!session) {
    return { error: "missing", sessionId };
  }

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    deleteSessionById(sessionId);
    return { error: "expired", sessionId };
  }

  if (session.suspended) {
    deleteSessionById(sessionId);
    return { error: "suspended", sessionId };
  }

  return {
    sessionId,
    user: {
      id: session.user_id,
      username: session.username,
      roleId: session.role_id || null,
      roleKey: session.role_key || null,
      roleName: session.role_name || null,
    },
  };
}

function getValidGuestSession(req, tool = null) {
  const guest = req.signedCookies.redsec_guest;
  if (!guest || !guest.guestToken || !guest.tool || !guest.invitedBy) {
    return null;
  }

  if (guest.expires && guest.expires < Math.floor(Date.now() / 1000)) {
    return { error: "expired" };
  }

  if (tool && guest.tool !== tool) {
    return { error: "tool_mismatch", tool: guest.tool };
  }

  return {
    guest: {
      token: guest.guestToken,
      tool: guest.tool,
      invitedBy: guest.invitedBy,
    },
  };
}

function requireUser(req, res, next) {
  const result = getValidUserSession(req);
  if (!result) {
    return res.status(401).json({ error: "Login required" });
  }

  if (result.error === "missing" || result.error === "expired") {
    res.clearCookie("redsec_session", { path: "/" });
    return res.status(401).json({ error: "Session expired" });
  }

  if (result.error === "suspended") {
    res.clearCookie("redsec_session", { path: "/" });
    return res.status(403).json({ error: "Account suspended" });
  }

  req.user = result.user;
  next();
}

function optionalUser(req, res, next) {
  const result = getValidUserSession(req);
  if (!result || result.error) {
    req.user = null;
    return next();
  }

  req.user = result.user;
  next();
}

function requireGuestOrUser(req, res, next) {
  // Check user session first
  const userResult = getValidUserSession(req);
  if (userResult && !userResult.error) {
    req.user = userResult.user;
    req.guest = null;
    return next();
  }
  if (userResult?.sessionId) {
    res.clearCookie("redsec_session", { path: "/" });
  }

  // Check guest cookie
  const guestResult = getValidGuestSession(req);
  if (guestResult && !guestResult.error) {
    req.user = null;
    req.guest = guestResult.guest;
    return next();
  }

  if (guestResult?.error === "expired") {
    res.clearCookie("redsec_guest", { path: "/" });
    return res.status(401).json({ error: "Guest link expired" });
  }

  res.status(401).json({ error: "Login required" });
}

function requireGuestOrUserFor(tool) {
  return (req, res, next) => {
    const userResult = getValidUserSession(req);
    if (userResult && !userResult.error) {
      req.user = userResult.user;
      req.guest = null;
      return next();
    }
    if (userResult?.sessionId) {
      res.clearCookie("redsec_session", { path: "/" });
    }

    const guestResult = getValidGuestSession(req, tool);
    if (guestResult && !guestResult.error) {
      req.user = null;
      req.guest = guestResult.guest;
      return next();
    }

    if (guestResult?.error === "expired") {
      res.clearCookie("redsec_guest", { path: "/" });
      return res.status(401).json({ error: "Guest link expired" });
    }

    if (guestResult?.error === "tool_mismatch") {
      return res.status(403).json({ error: `Guest link only permits ${guestResult.tool}` });
    }

    return res.status(401).json({ error: "Login required" });
  };
}

function getValidExtensionSession(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const sessionId = match[1].trim();
  if (!sessionId) return { error: "missing" };

  const session = getExtensionSession(sessionId);
  if (!session) {
    return { error: "missing", sessionId };
  }

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    deleteExtensionSessionById(sessionId);
    return { error: "expired", sessionId };
  }

  if (session.suspended) {
    deleteExtensionSessionById(sessionId);
    return { error: "suspended", sessionId };
  }

  return {
    sessionId,
    user: {
      id: session.user_id,
      username: session.username,
      avatarUpdatedAt: session.avatar_updated_at || null,
      roleId: session.role_id || null,
      roleKey: session.role_key || null,
      roleName: session.role_name || null,
    },
  };
}

function requireExtensionUser(req, res, next) {
  const result = getValidExtensionSession(req);
  if (!result) {
    return res.status(401).json({ error: "Extension login required" });
  }

  if (result.error === "missing" || result.error === "expired") {
    return res.status(401).json({ error: "Extension session expired" });
  }

  if (result.error === "suspended") {
    return res.status(403).json({ error: "Account suspended" });
  }

  req.user = result.user;
  req.extensionSessionId = result.sessionId;
  next();
}

// Placeholder — final export at end of file

// --- Page-level auth (server-side redirects, not JSON responses) ---

function pageRequireUser(req, res, next) {
  const result = getValidUserSession(req);
  if (result && !result.error) {
    req.user = result.user;
    return next();
  }

  if (result?.sessionId) {
    res.clearCookie("redsec_session", { path: "/" });
  }
  res.redirect("/login");
}

function pageRequireGuestOrUser(tool) {
  return (req, res, next) => {
    // Check user session
    const userResult = getValidUserSession(req);
    if (userResult && !userResult.error) {
      req.user = userResult.user;
      return next();
    }

    // Check guest cookie — must match the tool
    const guestResult = getValidGuestSession(req, tool);
    if (guestResult && !guestResult.error) {
      req.guest = guestResult.guest;
      return next();
    }

    if (guestResult?.error === "expired") {
      res.clearCookie("redsec_guest", { path: "/" });
    }

    res.redirect("/login");
  };
}

/**
 * Check if a valid user session exists on the request.
 * Returns { id, username } or null. Does NOT send responses.
 */
function getActiveUserSession(req) {
  const result = getValidUserSession(req);
  return result && !result.error ? result.user : null;
}

module.exports = {
  requireUser,
  optionalUser,
  requireGuestOrUser,
  requireGuestOrUserFor,
  pageRequireUser,
  pageRequireGuestOrUser,
  getActiveUserSession,
  requireExtensionUser,
};
