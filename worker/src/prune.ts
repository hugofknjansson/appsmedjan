// Keeps an unattended Mac from filling its disk. Every project leaves a simulator (a couple of GB
// once booted) and a build folder behind; on a rented Mac with a 256 GB disk that adds up quickly.
// Whatever has not been used for a while is deleted. It is rebuilt from the project's files the next
// time someone opens the project, at the cost of one slower first build.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface Leftover {
  /** Project id. */
  id: string;
  /** When it was last used, or null when nothing on disk says. */
  lastUsedMs: number | null;
}

/** The ids to delete: unused for longer than `days`, and not in use right now. */
export function staleIds(items: Leftover[], inUse: ReadonlySet<string>, nowMs: number, days: number): string[] {
  if (!(days > 0)) return [];
  const cutoff = nowMs - days * 24 * 3600_000;
  return items.filter((item) => !inUse.has(item.id) && (item.lastUsedMs === null || item.lastUsedMs < cutoff)).map((item) => item.id);
}

/** Project folders under `dir` with the time they were last touched. */
export async function listFolders(dir: string): Promise<Leftover[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Leftover[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
    out.push({ id: entry.name, lastUsedMs: stat ? stat.mtimeMs : null });
  }
  return out;
}

/** Marks a project folder as used now. */
export async function touch(dir: string): Promise<void> {
  const now = new Date();
  await fs.utimes(dir, now, now).catch(() => undefined);
}

/** Days to keep unused simulators and build folders. 0 turns pruning off. */
export function pruneAfterDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRUNE_AFTER_DAYS;
  if (raw === undefined || raw.trim() === '') return 14;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : 14;
}
