// Notifications to the App Dance app on people's phones, through Apple's push service (APNs), for
// when the app is not open: "the app is ready, tap to install it".
//
// Apple accepts a request signed with a key made for push in the developer account (an APNs key,
// not the App Store Connect key): APNS_KEY holds the key itself (the .p8 file's contents),
// APNS_KEY_ID its id, and APNS_TEAM_ID the team. Without them nothing is sent, and the app on the
// phone is only reached while it is open.
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { config } from './config';
import * as db from './db';

const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const;
type Host = keyof typeof HOSTS;

export function enabled(): boolean {
  return Boolean(config.apnsKey && config.apnsKeyId && config.apnsTeamId);
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** The signed token Apple asks for. It is good for an hour, and Apple turns away new ones made too often, so it is kept for 50 minutes. */
let signed: { token: string; at: number } | null = null;
function bearer(): string {
  if (signed && Date.now() - signed.at < 50 * 60_000) return signed.token;
  const head = base64url(JSON.stringify({ alg: 'ES256', kid: config.apnsKeyId }));
  const claims = base64url(JSON.stringify({ iss: config.apnsTeamId, iat: Math.floor(Date.now() / 1000) }));
  const signature = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: config.apnsKey, dsaEncoding: 'ieee-p1363' });
  signed = { token: `${head}.${claims}.${base64url(signature)}`, at: Date.now() };
  return signed.token;
}

/** One connection to each of Apple's hosts, kept open as Apple asks, and opened again when it closes. */
const sessions = new Map<Host, http2.ClientHttp2Session>();
function session(host: Host): http2.ClientHttp2Session {
  const open = sessions.get(host);
  if (open && !open.closed && !open.destroyed) return open;
  const made = http2.connect(HOSTS[host]);
  made.on('error', (err) => console.warn(`[push] connection to ${host}: ${err.message}`));
  made.on('close', () => sessions.delete(host));
  sessions.set(host, made);
  return made;
}

function sendOne(token: string, host: Host, payload: object): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    let request: http2.ClientHttp2Stream;
    try {
      request = session(host).request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${bearer()}`,
        'apns-topic': config.apnsTopic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (err) {
      resolve({ status: 0, reason: (err as Error).message });
      return;
    }
    let status = 0;
    let body = '';
    request.setTimeout(10_000, () => request.close(http2.constants.NGHTTP2_CANCEL));
    request.on('response', (headers) => (status = Number(headers[':status'])));
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      let reason: string | undefined;
      try {
        reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
      } catch {
        reason = undefined;
      }
      resolve({ status, reason });
    });
    request.on('error', (err) => resolve({ status: 0, reason: err.message }));
    request.end(JSON.stringify(payload));
  });
}

/** What a notification says, in each language the app speaks. */
export interface Notice {
  title: Record<'sv' | 'en', string>;
  body: Record<'sv' | 'en', string>;
  /** Handed to the app when the notification is tapped. */
  data: Record<string, string>;
}

/**
 * Notifies every phone the person has the app signed in on. True when Apple took it for at least one
 * of them. A phone Apple says no longer has the app is forgotten.
 */
export async function notify(userId: string, notice: Notice): Promise<boolean> {
  if (!enabled()) return false;
  let reached = false;
  for (const phone of db.pushTokensOf(userId)) {
    const lang = phone.lang === 'en' ? 'en' : 'sv';
    const payload = { aps: { alert: { title: notice.title[lang], body: notice.body[lang] }, sound: 'default' }, ...notice.data };
    const { status, reason } = await sendOne(phone.token, phone.sandbox ? 'sandbox' : 'production', payload);
    if (status === 200) {
      reached = true;
    } else if (status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered') {
      db.deletePushToken(phone.token);
    } else {
      console.warn(`[push] user ${userId}: Apple answered ${status} ${reason ?? ''}`);
    }
  }
  return reached;
}

/** A phone's address for notifications, as iOS gives it: a long hexadecimal string. */
export function isPushToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64,200}$/i.test(value);
}
