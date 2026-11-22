// Getting the app out: one place that asks where the person wants it, on their own phone or in
// the App Store, and shows the steps to there, how far they have come, and what is theirs to do
// next. The steps themselves are done in the dialogs that already exist; this is the map.
import { useEffect, useRef, useState } from 'react';
import type { PublishState, ReleaseGoal, ReleaseGuide, ReleaseStep } from '../../shared/protocol';
import { ApiError, api } from './api';
import { apiErrorText, t } from './i18n';
import { Mascot } from './Mascot';

const DEVELOPER_APP = 'https://apps.apple.com/app/apple-developer/id640199958';
const CONNECT_APP = 'https://apps.apple.com/app/app-store-connect/id1234793120';
const CONNECT = 'https://appstoreconnect.apple.com/apps';

interface Props {
  id: string;
  /** Changes whenever something about the upload or the phone does, which is a reason to ask again. */
  publish: PublishState;
  onClose: () => void;
  /** Opens the dialog where the person connects an Apple account of their own. */
  onAccount: () => void;
  /** Opens where the app is put on the person's own phone. */
  onPhone: () => void;
  /** Opens the app's App Store page. */
  onPage: () => void;
}

export function ReleaseDialog({ id, publish, onClose, onAccount, onPhone, onPage }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [goal, setGoal] = useState<ReleaseGoal>('phone');
  const [guide, setGuide] = useState<ReleaseGuide | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = t.release;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // What the person does at Apple is not told to us; it is asked for now and then while this is open.
  useEffect(() => {
    let gone = false;
    const load = () =>
      api
        .release(id)
        .then((loaded) => {
          if (!gone) setGuide(loaded);
        })
        .catch((err) => {
          if (!gone) setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
        });
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [id, publish]);

  /** Leaves the map for the place where the step is done. */
  const go = (to: () => void) => () => {
    dialog.current?.close();
    to();
  };

  async function upload() {
    setBusy(true);
    setError('');
    try {
      await api.testflight(id);
      setGuide(await api.release(id));
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  }

  function action(step: ReleaseStep): JSX.Element | null {
    const link = (href: string, label: string) => (
      <a className="btn primary" href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
    const button = (label: string, run: () => void) => (
      <button className="btn primary" disabled={busy} onClick={run}>
        {label}
      </button>
    );
    switch (step.id) {
      case 'member':
        return link(DEVELOPER_APP, text.open.member);
      case 'key':
        return button(text.open.key, go(onAccount));
      case 'phone':
      case 'install':
        return button(text.open.phone, go(onPhone));
      case 'app':
        return step.bundleId ? link(CONNECT, text.open.connect) : button(text.open.upload, () => void upload());
      case 'page':
      case 'submit':
        return button(text.open.page, go(onPage));
      case 'privacy':
        return link(CONNECT, text.open.connect);
    }
  }

  const steps = guide ? guide[goal] : [];
  const allDone = steps.length > 0 && steps.every((step) => step.state === 'done');
  const closed = guide?.account === 'none' && !guide.canConnect;

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="release-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="release-title">{text.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>
      <div className="sheet-body release">
        <div className="release-goals" role="radiogroup" aria-label={text.title}>
          {(['phone', 'store'] as const).map((choice) => (
            <button key={choice} role="radio" aria-checked={goal === choice} onClick={() => setGoal(choice)}>
              <strong>{text.goal[choice]}</strong>
              <span>{text.goalText[choice]}</span>
            </button>
          ))}
        </div>
        {!guide && !error && <Mascot dancing className="big" />}
        {closed && <p className="notice">{text.closed}</p>}
        {guide && !closed && (
          <>
            <p className="muted">{text.intro[goal]}</p>
            <ol className="release-steps">
              {steps.map((step, index) => {
                const open = step.state === 'now' || step.state === 'working';
                return (
                  <li key={step.id} data-state={step.state}>
                    <span className="release-mark" aria-hidden="true">
                      {step.state === 'done' ? '✓' : index + 1}
                    </span>
                    <div>
                      <strong>{text.step[step.id]}</strong>
                      <span className="visually-hidden"> ({text.state[step.state]})</span>
                      {open && <p className="muted">{text.about[step.id][step.id === 'app' && step.bundleId ? 'waiting' : step.state === 'working' ? 'working' : 'now']}</p>}
                      {open && step.bundleId && <code className="release-id">{step.bundleId}</code>}
                      {open && step.detail && (
                        <p className="form-error" role="alert">
                          {step.detail}
                        </p>
                      )}
                      {step.state === 'now' && action(step)}
                    </div>
                  </li>
                );
              })}
            </ol>
            {allDone && (
              <div className="release-done">
                <Mascot cheering />
                <strong>{text.done[goal]}</strong>
                {goal === 'store' && (
                  <>
                    <p className="muted">{text.follow}</p>
                    <a className="btn" href={CONNECT_APP} target="_blank" rel="noreferrer">
                      {text.open.connectApp}
                    </a>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
