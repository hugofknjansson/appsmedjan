// Build worker: connects out to the server, so the Mac needs no open ports.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { encodeFrame, type ServerToWorker, type WorkerToServer } from '../../shared/protocol';
import type { Driver, Emit } from './driver';
import { MockDriver } from './mock';
import { XcodeDriver } from './xcode';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../.env'));
} catch {
  // No .env file: configuration comes from the real environment.
}

const SERVER_URL = (process.env.SERVER_URL ?? 'ws://localhost:8787').replace(/\/$/, '');
const TOKEN = process.env.WORKER_TOKEN ?? 'dev-token';
const NAME = process.env.WORKER_NAME ?? os.hostname();
const MAX_SIMULATORS = Math.max(1, Number(process.env.MAX_SIMULATORS ?? 2));
const MOCK = process.argv.includes('--mock') || process.env.WORKER_MOCK === '1';

let socket: WebSocket | null = null;

function send(msg: WorkerToServer): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

const emit: Emit = {
  frame(projectId, image) {
    // Skip frames while the connection is backed up; the next one replaces them anyway.
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 4_000_000) {
      socket.send(encodeFrame(projectId, image), { binary: true });
    }
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
    case 'screenshot':
      try {
        const shot = await driver.screenshot(msg.projectId);
        send({ type: 'screenshot.result', jobId: msg.jobId, ok: true, mime: shot.mime, data: shot.data.toString('base64') });
      } catch (err) {
        send({ type: 'screenshot.result', jobId: msg.jobId, ok: false, error: (err as Error).message });
      }
      break;
    case 'input':
      driver.input(msg.projectId, msg.event);
      break;
    case 'viewers':
      driver.setViewers(msg.projectId, msg.count);
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
  });
  socket = ws;

  ws.on('open', () => {
    retryMs = 1000;
    if (orphanTimer) clearTimeout(orphanTimer);
    orphanTimer = null;
    console.log(`[worker] connected to ${SERVER_URL}`);
    // After a reconnect the server no longer knows which simulators we hold; start clean.
    if (wasConnected) void driver.shutdown();
    wasConnected = true;
    send({
      type: 'hello',
      name: NAME,
      mock: MOCK,
      canInput: capabilities.canInput,
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
