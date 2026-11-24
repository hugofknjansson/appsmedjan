// Whose Apple developer account a person's uploads go to.
import type { AppleAccount, PublishState } from '../../shared/protocol';
import { accountStatus, credentialsFor } from './apple';
import { config } from './config';
import * as db from './db';
import * as workers from './workers';

/** True for the people who run the service. */
export function isOperator(email: string): boolean {
  return config.operatorEmails.includes(email.toLowerCase());
}

/**
 * Who may use the operator's own Apple developer account for TestFlight and the App Store: the people
 * who run the service, whose account it is, and whoever TESTFLIGHT_USERS lists besides ("*" for
 * everyone). Everyone else connects an account of their own for those things. Trying an app on one's
 * own phone is another matter: see `directRoute`.
 */
export function userMayPublish(email: string): boolean {
  const allowed = config.testflightUsers;
  return isOperator(email) || allowed.includes('*') || allowed.includes(email.toLowerCase());
}

/**
 * Whose developer account an upload from this person goes to. Their own, once connected, always wins:
 * that is the account the app should live in.
 */
export function route(owner: db.User | null): Pick<PublishState, 'account' | 'available' | 'canConnect'> {
  const own = owner ? accountStatus(owner.id) : { enabled: false, connected: false };
  if (own.connected) return { account: 'own', available: workers.canPublish('own'), canConnect: true };
  if (owner && userMayPublish(owner.email)) {
    return { account: 'operator', available: workers.canPublish('operator'), canConnect: own.enabled };
  }
  return { account: 'none', available: false, canConnect: own.enabled };
}

/**
 * Whose developer account signs apps for a person's own phones (ad hoc): their own, once connected;
 * otherwise the operator's, for everyone, when DIRECT_INSTALL is on. Trying an app on one's own phone
 * is what the operator's account is lent for. Sharing it through TestFlight or putting it on the App
 * Store takes an account of one's own (`route`).
 */
export function directRoute(owner: db.User | null): Pick<PublishState, 'account' | 'available' | 'canConnect'> {
  const own = owner ? accountStatus(owner.id) : { enabled: false, connected: false };
  if (own.connected) return { account: 'own', available: workers.canPublish('own'), canConnect: true };
  if (owner && config.directInstall) return { account: 'operator', available: workers.canPublish('operator'), canConnect: own.enabled };
  return { account: 'none', available: false, canConnect: own.enabled };
}

/**
 * The key to send along with a job for this person: their own account's, or nothing when the job
 * goes to the operator's account (whose key stays on the worker). Null when no job can be sent.
 */
export function accountFor(owner: db.User | null): { account: AppleAccount | undefined } | null {
  const routing = route(owner);
  if (routing.account === 'none' || !routing.available || !owner) return null;
  if (routing.account === 'operator') return { account: undefined };
  const credentials = credentialsFor(owner.id);
  return credentials ? { account: credentials } : null;
}
