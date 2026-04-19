const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBase64Strict(value) {
  if (typeof value !== "string") {
    throw new Error("Value must be a string");
  }
  if (!value.length) {
    throw new Error("Value is empty");
  }
  if (value.length % 4 !== 0 || !BASE64_REGEX.test(value)) {
    throw new Error("Value is not valid base64");
  }

  const decoded = Buffer.from(value, "base64");
  if (!decoded.length && value !== "") {
    throw new Error("Value is not valid base64");
  }

  // Canonicalize by re-encoding to standard padded base64.
  if (decoded.toString("base64") !== value) {
    throw new Error("Value is not valid canonical base64");
  }

  return decoded;
}

module.exports = {
  decodeBase64Strict,
};
