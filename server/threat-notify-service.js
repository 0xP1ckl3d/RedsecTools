const nodemailer = require("nodemailer");
const { createTransporter } = require("./email");
const db = require("./database");

function getThreatNotificationPolicy() {
  return {
    email: {
      enabled: db.getSetting("threat_notify_email_enabled") !== "false",
      fromOverride: String(db.getSetting("threat_notify_email_from_override") || "").trim(),
    },
    webhook: {
      enabled: db.getSetting("threat_notify_webhook_enabled") !== "false",
    },
    discord: {
      enabled: db.getSetting("threat_notify_discord_enabled") !== "false",
      username: String(db.getSetting("threat_notify_discord_username") || "RedSecThreat").trim() || "RedSecThreat",
      avatarUrl: String(db.getSetting("threat_notify_discord_avatar_url") || "").trim(),
    },
  };
}

function normalizeAlertPayload(alertPayload) {
  if (!alertPayload || typeof alertPayload !== "object") {
    return {};
  }
  return {
    ...alertPayload,
    alert_id: alertPayload.alert_id || alertPayload.id,
    feed_name: alertPayload.feed_name || alertPayload.feedName || alertPayload.feed?.name,
    feed_type: alertPayload.feed_type || alertPayload.feedType || alertPayload.feed?.feedType,
    feed_url: alertPayload.feed_url || alertPayload.feedUrl || alertPayload.feed?.url,
    article_url: alertPayload.article_url || alertPayload.articleUrl || null,
    keyword: alertPayload.keyword || alertPayload.keywordText || alertPayload.keyword?.keyword,
    matched_content: alertPayload.matched_content || alertPayload.matchedContent,
    context: alertPayload.context || "",
    criticality: alertPayload.criticality || "medium",
    triggered_at: alertPayload.triggered_at || alertPayload.triggeredAt || alertPayload.createdAt || Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------------------
// sendWebhook – HTTP POST to an arbitrary webhook URL
// ---------------------------------------------------------------------------
async function sendWebhook(destination, alertPayload) {
  try {
    const payload = {
      alert_id: alertPayload.alert_id,
      feed: {
        name: alertPayload.feed_name,
        type: alertPayload.feed_type,
        url: alertPayload.feed_url,
      },
      article_url: alertPayload.article_url || null,
      keyword: alertPayload.keyword,
      matched_content: alertPayload.matched_content,
      context: alertPayload.context,
      triggered_at: alertPayload.triggered_at,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return { success: false, error: `Webhook returned HTTP ${res.status}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// sendEmail – SMTP email via the existing transporter
// ---------------------------------------------------------------------------
async function sendEmail(destination, alertPayload, options = {}) {
  try {
    const config = db.getSmtpConfig();
    if (!config.smtpHost) {
      return { success: false, error: "SMTP not configured" };
    }

    const transporter = await createTransporter();
    const payload = normalizeAlertPayload(alertPayload);

    const keyword = payload.keyword || "unknown";
    const subject = `RedSecThreat Alert: ${keyword} detected`;

    const html = [
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#e0e0e0;background:#1a1a2e;padding:24px;border-radius:8px;">`,

      `<h2 style="margin:0 0 16px;color:#dc3545;border-bottom:1px solid #333;padding-bottom:8px;">RedSecThreat Alert</h2>`,

      `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;width:120px;">Feed</td><td style="padding:4px 8px;">${escapeHtml(payload.feed_name || "N/A")}</td></tr>`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;">Keyword</td><td style="padding:4px 8px;color:#dc3545;font-weight:bold;">${escapeHtml(keyword)}</td></tr>`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;">Criticality</td><td style="padding:4px 8px;">${escapeHtml(payload.criticality || "N/A")}</td></tr>`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;">Triggered</td><td style="padding:4px 8px;">${escapeHtml(payload.triggered_at || "N/A")}</td></tr>`,
      `</table>`,

      `<h3 style="margin:16px 0 8px;color:#eee;">Matched Content</h3>`,
      `<div style="background:#111;padding:12px;border-radius:4px;border:1px solid #333;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(payload.matched_content || "N/A")}</div>`,

      `<h3 style="margin:16px 0 8px;color:#eee;">Context</h3>`,
      `<div style="background:#111;padding:12px;border-radius:4px;border:1px solid #333;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;">${escapeHtml(payload.context || "N/A")}</div>`,

      `<h3 style="margin:16px 0 8px;color:#eee;">Feed Info</h3>`,
      `<table style="width:100%;border-collapse:collapse;">`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;width:120px;">Type</td><td style="padding:4px 8px;">${escapeHtml(payload.feed_type || "N/A")}</td></tr>`,
      `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;">URL</td><td style="padding:4px 8px;"><a href="${escapeHtml(payload.feed_url || "#")}" style="color:#6ea8fe;word-break:break-all;">${escapeHtml(payload.feed_url || "N/A")}</a></td></tr>`,
      (payload.article_url ? `<tr><td style="padding:4px 8px;color:#999;font-weight:bold;">Source</td><td style="padding:4px 8px;"><a href="${escapeHtml(payload.article_url)}" style="color:#6ea8fe;word-break:break-all;">${escapeHtml(payload.article_url)}</a></td></tr>` : ""),
      `</table>`,

      `<p style="margin-top:24px;padding-top:12px;border-top:1px solid #333;color:#666;font-size:12px;">This alert was generated by RedSecThreat.</p>`,
      `</div>`,
    ].join("\n");

    await transporter.sendMail({
      from: options.fromOverride || config.smtpFrom || config.smtpUser,
      to: destination,
      subject,
      html,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// sendDiscord – POST to a Discord webhook URL with an embed
// ---------------------------------------------------------------------------
async function sendDiscord(destination, alertPayload, options = {}) {
  try {
    const payloadData = normalizeAlertPayload(alertPayload);
    const keyword = payloadData.keyword || "unknown";
    const fields = [
      { name: "Feed", value: payloadData.feed_name || "N/A", inline: true },
      { name: "Keyword", value: keyword, inline: true },
      { name: "Criticality", value: payloadData.criticality || "N/A", inline: true },
      {
        name: "Matched Content",
        value: truncate(payloadData.matched_content || "N/A", 1024),
        inline: false,
      },
      {
        name: "Context",
        value: truncate(payloadData.context || "N/A", 1024),
        inline: false,
      },
    ];

    if (payloadData.feed_url) {
      fields.push({ name: "Feed URL", value: payloadData.feed_url, inline: false });
    }
    if (payloadData.article_url) {
      fields.push({ name: "Source Article", value: payloadData.article_url, inline: false });
    }

    const payload = {
      username: options.username || "RedSecThreat",
      avatar_url: options.avatarUrl || undefined,
      embeds: [
        {
          title: "RedSecThreat Alert",
          color: 0xdc3545,
          fields,
          footer: { text: `Alert ID: ${payloadData.alert_id || "N/A"}` },
          timestamp: payloadData.triggered_at
            ? new Date(payloadData.triggered_at * 1000).toISOString()
            : new Date().toISOString(),
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `Discord returned HTTP ${res.status}: ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// sendNotification – dispatcher
// ---------------------------------------------------------------------------
async function sendNotification(channelType, destination, alertPayload, options = {}) {
  switch (channelType) {
    case "webhook":
      return sendWebhook(destination, normalizeAlertPayload(alertPayload));
    case "email":
      return sendEmail(destination, alertPayload, options);
    case "discord":
      return sendDiscord(destination, alertPayload, options);
    default:
      return { success: false, error: `Unknown channel type: ${channelType}` };
  }
}

// ---------------------------------------------------------------------------
// sendTestNotification – verify a channel works
// ---------------------------------------------------------------------------
async function sendTestNotification(channelType, destination) {
  const testPayload = {
    alert_id: "test-00000000",
    feed_name: "Test Feed",
    feed_type: "rss",
    feed_url: "https://example.com/feed.xml",
    keyword: "test-keyword",
    matched_content: "This is a test alert to verify notification delivery.",
    context: "Test context block for notification configuration verification.",
    criticality: "low",
    triggered_at: Math.floor(Date.now() / 1000),
  };

  const policy = getThreatNotificationPolicy();
  const result = await sendNotification(channelType, destination, testPayload, {
    fromOverride: policy.email.fromOverride,
    username: policy.discord.username,
    avatarUrl: policy.discord.avatarUrl,
  });

  if (result.success) {
    return { success: true, message: `Test notification sent successfully via ${channelType}.` };
  }
  return {
    success: false,
    message: `Test notification failed: ${result.error}`,
  };
}

// ---------------------------------------------------------------------------
// deliverPendingNotifications – placeholder for future batch processing
// ---------------------------------------------------------------------------
function getUserNotificationTargets(alertPayload = null) {
  const policy = getThreatNotificationPolicy();
  const userListing = db.listUsers ? db.listUsers(1, 1000) : { users: [] };
  const users = Array.isArray(userListing?.users) ? userListing.users : [];
  const deliveries = [];
  const payload = normalizeAlertPayload(alertPayload);
  const targetUserIds = payload.alert_id ? new Set(db.listThreatAlertUserIds(payload.alert_id)) : null;

  // Admin-level notification configs (global destinations)
  const adminConfigs = db.listThreatNotificationConfigsEnabled();
  for (const config of adminConfigs) {
    const channelPolicy = policy[config.channelType];
    if (!channelPolicy?.enabled) continue;
    deliveries.push({
      userId: null,
      username: "admin",
      channelType: config.channelType,
      destination: String(config.destination || "").trim(),
    });
  }

  // Per-user notification configs
  for (const user of users) {
    if (!user?.id || !user?.email) continue;
    if (user.suspended) continue;
    if (targetUserIds && !targetUserIds.has(user.id)) continue;

    const notifications = db.listThreatUserNotifications(user.id);
    for (const notification of notifications) {
      if (!notification?.enabled) continue;

      const channelPolicy = policy[notification.channelType];
      if (!channelPolicy?.enabled) continue;

      const destination = notification.channelType === "email"
        ? user.email
        : String(notification.destination || "").trim();

      if (!destination) continue;

      deliveries.push({
        userId: user.id,
        username: user.username,
        channelType: notification.channelType,
        destination,
      });
    }
  }

  return { policy, deliveries };
}

async function deliverAlertNotifications(alertPayload) {
  const payload = normalizeAlertPayload(alertPayload);
  const { policy, deliveries } = getUserNotificationTargets(payload);
  const results = [];

  for (const delivery of deliveries) {
    const result = await sendNotification(delivery.channelType, delivery.destination, payload, {
      fromOverride: policy.email.fromOverride,
      username: policy.discord.username,
      avatarUrl: policy.discord.avatarUrl,
    });

    results.push({ ...delivery, ...result });
  }

  return results;
}

async function deliverPendingNotifications() {
  return [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(str, maxLen) {
  if (!str) return "N/A";
  const s = String(str);
  return s.length > maxLen ? s.slice(0, maxLen - 3) + "..." : s;
}

module.exports = {
  deliverAlertNotifications,
  deliverPendingNotifications,
  getThreatNotificationPolicy,
  sendNotification,
  sendTestNotification,
};
