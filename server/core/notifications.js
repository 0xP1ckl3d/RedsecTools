const {
  createNotification: dbCreateNotification,
} = require("../database");
const { pushNotificationToUser, pushUnreadCountToUser } = require("../notification-ws");

const VALID_CATEGORIES = new Set(["engage", "reporter", "calendar", "redsecai", "survey", "threat", "system"]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "critical"]);

function createNotification({ userId, category, action, title, body, linkUrl, entityType, entityId, severity }) {
  const notification = dbCreateNotification({
    userId,
    category: VALID_CATEGORIES.has(category) ? category : "system",
    action: action || "",
    title,
    body: body || "",
    linkUrl: linkUrl || null,
    entityType: entityType || null,
    entityId: entityId || null,
    severity: VALID_SEVERITIES.has(severity) ? severity : "info",
  });

  pushNotificationToUser(userId, notification);
  pushUnreadCountToUser(userId);

  return notification;
}

module.exports = { createNotification };
