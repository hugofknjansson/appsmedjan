// Getting the app onto a phone: right away in the phone's browser, and installed for real through a
// public TestFlight link that needs no developer account.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import {
  EMPTY_CONTACT,
  contactProblem,
  testerPersonProblem,
  type PublishStage,
  type PublishState,
  type ReviewContact,
  type TesterPerson,
} from '../../shared/protocol';
import { ApiError, api } from './api';
import { DirectInstallSteps } from './Direct';
import { apiErrorText, t } from './i18n';
import { Detail } from './Detail';
import { WaitCard } from './Waiting';

const TESTFLIGHT_APP = 'https://apps.apple.com/app/testflight/id899247664';
const CONNECT_URL = 'https://appstoreconnect.apple.com/apps';
/** Roughly how far an upload has come at each stage, for the bar. */
const UPLOAD_PROGRESS: Record<PublishStage, number> = { queued: 0.05, preparing: 0.15, waiting_for_app: 0.2, archiving: 0.5, uploading: 0.8 };

const errorText = (err: unknown) => apiErrorText(err instanceof ApiError ? err.code : 'internal');

/** A QR code drawn as one SVG path, so it stays sharp at any size and needs no image request. */
export function Qr({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
    return { size: count, path: d };
  }, [value]);
  // A light margin on every side, which scanners need, whatever the page's colours are.
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`-3 -3 ${size + 6} ${size + 6}`} shapeRendering="crispEdges">
      <rect x={-3} y={-3} width={size + 6} height={size + 6} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

interface Props {
  id: string;
  publish: PublishState;
  /** True while the agent is working: the files may be half-way through a change. */
  running: boolean;
  onClose: () => void;
  onConnect: () => void;
}

export function OnPhoneDialog({ id, publish, running, onClose, onConnect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [handoff, setHandoff] = useState<{ url: string; expiresAt: number } | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contact, setContact] = useState<ReviewContact>(EMPTY_CONTACT);
  const [person, setPerson] = useState<TesterPerson>({ email: '', firstName: '', lastName: '' });

  async function newCode() {
    setExpired(false);
    try {
      const ticket = await api.handoff(id);
      setHandoff({ url: location.origin + ticket.path, expiresAt: Date.now() + ticket.expiresInMs });
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // The code signs the phone in, so it stops working after a few minutes and is taken off the screen.
  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, handoff.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [handoff]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function sendContact(e: FormEvent) {
    e.preventDefault();
    void act(() => api.shareAgain(id, contact));
  }

  const test = publish.test ?? { status: 'none' as const };
  const uploading = publish.status === 'working';
  const uploaded = publish.status === 'uploaded';
  const missing = contactProblem(contact);
  const fast = publish.fast ?? { available: false, status: 'none' as const };
  // Members of the developer team get every build without Apple's review: the operator in their own
  // account, and anyone who has connected an account of their own.
  const internal = uploaded && publish.tester === 'added' && (publish.operator === true || publish.account === 'own');

  function sendPerson(e: FormEvent) {
    e.preventDefault();
    void act(() => api.fastTrack(id, person));
  }

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="phone-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="phone-title">{t.phone.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>

      <div className="sheet-body">
        {publish.direct && (publish.direct.available || publish.direct.phones > 0 || publish.direct.status !== 'idle') && (
          <>
            <DirectInstallSteps id={id} direct={publish.direct} running={running} />
            <h3 className="other-ways">{t.phone.otherWays}</h3>
          </>
        )}
        <ol className="guide">
          <li>
            <h3>{t.phone.install}</h3>
            <p>{t.phone.installText}</p>

            {publish.account === 'none' ? (
              <p>
                {publish.canConnect ? t.phone.needAccount : t.phone.notOffered}{' '}
                {publish.canConnect && (
                  <button className="link" onClick={onConnect}>
                    {t.apple.title}
                  </button>
                )}
              </p>
            ) : (
              <>
                {!publish.available && <p className="muted">{t.phone.noWorker}</p>}
                <button className="btn primary" disabled={busy || uploading || running || !publish.available} onClick={() => void act(() => api.testflight(id))}>
                  {uploaded ? t.phone.sendAgain : t.phone.send}
                </button>
                {/* The upload takes minutes: what it is doing, and how far it has come. */}
                {uploading && publish.stage !== 'waiting_for_app' && (
                  <WaitCard title={t.publishStage[publish.stage ?? 'queued']} lines={t.wait.upload} fraction={UPLOAD_PROGRESS[publish.stage ?? 'queued']} />
                )}
                {running && <p className="muted fine">{t.phone.waitForAgent}</p>}

                {uploading && publish.stage === 'waiting_for_app' && (
                  <p className="notice" role="status">
                    {publish.account === 'operator' && !publish.operator ? (
                      t.phone.waitingOperator
                    ) : (
                      <>
                        {t.publishWaiting.replace('{bundleId}', publish.bundleId ?? '')}{' '}
                        <a className="link" href={CONNECT_URL} target="_blank" rel="noreferrer">
                          {t.publishWaitingLink}
                        </a>
                      </>
                    )}
                  </p>
                )}

                {publish.status === 'failed' && (
                  <p className="form-error" role="alert">
                    {publish.error === 'no_app_record' && publish.account === 'operator' && !publish.operator
                      ? t.phone.waitingOperatorRetry
                      : t.publishError[publish.error ?? 'internal'].replace('{bundleId}', publish.bundleId ?? '')}
                  </p>
                )}

                {internal && (
                  <div className="notice" role="status">
                    <p>
                      <strong>{t.phone.internalReady}</strong>
                    </p>
                    <p>
                      {t.phone.internalText}{' '}
                      <a className="link" href={TESTFLIGHT_APP} target="_blank" rel="noreferrer">
                        TestFlight
                      </a>
                    </p>
                  </div>
                )}
                {internal && <h4>{t.phone.linkForOthers}</h4>}

                {uploaded && fast.status === 'added' && (
                  <div className="notice" role="status">
                    <p>
                      <strong>{t.phone.fastAdded}</strong>
                    </p>
                    <p>
                      {t.phone.fastAddedText}{' '}
                      <a className="link" href={TESTFLIGHT_APP} target="_blank" rel="noreferrer">
                        TestFlight
                      </a>
                    </p>
                  </div>
                )}
                {uploaded && fast.status === 'invited' && (
                  <p className="notice" role="status">
                    {t.phone.fastInvited.replace('{email}', fast.email ?? '')}
                  </p>
                )}
                {uploaded && fast.status === 'working' && (
                  <p className="notice" role="status">
                    <span className="spinner small" /> {t.phone.fastWorking}
                  </p>
                )}
                {uploaded && fast.available && (fast.status === 'none' || fast.status === 'failed') && test.status !== 'approved' && (
                  <form className="guide-form fast" onSubmit={sendPerson}>
                    <h4>{t.phone.fastTitle}</h4>
                    <p className="muted fine">{t.phone.fastText}</p>
                    {fast.status === 'failed' && (
                      <div className="form-error" role="alert">
                        {t.phone.fastFailed}
                        {fast.error === 'rejected' && <Detail text={fast.detail} />}
                      </div>
                    )}
                    <label>
                      <span>{t.phone.fastEmail}</span>
                      <input type="email" required autoComplete="email" value={person.email} onChange={(e) => setPerson((p) => ({ ...p, email: e.target.value }))} />
                      <small>{t.phone.fastEmailHelp}</small>
                    </label>
                    <label>
                      <span>{t.store.firstName}</span>
                      <input type="text" required autoComplete="given-name" value={person.firstName} onChange={(e) => setPerson((p) => ({ ...p, firstName: e.target.value }))} />
                    </label>
                    <label>
                      <span>{t.store.lastName}</span>
                      <input type="text" required autoComplete="family-name" value={person.lastName} onChange={(e) => setPerson((p) => ({ ...p, lastName: e.target.value }))} />
                    </label>
                    <button className="btn" disabled={busy || testerPersonProblem(person) !== null}>
                      {t.phone.fastSend}
                    </button>
                  </form>
                )}

                {uploaded && (test.status === 'none' || test.status === 'working' || test.status === 'processing') && (
                  <WaitCard title={t.phone.processing} lines={t.wait.processing} />
                )}
                {uploaded && test.status === 'review' && (
                  <p className="notice" role="status">
                    {t.phone.review}
                  </p>
                )}
                {uploaded && test.status === 'approved' && test.url && (
                  <div className="notice" role="status">
                    <p>
                      <strong>{t.phone.ready}</strong>
                    </p>
                    <div className="qr-row">
                      <Qr value={test.url} label={t.phone.install} />
                      <ol className="plain-list">
                        <li>
                          {t.phone.step1}{' '}
                          <a className="link" href={TESTFLIGHT_APP} target="_blank" rel="noreferrer">
                            TestFlight
                          </a>
                        </li>
                        <li>{t.phone.step2}</li>
                        <li>{t.phone.step3}</li>
                      </ol>
                    </div>
                    <p className="fine">
                      {t.phone.share}{' '}
                      <a className="link" href={test.url} target="_blank" rel="noreferrer">
                        {test.url}
                      </a>
                    </p>
                  </div>
                )}
                {uploaded && test.status === 'rejected' && (
                  <p className="form-error" role="alert">
                    {t.phone.rejected}
                  </p>
                )}
                {uploaded && test.status === 'failed' && (
                  <div className="form-error" role="alert">
                    <div>
                      {t.store.error[test.error ?? 'internal']}
                      {test.error === 'rejected' && <Detail text={test.detail} />}
                    </div>
                    <button className="btn" disabled={busy} onClick={() => void act(() => api.shareAgain(id))}>
                      {t.phone.retry}
                    </button>
                  </div>
                )}
                {uploaded && test.status === 'needs_contact' && (
                  <form className="guide-form" onSubmit={sendContact}>
                    <p>{t.phone.needContact}</p>
                    {(['firstName', 'lastName', 'phone', 'email'] as const).map((key) => (
                      <label key={key}>
                        <span>{t.store[key]}</span>
                        <input
                          type={key === 'phone' ? 'tel' : key === 'email' ? 'email' : 'text'}
                          required
                          value={contact[key]}
                          onChange={(e) => setContact((c) => ({ ...c, [key]: e.target.value }))}
                        />
                        {key === 'phone' && <small>{t.store.phoneHelp}</small>}
                      </label>
                    ))}
                    <button className="btn primary" disabled={busy || missing !== null}>
                      {t.phone.continue}
                    </button>
                  </form>
                )}
              </>
            )}
          </li>

          <li>
            <h3>{t.phone.tryNow}</h3>
            <p>{t.phone.tryNowText}</p>
            {handoff && !expired ? (
              <div className="qr-row">
                <Qr value={handoff.url} label={t.phone.tryNow} />
                <p className="muted fine">{t.phone.tryNowNote}</p>
              </div>
            ) : (
              <button className="btn" onClick={() => void newCode()}>
                {handoff ? t.phone.newCode : t.phone.showCode}
              </button>
            )}
          </li>
        </ol>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
