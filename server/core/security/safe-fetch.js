const { assertPublicHttpUrl } = require("./fetch-targets");

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1024 * 1024;

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

async function safeFetchPublicUrl(targetUrl, options = {}) {
  const {
    allowPorts = null,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...fetchOptions
  } = options;
  let currentUrl = targetUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const parsed = await assertPublicHttpUrl(currentUrl, { allowPorts });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsed.href, {
        ...fetchOptions,
        redirect: "manual",
        signal: fetchOptions.signal || controller.signal,
      });

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirect missing location");
        if (redirectCount === maxRedirects) throw new Error("Too many redirects");
        currentUrl = new URL(location, parsed.href).href;
        continue;
      }

      return { response, finalUrl: parsed.href };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Too many redirects");
}

async function readResponseBufferWithLimit(response, maxBytes = DEFAULT_MAX_BYTES) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error("Response body is too large");
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("Response body is too large");
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        throw new Error("Response body is too large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function readResponseTextWithLimit(response, maxBytes = DEFAULT_MAX_BYTES) {
  return (await readResponseBufferWithLimit(response, maxBytes)).toString("utf8");
}

module.exports = {
  safeFetchPublicUrl,
  readResponseBufferWithLimit,
  readResponseTextWithLimit,
};
