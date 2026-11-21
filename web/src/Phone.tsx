// The simulator preview: shows streamed frames and forwards taps, swipes and typing.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { InputEvent, PreviewState } from '../../shared/protocol';
import { t } from './i18n';
import { Mascot, MascotBadge, WaitingCaption } from './Mascot';

/** Delivers frames straight to the <img>, so a 15 fps stream doesn't re-render the page. */
export class FrameBus {
  private listener: ((frame: ArrayBuffer | null) => void) | null = null;
  private last: ArrayBuffer | null = null;

  push(frame: ArrayBuffer | null): void {
    this.last = frame;
    this.listener?.(frame);
  }

  subscribe(listener: (frame: ArrayBuffer | null) => void): () => void {
    this.listener = listener;
    if (this.last) listener(this.last);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }
}

interface Props {
  bus: FrameBus;
  preview: PreviewState;
  /** True while the agent is working. */
  running: boolean;
  onInput: (event: InputEvent) => void;
  onStart: () => void;
  /** Saves what is showing as a screenshot for the App Store; resolves to a line to show afterwards. */
  onCapture: () => Promise<{ ok: boolean; text: string }>;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function Phone({ bus, preview, running, onInput, onStart, onCapture }: Props) {
  const [capture, setCapture] = useState<{ busy: boolean; ok: boolean; text: string }>({ busy: false, ok: true, text: '' });
  const img = useRef<HTMLImageElement>(null);
  const mime = useRef(preview.mime);
  const [hasFrame, setHasFrame] = useState(false);
  const down = useRef<{ x: number; y: number; at: number } | null>(null);
  const typed = useRef<{ text: string; timer: number | null }>({ text: '', timer: null });
  mime.current = preview.mime;

  useEffect(() => {
    let url: string | null = null;
    const unsubscribe = bus.subscribe((frame) => {
      const el = img.current;
      if (!el) return;
      if (!frame) {
        setHasFrame(false);
        return;
      }
      const next = URL.createObjectURL(new Blob([frame], { type: mime.current }));
      const previous = url;
      url = next;
      el.onload = () => {
        if (previous) URL.revokeObjectURL(previous);
        // Match the frame to whichever iPhone model the simulator is.
        if (el.naturalWidth && el.parentElement) {
          el.parentElement.style.aspectRatio = `${el.naturalWidth} / ${el.naturalHeight}`;
        }
      };
      el.src = next;
      setHasFrame(true);
    });
    return () => {
      unsubscribe();
      if (url) URL.revokeObjectURL(url);
    };
  }, [bus]);

  const interactive = hasFrame && preview.canInput;

  function position(e: PointerEvent): { x: number; y: number } {
    const r = img.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  // The pointer is sent as it moves, so that what is under it in the simulator follows it.
  function onPointerDown(e: PointerEvent) {
    if (!interactive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = position(e);
    down.current = { ...at, at: performance.now() };
    onInput({ kind: 'touch', phase: 'down', ...at });
  }

  function onPointerMove(e: PointerEvent) {
    const last = down.current;
    // No more often than the screen is drawn; where the pointer lifts is always sent.
    if (!last || performance.now() - last.at < 1000 / 60) return;
    const at = position(e);
    down.current = { ...at, at: performance.now() };
    onInput({ kind: 'touch', phase: 'move', ...at });
  }

  /** The pointer lifts where it is, or, when the browser took it away, where it was last seen. */
  function onPointerUp(e: PointerEvent | null) {
    const last = down.current;
    down.current = null;
    if (!last) return;
    const at = e ? position(e) : { x: last.x, y: last.y };
    onInput({ kind: 'touch', phase: 'up', ...at });
  }

  function flushTyped() {
    const pending = typed.current;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    if (pending.text) onInput({ kind: 'text', text: pending.text });
    pending.text = '';
  }

  // Letters typed in quick succession are sent together, since each event is a round trip to the simulator.
  function onKeyDown(e: KeyboardEvent) {
    if (!interactive || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Enter') {
      e.preventDefault();
      flushTyped();
      onInput({ kind: 'key', key: e.key === 'Enter' ? 'enter' : 'backspace' });
    } else if (e.key.length === 1) {
      e.preventDefault();
      const pending = typed.current;
      pending.text += e.key;
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = window.setTimeout(flushTyped, 150);
    }
  }

  const building = preview.status === 'building';
  const stageText = building ? t.stage[preview.stage ?? 'queued'] : '';

  let cover: JSX.Element | null = null;
  if (!hasFrame) {
    if (preview.status === 'unavailable') {
      cover = (
        <div className="phone-cover">
          <Mascot />
          <strong>{t.previewUnavailable}</strong>
          <span>{t.previewUnavailableSub}</span>
        </div>
      );
    } else if (building || running || preview.status === 'running') {
      cover = (
        <div className="phone-cover">
          <Mascot dancing />
          <strong>{building ? stageText : t.previewStarting}</strong>
          <WaitingCaption lines={running && !building ? t.wait.working : t.wait.starting} />
        </div>
      );
    } else {
      cover = (
        <div className="phone-cover">
          <Mascot />
          <strong>{preview.status === 'failed' ? t.previewFailed : t.previewIdle}</strong>
          <button className="btn primary" onClick={onStart}>
            {preview.status === 'failed' ? t.retry : t.start}
          </button>
        </div>
      );
    }
  }

  let pill: string | null = null;
  if (hasFrame) {
    if (building) pill = stageText;
    else if (preview.status === 'failed') pill = running ? t.previewFixing : t.previewFailed;
  }

  return (
    <div className="phone-wrap">
      <div className="phone" tabIndex={interactive ? 0 : -1} onKeyDown={onKeyDown} onBlur={flushTyped}>
        <img
          ref={img}
          alt={t.preview}
          draggable={false}
          className={hasFrame ? (interactive ? 'interactive' : '') : 'hidden'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => onPointerUp(null)}
        />
        {cover}
        {pill && (
          <div className="phone-pill" role="status">
            {building && <MascotBadge dancing />}
            {pill}
          </div>
        )}
      </div>
      <div className="phone-controls">
        <button className="btn ghost" disabled={!interactive} onClick={() => onInput({ kind: 'button', button: 'home' })}>
          {t.home}
        </button>
        <button className="btn ghost" disabled={running || building || preview.status === 'unavailable'} onClick={onStart}>
          {t.restart}
        </button>
        <button
          className="btn ghost"
          title={t.storeShotHint}
          disabled={capture.busy || building || preview.status !== 'running' || !hasFrame}
          onClick={() => {
            setCapture({ busy: true, ok: true, text: '' });
            void onCapture().then((result) => setCapture({ busy: false, ...result }));
          }}
        >
          {t.storeShot}
        </button>
      </div>
      {capture.text && (
        <p className={capture.ok ? 'phone-note muted' : 'phone-note form-error'} role="status">
          {capture.text}
        </p>
      )}
      {hasFrame && <p className="phone-hint muted">{preview.canInput ? t.typeHint : t.viewOnly}</p>}
    </div>
  );
}
