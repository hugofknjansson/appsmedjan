// The real driver: builds with XcodeGen + xcodebuild and runs the app in an iOS Simulator.
import { projectSpec } from '../../shared/xcodeproject';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isValidBundleId,
  isValidProjectId,
  isValidSourcePath,
  type BuildStage,
  type InputEvent,
  type DirectStage,
  type PublishStage,
  STORE_SHOT,
  type StoreSyncStage,
  VIDEO_MIME,
} from '../../shared/protocol';
import type { BuildJob, DirectJob, DirectResult, Driver, Emit, InviteJob, InviteResult, PublishJob, PublishResult, ShareJob, ShareResult, StoreJob, StoreResult, SubmitJob } from './driver';
import { exec, mustExec } from './exec';
import { Publisher, publishConfigFromEnv } from './publish';
import { listFolders, pruneAfterDays, staleIds, touch } from './prune';
import { Streamer } from './stream';
import { Toucher, touchMessages, touchPython, wholeGesture, type Finger, type Gesture, type Held } from './touch';

interface Session {
  projectId: string;
  dir: string;
  udid: string;
  /** Which model of phone the simulator is. */
  deviceTypeId: string;
  bundleId: string;
  booted: boolean;
  viewers: number;
  /** True when every viewer can show video. */
  video: boolean;
  /** True when a viewer's connection keeps falling behind, and the video is therefore a lighter one. */
  light: boolean;
  lastUsed: number;
  streamer: Streamer | null;
  /** The open connection touches go through; null where there is none, and each touch is then a command of its own. */
  toucher: Toucher | null;
  /** Where the finger that is down through the open connection was last put. */
  held: Held | null;
  /** The finger that is down, while touches are gathered into whole gestures for the idb command. */
  finger: Finger | null;
  /** Screen size in points, needed to turn normalized touch positions into coordinates. */
  screen: { width: number; height: number } | null;
  /** Input events are applied in order. */
  inputChain: Promise<void>;
  /** Builds, screenshots and release for one project never overlap. */
  chain: Promise<unknown>;
  /** The latest build's times, finished when its first picture is sent: for the [timing] line. */
  timing: Timing | null;
  /** The app's old simulator, when it got the running copy instead: what the app saved there is moved over once it is installed. */
  migrateFrom: string | null;
}

/** When each step of a build ended, in milliseconds from its start. */
interface Timing {
  start: number;
  steps: Array<[string, number]>;
}

const mark = (t: Timing | null, step: string) => t?.steps.push([step, Date.now() - t.start]);
const timingLine = (t: Timing) => t.steps.map(([step, ms]) => `${step} ${(ms / 1000).toFixed(1)}s`).join(', ');

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  deviceTypeIdentifier?: string;
}

/**
 * Which simulator a phone is to be tried in: the one of the same model, when the phone said which
 * it is and this Mac can simulate it; otherwise the one there already is, or the usual one.
 * `existing` is the type of the app's simulator, when it has one.
 */
export function simulatorTypeFor(model: string | undefined, byModel: ReadonlyMap<string, string>, existing: string | undefined, usual: string): string {
  return (model && byModel.get(model)) || existing || usual;
}

const DEVICE_PREFIX = 'asm-';
/**
 * A clean simulator that has done its first boot, which a new app's simulator is copied from. A new
 * simulator spends close to a minute on its first boot; a copy of one that has booted before starts
 * in a few seconds.
 */
const TEMPLATE_PREFIX = `${DEVICE_PREFIX}template-`;
/** A copy of the template that is already running, for the next new app to take over without any wait. */
const SPARE_PREFIX = `${DEVICE_PREFIX}spare-`;
/** An app's old simulator while what the app saved in it is moved to the running copy it got instead. */
const OLD_PREFIX = `${DEVICE_PREFIX}old-`;
/** How long no app must have been built before a new waiting simulator is started. */
const SPARE_QUIET_MS = 45_000;
/** What a template runs once, so that its copies have done their first install and launch too. */
const WARM_BUNDLE_ID = 'app.appsmedjan.warmup';
const WARM_APP = `import SwiftUI

@main
struct WarmApp: App {
  var body: some Scene {
    WindowGroup { Text("App Dance") }
  }
}
`;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const PRUNE_EVERY_MS = 6 * 3600_000;

export class XcodeDriver implements Driver {
  private sessions = new Map<string, Session>();
  private runtimeId = '';
  private deviceTypeId = '';
  /** The simulators this Mac can run, by the model of phone each one is: "iPhone19,2" to its device type. */
  private typesByModel = new Map<string, string>();
  private hasIdb = false;
  /** LIVE_VIDEO=0 keeps the screen as JPEG frames, should video ever misbehave. */
  private readonly liveVideo = process.env.LIVE_VIDEO !== '0';
  /** LIVE_LIGHT=0 keeps the video at full size also for viewers whose connection keeps falling behind. */
  private readonly lightVideo = process.env.LIVE_LIGHT !== '0';
  /** The Python that idb's library is installed for, which live touches and video go through; null when it was not found. */
  private idbPython: string | null = null;
  /** The same, unless live touches are switched off: null then, and each touch is an idb command of its own. */
  private touchPython: string | null = null;
  private publisher: Publisher | null = null;
  /**
   * SIM_TEMPLATE=0 makes every new app's simulator from scratch again, with its slow first boot. A
   * signing-only worker (PREVIEWS=0) runs no simulators, so it makes no template either.
   */
  private readonly useTemplates = process.env.SIM_TEMPLATE !== '0' && process.env.PREVIEWS !== '0';
  /** SIM_EARLY_STREAM=0 starts the screen stream only once the app has started, as before. */
  private readonly earlyStream = process.env.SIM_EARLY_STREAM !== '0';
  /** The template for each model of phone, by device type: its udid once it has done its first boot. */
  private templates = new Map<string, Promise<string | null>>();
  /** SIM_SPARE=0 keeps no running copy waiting for the next app. */
  private readonly useSpare = process.env.SIM_SPARE !== '0';
  /** A running copy of the usual model's template, waiting for the next new app; one at most. */
  private spare: { udid: string; type: string } | null = null;
  private makingSpare: Promise<void> | null = null;
  /** When an app was last built: a simulator starting up takes the Mac's power from it for a while. */
  private lastBuildAt = 0;
  private spareTimer: NodeJS.Timeout | null = null;
  private readonly workDir: string;
  private readonly maxSimulators: number;

  constructor(
    private readonly emit: Emit,
    opts: { maxSimulators: number; workDir?: string },
  ) {
    this.maxSimulators = opts.maxSimulators;
    this.workDir = opts.workDir ?? path.join(os.homedir(), 'Library', 'Application Support', 'appsmedjan-worker');
  }

  async init(): Promise<{ canInput: boolean; canPublish: boolean; hasOwnAccount: boolean; publishesForUsers: boolean; info: string }> {
    const xcode = await exec('xcodebuild', ['-version']);
    if (xcode.code !== 0) throw new Error('Xcode is not installed (xcodebuild not found). Install Xcode from the App Store.');
    const xcodegen = await exec('xcodegen', ['--version']);
    if (xcodegen.code !== 0) throw new Error('XcodeGen is not installed. Run: brew install xcodegen');
    this.hasIdb = (await exec('idb', ['--help'], { timeoutMs: 20_000 })).code === 0;
    // LIVE_TOUCH=0 goes back to one idb command per touch, should the open connection ever misbehave.
    const live = process.env.LIVE_TOUCH !== '0';
    this.idbPython = this.hasIdb ? await touchPython() : null;
    this.touchPython = live ? this.idbPython : null;
    if (this.hasIdb && !this.idbPython) console.warn('[xcode] idb\'s Python library was not found: the screen is sent as still pictures and touches one command at a time, which is slower.');
    if (!this.hasIdb) {
      console.warn(
        '[xcode] idb not found: the preview will be view-only and slower. To enable taps and typing run:\n' +
          '        brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb',
      );
    }
    await this.pickRuntimeAndDevice();
    await fs.mkdir(this.workDir, { recursive: true });
    // Simulators left running by an earlier worker process would otherwise never be shut down.
    for (const d of await this.listDevices()) {
      if (d.name.startsWith(DEVICE_PREFIX) && d.state !== 'Shutdown') {
        await exec('xcrun', ['simctl', 'shutdown', d.udid]);
        await forgetCompanion(d.udid);
      }
    }
    for (const d of await this.listDevices()) {
      if (d.name.startsWith(SPARE_PREFIX) || d.name.startsWith(OLD_PREFIX)) await exec('xcrun', ['simctl', 'delete', d.udid], { timeoutMs: 60_000 });
    }
    // The usual model's template is made ready in the background, so the first app does not wait for
    // it, and then a running copy of it for the first app to take over.
    if (this.useTemplates) {
      await this.forgetOldTemplates();
      void this.templateFor(this.deviceTypeId).then(() => this.keepSpare());
    }
    // Uploads go to the operator's own account (key in this worker's environment), to people's own
    // accounts (key sent with each job; opt in with PUBLISH_FOR_USERS=1), or both.
    const publisher = new Publisher(publishConfigFromEnv(), this.workDir);
    const hasOwnAccount = await publisher.hasOwnAccount();
    const forUsers = process.env.PUBLISH_FOR_USERS === '1';
    if (hasOwnAccount || forUsers) {
      this.publisher = publisher;
      const targets = [hasOwnAccount && 'your own account', forUsers && "people's own accounts"].filter(Boolean);
      console.log(`[xcode] TestFlight uploads are on (${targets.join(' and ')})`);
    }
    // On a Mac that runs unattended, simulators and build folders nobody uses any more are cleared out.
    await this.prune();
    setInterval(() => void this.prune(), PRUNE_EVERY_MS).unref();
    const version = xcode.stdout.split('\n')[0]?.trim() ?? 'Xcode';
    return { canInput: this.hasIdb, canPublish: this.publisher !== null, hasOwnAccount, publishesForUsers: forUsers, info: `${version}, ${this.deviceTypeId.split('.').pop()}, ${this.runtimeId.split('.').pop()}` };
  }

  private async pickRuntimeAndDevice(): Promise<void> {
    const out = await mustExec('xcrun', ['simctl', 'list', 'runtimes', '-j']);
    const runtimes = (JSON.parse(out).runtimes as Array<Record<string, unknown>>).filter(
      (r) => r.isAvailable && (r.platform === 'iOS' || String(r.name).startsWith('iOS')),
    );
    if (runtimes.length === 0) {
      throw new Error('No iOS simulator runtime is installed. Open Xcode > Settings > Components and install iOS.');
    }
    const versionKey = (r: Record<string, unknown>) =>
      String(r.version ?? '0').split('.').map((n) => Number(n).toString().padStart(4, '0')).join('.');
    runtimes.sort((a, b) => versionKey(a).localeCompare(versionKey(b)));
    const runtime = runtimes[runtimes.length - 1]!;
    this.runtimeId = String(runtime.identifier);

    let types = (runtime.supportedDeviceTypes as Array<{ identifier: string; name: string }> | undefined) ?? [];
    if (types.length === 0) {
      types = JSON.parse(await mustExec('xcrun', ['simctl', 'list', 'devicetypes', '-j'])).devicetypes;
    }
    const iphones = types.filter((t) => t.name.startsWith('iPhone'));
    const wanted = process.env.SIM_DEVICE;
    const number = (name: string) => Number(/^iPhone (\d+)$/.exec(name)?.[1] ?? -1);
    const chosen =
      (wanted && iphones.find((t) => t.name === wanted)) ||
      // The newest plain model ("iPhone 16"), otherwise the last iPhone in the list.
      [...iphones].sort((a, b) => number(a.name) - number(b.name)).pop();
    if (!chosen) throw new Error('No iPhone simulator device type is available.');
    this.deviceTypeId = chosen.identifier;

    // Which model of phone each simulator is, for the ones the runtime can run.
    const runs = new Set(iphones.map((t) => t.identifier));
    const all = JSON.parse(await mustExec('xcrun', ['simctl', 'list', 'devicetypes', '-j'])).devicetypes as Array<{ identifier: string; modelIdentifier?: string }>;
    this.typesByModel = new Map(all.flatMap((t) => (t.modelIdentifier && runs.has(t.identifier) ? [[t.modelIdentifier, t.identifier] as const] : [])));
  }

  /** The template's name for a model of phone on this runtime: a new Xcode gets new templates. */
  private templateName(type: string): string {
    const short = (id: string) => id.split('.').pop()!.replace(/[^A-Za-z0-9-]/g, '');
    return `${TEMPLATE_PREFIX}${short(type)}-${short(this.runtimeId)}`;
  }

  /** Templates from an earlier runtime are of no more use. */
  private async forgetOldTemplates(): Promise<void> {
    const current = new Set([...this.typesByModel.values(), this.deviceTypeId].map((type) => this.templateName(type)));
    for (const d of await this.listDevices()) {
      if (d.name.startsWith(TEMPLATE_PREFIX) && !current.has(d.name)) {
        await exec('xcrun', ['simctl', 'shutdown', d.udid], { timeoutMs: 60_000 });
        await exec('xcrun', ['simctl', 'delete', d.udid], { timeoutMs: 60_000 });
      }
    }
  }

  /**
   * The template for a model of phone, made the first time it is asked for: a new simulator that is
   * booted once, so that it has done what a first boot does, and shut down again. Null when it could
   * not be made; new simulators are then made from scratch.
   */
  private templateFor(type: string): Promise<string | null> {
    const made = this.templates.get(type);
    if (made) return made;
    const making = (async () => {
      const name = this.templateName(type);
      const found = (await this.listDevices()).find((d) => d.name === name);
      if (found) {
        if (found.state !== 'Shutdown') await exec('xcrun', ['simctl', 'shutdown', found.udid], { timeoutMs: 60_000 });
        return found.udid;
      }
      const started = Date.now();
      const udid = (await mustExec('xcrun', ['simctl', 'create', name, type, this.runtimeId])).trim();
      try {
        const app = await this.warmApp().catch((err: Error) => {
          console.warn(`[xcode] template without a first app: ${err.message}`);
          return null;
        });
        await mustExec('xcrun', ['simctl', 'boot', udid], { timeoutMs: 180_000 });
        await mustExec('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000 });
        // The first install and launch in a simulator are slow too; the template has them behind it.
        if (app) {
          await exec('xcrun', ['simctl', 'install', udid, app], { timeoutMs: 300_000 });
          await exec('xcrun', ['simctl', 'launch', udid, WARM_BUNDLE_ID], { timeoutMs: 120_000 });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await exec('xcrun', ['simctl', 'terminate', udid, WARM_BUNDLE_ID]);
          await exec('xcrun', ['simctl', 'uninstall', udid, WARM_BUNDLE_ID], { timeoutMs: 120_000 });
        }
        // And a second boot, after which a simulator starts in a few seconds.
        await exec('xcrun', ['simctl', 'shutdown', udid], { timeoutMs: 60_000 });
        await mustExec('xcrun', ['simctl', 'boot', udid], { timeoutMs: 180_000 });
        await mustExec('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000 });
      } finally {
        await exec('xcrun', ['simctl', 'shutdown', udid], { timeoutMs: 60_000 });
      }
      console.log(`[xcode] template for ${type.split('.').pop()} ready in ${Math.round((Date.now() - started) / 1000)}s`);
      return udid;
    })().catch((err: Error) => {
      console.warn(`[xcode] no template for ${type}: ${err.message}`);
      this.templates.delete(type);
      return null;
    });
    this.templates.set(type, making);
    return making;
  }

  /** The small warm-up app, built once per worker process when first needed. */
  private warmAppPath: Promise<string> | null = null;

  /** Builds the small app a template runs once, and every simulator installs once it is up. Returns where the app is. */
  private warmApp(): Promise<string> {
    this.warmAppPath ??= this.buildWarmApp().catch((err: Error) => {
      this.warmAppPath = null;
      throw err;
    });
    return this.warmAppPath;
  }

  private async buildWarmApp(): Promise<string> {
    const dir = path.join(this.workDir, 'warmup');
    await fs.mkdir(path.join(dir, 'Sources'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Sources', 'WarmApp.swift'), WARM_APP);
    await fs.writeFile(path.join(dir, 'project.yml'), projectSpec({ appName: 'Warmup', bundleId: WARM_BUNDLE_ID }));
    await mustExec('xcodegen', ['generate', '--spec', 'project.yml', '--quiet'], { cwd: dir, timeoutMs: 60_000 });
    await mustExec(
      'xcodebuild',
      ['-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'build', '-quiet', 'CODE_SIGNING_ALLOWED=NO', 'COMPILER_INDEX_STORE_ENABLE=NO', 'build'],
      { cwd: dir, timeoutMs: BUILD_TIMEOUT_MS },
    );
    return path.join(dir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
  }

  /**
   * The first install after a simulator has started takes many seconds, whatever the app; the next
   * one takes about one. So the warm-up app goes in and out first, while the person's app compiles.
   */
  private async prime(udid: string): Promise<void> {
    if (process.env.SIM_PRIME === '0') return;
    const app = await this.warmApp().catch(() => null);
    if (!app) return;
    await exec('xcrun', ['simctl', 'install', udid, app], { timeoutMs: 120_000 });
    await exec('xcrun', ['simctl', 'uninstall', udid, WARM_BUNDLE_ID], { timeoutMs: 60_000 });
  }

  /**
   * Moves what the app saved in its old simulator into its new one, where it has just been installed,
   * and removes the old simulator. Done as well as it can be: an app that saved nothing, or a folder
   * that cannot be read, simply starts afresh.
   */
  private async moveSavedData(s: Session): Promise<void> {
    const from = s.migrateFrom!;
    s.migrateFrom = null;
    try {
      const apps = path.join(os.homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices', from, 'data', 'Containers', 'Data', 'Application');
      let old: string | null = null;
      for (const entry of await fs.readdir(apps).catch(() => [])) {
        const metadata = path.join(apps, entry, '.com.apple.mobile_container_manager.metadata.plist');
        const owner = await exec('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', '-o', '-', metadata]);
        if (owner.code === 0 && owner.stdout.trim() === s.bundleId) old = path.join(apps, entry);
      }
      if (old) {
        const fresh = (await mustExec('xcrun', ['simctl', 'get_app_container', s.udid, s.bundleId, 'data'])).trim();
        for (const entry of await fs.readdir(old)) {
          if (entry.startsWith('.com.apple.mobile_container_manager')) continue;
          await exec('ditto', [path.join(old, entry), path.join(fresh, entry)], { timeoutMs: 60_000 });
        }
      }
    } catch (err) {
      console.warn(`[xcode] ${s.projectId}: what the app saved was not moved (${(err as Error).message})`);
    }
    await exec('xcrun', ['simctl', 'delete', from], { timeoutMs: 60_000 });
  }

  /** How many simulators are running, the waiting copy included. */
  private runningCount(): number {
    return [...this.sessions.values()].filter((s) => s.booted).length + (this.spare ? 1 : 0);
  }

  /**
   * Keeps a running copy of the template waiting for the next new app, while there is room for one
   * besides the apps that are open: it gives way the moment an app needs the room.
   */
  private keepSpare(): void {
    if (!this.useTemplates || !this.useSpare || this.spare || this.makingSpare) return;
    if (this.runningCount() + 1 > this.maxSimulators) return;
    // Not while someone's app is being built and tried: a starting simulator slows everything on the Mac.
    const quiet = SPARE_QUIET_MS - (Date.now() - this.lastBuildAt);
    if (quiet > 0) {
      if (this.spareTimer) clearTimeout(this.spareTimer);
      this.spareTimer = setTimeout(() => {
        this.spareTimer = null;
        this.keepSpare();
      }, quiet);
      this.spareTimer.unref();
      return;
    }
    const type = this.deviceTypeId;
    this.makingSpare = (async () => {
      const template = await this.templateFor(type);
      if (!template || this.runningCount() + 1 > this.maxSimulators) return;
      const name = `${SPARE_PREFIX}${Date.now().toString(36)}`;
      const copy = await exec('xcrun', ['simctl', 'clone', template, name], { timeoutMs: 120_000 });
      const udid = copy.stdout.trim();
      if (copy.code !== 0 || !udid) return;
      await mustExec('xcrun', ['simctl', 'boot', udid], { timeoutMs: 180_000 });
      await mustExec('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeoutMs: 300_000 });
      await statusBar(udid);
      await this.prime(udid);
      this.spare = { udid, type };
      console.log('[xcode] a running simulator is waiting for the next app');
    })()
      .catch((err: Error) => console.warn(`[xcode] no waiting simulator: ${err.message}`))
      .finally(() => {
        this.makingSpare = null;
      });
  }

  /** The waiting copy, for a new app of its model: renamed to be the app's. Null when there is none. */
  private async takeSpare(name: string, type: string): Promise<string | null> {
    const spare = this.spare;
    if (!spare || spare.type !== type) return null;
    this.spare = null;
    const renamed = await exec('xcrun', ['simctl', 'rename', spare.udid, name], { timeoutMs: 30_000 });
    if (renamed.code !== 0) {
      await this.dropSpare(spare.udid);
      return null;
    }
    // The next one is made in the background, if there is room for it.
    setTimeout(() => this.keepSpare(), 1000);
    return spare.udid;
  }

  /** The waiting copy goes, to make room for an app. */
  private async dropSpare(udid = this.spare?.udid): Promise<void> {
    if (!udid) return;
    if (this.spare?.udid === udid) this.spare = null;
    await exec('xcrun', ['simctl', 'shutdown', udid], { timeoutMs: 60_000 });
    await exec('xcrun', ['simctl', 'delete', udid], { timeoutMs: 60_000 });
  }

  /**
   * A simulator for a new app: a copy of the template when it is ready (a few seconds to start),
   * otherwise a new one (close to a minute on its first boot).
   */
  private async newSimulator(name: string, type: string): Promise<string> {
    if (this.useTemplates) {
      const making = this.templateFor(type);
      // A template still being made is not waited for: that would take as long as a first boot.
      const template = await Promise.race([making, new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))]);
      if (template) {
        const copy = await exec('xcrun', ['simctl', 'clone', template, name], { timeoutMs: 120_000 });
        if (copy.code === 0 && copy.stdout.trim()) return copy.stdout.trim();
        console.warn(`[xcode] could not copy the template: ${copy.stderr.trim().slice(-200)}`);
      }
    }
    return (await mustExec('xcrun', ['simctl', 'create', name, type, this.runtimeId])).trim();
  }

  private async listDevices(): Promise<SimDevice[]> {
    const out = await mustExec('xcrun', ['simctl', 'list', 'devices', '-j']);
    const byRuntime = JSON.parse(out).devices as Record<string, SimDevice[]>;
    return Object.values(byRuntime).flat();
  }

  // --- Sessions ---------------------------------------------------------------

  private async session(job: BuildJob): Promise<Session> {
    const name = DEVICE_PREFIX + job.projectId;
    let existing = this.sessions.get(job.projectId);
    if (existing) {
      // Watched on another model of phone than the simulator is: a new simulator, of that model.
      if (simulatorTypeFor(job.device, this.typesByModel, existing.deviceTypeId, this.deviceTypeId) === existing.deviceTypeId) {
        existing.bundleId = job.bundleId;
        return existing;
      }
      await this.discard(existing);
      existing = undefined;
    }
    let found = (await this.listDevices()).find((d) => d.name === name);
    const type = simulatorTypeFor(job.device, this.typesByModel, found?.deviceTypeIdentifier, this.deviceTypeId);
    if (found && found.deviceTypeIdentifier !== type) {
      // What the app had saved in the old simulator goes with it.
      await exec('xcrun', ['simctl', 'shutdown', found.udid], { timeoutMs: 60_000 });
      await forgetCompanion(found.udid);
      await exec('xcrun', ['simctl', 'delete', found.udid], { timeoutMs: 60_000 });
      found = undefined;
    }
    let taken: string | null = null;
    let migrateFrom: string | null = null;
    if (!found || found.state === 'Shutdown') {
      // A running copy on its way is waited for, rather than a second simulator started beside it.
      if (!this.spare && this.makingSpare && type === this.deviceTypeId) await this.makingSpare;
      if (this.spare?.type === type) {
        // Coming back to an app whose simulator was shut down: the running copy is quicker than
        // starting that one again, and what the app saved comes along.
        if (found) {
          await exec('xcrun', ['simctl', 'rename', found.udid, `${OLD_PREFIX}${job.projectId}`], { timeoutMs: 30_000 });
          migrateFrom = found.udid;
        }
        taken = await this.takeSpare(name, type);
        if (!taken && migrateFrom) {
          await exec('xcrun', ['simctl', 'rename', migrateFrom, name], { timeoutMs: 30_000 });
          migrateFrom = null;
        }
      }
    }
    const udid = taken ?? found?.udid ?? (await this.newSimulator(name, type));
    const s: Session = {
      projectId: job.projectId,
      dir: path.join(this.workDir, 'projects', job.projectId),
      udid,
      deviceTypeId: type,
      bundleId: job.bundleId,
      // The waiting copy is already running, with its status bar tidied.
      booted: taken !== null,
      viewers: 0,
      video: false,
      light: false,
      lastUsed: Date.now(),
      streamer: null,
      toucher: null,
      held: null,
      finger: null,
      screen: null,
      inputChain: Promise.resolve(),
      chain: Promise.resolve(),
      timing: null,
      migrateFrom,
    };
    this.sessions.set(job.projectId, s);
    return s;
  }

  /** Runs tasks for one session strictly one after another. */
  /**
   * Ends a session without a word to the server: its simulator is about to be replaced by one of
   * another model, in the middle of a build that goes on. The simulator itself is removed by
   * whoever makes the new one.
   */
  private async discard(s: Session): Promise<void> {
    this.sessions.delete(s.projectId);
    await s.chain.catch(() => undefined);
    s.streamer?.stop();
    s.toucher?.stop();
  }

  private serial<T>(s: Session, task: () => Promise<T>): Promise<T> {
    const next = s.chain.catch(() => undefined).then(task);
    s.chain = next;
    return next;
  }

  private async boot(s: Session): Promise<void> {
    if (s.booted) return;
    await this.makeRoom(s);
    await forgetCompanion(s.udid);
    const res = await exec('xcrun', ['simctl', 'boot', s.udid], { timeoutMs: 180_000 });
    // Booting a device that is already booted reports an error we can ignore.
    if (res.code !== 0 && !/current state: Booted/i.test(res.stderr)) {
      throw new Error(`Could not boot the simulator: ${res.stderr.trim().slice(-300)}`);
    }
    await mustExec('xcrun', ['simctl', 'bootstatus', s.udid, '-b'], { timeoutMs: 240_000 });
    await statusBar(s.udid);
    await this.prime(s.udid);
    s.booted = true;
  }

  /** Each simulator uses a couple of GB of memory, so only a few run at once: the least recently used one goes. */
  private async makeRoom(newcomer: Session): Promise<void> {
    const booted = [...this.sessions.values()].filter((s) => s.booted && s !== newcomer);
    if (this.spare && booted.length + 1 >= this.maxSimulators) await this.dropSpare();
    if (booted.length < this.maxSimulators) return;
    booted.sort((a, b) => (a.viewers === 0 ? 0 : 1) - (b.viewers === 0 ? 0 : 1) || a.lastUsed - b.lastUsed);
    await this.release(booted[0]!.projectId);
  }

  // --- Build ------------------------------------------------------------------

  async build(job: BuildJob, progress: (stage: BuildStage) => void): Promise<{ ok: boolean; errors?: string }> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId)) {
      return { ok: false, errors: 'Invalid project.' };
    }
    const started = Date.now();
    this.lastBuildAt = started;
    const s = await this.session(job);
    return this.serial(s, async () => {
      const t: Timing = { start: started, steps: [] };
      s.timing = t;
      const cold = !s.booted;
      mark(t, 'session');
      s.lastUsed = Date.now();
      progress('preparing');
      await this.syncFiles(s, job);
      await touch(s.dir);
      mark(t, 'files');

      progress('compiling');
      // The simulator boots while the code compiles; both must finish before installing.
      // Once it is up, the screen stream starts too, so that it is running by the time the app is.
      // The warm-up app is built ahead, so that priming a starting simulator does not wait for it.
      void this.warmApp().catch(() => undefined);
      const booting = this.boot(s).then(async () => {
        mark(t, cold ? 'booted' : 'was booted');
        if (this.earlyStream) await this.startStream(s);
      });
      booting.catch(() => undefined);
      const compile = await exec(
        'xcodebuild',
        [
          '-project', 'App.xcodeproj',
          '-scheme', 'App',
          '-configuration', 'Debug',
          '-destination', `platform=iOS Simulator,id=${s.udid}`,
          '-derivedDataPath', 'build',
          '-quiet',
          'CODE_SIGNING_ALLOWED=NO',
          'COMPILER_INDEX_STORE_ENABLE=NO',
          'build',
        ],
        { cwd: s.dir, timeoutMs: BUILD_TIMEOUT_MS },
      );
      mark(t, 'compiled');
      this.lastBuildAt = Date.now();
      if (compile.code !== 0) {
        console.log(`[timing] ${s.projectId} failed to compile: ${timingLine(t)}`);
        s.timing = null;
        return { ok: false, errors: extractErrors(compile.stdout + '\n' + compile.stderr, s.dir) };
      }
      await booting;

      progress('installing');
      const appPath = path.join(s.dir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
      await mustExec('xcrun', ['simctl', 'install', s.udid, appPath], { timeoutMs: 120_000 });
      if (s.migrateFrom) await this.moveSavedData(s);
      mark(t, 'installed');

      progress('launching');
      await exec('xcrun', ['simctl', 'terminate', s.udid, s.bundleId]);
      await mustExec('xcrun', ['simctl', 'launch', s.udid, s.bundleId], { timeoutMs: 60_000 });
      mark(t, 'launched');

      if (!s.streamer) {
        await this.startStream(s);
      } else {
        s.streamer.refresh();
      }
      return { ok: true };
    });
  }

  /** Starts sending the simulator's screen, unless it is being sent already. */
  private async startStream(s: Session): Promise<void> {
    if (s.streamer) return;
    // Asking idb for the screen's size also starts the simulator's companion, once, before the
    // stream and the touches both come asking for it at the same moment.
    if (this.hasIdb) await this.screenSize(s);
    if (s.streamer) return;
    s.streamer = new Streamer(
      s.udid,
      this.hasIdb,
      (frame) => {
        this.firstPicture(s);
        return this.emit.frame(s.projectId, frame);
      },
      (format) => this.emit.streamInfo(s.projectId, format === 'h264' ? VIDEO_MIME : 'image/jpeg'),
      this.liveVideo ? this.idbPython : null,
    );
    this.emit.streamInfo(s.projectId, 'image/jpeg');
    s.streamer.setLight(s.light);
    s.streamer.setFormat(s.video && this.liveVideo ? 'h264' : 'mjpeg');
    s.streamer.setActive(s.viewers > 0);
    if (this.touchPython) s.toucher = new Toucher(s.udid, this.touchPython);
  }

  /** The build's first picture after the app started: its times are complete. */
  private firstPicture(s: Session): void {
    const t = s.timing;
    if (!t || !t.steps.some(([step]) => step === 'launched')) return;
    s.timing = null;
    mark(t, 'first picture');
    console.log(`[timing] ${s.projectId}: ${timingLine(t)}`);
  }

  async publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    // Someone else's key is only handled when the operator has said this machine may.
    if (job.account && process.env.PUBLISH_FOR_USERS !== '1') return { ok: false, error: 'unavailable' };
    return this.publisher.publish(job, progress);
  }

  async direct(job: DirectJob, progress: (stage: DirectStage) => void): Promise<DirectResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    if (job.account && process.env.PUBLISH_FOR_USERS !== '1') return { ok: false, error: 'unavailable' };
    return this.publisher.direct(job, progress);
  }

  async store(job: StoreJob, progress: (stage: StoreSyncStage) => void): Promise<StoreResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    if (job.account && process.env.PUBLISH_FOR_USERS !== '1') return { ok: false, error: 'unavailable' };
    return this.publisher.syncStore(job, progress);
  }

  async share(job: ShareJob): Promise<ShareResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    if (job.account && process.env.PUBLISH_FOR_USERS !== '1') return { ok: false, error: 'unavailable' };
    return this.publisher.share(job);
  }

  async invite(job: InviteJob): Promise<InviteResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    return this.publisher.invite(job);
  }

  async submit(job: SubmitJob): Promise<StoreResult> {
    if (!this.publisher) return { ok: false, error: 'unavailable' };
    if (job.account && process.env.PUBLISH_FOR_USERS !== '1') return { ok: false, error: 'unavailable' };
    return this.publisher.submit(job);
  }

  /**
   * Deletes simulators and build folders of projects that have not been used for PRUNE_AFTER_DAYS
   * (default 14, 0 to keep everything). A project that comes back is simply built from scratch again.
   */
  private async prune(): Promise<void> {
    const days = pruneAfterDays();
    if (days === 0) return;
    try {
      const inUse = new Set(this.sessions.keys());
      const projects = path.join(this.workDir, 'projects');
      const folders = await listFolders(projects);
      const lastUsed = new Map(folders.map((f) => [f.id, f.lastUsedMs]));

      // A simulator is as old as its project's folder; one without a folder belongs to nothing.
      const simulators = (await this.listDevices())
        .filter((d) => d.name.startsWith(DEVICE_PREFIX) && !d.name.startsWith(TEMPLATE_PREFIX) && !d.name.startsWith(SPARE_PREFIX) && d.state === 'Shutdown')
        .map((d) => ({ udid: d.udid, id: d.name.slice(DEVICE_PREFIX.length) }));
      const staleSims = new Set(
        staleIds(simulators.map((d) => ({ id: d.id, lastUsedMs: lastUsed.get(d.id) ?? null })), inUse, Date.now(), days),
      );
      for (const sim of simulators) {
        if (staleSims.has(sim.id)) await exec('xcrun', ['simctl', 'delete', sim.udid], { timeoutMs: 60_000 });
      }

      const staleFolders = staleIds(folders, inUse, Date.now(), days);
      for (const id of staleFolders) await fs.rm(path.join(projects, id), { recursive: true, force: true });

      const uploads = path.join(this.workDir, 'publish');
      const staleUploads = staleIds(await listFolders(uploads), new Set(), Date.now(), days);
      for (const id of staleUploads) await fs.rm(path.join(uploads, id), { recursive: true, force: true });

      const removed = staleSims.size + staleFolders.length + staleUploads.length;
      if (removed > 0) {
        console.log(
          `[xcode] cleared ${staleSims.size} simulators, ${staleFolders.length} build folders and ${staleUploads.length} upload folders unused for ${days} days`,
        );
      }
    } catch (err) {
      console.warn(`[xcode] clean-up failed: ${(err as Error).message}`);
    }
  }

  /** Mirrors the job's files into the project folder and regenerates the Xcode project when the file set changes. */
  private async syncFiles(s: Session, job: BuildJob): Promise<void> {
    const wanted = await mirrorSources(s.dir, job.files);

    const spec = projectSpec(job);
    const specPath = path.join(s.dir, 'project.yml');
    const listPath = path.join(s.dir, '.filelist');
    const fileList = wanted.join('\n');
    const upToDate =
      (await fs.readFile(specPath, 'utf8').catch(() => null)) === spec &&
      (await fs.readFile(listPath, 'utf8').catch(() => null)) === fileList &&
      (await fs.stat(path.join(s.dir, 'App.xcodeproj')).catch(() => null)) !== null;
    if (upToDate) return;
    await fs.writeFile(specPath, spec);
    await mustExec('xcodegen', ['generate', '--spec', 'project.yml', '--quiet'], { cwd: s.dir, timeoutMs: 60_000 });
    await fs.writeFile(listPath, fileList);
  }

  // --- Preview ----------------------------------------------------------------

  async screenshot(projectId: string, opts: { store?: boolean } = {}): Promise<{ mime: string; data: Buffer }> {
    const s = this.sessions.get(projectId);
    if (!s?.booted) throw new Error('No simulator is running for this project.');
    if (opts.store) return this.serial(s, () => this.storeScreenshot(s.udid));
    return this.serial(s, async () => {
      const file = path.join(os.tmpdir(), `appsmedjan-shot-${s.udid}.jpg`);
      await mustExec('xcrun', ['simctl', 'io', s.udid, 'screenshot', '--type=jpeg', file], { timeoutMs: 20_000 });
      // Shrink to a size that is plenty for judging a layout.
      await exec('sips', ['-Z', '1400', file]);
      const data = await fs.readFile(file);
      await fs.rm(file, { force: true });
      return { mime: 'image/jpeg', data };
    });
  }

  /**
   * A picture of the screen in the size the App Store asks for on the largest iPhone. Today's iPhones
   * all have the same shape, so the picture from a smaller model is scaled up by a few percent
   * instead of running a second, larger simulator just for this.
   */
  private async storeScreenshot(udid: string): Promise<{ mime: string; data: Buffer }> {
    const png = path.join(os.tmpdir(), `appsmedjan-store-${udid}.png`);
    const jpg = path.join(os.tmpdir(), `appsmedjan-store-${udid}.jpg`);
    try {
      await mustExec('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', png], { timeoutMs: 20_000 });
      const size = await mustExec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', png]);
      const width = Number(/pixelWidth: (\d+)/.exec(size)?.[1]);
      const height = Number(/pixelHeight: (\d+)/.exec(size)?.[1]);
      const shape = width / height;
      const wanted = STORE_SHOT.width / STORE_SHOT.height;
      if (!(Math.abs(shape - wanted) / wanted < 0.02)) {
        throw new Error(`The simulator's screen (${width} x ${height}) does not have the shape App Store screenshots need.`);
      }
      if (width !== STORE_SHOT.width || height !== STORE_SHOT.height) {
        await mustExec('sips', ['-z', String(STORE_SHOT.height), String(STORE_SHOT.width), png]);
      }
      // JPEG keeps each picture around half a megabyte; ten of them travel in one message.
      await mustExec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', png, '--out', jpg]);
      return { mime: 'image/jpeg', data: await fs.readFile(jpg) };
    } finally {
      await fs.rm(png, { force: true });
      await fs.rm(jpg, { force: true });
    }
  }

  setViewers(projectId: string, count: number, video = false, light = false): void {
    const s = this.sessions.get(projectId);
    if (!s) return;
    s.viewers = count;
    s.video = video;
    s.light = light && this.lightVideo;
    if (count > 0) s.lastUsed = Date.now();
    s.streamer?.setLight(s.light);
    s.streamer?.setFormat(video && this.liveVideo ? 'h264' : 'mjpeg');
    s.streamer?.setActive(count > 0);
    if (count > 0) s.streamer?.refresh();
  }

  input(projectId: string, event: InputEvent): void {
    const s = this.sessions.get(projectId);
    if (!s?.booted || !this.hasIdb) return;
    s.lastUsed = Date.now();
    // Straight through the open connection when there is one.
    if (s.toucher && s.screen) {
      const live = touchMessages(event, s.screen, s.held);
      const sent = live.messages.length === 0 ? 'sent' : s.toucher.send(live.messages);
      s.held = sent === 'sent' ? live.held : null;
      if (sent !== 'gone') {
        s.finger = null;
        return;
      }
    }
    // Otherwise as a command of its own, for which a finger's movements are gathered into one gesture.
    const whole = wholeGesture(event, s.finger, Date.now());
    s.finger = whole.finger;
    const gesture = whole.event;
    if (!gesture) return;
    s.inputChain = s.inputChain.then(() => this.applyInput(s, gesture)).catch((err) => {
      console.warn(`[xcode] input failed: ${(err as Error).message}`);
    });
  }

  private async screenSize(s: Session): Promise<{ width: number; height: number }> {
    if (s.screen) return s.screen;
    const res = await exec('idb', ['describe', '--udid', s.udid, '--json'], { timeoutMs: 20_000 });
    try {
      const dims = JSON.parse(res.stdout).screen_dimensions;
      s.screen = { width: Number(dims.width_points), height: Number(dims.height_points) };
    } catch {
      s.screen = { width: 393, height: 852 }; // Current standard iPhone size in points.
    }
    if (!(s.screen.width > 0 && s.screen.height > 0)) s.screen = { width: 393, height: 852 };
    return s.screen;
  }

  private async applyInput(s: Session, event: Gesture): Promise<void> {
    // "--" keeps typed text that starts with a dash from being read as an option.
    const idb = (command: string, positional: string[], options: string[] = []) =>
      exec('idb', ['ui', command, '--udid', s.udid, ...options, '--', ...positional], { timeoutMs: 15_000 });
    switch (event.kind) {
      case 'tap': {
        const { width, height } = await this.screenSize(s);
        await idb('tap', [String(Math.round(event.x * width)), String(Math.round(event.y * height))]);
        break;
      }
      case 'swipe': {
        const { width, height } = await this.screenSize(s);
        await idb(
          'swipe',
          [
            String(Math.round(event.x1 * width)), String(Math.round(event.y1 * height)),
            String(Math.round(event.x2 * width)), String(Math.round(event.y2 * height)),
          ],
          ['--duration', (event.durationMs / 1000).toFixed(2)],
        );
        break;
      }
      case 'text':
        await idb('text', [event.text]);
        break;
      case 'key':
        // USB HID usage codes: 42 is Backspace, 40 is Return.
        await idb('key', [event.key === 'backspace' ? '42' : '40']);
        break;
      case 'button':
        await idb('button', ['HOME']);
        break;
    }
  }

  async release(projectId: string): Promise<void> {
    const s = this.sessions.get(projectId);
    if (!s) return;
    this.sessions.delete(projectId);
    await s.chain.catch(() => undefined);
    s.streamer?.stop();
    s.toucher?.stop();
    await exec('xcrun', ['simctl', 'shutdown', s.udid], { timeoutMs: 60_000 });
    await forgetCompanion(s.udid);
    if (process.env.DELETE_SIMULATORS_ON_RELEASE) await exec('xcrun', ['simctl', 'delete', s.udid]);
    this.emit.stopped(projectId);
    this.keepSpare();
  }

  async shutdown(): Promise<void> {
    await this.dropSpare();
    await Promise.all([...this.sessions.keys()].map((id) => this.release(id)));
  }
}

// --- Helpers ------------------------------------------------------------------

/**
 * idb talks to each simulator through a companion process that it leaves running. One that was
 * started before the simulator was last shut down still shows the screen, but every touch sent
 * through it is thrown away. So it is ended whenever its simulator stops or starts, and idb starts
 * a fresh one the next time it is asked for something.
 */
/** A tidy status bar, like in Apple's own screenshots. Purely cosmetic. */
async function statusBar(udid: string): Promise<void> {
  await exec('xcrun', ['simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4']);
}

async function forgetCompanion(udid: string): Promise<void> {
  // Off idb's own list first: a companion that is listed but gone is never replaced.
  await exec('idb', ['disconnect', udid], { timeoutMs: 20_000 });
  await exec('pkill', ['-f', `idb_companion --udid ${udid}`]);
}

/** Makes dir/Sources match the given files exactly, and returns the paths that were kept. */
export async function mirrorSources(dir: string, files: Record<string, string>): Promise<string[]> {
  await fs.mkdir(path.join(dir, 'Sources'), { recursive: true });
  const wanted = Object.keys(files).filter(isValidSourcePath).sort();
  for (const rel of await listFiles(dir, 'Sources')) {
    if (!wanted.includes(rel)) await fs.rm(path.join(dir, rel), { force: true });
  }
  for (const rel of wanted) {
    const target = path.join(dir, rel);
    const content = files[rel]!;
    // Untouched files keep their timestamps, which keeps incremental builds fast.
    const current = await fs.readFile(target, 'utf8').catch(() => null);
    if (current === content) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return wanted;
}

async function listFiles(root: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await listFiles(root, child)));
    else out.push(child);
  }
  return out;
}

export { projectSpec };

/** Pulls the compiler errors out of xcodebuild's output, with paths relative to the project. */
export function extractErrors(output: string, projectDir: string): string {
  const lines = output.split('\n').map((l) => l.replaceAll(projectDir + '/', ''));
  const errors: string[] = [];
  for (const line of lines) {
    if (/\berror:/.test(line) && !errors.includes(line.trim())) errors.push(line.trim());
  }
  if (errors.length > 0) {
    const shown = errors.slice(0, 25);
    const more = errors.length > shown.length ? `\n(${errors.length - shown.length} more errors not shown)` : '';
    return shown.join('\n') + more;
  }
  return lines.filter((l) => l.trim()).slice(-40).join('\n');
}
