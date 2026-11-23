// The wait as a show: while the app is built, the whole page is the mascot dancing and, in large
// words, what is being made right now. The same show as ios/Sources/BuildShow.swift.
import { useEffect, useState, type CSSProperties } from 'react';
import { directProgress, runProgress, type DirectInstall, type Part } from '../../shared/protocol';
import { Mascot, WaitingCaption } from './Mascot';
import { t } from './i18n';

/** building: the builder is at work. done: it has just finished, which is cheered for a moment. phone: the finished app is made ready for the person's phone. */
export type ShowStage = 'building' | 'done' | 'phone';

interface Props {
  stage: ShowStage;
  parts: Part[];
  phone: DirectInstall | null;
  /** When the builder started, in milliseconds; null when no clock is to be shown. */
  startedAt: number | null;
  onChat: () => void;
  onStop: () => void;
  /** True when the show grew out of the card the app was asked for in, and needs no entrance of its own. */
  grown?: boolean;
  /** True while it goes away. */
  leaving?: boolean;
}

/** What the builder has said it is making, oldest first. */
function allSaid(parts: Part[]): string[] {
  return parts.flatMap((part) => (part.t === 'step' && part.step.kind === 'say' && part.step.detail.trim() ? [part.step.detail.trim()] : []));
}

/** A number between 0 and 1 that is always the same for the same tile and purpose. */
function noise(tile: number, salt: number): number {
  const mixed = Math.sin((tile * 97 + salt * 131) * 12.9898) * 43758.5453;
  return mixed - Math.floor(mixed);
}

/** App tiles drifting up behind the mascot, like bubbles in a glass. */
const TILES = Array.from({ length: 14 }, (_, tile) => {
  const seconds = 22 + noise(tile, 2) * 26;
  return {
    left: `${Math.round(noise(tile, 4) * 100)}%`,
    '--side': `${Math.round(26 + noise(tile, 1) * 46)}px`,
    '--tilt': `${Math.round((noise(tile, 6) * 2 - 1) * 24)}deg`,
    opacity: 0.07 + noise(tile, 5) * 0.09,
    animationDuration: `${seconds.toFixed(1)}s`,
    // Already on their way when the show opens.
    animationDelay: `${(-noise(tile, 3) * seconds).toFixed(1)}s`,
  } as CSSProperties;
});

function Clock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</>;
}

export function BuildShow({ stage, parts, phone, startedAt, onChat, onStop, grown, leaving }: Props) {
  const progress = runProgress(parts);
  const said = allSaid(parts);
  const building = stage === 'building';

  // The large words: what is being made right now, in the builder's own words once it has said something.
  const headline = building ? (said.at(-1) ?? t.phase[progress.phase]) : stage === 'done' ? t.show.done : phone?.stage === 'signing' ? t.direct.steps[1]! : t.direct.gettingReady;
  const lines = building ? t.show.lines[progress.phase] : stage === 'done' ? [t.show.doneSub] : t.wait.phone;
  const fraction = building ? progress.fraction : stage === 'done' ? 1 : ((phone && directProgress(phone)) ?? 0.05);
  // What was made before this, the latest first.
  const earlier = building ? said.slice(0, -1).slice(-3).reverse() : [];

  // Escape leaves the show for the chat, as it would close a dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stage !== 'done' && !leaving) onChat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onChat, leaving]);

  return (
    <div className="show" role="dialog" aria-modal="true" aria-label={t.show.label} aria-hidden={leaving || undefined} data-grown={grown || undefined} data-leaving={leaving || undefined}>
      <div className="show-tiles" aria-hidden="true">
        {TILES.map((style, tile) => (
          <i key={tile} style={style} />
        ))}
      </div>
      <div className="show-body">
        <div className="show-mascot">
          <Mascot dancing={stage !== 'done'} cheering={stage === 'done'} tile="#fff" eyes="#c74005" />
        </div>
        <div className="show-words" role="status" aria-live="polite">
          <h2 key={headline}>{headline}</h2>
          <WaitingCaption lines={lines} every={3600} />
        </div>
        <progress value={fraction} max={1} aria-label={t.progressLabel} />
        <small>
          {progress.pieces > 0 && building && t.pieces.replace('{n}', String(progress.pieces))}
          {progress.pieces > 0 && building && startedAt !== null && ' · '}
          {startedAt !== null && building && <Clock startedAt={startedAt} />}
        </small>
        <ul className="show-earlier">
          {earlier.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="show-actions">
          {building && (
            <button type="button" onClick={onStop}>
              {t.stop}
            </button>
          )}
          {stage !== 'done' && (
            <button type="button" autoFocus onClick={onChat}>
              {t.show.chat}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
