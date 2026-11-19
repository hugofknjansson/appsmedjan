// Encryption for secrets kept in the database (people's App Store Connect keys).
// AES-256-GCM with a key derived from SECRETS_KEY. Without SECRETS_KEY nothing can be stored.
import crypto from 'node:crypto';
import { config } from './config';

const key = config.secretsKey ? crypto.scryptSync(config.secretsKey, 'appsmedjan.secrets.v1', 32) : null;
if (config.secretsKey && config.secretsKey.length < 32) {
  console.warn('[secrets] SECRETS_KEY is short; use a long random string (for example 64 hex characters).');
}

export const secretsEnabled = key !== null;

/**
 * Encrypts text. `context` (for example the owner's id) is bound into the result, so a value copied
 * to another row cannot be opened there.
 */
export function seal(text: string, context: string): string {
  if (!key) throw new Error('SECRETS_KEY is not set');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Returns null when the value cannot be opened: wrong key, wrong context, or tampered data. */
export function open(sealed: string, context: string): string | null {
  if (!key) return null;
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
