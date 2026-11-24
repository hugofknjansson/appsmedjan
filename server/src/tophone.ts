// Sending an app to the person's own phone from the web. The App Dance app on the phone shows iOS's
// question whether to install: at once when it is open, and through a notification when it is not.
// iOS never installs anything without the phone's owner saying yes on the phone itself, so that one
// tap is always left.
import { type WebSocket } from 'ws';
import type { ToPhoneResult } from '../../shared/protocol';
import * as db from './db';
import * as direct from './direct';
import * as push from './push';

/** The App Dance apps that are open and signed in, by person. */
const apps = new Map<string, Set<WebSocket>>();

export function attachApp(userId: string, ws: WebSocket): void {
  const mine = apps.get(userId) ?? new Set<WebSocket>();
  mine.add(ws);
  apps.set(userId, mine);
  ws.on('close', () => {
    mine.delete(ws);
    if (mine.size === 0) apps.delete(userId);
  });
}

/** Projects whose build for the phone is under way, to be sent to the phone when it is ready. */
const waiting = new Set<string>();

direct.onReady((projectId, ok) => {
  if (!waiting.delete(projectId) || !ok) return;
  const project = db.getProject(projectId);
  const path = project ? direct.state(project).path : undefined;
  if (project && path) void deliver(project, path);
});

/**
 * Sends the app to the person's phone: the ready build if it is up to date, otherwise a new build,
 * which goes to the phone when it is done.
 */
export async function sendToPhone(project: db.Project, user: db.User): Promise<ToPhoneResult> {
  const now = direct.state(project);
  if (now.phones === 0) return { status: 'no_phones' };
  if (now.status === 'ready' && now.fresh !== false && now.path) {
    return { status: 'sent', via: await deliver(project, now.path) };
  }
  if (now.status !== 'working') {
    const started = direct.start(project, user);
    if (started !== 'started') return { status: started };
  }
  waiting.add(project.id);
  return { status: 'building' };
}

/** How the app reached the phone: the open app, a notification, or neither. */
async function deliver(project: db.Project, path: string): Promise<'app' | 'push' | 'none'> {
  const open = [...(apps.get(project.userId) ?? [])].filter((ws) => ws.readyState === ws.OPEN);
  if (open.length > 0) {
    const message = JSON.stringify({ type: 'install', projectId: project.id, name: project.name, path });
    for (const ws of open) ws.send(message);
    console.log(`[tophone] ${project.id}: sent to ${open.length} open app(s)`);
    return 'app';
  }
  const reached = await push.notify(project.userId, {
    title: { sv: `${project.name} är klar`, en: `${project.name} is ready` },
    body: { sv: 'Tryck för att installera den på telefonen.', en: 'Tap to install it on your phone.' },
    data: { projectId: project.id, path },
  });
  console.log(`[tophone] ${project.id}: ${reached ? 'notified' : 'no open app and no notification'}`);
  return reached ? 'push' : 'none';
}
