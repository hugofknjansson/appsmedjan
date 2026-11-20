import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type User } from './api';
import { NAME } from './Logo';
import { Mascot } from './Mascot';
import { apiErrorText, t } from './i18n';

export function Auth({ onDone }: { onDone: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.config().then((c) => setInviteRequired(c.inviteRequired)).catch(() => undefined);
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
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-hero">
          <Mascot dancing tile="#fff" eyes="#c74005" />
          <h1>{NAME}</h1>
          <p>{t.tagline}</p>
        </div>
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
