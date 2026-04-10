const https = require("https");
const http = require("http");

/**
 * HTTP GET with forced IPv4 to avoid IPv6 timeouts on some systems.
 * Returns parsed JSON response.
 */
function httpGetJSON(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      family: 4,
      timeout,
      headers: { "User-Agent": "RedSecTools/1.0" },
    };

    const req = lib.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid JSON"));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

module.exports = { httpGetJSON };
