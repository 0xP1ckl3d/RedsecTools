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
  getSurveyResults,
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

function canManageSurvey(req, survey) {
  return req.user.id === survey.owner_id || req.access.permissionSet.has("survey.manage_any");
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

router.get("/survey/list", requireUser, attachUserAccess, (req, res) => {
  const surveys = req.access.permissionSet.has("survey.manage_any")
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

router.get("/survey/:id/results", requireUser, attachUserAccess, (req, res) => {
  const survey = getSurveyById(req.params.id);
  if (!survey) return res.status(404).json({ error: "Survey not found" });
  if (!canManageSurvey(req, survey) && !req.access.permissionSet.has("survey.view_results_any")) {
    return res.status(403).json({ error: "Survey results access denied" });
  }
  res.json({
    survey: mapSurvey(survey),
    questions: getSurveyQuestions(survey.id),
    results: getSurveyResults(survey.id),
  });
});

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

  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
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
  res.json({ success: true });
});

module.exports = router;
