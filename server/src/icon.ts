// Every app has an icon. The builder draws one as a small SVG when it makes the app; the server turns
// the drawing into the PNG that builds and the App Store want. An app the builder never got to draw
// for gets a simple icon of its own, so nothing is ever installed with a blank square.
import * as db from './db';
import { defaultIconSvg, iconThumbnail, renderIcon } from './iconart';

export { IconError } from './iconart';

/** Gives the project an icon if it has none. Call before anything that puts the app on a phone. */
export function ensureIcon(projectId: string): void {
  if (db.hasIcon(projectId) || !db.getProject(projectId)) return;
  db.setIcon(projectId, renderIcon(defaultIconSvg(projectId)), 'default');
}

export type DrawResult = 'drawn' | 'kept_own';

/** Saves the builder's drawing as the app's icon, unless the person has chosen an icon of their own. */
export function drawIcon(projectId: string, svg: string): DrawResult {
  if (db.iconSource(projectId) === 'own') return 'kept_own';
  db.setIcon(projectId, renderIcon(svg), 'drawn');
  return 'drawn';
}

/** Small versions that have been made, so a list of apps does not redraw them at every visit. */
const thumbnails = new Map<string, Buffer>();

/** The app's icon at `side` pixels, or null without an icon. */
export function smallIcon(projectId: string, side: number): Buffer | null {
  const changedAt = db.iconChangedAt(projectId);
  if (changedAt === null) return null;
  const key = `${projectId}:${changedAt}:${side}`;
  const made = thumbnails.get(key);
  if (made) return made;
  const icon = db.getIcon(projectId);
  if (!icon) return null;
  const small = iconThumbnail(icon, side);
  // Old sizes and old versions of an icon are let go once there are many.
  if (thumbnails.size >= 500) thumbnails.clear();
  thumbnails.set(key, small);
  return small;
}
