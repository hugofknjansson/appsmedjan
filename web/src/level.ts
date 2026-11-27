// How much of what is under the hood the person is shown (see shared/level.ts). The server decides
// and says so in its answers; this keeps the latest it said, for whichever part of the page asks.
import { useSyncExternalStore } from 'react';
import { FIRST_LEVEL, isLevel, type LevelState } from '../../shared/level';

let current: LevelState = FIRST_LEVEL;
/** False against a server without levels, or with them turned off: nothing about them is then shown. */
let known = false;
const listeners = new Set<() => void>();

function isLevelState(value: unknown): value is LevelState {
  const v = value as Partial<LevelState> | null;
  return typeof v === 'object' && v !== null && isLevel(v.level) && (v.chosen === null || isLevel(v.chosen)) && typeof v.fresh === 'boolean';
}

/** Takes the level out of an answer from the server, when there is one in it. */
export function noteLevel(answer: unknown): void {
  const found = (answer as { level?: unknown } | null)?.level ?? (answer as { user?: { level?: unknown } | null } | null)?.user?.level;
  if (!isLevelState(found)) return;
  const same = known && found.level === current.level && found.chosen === current.chosen && found.fresh === current.fresh && found.play === current.play;
  if (same) return;
  current = { level: found.level, chosen: found.chosen, fresh: found.fresh, play: found.play === true };
  known = true;
  for (const listener of listeners) listener();
}

/** Signed out: the next person starts from the beginning. */
export function forgetLevel(): void {
  current = FIRST_LEVEL;
  known = false;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useLevel = (): LevelState => useSyncExternalStore(subscribe, () => current);
/** Whether the server has levels at all. */
export const useLevelsOn = (): boolean => useSyncExternalStore(subscribe, () => known);
