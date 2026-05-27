const {
  createNotification: dbCreateNotification,
  markNotificationReadByDedupe: dbMarkNotificationReadByDedupe,
} = require("../database");
const { pushNotificationToUser, pushUnreadCountToUser } = require("../notification-ws");

const VALID_CATEGORIES = new Set(["engage", "reporter", "calendar", "redsecai", "survey", "threat", "team", "system"]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "critical"]);

function createNotification({ userId, category, action, title, body, linkUrl, entityType, entityId, severity, dedupeKey }) {
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
    dedupeKey: dedupeKey || null,
  });

  pushNotificationToUser(userId, notification);
  pushUnreadCountToUser(userId);

  return notification;
}

function markNotificationReadByDedupe(userId, dedupeKey) {
  const changes = dbMarkNotificationReadByDedupe(userId, dedupeKey);
  if (changes > 0) {
    pushUnreadCountToUser(userId);
  }
  return changes;
}

module.exports = { createNotification, markNotificationReadByDedupe };
