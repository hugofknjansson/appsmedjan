// Build worker: connects out to the server, so the Mac needs no open ports.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { keepAlive } from '../../shared/keepalive';
import { PROTOCOL_VERSION, encodeFrame, type ServerToWorker, type WorkerToServer } from '../../shared/protocol';
import type { DirectResult, Driver, Emit, InviteResult, PublishResult, ShareResult, StoreResult } from './driver';
import { MockDriver } from './mock';
import { XcodeDriver } from './xcode';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../.env'));
} catch {
  // No .env file: configuration comes from the real environment.
}

// Under launchd the output goes to a log file, where lines without a time are hard to make sense of.
if (process.env.LOG_TIMESTAMPS === '1') {
  for (const level of ['log', 'warn', 'error'] as const) {
    const write = console[level].bind(console);
    console[level] = (...args: unknown[]) => write(new Date().toISOString(), ...args);
  }
}

const SERVER_URL = (process.env.SERVER_URL ?? 'ws://localhost:8787').replace(/\/$/, '');
// An empty WORKER_TOKEN= line in .env counts as "not set", the same way the server treats it.
const TOKEN = process.env.WORKER_TOKEN || 'dev-token';
const NAME = process.env.WORKER_NAME ?? os.hostname();
const MAX_SIMULATORS = Math.max(1, Number(process.env.MAX_SIMULATORS ?? 2));
const MOCK = process.argv.includes('--mock') || process.env.WORKER_MOCK === '1';
// PREVIEWS=0 makes this a signing-only worker: it uploads to TestFlight but runs no simulators, so no
// app code written by the model ever runs next to the keys.
const PREVIEWS = process.env.PREVIEWS !== '0';

let socket: WebSocket | null = null;

function send(msg: WorkerToServer): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

const emit: Emit = {
  frame(projectId, image) {
    // Skip frames while the connection is backed up. A still picture is replaced by the next one
    // anyway; for video the stream is told, so that it goes on from the next whole picture.
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 4_000_000) {
      socket.send(encodeFrame(projectId, image), { binary: true });
      return true;
    }
    return false;
  },
  streamInfo: (projectId, mime) => send({ type: 'stream.info', projectId, mime }),
  stopped: (projectId) => send({ type: 'sim.stopped', projectId }),
};

if (!MOCK && process.platform !== 'darwin') {
  console.error('The build worker needs macOS with Xcode. For development without a Mac, run it with --mock.');
  process.exit(1);
}

const driver: Driver = MOCK ? new MockDriver(emit) : new XcodeDriver(emit, { maxSimulators: MAX_SIMULATORS });
const capabilities = await driver.init().catch((err: Error) => {
  console.error(`Worker setup failed: ${err.message}`);
  process.exit(1);
});
console.log(`[worker] ready (${capabilities.info})`);

async function handle(msg: ServerToWorker): Promise<void> {
  switch (msg.type) {
    case 'build': {
      const started = Date.now();
      let result: { ok: boolean; errors?: string };
      try {
        result = await driver.build(msg, (stage) => send({ type: 'build.progress', jobId: msg.jobId, stage }));
      } catch (err) {
        result = { ok: false, errors: `The build service hit a problem: ${(err as Error).message}` };
      }
      const durationMs = Date.now() - started;
      console.log(`[worker] build ${msg.projectId}: ${result.ok ? 'ok' : 'failed'} in ${(durationMs / 1000).toFixed(1)}s`);
      send({ type: 'build.result', jobId: msg.jobId, ok: result.ok, errors: result.errors, durationMs });
      break;
    }
    case 'publish': {
      const started = Date.now();
      let result: PublishResult;
      try {
        result = await driver.publish(msg, (stage) => send({ type: 'publish.progress', jobId: msg.jobId, stage }));
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      const durationMs = Date.now() - started;
      console.log(
        `[worker] publish ${msg.projectId} (${msg.buildNumber}): ${result.ok ? 'uploaded' : `failed, ${result.error}`} in ${(durationMs / 1000).toFixed(1)}s`,
      );
      send({
        type: 'publish.result',
        jobId: msg.jobId,
        ok: result.ok,
        error: result.error,
        detail: result.detail,
        tester: result.tester,
        durationMs,
      });
      break;
    }
    case 'direct': {
      const started = Date.now();
      let result: DirectResult;
      try {
        result = await driver.direct(msg, (stage) => send({ type: 'direct.progress', jobId: msg.jobId, stage }));
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      const durationMs = Date.now() - started;
      console.log(
        `[worker] direct install ${msg.projectId}: ${result.ok ? `signed for ${msg.phones.length} phone(s), ${result.ipa?.length ?? 0} bytes` : `failed, ${result.error}`} in ${(durationMs / 1000).toFixed(1)}s`,
      );
      send({ type: 'direct.result', jobId: msg.jobId, ok: result.ok, error: result.error, detail: result.detail, ipa: result.ipa?.toString('base64'), durationMs });
      break;
    }
    case 'store': {
      const started = Date.now();
      let result: StoreResult;
      try {
        result = await driver.store(msg, (stage) => send({ type: 'store.progress', jobId: msg.jobId, stage }));
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      console.log(
        `[worker] App Store page ${msg.projectId}: ${result.ok ? `sent, build ${result.attached}` : `failed, ${result.error}`} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      send({ type: 'store.result', jobId: msg.jobId, ok: result.ok, error: result.error, detail: result.detail, attached: result.attached });
      break;
    }
    case 'share': {
      let result: ShareResult;
      try {
        result = await driver.share(msg);
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      // Checks come often while Apple reviews; only what changes something is worth a line.
      if (!msg.check || !result.ok) {
        console.log(`[worker] test link ${msg.projectId} (${msg.build}): ${result.ok ? result.state : `failed, ${result.error}`}`);
      }
      send({ type: 'share.result', jobId: msg.jobId, ok: result.ok, state: result.state, url: result.url, error: result.error, detail: result.detail });
      break;
    }
    case 'invite': {
      let result: InviteResult;
      try {
        result = await driver.invite(msg);
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      if (!result.ok) console.log(`[worker] tester invitation for ${msg.projectId}: failed, ${result.error}`);
      send({ type: 'invite.result', jobId: msg.jobId, ok: result.ok, state: result.state, error: result.error, detail: result.detail });
      break;
    }
    case 'submit': {
      let result: StoreResult;
      try {
        result = await driver.submit(msg);
      } catch (err) {
        result = { ok: false, error: 'internal', detail: (err as Error).message };
      }
      console.log(`[worker] submit ${msg.projectId} for review: ${result.ok ? 'submitted' : `failed, ${result.error}`}`);
      send({ type: 'submit.result', jobId: msg.jobId, ok: result.ok, error: result.error, detail: result.detail });
      break;
    }
    case 'screenshot':
      try {
        const shot = await driver.screenshot(msg.projectId, { store: msg.store === true });
        send({ type: 'screenshot.result', jobId: msg.jobId, ok: true, mime: shot.mime, data: shot.data.toString('base64') });
      } catch (err) {
        send({ type: 'screenshot.result', jobId: msg.jobId, ok: false, error: (err as Error).message });
      }
      break;
    case 'input':
      driver.input(msg.projectId, msg.event);
      break;
    case 'viewers':
      driver.setViewers(msg.projectId, msg.count, msg.video === true);
      break;
    case 'release':
      await driver.release(msg.projectId);
      break;
  }
}

let retryMs = 1000;
let orphanTimer: NodeJS.Timeout | null = null;
let wasConnected = false;

function connect(): void {
  const ws = new WebSocket(`${SERVER_URL}/worker`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    maxPayload: 32 * 1024 * 1024,
    // A server that accepts the connection but never answers must not hold the worker forever.
    handshakeTimeout: 20_000,
  });
  socket = ws;

  ws.on('open', () => {
    retryMs = 1000;
    if (orphanTimer) clearTimeout(orphanTimer);
    orphanTimer = null;
    console.log(`[worker] connected to ${SERVER_URL}`);
    // Without this a connection that died silently looks open forever and the worker never comes back.
    keepAlive(ws, 25_000, () => console.error('[worker] the server stopped answering; reconnecting'));
    // After a reconnect the server no longer knows which simulators we hold; start clean.
    if (wasConnected) void driver.shutdown();
    wasConnected = true;
    send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      name: NAME,
      mock: MOCK,
      canInput: capabilities.canInput,
      canPublish: capabilities.canPublish,
      hasOwnAccount: capabilities.hasOwnAccount,
      publishesForUsers: capabilities.publishesForUsers,
      canPreview: PREVIEWS,
      maxSimulators: MAX_SIMULATORS,
      info: capabilities.info,
    });
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: ServerToWorker;
    try {
      msg = JSON.parse(String(data)) as ServerToWorker;
    } catch {
      return;
    }
    handle(msg).catch((err) => console.error('[worker] job failed:', err));
  });

  ws.on('unexpected-response', (_req, res) => {
    console.error(`[worker] server refused the connection (HTTP ${res.statusCode}). Check SERVER_URL and WORKER_TOKEN.`);
  });

  ws.on('close', () => {
    if (socket === ws) socket = null;
    // The server forgets which simulators we hold when the connection drops, so free them if it stays down.
    orphanTimer ??= setTimeout(() => void driver.shutdown(), 60_000);
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  });

  ws.on('error', (err) => {
    if (ws.readyState !== WebSocket.OPEN) console.error(`[worker] cannot reach ${SERVER_URL}: ${err.message}`);
  });
}

connect();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('[worker] shutting down simulators');
    void driver.shutdown().finally(() => process.exit(0));
  });
}
