function sendError(res, status, message, details) {
  const body = { error: message };
  if (details != null && process.env.NODE_ENV !== "production") {
    body.details = details;
  }
  return res.status(status).json(body);
}

function badRequest(res, message = "Bad request") {
  return sendError(res, 400, message);
}

function notFound(res, message = "Not found") {
  return sendError(res, 404, message);
}

function serverError(res, message = "Request failed") {
  return sendError(res, 500, message);
}

module.exports = {
  sendError,
  badRequest,
  notFound,
  serverError,
};
