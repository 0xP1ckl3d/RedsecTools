const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireUser } = require("../middleware/auth");
const {
  getNotificationsByUserId,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../database");

const router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const VALID_SEVERITIES = new Set(["info", "success", "warning", "critical"]);

router.get("/notifications", readLimiter, requireUser, (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const notifications = getNotificationsByUserId(req.user.id, limit, offset);
    const unreadCount = getUnreadNotificationCount(req.user.id);
    res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
});

router.post("/notifications/:id/read", writeLimiter, requireUser, (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Invalid notification ID." });
    }
    const updated = markNotificationRead(id, req.user.id);
    if (!updated) {
      return res.status(404).json({ error: "Notification not found." });
    }
    const unreadCount = getUnreadNotificationCount(req.user.id);
    res.status(200).json({ success: true, unreadCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark notification as read." });
  }
});

router.post("/notifications/read-all", writeLimiter, requireUser, (req, res) => {
  try {
    const count = markAllNotificationsRead(req.user.id);
    res.status(200).json({ success: true, markedRead: count, unreadCount: 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark all notifications as read." });
  }
});

module.exports = router;
