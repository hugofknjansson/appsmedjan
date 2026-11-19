// People's own Apple developer accounts: connecting one (an App Store Connect API key), checking it
// against Apple, and keeping it encrypted until an upload needs it.
import crypto from 'node:crypto';
import { AppStoreConnect, StoreError } from '../../shared/appstore';
import { isIssuerId, isKeyId, isTeamId, type AppleAccount } from '../../shared/protocol';
import * as db from './db';
import { open, seal, secretsEnabled } from './secrets';

export type ConnectError =
  | 'apple_disabled' // The operator has not set SECRETS_KEY.
  | 'apple_bad_input' // Key ID, Issuer ID or Team ID is not in the expected form.
  | 'apple_key_invalid' // The file is not an App Store Connect private key.
  | 'apple_key_rejected' // Apple does not accept the key with this Key ID and Issuer ID.
  | 'apple_key_forbidden' // The key works but its role is too narrow.
  | 'apple_team_needed' // Apple did not reveal the team id; the person has to type it in.
  | 'apple_unreachable'; // Apple's API could not be reached.

export interface AccountStatus {
  /** Whether this server lets people connect their own account at all. */
  enabled: boolean;
  connected: boolean;
  teamId?: string;
  keyId?: string;
  connectedAt?: number;
}

export function accountStatus(userId: string): AccountStatus {
  if (!secretsEnabled) return { enabled: false, connected: false };
  const row = db.getAppleAccount(userId);
  if (!row) return { enabled: true, connected: false };
  return { enabled: true, connected: true, teamId: row.teamId, keyId: row.keyId, connectedAt: row.createdAt };
}

/** Reads the uploaded key and returns it in canonical PEM form, or null when it is not a usable key. */
function parseKey(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 4000 || !text.includes('PRIVATE KEY')) return null;
  try {
    const keyObject = crypto.createPrivateKey(text.trim());
    // App Store Connect keys are P-256 elliptic-curve keys.
    if (keyObject.asymmetricKeyType !== 'ec' || keyObject.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return keyObject.export({ type: 'pkcs8', format: 'pem' }) as string;
  } catch {
    return null;
  }
}

/**
 * Connects an account. The key is tried against Apple first (read-only calls), so a typo in the
 * Key ID or Issuer ID is caught here and not minutes into the first upload.
 */
export async function connectAccount(
  userId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; error: ConnectError }> {
  if (!secretsEnabled) return { ok: false, error: 'apple_disabled' };
  const input = (body ?? {}) as Record<string, unknown>;
  const keyId = typeof input.keyId === 'string' ? input.keyId.trim().toUpperCase() : '';
  const issuerId = typeof input.issuerId === 'string' ? input.issuerId.trim().toLowerCase() : '';
  const givenTeam = typeof input.teamId === 'string' ? input.teamId.trim().toUpperCase() : '';
  if (!isKeyId(keyId) || !isIssuerId(issuerId) || (givenTeam !== '' && !isTeamId(givenTeam))) {
    return { ok: false, error: 'apple_bad_input' };
  }
  const key = parseKey(input.key);
  if (!key) return { ok: false, error: 'apple_key_invalid' };

  let detected: string | null;
  try {
    detected = (await new AppStoreConnect({ keyId, issuerId, key }).probe()).teamId;
  } catch (err) {
    if (err instanceof StoreError && err.status === 401) return { ok: false, error: 'apple_key_rejected' };
    if (err instanceof StoreError && err.status === 403) return { ok: false, error: 'apple_key_forbidden' };
    console.warn(`[apple] could not check a key against App Store Connect: ${(err as Error).message}`);
    return { ok: false, error: 'apple_unreachable' };
  }
  // What the person typed wins; Apple's answer saves them from having to look it up.
  const teamId = givenTeam || detected;
  if (!teamId) return { ok: false, error: 'apple_team_needed' };

  db.setAppleAccount(userId, { teamId, keyId, issuerId, keyEnc: seal(key, userId) });
  console.log(`[apple] user ${userId} connected team ${teamId}`);
  return { ok: true };
}

export function disconnectAccount(userId: string): void {
  db.deleteAppleAccount(userId);
}

/** The account to upload with, key included. Null when none is connected or it can no longer be opened. */
export function credentialsFor(userId: string): AppleAccount | null {
  const row = db.getAppleAccount(userId);
  if (!row) return null;
  const key = open(row.keyEnc, userId);
  if (key === null) {
    console.warn(`[apple] the stored key for user ${userId} cannot be opened (was SECRETS_KEY changed?)`);
    return null;
  }
  return { teamId: row.teamId, keyId: row.keyId, issuerId: row.issuerId, key };
}
