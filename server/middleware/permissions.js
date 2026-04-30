const path = require("path");
const { getUserById, getRolePermissionsByUserId } = require("../database");

async function attachUserAccess(req, res, next) {
  if (!req.user?.id) {
    req.access = {
      userId: null,
      username: null,
      role: null,
      permissions: [],
      permissionSet: new Set(),
    };
    return next();
  }

  const freshUser = getUserById(req.user.id);
  const permissions = getRolePermissionsByUserId(req.user.id);
  req.user = {
    ...req.user,
    email: freshUser?.email || null,
    roleId: freshUser?.role_id || null,
    roleKey: freshUser?.role_key || null,
    roleName: freshUser?.role_name || null,
  };
  req.access = {
    userId: req.user.id,
    username: req.user.username || null,
    role: freshUser ? {
      id: freshUser.role_id || null,
      key: freshUser.role_key || null,
      name: freshUser.role_name || null,
    } : null,
    permissions,
    permissionSet: new Set(permissions),
  };
  next();
}

function requirePermission(permission) {
  return [
    attachUserAccess,
    (req, res, next) => {
      if (!req.access?.permissionSet?.has(permission)) {
        return res.status(403).json({ error: "Insufficient permissions", permission });
      }
      next();
    },
  ];
}

function requireAnyPermission(permissions) {
  return [
    attachUserAccess,
    (req, res, next) => {
      const allowed = Array.isArray(permissions) && permissions.some((permission) => req.access?.permissionSet?.has(permission));
      if (!allowed) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      next();
    },
  ];
}

function pageRequirePermission(permission) {
  return (req, res, next) => {
    if (!req.user?.id) {
      return res.redirect("/login");
    }

    const permissions = getRolePermissionsByUserId(req.user.id);
    if (!permissions.includes(permission)) {
      return res.status(403).sendFile(path.join(__dirname, "..", "..", "public", "error.html"));
    }

    next();
  };
}

function pageRequireAnyPermission(permissions) {
  return (req, res, next) => {
    if (!req.user?.id) {
      return res.redirect("/login");
    }

    const userPermissions = getRolePermissionsByUserId(req.user.id);
    const allowed = Array.isArray(permissions) && permissions.some((permission) => userPermissions.includes(permission));
    if (!allowed) {
      return res.status(403).sendFile(path.join(__dirname, "..", "..", "public", "error.html"));
    }

    next();
  };
}

module.exports = {
  attachUserAccess,
  requirePermission,
  requireAnyPermission,
  pageRequirePermission,
  pageRequireAnyPermission,
};
