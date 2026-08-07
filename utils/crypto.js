const crypto = require("crypto");

const algorithm = "aes-256-gcm";
const keyLength = 32;
const ivLength = 12;
const tagLength = 16;

const getMasterKey = () => {
  const envKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!envKey) {
    throw new Error("ENCRYPTION_MASTER_KEY not set in environment");
  }
  // Derive 32-byte key from env string (supports hex or base64)
  if (envKey.length === 64) {
    return Buffer.from(envKey, "hex");
  }
  if (envKey.length === 44) {
    return Buffer.from(envKey, "base64");
  }
  // Fallback: hash the string to 32 bytes
  return crypto.createHash("sha256").update(envKey).digest();
};

const encrypt = (plaintext) => {
  if (!plaintext) return null;
  const key = getMasterKey();
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Return iv + ciphertext + authTag as base64
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
};

const decrypt = (encrypted) => {
  if (!encrypted) return null;
  const key = getMasterKey();
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, ivLength);
  const authTag = buf.subarray(buf.length - tagLength);
  const ciphertext = buf.subarray(ivLength, buf.length - tagLength);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
};

module.exports = { encrypt, decrypt };