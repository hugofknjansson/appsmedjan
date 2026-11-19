import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, InputEvent, Part, PreviewState, ServerToClient, Step } from '../../shared/protocol';
import { ApiError, api } from './api';
import { Logo } from './Logo';
import { FrameBus, Phone } from './Phone';
import { apiErrorText, stepText, t } from './i18n';

interface State {
  name: string;
  messages: ChatMessage[];
  running: boolean;
  parts: Part[];
  preview: PreviewState;
  filesVersion: number;
}

function reduce(state: State | null, ev: ServerToClient): State | null {
  if (ev.type === 'state') {
    return {
      name: ev.project.name,
      messages: ev.messages,
      running: ev.running,
      parts: ev.parts,
      preview: ev.preview,
      filesVersion: (state?.filesVersion ?? 0) + 1,
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
    case 'project':
      return { ...state, name: ev.name };
    case 'files.changed':
      return { ...state, filesVersion: state.filesVersion + 1 };
    default:
      return state;
  }
}

export function Project({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const [state, dispatch] = useReducer(reduce, null);
  const [connected, setConnected] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'chat' | 'preview' | 'code'>(() =>
    window.matchMedia('(max-width: 820px)').matches ? 'chat' : 'preview',
  );
  const bus = useMemo(() => new FrameBus(), []);
  const socket = useRef<WebSocket | null>(null);

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

  if (missing) {
    return (
      <div className="page center">
        <p>{t.notFound}</p>
        <button className="btn primary" onClick={() => navigate('/')}>
          {t.back}
        </button>
      </div>
    );
  }

  return (
    <div className="page project">
      <header className="topbar">
        <button className="btn ghost" onClick={() => navigate('/')} aria-label={t.back}>
          ← <span className="hide-narrow">{t.back}</span>
        </button>
        <strong className="project-name">{state?.name ?? ''}</strong>
        <div className="topbar-right">
          {!connected && <span className="muted">{t.reconnecting}…</span>}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'chat'} className="only-narrow" onClick={() => setTab('chat')}>
              {t.chat}
            </button>
            <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')}>
              {t.preview}
            </button>
            <button role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
              {t.code}
            </button>
          </div>
        </div>
      </header>

      <div className="workspace" data-tab={tab}>
        <section className="chat-pane">{state && <Chat id={id} state={state} />}</section>
        <section className="stage-pane">
          {state && tab !== 'code' && (
            <Phone
              bus={bus}
              preview={state.preview}
              running={state.running}
              onInput={(event: InputEvent) => sendSocket({ type: 'input', event })}
              onStart={() => sendSocket({ type: 'preview.start' })}
            />
          )}
          {state && tab === 'code' && <CodeView id={id} version={state.filesVersion} />}
          {!state && <Logo small />}
        </section>
      </div>
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
              <Parts parts={m.parts} live={false} />
            </div>
          ),
        )}
        {state.running && (
          <div className="msg assistant" aria-live="polite">
            <Parts parts={state.parts} live />
            <div className="working">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t.working}
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

/** Renders text, progress rows and errors in order; runs of consecutive steps become one list. */
function Parts({ parts, live }: { parts: Part[]; live: boolean }) {
  const groups: Array<{ kind: 'text'; text: string } | { kind: 'steps'; steps: Step[] } | { kind: 'error'; text: string }> = [];
  for (const p of parts) {
    if (p.t === 'text') {
      if (p.text.trim()) groups.push({ kind: 'text', text: p.text.trim() });
    } else if (p.t === 'error') {
      groups.push({ kind: 'error', text: t.agentError[p.code] ?? t.agentError.internal });
    } else {
      const last = groups[groups.length - 1];
      if (last?.kind === 'steps') last.steps.push(p.step);
      else groups.push({ kind: 'steps', steps: [p.step] });
    }
  }
  return (
    <>
      {groups.map((g, i) => {
        if (g.kind === 'text') return <p key={i}>{g.text}</p>;
        if (g.kind === 'error') {
          return (
            <p key={i} className="notice">
              {g.text}
            </p>
          );
        }
        const list = (
          <ul className="steps">
            {g.steps.map((s) => (
              <li key={s.id} data-status={s.status}>
                <span className="step-mark" aria-hidden="true" />
                {stepText(s)}
              </li>
            ))}
          </ul>
        );
        // Finished work folds away so the conversation stays readable.
        if (live || g.steps.length <= 2) return <div key={i}>{list}</div>;
        return (
          <details key={i} className="steps-fold">
            <summary>{t.steps.replace('{n}', String(g.steps.length))}</summary>
            {list}
          </details>
        );
      })}
    </>
  );
}

// --- Code ----------------------------------------------------------------------

function CodeView({ id, version }: { id: string; version: number }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState('');

  useEffect(() => {
    let current = true;
    // Many files can change in quick succession while the agent works.
    const timer = setTimeout(() => {
      api.files(id).then((r) => current && setFiles(r.files)).catch(() => undefined);
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [id, version]);

  const paths = Object.keys(files);
  const active = selected in files ? selected : (paths[0] ?? '');

  if (paths.length === 0) return <p className="muted">{t.noFiles}</p>;
  return (
    <div className="code">
      <ul className="file-list">
        {paths.map((p) => (
          <li key={p}>
            <button aria-current={p === active} onClick={() => setSelected(p)}>
              {p.replace(/^Sources\//, '')}
            </button>
          </li>
        ))}
      </ul>
      <pre className="file-body" tabIndex={0}>
        <code>{files[active]}</code>
      </pre>
    </div>
  );
}
