// What is shown while something takes its time: the mascot dancing, with a line under it that
// changes every few seconds. Nobody is left looking at a greyed-out button or an empty page.
import { t } from './i18n';
import { Mascot, MascotBadge, WaitingCaption } from './Mascot';

/** The mascot dancing in the middle of where the thing will be. `page`: in the middle of the whole page. */
export function Waiting({ lines, page = false }: { lines?: readonly string[]; page?: boolean }) {
  return (
    <div className={page ? 'waiting page' : 'waiting'} role="status" aria-label={t.wait.label}>
      <Mascot dancing />
      {lines && <WaitingCaption lines={lines} />}
    </div>
  );
}

/**
 * A card for a wait in the middle of other things: what is going on, a changing line, and, when it
 * is known how far it has come, a bar.
 */
export function WaitCard({ title, lines, fraction }: { title: string; lines: readonly string[]; fraction?: number }) {
  return (
    <div className="progress-card wait-card" role="status">
      <MascotBadge dancing />
      <div>
        <strong>{title}</strong>
        <WaitingCaption lines={lines} />
        {fraction !== undefined && <progress value={fraction} max={1} aria-label={t.progressLabel} />}
      </div>
    </div>
  );
}
