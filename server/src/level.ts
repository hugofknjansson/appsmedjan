// How much a person is shown: what has been noticed about them, kept per person, and the level it
// adds up to. The reckoning itself is in shared/level.ts.
import { FIRST_LEVEL, LEVEL_ACTS, isLevel, levelFor, levelState, withAct, withWords, type Level, type LevelAct, type LevelSigns, type LevelState } from '../../shared/level';
import { config } from './config';
import * as db from './db';

interface Kept {
  signs: LevelSigns;
  chosen: Level | null;
  told: Level;
}

/**
 * A person from before levels has written and done things already: those are read once, so that
 * they are not taken for a beginner. They are told about the level it adds up to like anyone else.
 */
function fromBefore(userId: string): Kept {
  let signs: LevelSigns = { words: [], acts: [] };
  for (const text of db.userTexts(userId)) signs = withWords(signs, text);
  if (db.getAppleAccount(userId)) signs = withAct(signs, 'apple');
  const kept: Kept = { signs, chosen: null, told: 1 };
  write(userId, kept);
  return kept;
}

function read(userId: string): Kept {
  const row = db.getLevel(userId);
  if (!row) return fromBefore(userId);
  return {
    signs: { words: row.words, acts: row.acts.filter((act): act is LevelAct => (LEVEL_ACTS as string[]).includes(act)) },
    chosen: isLevel(row.chosen) ? row.chosen : null,
    told: isLevel(row.told) ? row.told : 1,
  };
}

function write(userId: string, kept: Kept): void {
  db.setLevel(userId, { words: kept.signs.words, acts: kept.signs.acts, chosen: kept.chosen, told: kept.told });
}

const stateOf = (kept: Kept): LevelState => levelState(kept.signs, kept.chosen, kept.told);

/** What the clients are told, or undefined where levels are off (LEVELS=0): everyone then sees the first level, as before. */
export function state(userId: string): LevelState | undefined {
  return config.levels ? stateOf(read(userId)) : undefined;
}

/** The level a person is shown. */
export function of(userId: string): Level {
  return config.levels ? stateOf(read(userId)).level : FIRST_LEVEL.level;
}

/** Listens to something the person wrote to the builder. */
export function heard(userId: string, text: string): void {
  if (!config.levels) return;
  const kept = read(userId);
  const signs = withWords(kept.signs, text);
  if (signs === kept.signs) return;
  const before = levelFor(kept.signs);
  write(userId, { ...kept, signs });
  const after = levelFor(signs);
  if (after > before) console.log(`[level] user ${userId} is shown level ${after} after what they wrote`);
}

/** Notes something the person did. */
export function did(userId: string, act: LevelAct): void {
  if (!config.levels) return;
  const kept = read(userId);
  const signs = withAct(kept.signs, act);
  if (signs === kept.signs) return;
  const before = levelFor(kept.signs);
  write(userId, { ...kept, signs });
  const after = levelFor(signs);
  if (after > before) console.log(`[level] user ${userId} is shown level ${after} after ${act}`);
}

/** The person has been told about the level they are at now. */
export function told(userId: string): void {
  if (!config.levels) return;
  const kept = read(userId);
  const found = levelFor(kept.signs);
  if (found !== kept.told) write(userId, { ...kept, told: found });
}

/**
 * The person's own choice: a level that stands whatever they write and do, or null to let the
 * service follow along again. Either way there is nothing new left to tell them.
 */
export function choose(userId: string, chosen: Level | null): void {
  if (!config.levels) return;
  const kept = read(userId);
  write(userId, { ...kept, chosen, told: levelFor(kept.signs) });
}
