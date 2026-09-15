/**
 * AES-256-GCM helpers for oauth token payloads.
 * TOKEN_ENCRYPTION_KEY: 32+ char secret (hashed to 32 bytes via SHA-256).
 */
const crypto = require('crypto');

function getKeyMaterial() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (!secret || String(secret).length < 16) {
    throw new Error(
      'Missing TOKEN_ENCRYPTION_KEY (set a long random secret in .env / Vercel env)'
    );
  }
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

/**
 * @param {object|string} plaintext
 * @returns {string} base64url payload: iv.tag.ciphertext
 */
function encryptJson(plaintext) {
  const key = getKeyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.from(
    typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext),
    'utf8'
  );
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

/**
 * @param {string} packed
 * @returns {object}
 */
function decryptJson(packed) {
  const key = getKeyMaterial();
  const parts = String(packed || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

module.exports = {
  encryptJson,
  decryptJson,
  getKeyMaterial,
};
