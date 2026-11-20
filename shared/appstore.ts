// The App Store Connect API calls the service needs: checking that a key works, registering an app's
// bundle id, checking that the app itself exists, and filling in its App Store page. Apple offers no
// API for creating the app; that step stays manual. Node only (server and worker); the web client
// never loads this file.
import crypto from 'node:crypto';
import {
  copyrightLine,
  type ReviewContact,
  type ShareState,
  type StoreBuild,
  type StoreChoices,
  type StoreListing,
  type StoreSyncStage,
} from './protocol';

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

interface ApiError {
  title?: string;
  detail?: string;
  meta?: { associatedErrors?: Record<string, Array<{ title?: string; detail?: string }>> };
}

/**
 * Apple's age rating questions (API version 4.x): the ones answered with a level, and the yes/no ones.
 * "None of this" answers every one of them; the result is a rating for all ages.
 */
const AGE_LEVELS = [
  'alcoholTobaccoOrDrugUseOrReferences',
  'contests',
  'gamblingSimulated',
  'gunsOrOtherWeapons',
  'medicalOrTreatmentInformation',
  'profanityOrCrudeHumor',
  'sexualContentGraphicAndNudity',
  'sexualContentOrNudity',
  'horrorOrFearThemes',
  'matureOrSuggestiveThemes',
  'violenceCartoonOrFantasy',
  'violenceRealisticProlongedGraphicOrSadistic',
  'violenceRealistic',
];
const AGE_FLAGS = [
  'advertising',
  'gambling',
  'healthOrWellnessTopics',
  'lootBox',
  'messagingAndChat',
  'parentalControls',
  'ageAssurance',
  'socialMedia',
  'socialMediaAgeRestricted',
  'sharedLocation',
  'datingAndRelationships',
  'unrestrictedWebAccess',
  'userGeneratedContent',
];

/** Name of the external TestFlight group whose public link the service hands out. */
const LINK_GROUP = 'Appsmedjan link';

/** What Apple's beta review says about a build, in the service's own words. */
function shareState(reviewState: unknown): ShareState {
  if (reviewState === 'APPROVED') return 'approved';
  if (reviewState === 'REJECTED') return 'rejected';
  return 'review';
}

/** The territory prices are set in; the free price is the same everywhere. */
const BASE_TERRITORY = 'USA';

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
      data?: Item | Item[] | null;
      errors?: ApiError[];
    };
    if (!res.ok) {
      // When a submission is refused, the useful part ("answer the privacy questions") sits one level down.
      const texts = (json.errors ?? []).flatMap((e) => [
        e.detail ?? e.title,
        ...Object.values(e.meta?.associatedErrors ?? {}).flatMap((list) => list.map((a) => a.detail ?? a.title)),
      ]);
      const detail = [...new Set(texts.filter(Boolean))].join(' ').slice(0, 900);
      throw new StoreError(res.status, `App Store Connect answered ${res.status} to ${method} ${path.split('?')[0]}: ${detail || 'no details'}`, detail || undefined);
    }
    return json.data === undefined || json.data === null ? [] : Array.isArray(json.data) ? json.data : [json.data];
  }

  /** Like `send`, for looking something up that may not exist yet: nothing instead of an error. */
  private async look(path: string): Promise<Item[]> {
    try {
      return await this.send('GET', path);
    } catch (err) {
      if (err instanceof StoreError && err.status === 404) return [];
      throw err;
    }
  }

  /** Runs one part of the details, naming it in the error so the person can tell what Apple refused. */
  private async part<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof StoreError) throw new StoreError(err.status, `${name}: ${err.message}`, err.detail ? `${name}: ${err.detail}` : undefined);
      throw err;
    }
  }

  /**
   * Fills in the app's App Store page: texts and links in the app's primary language, the category,
   * the screenshots, and the build to release. Everything here can be changed again in App Store
   * Connect; nothing is submitted for review.
   */
  async syncListing(
    appId: string,
    input: { listing: StoreListing; screenshots: Buffer[]; build?: string; choices?: StoreChoices; contact?: ReviewContact },
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
    const attached = input.build ? await this.attachBuild(appId, versionId, input.build) : 'none';

    onStage('details');
    const { choices, contact } = input;
    if (contact) {
      await this.part('Copyright', () =>
        this.send('PATCH', `/v1/appStoreVersions/${encodeURIComponent(versionId)}`, {
          data: { type: 'appStoreVersions', id: versionId, attributes: { copyright: copyrightLine(contact, new Date().getFullYear()) } },
        }),
      );
      await this.part('Review contact', () => this.setReviewContact(versionId, contact));
    }
    if (choices?.noThirdPartyContent) {
      await this.part('Content rights', () =>
        this.send('PATCH', `/v1/apps/${app}`, {
          data: { type: 'apps', id: appId, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } },
        }),
      );
    }
    if (choices?.noMatureContent && info) await this.part('Age rating', () => this.rateForEveryone(info.id));
    if (choices?.free) {
      await this.part('Price', () => this.makeFree(appId));
      await this.part('Availability', () => this.makeAvailableEverywhere(appId));
    }
    return { attached };
  }

  private async setReviewContact(versionId: string, contact: ReviewContact): Promise<void> {
    const attributes = {
      contactFirstName: contact.firstName.trim(),
      contactLastName: contact.lastName.trim(),
      contactPhone: contact.phone.trim(),
      contactEmail: contact.email.trim(),
      // The generated apps have no sign-in of their own for a reviewer to get through.
      demoAccountRequired: false,
    };
    const [existing] = await this.look(`/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreReviewDetail`);
    if (existing) {
      await this.send('PATCH', `/v1/appStoreReviewDetails/${encodeURIComponent(existing.id)}`, {
        data: { type: 'appStoreReviewDetails', id: existing.id, attributes },
      });
    } else {
      await this.send('POST', '/v1/appStoreReviewDetails', {
        data: {
          type: 'appStoreReviewDetails',
          attributes,
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
        },
      });
    }
  }

  /** Answers every age rating question with "none". Questions Apple adds later are left for the person. */
  private async rateForEveryone(appInfoId: string): Promise<void> {
    const [declaration] = await this.send('GET', `/v1/appInfos/${encodeURIComponent(appInfoId)}/ageRatingDeclaration`);
    if (!declaration) throw new StoreError(500, 'The app has no age rating declaration.');
    // Only what this account's API version knows: an unknown attribute would refuse the whole answer.
    const known = declaration.attributes ? new Set(Object.keys(declaration.attributes)) : null;
    const attributes: Record<string, unknown> = {};
    for (const name of AGE_LEVELS) if (!known || known.has(name)) attributes[name] = 'NONE';
    for (const name of AGE_FLAGS) if (!known || known.has(name)) attributes[name] = false;
    await this.send('PATCH', `/v1/ageRatingDeclarations/${encodeURIComponent(declaration.id)}`, {
      data: { type: 'ageRatingDeclarations', id: declaration.id, attributes },
    });
  }

  /** Gives the app the price "free", unless it already has a price: one the person chose is not replaced. */
  private async makeFree(appId: string): Promise<void> {
    const app = encodeURIComponent(appId);
    const current = await this.look(`/v1/appPriceSchedules/${app}/manualPrices?limit=1`);
    if (current.length > 0) return;
    const points = await this.send('GET', `/v1/apps/${app}/appPricePoints?filter[territory]=${BASE_TERRITORY}&fields[appPricePoints]=customerPrice&limit=200`);
    const free = points.find((p) => Number(p.attributes?.customerPrice) === 0);
    if (!free) throw new StoreError(500, 'App Store Connect listed no free price.');
    await this.send('POST', '/v1/appPriceSchedules', {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          baseTerritory: { data: { type: 'territories', id: BASE_TERRITORY } },
          manualPrices: { data: [{ type: 'appPrices', id: '${price}' }] },
        },
      },
      included: [
        {
          type: 'appPrices',
          id: '${price}',
          attributes: { startDate: null },
          relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } },
        },
      ],
    });
  }

  /** Makes the app available in every country, unless its availability has already been set up. */
  private async makeAvailableEverywhere(appId: string): Promise<void> {
    const existing = await this.look(`/v1/apps/${encodeURIComponent(appId)}/appAvailabilityV2`);
    if (existing.length > 0) return;
    const territories = await this.send('GET', '/v1/territories?limit=200');
    await this.send('POST', '/v2/appAvailabilities', {
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          territoryAvailabilities: { data: territories.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t.id}}` })) },
        },
      },
      included: territories.map((t) => ({
        type: 'territoryAvailabilities',
        id: `\${${t.id}}`,
        attributes: { available: true },
        relationships: { territory: { data: { type: 'territories', id: t.id } } },
      })),
    });
  }

  /** The uploaded build with this number, once Apple has finished processing it. */
  private async readyBuild(appId: string, build: string): Promise<Item | null> {
    const query = `filter[app]=${encodeURIComponent(appId)}&filter[version]=${encodeURIComponent(build)}&fields[builds]=version,processingState&limit=5`;
    const found = (await this.send('GET', `/v1/builds?${query}`)).find((b) => b.attributes?.version === build);
    return found?.attributes?.processingState === 'VALID' ? found : null;
  }

  /** The app's external group with a public link, if the service has made one. */
  private async linkGroup(appId: string): Promise<Item | undefined> {
    const groups = await this.send('GET', `/v1/betaGroups?filter[app]=${encodeURIComponent(appId)}&filter[isInternalGroup]=false&limit=50`);
    return groups.find((g) => g.attributes?.name === LINK_GROUP) ?? groups.find((g) => g.attributes?.publicLinkEnabled === true);
  }

  /**
   * How far a build has come towards being installable through the public link, without changing
   * anything: still processing, in Apple's beta review, approved or rejected.
   */
  async shareStatus(appId: string, build: string): Promise<{ state: ShareState; url?: string }> {
    const ready = await this.readyBuild(appId, build);
    if (!ready) return { state: 'processing' };
    const [submission] = await this.look(`/v1/builds/${encodeURIComponent(ready.id)}/betaAppReviewSubmission`);
    const group = await this.linkGroup(appId);
    const url = typeof group?.attributes?.publicLink === 'string' ? group.attributes.publicLink : undefined;
    return { state: shareState(submission?.attributes?.betaReviewState), url };
  }

  /**
   * Makes an uploaded build installable through a public TestFlight link. Apple wants to know who to
   * contact and what the app is before it reviews a build for outside testers; then the build goes
   * into a group with a public link and is sent to that review. Safe to run again for the same build.
   */
  async shareBuild(
    appId: string,
    input: { build: string; contact: ReviewContact; description: string },
  ): Promise<{ state: ShareState; url?: string }> {
    const app = encodeURIComponent(appId);
    const ready = await this.readyBuild(appId, input.build);
    if (!ready) return { state: 'processing' };
    const buildId = ready.id;
    const { contact } = input;

    await this.part('Test contact', async () => {
      const [detail] = await this.send('GET', `/v1/apps/${app}/betaAppReviewDetail`);
      if (!detail) throw new StoreError(500, 'The app has no beta review details.');
      await this.send('PATCH', `/v1/betaAppReviewDetails/${encodeURIComponent(detail.id)}`, {
        data: {
          type: 'betaAppReviewDetails',
          id: detail.id,
          attributes: {
            contactFirstName: contact.firstName.trim(),
            contactLastName: contact.lastName.trim(),
            contactPhone: contact.phone.trim(),
            contactEmail: contact.email.trim(),
            demoAccountRequired: false,
          },
        },
      });
    });

    const [appInfo] = await this.send('GET', `/v1/apps/${app}?fields[apps]=primaryLocale`);
    const locale = String(appInfo?.attributes?.primaryLocale ?? 'en-US');
    await this.part('Test information', async () => {
      const texts = { description: input.description.slice(0, 4000), feedbackEmail: contact.email.trim() };
      const existing = (await this.send('GET', `/v1/apps/${app}/betaAppLocalizations?limit=50`)).find((l) => l.attributes?.locale === locale);
      if (existing) {
        await this.send('PATCH', `/v1/betaAppLocalizations/${encodeURIComponent(existing.id)}`, {
          data: { type: 'betaAppLocalizations', id: existing.id, attributes: texts },
        });
      } else {
        await this.send('POST', '/v1/betaAppLocalizations', {
          data: { type: 'betaAppLocalizations', attributes: { locale, ...texts }, relationships: { app: { data: { type: 'apps', id: appId } } } },
        });
      }
      // "What to test", shown to testers in the TestFlight app.
      const whatsNew = locale.startsWith('sv') ? 'Prova appen och berätta vad du tycker.' : 'Try the app and say what you think.';
      const notes = (await this.send('GET', `/v1/builds/${encodeURIComponent(buildId)}/betaBuildLocalizations?limit=50`)).find(
        (l) => l.attributes?.locale === locale,
      );
      if (notes) {
        if (!notes.attributes?.whatsNew) {
          await this.send('PATCH', `/v1/betaBuildLocalizations/${encodeURIComponent(notes.id)}`, {
            data: { type: 'betaBuildLocalizations', id: notes.id, attributes: { whatsNew } },
          });
        }
      } else {
        await this.send('POST', '/v1/betaBuildLocalizations', {
          data: {
            type: 'betaBuildLocalizations',
            attributes: { locale, whatsNew },
            relationships: { build: { data: { type: 'builds', id: buildId } } },
          },
        });
      }
    });

    const group = await this.part('Test group', async () => {
      let found = await this.linkGroup(appId);
      if (!found) {
        [found] = await this.send('POST', '/v1/betaGroups', {
          data: {
            type: 'betaGroups',
            attributes: { name: LINK_GROUP, isInternalGroup: false, publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true },
            relationships: { app: { data: { type: 'apps', id: appId } } },
          },
        });
        if (!found) throw new StoreError(500, 'App Store Connect created no group.');
      } else if (found.attributes?.publicLinkEnabled !== true) {
        [found] = await this.send('PATCH', `/v1/betaGroups/${encodeURIComponent(found.id)}`, {
          data: { type: 'betaGroups', id: found.id, attributes: { publicLinkEnabled: true } },
        });
        if (!found) throw new StoreError(500, 'App Store Connect returned no group.');
      }
      try {
        await this.send('POST', `/v1/betaGroups/${encodeURIComponent(found.id)}/relationships/builds`, {
          data: [{ type: 'builds', id: buildId }],
        });
      } catch (err) {
        // 409: the build is in the group already.
        if (!(err instanceof StoreError && err.status === 409)) throw err;
      }
      return found;
    });

    const state = await this.part('Beta review', async () => {
      const [existing] = await this.look(`/v1/builds/${encodeURIComponent(buildId)}/betaAppReviewSubmission`);
      if (existing) return shareState(existing.attributes?.betaReviewState);
      const [created] = await this.send('POST', '/v1/betaAppReviewSubmissions', {
        data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: buildId } } } },
      });
      return shareState(created?.attributes?.betaReviewState);
    });

    // The link is part of the group, which may have been made a moment ago.
    let url = typeof group.attributes?.publicLink === 'string' ? group.attributes.publicLink : undefined;
    if (!url) {
      const fresh = await this.linkGroup(appId);
      url = typeof fresh?.attributes?.publicLink === 'string' ? fresh.attributes.publicLink : undefined;
    }
    return { state, url };
  }

  /**
   * Submits the app's prepared version for Apple's review. Apple refuses when something is still
   * missing (the privacy answers, a build) and says what; that explanation is passed on.
   */
  async submitForReview(appId: string): Promise<void> {
    const app = encodeURIComponent(appId);
    const versions = await this.send('GET', `/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=20`);
    const stateOf = (v: Item) => String(v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? '');
    const version = versions.find((v) => EDITABLE.has(stateOf(v)));
    if (!version) throw new StoreLocked(`No version of the app is waiting to be submitted (states: ${versions.map(stateOf).join(', ') || 'none'}).`);

    // A submission that was started earlier and never sent is picked up again.
    const open = await this.send('GET', `/v1/reviewSubmissions?filter[app]=${app}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=5`);
    let [submission] = open;
    if (!submission) {
      [submission] = await this.send('POST', '/v1/reviewSubmissions', {
        data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: appId } } } },
      });
      if (!submission) throw new StoreError(500, 'App Store Connect created no submission.');
    }
    const submissionId = submission.id;
    const items = await this.look(`/v1/reviewSubmissions/${encodeURIComponent(submissionId)}/items?limit=50`);
    if (items.length === 0) {
      await this.send('POST', '/v1/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
          },
        },
      });
    }
    await this.send('PATCH', `/v1/reviewSubmissions/${encodeURIComponent(submissionId)}`, {
      data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } },
    });
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
    return this.addToInternalGroup(appId, { email: holder.username, firstName: holder.firstName ?? '', lastName: holder.lastName ?? '' });
  }

  /** Puts a member of the team in the app's internal group, the one that gets every build without review. */
  private async addToInternalGroup(appId: string, person: { email: string; firstName: string; lastName: string }): Promise<boolean> {
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
    const known = await this.call('GET', `/v1/betaTesters?filter[email]=${encodeURIComponent(person.email)}&fields[betaTesters]=email&limit=1`);
    const testerId = known.data[0]?.id;
    if (testerId) {
      await this.call('POST', `/v1/betaGroups/${encodeURIComponent(groupId)}/relationships/betaTesters`, {
        data: [{ type: 'betaTesters', id: testerId }],
      });
    } else {
      await this.call('POST', '/v1/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: { email: person.email, firstName: person.firstName, lastName: person.lastName },
          relationships: { betaGroups: { data: [group] } },
        },
      });
    }
    return true;
  }

  /**
   * The fast way onto someone's phone: internal testers get every build minutes after an upload, with
   * no review. They have to be members of the developer team, so the person is first invited to it,
   * with access to this one app only. Once they have accepted, running this again makes them a tester.
   *
   * invited: Apple has sent them an invitation to accept. added: they are a tester of the app.
   */
  async inviteAsTester(appId: string, person: { email: string; firstName: string; lastName: string }): Promise<'invited' | 'added'> {
    const email = person.email.trim();
    const members = await this.send('GET', `/v1/users?filter[username]=${encodeURIComponent(email)}&fields[users]=username,allAppsVisible&limit=5`);
    const member = members.find((u) => String(u.attributes?.username ?? '').toLowerCase() === email.toLowerCase());
    if (member) {
      if (member.attributes?.allAppsVisible !== true) {
        try {
          await this.send('POST', `/v1/users/${encodeURIComponent(member.id)}/relationships/visibleApps`, { data: [{ type: 'apps', id: appId }] });
        } catch (err) {
          // 409: they can see the app already.
          if (!(err instanceof StoreError && err.status === 409)) throw err;
        }
      }
      if (!(await this.addToInternalGroup(appId, person))) throw new StoreError(500, 'The internal test group could not be created.');
      return 'added';
    }

    const pending = await this.send('GET', `/v1/userInvitations?filter[email]=${encodeURIComponent(email)}&limit=5`);
    if (pending.some((i) => String(i.attributes?.email ?? '').toLowerCase() === email.toLowerCase())) return 'invited';
    await this.send('POST', '/v1/userInvitations', {
      data: {
        type: 'userInvitations',
        attributes: {
          email,
          firstName: person.firstName.trim(),
          lastName: person.lastName.trim(),
          // The least that lets someone test: this app's builds and testers, nothing of the account's.
          roles: ['DEVELOPER'],
          allAppsVisible: false,
          provisioningAllowed: false,
        },
        relationships: { visibleApps: { data: [{ type: 'apps', id: appId }] } },
      },
    });
    return 'invited';
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
