"use strict";

const crypto = require("crypto");

function getDb() {
  return require("../../database").db;
}

const MAX_LIVE_URLS = 10;
const EXPIRY_OPTIONS = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "3 hours", minutes: 180 },
  { label: "6 hours", minutes: 360 },
  { label: "12 hours", minutes: 720 },
  { label: "24 hours", minutes: 1440 },
];

function normalizeExpiry(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 1440) return { ok: false, error: "Expiry must be 1-1440 minutes" };
  return { ok: true, minutes: num };
}

function createCallbackUrl(userId, expiryMinutes, nickname = "") {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const liveCount = db.prepare(
    "SELECT COUNT(*) AS cnt FROM callback_urls WHERE user_id = ? AND deleted_at IS NULL AND expires_at > ?"
  ).get(userId, now);

  if (liveCount.cnt >= MAX_LIVE_URLS) {
    return { ok: false, error: `Maximum ${MAX_LIVE_URLS} live callback URLs reached. Delete an existing URL first.` };
  }

  const id = crypto.randomUUID();
  const expiresAt = now + expiryMinutes * 60;
  const cleanNickname = String(nickname || "").slice(0, 100);

  db.prepare(
    "INSERT INTO callback_urls (id, user_id, nickname, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, userId, cleanNickname, now, expiresAt);

  return { ok: true, id, nickname: cleanNickname, createdAt: now, expiresAt };
}

function listCallbackUrls(userId) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const urls = db.prepare(`
    SELECT cu.id, cu.nickname, cu.created_at, cu.expires_at, cu.deleted_at,
      (SELECT COUNT(*) FROM callback_requests WHERE callback_id = cu.id) AS request_count
    FROM callback_urls cu
    WHERE cu.user_id = ?
    ORDER BY cu.created_at DESC
  `).all(userId);

  return urls.map((row) => ({
    id: row.id,
    nickname: row.nickname,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at,
    isExpired: row.expires_at <= now,
    isDeleted: !!row.deleted_at,
    requestCount: row.request_count,
  }));
}

function getCallbackRequests(callbackId, userId) {
  const db = getDb();

  const url = db.prepare("SELECT id, user_id FROM callback_urls WHERE id = ?").get(callbackId);
  if (!url) return { ok: false, error: "Callback URL not found" };
  if (url.user_id !== userId) return { ok: false, error: "Access denied" };

  const requests = db.prepare(`
    SELECT id, received_at, method, path, query, source_ip, user_agent,
      content_type, content_length, referer, origin
    FROM callback_requests
    WHERE callback_id = ?
    ORDER BY received_at DESC
  `).all(callbackId);

  return { ok: true, requests };
}

function getRequestDetail(requestId, userId) {
  const db = getDb();

  const req = db.prepare(`
    SELECT cr.*, cu.user_id AS owner_id
    FROM callback_requests cr
    JOIN callback_urls cu ON cr.callback_id = cu.id
    WHERE cr.id = ?
  `).get(requestId);

  if (!req) return { ok: false, error: "Request not found" };
  if (req.owner_id !== userId) return { ok: false, error: "Access denied" };

  return {
    ok: true,
    request: {
      id: req.id,
      callbackId: req.callback_id,
      receivedAt: req.received_at,
      method: req.method,
      path: req.path,
      query: req.query,
      sourceIp: req.source_ip,
      userAgent: req.user_agent,
      headers: req.headers ? JSON.parse(req.headers) : null,
      body: req.body,
      contentType: req.content_type,
      contentLength: req.content_length,
      referer: req.referer,
      origin: req.origin,
      cookies: req.cookies,
    },
  };
}

function deleteCallbackUrl(callbackId, userId) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const url = db.prepare("SELECT id, user_id FROM callback_urls WHERE id = ? AND deleted_at IS NULL").get(callbackId);
  if (!url) return { ok: false, error: "Callback URL not found or already deleted" };
  if (url.user_id !== userId) return { ok: false, error: "Access denied" };

  db.prepare("UPDATE callback_urls SET deleted_at = ? WHERE id = ?").run(now, callbackId);
  return { ok: true };
}

function captureRequest(callbackId, req) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const url = db.prepare("SELECT id, user_id, expires_at, deleted_at FROM callback_urls WHERE id = ?").get(callbackId);
  if (!url) return { captured: false, reason: "not_found" };
  if (url.deleted_at) return { captured: false, reason: "deleted" };
  if (url.expires_at <= now) return { captured: false, reason: "expired" };

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = value;
  }

  let body = null;
  if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (body.length > 512 * 1024) body = body.slice(0, 512 * 1024);
  }

  db.prepare(`
    INSERT INTO callback_requests (callback_id, received_at, method, path, query, source_ip, user_agent, headers, body, content_type, content_length, referer, origin, cookies)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    callbackId,
    now,
    req.method,
    req.path || "/",
    req.url ? req.url.split("?")[1] || "" : "",
    req.ip || "",
    req.get("user-agent") || null,
    JSON.stringify(headers),
    body,
    req.get("content-type") || null,
    parseInt(req.get("content-length"), 10) || 0,
    req.get("referer") || null,
    req.get("origin") || null,
    req.get("cookie") || null
  );

  try {
    const { pushCallbackEvent } = require("../../callback-ws");
    pushCallbackEvent(url.user_id, { callbackId, method: req.method, sourceIp: req.ip || "" });
  } catch (_) { /* non-critical */ }

  return { captured: true };
}

function hardDeleteCallbackUrl(callbackId, userId) {
  const db = getDb();

  const url = db.prepare("SELECT id, user_id FROM callback_urls WHERE id = ?").get(callbackId);
  if (!url) return { ok: false, error: "Callback URL not found" };
  if (url.user_id !== userId) return { ok: false, error: "Access denied" };

  db.prepare("DELETE FROM callback_requests WHERE callback_id = ?").run(callbackId);
  db.prepare("DELETE FROM callback_urls WHERE id = ?").run(callbackId);
  return { ok: true };
}

module.exports = {
  EXPIRY_OPTIONS,
  MAX_LIVE_URLS,
  normalizeExpiry,
  createCallbackUrl,
  listCallbackUrls,
  getCallbackRequests,
  getRequestDetail,
  deleteCallbackUrl,
  hardDeleteCallbackUrl,
  captureRequest,
};
