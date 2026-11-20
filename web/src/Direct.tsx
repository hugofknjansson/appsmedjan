// Straight onto the phone, without TestFlight: the person adds their phone once, and after that every
// build is signed for it and installed from a link.
import { useEffect, useState } from 'react';
import type { DirectInstall } from '../../shared/protocol';
import { ApiError, api } from './api';
import { apiErrorText, t } from './i18n';
import { Mascot } from './Mascot';
import { Qr } from './OnPhone';

interface Props {
  id: string;
  direct: DirectInstall;
  /** True while the agent is working: the files may be half-way through a change. */
  running: boolean;
}

export function DirectInstallSteps({ id, direct, running }: Props) {
  const [ticket, setTicket] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = t.direct;

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  }

  const addPhone = () =>
    act(async () => {
      const made = await api.phoneTicket();
      setTicket({ url: location.origin + made.path, expiresAt: Date.now() + made.expiresInMs });
    });

  // The link lets a phone in without a sign-in, so it is taken off the screen when it stops working,
  // and as soon as the phone it was for has been added.
  useEffect(() => {
    if (!ticket) return;
    const timer = setTimeout(() => setTicket(null), Math.max(0, ticket.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [ticket]);
  useEffect(() => setTicket(null), [direct.phones]);

  const working = direct.status === 'working';
  const installUrl = direct.status === 'ready' && direct.path ? location.origin + direct.path : null;

  return (
    <section className="direct">
      <h3>{text.title}</h3>
      <p>{text.intro}</p>

      <ol className="guide">
        <li data-done={direct.phones > 0}>
          <h3>{text.addTitle}</h3>
          {direct.phones > 0 ? (
            <p>{(direct.phones === 1 ? text.addedOne : text.addedMany).replace('{n}', String(direct.phones))}</p>
          ) : (
            <p>{text.addText}</p>
          )}
          {ticket ? (
            <div className="qr-row">
              <Qr value={ticket.url} label={text.addTitle} />
              <div>
                <p>{text.addScan}</p>
                <p>
                  <a className="link" href={ticket.url}>
                    {text.addHere}
                  </a>
                </p>
              </div>
            </div>
          ) : (
            direct.phones < direct.maxPhones && (
              <button className={direct.phones === 0 ? 'btn primary' : 'btn'} disabled={busy} onClick={() => void addPhone()}>
                {direct.phones === 0 ? text.addButton : text.addAnother}
              </button>
            )
          )}
        </li>

        <li>
          <h3>{text.buildTitle}</h3>
          <p>{text.buildText}</p>
          {!direct.available && <p className="muted">{t.phone.noWorker}</p>}
          {working ? (
            <p className="working" role="status">
              <Mascot dancing />
              {text.stage[direct.stage ?? 'queued']}
            </p>
          ) : (
            <button
              className={installUrl ? 'btn' : 'btn primary'}
              disabled={busy || running || !direct.available || direct.phones === 0}
              onClick={() => void act(() => api.direct(id))}
            >
              {direct.status === 'idle' ? text.build : text.buildAgain}
            </button>
          )}
          {running && !working && <p className="muted">{t.phone.waitForAgent}</p>}
          {direct.status === 'failed' && (
            <p className="form-error" role="alert">
              {text.error[direct.error ?? 'internal']}
            </p>
          )}
        </li>

        <li>
          <h3>{text.installTitle}</h3>
          {installUrl ? (
            <div className="qr-row">
              <Qr value={installUrl} label={text.installTitle} />
              <div>
                <p>{text.installScan}</p>
                <p>
                  <a className="link" href={installUrl}>
                    {text.installHere}
                  </a>
                </p>
                <p className="muted fine">{text.devMode}</p>
              </div>
            </div>
          ) : (
            <p>{text.installText}</p>
          )}
        </li>
      </ol>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
