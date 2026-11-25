// The account's basics in the web client: choosing a new password from the mailed link, the line that
// asks for the address to be confirmed, and the dialog where the account is deleted.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type User } from './api';
import { NAME } from './Logo';
import { Mascot } from './Mascot';
import { apiErrorText, t } from './i18n';

const errorText = (err: unknown) => apiErrorText(err instanceof ApiError ? err.code : 'internal');

/** The page the link in the mail opens: a new password, and then the person is signed in. */
export function ResetPassword({ token, onDone }: { token: string; onDone: (user: User) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = t.account;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone((await api.resetPassword(token, password)).user);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="auth auth-single">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Mascot dancing />
          <span>{NAME}</span>
        </div>
        <h2>{text.resetTitle}</h2>
        <label>
          <span>{text.newPassword}</span>
          <input type="password" autoComplete="new-password" required minLength={8} autoFocus placeholder={t.passwordHint} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy || password.length < 8}>
          {text.resetSave}
        </button>
        <p className="auth-switch">
          <a className="link" href="/">
            {text.backToLogin}
          </a>
        </p>
      </form>
    </main>
  );
}

/**
 * Asks for the address to be confirmed while it is not, with a way to have the mail sent again. Also
 * says how it went when the person comes back from the link in the mail.
 */
export function VerifyNote({ user, mail }: { user: User; mail: boolean }) {
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [came, setCame] = useState<'1' | '0' | null>(null);
  const text = t.account;

  // Back from the link in the mail: say how it went once, and take the sign off the address.
  useEffect(() => {
    const flag = new URLSearchParams(location.search).get('verified');
    if (flag === '1' || flag === '0') {
      setCame(flag);
      history.replaceState(history.state, '', location.pathname);
    }
  }, []);

  async function again() {
    setBusy(true);
    try {
      const { status } = await api.verifyAgain();
      setSaid(status === 'too_soon' ? text.verifyTooSoon : status === 'not_sent' ? text.noMail : text.verifySent);
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (came === '1' && user.emailVerified) return <p className="notice">{text.verified}</p>;
  if (!mail || user.emailVerified !== false) return null;
  return (
    <p className="notice verify-note">
      <span>{came === '0' ? text.verifyFailed : text.verifyBanner.replace('{email}', user.email)}</span>{' '}
      {said ? (
        <span className="muted">{said}</span>
      ) : (
        <button className="link" disabled={busy} onClick={() => void again()}>
          {text.verifyAgain}
        </button>
      )}
    </p>
  );
}

/** The person's account: their address, whether it is confirmed, and deleting the account. */
export function AccountDialog({ user, onClose, onDeleted }: { user: User; onClose: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = t.account;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!confirm(text.deleteConfirm)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAccount(password);
      dialog.current?.close();
      onDeleted();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="account-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="account-title">{text.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>
      <div className="sheet-body">
        <p>
          <strong>{user.email}</strong>{' '}
          {user.emailVerified !== undefined && <span className="muted">· {user.emailVerified ? text.emailConfirmed : text.emailNotConfirmed}</span>}
        </p>
        <form className="account-delete" onSubmit={remove}>
          <h3>{text.deleteTitle}</h3>
          <p className="muted">{text.deleteText}</p>
          <label>
            <span>{text.deletePassword}</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn danger" disabled={busy || !password}>
            {text.deleteButton}
          </button>
        </form>
      </div>
    </dialog>
  );
}
