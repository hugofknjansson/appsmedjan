// Installing an app straight onto the person's own phone, without TestFlight.
//
// Apple lets a developer account install apps on phones it has registered (ad hoc distribution): no
// review, and no app in App Store Connect. Two things are needed, and this file has both:
//
//  1. The phone's identifier. A phone hands it over when its owner installs a small profile (Apple's
//     "Profile Service"): the phone then posts its identifier to the address in the profile.
//  2. An app signed for that phone. A signing worker registers the phone in the developer account,
//     builds the app and hands the app file back; the phone installs it from a link to a manifest.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildNumberFor, readPhoneAnswer, type AppleAccount, type DirectError, type DirectFetch, type DirectInstall, type Phone } from '../../shared/protocol';
import { credentialsFor } from './apple';
import { config } from './config';
import * as db from './db';
import { live } from './live';
import { escapeHtml } from './pages';
import { route } from './routing';
import * as workers from './workers';

const DIR = path.join(config.dataDir, 'direct');
fs.mkdirSync(DIR, { recursive: true });

/** Builds in progress. Finished ones are read from the database. */
const working = new Map<string, Pick<DirectInstall, 'stage' | 'build' | 'at'>>();

/** How far a phone has come with fetching each project's ready build. Forgotten when a new build starts. */
const fetches = new Map<string, { token: string; stage: DirectFetch }>();
const FETCH_ORDER: DirectFetch[] = ['asked', 'fetching', 'fetched'];

let changed: (projectId: string) => void = () => undefined;
let phonesChanged: (userId: string) => void = () => undefined;

/** Lets the open project follow a build along, and a person's projects notice a new phone. */
export function onChange(build: (projectId: string) => void, phones: (userId: string) => void): void {
  changed = build;
  phonesChanged = phones;
}

export function ipaPath(projectId: string): string {
  return path.resolve(DIR, `${projectId}.ipa`);
}

/** Call when a project is deleted: its app file goes with it. */
export function forget(projectId: string): void {
  fs.rmSync(ipaPath(projectId), { force: true });
  fetches.delete(projectId);
}

export function phonesOf(userId: string): Phone[] {
  return db.listPhones(userId).map((p) => ({ id: p.id, model: p.model, addedAt: p.createdAt }));
}

export function state(project: db.Project): DirectInstall {
  const owner = db.getUser(project.userId);
  const routing = route(owner);
  // In the operator's account every phone takes a place for a year, so the operator decides.
  const offered = routing.account === 'own' || (routing.account === 'operator' && config.directInstall);
  const base = { available: offered && routing.available, phones: owner ? db.listPhones(owner.id).length : 0, maxPhones: config.maxPhones };
  const current = working.get(project.id);
  if (current) return { ...base, status: 'working', ...current };
  const saved = db.getDirectBuild(project.id);
  if (!saved) return { ...base, status: 'idle' };
  const fetched = fetches.get(project.id);
  return {
    ...base,
    status: saved.status,
    error: saved.error ?? undefined,
    path: saved.status === 'ready' && saved.token ? `/d/i/${saved.token}` : undefined,
    build: saved.build,
    install: saved.status === 'ready' && fetched?.token === saved.token ? fetched.stage : undefined,
    at: saved.updatedAt,
  };
}

/**
 * A phone has asked for the list of what to install, or for the app file: the open project shows how
 * far it has come. A phone asks more than once and in pieces, so this only ever moves forward.
 */
export function noteFetch(build: db.DirectBuild, stage: DirectFetch): void {
  if (!build.token) return;
  const current = fetches.get(build.projectId);
  const before = current?.token === build.token ? FETCH_ORDER.indexOf(current.stage) : -1;
  if (FETCH_ORDER.indexOf(stage) <= before) return;
  fetches.set(build.projectId, { token: build.token, stage });
  changed(build.projectId);
}

/**
 * Builds for the person's phone without being asked, when the agent has finished changing the app:
 * the phone is where they try it, so the new version should be waiting for them. Only when they
 * have added a phone, the app builds, and something has changed since the last build for the phone.
 */
export function buildAfterRun(projectId: string): void {
  const project = db.getProject(projectId);
  const owner = project ? db.getUser(project.userId) : null;
  if (!project || !owner) return;
  const now = state(project);
  if (!now.available || now.phones === 0 || now.status === 'working') return;
  // Only an app that is known to build: it runs in the simulator, or there is no simulator to say otherwise.
  const preview = live(projectId).preview.status;
  if (preview !== 'running' && preview !== 'unavailable') return;
  const last = db.getDirectBuild(projectId);
  if (last && last.status === 'ready' && db.filesChangedAt(projectId) <= last.updatedAt) return;
  start(project, owner);
}

export type StartResult = 'started' | 'forbidden' | 'unavailable' | 'busy' | 'no_phones';

export function start(project: db.Project, user: db.User): StartResult {
  const routing = route(user);
  if (routing.account === 'none' || (routing.account === 'operator' && !config.directInstall)) return 'forbidden';
  if (!routing.available) return 'unavailable';
  // While the agent is editing, the files may be half-way through a change.
  if (working.has(project.id) || live(project.id).running) return 'busy';
  const phones = db.listPhones(user.id);
  if (phones.length === 0) return 'no_phones';

  let account: AppleAccount | undefined;
  if (routing.account === 'own') {
    const credentials = credentialsFor(user.id);
    if (!credentials) return 'unavailable';
    account = credentials;
  }

  const build = buildNumberFor(new Date());
  fetches.delete(project.id);
  working.set(project.id, { stage: 'queued', build, at: Date.now() });
  changed(project.id);
  void run(project, build, phones, account);
  return 'started';
}

async function run(project: db.Project, build: string, phones: db.PhoneRow[], account: AppleAccount | undefined): Promise<void> {
  let outcome: { ok: boolean; error?: DirectError; detail?: string; ipa?: Buffer };
  try {
    const icon = db.getIcon(project.id);
    const named = phones.map((p) => ({ udid: p.udid, name: `App Dance ${p.model} ${p.id}`.slice(0, 50) }));
    outcome = await workers.direct(project, db.getFiles(project.id), build, named, account, icon ? Buffer.from(icon).toString('base64') : undefined, (stage) => {
      const current = working.get(project.id);
      if (!current) return;
      working.set(project.id, { ...current, stage });
      changed(project.id);
    });
    if (outcome.ok && !outcome.ipa) outcome = { ok: false, error: 'internal', detail: 'The worker sent no app file.' };
  } catch (err) {
    outcome = { ok: false, error: err instanceof workers.WorkerUnavailable ? 'unavailable' : 'internal', detail: (err as Error).message };
  }
  working.delete(project.id);

  if (outcome.ok) {
    console.log(`[direct] ${project.id} (${project.bundleId}): build ${build} signed for ${phones.length} phone(s), ${outcome.ipa!.length} bytes`);
  } else {
    // The tools' own output stays in the operator's log; the person only sees a short explanation.
    console.warn(`[direct] ${project.id} (${project.bundleId}): failed, ${outcome.error}\n${outcome.detail ?? ''}`);
  }
  // The project may have been deleted while the build was running.
  const now = db.getProject(project.id);
  if (!now) return;
  if (outcome.ok) {
    fs.writeFileSync(ipaPath(project.id), outcome.ipa!);
    db.setDirectBuild(project.id, { status: 'ready', error: null, build, token: crypto.randomBytes(24).toString('base64url'), appName: now.name });
  } else {
    forget(project.id);
    db.setDirectBuild(project.id, { status: 'failed', error: outcome.error ?? 'internal', build, token: null, appName: now.name });
  }
  changed(project.id);
}

// --- Adding a phone ----------------------------------------------------------------

/**
 * A ticket stands for "this person is adding a phone". It is in the link the phone opens, so the
 * phone needs no sign-in of its own; it is good for half an hour and says nothing about the person.
 */
interface Ticket {
  userId: string;
  expiresAt: number;
  outcome?: 'added' | 'full' | 'unreadable';
}

const tickets = new Map<string, Ticket>();
const TICKET_MS = 30 * 60_000;
const ticketKey = (ticket: string) => crypto.createHash('sha256').update(ticket).digest('hex');

setInterval(() => {
  const now = Date.now();
  for (const [key, ticket] of tickets) if (ticket.expiresAt < now) tickets.delete(key);
}, 60_000).unref();

export function newTicket(userId: string): { path: string; expiresInMs: number } {
  const ticket = crypto.randomBytes(24).toString('base64url');
  tickets.set(ticketKey(ticket), { userId, expiresAt: Date.now() + TICKET_MS });
  return { path: `/d/add/${ticket}`, expiresInMs: TICKET_MS };
}

function ticketFor(ticket: string): Ticket | null {
  const found = tickets.get(ticketKey(ticket));
  return found && found.expiresAt > Date.now() && db.getUser(found.userId) ? found : null;
}

type Lang = 'sv' | 'en';

const xml = (text: string) => text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The profile a phone installs to hand over its identifier. Null for a ticket that is not (or no longer) good. */
export function enrollProfile(ticket: string, base: string, lang: Lang): string | null {
  if (!ticketFor(ticket)) return null;
  const text = TEXTS[lang];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key><string>${xml(`${base}/d/enrolled/${ticket}`)}</string>
    <key>DeviceAttributes</key>
    <array><string>UDID</string><string>PRODUCT</string></array>
  </dict>
  <key>PayloadOrganization</key><string>App Dance</string>
  <key>PayloadDisplayName</key><string>${xml(text.profileName)}</string>
  <key>PayloadDescription</key><string>${xml(text.profileAbout)}</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadUUID</key><string>${crypto.randomUUID().toUpperCase()}</string>
  <key>PayloadIdentifier</key><string>app.appsmedjan.addphone</string>
  <key>PayloadType</key><string>Profile Service</string>
</dict>
</plist>
`;
}

/** The phone has answered: it becomes one of the person's phones, if they have room for it. */
export function enroll(ticket: string, body: Buffer): void {
  const found = ticketFor(ticket);
  if (!found) return;
  const phone = readPhoneAnswer(body);
  if (!phone) {
    found.outcome = 'unreadable';
    return;
  }
  const phones = db.listPhones(found.userId);
  if (!phones.some((p) => p.udid === phone.udid) && phones.length >= config.maxPhones) {
    found.outcome = 'full';
    return;
  }
  db.addPhone(found.userId, phone.udid, phone.model);
  found.outcome = 'added';
  console.log(`[direct] a ${phone.model} was added by user ${found.userId}`);
  phonesChanged(found.userId);
}

// --- What the phone installs from ---------------------------------------------------

/** The list of what to install, which iOS reads when the install link is opened. */
export function manifest(build: db.DirectBuild, bundleId: string, base: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${xml(`${base}/d/app/${build.token}/app.ipa`)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${xml(bundleId)}</string>
        <key>bundle-version</key><string>1.0</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xml(build.appName)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

// --- The pages the phone shows ------------------------------------------------------

const TEXTS = {
  sv: {
    profileName: 'App Dance: lägg till telefonen',
    profileAbout: 'Lämnar telefonens id till App Dance, så att dina appar kan installeras på den. Ingenting blir kvar på telefonen.',
    addTitle: 'Lägg till din telefon',
    addIntro: 'Gör det här en gång, på den iPhone du vill ha dina appar på. Sedan installeras varje app med ett tryck.',
    addSteps: [
      'Tryck på knappen här under och välj <b>Tillåt</b>.',
      'Öppna <b>Inställningar</b>. Överst står <b>Profil hämtad</b>. Tryck där och sedan på <b>Installera</b>.',
      'Du kommer tillbaka hit av dig själv när det är klart.',
    ],
    addButton: 'Hämta profilen',
    addNote: 'Profilen lämnar bara telefonens id till App Dance och blir inte kvar på telefonen. iOS skriver att den inte är signerad; det stämmer.',
    addSafari: 'Öppna sidan i Safari på din iPhone. Andra webbläsare kan inte hämta profilen.',
    expiredTitle: 'Länken gäller inte längre',
    expired: 'Gå tillbaka till App Dance och tryck på "Lägg till den här telefonen" igen.',
    doneTitle: 'Telefonen är tillagd',
    done: 'Gå tillbaka till App Dance och tryck på <b>Installera</b>. Appen byggs för just den här telefonen och hamnar på hemskärmen.',
    fullTitle: 'Du har redan lagt till så många telefoner som går',
    full: 'Varje telefon tar en plats i utvecklarkontot i ett år. Hör av dig till den som driver tjänsten om du behöver byta.',
    unreadableTitle: 'Det gick inte att läsa telefonens svar',
    unreadable: 'Gå tillbaka till App Dance och försök igen.',
    waitingTitle: 'Nästan klart',
    waiting: 'Öppna <b>Inställningar</b>, tryck på <b>Profil hämtad</b> och sedan <b>Installera</b>.',
    installTitle: 'Installera {name}',
    installButton: 'Installera',
    installIntro: 'iOS frågar om du vill installera. Appen dyker sedan upp på hemskärmen.',
    devTitle: 'Första gången: slå på Utvecklarläge',
    devIntro: 'Apple kräver det för appar som inte kommer från App Store. Säger appen att Utvecklarläge krävs gör du så här, en gång:',
    devSteps: ['Öppna <b>Inställningar</b> och gå till <b>Integritet och säkerhet</b>.', 'Tryck på <b>Utvecklarläge</b> längst ned och slå på det.', 'Starta om telefonen när den ber om det, och bekräfta efteråt.'],
    installNote: 'Appen går bara att installera på telefoner du har lagt till, och fungerar i upp till ett år innan den behöver installeras om.',
    goneTitle: 'Den här länken gäller inte längre',
    gone: 'En nyare version har byggts, eller appen har tagits bort. Öppna appen i App Dance för att få en ny länk.',
  },
  en: {
    profileName: 'App Dance: add this phone',
    profileAbout: "Hands the phone's identifier to App Dance, so that your apps can be installed on it. Nothing stays on the phone.",
    addTitle: 'Add your phone',
    addIntro: 'Do this once, on the iPhone you want your apps on. After that every app installs with one tap.',
    addSteps: [
      'Tap the button below and choose <b>Allow</b>.',
      'Open <b>Settings</b>. At the top it says <b>Profile Downloaded</b>. Tap it, then <b>Install</b>.',
      'You come back here by yourself when it is done.',
    ],
    addButton: 'Get the profile',
    addNote: "The profile only hands the phone's identifier to App Dance and does not stay on the phone. iOS says it is not signed; that is correct.",
    addSafari: 'Open this page in Safari on your iPhone. Other browsers cannot fetch the profile.',
    expiredTitle: 'This link no longer works',
    expired: 'Go back to App Dance and press "Add this phone" again.',
    doneTitle: 'The phone has been added',
    done: 'Go back to App Dance and press <b>Install</b>. The app is built for this very phone and lands on the home screen.',
    fullTitle: 'You have already added as many phones as you can',
    full: 'Each phone takes a place in the developer account for a year. Get in touch with whoever runs the service if you need to switch.',
    unreadableTitle: "The phone's answer could not be read",
    unreadable: 'Go back to App Dance and try again.',
    waitingTitle: 'Almost there',
    waiting: 'Open <b>Settings</b>, tap <b>Profile Downloaded</b> and then <b>Install</b>.',
    installTitle: 'Install {name}',
    installButton: 'Install',
    installIntro: 'iOS asks whether you want to install. The app then shows up on the home screen.',
    devTitle: 'The first time: turn on Developer Mode',
    devIntro: 'Apple requires it for apps that do not come from the App Store. If the app says Developer Mode is required, do this once:',
    devSteps: ['Open <b>Settings</b> and go to <b>Privacy &amp; Security</b>.', 'Tap <b>Developer Mode</b> at the bottom and turn it on.', 'Restart the phone when it asks, and confirm afterwards.'],
    installNote: 'The app can only be installed on phones you have added, and works for up to a year before it needs installing again.',
    goneTitle: 'This link no longer works',
    gone: 'A newer version has been built, or the app has been removed. Open the app in App Dance to get a new link.',
  },
} satisfies Record<Lang, Record<string, string | string[]>>;

// The mascot, as in web/src/Mascot.tsx.
const MASCOT = `<svg viewBox="0 0 32 32" width="96" height="96" aria-hidden="true"><path d="M21.5 12.5L24.5 9.8L27.4 7.2M11 13.5L5.8 15.6L6.6 11.2M13.4 18L12.6 22.6L13.4 27.2L10.6 27.2M18 18.5L20.8 23.2L25.8 21.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><g transform="translate(16 12.5) rotate(10)"><rect x="-6.5" y="-6.5" width="13" height="13" rx="3.6" fill="#fff"/><rect x="-3.05" y="-2.4" width="1.5" height="3" rx="0.75" fill="#c74005"/><rect x="1.55" y="-2.4" width="1.5" height="3" rx="0.75" fill="#c74005"/></g></svg>`;

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f3ee;--card:#fffdfa;--ink:#1d1a17;--muted:#6f675f}
@media(prefers-color-scheme:dark){:root{--bg:#151312;--card:#1f1c1a;--ink:#f1ebe4;--muted:#a69c91}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 ui-rounded,'SF Pro Rounded',system-ui,-apple-system,sans-serif;-webkit-text-size-adjust:100%}
header{padding:28px 24px 30px;border-radius:0 0 36px 36px;background:linear-gradient(135deg,#f57a24,#c74005);color:#fff;text-align:center}
h1{margin:6px 0 0;font-size:1.8rem;font-weight:800;line-height:1.15;letter-spacing:-.02em;text-wrap:balance}
main{max-width:480px;margin:0 auto;padding:22px 20px 40px;display:grid;gap:16px}
p{margin:0}
ol{margin:0;padding:0;list-style:none;counter-reset:step;display:grid;gap:14px}
li{counter-increment:step;position:relative;padding-left:42px}
li::before{content:counter(step);position:absolute;left:0;top:0;width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#fbe6d8;color:#c74005;font-weight:800;font-size:.9rem}
.card{padding:18px;border-radius:22px;background:var(--card);display:grid;gap:12px}
.btn{display:block;padding:15px;border-radius:999px;background:linear-gradient(135deg,#f57a24,#c74005);color:#fff;font-weight:700;font-size:1.1rem;text-align:center;text-decoration:none}
.muted{color:var(--muted);font-size:.9rem}
h2{margin:0;font-size:1.05rem}
`;

function page(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>${MASCOT}<h1>${escapeHtml(title)}</h1></header>
<main>
${body}
</main>
</body>
</html>
`;
}

const steps = (items: string[]) => `<ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;

/** The page a phone opens to be added. */
export function addPage(ticket: string, lang: Lang): string {
  const t = TEXTS[lang];
  if (!ticketFor(ticket)) return page(lang, t.expiredTitle, `<p>${t.expired}</p>`);
  return page(
    lang,
    t.addTitle,
    `<p>${t.addIntro}</p>
<div class="card">${steps(t.addSteps)}<a class="btn" href="/d/enroll/${ticket}.mobileconfig">${t.addButton}</a></div>
<p class="muted">${t.addNote}</p>
<p class="muted">${t.addSafari}</p>`,
  );
}

/** Where the phone lands after the profile has been installed. */
export function donePage(ticket: string, lang: Lang): string {
  const t = TEXTS[lang];
  const found = ticketFor(ticket);
  if (!found) return page(lang, t.expiredTitle, `<p>${t.expired}</p>`);
  if (found.outcome === 'added') return page(lang, t.doneTitle, `<p>${t.done}</p><div class="card"><h2>${t.devTitle}</h2><p class="muted">${t.devIntro}</p>${steps(t.devSteps)}</div>`);
  if (found.outcome === 'full') return page(lang, t.fullTitle, `<p>${t.full}</p>`);
  if (found.outcome === 'unreadable') return page(lang, t.unreadableTitle, `<p>${t.unreadable}</p>`);
  return page(lang, t.waitingTitle, `<p>${t.waiting}</p>`);
}

/** The page with the install button for a finished build. */
export function installPage(token: string, base: string, lang: Lang): { html: string; found: boolean } {
  const t = TEXTS[lang];
  const build = db.directBuildByToken(token);
  if (!build || !fs.existsSync(ipaPath(build.projectId))) return { html: page(lang, t.goneTitle, `<p>${t.gone}</p>`), found: false };
  const link = `itms-services://?action=download-manifest&url=${encodeURIComponent(`${base}/d/app/${token}/manifest.plist`)}`;
  const html = page(
    lang,
    t.installTitle.replace('{name}', build.appName),
    `<a class="btn" href="${escapeHtml(link)}">${t.installButton}</a>
<p>${t.installIntro}</p>
<div class="card"><h2>${t.devTitle}</h2><p class="muted">${t.devIntro}</p>${steps(t.devSteps)}</div>
<p class="muted">${t.installNote}</p>`,
  );
  return { html, found: true };
}
