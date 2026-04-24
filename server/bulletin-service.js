const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sanitizeBulletinHtml, extractBulletinAssetIds, normalizeBulletinPresentation } = require("./rich-content");
const {
  BULLETIN_ASSETS_DIR,
  attachBulletinAssetToBulletin,
  deleteBulletinAssetById,
  deleteBulletinById,
  getBulletinAssetById,
  getBulletinById,
  getSetting,
  listAllBulletins,
  listBulletinAssetsByBulletinId,
  listOrphanedBulletinAssetsOlderThan,
  setSetting,
} = require("./database");

const DAY_MS = 24 * 60 * 60;
const DEFAULT_OCCURRENCE_DURATION_MINUTES = 24 * 60;

function parseRecurrenceConfig(config) {
  if (!config) {
    return {
      interval: 1,
      weekdays: [],
      durationMinutes: DEFAULT_OCCURRENCE_DURATION_MINUTES,
    };
  }

  const interval = Math.max(1, parseInt(config.interval, 10) || 1);
  const weekdays = Array.isArray(config.weekdays)
    ? [...new Set(config.weekdays.map((value) => parseInt(value, 10)).filter((value) => value >= 0 && value <= 6))].sort()
    : [];
  const durationMinutes = Math.max(5, parseInt(config.durationMinutes, 10) || DEFAULT_OCCURRENCE_DURATION_MINUTES);

  return {
    interval,
    weekdays,
    durationMinutes,
  };
}

function normalizeBulletinPayload(body) {
  const { stylePreset, animationPreset } = normalizeBulletinPresentation(body, "default", "none");
  const recurrenceType = typeof body?.recurrenceType === "string" ? body.recurrenceType : "none";
  const recurrenceConfig = parseRecurrenceConfig(body?.recurrenceConfig || {});
  const parsedPinStartsAt = normalizeUnix(body?.pinStartsAt);
  const parsedPinEndsAt = normalizeUnix(body?.pinEndsAt);
  const isPinned = body?.isPinned === true
    || body?.isPinned === "true"
    || parsedPinStartsAt !== null
    || parsedPinEndsAt !== null;

  return {
    title: String(body?.title || "").trim().slice(0, 160),
    bodyHtml: sanitizeBulletinHtml(body?.bodyHtml || ""),
    bodySource: typeof body?.bodySource === "string" ? body.bodySource : (body?.bodyHtml || ""),
    status: "published",
    startsAt: normalizeUnix(body?.startsAt),
    endsAt: normalizeUnix(body?.endsAt),
    pinStartsAt: parsedPinStartsAt,
    pinEndsAt: parsedPinEndsAt,
    isPinned,
    recurrenceType: ["none", "daily", "weekly"].includes(recurrenceType) ? recurrenceType : "none",
    recurrenceConfig,
    stylePreset,
    animationPreset,
  };
}

function normalizeUnix(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getScheduleInfo(bulletin, now = Math.floor(Date.now() / 1000)) {
  if (!bulletin || bulletin.status !== "published") {
    return { isVisible: false, isPinned: false, sortAt: bulletin?.createdAt || 0, occurrenceStart: null, occurrenceEnd: null };
  }

  const recurrenceType = bulletin.recurrenceType || "none";
  const recurrenceConfig = parseRecurrenceConfig(bulletin.recurrenceConfig);
  const startsAt = bulletin.startsAt || bulletin.createdAt;
  const endsAt = bulletin.endsAt || null;

  let occurrenceStart = startsAt;
  let occurrenceEnd = endsAt;
  let isVisible = false;

  if (recurrenceType === "none") {
    isVisible = (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
  } else if (recurrenceType === "daily") {
    const latest = findLatestDailyOccurrence(startsAt, now, recurrenceConfig, endsAt);
    if (latest) {
      occurrenceStart = latest;
      occurrenceEnd = latest + (recurrenceConfig.durationMinutes * 60);
      if (endsAt !== null && occurrenceEnd > endsAt) occurrenceEnd = endsAt;
      isVisible = now >= occurrenceStart && now <= occurrenceEnd && (!endsAt || occurrenceStart <= endsAt);
    }
  } else if (recurrenceType === "weekly") {
    const latest = findLatestWeeklyOccurrence(startsAt, now, recurrenceConfig, endsAt);
    if (latest) {
      occurrenceStart = latest;
      occurrenceEnd = latest + (recurrenceConfig.durationMinutes * 60);
      if (endsAt !== null && occurrenceEnd > endsAt) occurrenceEnd = endsAt;
      isVisible = now >= occurrenceStart && now <= occurrenceEnd && (!endsAt || occurrenceStart <= endsAt);
    }
  }

  const isPinned = isVisible
    && bulletin.pinStartsAt !== null
    && bulletin.pinStartsAt <= now
    && (bulletin.pinEndsAt === null || bulletin.pinEndsAt >= now);

  return {
    isVisible,
    isPinned,
    sortAt: occurrenceStart || startsAt || bulletin.createdAt,
    occurrenceStart,
    occurrenceEnd,
  };
}

function findLatestDailyOccurrence(anchor, now, recurrenceConfig, overallEndAt) {
  if (!anchor || anchor > now) return null;

  const interval = recurrenceConfig.interval || 1;
  const sinceAnchor = now - anchor;
  const elapsedDays = Math.floor(sinceAnchor / DAY_MS);
  const stepDays = Math.floor(elapsedDays / interval) * interval;
  const latest = anchor + (stepDays * DAY_MS);

  if (overallEndAt && latest > overallEndAt) return null;
  return latest;
}

function findLatestWeeklyOccurrence(anchor, now, recurrenceConfig, overallEndAt) {
  if (!anchor || anchor > now) return null;

  const interval = recurrenceConfig.interval || 1;
  const allowedWeekdays = recurrenceConfig.weekdays.length
    ? recurrenceConfig.weekdays
    : [new Date(anchor * 1000).getDay()];
  const anchorDate = new Date(anchor * 1000);
  const anchorHour = anchorDate.getHours();
  const anchorMinute = anchorDate.getMinutes();
  const anchorSecond = anchorDate.getSeconds();

  for (let offsetDays = 0; offsetDays <= 370; offsetDays++) {
    const candidateDayTs = now - (offsetDays * DAY_MS);
    if (candidateDayTs < anchor) break;
    const candidateDate = new Date(candidateDayTs * 1000);
    if (!allowedWeekdays.includes(candidateDate.getDay())) continue;

    const weeksSinceAnchor = Math.floor((startOfDay(candidateDayTs) - startOfDay(anchor)) / (7 * DAY_MS));
    if (weeksSinceAnchor < 0 || weeksSinceAnchor % interval !== 0) continue;

    const occurrenceDate = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate(), anchorHour, anchorMinute, anchorSecond);
    const occurrenceTs = Math.floor(occurrenceDate.getTime() / 1000);

    if (occurrenceTs < anchor || occurrenceTs > now) continue;
    if (overallEndAt && occurrenceTs > overallEndAt) continue;
    return occurrenceTs;
  }

  return null;
}

function startOfDay(unix) {
  const date = new Date(unix * 1000);
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000);
}

function buildVisibleBulletinFeed(bulletins, page = 1, limit = 20, now = Math.floor(Date.now() / 1000)) {
  const visible = bulletins
    .map((bulletin) => {
      const schedule = getScheduleInfo(bulletin, now);
      return {
        ...bulletin,
        isPinned: schedule.isPinned,
        sortAt: schedule.sortAt,
        occurrenceStart: schedule.occurrenceStart,
        occurrenceEnd: schedule.occurrenceEnd,
        currentlyVisible: schedule.isVisible,
      };
    })
    .filter((bulletin) => bulletin.currentlyVisible)
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if ((b.sortAt || 0) !== (a.sortAt || 0)) return (b.sortAt || 0) - (a.sortAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

  const offset = (Math.max(1, page) - 1) * limit;
  return {
    total: visible.length,
    bulletins: visible.slice(offset, offset + limit),
  };
}

function canEditBulletin(req, bulletin) {
  if (!req?.user || !bulletin) return false;
  const permissionSet = req.access?.permissionSet || new Set();
  if (permissionSet.has("bulletin.manage") || permissionSet.has("bulletin.edit_any")) {
    return true;
  }
  return bulletin.authorId === req.user.id && permissionSet.has("bulletin.create");
}

function canDeleteBulletin(req, bulletin) {
  if (!req?.user || !bulletin) return false;
  const permissionSet = req.access?.permissionSet || new Set();
  if (permissionSet.has("bulletin.manage")) {
    return true;
  }
  return bulletin.authorId === req.user.id && permissionSet.has("bulletin.create");
}

function sanitizeBulletinForSave(req, body, existingBulletin = null) {
  const payload = normalizeBulletinPayload(body);
  payload.status = "published";

  if (!req.access?.permissionSet?.has("bulletin.pin")) {
    payload.pinStartsAt = null;
    payload.pinEndsAt = null;
  } else if (payload.isPinned) {
    payload.pinStartsAt = existingBulletin?.pinStartsAt || Math.floor(Date.now() / 1000);
    payload.pinEndsAt = null;
  } else {
    payload.pinStartsAt = null;
    payload.pinEndsAt = null;
  }

  return payload;
}

function buildBulletinCapabilities(req) {
  const permissionSet = req?.access?.permissionSet || new Set();
  return {
    canView: permissionSet.has("bulletin.view"),
    canCreate: permissionSet.has("bulletin.create"),
    canPin: permissionSet.has("bulletin.pin"),
    canEditAny: permissionSet.has("bulletin.edit_any"),
    canManage: permissionSet.has("bulletin.manage"),
  };
}

function generateBulletinId() {
  return crypto.randomBytes(16).toString("base64url");
}

function attachAssetsForBulletin(authorId, bulletinId, bodyHtml) {
  const assetIds = extractBulletinAssetIds(bodyHtml);
  for (const assetId of assetIds) {
    const asset = getBulletinAssetById(assetId);
    if (asset && asset.author_id === authorId) {
      attachBulletinAssetToBulletin(asset.id, bulletinId, authorId);
    }
  }
}

function collectAssetIdsForBulletin(bulletin) {
  const assetIds = new Set(extractBulletinAssetIds(bulletin?.bodyHtml || ""));
  for (const asset of listBulletinAssetsByBulletinId(bulletin.id)) {
    assetIds.add(asset.id);
  }
  return [...assetIds];
}

function removeBulletinAsset(assetId) {
  const asset = getBulletinAssetById(assetId);
  if (!asset) return false;
  try {
    fs.unlinkSync(path.join(BULLETIN_ASSETS_DIR, asset.filename));
  } catch {}
  deleteBulletinAssetById(assetId);
  return true;
}

function deleteBulletinWithAssets(bulletinId) {
  const bulletin = getBulletinById(bulletinId);
  if (!bulletin) return false;

  for (const assetId of collectAssetIdsForBulletin(bulletin)) {
    removeBulletinAsset(assetId);
  }

  deleteBulletinById(bulletin.id);
  return true;
}

function purgeBulletinsByAuthor(authorId) {
  let deleted = 0;
  for (const bulletin of listAllBulletins().filter((entry) => entry.authorId === authorId)) {
    if (deleteBulletinWithAssets(bulletin.id)) deleted += 1;
  }
  return deleted;
}

function purgeAllBulletins() {
  let deleted = 0;
  for (const bulletin of listAllBulletins()) {
    if (deleteBulletinWithAssets(bulletin.id)) deleted += 1;
  }
  return deleted;
}

function getBulletinRetentionSettings() {
  return {
    autoPurgeEnabled: getSetting("bulletin_auto_purge_enabled") === "true",
    autoPurgeDays: Math.max(1, parseInt(getSetting("bulletin_auto_purge_days"), 10) || 90),
  };
}

function updateBulletinRetentionSettings(payload) {
  const autoPurgeEnabled = !!payload?.autoPurgeEnabled;
  const autoPurgeDays = Math.max(1, parseInt(payload?.autoPurgeDays, 10) || 90);

  setSetting("bulletin_auto_purge_enabled", autoPurgeEnabled ? "true" : "false");
  setSetting("bulletin_auto_purge_days", String(autoPurgeDays));

  return {
    autoPurgeEnabled,
    autoPurgeDays,
  };
}

function runBulletinAutoPurge(now = Math.floor(Date.now() / 1000)) {
  const settings = getBulletinRetentionSettings();
  let deletedBulletins = 0;
  let deletedAssets = 0;

  if (settings.autoPurgeEnabled) {
    const bulletinCutoff = now - (settings.autoPurgeDays * DAY_MS);
    for (const bulletin of listAllBulletins()) {
      const pinned = bulletin.pinStartsAt !== null || bulletin.pinEndsAt !== null;
      const recurring = bulletin.recurrenceType && bulletin.recurrenceType !== "none";
      if (pinned || recurring) continue;
      if ((bulletin.createdAt || 0) > bulletinCutoff) continue;
      if (deleteBulletinWithAssets(bulletin.id)) deletedBulletins += 1;
    }
  }

  const ASSET_AUTO_PURGE_DAYS = 30;
  const assetCutoff = now - (ASSET_AUTO_PURGE_DAYS * DAY_MS);
  for (const asset of listOrphanedBulletinAssetsOlderThan(assetCutoff)) {
    if (removeBulletinAsset(asset.id)) deletedAssets += 1;
  }

  return {
    deletedBulletins,
    deletedAssets,
    ...settings,
  };
}

module.exports = {
  attachAssetsForBulletin,
  buildBulletinCapabilities,
  buildVisibleBulletinFeed,
  canEditBulletin,
  canDeleteBulletin,
  deleteBulletinWithAssets,
  extractBulletinAssetIds,
  generateBulletinId,
  getBulletinRetentionSettings,
  getScheduleInfo,
  normalizeBulletinPayload,
  parseRecurrenceConfig,
  purgeAllBulletins,
  purgeBulletinsByAuthor,
  runBulletinAutoPurge,
  sanitizeBulletinForSave,
  updateBulletinRetentionSettings,
};
