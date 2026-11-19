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
  type PublishError,
  type PublishStage,
} from '../../shared/protocol';
import { AppStoreConnect, StoreError, bundleIdName } from '../../shared/appstore';
import type { PublishJob, PublishResult } from './driver';
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
  await fs.writeFile(path.join(iconSet, 'icon.png'), iconPng(job.bundleId));
  await fs.writeFile(path.join(dir, 'project.yml'), projectSpec(job, { teamId, buildNumber: job.buildNumber }));
  await mustExec('xcodegen', ['generate', '--spec', 'project.yml', '--quiet'], { cwd: dir, timeoutMs: 60_000 });
}

type Store = Pick<AppStoreConnect, 'ensureBundleId' | 'hasApp'>;

const PEM = /^-----BEGIN PRIVATE KEY-----[A-Za-z0-9+/=\s]{50,2000}-----END PRIVATE KEY-----\s*$/;

export class Publisher {
  /** Archives are heavy; one at a time per Mac. */
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * `own` is the operator's account from the worker's environment, if there is one. Jobs that carry
   * a person's own account use that instead.
   */
  constructor(
    private readonly own: PublishConfig | null,
    private readonly workDir: string,
    private readonly storeFor: (cfg: PublishConfig) => Store = (cfg) =>
      new AppStoreConnect({ keyId: cfg.keyId, issuerId: cfg.issuerId, key: () => fs.readFile(cfg.keyPath, 'utf8') }),
  ) {}

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

  publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    const next = this.chain.catch(() => undefined).then(() => this.run(job, progress));
    this.chain = next;
    return next;
  }

  private async run(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId) || !/^\d{1,18}$/.test(job.buildNumber)) {
      return { ok: false, error: 'internal', detail: 'Invalid publish job.' };
    }
    if (!job.account) {
      if (!this.own) return { ok: false, error: 'unavailable', detail: 'This worker has no account of its own.' };
      return this.upload(job, this.own, progress);
    }

    // The person's own account. Its values end up in a project file and on a command line: check them.
    const { teamId, keyId, issuerId, key } = job.account;
    if (!isTeamId(teamId) || !isKeyId(keyId) || !isIssuerId(issuerId) || typeof key !== 'string' || !PEM.test(key)) {
      return { ok: false, error: 'auth', detail: 'The account details in the job are malformed.' };
    }
    // xcodebuild wants the key as a file. It lives in a private folder for the length of this upload only.
    const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'appsmedjan-key-'));
    try {
      const keyPath = path.join(keyDir, `AuthKey_${keyId}.p8`);
      await fs.writeFile(keyPath, key, { mode: 0o600 });
      return await this.upload(job, { teamId, keyId, issuerId, keyPath }, progress);
    } finally {
      await fs.rm(keyDir, { recursive: true, force: true });
    }
  }

  private async upload(job: PublishJob, cfg: PublishConfig, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    const dir = path.join(this.workDir, 'publish', job.projectId);
    const archivePath = path.join(dir, 'build', 'App.xcarchive');
    const exportPath = path.join(dir, 'build', 'export');
    const auth = [
      '-allowProvisioningUpdates',
      '-authenticationKeyPath', cfg.keyPath,
      '-authenticationKeyID', cfg.keyId,
      '-authenticationKeyIssuerID', cfg.issuerId,
    ];

    progress('preparing');
    const blocked = await this.checkStore(job, this.storeFor(cfg));
    if (blocked) return blocked;
    await preparePublishProject(dir, job, cfg.teamId);
    await fs.rm(archivePath, { recursive: true, force: true });
    await fs.rm(exportPath, { recursive: true, force: true });

    progress('archiving');
    const archive = await exec(
      'xcodebuild',
      [
        '-project', 'App.xcodeproj',
        '-scheme', 'App',
        '-configuration', 'Release',
        '-destination', 'generic/platform=iOS',
        '-archivePath', archivePath,
        '-derivedDataPath', 'build/derived',
        ...auth,
        '-quiet',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'archive',
      ],
      { cwd: dir, timeoutMs: ARCHIVE_TIMEOUT_MS },
    );
    if (archive.code !== 0) return this.failure(archive.stdout + '\n' + archive.stderr, 'archive', dir);

    progress('uploading');
    const optionsPath = path.join(dir, 'ExportOptions.plist');
    await fs.writeFile(optionsPath, exportOptions(cfg.teamId));
    const upload = await exec(
      'xcodebuild',
      ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', optionsPath, '-exportPath', exportPath, ...auth],
      { cwd: dir, timeoutMs: UPLOAD_TIMEOUT_MS },
    );
    if (upload.code !== 0) return this.failure(upload.stdout + '\n' + upload.stderr, 'upload', dir);

    // The archive is large and no longer needed once Apple has the build.
    await fs.rm(archivePath, { recursive: true, force: true });
    return { ok: true };
  }

  /**
   * Registers the bundle id and checks that the app exists before spending minutes on an archive.
   * Only a clear answer stops the upload; if Apple's API cannot be asked, the upload is tried anyway.
   */
  private async checkStore(job: PublishJob, store: Store): Promise<PublishResult | null> {
    try {
      const outcome = await store.ensureBundleId(job.bundleId, bundleIdName(job.appName, job.projectId));
      if (outcome === 'created') console.log(`[publish] registered bundle id ${job.bundleId}`);
    } catch (err) {
      const stop = this.storeProblem(err, 'register the bundle id');
      if (stop) return stop;
    }
    try {
      if (!(await store.hasApp(job.bundleId))) {
        const detail = `No app with bundle id ${job.bundleId} exists in App Store Connect yet.`;
        console.warn(`[publish] ${detail}`);
        return { ok: false, error: 'no_app_record', detail };
      }
    } catch (err) {
      const stop = this.storeProblem(err, 'look the app up');
      if (stop) return stop;
    }
    return null;
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
