// The real driver: builds with XcodeGen + xcodebuild and runs the app in an iOS Simulator.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  isValidBundleId,
  isValidProjectId,
  isValidSourcePath,
  type BuildStage,
  type InputEvent,
} from '../../shared/protocol';
import type { BuildJob, Driver, Emit } from './driver';
import { exec, mustExec } from './exec';
import { Streamer } from './stream';

interface Session {
  projectId: string;
  dir: string;
  udid: string;
  bundleId: string;
  booted: boolean;
  viewers: number;
  lastUsed: number;
  streamer: Streamer | null;
  /** Screen size in points, needed to turn normalized touch positions into coordinates. */
  screen: { width: number; height: number } | null;
  /** Input events are applied in order. */
  inputChain: Promise<void>;
  /** Builds, screenshots and release for one project never overlap. */
  chain: Promise<unknown>;
}

interface SimDevice {
  udid: string;
  name: string;
  state: string;
}

const DEVICE_PREFIX = 'asm-';
const BUILD_TIMEOUT_MS = 10 * 60_000;

export class XcodeDriver implements Driver {
  private sessions = new Map<string, Session>();
  private runtimeId = '';
  private deviceTypeId = '';
  private hasIdb = false;
  private readonly workDir: string;
  private readonly maxSimulators: number;

  constructor(
    private readonly emit: Emit,
    opts: { maxSimulators: number; workDir?: string },
  ) {
    this.maxSimulators = opts.maxSimulators;
    this.workDir = opts.workDir ?? path.join(os.homedir(), 'Library', 'Application Support', 'appsmedjan-worker');
  }

  async init(): Promise<{ canInput: boolean; info: string }> {
    const xcode = await exec('xcodebuild', ['-version']);
    if (xcode.code !== 0) throw new Error('Xcode is not installed (xcodebuild not found). Install Xcode from the App Store.');
    const xcodegen = await exec('xcodegen', ['--version']);
    if (xcodegen.code !== 0) throw new Error('XcodeGen is not installed. Run: brew install xcodegen');
    this.hasIdb = (await exec('idb', ['--help'], { timeoutMs: 20_000 })).code === 0;
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
      }
    }
    const version = xcode.stdout.split('\n')[0]?.trim() ?? 'Xcode';
    return { canInput: this.hasIdb, info: `${version}, ${this.deviceTypeId.split('.').pop()}, ${this.runtimeId.split('.').pop()}` };
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
  }

  private async listDevices(): Promise<SimDevice[]> {
    const out = await mustExec('xcrun', ['simctl', 'list', 'devices', '-j']);
    const byRuntime = JSON.parse(out).devices as Record<string, SimDevice[]>;
    return Object.values(byRuntime).flat();
  }

  // --- Sessions ---------------------------------------------------------------

  private async session(job: BuildJob): Promise<Session> {
    const existing = this.sessions.get(job.projectId);
    if (existing) {
      existing.bundleId = job.bundleId;
      return existing;
    }
    const name = DEVICE_PREFIX + job.projectId;
    const found = (await this.listDevices()).find((d) => d.name === name);
    const udid =
      found?.udid ?? (await mustExec('xcrun', ['simctl', 'create', name, this.deviceTypeId, this.runtimeId])).trim();
    const s: Session = {
      projectId: job.projectId,
      dir: path.join(this.workDir, 'projects', job.projectId),
      udid,
      bundleId: job.bundleId,
      booted: false,
      viewers: 0,
      lastUsed: Date.now(),
      streamer: null,
      screen: null,
      inputChain: Promise.resolve(),
      chain: Promise.resolve(),
    };
    this.sessions.set(job.projectId, s);
    return s;
  }

  /** Runs tasks for one session strictly one after another. */
  private serial<T>(s: Session, task: () => Promise<T>): Promise<T> {
    const next = s.chain.catch(() => undefined).then(task);
    s.chain = next;
    return next;
  }

  private async boot(s: Session): Promise<void> {
    if (s.booted) return;
    await this.makeRoom(s);
    const res = await exec('xcrun', ['simctl', 'boot', s.udid], { timeoutMs: 180_000 });
    // Booting a device that is already booted reports an error we can ignore.
    if (res.code !== 0 && !/current state: Booted/i.test(res.stderr)) {
      throw new Error(`Could not boot the simulator: ${res.stderr.trim().slice(-300)}`);
    }
    await mustExec('xcrun', ['simctl', 'bootstatus', s.udid, '-b'], { timeoutMs: 240_000 });
    // A tidy status bar, like in Apple's own screenshots. Purely cosmetic.
    await exec('xcrun', [
      'simctl', 'status_bar', s.udid, 'override',
      '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--cellularBars', '4',
    ]);
    s.booted = true;
  }

  /** Each simulator uses a couple of GB of memory, so only a few run at once: the least recently used one goes. */
  private async makeRoom(newcomer: Session): Promise<void> {
    const booted = [...this.sessions.values()].filter((s) => s.booted && s !== newcomer);
    if (booted.length < this.maxSimulators) return;
    booted.sort((a, b) => (a.viewers === 0 ? 0 : 1) - (b.viewers === 0 ? 0 : 1) || a.lastUsed - b.lastUsed);
    await this.release(booted[0]!.projectId);
  }

  // --- Build ------------------------------------------------------------------

  async build(job: BuildJob, progress: (stage: BuildStage) => void): Promise<{ ok: boolean; errors?: string }> {
    if (!isValidProjectId(job.projectId) || !isValidBundleId(job.bundleId)) {
      return { ok: false, errors: 'Invalid project.' };
    }
    const s = await this.session(job);
    return this.serial(s, async () => {
      s.lastUsed = Date.now();
      progress('preparing');
      await this.syncFiles(s, job);

      progress('compiling');
      // The simulator boots while the code compiles; both must finish before installing.
      const booting = this.boot(s);
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
      if (compile.code !== 0) {
        return { ok: false, errors: extractErrors(compile.stdout + '\n' + compile.stderr, s.dir) };
      }
      await booting;

      progress('installing');
      const appPath = path.join(s.dir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
      await mustExec('xcrun', ['simctl', 'install', s.udid, appPath], { timeoutMs: 120_000 });

      progress('launching');
      await exec('xcrun', ['simctl', 'terminate', s.udid, s.bundleId]);
      await mustExec('xcrun', ['simctl', 'launch', s.udid, s.bundleId], { timeoutMs: 60_000 });

      if (!s.streamer) {
        s.streamer = new Streamer(s.udid, this.hasIdb, (frame) => this.emit.frame(s.projectId, frame));
        this.emit.streamInfo(s.projectId, 'image/jpeg');
        s.streamer.setActive(s.viewers > 0);
      } else {
        s.streamer.refresh();
      }
      return { ok: true };
    });
  }

  /** Mirrors the job's files into the project folder and regenerates the Xcode project when the file set changes. */
  private async syncFiles(s: Session, job: BuildJob): Promise<void> {
    const sources = path.join(s.dir, 'Sources');
    await fs.mkdir(sources, { recursive: true });

    const wanted = Object.keys(job.files).filter(isValidSourcePath).sort();
    const existing = await listFiles(s.dir, 'Sources');
    for (const rel of existing) {
      if (!wanted.includes(rel)) await fs.rm(path.join(s.dir, rel), { force: true });
    }
    for (const rel of wanted) {
      const target = path.join(s.dir, rel);
      const content = job.files[rel]!;
      // Untouched files keep their timestamps, which keeps incremental builds fast.
      const current = await fs.readFile(target, 'utf8').catch(() => null);
      if (current === content) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }

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

  async screenshot(projectId: string): Promise<{ mime: string; data: Buffer }> {
    const s = this.sessions.get(projectId);
    if (!s?.booted) throw new Error('No simulator is running for this project.');
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

  setViewers(projectId: string, count: number): void {
    const s = this.sessions.get(projectId);
    if (!s) return;
    s.viewers = count;
    if (count > 0) s.lastUsed = Date.now();
    s.streamer?.setActive(count > 0);
    if (count > 0) s.streamer?.refresh();
  }

  input(projectId: string, event: InputEvent): void {
    const s = this.sessions.get(projectId);
    if (!s?.booted || !this.hasIdb) return;
    s.lastUsed = Date.now();
    s.inputChain = s.inputChain.then(() => this.applyInput(s, event)).catch((err) => {
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

  private async applyInput(s: Session, event: InputEvent): Promise<void> {
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
    await exec('xcrun', ['simctl', 'shutdown', s.udid], { timeoutMs: 60_000 });
    if (process.env.DELETE_SIMULATORS_ON_RELEASE) await exec('xcrun', ['simctl', 'delete', s.udid]);
    this.emit.stopped(projectId);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.release(id)));
  }
}

// --- Helpers ------------------------------------------------------------------

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

/** The XcodeGen spec. Only the app name and bundle id vary, and both are written as quoted JSON strings. */
export function projectSpec(job: { appName: string; bundleId: string }): string {
  // Control characters and "$" (build-setting expansion) are dropped from the name.
  const cleaned = job.appName.replace(/[\u0000-\u001f]/g, ' ').replace(/[$\\]/g, '').replace(/\s+/g, ' ').trim();
  const displayName = JSON.stringify(cleaned.slice(0, 30) || 'App');
  return `name: App
options:
  createIntermediateGroups: true
  deploymentTarget:
    iOS: "17.0"
targets:
  App:
    type: application
    platform: iOS
    sources:
      - path: Sources
    scheme: {}
    settings:
      base:
        PRODUCT_NAME: App
        PRODUCT_BUNDLE_IDENTIFIER: ${JSON.stringify(job.bundleId)}
        MARKETING_VERSION: "1.0"
        CURRENT_PROJECT_VERSION: "1"
        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1"
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_CFBundleDisplayName: ${displayName}
        INFOPLIST_KEY_UILaunchScreen_Generation: YES
        INFOPLIST_KEY_UISupportedInterfaceOrientations: UIInterfaceOrientationPortrait
        INFOPLIST_KEY_UIApplicationSceneManifest_Generation: YES
`;
}

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
