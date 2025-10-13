import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return iv.toString('hex') + authTag.toString('hex') + encrypted;
}

export function decrypt(encryptedData) {
  const key = getKey();
  const iv = Buffer.from(encryptedData.slice(0, 32), 'hex');
  const authTag = Buffer.from(encryptedData.slice(32, 64), 'hex');
  const encrypted = encryptedData.slice(64);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
