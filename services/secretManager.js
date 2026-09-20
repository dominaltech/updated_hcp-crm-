/**
 * Server-Side Secret Management & Encryption Utility
 * 
 * Provides AES-256-GCM encryption and decryption for sensitive secrets
 * (such as the Gemini API Key) stored in the database.
 * Never exposes raw secret values to the frontend.
 */
const crypto = require('crypto');
const os = require('os');

// Server secret key derived from environment or machine-specific fallback
const MASTER_SECRET = process.env.APP_SECRET || process.env.JWT_SECRET || ('hotel_city_park_master_secret_' + os.hostname());
const ENCRYPTION_KEY = crypto.createHash('sha256').update(MASTER_SECRET).digest(); // 32 bytes for AES-256
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Encrypt a plaintext secret string using AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} Encrypted string in format "enc:iv:authTag:ciphertext"
 */
function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return '';
  const clean = plaintext.trim();
  if (!clean) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(clean, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted secret string.
 * If the string is legacy plaintext, returns it as-is.
 * @param {string} cipherString
 * @returns {string} Plaintext secret or empty string on error
 */
function decryptSecret(cipherString) {
  if (!cipherString || typeof cipherString !== 'string') return '';
  const trimmed = cipherString.trim();
  if (!trimmed) return '';

  // If not encrypted format, return as legacy plaintext
  if (!trimmed.startsWith('enc:')) {
    return trimmed;
  }

  try {
    const parts = trimmed.split(':');
    if (parts.length !== 4) return '';
    const [, ivHex, authTagHex, encryptedHex] = parts;

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[SecretManager] Decryption failed:', err.message);
    return '';
  }
}

/**
 * Mask a secret string for safe display in UI or logs.
 * e.g., "AIzaSyMockExampleKeyForTestingOnly_12345" -> "AIza****2345"
 * @param {string} secret
 * @returns {string} Masked string
 */
function maskSecret(secret) {
  if (!secret || typeof secret !== 'string') return '';
  const clean = secret.trim();
  if (!clean) return '';
  if (clean.length <= 8) return '********';
  return `${clean.substring(0, 4)}****${clean.substring(clean.length - 4)}`;
}

/**
 * Check if a string is stored in encrypted format.
 * @param {string} str
 * @returns {boolean}
 */
function isEncrypted(str) {
  return typeof str === 'string' && str.startsWith('enc:');
}

/**
 * Migrate any legacy plaintext secrets in database to encrypted storage.
 * @param {object} db - SQLite database connection
 * @returns {boolean} true if migration was performed
 */
function migrateDatabaseSecrets(db) {
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get('gemini_api_key');
    if (row && row.value && !isEncrypted(row.value)) {
      const plaintext = row.value.trim();
      const encrypted = encryptSecret(plaintext);
      db.prepare('UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
        .run(encrypted, 'gemini_api_key');
      console.log('[SecretManager] Encrypted legacy plaintext Gemini API key in database.');
      return true;
    }
  } catch (err) {
    console.warn('[SecretManager] Secret migration warning:', err.message);
  }
  return false;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  maskSecret,
  isEncrypted,
  migrateDatabaseSecrets
};
