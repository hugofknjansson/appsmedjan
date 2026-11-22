// The way in, and the first thing a visitor sees: what the service does, in a few lines and a
// dancing mascot, beside the form to make an account or sign in.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type User } from './api';
import { NAME } from './Logo';
import { Mascot, WaitingCaption } from './Mascot';
import { apiErrorText, t } from './i18n';

export function Auth({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const text = t.welcome;

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setInviteRequired(c.inviteRequired);
        setPaywall(c.paywall === true);
      })
      .catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = mode === 'signup' ? await api.signup(email, password, invite) : await api.login(email, password);
      onDone(res.user);
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <section className="auth-pitch">
        <div className="auth-brand">
          <Mascot dancing tile="#fff" eyes="#c74005" />
          <span>{NAME}</span>
        </div>
        <h1>{text.headline}</h1>
        <p className="auth-sub">{text.sub}</p>
        {/* What people ask for, one idea at a time, as the words of someone describing their app. */}
        <div className="auth-idea">
          <small>{text.forExample}</small>
          <WaitingCaption lines={text.ideas.map((idea) => `\u201d${idea}\u201d`)} every={3400} />
        </div>
        <ol className="auth-steps">
          {text.steps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="auth-facts">
          {text.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </section>

      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'signup' ? text.start : text.back}</h2>
        {mode === 'signup' && <p className="muted">{paywall ? text.freeThenPlan : text.free}</p>}
        <label>
          <span>{t.email}</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span>{t.password}</span>
          <input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={8}
            placeholder={mode === 'signup' ? t.passwordHint : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === 'signup' && inviteRequired && (
          <label>
            <span>{t.inviteCode}</span>
            <input type="text" required value={invite} onChange={(e) => setInvite(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {mode === 'signup' ? t.signup : t.login}
        </button>
        <p className="auth-switch">
          {mode === 'signup' ? t.haveAccount : t.noAccount}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup');
              setError('');
            }}
          >
            {mode === 'signup' ? t.login : t.signup}
          </button>
        </p>
      </form>
    </main>
  );
}
