import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import type {
  ChatMessage,
  InputEvent,
  Part,
  PreviewState,
  PublishState,
  ServerToClient,
} from '../../shared/protocol';
import { STORE_SHOT, directProgress, firstSentence, latestSaid, runProgress, type DirectInstall } from '../../shared/protocol';
import { ApiError, api } from './api';
import { AppleAccountDialog } from './AppleAccount';
import { BuildShow, type ShowStage } from './BuildShow';
import { DirectInstallSteps } from './Direct';
import { OnPhoneDialog } from './OnPhone';
import { PlanDialog } from './Plan';
import { ReleaseDialog } from './Release';
import { StoreDialog } from './Store';
import { Logo } from './Logo';
import { FrameBus } from './frames';
import { Phone } from './Phone';
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

/** `isNew`: the app has just been asked for and is being built; the show is then up from the very first frame. */
export function Project({ id, navigate, isNew = false }: { id: string; navigate: (to: string) => void; isNew?: boolean }) {
  const [state, dispatch] = useReducer(reduce, null);
  const [connected, setConnected] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'chat' | 'phone' | 'preview'>(() =>
    window.matchMedia('(max-width: 820px)').matches ? 'chat' : 'preview',
  );
  const bus = useMemo(() => new FrameBus(), []);
  const socket = useRef<WebSocket | null>(null);
  const [appleOpen, setAppleOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let failures = 0;
    let everConnected = false;
    let autoStarted = false;
    let timer: number | undefined;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      // A browser that can decode video says so; the screen then comes as that and not as still pictures.
      const ws = new WebSocket(`${scheme}://${location.host}/ws?project=${id}${bus.takesVideo ? '&video=h264' : ''}`);
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
    // Video that this browser turns out not to manage: connect again, now asking for still pictures.
    bus.onVideoFailure = () => socket.current?.close();

    return () => {
      closed = true;
      clearTimeout(timer);
      bus.onVideoFailure = null;
      socket.current?.close();
      bus.close();
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

  // The app is tried in the simulator, which is what is shown beside the chat. Putting it on the
  // person's own phone, where that can be done, is one tab away.
  const direct = state?.publish.direct;
  const phone = direct && (direct.available || direct.phones > 0 || direct.status !== 'idle') ? direct : null;
  // A phone tab that is no longer offered falls back to the simulator.
  useEffect(() => {
    if (state && !phone) setTab((now) => (now === 'phone' ? 'preview' : now));
  }, [state, phone]);
  const choose = (next: 'phone' | 'preview') => setTab(next);

  // Something to cheer about: the builder has finished without trouble, or the app has arrived on the phone.
  const [cheers, setCheers] = useState(0);
  const wasRunning = useRef(false);
  const running = state?.running ?? false;
  const lastFailed = state?.messages.at(-1)?.parts.some((part) => part.t === 'error') ?? false;
  // While the app is built, the wait is a show that takes the whole page; null when there is none to see.
  const [show, setShow] = useState<ShowStage | null>(isNew ? 'building' : null);
  // False once the person has chosen the chat over the show, until the next time something is built.
  const [watching, setWatching] = useState(true);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(isNew ? Date.now() : null);
  // True while the show is the one that grew out of the start card; the next one comes in by itself.
  const [grown, setGrown] = useState(isNew);
  useEffect(() => {
    if (running && !wasRunning.current) {
      setShow('building');
      setWatching(true);
      setRunStartedAt(Date.now());
    } else if (!running && wasRunning.current) {
      setRunStartedAt(null);
      if (lastFailed) {
        setShow(null);
      } else {
        setCheers((n) => n + 1);
        setShow('done');
        // What comes after the cheer is the app itself, to be tried at once.
        setTab('preview');
      }
    }
    wasRunning.current = running;
  }, [running, lastFailed]);
  // A new app whose build turned out not to be running after all: no show for nothing.
  const loaded = state !== null;
  useEffect(() => {
    if (loaded && !wasRunning.current) setShow((now) => (now === 'building' ? null : now));
  }, [loaded]);
  // The show goes away with a moment of its own, and the app it was about comes forward in its place.
  const visible = show && watching ? show : null;
  const [leaving, setLeaving] = useState<ShowStage | null>(null);
  const [arriving, setArriving] = useState(false);
  const lastVisible = useRef<ShowStage | null>(visible);
  useEffect(() => {
    const before = lastVisible.current;
    lastVisible.current = visible;
    if (!before || visible) return;
    setGrown(false);
    setLeaving(before);
    if (before === 'done') setArriving(true);
    const timer = setTimeout(() => setLeaving(null), 320);
    return () => clearTimeout(timer);
  }, [visible]);
  // The cheer lasts a moment. Then the show goes on if the app is being made ready for the phone,
  // and otherwise gives way to the question that comes after the wait.
  const phoneWorking = useRef(false);
  phoneWorking.current = direct?.status === 'working';
  useEffect(() => {
    if (show !== 'done') return;
    const timer = setTimeout(() => setShow(phoneWorking.current ? 'phone' : null), 1800);
    return () => clearTimeout(timer);
  }, [show]);
  useEffect(() => {
    if (show === 'phone' && direct?.status !== 'working') setShow(null);
  }, [show, direct?.status]);
  const leaveShow = useCallback(() => setWatching(false), []);
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
      {(visible ?? leaving) && (
        <BuildShow
          stage={(visible ?? leaving)!}
          parts={state?.parts ?? []}
          phone={phone}
          startedAt={runStartedAt}
          grown={grown}
          leaving={!visible}
          onChat={leaveShow}
          onStop={() => void api.stop(id).catch(() => undefined)}
        />
      )}
      <header className="topbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label={t.back}>
          ← <span className="hide-narrow">{t.back}</span>
        </button>
        <strong className="project-name">{state?.name ?? ''}</strong>
        {state && (
          <button className="btn publish-btn" title={t.release.hint} onClick={() => setReleaseOpen(true)}>
            {state.publish.status === 'working' ? `${t.publishStage[state.publish.stage ?? 'queued']}…` : t.release.title}
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
      {planOpen && <PlanDialog onClose={() => setPlanOpen(false)} />}
      {releaseOpen && state && (
        <ReleaseDialog
          id={id}
          publish={state.publish}
          onClose={() => setReleaseOpen(false)}
          onAccount={() => setAppleOpen(true)}
          onPhone={() => (phone ? choose('phone') : setPhoneOpen(true))}
          onPage={() => setStoreOpen(true)}
        />
      )}
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
        <section className="chat-pane">{state && <Chat id={id} state={state} phone={phone} onPhone={() => choose('phone')} onTry={() => choose('preview')} onPlans={() => setPlanOpen(true)} onShow={() => setWatching(true)} />}</section>
        <section
          className="stage-pane"
          data-arriving={arriving || undefined}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setArriving(false);
          }}
        >
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

interface ChatProps {
  id: string;
  state: State;
  /** The person's own phone, when apps can be installed straight onto it. */
  phone: DirectInstall | null;
  /** Shows the pane where the phone is added and the app installed. */
  onPhone: () => void;
  /** Shows the simulator, where the app is tried. */
  onTry: () => void;
  /** Shows the plans, for a person whose plan has no phone in it. */
  onPlans: () => void;
  /** Brings back the show that fills the page while the app is built. */
  onShow: () => void;
}

function Chat({ id, state, phone, onPhone, onTry, onPlans, onShow }: ChatProps) {
  // What was there when the page opened is simply there; what comes after rises into place.
  const firstCount = useRef(state.messages.length);
  const rises = (index: number) => (index >= firstCount.current ? ' rise' : '');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);

  // After the wait, one thing: the question whether to put the app on the phone. The builder's last
  // words go into that card instead of a bubble of their own.
  const last = state.messages.at(-1);
  const asked = phone && !state.running && last?.role === 'assistant' && !last.parts.some((part) => part.t === 'error') ? last : null;

  /** The person said yes: the phone pane has the code to scan, and a build is started if none is waiting. */
  async function answer() {
    if (!phone) return;
    // A plan without a phone in it: the answer to "yes" is the plans.
    if (state.publish.plan?.install === false) {
      onPlans();
      return;
    }
    setAsking(true);
    setError('');
    try {
      if (phone.phones > 0 && !(phone.status === 'ready' && phone.fresh !== false)) await api.direct(id);
      onPhone();
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setAsking(false);
    }
  }
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new content unless the person has scrolled up to read something.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.parts, phone?.status]);

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
        {state.messages.map((m, index) =>
          m.role === 'user' ? (
            <div key={m.id} className={'msg user' + rises(index)}>
              {m.text}
            </div>
          ) : m.id === asked?.id ? null : (
            <div key={m.id} className={'msg assistant' + rises(index)}>
              <Parts parts={m.parts} />
            </div>
          ),
        )}
        {state.running && (
          <div className="msg assistant rise" aria-live="polite">
            <Parts parts={state.parts} />
            <button type="button" className="progress-open" title={t.show.open} onClick={onShow}>
              <ProgressCard {...runClues(state.parts)} timed />
            </button>
          </div>
        )}
        {asked && phone && phone.status === 'working' && (
          <div className="msg assistant" aria-live="polite">
            <ProgressCard title={phone.stage === 'signing' ? t.direct.steps[1]! : t.direct.gettingReady} lines={t.wait.phone} fraction={directProgress(phone) ?? 0.05} />
          </div>
        )}
        {asked && phone && phone.status !== 'working' && (
          <InstallAsk words={lastWords(asked)} phone={phone} locked={state.publish.plan?.install === false} busy={asking} onTry={onTry} onYes={() => void answer()} />
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

/** The first sentence of what the builder said last in an answer, without the steps around it. */
function lastWords(message: ChatMessage): string {
  const said = message.parts.findLast((part) => part.t === 'text' && part.text.trim() !== '');
  return said?.t === 'text' ? firstSentence(said.text) : '';
}

/** What to show while the builder works: its phase in plain words, lines to go with it, and how far it has come. */
function runClues(parts: Part[]): { title: string; lines: readonly string[]; fraction: number; pieces: number } {
  const progress = runProgress(parts);
  const trying = progress.phase === 'trying' || progress.phase === 'looking' || progress.phase === 'fixing';
  return { title: latestSaid(parts) ?? t.phase[progress.phase], lines: trying ? t.wait.trying : t.wait.working, fraction: progress.fraction, pieces: progress.pieces };
}

/**
 * The wait, with clues: what is being done right now in plain words, a line that takes turns under
 * it, a bar that grows, and how much has been made so far.
 */
function ProgressCard({ title, lines, fraction, pieces = 0, timed = false }: { title: string; lines: readonly string[]; fraction: number; pieces?: number; timed?: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!timed) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [timed]);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="progress-card" role="status">
      <MascotBadge dancing />
      <div>
        <strong>{title}</strong>
        <WaitingCaption lines={lines} />
        <progress value={fraction} max={1} aria-label={t.progressLabel} />
        {(pieces > 0 || timed) && (
          <small>
            {[pieces > 0 ? t.pieces.replace('{n}', String(pieces)) : '', timed ? clock : ''].filter(Boolean).join(' · ')}
          </small>
        )}
      </div>
    </div>
  );
}

/**
 * What comes after the wait, and the only thing that does: the builder's one sentence, a way to
 * try the app at once, and the question whether to put it on the phone as well.
 */
function InstallAsk({ words, phone, locked, busy, onTry, onYes }: { words: string; phone: DirectInstall; locked: boolean; busy: boolean; onTry: () => void; onYes: () => void }) {
  const arriving = phone.install === 'asked' || phone.install === 'fetching';
  const arrived = phone.status === 'ready' && phone.install === 'fetched';
  const text = t.ask;
  const headline = arrived ? t.direct.fetched : arriving ? t.direct.steps[2]! : text.ready;
  const question = locked ? text.locked : phone.phones === 0 ? text.noPhone : text.install;
  return (
    <div className="install-ask rise">
      <Mascot cheering={arriving} />
      {words && <p className="muted">{rich(words)}</p>}
      <strong>{headline}</strong>
      <button className="btn primary" onClick={onTry}>
        {text.tryNow}
      </button>
      {!arriving && !arrived && <p className="muted fine">{question}</p>}
      {phone.status === 'failed' && (
        <p className="form-error" role="alert">
          {t.direct.error[phone.error ?? 'internal']}
        </p>
      )}
      {!arriving && (
        <button className="btn ghost" disabled={!locked && (busy || (!phone.available && phone.status !== 'ready'))} onClick={onYes}>
          {locked ? t.plan.see : phone.phones === 0 ? t.direct.addButton : phone.status === 'failed' ? t.retry : arrived ? text.again : text.yes}
        </button>
      )}
    </div>
  );
}

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
