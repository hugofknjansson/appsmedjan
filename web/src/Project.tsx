import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import type {
  ChatMessage,
  InputEvent,
  Part,
  PreviewState,
  PublishState,
  ServerToClient,
  Step,
} from '../../shared/protocol';
import { STORE_SHOT } from '../../shared/protocol';
import { ApiError, api } from './api';
import { AppleAccountDialog } from './AppleAccount';
import { DirectInstallSteps } from './Direct';
import { OnPhoneDialog } from './OnPhone';
import { StoreDialog } from './Store';
import { Logo } from './Logo';
import { FrameBus, Phone } from './Phone';
import { Confetti, Mascot, MascotBadge, WaitingCaption } from './Mascot';
import { apiErrorText, t } from './i18n';

interface State {
  name: string;
  messages: ChatMessage[];
  running: boolean;
  parts: Part[];
  preview: PreviewState;
  publish: PublishState;
}

function reduce(state: State | null, ev: ServerToClient): State | null {
  if (ev.type === 'state') {
    return {
      name: ev.project.name,
      messages: ev.messages,
      running: ev.running,
      parts: ev.parts,
      preview: ev.preview,
      publish: ev.publish,
    };
  }
  if (!state) return state;
  switch (ev.type) {
    case 'run.start':
      return { ...state, running: true, parts: [] };
    case 'run.end':
      return { ...state, running: false, parts: [] };
    case 'text.delta': {
      const parts = [...state.parts];
      const last = parts[parts.length - 1];
      if (last?.t === 'text') parts[parts.length - 1] = { t: 'text', text: last.text + ev.delta };
      else parts.push({ t: 'text', text: ev.delta });
      return { ...state, parts };
    }
    case 'part':
      return { ...state, parts: [...state.parts, ev.part] };
    case 'step': {
      const exists = state.parts.some((p) => p.t === 'step' && p.step.id === ev.step.id);
      const parts: Part[] = exists
        ? state.parts.map((p) => (p.t === 'step' && p.step.id === ev.step.id ? { t: 'step', step: ev.step } : p))
        : [...state.parts, { t: 'step', step: ev.step }];
      return { ...state, parts };
    }
    case 'message':
      if (state.messages.some((m) => m.id === ev.message.id)) return state;
      return { ...state, messages: [...state.messages, ev.message] };
    case 'preview':
      return { ...state, preview: ev.preview };
    case 'publish':
      return { ...state, publish: ev.publish };
    case 'project':
      return { ...state, name: ev.name };
    default:
      return state;
  }
}

export function Project({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const [state, dispatch] = useReducer(reduce, null);
  const [connected, setConnected] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'chat' | 'phone' | 'preview'>(() =>
    window.matchMedia('(max-width: 820px)').matches ? 'chat' : 'preview',
  );
  /** Whether the pane beside the chat has been chosen yet, by the person or for them. */
  const paneChosen = useRef(false);
  const bus = useMemo(() => new FrameBus(), []);
  const socket = useRef<WebSocket | null>(null);
  const [appleOpen, setAppleOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let failures = 0;
    let everConnected = false;
    let autoStarted = false;
    let timer: number | undefined;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws?project=${id}`);
      ws.binaryType = 'arraybuffer';
      socket.current = ws;

      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          bus.push(e.data as ArrayBuffer);
          return;
        }
        const ev = JSON.parse(e.data) as ServerToClient;
        if (ev.type === 'frame.clear') {
          bus.push(null);
          return;
        }
        dispatch(ev);
        if (ev.type === 'state') {
          everConnected = true;
          failures = 0;
          retry = 500;
          setConnected(true);
          // Wake the simulator once when the page opens; after that the person decides.
          if (!autoStarted && !ev.running && ev.preview.status === 'idle') {
            ws.send(JSON.stringify({ type: 'preview.start' }));
          }
          autoStarted = true;
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setConnected(false);
        // A project that never accepts the connection doesn't exist (or isn't ours).
        if (!everConnected && ++failures >= 3) {
          setMissing(true);
          return;
        }
        timer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 8000);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [id, bus]);

  const sendSocket = (msg: object) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  async function captureForStore(): Promise<{ ok: boolean; text: string }> {
    try {
      const store = await api.captureScreenshot(id);
      const text = t.storeShotSaved.replace('{n}', String(store.screenshots.length)).replace('{max}', String(STORE_SHOT.max));
      return { ok: true, text };
    } catch (err) {
      return { ok: false, text: apiErrorText(err instanceof ApiError ? err.code : 'internal') };
    }
  }

  // The person's own phone comes first when apps can be installed straight onto it and they have
  // added one: that is where they try the app. The simulator stays one tab away.
  const direct = state?.publish.direct;
  const phone = direct && (direct.available || direct.phones > 0 || direct.status !== 'idle') ? direct : null;
  const phoneFirst = Boolean(phone && phone.phones > 0);
  useEffect(() => {
    if (!phoneFirst || paneChosen.current) return;
    paneChosen.current = true;
    setTab((now) => (now === 'preview' ? 'phone' : now));
  }, [phoneFirst]);
  // A phone tab that is no longer offered falls back to the simulator.
  useEffect(() => {
    if (state && !phone) setTab((now) => (now === 'phone' ? 'preview' : now));
  }, [state, phone]);
  const choose = (next: 'phone' | 'preview') => {
    paneChosen.current = true;
    setTab(next);
  };

  // Something to cheer about: the builder has finished without trouble, or the app has arrived on the phone.
  const [cheers, setCheers] = useState(0);
  const wasRunning = useRef(false);
  const running = state?.running ?? false;
  const lastFailed = state?.messages.at(-1)?.parts.some((part) => part.t === 'error') ?? false;
  useEffect(() => {
    if (wasRunning.current && !running && !lastFailed) setCheers((n) => n + 1);
    wasRunning.current = running;
  }, [running, lastFailed]);
  // Only when it was seen arriving: not for an app that had already arrived when the page was opened.
  const install = direct?.status === 'ready' ? (direct.install ?? 'ready') : undefined;
  const lastInstall = useRef(install);
  useEffect(() => {
    if (install === 'fetched' && lastInstall.current !== undefined && lastInstall.current !== 'fetched') setCheers((n) => n + 1);
    lastInstall.current = install;
  }, [install]);

  if (missing) {
    return (
      <div className="page center">
        <Mascot className="big" />
        <p>{t.notFound}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          {t.back}
        </button>
      </div>
    );
  }

  return (
    <div className="page project">
      <Confetti trigger={cheers} />
      <header className="topbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label={t.back}>
          ← <span className="hide-narrow">{t.back}</span>
        </button>
        <strong className="project-name">{state?.name ?? ''}</strong>
        {state && (state.publish.available || (state.publish.account === 'none' && state.publish.canConnect)) && (
          <button className="btn publish-btn" title={t.onPhoneHint} onClick={() => setPhoneOpen(true)}>
            {state.publish.status === 'working' ? `${t.publishStage[state.publish.stage ?? 'queued']}…` : t.onPhone}
          </button>
        )}
        {state && (state.publish.account !== 'none' || state.publish.canConnect) && (
          <button className="btn publish-btn" title={t.appStoreHint} onClick={() => setStoreOpen(true)}>
            {t.appStore}
          </button>
        )}
        <div className="topbar-right">
          {!connected && <span className="muted">{t.reconnecting}…</span>}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chat'} className="only-narrow" onClick={() => setTab('chat')}>
              {t.chat}
            </button>
            {phone && (
              <button role="tab" aria-selected={tab === 'phone'} onClick={() => choose('phone')}>
                {t.myPhone}
              </button>
            )}
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => choose('preview')}>
              {phone ? t.simulator : t.preview}
            </button>
          </div>
        </div>
      </header>
      {state && !phoneOpen && <PublishNote publish={state.publish} />}
      {appleOpen && <AppleAccountDialog onClose={() => setAppleOpen(false)} />}
      {phoneOpen && state && (
        <OnPhoneDialog
          id={id}
          publish={state.publish}
          running={state.running}
          onClose={() => setPhoneOpen(false)}
          onConnect={() => {
            setPhoneOpen(false);
            setAppleOpen(true);
          }}
        />
      )}
      {storeOpen && (
        <StoreDialog
          id={id}
          onClose={() => setStoreOpen(false)}
          onConnect={() => {
            setStoreOpen(false);
            setAppleOpen(true);
          }}
        />
      )}

      <div className="workspace" data-tab={tab}>
        <section className="chat-pane">{state && <Chat id={id} state={state} />}</section>
        <section className="stage-pane">
          {state && tab === 'phone' && phone && (
            <div className="phone-tab">
              <DirectInstallSteps id={id} direct={phone} running={state.running} />
            </div>
          )}
          {state && tab !== 'phone' && (
            <Phone
              bus={bus}
              preview={state.preview}
              running={state.running}
              onInput={(event: InputEvent) => sendSocket({ type: 'input', event })}
              onStart={() => sendSocket({ type: 'preview.start' })}
              onCapture={captureForStore}
            />
          )}
          {!state && <Logo small />}
        </section>
      </div>
    </div>
  );
}

// --- TestFlight ----------------------------------------------------------------

const RECENT_MS = 6 * 3600_000;

/** Tells how the latest upload went. Old results stay quiet so the bar doesn't greet every visit. */
function PublishNote({ publish }: { publish: PublishState }) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  let text = '';
  let failed = false;
  let link = false;
  if (publish.status === 'working' && publish.stage === 'waiting_for_app') {
    if (publish.account === 'operator' && !publish.operator) {
      // Only whoever runs the service can create the app in their account.
      text = t.phone.waitingOperator;
    } else {
      // The one step only the person can take; everything after it happens by itself.
      text = t.publishWaiting.replace('{bundleId}', publish.bundleId ?? '');
      link = true;
    }
  } else if (publish.account !== 'none' && publish.at && Date.now() - publish.at < RECENT_MS) {
    if (publish.status === 'uploaded') {
      text = (publish.tester === 'added' ? t.publishUploadedTester : t.publishUploaded).replace('{build}', publish.build ?? '');
    } else if (publish.status === 'failed') {
      const code = publish.error ?? 'internal';
      // With the person's own account, the fix for a key or signing problem is theirs to make.
      const own = publish.account === 'own' && (code === 'auth' || code === 'signing') ? t.publishErrorOwn[code] : null;
      text = (own ?? t.publishError[code]).replace('{bundleId}', publish.bundleId ?? '');
      failed = true;
    }
  }
  const key = `${publish.status}:${publish.stage ?? ''}:${publish.at ?? 0}`;
  if (!text || dismissed === key) return null;
  return (
    <div className="publish-note" data-failed={failed} role="status">
      <span>
        {text}{' '}
        {link && (
          <a className="link" href="https://appstoreconnect.apple.com/apps" target="_blank" rel="noreferrer">
            {t.publishWaitingLink}
          </a>
        )}
      </span>
      {!link && (
        <button className="link" onClick={() => setDismissed(key)}>
          {t.dismiss}
        </button>
      )}
    </div>
  );
}

// --- Chat ----------------------------------------------------------------------

function Chat({ id, state }: { id: string; state: State }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new content unless the person has scrolled up to read something.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.parts]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || sending || state.running) return;
    setSending(true);
    setError('');
    try {
      await api.sendMessage(id, message);
      setText('');
      pinned.current = true;
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {state.messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="msg assistant">
              <Parts parts={m.parts} />
            </div>
          ),
        )}
        {state.running && (
          <div className="msg assistant" aria-live="polite">
            <Parts parts={state.parts} />
            <div className="working">
              <MascotBadge dancing />
              <WaitingCaption lines={tryingOut(state.parts) ? t.wait.trying : t.wait.working} />
            </div>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <textarea
          value={text}
          rows={2}
          maxLength={8000}
          placeholder={t.messagePlaceholder}
          aria-label={t.messagePlaceholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) void submit(e);
          }}
        />
        <div className="composer-row">
          {state.running ? (
            <button type="button" className="btn" onClick={() => void api.stop(id).catch(() => undefined)}>
              {t.stop}
            </button>
          ) : (
            <button className="btn primary" disabled={sending || !text.trim()}>
              {t.send}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

/** True when the latest thing the builder started is trying the app out or looking at it. */
function tryingOut(parts: Part[]): boolean {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (part.t === 'step' && part.step.status === 'running') return part.step.kind === 'build' || part.step.kind === 'look';
  }
  return false;
}

/** Bold is shown as such, should the builder use it; nothing is shown as raw marks. */
function rich(text: string): Array<string | JSX.Element> {
  return text.split(/\*\*(.+?)\*\*/g).map((piece, i) => (i % 2 === 1 ? <strong key={i}>{piece}</strong> : piece));
}

/**
 * What the builder says, and what went wrong when something did. The steps it took on the way are
 * not shown: they are about how the app is made, which is nothing the person needs to follow.
 */
function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.t === 'text') {
          return part.text.trim() ? (
            <p key={i} className="bubble">
              {rich(part.text.trim())}
            </p>
          ) : null;
        }
        if (part.t === 'error') {
          return (
            <p key={i} className="notice">
              {t.agentError[part.code] ?? t.agentError.internal}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}
