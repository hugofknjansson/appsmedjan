import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type AppRequest, type ProjectSummary, type User } from './api';
import { AppleAccountDialog } from './AppleAccount';
import { Logo } from './Logo';
import { Mascot, WaitingCaption } from './Mascot';
import { OperatorPlans, PlanDialog } from './Plan';
import { apiErrorText, lang, t } from './i18n';

interface Props {
  user: User;
  navigate: (to: string, options?: { grow?: boolean }) => void;
  onLogout: () => void;
}

/** Decides an app's colour and tilt from its id, the same way as the iPhone app, so it looks the same in both. */
function tileNumber(id: string): number {
  let n = 0;
  for (const byte of new TextEncoder().encode(id)) n = (n * 31 + byte) & 0xffff;
  return n;
}

export function Dashboard({ user, navigate, onLogout }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [requests, setRequests] = useState<AppRequest[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [appleEnabled, setAppleEnabled] = useState(false);
  const [appleOpen, setAppleOpen] = useState(false);
  const [plansOn, setPlansOn] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  // An idea writing itself into the box, letter by letter: the timer, and the whole of the idea.
  const typing = useRef<number | null>(null);
  const typingIdea = useRef<string | null>(null);

  useEffect(() => () => stopTyping(), []);

  function stopTyping() {
    if (typing.current !== null) window.clearInterval(typing.current);
    typing.current = null;
    typingIdea.current = null;
  }

  /** An idea that is still writing itself is written out at once. Returns what the box then holds. */
  function finishTyping(): string {
    const idea = typingIdea.current;
    stopTyping();
    if (idea !== null) setPrompt(idea);
    return idea ?? prompt;
  }

  /** The idea writes itself into the box, quickly, as if typed by someone who knows what they want. */
  function pick(idea: string) {
    stopTyping();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPrompt(idea);
      return;
    }
    typingIdea.current = idea;
    // Done in about half a second, however long the idea is.
    const step = Math.max(1, Math.round(idea.length / 30));
    let shown = 0;
    setPrompt('');
    typing.current = window.setInterval(() => {
      shown = Math.min(idea.length, shown + step);
      setPrompt(idea.slice(0, shown));
      if (shown >= idea.length) stopTyping();
    }, 16);
  }

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
    // Only people who run the service get an answer; for everyone else there is nothing to show.
    api.operatorRequests().then((r) => setRequests(r.requests)).catch(() => undefined);
    api.appleAccount().then((s) => setAppleEnabled(s.enabled)).catch(() => undefined);
    api.plan().then((p) => setPlansOn(p.enforced)).catch(() => undefined);
    fetch('/api/status')
      .then((r) => r.json())
      .then((s: { workers: number; agentReady: boolean }) => {
        if (!s.agentReady) setNotice(t.agentNotReady);
        else if (s.workers === 0) setNotice(t.noWorkers);
      })
      .catch(() => undefined);
  }, []);

  async function build() {
    const text = finishTyping();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { project } = await api.createProject(text, lang === 'sv' ? 'Ny app' : 'New app');
      // The card it was asked for in turns into the show of it being built.
      navigate(`/p/${project.id}`, { grow: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal';
      // The plan does not hold this: the answer is the plans, or the paywall, and not a line of red.
      if (code.startsWith('plan_')) setPlanOpen(true);
      else setError(apiErrorText(code));
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    void build();
  }

  async function remove(p: ProjectSummary) {
    if (!confirm(t.confirmDelete.replace('{name}', p.name))) return;
    await api.deleteProject(p.id).catch(() => undefined);
    setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
  }

  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });

  return (
    <div className="page">
      <header className="topbar">
        <Logo small />
        <div className="topbar-right">
          <span className="muted hide-narrow">{user.email}</span>
          {appleEnabled && (
            <button className="btn ghost" onClick={() => setAppleOpen(true)}>
              {t.appleAccount}
            </button>
          )}
          {plansOn && (
            <button className="btn ghost" onClick={() => setPlanOpen(true)}>
              {t.plan.title}
            </button>
          )}
          <button className="btn ghost" onClick={onLogout}>
            {t.logout}
          </button>
        </div>
      </header>

      {appleOpen && <AppleAccountDialog onClose={() => setAppleOpen(false)} />}
      {/* Let past the paywall with a code: on with the app the person was about to build. */}
      {planOpen && <PlanDialog onClose={() => setPlanOpen(false)} onUnlock={() => void build()} />}

      <main className="dash">
        <section className="hero">
          <div className="hero-head">
            <div>
              <h1>{t.heroTitle}</h1>
              <p>{t.heroSub}</p>
            </div>
            {/* It dances once there is an idea. */}
            <Mascot dancing={busy || prompt.trim() !== ''} tile="#fff" eyes="#c74005" />
          </div>
          {notice && <p className="notice">{notice}</p>}
          <form className="start-steps" onSubmit={create}>
            <StepLabel number={1} text={t.startSteps.describe} now={!prompt.trim()} />
            <div className="composer big start-field">
              <textarea
                value={prompt}
                rows={3}
                maxLength={8000}
                placeholder={writing ? t.promptPlaceholder : ''}
                aria-label={t.heroTitle}
                onFocus={() => {
                  setWriting(true);
                  void finishTyping();
                }}
                onBlur={() => setWriting(false)}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(e);
                }}
              />
              {/* Until something is written, ideas take turns where the words go, so the box says what it is for. */}
              {!prompt && !writing && (
                <div className="start-examples" aria-hidden="true">
                  <WaitingCaption lines={t.startSteps.examples} every={2800} />
                </div>
              )}
            </div>
            <StepLabel number={2} text={t.startSteps.press} now={prompt.trim() !== ''} />
            {/* Once there is an idea, a light goes over the button now and then: this is the next thing to press. */}
            <button className="btn primary start-build" data-gleam={(prompt.trim() !== '' && !busy) || undefined} disabled={busy || !prompt.trim()}>
              <span aria-hidden="true">✦</span> {t.build}
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="chips">
            {t.suggestions.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => pick(s)}>
                {s}
              </button>
            ))}
          </div>
        </section>

        {requests.length > 0 && (
          <section>
            <h2>{t.operatorRequests}</h2>
            <p className="muted">{t.operatorRequestsText}</p>
            <ul className="requests">
              {requests.map((r) => (
                <li key={r.projectId}>
                  <strong>{r.name}</strong> <span className="muted">({r.email})</span>
                  <br />
                  <code>{r.bundleId}</code>
                </li>
              ))}
            </ul>
            <a className="link" href="https://appstoreconnect.apple.com/apps" target="_blank" rel="noreferrer">
              {t.publishWaitingLink}
            </a>
          </section>
        )}

        <section>
          <h2>{t.yourApps}</h2>
          {projects !== null && projects.length === 0 && (
            <div className="empty">
              <Mascot />
              <strong>{t.noApps}</strong>
              <p className="muted">{t.noAppsSub}</p>
            </div>
          )}
          <ul className="apps">
            {projects?.map((p) => (
              <li key={p.id}>
                <button className="app-card" onClick={() => navigate(`/p/${p.id}`)}>
                  {p.icon ? (
                    // The app's own icon, leaning like the tile it takes the place of. The time makes a changed icon load again.
                    <img className="app-icon" alt="" src={`/api/projects/${p.id}/store/icon?size=138&v=${p.icon}`} data-tilt={tileNumber(p.id) % 2 === 0 ? 'left' : 'right'} />
                  ) : (
                    <span className="app-icon" aria-hidden="true" data-color={tileNumber(p.id) % 6} data-tilt={tileNumber(p.id) % 2 === 0 ? 'left' : 'right'}>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="app-meta">
                    <strong>{p.name}</strong>
                    <span className="muted">
                      {t.updated} {date.format(p.updatedAt)}
                    </span>
                  </span>
                </button>
                <button className="btn ghost danger" onClick={() => void remove(p)}>
                  {t.delete}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <OperatorPlans />
      </main>
    </div>
  );
}

/** Which step of the start card this is, and whether it is the one to do now. */
function StepLabel({ number, text, now }: { number: number; text: string; now: boolean }) {
  return (
    <p className="start-step" data-now={now || undefined}>
      <span aria-hidden="true">{number}</span>
      {text}
    </p>
  );
}
