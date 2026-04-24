const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { requireUser, optionalUser } = require("../middleware/auth");
const { attachUserAccess } = require("../middleware/permissions");
const {
  createSurvey,
  updateSurvey,
  getSurveyById,
  getSurveyByToken,
  listSurveysByOwner,
  listAllSurveys,
  replaceSurveyQuestions,
  deleteSurveyById,
  getSurveyQuestions,
  createSurveySubmission,
  hasSurveyResponseForUser,
  getSurveyResults,
  reorderSurveyQuestions,
  getSurveyStats,
  getSurveyResponseById,
} = require("../database");

const router = Router();

const surveyWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: { error: "Too many survey requests. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicSurveyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: "Too many survey responses. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const SURVEY_RESPONSE_COOKIE = "redsec_survey_response";
const SURVEY_RESPONSE_COOKIE_TTL = 7 * 24 * 60 * 60;
const SURVEY_RESPONSE_COOKIE_MAX_ENTRIES = 24;

function getSurveyResponseCookieEntries(req) {
  const cookie = req.signedCookies?.[SURVEY_RESPONSE_COOKIE];
  if (!cookie || typeof cookie !== "object" || cookie.v !== 1 || !cookie.entries || typeof cookie.entries !== "object") {
    return {};
  }
  return cookie.entries;
}

function pruneSurveyResponseEntries(entries, now = Math.floor(Date.now() / 1000)) {
  const freshEntries = Object.entries(entries || {})
    .filter(([, entry]) => entry && typeof entry === "object" && entry.issuedAt && entry.issuedAt > (now - SURVEY_RESPONSE_COOKIE_TTL))
    .sort((a, b) => (b[1].issuedAt || 0) - (a[1].issuedAt || 0))
    .slice(0, SURVEY_RESPONSE_COOKIE_MAX_ENTRIES);
  return Object.fromEntries(freshEntries);
}

function writeSurveyResponseCookie(res, entries, now = Math.floor(Date.now() / 1000)) {
  res.cookie(SURVEY_RESPONSE_COOKIE, {
    v: 1,
    entries: pruneSurveyResponseEntries(entries, now),
  }, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    signed: true,
    maxAge: SURVEY_RESPONSE_COOKIE_TTL * 1000,
    path: "/api/survey",
  });
}

function ensureSurveyResponseSession(req, res, survey, now = Math.floor(Date.now() / 1000)) {
  const entries = pruneSurveyResponseEntries(getSurveyResponseCookieEntries(req), now);
  const existing = entries[survey.id];
  if (existing && existing.sessionId && existing.issuedAt) {
    writeSurveyResponseCookie(res, entries, now);
    return { entries, session: existing };
  }

  const session = {
    sessionId: crypto.randomBytes(18).toString("base64url"),
    issuedAt: now,
    submittedAt: null,
  };
  entries[survey.id] = session;
  writeSurveyResponseCookie(res, entries, now);
  return { entries, session };
}

function canManageSurvey(req, survey) {
  return req.user.id === survey.owner_id || req.access.permissionSet.has("survey.manage_any");
}

function canViewResults(req, survey) {
  return canManageSurvey(req, survey) || req.access.permissionSet.has("survey.view_results_any");
}

function mapSurvey(survey) {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description || "",
    ownerId: survey.owner_id,
    responseMode: survey.response_mode,
    status: survey.status,
    publicToken: survey.public_token || null,
    startsAt: survey.starts_at,
    endsAt: survey.ends_at,
    createdAt: survey.created_at,
    updatedAt: survey.updated_at,
  };
}

// --- Survey CRUD ---

router.get("/survey/list", requireUser, attachUserAccess, (req, res) => {
  const surveys = (req.access.permissionSet.has("survey.manage_any") || req.access.permissionSet.has("survey.view_results_any"))
    ? listAllSurveys()
    : listSurveysByOwner(req.user.id);
  res.json({ surveys: surveys.map(mapSurvey) });
});

router.post("/survey", surveyWriteLimiter, requireUser, attachUserAccess, (req, res) => {
  if (!req.access.permissionSet.has("survey.create")) {
    return res.status(403).json({ error: "Survey create access denied" });
  }

  const { title, description, responseMode, status, startsAt, endsAt, questions } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Survey title is required" });
  }

  const id = crypto.randomBytes(16).toString("base64url");
  const shouldPublish = status === "published";
  const publicToken = shouldPublish ? crypto.randomBytes(24).toString("base64url") : null;

  createSurvey({
    id,
    title: title.trim().slice(0, 160),
    description: typeof description === "string" ? description.trim() : "",
    ownerId: req.user.id,
    responseMode: typeof responseMode === "string" ? responseMode : "anonymous_public",
    status: shouldPublish ? "published" : "draft",
    publicToken,
    startsAt: startsAt ? parseInt(startsAt, 10) : null,
    endsAt: endsAt ? parseInt(endsAt, 10) : null,
  });
  replaceSurveyQuestions(id, Array.isArray(questions) ? questions : []);
  res.json({ success: true, id, publicToken });
});

router.put("/survey/:id", surveyWriteLimiter, requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey)) {
    return res.status(403).json({ error: "Survey management denied" });
  }
  if (survey.status === "closed") {
    return res.status(409).json({ error: "Closed surveys are read-only. Clone the survey to make changes." });
  }

  const shouldPublish = req.body?.status === "published";
  updateSurvey({
    id: survey.id,
    title: typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 160) : survey.title,
    description: typeof req.body?.description === "string" ? req.body.description.trim() : survey.description,
    responseMode: typeof req.body?.responseMode === "string" ? req.body.responseMode : survey.response_mode,
    status: typeof req.body?.status === "string" ? req.body.status : survey.status,
    publicToken: shouldPublish ? (survey.public_token || crypto.randomBytes(24).toString("base64url")) : survey.public_token,
    startsAt: req.body?.startsAt ? parseInt(req.body.startsAt, 10) : survey.starts_at,
    endsAt: req.body?.endsAt ? parseInt(req.body.endsAt, 10) : survey.ends_at,
  });
  if (Array.isArray(req.body?.questions)) {
    replaceSurveyQuestions(survey.id, req.body.questions);
  }
  const refreshed = getSurveyById(survey.id);
  res.json({ success: true, survey: mapSurvey(refreshed) });
});

router.delete("/survey/:id", surveyWriteLimiter, requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey)) {
    return res.status(403).json({ error: "Survey management denied" });
  }
  deleteSurveyById(survey.id);
  res.json({ success: true });
});

router.get("/survey/:id", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey)) {
    return res.status(403).json({ error: "Survey management denied" });
  }
  res.json({
    survey: mapSurvey(survey),
    questions: getSurveyQuestions(survey.id),
  });
});

// --- Survey status lifecycle ---

router.put("/survey/:id/status", surveyWriteLimiter, requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey)) {
    return res.status(403).json({ error: "Survey management denied" });
  }
  if (survey.status === "closed") {
    return res.status(409).json({ error: "Closed surveys cannot be reopened or edited. Clone the survey to create a new draft." });
  }

  const action = req.body?.action;
  if (!["publish", "close", "end_early", "reopen"].includes(action)) {
    return res.status(400).json({ error: "Invalid action. Use publish, close, end_early, or reopen." });
  }

  const updates = { id: survey.id };
  if (action === "publish" || action === "reopen") {
    updates.status = "published";
    updates.publicToken = survey.public_token || crypto.randomBytes(24).toString("base64url");
    updates.title = survey.title;
    updates.description = survey.description;
    updates.responseMode = survey.response_mode;
    updates.startsAt = survey.starts_at;
    // Reopen: if ends_at is in the past, clear it so the survey doesn't immediately re-expire
    updates.endsAt = (action === "reopen" && survey.ends_at && survey.ends_at < Math.floor(Date.now() / 1000)) ? null : survey.ends_at;
  } else if (action === "close" || action === "end_early") {
    updates.status = "closed";
    updates.publicToken = survey.public_token;
    updates.title = survey.title;
    updates.description = survey.description;
    updates.responseMode = survey.response_mode;
    updates.startsAt = survey.starts_at;
    updates.endsAt = action === "end_early" ? Math.floor(Date.now() / 1000) : survey.ends_at;
  }

  updateSurvey(updates);
  const refreshed = getSurveyById(survey.id);
  res.json({ success: true, survey: mapSurvey(refreshed) });
});

// --- Question reorder ---

router.put("/survey/:id/questions/reorder", surveyWriteLimiter, requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey)) {
    return res.status(403).json({ error: "Survey management denied" });
  }
  if (survey.status === "closed") {
    return res.status(409).json({ error: "Closed surveys are read-only. Clone the survey to make changes." });
  }

  const order = req.body?.order;
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: "Order array is required" });
  }

  try {
    reorderSurveyQuestions(survey.id, order);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Stats ---

router.get("/survey/:id/stats", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canViewResults(req, survey)) {
    return res.status(403).json({ error: "Survey stats access denied" });
  }
  res.json({
    survey: mapSurvey(survey),
    stats: getSurveyStats(survey.id),
  });
});

// --- Results ---

router.get("/survey/:id/results", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canViewResults(req, survey)) {
    return res.status(403).json({ error: "Survey results access denied" });
  }
  res.json({
    survey: mapSurvey(survey),
    questions: getSurveyQuestions(survey.id),
    results: getSurveyResults(survey.id),
  });
});

router.get("/survey/:id/results/export", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canViewResults(req, survey)) {
    return res.status(403).json({ error: "Survey results access denied" });
  }

  const questions = getSurveyQuestions(survey.id);
  const results = getSurveyResults(survey.id);

  // Build CSV
  const headers = ["Responder", "Submitted"];
  const questionMap = new Map();
  questions.forEach((q, i) => {
    const label = "Q" + (i + 1) + ": " + q.questionText.replace(/"/g, '""');
    headers.push(label);
    questionMap.set(q.id, i);
  });

  const rows = [headers.map((h) => '"' + h + '"').join(",")];

  // Index answers by response
  const answersByResponse = new Map();
  for (const answer of results.answers) {
    if (!answersByResponse.has(answer.responseId)) answersByResponse.set(answer.responseId, []);
    answersByResponse.get(answer.responseId).push(answer);
  }

  for (const response of results.responses) {
    const row = [
      '"' + (response.responderName || "Anonymous").replace(/"/g, '""') + '"',
      '"' + new Date(response.submittedAt * 1000).toISOString() + '"',
    ];
    const blanks = questions.map(() => '""');
    const responseAnswers = answersByResponse.get(response.id) || [];
    for (const answer of responseAnswers) {
      const idx = questionMap.get(answer.questionId);
      if (idx !== undefined) {
        const value = answer.answerJson
          ? JSON.stringify(answer.answerJson).replace(/"/g, '""')
          : (answer.answerText || "").replace(/"/g, '""');
        blanks[idx] = '"' + value + '"';
      }
    }
    rows.push(row.concat(blanks).join(","));
  }

  const csv = rows.join("\n");
  const filename = "survey-" + survey.id.slice(0, 8) + ".csv";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
  res.send(csv);
});

// --- Single response detail ---

router.get("/survey/:id/responses/:responseId", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canViewResults(req, survey)) {
    return res.status(403).json({ error: "Survey results access denied" });
  }
  const response = getSurveyResponseById(req.params.responseId);
  if (!response || response.surveyId !== survey.id) {
    return res.status(404).json({ error: "Response not found" });
  }
  res.json({ response });
});

// --- Public response flow ---

router.get("/survey/respond/:token", optionalUser, (req, res) => {
  const survey = getSurveyByToken(req.params.token);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  const now = Math.floor(Date.now() / 1000);
  if (survey.status !== "published" || (survey.starts_at && survey.starts_at > now) || (survey.ends_at && survey.ends_at < now)) {
    return res.status(410).json({ error: "Survey is not accepting responses" });
  }
  if (survey.response_mode === "internal_named" && !req.user) {
    return res.status(401).json({ error: "Login required" });
  }
  ensureSurveyResponseSession(req, res, survey, now);
  res.json({
    survey: mapSurvey(survey),
    questions: getSurveyQuestions(survey.id),
  });
});

router.post("/survey/respond/:token", publicSurveyLimiter, optionalUser, (req, res) => {
  const survey = getSurveyByToken(req.params.token);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  const now = Math.floor(Date.now() / 1000);
  if (survey.status !== "published" || (survey.starts_at && survey.starts_at > now) || (survey.ends_at && survey.ends_at < now)) {
    return res.status(410).json({ error: "Survey is not accepting responses" });
  }
  if (survey.response_mode === "internal_named" && !req.user) {
    return res.status(401).json({ error: "Login required" });
  }
  if (req.user && hasSurveyResponseForUser(survey.id, req.user.id)) {
    return res.status(409).json({ error: "You have already submitted a response to this survey." });
  }

  const entries = pruneSurveyResponseEntries(getSurveyResponseCookieEntries(req), now);
  const session = entries[survey.id];
  if (!session || !session.sessionId) {
    return res.status(400).json({ error: "Survey session expired. Re-open the survey link and try again." });
  }
  if (session.submittedAt) {
    return res.status(409).json({ error: "This browser session has already submitted a response." });
  }

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

  // Validate required questions
  const questions = getSurveyQuestions(survey.id);
  for (const question of questions) {
    if (!question.isRequired) continue;
    const answer = answers.find((a) => a.questionId === question.id);
    const hasValue = answer && (
      (typeof answer.answerText === "string" && answer.answerText.trim()) ||
      (Array.isArray(answer.answerJson) && answer.answerJson.length)
    );
    if (!hasValue) {
      return res.status(400).json({ error: 'Required question "' + question.questionText + '" is missing an answer' });
    }
  }

  const responseId = crypto.randomBytes(16).toString("base64url");
  createSurveySubmission({
    id: responseId,
    surveyId: survey.id,
    responderUserId: req.user?.id || null,
    responderName: survey.response_mode === "anonymous_public"
      ? null
      : (req.user?.username || (typeof req.body?.responderName === "string" ? req.body.responderName.trim().slice(0, 120) : null)),
    sourceIp: req.ip,
    answers: answers.map((answer) => ({
      questionId: answer.questionId,
      answerText: typeof answer.answerText === "string" ? answer.answerText : null,
      answerJson: answer.answerJson || null,
    })),
  });
  entries[survey.id] = {
    ...session,
    submittedAt: now,
  };
  writeSurveyResponseCookie(res, entries, now);
  res.json({ success: true });
});

module.exports = router;
