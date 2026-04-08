const nodemailer = require("nodemailer");
const { getSmtpConfig } = require("./database");

async function createTransporter() {
  const config = getSmtpConfig();
  if (!config.smtpHost) {
    throw new Error("SMTP not configured. Configure it in Admin > Settings.");
  }
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: parseInt(config.smtpPort, 10) || 587,
    secure: config.smtpSecure === "true",
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

async function sendInviteEmail(email, registrationUrl) {
  const transporter = await createTransporter();
  const config = getSmtpConfig();
  const info = await transporter.sendMail({
    from: config.smtpFrom || config.smtpUser,
    to: email,
    subject: "You're invited to RedSecTools",
    text: `You've been invited to join RedSecTools.\n\nRegister here: ${registrationUrl}\n\nThis invitation link will expire. If you did not expect this email, you can ignore it.`,
    html: `<p>You've been invited to join <strong>RedSecTools</strong>.</p><p><a href="${registrationUrl}">Click here to register</a></p><p style="color:#888;font-size:12px;">This invitation link will expire. If you did not expect this email, you can ignore it.</p>`,
  });
  return { messageId: info.messageId, response: info.response };
}

async function sendPasswordResetEmail(email, resetUrl) {
  const transporter = await createTransporter();
  const config = getSmtpConfig();
  const info = await transporter.sendMail({
    from: config.smtpFrom || config.smtpUser,
    to: email,
    subject: "RedSecTools — Password Reset",
    text: `A password reset was requested for your RedSecTools account.\n\nReset here: ${resetUrl}\n\nThis link will expire in 1 hour. If you did not request this, you can ignore this email.`,
    html: `<p>A password reset was requested for your RedSecTools account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p style="color:#888;font-size:12px;">This link will expire in 1 hour. If you did not request this, you can ignore this email.</p>`,
  });
  return { messageId: info.messageId, response: info.response };
}

async function sendTestEmail(to) {
  const transporter = await createTransporter();
  const config = getSmtpConfig();
  const info = await transporter.sendMail({
    from: config.smtpFrom || config.smtpUser,
    to,
    subject: "RedSecTools — SMTP Test",
    text: "This is a test email from RedSecTools. If you received this, your SMTP configuration is working correctly.",
    html: "<p>This is a test email from <strong>RedSecTools</strong>. If you received this, your SMTP configuration is working correctly.</p>",
  });
  return { messageId: info.messageId, response: info.response };
}

async function sendShareLinkEmail(to, linkUrl, toolName) {
  const transporter = await createTransporter();
  const config = getSmtpConfig();
  const info = await transporter.sendMail({
    from: config.smtpFrom || config.smtpUser,
    to,
    subject: `RedSecTools — ${toolName} link shared with you`,
    text: `Someone has shared a ${toolName} link with you on RedSecTools.\n\nAccess it here: ${linkUrl}\n\nThis link may expire. If you did not expect this email, you can ignore it.`,
    html: `<p>Someone has shared a <strong>${toolName}</strong> link with you on RedSecTools.</p><p><a href="${linkUrl}">Click here to access it</a></p><p style="color:#888;font-size:12px;">This link may expire. If you did not expect this email, you can ignore it.</p>`,
  });
  return { messageId: info.messageId, response: info.response };
}

module.exports = { sendInviteEmail, sendPasswordResetEmail, sendTestEmail, sendShareLinkEmail };
