// A stand-in driver for development on machines without Xcode (Linux, CI).
// It "builds" instantly and streams a drawn placeholder screen so the whole flow can be exercised.
import type { BuildStage, DirectStage, InputEvent, PublishStage, StoreSyncStage } from '../../shared/protocol';
import type { BuildJob, DirectJob, DirectResult, Driver, Emit, InviteJob, InviteResult, PublishJob, PublishResult, ShareJob, ShareResult, StoreJob, StoreResult, SubmitJob } from './driver';

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
  private refuseSubmit = new Set<string>();
  /** How many times each build's public link has been asked about: it moves on a step each time. */
  private shareAsked = new Map<string, number>();
  private uploaded = new Map<string, Record<string, string>>();
  private invited = new Map<string, number>();

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

  /** Pretends to upload. Markers in the files exercise the "create the app first" paths. */
  async publish(job: PublishJob, progress: (stage: PublishStage) => void): Promise<PublishResult> {
    const target = job.account ? `the person's own team ${job.account.teamId}` : "the operator's account";
    console.log(`[mock] upload for ${job.projectId} to ${target}`);
    const has = (marker: string) => Object.values(job.files).some((content) => content.includes(marker));
    progress('preparing');
    await sleep(200);
    // MOCK_APP_APPEARS: someone creates the app while we wait. MOCK_NO_APP_RECORD: nobody does.
    if (has('MOCK_APP_APPEARS') || has('MOCK_NO_APP_RECORD')) {
      progress('waiting_for_app');
      await sleep(1500);
      if (has('MOCK_NO_APP_RECORD')) return { ok: false, error: 'no_app_record' };
    }
    progress('archiving');
    await sleep(600);
    if (has('MOCK_BUILD_ERROR')) return { ok: false, error: 'compile' };
    progress('uploading');
    await sleep(600);
    this.uploaded.set(job.projectId, job.files);
    return { ok: true, tester: has('MOCK_TESTER_MANUAL') ? 'manual' : 'added' };
  }

  /**
   * Pretends to sign the app for the person's phones. The "app file" is a few bytes of text, which
   * no phone can install: the mock is for trying the flow around it. Markers exercise the failures.
   */
  async direct(job: DirectJob, progress: (stage: DirectStage) => void): Promise<DirectResult> {
    console.log(`[mock] direct install for ${job.projectId}, ${job.phones.length} phone(s)`);
    const has = (marker: string) => Object.values(job.files).some((content) => content.includes(marker));
    if (job.phones.length === 0) return { ok: false, error: 'no_phones' };
    progress('preparing');
    await sleep(300);
    if (has('MOCK_PHONE_PROCESSING')) return { ok: false, error: 'phone_processing' };
    if (has('MOCK_PHONE_LIMIT')) return { ok: false, error: 'phone_limit' };
    progress('archiving');
    await sleep(600);
    if (has('MOCK_BUILD_ERROR')) return { ok: false, error: 'compile' };
    progress('signing');
    await sleep(500);
    return { ok: true, ipa: Buffer.from(`MOCK IPA ${job.bundleId} ${job.buildNumber}`) };
  }

  /** Pretends to fill in the App Store page. Markers in the description exercise the failure paths. */
  async store(job: StoreJob, progress: (stage: StoreSyncStage) => void): Promise<StoreResult> {
    console.log(`[mock] App Store page for ${job.projectId}: "${job.listing.name}", ${job.screenshots.length} screenshot(s), build ${job.build ?? 'none'}`);
    const has = (marker: string) => job.listing.description.includes(marker);
    progress('version');
    await sleep(300);
    if (has('MOCK_NO_APP_RECORD')) return { ok: false, error: 'no_app_record' };
    if (has('MOCK_LOCKED')) return { ok: false, error: 'locked' };
    progress('texts');
    await sleep(300);
    if (has('MOCK_REJECTED')) return { ok: false, error: 'rejected', detail: 'The app name is already being used.' };
    progress('screenshots');
    await sleep(200 * job.screenshots.length);
    progress('build');
    await sleep(200);
    progress('details');
    await sleep(200);
    console.log(`[mock] details for ${job.projectId}: choices ${JSON.stringify(job.choices ?? {})}, contact ${job.contact ? 'given' : 'not given'}`);
    if (has('MOCK_SUBMIT_REFUSED')) this.refuseSubmit.add(job.projectId);
    else this.refuseSubmit.delete(job.projectId);
    // MOCK_BUILD: as if a build had been uploaded, so the submit step can be tried without one.
    return { ok: true, attached: job.build || has('MOCK_BUILD') ? (has('MOCK_PROCESSING') ? 'processing' : 'attached') : 'none' };
  }

  /**
   * Pretends to prepare a public TestFlight link. The build is "processing" the first time it is
   * asked about, "in review" the next two, and then approved, or rejected with MOCK_BETA_REJECTED.
   */
  async share(job: ShareJob): Promise<ShareResult> {
    const files = this.uploaded.get(job.projectId) ?? {};
    const has = (marker: string) => Object.values(files).some((content) => content.includes(marker));
    if (has('MOCK_SHARE_REFUSED')) return { ok: false, error: 'rejected', detail: 'Test information: the description is missing.' };
    const key = `${job.projectId}:${job.build}`;
    const asked = (this.shareAsked.get(key) ?? 0) + 1;
    this.shareAsked.set(key, asked);
    console.log(`[mock] ${job.check ? 'check' : 'share'} ${job.projectId} build ${job.build} (${asked})`);
    await sleep(150);
    if (asked === 1) return { ok: true, state: 'processing' };
    const url = `https://testflight.apple.com/join/mock${job.projectId.slice(0, 4)}`;
    if (asked <= 3) return { ok: true, state: 'review', url };
    return { ok: true, state: has('MOCK_BETA_REJECTED') ? 'rejected' : 'approved', url };
  }

  /** Pretends to invite an internal tester: the invitation is "accepted" by the third time it is asked about. */
  async invite(job: InviteJob): Promise<InviteResult> {
    if (job.person.email.startsWith('refused')) return { ok: false, error: 'rejected', detail: 'This email address is already in use by another team member.' };
    const asked = (this.invited.get(job.projectId) ?? 0) + 1;
    this.invited.set(job.projectId, asked);
    console.log(`[mock] invite ${job.person.email} as a tester of ${job.projectId} (${asked})`);
    await sleep(150);
    return { ok: true, state: asked >= 3 ? 'added' : 'invited' };
  }

  /** Pretends to submit for review. A page sent with MOCK_SUBMIT_REFUSED in its description is refused. */
  async submit(job: SubmitJob): Promise<StoreResult> {
    console.log(`[mock] submit ${job.projectId} for review`);
    await sleep(500);
    if (this.refuseSubmit.has(job.projectId)) {
      return { ok: false, error: 'rejected', detail: 'App Privacy: you must answer the privacy questions before submitting.' };
    }
    return { ok: true };
  }

  /** Only the App Store kind exists here: the drawn placeholder screen, so the flow can be tried. */
  async screenshot(projectId: string, opts: { store?: boolean } = {}): Promise<{ mime: string; data: Buffer }> {
    const s = this.sessions.get(projectId);
    if (!opts.store || !s) throw new Error('Screenshots are not available in the mock driver.');
    return { mime: 'image/svg+xml', data: Buffer.from(this.svg(s)) };
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
    if (s) this.emit.frame(projectId, Buffer.from(this.svg(s)));
  }

  private svg(s: MockSession): string {
    const W = 393;
    const H = 852;
    const taps = s.taps
      .map((t, i) => `<circle cx="${(t.x * W).toFixed(1)}" cy="${(t.y * H).toFixed(1)}" r="${14 + i * 2}" fill="#ff7a1a" fill-opacity="${0.15 + i * 0.12}"/>`)
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, Helvetica, Arial, sans-serif">
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
  }
}
