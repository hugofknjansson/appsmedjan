// Straight onto the phone, without TestFlight: the person adds their phone once, and after that every
// build is signed for it and installed from a link.
import { useEffect, useState } from 'react';
import { directProgress, type DirectInstall } from '../../shared/protocol';
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

      <InstallProgress direct={direct} />

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
            <p className="muted">{text.buildingNote}</p>
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
          {!running && !working && direct.phones > 0 && <p className="muted fine">{text.autoNote}</p>}
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

/** How many of the four steps are done, and which one is under way (-1 when none is). */
function position(direct: DirectInstall): { done: number; active: number } {
  if (direct.status === 'working') return direct.stage === 'signing' ? { done: 1, active: 1 } : { done: 0, active: 0 };
  if (direct.status !== 'ready') return { done: 0, active: -1 };
  if (direct.install === 'asked' || direct.install === 'fetching') return { done: 2, active: 2 };
  // What iOS does with the file cannot be seen from here; it takes a few seconds.
  if (direct.install === 'fetched') return { done: 4, active: -1 };
  return { done: 2, active: -1 };
}

function headline(direct: DirectInstall): string {
  const text = t.direct;
  if (direct.status === 'working') return direct.stage === 'signing' ? text.steps[1]! : text.building;
  if (direct.install === 'asked' || direct.install === 'fetching') return text.steps[2]!;
  if (direct.install === 'fetched') return text.fetched;
  return text.ready;
}

/**
 * The whole way onto the phone, from the build to the app file arriving: a bar and four steps, each
 * one waiting, under way or done. Shown from the moment a build starts.
 */
export function InstallProgress({ direct }: { direct: DirectInstall }) {
  const progress = directProgress(direct);
  if (progress === null) return null;
  const { done, active } = position(direct);
  const moving = direct.status === 'working' || active >= 0;
  return (
    <div className="install-progress" role="status">
      <div className="install-head">
        <Mascot dancing={moving} />
        <strong>{headline(direct)}</strong>
      </div>
      <progress value={progress} max={1} aria-label={t.direct.progressLabel} />
      <ol>
        {t.direct.steps.map((step, index) => (
          <li key={step} data-mark={index < done ? 'done' : index === active ? 'active' : 'waiting'}>
            <span className="step-mark" aria-hidden="true" />
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
