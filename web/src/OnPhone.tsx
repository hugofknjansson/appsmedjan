// Getting the app onto a phone: right away in the phone's browser, and installed for real through a
// public TestFlight link that needs no developer account.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import { EMPTY_CONTACT, contactProblem, type PublishState, type ReviewContact } from '../../shared/protocol';
import { ApiError, api } from './api';
import { apiErrorText, t } from './i18n';

const TESTFLIGHT_APP = 'https://apps.apple.com/app/testflight/id899247664';
const CONNECT_URL = 'https://appstoreconnect.apple.com/apps';

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
    void newCode();
    // Only once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="phone-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="phone-title">{t.phone.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>

      <div className="sheet-body">
        <ol className="guide">
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
                {t.phone.newCode}
              </button>
            )}
          </li>

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
                  {uploading ? `${t.publishStage[publish.stage ?? 'queued']}…` : uploaded ? t.phone.sendAgain : t.phone.send}
                </button>
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

                {uploaded && (test.status === 'none' || test.status === 'working' || test.status === 'processing') && (
                  <p className="notice" role="status">
                    <span className="spinner small" /> {t.phone.processing}
                  </p>
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
                    <p>
                      {t.store.error[test.error ?? 'internal']} {test.error === 'rejected' ? test.detail : ''}
                    </p>
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
