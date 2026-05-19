const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { requireServiceAccount } = require("../middleware/service-auth");
const { listAuditEvents, getDeploymentCounts, listThreatAlerts } = require("../database");

const router = Router();

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "API rate limit exceeded", code: "rate_limited", retryAfterSeconds: 60 },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use("/v1", apiLimiter);

router.get("/v1/me", requireServiceAccount([]), (req, res) => {
  res.json({
    actorType: "service_account",
    id: req.serviceAccount.id,
    name: req.serviceAccount.name,
    scopes: req.serviceAccount.scopes,
  });
});

router.get("/v1/deployment/counts", requireServiceAccount(["deployment.read"]), (req, res) => {
  res.json({ counts: getDeploymentCounts() });
});

router.get("/v1/audit-events", requireServiceAccount(["audit.read"]), (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  res.json(listAuditEvents({
    limit,
    offset,
    category: typeof req.query.category === "string" && req.query.category ? req.query.category : null,
    action: typeof req.query.action === "string" && req.query.action ? req.query.action : null,
    outcome: typeof req.query.outcome === "string" && req.query.outcome ? req.query.outcome : null,
    targetType: typeof req.query.targetType === "string" && req.query.targetType ? req.query.targetType : null,
    targetId: typeof req.query.targetId === "string" && req.query.targetId ? req.query.targetId : null,
  }));
});

router.get("/v1/threat/alerts", requireServiceAccount(["threat.read"]), (req, res) => {
  const filters = {
    limit: Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100)),
    offset: Math.max(0, parseInt(req.query.offset, 10) || 0),
    isRead: req.query.unreadOnly === "true" ? false : undefined,
  };
  res.json({ alerts: listThreatAlerts(filters) });
});

module.exports = router;
