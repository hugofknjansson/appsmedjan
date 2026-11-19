// Guide for connecting the person's own Apple developer account, so their apps are uploaded in their name.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type AppleStatus } from './api';
import { apiErrorText, t } from './i18n';

const ENROLL_URL = 'https://developer.apple.com/programs/enroll/';
const KEYS_URL = 'https://appstoreconnect.apple.com/access/integrations/api';
const TEAM_URL = 'https://developer.apple.com/account#MembershipDetailsCard';

export function AppleAccountDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<AppleStatus | null>(null);
  const [key, setKey] = useState('');
  const [keyId, setKeyId] = useState('');
  const [issuerId, setIssuerId] = useState('');
  const [teamId, setTeamId] = useState('');
  // Apple usually reveals the team id by itself; the field appears only when it does not.
  const [needTeam, setNeedTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
    api.appleAccount().then(setStatus).catch(() => setError(apiErrorText('network')));
  }, []);

  async function pickFile(file: File | undefined) {
    setKey('');
    if (!file) return;
    const text = file.size <= 4000 ? await file.text() : '';
    if (!text.includes('PRIVATE KEY')) {
      setError(t.apple.wrongFile);
      return;
    }
    setError('');
    setKey(text);
    // Apple names the file after the key: AuthKey_<Key ID>.p8.
    const fromName = /AuthKey_([A-Za-z0-9]+)\.p8$/.exec(file.name)?.[1];
    if (fromName) setKeyId(fromName.toUpperCase());
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (busy || !key) return;
    setBusy(true);
    setError('');
    try {
      setStatus(await api.connectApple({ key, keyId, issuerId, teamId }));
      setKey('');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal';
      if (code === 'apple_team_needed') setNeedTeam(true);
      setError(apiErrorText(code));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t.apple.confirmDisconnect)) return;
    setError('');
    try {
      setStatus(await api.disconnectApple());
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    }
  }

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="apple-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="apple-title">{t.apple.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>

      <div className="sheet-body">
        {status?.connected && (
          <>
            <p className="notice">
              {t.apple.connected.replace('{team}', status.teamId ?? '').replace('{key}', status.keyId ?? '')}
            </p>
            <p className="muted">{t.apple.connectedHelp}</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="sheet-actions">
              <button className="btn danger" onClick={() => void disconnect()}>
                {t.apple.disconnect}
              </button>
              <button className="btn primary" onClick={() => dialog.current?.close()}>
                {t.apple.done}
              </button>
            </div>
          </>
        )}

        {status && !status.connected && !status.enabled && <p className="notice">{t.apple.disabled}</p>}

        {status && !status.connected && status.enabled && (
          <>
            <p className="muted">{t.apple.intro}</p>
            <ol className="guide">
              <li>
                <h3>{t.apple.step1}</h3>
                <p>{t.apple.step1Text}</p>
                <a className="link" href={ENROLL_URL} target="_blank" rel="noreferrer">
                  {t.apple.step1Link}
                </a>
              </li>
              <li>
                <h3>{t.apple.step2}</h3>
                <p>{t.apple.step2Text}</p>
                <a className="link" href={KEYS_URL} target="_blank" rel="noreferrer">
                  {t.apple.step2Link}
                </a>
              </li>
              <li>
                <h3>{t.apple.step3}</h3>
                <form className="guide-form" onSubmit={connect}>
                  <label>
                    <span>{t.apple.file}</span>
                    <input type="file" accept=".p8" required onChange={(e) => void pickFile(e.target.files?.[0])} />
                  </label>
                  <label>
                    <span>{t.apple.keyId}</span>
                    <input
                      type="text"
                      required
                      spellCheck={false}
                      autoComplete="off"
                      value={keyId}
                      onChange={(e) => setKeyId(e.target.value)}
                    />
                    <small>{t.apple.keyIdHelp}</small>
                  </label>
                  <label>
                    <span>{t.apple.issuerId}</span>
                    <input
                      type="text"
                      required
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={issuerId}
                      onChange={(e) => setIssuerId(e.target.value)}
                    />
                    <small>{t.apple.issuerIdHelp}</small>
                  </label>
                  {needTeam && (
                    <label>
                      <span>{t.apple.teamId}</span>
                      <input
                        type="text"
                        required
                        spellCheck={false}
                        autoComplete="off"
                        value={teamId}
                        onChange={(e) => setTeamId(e.target.value)}
                      />
                      <small>
                        {t.apple.teamIdHelp}{' '}
                        <a className="link" href={TEAM_URL} target="_blank" rel="noreferrer">
                          developer.apple.com/account
                        </a>
                      </small>
                    </label>
                  )}
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="btn primary" disabled={busy || !key}>
                    {busy ? t.apple.checking : t.apple.connect}
                  </button>
                  <p className="muted fine">{t.apple.privacy}</p>
                </form>
              </li>
            </ol>
          </>
        )}

        {!status && error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
