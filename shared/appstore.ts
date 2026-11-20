// The App Store Connect API calls the service needs: checking that a key works, registering an app's
// bundle id, checking that the app itself exists, and filling in its App Store page. Apple offers no
// API for creating the app; that step stays manual. Node only (server and worker); the web client
// never loads this file.
import crypto from 'node:crypto';
import type { StoreBuild, StoreListing, StoreSyncStage } from './protocol';

const DEFAULT_API = 'https://api.appstoreconnect.apple.com';
const TOKEN_LIFETIME_S = 10 * 60;

export class StoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Apple's own explanation, when it gave one. Safe to show to the account's owner. */
    public readonly detail?: string,
  ) {
    super(message);
  }
}

/** The app's current version is in review or already on the App Store, so its page cannot be changed. */
export class StoreLocked extends Error {}

/** A version in one of these states can still have its page edited. */
const EDITABLE = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);

/** The screenshot slot for the largest iPhones (6.7 and 6.9 inch share it). */
const SCREENSHOT_TYPE = 'APP_IPHONE_67';

/** The version number the generated projects carry (MARKETING_VERSION in the project spec). */
const FIRST_VERSION = '1.0';

interface Item {
  id: string;
  attributes?: Record<string, unknown>;
}

interface UploadOperation {
  method?: string;
  url?: string;
  offset?: number;
  length?: number;
  requestHeaders?: Array<{ name?: string; value?: string }>;
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
  id?: string;
  attributes?: {
    identifier?: string;
    bundleId?: string;
    seedId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    hasAccessToAllBuilds?: boolean;
  };
}

/** Name of the internal TestFlight group the service creates in each app. */
const TESTER_GROUP = 'Appsmedjan';

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

  /** Like `call`, for the App Store page: any method, any attributes, and every refusal is an error. */
  private async send(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Item[]> {
    const res = await this.fetchImpl(this.api + path, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: Item | Item[];
      errors?: Array<{ title?: string; detail?: string }>;
    };
    if (!res.ok) {
      const detail = (json.errors ?? [])
        .map((e) => e.detail ?? e.title)
        .filter(Boolean)
        .join(' ')
        .slice(0, 600);
      throw new StoreError(res.status, `App Store Connect answered ${res.status} to ${method} ${path.split('?')[0]}: ${detail || 'no details'}`, detail || undefined);
    }
    return json.data === undefined ? [] : Array.isArray(json.data) ? json.data : [json.data];
  }

  /**
   * Fills in the app's App Store page: texts and links in the app's primary language, the category,
   * the screenshots, and the build to release. Everything here can be changed again in App Store
   * Connect; nothing is submitted for review.
   */
  async syncListing(
    appId: string,
    input: { listing: StoreListing; screenshots: Buffer[]; build?: string },
    onStage: (stage: StoreSyncStage) => void = () => undefined,
  ): Promise<{ attached: StoreBuild }> {
    const app = encodeURIComponent(appId);
    const { listing } = input;

    onStage('version');
    const versions = await this.send('GET', `/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=20`);
    const stateOf = (v: Item) => String(v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? '');
    let version = versions.find((v) => EDITABLE.has(stateOf(v)));
    if (!version && versions.length > 0) {
      throw new StoreLocked(`No version of the app can be edited (states: ${versions.map(stateOf).join(', ')}).`);
    }
    if (!version) {
      [version] = await this.send('POST', '/v1/appStoreVersions', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: FIRST_VERSION },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      });
      if (!version) throw new StoreError(500, 'App Store Connect created no version.');
    }
    const versionId = version.id;

    onStage('texts');
    const [appInfo] = await this.send('GET', `/v1/apps/${app}?fields[apps]=primaryLocale`);
    const locale = String(appInfo?.attributes?.primaryLocale ?? 'en-US');

    const versionTexts = {
      description: listing.description,
      keywords: listing.keywords,
      promotionalText: listing.promo || null,
      supportUrl: listing.supportUrl,
      marketingUrl: listing.marketingUrl || null,
    };
    const versionLocs = await this.send('GET', `/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=50`);
    let versionLoc = versionLocs.find((l) => l.attributes?.locale === locale);
    if (versionLoc) {
      await this.send('PATCH', `/v1/appStoreVersionLocalizations/${encodeURIComponent(versionLoc.id)}`, {
        data: { type: 'appStoreVersionLocalizations', id: versionLoc.id, attributes: versionTexts },
      });
    } else {
      [versionLoc] = await this.send('POST', '/v1/appStoreVersionLocalizations', {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: { locale, ...versionTexts },
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
        },
      });
      if (!versionLoc) throw new StoreError(500, 'App Store Connect created no localization.');
    }

    // The name, subtitle, privacy policy and category belong to the app, not to one version.
    const infos = await this.send('GET', `/v1/apps/${app}/appInfos?limit=10`);
    const info = infos.find((i) => EDITABLE.has(String(i.attributes?.state ?? i.attributes?.appStoreState ?? ''))) ?? infos[0];
    if (info) {
      const infoTexts = { name: listing.name, subtitle: listing.subtitle || null, privacyPolicyUrl: listing.privacyUrl };
      const infoLocs = await this.send('GET', `/v1/appInfos/${encodeURIComponent(info.id)}/appInfoLocalizations?limit=50`);
      const infoLoc = infoLocs.find((l) => l.attributes?.locale === locale);
      if (infoLoc) {
        await this.send('PATCH', `/v1/appInfoLocalizations/${encodeURIComponent(infoLoc.id)}`, {
          data: { type: 'appInfoLocalizations', id: infoLoc.id, attributes: infoTexts },
        });
      } else {
        await this.send('POST', '/v1/appInfoLocalizations', {
          data: {
            type: 'appInfoLocalizations',
            attributes: { locale, ...infoTexts },
            relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } },
          },
        });
      }
      if (listing.category) {
        await this.send('PATCH', `/v1/appInfos/${encodeURIComponent(info.id)}`, {
          data: {
            type: 'appInfos',
            id: info.id,
            relationships: { primaryCategory: { data: { type: 'appCategories', id: listing.category } } },
          },
        });
      }
    }

    onStage('screenshots');
    await this.replaceScreenshots(versionLoc.id, input.screenshots);

    onStage('build');
    return { attached: input.build ? await this.attachBuild(appId, versionId, input.build) : 'none' };
  }

  /** Replaces the phone screenshots of one language with the given ones, in order. */
  private async replaceScreenshots(localizationId: string, screenshots: Buffer[]): Promise<void> {
    const sets = await this.send('GET', `/v1/appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets?limit=50`);
    let set = sets.find((s) => s.attributes?.screenshotDisplayType === SCREENSHOT_TYPE);
    if (!set) {
      [set] = await this.send('POST', '/v1/appScreenshotSets', {
        data: {
          type: 'appScreenshotSets',
          attributes: { screenshotDisplayType: SCREENSHOT_TYPE },
          relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } },
        },
      });
      if (!set) throw new StoreError(500, 'App Store Connect created no screenshot set.');
    }
    const old = await this.send('GET', `/v1/appScreenshotSets/${encodeURIComponent(set.id)}/appScreenshots?limit=50`);
    for (const shot of old) await this.send('DELETE', `/v1/appScreenshots/${encodeURIComponent(shot.id)}`);

    for (const [index, image] of screenshots.entries()) {
      // Apple hands out where to put the bytes, takes them, and is then told that they are all there.
      const [reserved] = await this.send('POST', '/v1/appScreenshots', {
        data: {
          type: 'appScreenshots',
          attributes: { fileName: `screenshot-${index + 1}.jpg`, fileSize: image.length },
          relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
        },
      });
      if (!reserved) throw new StoreError(500, 'App Store Connect reserved no screenshot.');
      for (const op of (reserved.attributes?.uploadOperations ?? []) as UploadOperation[]) {
        if (!op.url) continue;
        const offset = op.offset ?? 0;
        const part = image.subarray(offset, offset + (op.length ?? image.length));
        const headers: Record<string, string> = {};
        for (const h of op.requestHeaders ?? []) if (h.name && h.value) headers[h.name] = h.value;
        const res = await this.fetchImpl(op.url, { method: op.method ?? 'PUT', headers, body: new Uint8Array(part), signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new StoreError(res.status, `Uploading screenshot ${index + 1} failed with ${res.status}.`);
      }
      await this.send('PATCH', `/v1/appScreenshots/${encodeURIComponent(reserved.id)}`, {
        data: {
          type: 'appScreenshots',
          id: reserved.id,
          attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(image).digest('hex') },
        },
      });
    }
  }

  /** Selects an uploaded build for the version. Apple needs some minutes after an upload before it can be. */
  private async attachBuild(appId: string, versionId: string, build: string): Promise<StoreBuild> {
    const query = `filter[app]=${encodeURIComponent(appId)}&filter[version]=${encodeURIComponent(build)}&fields[builds]=version,processingState&limit=5`;
    const found = (await this.send('GET', `/v1/builds?${query}`)).find((b) => b.attributes?.version === build);
    if (!found) return 'processing';
    if (found.attributes?.processingState !== 'VALID') return found.attributes?.processingState === 'PROCESSING' ? 'processing' : 'none';
    await this.send('PATCH', `/v1/appStoreVersions/${encodeURIComponent(versionId)}/relationships/build`, {
      data: { type: 'builds', id: found.id },
    });
    return 'attached';
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

  /** The id of the app with exactly this bundle id, or null when it has not been created in App Store Connect. */
  async appId(bundleId: string): Promise<string | null> {
    const query = `filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId&limit=200`;
    const found = await this.call('GET', `/v1/apps?${query}`);
    return found.data.find((r) => r.attributes?.bundleId === bundleId)?.id ?? null;
  }

  async hasApp(bundleId: string): Promise<boolean> {
    return (await this.appId(bundleId)) !== null;
  }

  /**
   * Makes the account holder an internal TestFlight tester of the app, in a group that gets every
   * build. Internal testers need no review by Apple, so the app shows up in the TestFlight app on
   * their phone as soon as a build has been processed. Returns false when the account holder cannot
   * be found (the key's role may not list users).
   */
  async ensureAccountHolderTests(appId: string): Promise<boolean> {
    const users = await this.call('GET', '/v1/users?filter[roles]=ACCOUNT_HOLDER&fields[users]=username,firstName,lastName&limit=1');
    const holder = users.data[0]?.attributes;
    if (!holder?.username) return false;

    const groups = await this.call(
      'GET',
      `/v1/betaGroups?filter[app]=${encodeURIComponent(appId)}&filter[isInternalGroup]=true&fields[betaGroups]=name,hasAccessToAllBuilds&limit=50`,
    );
    let groupId = groups.data.find((g) => g.attributes?.hasAccessToAllBuilds)?.id;
    if (!groupId) {
      const created = await this.call('POST', '/v1/betaGroups', {
        data: {
          type: 'betaGroups',
          attributes: { name: TESTER_GROUP, isInternalGroup: true, hasAccessToAllBuilds: true },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      });
      groupId = created.data[0]?.id;
      if (!groupId) return false;
    }

    // Someone who is already a tester somewhere in the account is added to the group; otherwise created into it.
    const group = { type: 'betaGroups', id: groupId };
    const known = await this.call('GET', `/v1/betaTesters?filter[email]=${encodeURIComponent(holder.username)}&fields[betaTesters]=email&limit=1`);
    const testerId = known.data[0]?.id;
    if (testerId) {
      await this.call('POST', `/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/betaTesters`, {
        data: [{ type: 'betaTesters', id: testerId }],
      });
    } else {
      await this.call('POST', '/v1/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: { email: holder.username, firstName: holder.firstName, lastName: holder.lastName },
          relationships: { betaGroups: { data: [group] } },
        },
      });
    }
    return true;
  }
}

/**
 * Waits for the app to be created in App Store Connect, which only a person can do. Returns its id,
 * or null when it still is not there after `waitMs`. `onWaiting` is called once, when the first
 * look comes back empty.
 */
export async function waitForApp(
  store: Pick<AppStoreConnect, 'appId'>,
  bundleId: string,
  opts: { waitMs: number; pollMs: number },
  onWaiting: () => void,
): Promise<string | null> {
  const deadline = Date.now() + opts.waitMs;
  let told = false;
  for (;;) {
    const id = await store.appId(bundleId);
    if (id) return id;
    if (!told) onWaiting();
    told = true;
    if (Date.now() + opts.pollMs > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
  }
}
