// The note that says the person is shown more now, the one time the level goes up by itself: what is
// new, and a way straight back for someone who would rather not have it.
import { useState } from 'react';
import { api } from './api';
import { Mascot } from './Mascot';
import { t } from './i18n';
import { useLevel } from './level';

export function LevelNote() {
  const level = useLevel();
  const [busy, setBusy] = useState(false);
  if (!level.fresh || level.level === 1) return null;
  const text = t.level;
  const shown = level.level;

  /** Either answer means the note has been read; "less" also puts the person back where they were. */
  async function answer(keep: boolean) {
    setBusy(true);
    try {
      if (keep) await api.levelSeen();
      else await api.chooseLevel(shown === 3 ? 2 : 1);
    } catch {
      // Asked again the next time something is loaded.
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="level-note rise" role="status">
      <Mascot cheering />
      <div>
        <strong>{text.noteTitle[shown]}</strong>
        <p>{text.noteText[shown]}</p>
        <p className="muted fine">{text.where}</p>
        <div className="level-note-actions">
          <button className="btn primary" disabled={busy} onClick={() => void answer(true)}>
            {text.keep}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => void answer(false)}>
            {text.less}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** The choice itself, in the account: follow along, or one of the three levels. */
export function LevelChoice() {
  const level = useLevel();
  const [busy, setBusy] = useState(false);
  const text = t.level;

  async function choose(chosen: 1 | 2 | 3 | null) {
    setBusy(true);
    try {
      await api.chooseLevel(chosen);
    } catch {
      // The choice stays where it was.
    } finally {
      setBusy(false);
    }
  }

  const options: Array<{ value: 1 | 2 | 3 | null; name: string; about: string }> = [
    { value: null, name: text.auto, about: text.autoText.replace('{name}', text.names[level.level]) },
    ...([1, 2, 3] as const).map((value) => ({ value, name: text.names[value], about: text.texts[value] })),
  ];
  return (
    <section className="level-choice">
      <h3>{text.title}</h3>
      <p className="muted">{text.help}</p>
      <div role="radiogroup" aria-label={text.title}>
        {options.map((option) => (
          <button key={String(option.value)} role="radio" aria-checked={level.chosen === option.value} disabled={busy} onClick={() => void choose(option.value)}>
            <strong>{option.name}</strong>
            {/* What following along has come to is only known while it is the choice. */}
            {(option.value !== null || level.chosen === null) && <span>{option.about}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
