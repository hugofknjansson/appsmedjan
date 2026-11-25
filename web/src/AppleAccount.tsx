// Connecting the person's own Apple developer account, so that their apps are put up in their name.
//
// A guide that takes one step at a time, for someone who has never seen Apple's developer pages:
// whether they have an account, getting a key from Apple (with a moving picture of where to press),
// dropping the key file here, and pasting one code. The key's id is read off the file's name and the
// team is found by the server, so those are asked for only when that fails. The same thing with
// every field on one page is in AppleAccountClassic.tsx, a press away.
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { ApiError, api, type AppleStatus } from './api';
import { AppleAccountClassic } from './AppleAccountClassic';
import { apiErrorText, t } from './i18n';
import { Confetti, Mascot, WaitingCaption } from './Mascot';

const ENROLL_URL = 'https://developer.apple.com/programs/enroll/';
const KEYS_URL = 'https://appstoreconnect.apple.com/access/integrations/api';
const TEAM_URL = 'https://developer.apple.com/account#MembershipDetailsCard';

/** The code Apple calls Issuer ID, wherever it is in what was pasted. */
const CODE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const codeIn = (text: string): string | null => CODE.exec(text)?.[0].toLowerCase() ?? null;

type Step = 'have' | 'join' | 'key' | 'file' | 'code' | 'team' | 'checking' | 'done';
/** The three steps that are counted: the rest are questions before them and what happens after. */
const COUNTED: Step[] = ['key', 'file', 'code'];

export function AppleAccountDialog({ onClose }: { onClose: () => void }) {
  const [classic, setClassic] = useState(false);
  return classic ? <AppleAccountClassic onClose={onClose} onGuide={() => setClassic(false)} /> : <Guide onClose={onClose} onClassic={() => setClassic(true)} />;
}

function Guide({ onClose, onClassic }: { onClose: () => void; onClassic: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<AppleStatus | null>(null);
  const [step, setStep] = useState<Step>('have');
  const [key, setKey] = useState('');
  const [fileName, setFileName] = useState('');
  const [keyId, setKeyId] = useState('');
  // Apple names the file after the key. When the name has been changed, the id is asked for.
  const [askKeyId, setAskKeyId] = useState(false);
  const [issuerId, setIssuerId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [opened, setOpened] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [cheer, setCheer] = useState(0);
  const text = t.apple;

  useEffect(() => {
    dialog.current?.showModal();
    api.appleAccount().then(setStatus).catch(() => setError(apiErrorText('network')));
  }, []);

  function go(to: Step) {
    setError('');
    setHint('');
    setStep(to);
  }

  async function take(file: File | undefined) {
    setOver(false);
    if (!file) return;
    const content = file.size <= 4000 ? await file.text() : '';
    if (!content.includes('PRIVATE KEY')) {
      setKey('');
      setError(text.wrongFile);
      return;
    }
    const fromName = /AuthKey_([A-Za-z0-9]+)\.p8$/.exec(file.name)?.[1];
    setError('');
    setKey(content);
    setFileName(file.name);
    setKeyId(fromName ? fromName.toUpperCase() : '');
    setAskKeyId(!fromName);
    // A moment to see that the file was the right one, then on to the next step.
    window.setTimeout(() => setStep((now) => (now === 'file' ? 'code' : now)), 900);
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    void take(e.dataTransfer.files[0]);
  }

  async function paste() {
    setError('');
    try {
      const found = codeIn(await navigator.clipboard.readText());
      if (found) {
        setIssuerId(found);
        setHint('');
      } else setHint(text.pasteWrong);
    } catch {
      // The browser does not let the page read what is copied: the person pastes it themselves.
      setHint(text.pasteHint);
    }
  }

  async function connect(e?: FormEvent) {
    e?.preventDefault();
    if (!key || !codeIn(issuerId) || !keyId.trim()) return;
    const from = step === 'team' ? 'team' : 'code';
    go('checking');
    try {
      setStatus(await api.connectApple({ key, keyId: keyId.trim(), issuerId: codeIn(issuerId) ?? '', teamId: teamId.trim() }));
      setKey('');
      setStep('done');
      setCheer((n) => n + 1);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'internal';
      // Back to the step where what went wrong can be put right.
      if (code === 'apple_team_needed') return go('team');
      setStep(code === 'apple_key_invalid' ? 'file' : code === 'apple_key_forbidden' ? 'key' : from);
      if (code === 'apple_key_rejected') setAskKeyId(true);
      // A file that was no key after all is let go of, so that the place for it is empty again.
      if (code === 'apple_key_invalid') {
        setKey('');
        setFileName('');
      }
      setError(apiErrorText(code));
    }
  }

  async function disconnect() {
    if (!window.confirm(text.confirmDisconnect)) return;
    setError('');
    try {
      setStatus(await api.disconnectApple());
      setStep('have');
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    }
  }

  const counted = COUNTED.indexOf(step);
  const codeOk = codeIn(issuerId) !== null;
  const problem = error && (
    <p className="form-error" role="alert">
      {error}
    </p>
  );
  const back = (to: Step) => (
    <button type="button" className="btn ghost" onClick={() => go(to)}>
      {text.back}
    </button>
  );

  let body: ReactNode = null;
  if (!status) body = error ? problem : <Mascot dancing className="big" />;
  else if (step === 'done')
    body = (
      <div className="apple-step apple-centre">
        <Mascot cheering className="big" />
        <h3>{text.doneTitle}</h3>
        <p className="muted">{text.doneText}</p>
        <button className="btn primary" onClick={() => dialog.current?.close()}>
          {text.done}
        </button>
      </div>
    );
  else if (status.connected)
    body = (
      <div className="apple-step">
        <p className="notice apple-linked">
          <Tick /> {text.linked}
        </p>
        <p className="muted">{text.linkedHelp}</p>
        <details className="apple-details">
          <summary>{text.details}</summary>
          <p className="muted fine">{text.linkedDetails.replace('{team}', status.teamId ?? '').replace('{key}', status.keyId ?? '')}</p>
        </details>
        {problem}
        <div className="sheet-actions">
          <button className="btn danger" onClick={() => void disconnect()}>
            {text.disconnect}
          </button>
          <button className="btn primary" onClick={() => dialog.current?.close()}>
            {text.done}
          </button>
        </div>
      </div>
    );
  else if (!status.enabled) body = <p className="notice">{text.disabled}</p>;
  else if (step === 'have')
    body = (
      <div className="apple-step apple-centre">
        <Mascot dancing className="big" />
        <h3>{text.haveTitle}</h3>
        <p className="muted">{text.haveText}</p>
        <div className="apple-choice">
          <button className="btn primary" onClick={() => go('key')}>
            {text.haveYes}
          </button>
          <button className="btn" onClick={() => go('join')}>
            {text.haveNo}
          </button>
        </div>
      </div>
    );
  else if (step === 'join')
    body = (
      <div className="apple-step">
        <h3>{text.joinTitle}</h3>
        <ol className="apple-list">
          {text.joinSteps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <div className="sheet-actions">
          {back('have')}
          <span className="apple-next">
            <a className="btn primary" href={ENROLL_URL} target="_blank" rel="noreferrer">
              {text.joinLink}
            </a>
            <button className="btn" onClick={() => go('key')}>
              {text.joinDone}
            </button>
          </span>
        </div>
      </div>
    );
  else if (step === 'key')
    body = (
      <div className="apple-step">
        <h3>{text.keyTitle}</h3>
        <p className="muted">{text.keyText}</p>
        <KeyPicture />
        <ol className="apple-list">
          {text.keySteps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="muted fine">{text.keyFirstTime}</p>
        {problem}
        <div className="sheet-actions">
          {back('have')}
          <span className="apple-next">
            {/* First the way to Apple; once the person has been there, on is the thing to press. */}
            <a className={opened ? 'btn' : 'btn primary'} href={KEYS_URL} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
              {text.keyLink}
            </a>
            <button className={opened ? 'btn primary' : 'btn'} onClick={() => go('file')}>
              {text.keyDone}
            </button>
          </span>
        </div>
      </div>
    );
  else if (step === 'file')
    body = (
      <div className="apple-step">
        <h3>{text.fileTitle}</h3>
        <p className="muted">{text.fileText}</p>
        <label
          className="drop"
          data-over={over}
          data-ok={key !== ''}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <input type="file" accept=".p8" onChange={(e) => void take(e.target.files?.[0])} />
          {key ? <Tick /> : <FileGlyph />}
          <strong>{key ? text.dropOk : over ? text.dropOver : text.drop}</strong>
          <span className="muted fine">{key ? fileName : 'AuthKey_….p8'}</span>
        </label>
        {problem}
        <div className="sheet-actions">
          {back('key')}
          {key && (
            <button className="btn primary" onClick={() => go('code')}>
              {text.next}
            </button>
          )}
        </div>
      </div>
    );
  else if (step === 'code' || step === 'team')
    body = (
      <form className="apple-step" onSubmit={connect}>
        <h3>{step === 'team' ? text.teamTitle : text.codeTitle}</h3>
        <p className="muted">
          {step === 'team' ? text.teamText : text.codeText}{' '}
          {step === 'team' && (
            <a className="link" href={TEAM_URL} target="_blank" rel="noreferrer">
              {text.teamLink}
            </a>
          )}
        </p>
        {step === 'code' ? (
          <>
            <CodePicture />
            <div className="apple-code" data-ok={codeOk}>
              <input
                type="text"
                aria-label="Issuer ID"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={issuerId}
                onChange={(e) => {
                  setHint('');
                  setIssuerId(codeIn(e.target.value) ?? e.target.value.trim());
                }}
              />
              {codeOk ? (
                <Tick />
              ) : (
                <button type="button" className="btn" onClick={() => void paste()}>
                  {text.paste}
                </button>
              )}
            </div>
            {codeOk ? (
              <p className="muted fine" role="status">
                {text.codeOk}
              </p>
            ) : (
              hint && (
                <p className="muted fine" role="status">
                  {hint}
                </p>
              )
            )}
            {askKeyId && (
              <label className="apple-field">
                <span>{text.keyIdAsk}</span>
                <input type="text" required spellCheck={false} autoComplete="off" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
                <small className="muted">{text.keyIdAskHelp}</small>
              </label>
            )}
          </>
        ) : (
          <label className="apple-field">
            <span>{text.teamId}</span>
            <input type="text" required spellCheck={false} autoComplete="off" maxLength={10} value={teamId} onChange={(e) => setTeamId(e.target.value)} />
          </label>
        )}
        {problem}
        <div className="sheet-actions">
          {back(step === 'team' ? 'code' : 'file')}
          <button className="btn primary" disabled={!key || !codeOk || !keyId.trim() || (step === 'team' && !teamId.trim())}>
            {text.connect}
          </button>
        </div>
        <p className="muted fine">{text.privacy}</p>
      </form>
    );
  else
    body = (
      <div className="apple-step apple-centre" role="status">
        <Mascot dancing className="big" />
        <h3>
          <WaitingCaption lines={text.checkingLines} every={2200} />
        </h3>
      </div>
    );

  const guiding = status !== null && status.enabled && !status.connected && step !== 'done' && step !== 'checking';
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="apple-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="apple-title">{text.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>
      <div className="sheet-body apple-guide">
        {counted >= 0 && (
          <p className="apple-dots" aria-label={text.stepOf.replace('{n}', String(counted + 1)).replace('{of}', String(COUNTED.length))}>
            {COUNTED.map((name, i) => (
              <i key={name} data-on={i <= counted} />
            ))}
          </p>
        )}
        {/* Each step is its own thing on the page, so that it arrives when it is shown. */}
        <div key={status?.connected ? 'linked' : step}>{body}</div>
        {guiding && (
          <button type="button" className="link apple-classic" onClick={onClassic}>
            {text.allAtOnce}
          </button>
        )}
      </div>
      <Confetti trigger={cheer} />
    </dialog>
  );
}

function Tick() {
  return (
    <svg className="apple-tick" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" />
      <path d="M7 12.5l3.3 3.3L17 9" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg className="drop-file" viewBox="0 0 48 56" aria-hidden="true">
      <path className="drop-sheet" d="M8 2h22l12 12v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" />
      <path className="drop-fold" d="M30 2v9a3 3 0 0 0 3 3h9" />
      <circle className="drop-ink" cx="19" cy="32" r="5" />
      <path className="drop-ink" d="M24 32h13M32 32v5M37 32v4" />
    </svg>
  );
}

/**
 * Apple's key page, drawn as simply as it can be: the three things to press light up in turn, with
 * the same numbers as the steps under the picture. The words on it are Apple's own, in English as
 * on the real page, so that they can be recognised there.
 */
function KeyPicture() {
  const text = t.apple;
  return (
    <div className="apple-pic" aria-hidden="true">
      <div className="pic-row" data-beat="1">
        <b>1</b>
        <span>{text.picKeys}</span>
        <em className="pic-press pic-round">+</em>
      </div>
      <div className="pic-row" data-beat="2">
        <b>2</b>
        <span>{text.picName}</span>
        <i>App Dance</i>
        <span>{text.picAccess}</span>
        <em className="pic-press">Admin</em>
      </div>
      <div className="pic-row" data-beat="3">
        <b>3</b>
        <span>App Dance</span>
        <em className="pic-press pic-text">Download</em>
      </div>
    </div>
  );
}

/** Where the code is on Apple's page: above the keys, with Copy beside it. */
function CodePicture() {
  return (
    <div className="apple-pic" aria-hidden="true">
      <div className="pic-row" data-beat="solo">
        <span>Issuer ID</span>
        <i>69a6de7f-••••-••••-••••</i>
        <em className="pic-press pic-text">Copy</em>
      </div>
      <div className="pic-row pic-faint">
        <span>Team Keys</span>
        <i>App Dance</i>
      </div>
    </div>
  );
}
