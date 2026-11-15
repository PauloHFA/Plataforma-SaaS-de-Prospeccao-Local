import crypto from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function resolveKeyBuffer(masterKeyHex?: string): Buffer {
  const hex = (masterKeyHex || process.env.ENCRYPTION_MASTER_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  if (hex.length >= 32) {
    return crypto.createHash('sha256').update(hex, 'utf8').digest();
  }
  throw new Error('ENCRYPTION_MASTER_KEY inválida: defina 64 caracteres hexadecimais (AES-256).');
}

export function encryptSecret(plaintext: string, masterKeyHex?: string): EncryptedPayload {
  const key = resolveKeyBuffer(masterKeyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(payload: EncryptedPayload, masterKeyHex?: string): string {
  const key = resolveKeyBuffer(masterKeyHex);
  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function signHmacSha256(rawBody: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyHmacSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const cleanHeader = signatureHeader.trim();

  // Support Stripe format: "t=1700000000,v1=abcdef..."
  if (cleanHeader.includes('v1=')) {
    const parts = Object.fromEntries(
      cleanHeader.split(',').map((pair) => {
        const idx = pair.indexOf('=');
        return idx === -1 ? [pair, ''] : [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()];
      }),
    );
    const timestamp = parts.t;
    const v1 = parts.v1;
    if (!timestamp || !v1) return false;
    const signedPayload = `${timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
    const expected = signHmacSha256(signedPayload, secret);
    return safeHexEqual(v1, expected);
  }

  // Support "sha256=<hex>" or raw "<hex>"
  const providedHex = cleanHeader.replace(/^sha256=/i, '');
  const expectedHex = signHmacSha256(rawBody, secret);
  return safeHexEqual(providedHex, expectedHex);
}

function safeHexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(a) || !/^[0-9a-fA-F]+$/.test(b)) return false;
  const bufA = Buffer.from(a.toLowerCase(), 'hex');
  const bufB = Buffer.from(b.toLowerCase(), 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function generateSecureToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export { sanitizePlainText } from './sanitize.js';
