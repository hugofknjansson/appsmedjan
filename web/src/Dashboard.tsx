import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type AppRequest, type ProjectSummary, type User } from './api';
import { AppleAccountDialog } from './AppleAccount';
import { Logo } from './Logo';
import { Mascot } from './Mascot';
import { apiErrorText, lang, t } from './i18n';

interface Props {
  user: User;
  navigate: (to: string) => void;
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

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
    // Only people who run the service get an answer; for everyone else there is nothing to show.
    api.operatorRequests().then((r) => setRequests(r.requests)).catch(() => undefined);
    api.appleAccount().then((s) => setAppleEnabled(s.enabled)).catch(() => undefined);
    fetch('/api/status')
      .then((r) => r.json())
      .then((s: { workers: number; agentReady: boolean }) => {
        if (!s.agentReady) setNotice(t.agentNotReady);
        else if (s.workers === 0) setNotice(t.noWorkers);
      })
      .catch(() => undefined);
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const { project } = await api.createProject(prompt, lang === 'sv' ? 'Ny app' : 'New app');
      navigate(`/p/${project.id}`);
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
      setBusy(false);
    }
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
          <button className="btn ghost" onClick={onLogout}>
            {t.logout}
          </button>
        </div>
      </header>

      {appleOpen && <AppleAccountDialog onClose={() => setAppleOpen(false)} />}

      <main className="dash">
        <section className="hero">
          <div className="hero-head">
            <div>
              <h1>{t.heroTitle}</h1>
              <p>{t.heroSub}</p>
            </div>
            <Mascot dancing={busy} tile="#fff" eyes="#c74005" />
          </div>
          {notice && <p className="notice">{notice}</p>}
          <form className="composer big" onSubmit={create}>
            <textarea
              value={prompt}
              rows={3}
              maxLength={8000}
              placeholder={t.promptPlaceholder}
              aria-label={t.heroTitle}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create(e);
              }}
            />
            <div className="composer-row">
              <button className="btn primary" disabled={busy || !prompt.trim()}>
                {t.build}
              </button>
            </div>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="chips">
            {t.suggestions.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setPrompt(s)}>
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
      </main>
    </div>
  );
}
