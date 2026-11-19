// The App Store Connect API calls the service needs: checking that a key works, registering an app's
// bundle id, and checking that the app itself exists. Apple offers no API for creating the app; that
// step stays manual. Node only (server and worker); the web client never loads this file.
import crypto from 'node:crypto';

const DEFAULT_API = 'https://api.appstoreconnect.apple.com';
const TOKEN_LIFETIME_S = 10 * 60;

export class StoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** A short-lived ES256 token in the form App Store Connect expects. */
export function signToken(keyPem: string, keyId: string, issuerId: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + TOKEN_LIFETIME_S, aud: 'appstoreconnect-v1' }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: keyPem, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${base64url(signature)}`;
}

/** The identifier's description may only hold letters, digits and spaces. */
export function bundleIdName(appName: string, projectId: string): string {
  const plain = appName.normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return `Appsmedjan ${plain ? `${plain} ` : ''}${projectId}`;
}

interface Resource {
  attributes?: { identifier?: string; bundleId?: string; seedId?: string };
}

export interface StoreKey {
  keyId: string;
  issuerId: string;
  /** The private key as PEM text, or a way to load it when it is needed. */
  key: string | (() => Promise<string>);
}

export class AppStoreConnect {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: StoreKey,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Tests point this at a stand-in for Apple's API. */
    private readonly api: string = process.env.ASC_API_URL || DEFAULT_API,
  ) {}

  private async token(): Promise<string> {
    // Reused until shortly before it runs out.
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    const pem = typeof this.cfg.key === 'string' ? this.cfg.key : await this.cfg.key();
    const token = signToken(pem, this.cfg.keyId, this.cfg.issuerId);
    this.cached = { token, expiresAt: Date.now() + TOKEN_LIFETIME_S * 1000 };
    return token;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: Resource[] }> {
    const res = await this.fetchImpl(this.api + path, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: Resource | Resource[];
      errors?: Array<{ code?: string; title?: string; detail?: string }>;
    };
    if (!res.ok && res.status !== 409) {
      const first = json.errors?.[0];
      throw new StoreError(res.status, `App Store Connect answered ${res.status}: ${first?.detail ?? first?.title ?? 'no details'}`);
    }
    const data = json.data === undefined ? [] : Array.isArray(json.data) ? json.data : [json.data];
    return { status: res.status, data };
  }

  /**
   * Checks that Apple accepts the key (throws a StoreError otherwise) and reports the team id when the
   * account reveals it: every registered bundle id carries it, so only a brand-new account has none.
   */
  async probe(): Promise<{ teamId: string | null }> {
    await this.call('GET', '/v1/apps?limit=1&fields[apps]=bundleId');
    try {
      const ids = await this.call('GET', '/v1/bundleIds?limit=1&fields[bundleIds]=seedId');
      const seed = ids.data[0]?.attributes?.seedId ?? '';
      return { teamId: /^[A-Z0-9]{10}$/.test(seed) ? seed : null };
    } catch (err) {
      // A key whose role cannot see identifiers still works for uploads.
      if (err instanceof StoreError && err.status === 403) return { teamId: null };
      throw err;
    }
  }

  /**
   * Makes sure the bundle id is registered in the developer account. Without this the app cannot be
   * created in App Store Connect: Xcode signs with the team's wildcard profile and never registers it.
   */
  async ensureBundleId(identifier: string, name: string): Promise<'exists' | 'created'> {
    const query = `filter[identifier]=${encodeURIComponent(identifier)}&fields[bundleIds]=identifier&limit=200`;
    const found = await this.call('GET', `/v1/bundleIds?${query}`);
    // The filter also returns longer identifiers that merely start the same way.
    if (found.data.some((r) => r.attributes?.identifier === identifier)) return 'exists';
    const created = await this.call('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier, name, platform: 'IOS' } },
    });
    // 409: someone registered it in the meantime.
    return created.status === 409 ? 'exists' : 'created';
  }

  /** True when an app with exactly this bundle id has been created in App Store Connect. */
  async hasApp(bundleId: string): Promise<boolean> {
    const query = `filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId&limit=200`;
    const found = await this.call('GET', `/v1/apps?${query}`);
    return found.data.some((r) => r.attributes?.bundleId === bundleId);
  }
}
