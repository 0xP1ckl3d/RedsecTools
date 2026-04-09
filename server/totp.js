// RedSecTools — Server-side TOTP implementation (RFC 6238)
// Uses Node.js crypto only — zero dependencies

const crypto = require("crypto");

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    result += BASE32_CHARS[parseInt(bits.substring(i, i + 5), 2)];
  }
  return result;
}

function base32Decode(str) {
  str = str.replace(/[\s=]+/g, "").toUpperCase();
  let bits = "";
  for (const c of str) {
    const val = BASE32_CHARS.indexOf(c);
    if (val === -1) throw new Error("Invalid base32 character: " + c);
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTOTPCode(secret, timeOffset) {
  const decoded = base32Decode(secret);
  const T = Math.floor(Date.now() / 30000) + (timeOffset || 0);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(Math.floor(T / 0x100000000), 0);
  timeBuffer.writeUInt32BE(T & 0xffffffff, 4);
  const hmac = crypto.createHmac("sha1", decoded).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, "0");
}

function verifyTOTP(secret, code, driftWindow) {
  if (typeof driftWindow !== "number") driftWindow = 1;
  if (!code || code.length !== 6) return false;
  for (let i = -driftWindow; i <= driftWindow; i++) {
    if (generateTOTPCode(secret, i) === code) return true;
  }
  return false;
}

function generateRecoveryCodes(count) {
  if (!count) count = 10;
  const codes = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(5);
    let code = "";
    for (const b of bytes) code += BASE32_CHARS[b % 32];
    codes.push(code);
  }
  return codes;
}

function buildProvisioningURI(secret, email) {
  return (
    "otpauth://totp/RedSecTools:" +
    encodeURIComponent(email) +
    "?secret=" +
    secret +
    "&issuer=RedSecTools"
  );
}

module.exports = {
  generateSecret,
  verifyTOTP,
  generateRecoveryCodes,
  buildProvisioningURI,
};
