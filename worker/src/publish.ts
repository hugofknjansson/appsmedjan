// Sends an app to TestFlight: a signed Release archive, uploaded to App Store Connect with an API key.
//
// The key gives access to a developer account: the operator's own (from this worker's environment) or
// a person's own (sent along with the job and kept on disk only while that upload runs).
// Apps in the simulator run as ordinary processes of the worker's user and could read a key file, so
// for anything beyond your own apps, publish from a separate Mac (or macOS account) that runs no
// simulators: start that worker with PREVIEWS=0.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isIssuerId,
  isKeyId,
  isTeamId,
  isValidBundleId,
  isValidProjectId,
  isUdid,
  DIRECT_LIMITS,
  type AppleAccount,
  type DirectStage,
  type PublishError,
  type PublishStage,
  type StoreSyncStage,
  STORE_ICON_SIZE,
  STORE_SHOT,
  contactComplete,
  testerPersonProblem,
  listingProblems,
} from '../../shared/protocol';
import { AppStoreConnect, StoreError, StoreLocked, bundleIdName, waitForApp, type StoreKey } from '../../shared/appstore';
import { pngInfo } from '../../shared/png';
import type { DirectJob, DirectResult, InviteJob, InviteResult, PublishJob, PublishResult, ShareJob, ShareResult, StoreJob, StoreResult, SubmitJob } from './driver';
import { exec, mustExec } from './exec';
import { iconPng } from './icon';
import { extractErrors, mirrorSources, projectSpec } from './xcode';

export interface PublishConfig {
  teamId: string;
  keyId: string;
  issuerId: string;
  keyPath: string;
}

const ARCHIVE_TIMEOUT_MS = 15 * 60_000;
const UPLOAD_TIMEOUT_MS = 20 * 60_000;

/** Reads the signing settings. Returns null (publishing off) unless all four are present and well-formed. */
export function publishConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PublishConfig | null {
  const teamId = env.APPLE_TEAM_ID?.trim() ?? '';
  const keyId = env.ASC_KEY_ID?.trim() ?? '';
  const issuerId = env.ASC_ISSUER_ID?.trim() ?? '';
  let keyPath = env.ASC_KEY_PATH?.trim() ?? '';
  const given = [teamId, keyId, issuerId, keyPath].filter(Boolean).length;
  if (given === 0) return null;
  if (given < 4) {
    console.warn('[publish] TestFlight is off: APPLE_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH must all be set.');
    return null;
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Za-z0-9]{6,20}$/.test(keyId) || !/^[0-9a-fA-F-]{36}$/.test(issuerId)) {
    console.warn('[publish] TestFlight is off: APPLE_TEAM_ID, ASC_KEY_ID or ASC_ISSUER_ID does not look right.');
    return null;
  }
  if (keyPath.startsWith('~/')) keyPath = path.join(os.homedir(), keyPath.slice(2));
  return { teamId, keyId, issuerId, keyPath: path.resolve(keyPath) };
}

/** Works out what went wrong from the tools' output, so the person gets a message they can act on. */
export function classifyPublishFailure(output: string, phase: 'archive' | 'upload'): PublishError {
  if (phase === 'archive' && /\.swift:\d+(?::\d+)?: error:/.test(output)) return 'compile';
  if (/No suitable application records|Error Downloading App Information|app record[^\n]*(?:not found|could not be found|does not exist)/i.test(output)) {
    return 'no_app_record';
  }
  if (/Failed to log in|Unauthenticated|NOT_AUTHORIZED|Authentication credentials are missing or invalid|invalid (?:issuer|key|token)/i.test(output)) {
    return 'auth';
  }
  if (/No profiles for|No signing certificate|requires a development team|provisioning profile|No Account for Team|Cloud signing permission|no devices registered|Signing for "|code ?sign/i.test(output)) {
    return 'signing';
  }
  return 'internal';
}

const ASSET_INFO = '{\n  "info" : { "author" : "xcode", "version" : 1 }\n}\n';
const ICON_SET = `{
  "images" : [
    { "filename" : "icon.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
`;

/** For installing on registered phones: the app file is written to disk instead of being sent to Apple. */
function directExportOptions(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>release-testing</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>thinning</key><string>&lt;none&gt;</string>
  <key>stripSwiftSymbols</key><true/>
</dict>
</plist>
`;
}

function exportOptions(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${teamId}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
`;
}

/** Writes the project for a store build: sources, a placeholder icon and a signing-enabled spec. */
export async function preparePublishProject(dir: string, job: PublishJob, teamId: string): Promise<void> {
  await mirrorSources(dir, job.files);
  const assets = path.join(dir, 'Resources', 'Assets.xcassets');
  const iconSet = path.join(assets, 'AppIcon.appiconset');
  await fs.mkdir(iconSet, { recursive: true });
  await fs.writeFile(path.join(assets, 'Contents.json'), ASSET_INFO);
  await fs.writeFile(path.join(iconSet, 'Contents.json'), ICON_SET);
  await writeIcon(path.join(iconSet, 'icon.png'), job);
  await fs.writeFile(path.join(dir, 'project.yml'), projectSpec(job, { teamId, buildNumber: job.buildNumber }));
  await mustExec('xcodegen', ['generate', '--spec', 'project.yml', '--quiet'], { cwd: dir, timeoutMs: 60_000 });
}

/**
 * The person's own icon when they have given one, otherwise a drawn placeholder. Apple refuses icons
 * with transparency, so an alpha channel is flattened onto white.
 */
async function writeIcon(file: string, job: PublishJob): Promise<void> {
  const own = job.icon ? Buffer.from(job.icon, 'base64') : null;
  const info = own ? pngInfo(own) : null;
  if (!own || !info || info.width !== STORE_ICON_SIZE || info.height !== STORE_ICON_SIZE) {
    if (own) console.warn(`[publish] ignoring the icon for ${job.projectId}: it is not a ${STORE_ICON_SIZE} px PNG`);
    await fs.writeFile(file, iconPng(job.bundleId));
    return;
  }
  await fs.writeFile(file, own);
  if (!info.alpha) return;
  // Through JPEG and back: sips has no "remove alpha", but a JPEG cannot hold one.
  const flat = `${file}.jpg`;
  const toJpeg = await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', file, '--out', flat]);
  const toPng = toJpeg.code === 0 ? await exec('sips', ['-s', 'format', 'png', flat, '--out', file]) : toJpeg;
  await fs.rm(flat, { force: true });
  if (toPng.code !== 0) {
    console.warn(`[publish] could not flatten the icon for ${job.projectId}; using the placeholder`);
    await fs.writeFile(file, iconPng(job.bundleId));
  }
}

type Store = Pick<
  AppStoreConnect,
  'ensureBundleId' | 'ensurePhones' | 'appId' | 'ensureAccountHolderTests' | 'syncListing' | 'submitForReview' | 'shareBuild' | 'shareStatus' | 'inviteAsTester'
>;

const PEM = /^-----BEGIN PRIVATE KEY-----[A-Za-z0-9+/=\s]{50,2000}-----END PRIVATE KEY-----\s*$/;

/** The account an upload runs under: the operator's key stays a file, a person's key arrives as text. */
type Target = { teamId: string; keyId: string; issuerId: string } & ({ keyPath: string } | { key: string });

export interface PublisherOptions {
  /** How long to wait for a person to create the app in App Store Connect. */
  waitForAppMs?: number;
  pollMs?: number;
  storeFor?: (key: StoreKey) => Store;
}

export class Publisher {
  /** Archives are heavy; one at a time per Mac. */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly waitForAppMs: number;
  private readonly pollMs: number;
  private readonly storeFor: (key: StoreKey) => Store;

  /**
   * `own` is the operator's account from the worker's environment, if there is one. Jobs that carry
   * a person's own account use that instead.
   */
  constructor(
    private readonly own: PublishConfig | null,
    private readonly workDir: string,
    opts: PublisherOptions = {},
  ) {
    this.waitForAppMs = opts.waitForAppMs ?? 15 * 60_000;
    this.pollMs = opts.pollMs ?? 10_000;
    this.storeFor = opts.storeFor ?? ((key) => new AppStoreConnect(key));
  }

  /** True when the operator's own key is configured and readable. */
  async hasOwnAccount(): Promise<boolean> {
    if (!this.own) return false;
    try {
      await fs.access(this.own.keyPath, fs.constants.R_OK);
      return true;
    } catch {
      console.warn(`[publish] cannot read the key file at ${this.own.keyPath}; uploads to your own account are off`);
      return false;
    }
  }

  async publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId) || !/^\d{1,18}$/.test(job.buildNumber)) {
      return { ok: false, error: 'internal', detail: 'Invalid publish job.' };
    }
    const resolved = this.targetFor(job.account);
    if ('stop' in resolved) return resolved.stop;
    const target = resolved.target;

    // Talking to Apple, and waiting for the person to create the app, happens outside the queue:
    // it is light, and a wait of many minutes must not hold up other people's uploads.
    progress('preparing');
    const store = this.storeOf(target);
    const checked = await this.checkStore(job, store, progress);
    if ('stop' in checked) return checked.stop;

    const next = this.chain.catch(() => undefined).then(() => this.withKeyFile(target, (cfg) => this.upload(job, cfg, progress)));
    this.chain = next;
    const result = await next;
    return result.ok ? { ...result, tester: checked.tester } : result;
  }

  /** The account a job runs under: the person's own when the job brings one, otherwise the worker's. */
  private targetFor(account: AppleAccount | undefined): { target: Target } | { stop: { ok: false; error: 'auth' | 'unavailable'; detail: string } } {
    if (account) {
      // The person's own account. Its values end up in a project file and on a command line: check them.
      const { teamId, keyId, issuerId, key } = account;
      if (!isTeamId(teamId) || !isKeyId(keyId) || !isIssuerId(issuerId) || typeof key !== 'string' || !PEM.test(key)) {
        return { stop: { ok: false, error: 'auth', detail: 'The account details in the job are malformed.' } };
      }
      return { target: { teamId, keyId, issuerId, key } };
    }
    if (this.own) return { target: this.own };
    return { stop: { ok: false, error: 'unavailable', detail: 'This worker has no account of its own.' } };
  }

  private storeOf(target: Target): Store {
    const keyPath = 'keyPath' in target ? target.keyPath : null;
    return this.storeFor({
      keyId: target.keyId,
      issuerId: target.issuerId,
      key: keyPath ? () => fs.readFile(keyPath, 'utf8') : (target as { key: string }).key,
    });
  }

  /**
   * Fills in the app's page in App Store Connect: texts, category, screenshots and the build to
   * release. Only API calls, no Xcode, so it does not wait in the archive queue. Nothing is submitted
   * for review; that stays with the account's owner.
   */
  async syncStore(job: StoreJob, progress: (stage: StoreSyncStage) => void): Promise<StoreResult> {
    const screenshots = Array.isArray(job.screenshots) ? job.screenshots.map((s) => Buffer.from(String(s), 'base64')) : [];
    if (
      !isValidProjectId(job.projectId) ||
      !isValidBundleId(job.bundleId) ||
      screenshots.length > STORE_SHOT.max ||
      (job.build !== undefined && !/^\d{1,18}$/.test(job.build)) ||
      listingProblems(job.listing, screenshots.length).length > 0
    ) {
      return { ok: false, error: 'internal', detail: 'Invalid store job.' };
    }
    const resolved = this.targetFor(job.account);
    if ('stop' in resolved) return resolved.stop;
    const store = this.storeOf(resolved.target);
    try {
      progress('version');
      const appId = await store.appId(job.bundleId);
      if (!appId) return { ok: false, error: 'no_app_record', detail: `No app with bundle id ${job.bundleId} exists in App Store Connect yet.` };
      const choices = job.choices && {
        noMatureContent: job.choices.noMatureContent === true,
        noThirdPartyContent: job.choices.noThirdPartyContent === true,
        free: job.choices.free === true,
      };
      // A half-filled contact is left out rather than sent on to be refused.
      const contact = job.contact && contactComplete(job.contact) ? job.contact : undefined;
      const { attached } = await store.syncListing(appId, { listing: job.listing, screenshots, build: job.build, choices, contact }, progress);
      return { ok: true, attached };
    } catch (err) {
      return this.storeFailure(job.projectId, err);
    }
  }

  /**
   * Submits the app's prepared version for Apple's review. Sent only because the app's owner pressed
   * the button for it; Apple answers with what is missing when something is.
   */
  async submit(job: SubmitJob): Promise<StoreResult> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId)) {
      return { ok: false, error: 'internal', detail: 'Invalid submit job.' };
    }
    const resolved = this.targetFor(job.account);
    if ('stop' in resolved) return resolved.stop;
    const store = this.storeOf(resolved.target);
    try {
      const appId = await store.appId(job.bundleId);
      if (!appId) return { ok: false, error: 'no_app_record', detail: `No app with bundle id ${job.bundleId} exists in App Store Connect yet.` };
      await store.submitForReview(appId);
      return { ok: true };
    } catch (err) {
      return this.storeFailure(job.projectId, err);
    }
  }

  /**
   * Makes an uploaded build installable through a public TestFlight link, or (with `check`) only
   * asks Apple how far that has come. Only API calls, so it does not wait in the archive queue.
   */
  async share(job: ShareJob): Promise<ShareResult> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId) || !/^\d{1,18}$/.test(job.build)) {
      return { ok: false, error: 'internal', detail: 'Invalid share job.' };
    }
    const resolved = this.targetFor(job.account);
    if ('stop' in resolved) return resolved.stop;
    const store = this.storeOf(resolved.target);
    try {
      const appId = await store.appId(job.bundleId);
      if (!appId) return { ok: false, error: 'no_app_record', detail: `No app with bundle id ${job.bundleId} exists in App Store Connect yet.` };
      if (job.check) return { ok: true, ...(await store.shareStatus(appId, job.build)) };
      if (!job.contact || !contactComplete(job.contact)) return { ok: false, error: 'internal', detail: 'The share job has no complete contact.' };
      const description = (job.description ?? '').trim() || 'An app built with App Dance.';
      return { ok: true, ...(await store.shareBuild(appId, { build: job.build, contact: job.contact, description })) };
    } catch (err) {
      return this.storeFailure(job.projectId, err);
    }
  }

  /**
   * Invites a person to this worker's own developer team as an internal tester of the app, or makes
   * them a tester once they have accepted. Never done with someone else's account: who is on a team
   * is that team's own business.
   */
  async invite(job: InviteJob): Promise<InviteResult> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId) || !job.person || testerPersonProblem(job.person) !== null) {
      return { ok: false, error: 'internal', detail: 'Invalid invite job.' };
    }
    if (!this.own) return { ok: false, error: 'unavailable', detail: 'This worker has no account of its own.' };
    const store = this.storeOf(this.own);
    try {
      const appId = await store.appId(job.bundleId);
      if (!appId) return { ok: false, error: 'no_app_record', detail: `No app with bundle id ${job.bundleId} exists in App Store Connect yet.` };
      return { ok: true, state: await store.inviteAsTester(appId, job.person) };
    } catch (err) {
      return this.storeFailure(job.projectId, err);
    }
  }

  private storeFailure(projectId: string, err: unknown): StoreResult {
    const message = (err as Error).message;
    console.warn(`[store] ${projectId}: ${message}`);
    if (err instanceof StoreLocked) return { ok: false, error: 'locked', detail: message };
    if (err instanceof StoreError) {
      if (err.status === 401) return { ok: false, error: 'auth', detail: message };
      // Apple explains what it did not accept (a word in the name, a missing answer): pass that on.
      if (err.detail && err.status >= 400 && err.status < 500) return { ok: false, error: 'rejected', detail: err.detail };
    }
    return { ok: false, error: 'internal', detail: message };
  }

  /** xcodebuild wants the key as a file. A person's key is one only while their archive and upload run. */
  private async withKeyFile<T>(target: Target, task: (cfg: PublishConfig) => Promise<T>): Promise<T> {
    if ('keyPath' in target) return task(target);
    const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'appsmedjan-key-'));
    try {
      const keyPath = path.join(keyDir, `AuthKey_${target.keyId}.p8`);
      await fs.writeFile(keyPath, target.key, { mode: 0o600 });
      return await task({ teamId: target.teamId, keyId: target.keyId, issuerId: target.issuerId, keyPath });
    } finally {
      await fs.rm(keyDir, { recursive: true, force: true });
    }
  }

  private paths(projectId: string) {
    const dir = path.join(this.workDir, 'publish', projectId);
    return { dir, archivePath: path.join(dir, 'build', 'App.xcarchive'), exportPath: path.join(dir, 'build', 'export') };
  }

  private auth(cfg: PublishConfig): string[] {
    return ['-allowProvisioningUpdates', '-authenticationKeyPath', cfg.keyPath, '-authenticationKeyID', cfg.keyId, '-authenticationKeyIssuerID', cfg.issuerId];
  }

  /** Writes the project and builds a signed Release archive of it. Returns the tools' output when that fails. */
  private async archive(job: PublishJob, cfg: PublishConfig): Promise<string | null> {
    const { dir, archivePath, exportPath } = this.paths(job.projectId);
    await preparePublishProject(dir, job, cfg.teamId);
    await fs.rm(archivePath, { recursive: true, force: true });
    await fs.rm(exportPath, { recursive: true, force: true });
    const archive = await exec(
      'xcodebuild',
      [
        '-project', 'App.xcodeproj',
        '-scheme', 'App',
        '-configuration', 'Release',
        '-destination', 'generic/platform=iOS',
        '-archivePath', archivePath,
        '-derivedDataPath', 'build/derived',
        ...this.auth(cfg),
        '-quiet',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'archive',
      ],
      { cwd: dir, timeoutMs: ARCHIVE_TIMEOUT_MS },
    );
    return archive.code === 0 ? null : archive.stdout + '\n' + archive.stderr;
  }

  private async upload(job: PublishJob, cfg: PublishConfig, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    const { dir, archivePath, exportPath } = this.paths(job.projectId);
    progress('preparing');
    progress('archiving');
    const failed = await this.archive(job, cfg);
    if (failed !== null) return this.failure(failed, 'archive', dir);

    progress('uploading');
    const optionsPath = path.join(dir, 'ExportOptions.plist');
    await fs.writeFile(optionsPath, exportOptions(cfg.teamId));
    const upload = await exec(
      'xcodebuild',
      ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', optionsPath, '-exportPath', exportPath, ...this.auth(cfg)],
      { cwd: dir, timeoutMs: UPLOAD_TIMEOUT_MS },
    );
    if (upload.code !== 0) return this.failure(upload.stdout + '\n' + upload.stderr, 'upload', dir);

    // The archive is large and no longer needed once Apple has the build.
    await fs.rm(archivePath, { recursive: true, force: true });
    return { ok: true };
  }

  /**
   * Signs the app for the person's own phones and hands back the app file, which their phone then
   * installs from a link: no TestFlight, no review, no app in App Store Connect. The phones are
   * registered in the developer account first; Apple only lets a registered phone run the app.
   */
  async direct(job: DirectJob, progress: (stage: DirectStage) => void): Promise<DirectResult> {
    const phones = Array.isArray(job.phones) ? job.phones : [];
    if (
      !isValidProjectId(job.projectId) ||
      !isValidBundleId(job.bundleId) ||
      !/^\d{1,18}$/.test(job.buildNumber) ||
      phones.length > DIRECT_LIMITS.phones ||
      phones.some((p) => !isUdid(p?.udid) || typeof p.name !== 'string')
    ) {
      return { ok: false, error: 'internal', detail: 'Invalid direct job.' };
    }
    if (phones.length === 0) return { ok: false, error: 'no_phones', detail: 'The job names no phones.' };
    const resolved = this.targetFor(job.account);
    if ('stop' in resolved) return resolved.stop;
    const target = resolved.target;

    progress('preparing');
    const store = this.storeOf(target);
    try {
      const outcome = await store.ensureBundleId(job.bundleId, bundleIdName(job.appName, job.projectId));
      if (outcome === 'created') console.log(`[direct] registered bundle id ${job.bundleId}`);
    } catch (err) {
      const stop = this.storeProblem(err, 'register the bundle id');
      if (stop) return { ok: false, error: 'auth', detail: stop.detail };
    }
    try {
      const held = (await store.ensurePhones(phones)).filter((p) => p.status !== 'ENABLED');
      if (held.length > 0) {
        const detail = `Apple holds ${held.length} phone(s) back: ${held.map((p) => p.status).join(', ')}.`;
        console.warn(`[direct] ${job.projectId}: ${detail}`);
        return { ok: false, error: 'phone_processing', detail };
      }
    } catch (err) {
      const message = (err as Error).message;
      console.warn(`[direct] ${job.projectId}: could not register the phones: ${message}`);
      if (err instanceof StoreError && err.status === 401) return { ok: false, error: 'auth', detail: message };
      // Apple answers 409 when the account has no room for more phones this membership year.
      if (err instanceof StoreError && err.status === 409 && /maximum|limit/i.test(message)) return { ok: false, error: 'phone_limit', detail: message };
      return { ok: false, error: 'internal', detail: message };
    }

    const next = this.chain.catch(() => undefined).then(() => this.withKeyFile(target, (cfg) => this.exportForPhones(job, cfg, progress)));
    this.chain = next;
    return next;
  }

  private async exportForPhones(job: DirectJob, cfg: PublishConfig, progress: (stage: DirectStage) => void): Promise<DirectResult> {
    const { dir, archivePath, exportPath } = this.paths(job.projectId);
    const failure = (output: string, phase: 'archive' | 'upload'): DirectResult => {
      const found = classifyPublishFailure(output, phase);
      const error = found === 'no_app_record' ? 'internal' : found;
      const detail = extractErrors(output, dir).slice(-2000);
      console.warn(`[direct] ${phase === 'archive' ? 'archive' : 'signing'} failed (${error}):\n${detail}`);
      return { ok: false, error, detail };
    };

    progress('archiving');
    const failed = await this.archive(job, cfg);
    if (failed !== null) return failure(failed, 'archive');

    progress('signing');
    const optionsPath = path.join(dir, 'ExportOptions.plist');
    await fs.writeFile(optionsPath, directExportOptions(cfg.teamId));
    const signed = await exec(
      'xcodebuild',
      ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', optionsPath, '-exportPath', exportPath, ...this.auth(cfg)],
      { cwd: dir, timeoutMs: UPLOAD_TIMEOUT_MS },
    );
    if (signed.code !== 0) return failure(signed.stdout + '\n' + signed.stderr, 'upload');
    await fs.rm(archivePath, { recursive: true, force: true });

    const name = (await fs.readdir(exportPath)).find((f) => f.endsWith('.ipa'));
    if (!name) return { ok: false, error: 'internal', detail: 'The export produced no app file.' };
    const ipaPath = path.join(exportPath, name);

    // The profile inside the app says which phones may run it. One registered a moment ago can be
    // missing from it; better to say so now than to hand over an app that refuses to install.
    const profile = await exec('/bin/sh', ['-c', 'unzip -p "$1" "Payload/*.app/embedded.mobileprovision" | security cms -D', 'sh', ipaPath], { timeoutMs: 30_000 });
    const allowed = profile.stdout.toLowerCase();
    const missing = job.phones.filter((p) => !allowed.includes(p.udid.toLowerCase()));
    if (profile.code !== 0 || missing.length > 0) {
      const detail = profile.code !== 0 ? `Could not read the app's profile: ${profile.stderr.slice(-300)}` : `${missing.length} phone(s) are not in the app's profile yet.`;
      console.warn(`[direct] ${job.projectId}: ${detail}`);
      return { ok: false, error: profile.code !== 0 ? 'internal' : 'phone_processing', detail };
    }

    const ipa = await fs.readFile(ipaPath);
    await fs.rm(exportPath, { recursive: true, force: true });
    if (ipa.length > DIRECT_LIMITS.ipaBytes) return { ok: false, error: 'internal', detail: `The app file is ${ipa.length} bytes, more than can be handed over.` };
    return { ok: true, ipa };
  }

  /**
   * What can be settled with Apple before spending minutes on an archive: the bundle id is registered,
   * the app exists (waiting a while for the person to create it), and the account holder is a tester.
   * Only a clear answer stops the upload; if Apple's API cannot be asked, the upload is tried anyway.
   */
  private async checkStore(
    job: PublishJob,
    store: Store,
    progress: (stage: PublishStage) => void,
  ): Promise<{ stop: PublishResult } | { tester: PublishResult['tester'] }> {
    try {
      const outcome = await store.ensureBundleId(job.bundleId, bundleIdName(job.appName, job.projectId));
      if (outcome === 'created') console.log(`[publish] registered bundle id ${job.bundleId}`);
    } catch (err) {
      const stop = this.storeProblem(err, 'register the bundle id');
      if (stop) return { stop };
    }

    let appId: string | null;
    try {
      appId = await waitForApp(store, job.bundleId, { waitMs: this.waitForAppMs, pollMs: this.pollMs }, () => {
        console.log(`[publish] waiting for an app with bundle id ${job.bundleId} to be created in App Store Connect`);
        progress('waiting_for_app');
      });
    } catch (err) {
      const stop = this.storeProblem(err, 'look the app up');
      return stop ? { stop } : { tester: 'manual' };
    }
    if (!appId) {
      const detail = `No app with bundle id ${job.bundleId} exists in App Store Connect yet.`;
      console.warn(`[publish] ${detail}`);
      return { stop: { ok: false, error: 'no_app_record', detail } };
    }

    // Nice to have: without it the person adds themselves as a tester by hand.
    try {
      const added = await store.ensureAccountHolderTests(appId);
      if (!added) console.warn('[publish] could not find the account holder; they add themselves as a tester by hand');
      return { tester: added ? 'added' : 'manual' };
    } catch (err) {
      console.warn(`[publish] could not add the account holder as a tester (${(err as Error).message}); continuing`);
      return { tester: 'manual' };
    }
  }

  /** A rejected key ends the attempt; anything else (a role without access, no network) is only noted. */
  private storeProblem(err: unknown, what: string): PublishResult | null {
    const message = (err as Error).message;
    if (err instanceof StoreError && err.status === 401) {
      console.warn(`[publish] the App Store Connect key was rejected: ${message}`);
      return { ok: false, error: 'auth', detail: message };
    }
    console.warn(`[publish] could not ${what} beforehand (${message}); continuing`);
    return null;
  }

  private failure(output: string, phase: 'archive' | 'upload', dir: string): PublishResult {
    const error = classifyPublishFailure(output, phase);
    const detail = extractErrors(output, dir).slice(-2000);
    console.warn(`[publish] ${phase} failed (${error}):\n${detail}`);
    return { ok: false, error, detail };
  }
}
