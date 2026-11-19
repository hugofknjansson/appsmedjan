import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type ProjectSummary, type User } from './api';
import { AppleAccountDialog } from './AppleAccount';
import { Logo } from './Logo';
import { apiErrorText, lang, t } from './i18n';

interface Props {
  user: User;
  navigate: (to: string) => void;
  onLogout: () => void;
}

export function Dashboard({ user, navigate, onLogout }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [appleEnabled, setAppleEnabled] = useState(false);
  const [appleOpen, setAppleOpen] = useState(false);

  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
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
          <h1>{t.heroTitle}</h1>
          <p className="muted">{t.heroSub}</p>
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

        <section>
          <h2>{t.yourApps}</h2>
          {projects !== null && projects.length === 0 && <p className="muted">{t.noApps}</p>}
          <ul className="apps">
            {projects?.map((p) => (
              <li key={p.id}>
                <button className="app-card" onClick={() => navigate(`/p/${p.id}`)}>
                  <span className="app-icon" aria-hidden="true">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
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
