const { getSession, deleteSessionById } = require("../database");

function requireUser(req, res, next) {
  const sessionId = req.signedCookies.redsec_session;
  if (!sessionId) {
    return res.status(401).json({ error: "Login required" });
  }

  const session = getSession(sessionId);
  if (!session) {
    res.clearCookie("redsec_session", { path: "/" });
    return res.status(401).json({ error: "Session expired" });
  }

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    deleteSessionById(sessionId);
    res.clearCookie("redsec_session", { path: "/" });
    return res.status(401).json({ error: "Session expired" });
  }

  if (session.suspended) {
    deleteSessionById(sessionId);
    res.clearCookie("redsec_session", { path: "/" });
    return res.status(403).json({ error: "Account suspended" });
  }

  req.user = { id: session.user_id, username: session.username };
  next();
}

function optionalUser(req, res, next) {
  const sessionId = req.signedCookies.redsec_session;
  if (!sessionId) {
    req.user = null;
    return next();
  }

  const session = getSession(sessionId);
  if (!session || session.expires_at < Math.floor(Date.now() / 1000) || session.suspended) {
    req.user = null;
    return next();
  }

  req.user = { id: session.user_id, username: session.username };
  next();
}

function requireGuestOrUser(req, res, next) {
  // Check user session first
  const sessionId = req.signedCookies.redsec_session;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session && session.expires_at >= Math.floor(Date.now() / 1000) && !session.suspended) {
      req.user = { id: session.user_id, username: session.username };
      req.guest = null;
      return next();
    }
  }

  // Check guest cookie
  const guest = req.signedCookies.redsec_guest;
  if (guest && guest.guestToken && guest.tool && guest.invitedBy) {
    // Validate guest cookie hasn't expired
    if (guest.expires && guest.expires < Math.floor(Date.now() / 1000)) {
      res.clearCookie("redsec_guest", { path: "/" });
      return res.status(401).json({ error: "Guest link expired" });
    }
    req.user = null;
    req.guest = {
      token: guest.guestToken,
      tool: guest.tool,
      invitedBy: guest.invitedBy,
    };
    return next();
  }

  res.status(401).json({ error: "Login required" });
}

module.exports = { requireUser, optionalUser, requireGuestOrUser };

// --- Page-level auth (server-side redirects, not JSON responses) ---

function pageRequireUser(req, res, next) {
  const sessionId = req.signedCookies.redsec_session;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session && session.expires_at >= Math.floor(Date.now() / 1000) && !session.suspended) {
      req.user = { id: session.user_id, username: session.username };
      return next();
    }
    deleteSessionById(sessionId);
    res.clearCookie("redsec_session", { path: "/" });
  }
  res.redirect("/login");
}

function pageRequireGuestOrUser(tool) {
  return (req, res, next) => {
    // Check user session
    const sessionId = req.signedCookies.redsec_session;
    if (sessionId) {
      const session = getSession(sessionId);
      if (session && session.expires_at >= Math.floor(Date.now() / 1000) && !session.suspended) {
        req.user = { id: session.user_id, username: session.username };
        return next();
      }
    }

    // Check guest cookie — must match the tool
    const guest = req.signedCookies.redsec_guest;
    if (guest && guest.guestToken && guest.tool === tool && guest.invitedBy) {
      if (guest.expires && guest.expires >= Math.floor(Date.now() / 1000)) {
        req.guest = { token: guest.guestToken, tool: guest.tool, invitedBy: guest.invitedBy };
        return next();
      }
      res.clearCookie("redsec_guest", { path: "/" });
    }

    res.redirect("/login");
  };
}

module.exports = { requireUser, optionalUser, requireGuestOrUser, pageRequireUser, pageRequireGuestOrUser };
