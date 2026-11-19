// A stand-in driver for development on machines without Xcode (Linux, CI).
// It "builds" instantly and streams a drawn placeholder screen so the whole flow can be exercised.
import type { BuildStage, InputEvent, PublishStage } from '../../shared/protocol';
import type { BuildJob, Driver, Emit, PublishJob, PublishResult } from './driver';

interface MockSession {
  appName: string;
  fileCount: number;
  viewers: number;
  taps: Array<{ x: number; y: number }>;
  typed: string;
  builds: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

export class MockDriver implements Driver {
  private sessions = new Map<string, MockSession>();

  constructor(private readonly emit: Emit) {}

  async init() {
    return { canInput: true, canPublish: true, hasOwnAccount: true, publishesForUsers: true, info: 'mock driver, no Xcode' };
  }

  async build(job: BuildJob, progress: (stage: BuildStage) => void) {
    progress('preparing');
    await sleep(200);
    progress('compiling');
    await sleep(900);
    // Lets tests exercise the agent's fix-and-rebuild loop.
    const broken = Object.entries(job.files).find(([, content]) => content.includes('MOCK_BUILD_ERROR'));
    if (broken) {
      return { ok: false, errors: `${broken[0]}:1:1: error: cannot find 'MOCK_BUILD_ERROR' in scope` };
    }
    progress('installing');
    await sleep(200);
    progress('launching');
    await sleep(200);
    const s = this.sessions.get(job.projectId) ?? { appName: '', fileCount: 0, viewers: 0, taps: [], typed: '', builds: 0 };
    s.appName = job.appName;
    s.fileCount = Object.keys(job.files).length;
    s.builds += 1;
    s.taps = [];
    this.sessions.set(job.projectId, s);
    this.emit.streamInfo(job.projectId, 'image/svg+xml');
    this.draw(job.projectId);
    return { ok: true };
  }

  /** Pretends to upload. A file containing MOCK_NO_APP_RECORD exercises the "create the app first" path. */
  async publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    const target = job.account ? `the person's own team ${job.account.teamId}` : "the operator's account";
    console.log(`[mock] upload for ${job.projectId} to ${target}`);
    progress('preparing');
    await sleep(200);
    progress('archiving');
    await sleep(600);
    if (Object.values(job.files).some((content) => content.includes('MOCK_BUILD_ERROR'))) {
      return { ok: false, error: 'compile' };
    }
    progress('uploading');
    await sleep(600);
    if (Object.values(job.files).some((content) => content.includes('MOCK_NO_APP_RECORD'))) {
      return { ok: false, error: 'no_app_record' };
    }
    return { ok: true };
  }

  async screenshot(): Promise<{ mime: string; data: Buffer }> {
    throw new Error('Screenshots are not available in the mock driver.');
  }

  input(projectId: string, event: InputEvent): void {
    const s = this.sessions.get(projectId);
    if (!s) return;
    if (event.kind === 'tap') s.taps = [...s.taps.slice(-4), { x: event.x, y: event.y }];
    if (event.kind === 'swipe') s.taps = [...s.taps.slice(-4), { x: event.x2, y: event.y2 }];
    if (event.kind === 'text') s.typed = (s.typed + event.text).slice(-28);
    if (event.kind === 'key' && event.key === 'backspace') s.typed = s.typed.slice(0, -1);
    if (event.kind === 'button') {
      s.taps = [];
      s.typed = '';
    }
    this.draw(projectId);
  }

  setViewers(projectId: string, count: number): void {
    const s = this.sessions.get(projectId);
    if (!s) return;
    s.viewers = count;
    if (count > 0) this.draw(projectId);
  }

  async release(projectId: string): Promise<void> {
    if (this.sessions.delete(projectId)) this.emit.stopped(projectId);
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.release(id);
  }

  private draw(projectId: string): void {
    const s = this.sessions.get(projectId);
    if (!s) return;
    const W = 393;
    const H = 852;
    const taps = s.taps
      .map((t, i) => `<circle cx="${(t.x * W).toFixed(1)}" cy="${(t.y * H).toFixed(1)}" r="${14 + i * 2}" fill="#ff7a1a" fill-opacity="${0.15 + i * 0.12}"/>`)
      .join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#f2f2f7"/>
  <text x="32" y="38" font-size="15" font-weight="600" fill="#111">9:41</text>
  <text x="24" y="120" font-size="34" font-weight="700" fill="#111">${escapeXml(s.appName)}</text>
  <rect x="16" y="150" width="${W - 32}" height="150" rx="16" fill="#fff"/>
  <text x="32" y="186" font-size="15" fill="#6b6b70">Simulated preview (no Mac connected)</text>
  <text x="32" y="222" font-size="17" fill="#111">${s.fileCount} source files, build #${s.builds}</text>
  <text x="32" y="258" font-size="17" fill="#111">Typed: ${escapeXml(s.typed) || '-'}</text>
  <text x="32" y="284" font-size="13" fill="#6b6b70">Tap anywhere to see input reach the worker</text>
  ${taps}
  <rect x="${W / 2 - 67}" y="${H - 14}" width="134" height="5" rx="2.5" fill="#111"/>
</svg>`;
    this.emit.frame(projectId, Buffer.from(svg));
  }
}
