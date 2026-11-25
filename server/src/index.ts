import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { isPhoneModel, isValidProjectId, type ClientToServer, type InputEvent, type ServerToClient } from '../../shared/protocol';
import { hasCredentials } from './agent';
import { config } from './config';
import { keepAlive } from '../../shared/keepalive';
import * as db from './db';
import { addViewer, askViewers, ASK_EVERY_MS, delaySummary, live, sendLatestPicture } from './live';
import { buildProject, syncViewers } from './preview';
import { publishState } from './publish';
import * as pay from './pay';
import { api, directPages, publicPages, userFromRequest } from './routes';
import { attachApp } from './tophone';
import * as workers from './workers';

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
// The payment provider's events are checked against their signature, which is made over the body
// exactly as it was sent, so this one route takes the body unparsed.
app.post('/api/pay/webhook', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
  if (!pay.enabled()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  void pay.webhook(raw, String(req.headers['stripe-signature'] ?? '')).then((result) => {
    res.status(result === 'ok' ? 200 : result === 'bad_signature' ? 400 : 500).json({ received: result === 'ok' });
  });
});
app.use(express.json({ limit: '256kb' }));
app.use('/api', api);
app.use('/a', publicPages);
app.use('/d', directPages);

// In production the server also serves the built web client.
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

const server = http.createServer(app);
const clientWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const workerWss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

function sameToken(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Browsers always send Origin on WebSocket handshakes; only our own pages may connect. */
function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // Not a browser.
  if (config.allowedOrigins.includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers.host) return true;
  // Some reverse proxies replace Host with the upstream address and pass the public one here.
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]!.trim();
  return config.trustProxy && forwarded !== '' && host === forwarded;
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const reject = (status: string) => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (url.pathname === '/worker') {
    const given = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!given || !sameToken(given, config.workerToken)) return reject('401 Unauthorized');
    workerWss.handleUpgrade(req, socket, head, (ws) => workers.attachWorker(ws));
    return;
  }

  // The App Dance app on a phone, while it is open and signed in: told when an app is sent to the phone.
  if (url.pathname === '/ws/me') {
    if (!originAllowed(req)) return reject('403 Forbidden');
    const user = userFromRequest(req);
    if (!user) return reject('401 Unauthorized');
    clientWss.handleUpgrade(req, socket, head, (ws) => {
      keepAlive(ws);
      attachApp(user.id, ws);
    });
    return;
  }

  if (url.pathname === '/ws') {
    if (!originAllowed(req)) return reject('403 Forbidden');
    const user = userFromRequest(req);
    const projectId = url.searchParams.get('project');
    const project = user && isValidProjectId(projectId) ? db.getProject(projectId) : null;
    if (!user || !project || project.userId !== user.id) return reject('401 Unauthorized');
    // A client that can show video says so; the others get still pictures, as they always have.
    const video = url.searchParams.get('video') === 'h264';
    // A phone says which model it is, so that the simulator can be the same one.
    const device = url.searchParams.get('device');
    clientWss.handleUpgrade(req, socket, head, (ws) => attachClient(ws, project, video, isPhoneModel(device) ? device : null));
    return;
  }

  reject('404 Not Found');
});

const unit = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;

/** Input from the browser is untrusted: rebuild each event from validated fields. */
function cleanInput(e: unknown): InputEvent | null {
  const ev = e as Record<string, unknown> | null;
  if (!ev || typeof ev !== 'object') return null;
  switch (ev.kind) {
    case 'touch':
      return (ev.phase === 'down' || ev.phase === 'move' || ev.phase === 'up') && unit(ev.x) && unit(ev.y)
        ? { kind: 'touch', phase: ev.phase, x: ev.x, y: ev.y }
        : null;
    case 'tap':
      return unit(ev.x) && unit(ev.y) ? { kind: 'tap', x: ev.x, y: ev.y } : null;
    case 'swipe': {
      if (!unit(ev.x1) || !unit(ev.y1) || !unit(ev.x2) || !unit(ev.y2)) return null;
      const d = typeof ev.durationMs === 'number' ? Math.min(Math.max(ev.durationMs, 50), 3000) : 300;
      return { kind: 'swipe', x1: ev.x1, y1: ev.y1, x2: ev.x2, y2: ev.y2, durationMs: d };
    }
    case 'text':
      return typeof ev.text === 'string' && ev.text.length > 0 && ev.text.length <= 500
        ? { kind: 'text', text: ev.text }
        : null;
    case 'key':
      return ev.key === 'backspace' || ev.key === 'enter' ? { kind: 'key', key: ev.key } : null;
    case 'button':
      return ev.button === 'home' ? { kind: 'button', button: 'home' } : null;
    default:
      return null;
  }
}

function attachClient(ws: WebSocket, project: db.Project, video: boolean, device: string | null): void {
  keepAlive(ws);
  const l = live(project.id);
  addViewer(project.id, ws, video, device);
  if (l.preview.status === 'unavailable' && workers.workerCount() > 0) l.preview = { ...l.preview, status: 'idle' };
  if (l.preview.status === 'idle' && workers.workerCount() === 0) l.preview = { ...l.preview, status: 'unavailable' };

  const state: ServerToClient = {
    type: 'state',
    project: { id: project.id, name: db.getProject(project.id)?.name ?? project.name },
    messages: db.listMessages(project.id),
    running: l.running,
    parts: l.parts,
    preview: l.preview,
    publish: publishState(project),
  };
  ws.send(JSON.stringify(state));
  sendLatestPicture(project.id, ws);
  syncViewers(project.id);

  // A simple budget so a misbehaving page can't flood the simulator with input. A finger on its
  // way has a budget of its own: it is sent many times a second, and must never use up what lets
  // the finger lift again.
  let budget = 40;
  let moves = 120;
  const refill = setInterval(() => {
    budget = 40;
    moves = 120;
  }, 1000);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientToServer;
    try {
      msg = JSON.parse(String(data)) as ClientToServer;
    } catch {
      return;
    }
    if (msg.type === 'input') {
      const event = cleanInput(msg.event);
      if (!event) return;
      const allowed = event.kind === 'touch' && event.phase === 'move' ? moves-- > 0 : budget-- > 0;
      if (allowed) workers.sendInput(project.id, event);
    } else if (msg.type === 'preview.start') {
      // During a run the agent builds by itself.
      if (!l.running && l.preview.status !== 'building') void buildProject(project.id);
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    const delay = delaySummary(ws);
    if (delay) console.log(`[live] a viewer of ${project.id} left: ${delay}`);
    l.clients.delete(ws);
    syncViewers(project.id);
  });
  ws.on('error', () => ws.close());
}

// How far behind each viewer of a simulator is; someone who keeps falling behind is given a lighter picture.
setInterval(() => {
  for (const projectId of askViewers(performance.now())) syncViewers(projectId);
}, ASK_EVERY_MS);

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  if (!hasCredentials()) {
    console.warn('[server] ANTHROPIC_API_KEY is not set: the agent cannot build apps until it is.');
  }
});
