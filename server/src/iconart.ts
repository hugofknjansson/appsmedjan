// Drawing icons: the builder's SVG turned into the PNG that builds and the App Store want, and the
// stand-in every app gets when nobody has drawn one. Nothing here touches the database.
import crypto from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { STORE_ICON_SIZE } from '../../shared/protocol';

const MAX_SVG_CHARS = 20_000;

/** Why a drawing was turned down, said so that the builder can fix it. */
export class IconError extends Error {}

/**
 * Turns the builder's drawing into the icon's PNG. The drawing is someone else's text handed to a
 * renderer, so only plain shapes get through: no scripts, no pictures or fonts from elsewhere, no
 * text (there are no fonts to set it in).
 */
export function renderIcon(svg: string): Buffer {
  const text = svg.trim();
  if (text.length > MAX_SVG_CHARS) throw new IconError(`The drawing is too long (${text.length} characters, at most ${MAX_SVG_CHARS}). Simplify it.`);
  if (!/^<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) throw new IconError('The drawing must be one <svg> element and nothing else.');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new IconError('No DOCTYPE, entities or stylesheets.');
  const banned = /<\s*(script|foreignObject|image|text|tspan|style|iframe|a|animate\w*|set|switch|feImage)\b/i.exec(text);
  if (banned) throw new IconError(`<${banned[1]}> is not allowed. Use plain shapes: rect, circle, ellipse, path, polygon, line, g, and gradients in defs.`);
  // Only references to something inside the drawing itself.
  if (/(?:href|src)\s*=\s*["'](?!#)/i.test(text) || /url\(\s*["']?(?!#)/i.test(text) || /@import|javascript:/i.test(text)) {
    throw new IconError('The drawing may only refer to its own parts (href="#id", url(#id)).');
  }

  let rendered;
  try {
    rendered = new Resvg(text, { fitTo: { mode: 'width', value: STORE_ICON_SIZE }, font: { loadSystemFonts: false } }).render();
  } catch (err) {
    throw new IconError(`The drawing is not valid SVG: ${(err as Error).message.slice(0, 200)}`);
  }
  if (rendered.width !== STORE_ICON_SIZE || rendered.height !== STORE_ICON_SIZE) {
    throw new IconError('The drawing must be square: use viewBox="0 0 1024 1024".');
  }
  // An icon has no see-through parts; iOS cuts the corners round itself.
  const pixels = rendered.pixels;
  const last = STORE_ICON_SIZE - 1;
  const alphaAt = (x: number, y: number) => pixels[(y * STORE_ICON_SIZE + x) * 4 + 3]!;
  const corners = [alphaAt(0, 0), alphaAt(last, 0), alphaAt(0, last), alphaAt(last, last), alphaAt(STORE_ICON_SIZE >> 1, STORE_ICON_SIZE >> 1)];
  if (corners.some((alpha) => alpha < 255)) {
    throw new IconError('The background must fill the whole square, corners included: start with <rect width="1024" height="1024" fill="…"/> and do not round it.');
  }
  return Buffer.from(rendered.asPng());
}

// The colours of the app tiles in the clients, so an app without a drawn icon still looks like itself.
const COLORS = ['#ed6b1a', '#e34578', '#8c5cde', '#29999e', '#3880e6', '#4fa654'];

/** A simple icon made from the project's id alone: one of six colours and one of four plain motifs. */
export function defaultIconSvg(projectId: string): string {
  const seed = crypto.createHash('sha256').update(projectId).digest();
  const color = COLORS[seed[0]! % COLORS.length]!;
  const motifs = [
    // A sun: a disc with a ring around it.
    '<circle cx="512" cy="512" r="170" fill="#fff"/><circle cx="512" cy="512" r="290" fill="none" stroke="#fff" stroke-width="56" opacity="0.55"/>',
    // Steps: three bars growing to the right.
    '<rect x="252" y="560" width="140" height="210" rx="44" fill="#fff" opacity="0.7"/><rect x="442" y="410" width="140" height="360" rx="44" fill="#fff" opacity="0.85"/><rect x="632" y="254" width="140" height="516" rx="44" fill="#fff"/>',
    // Four tiles, one of them standing out.
    '<rect x="262" y="262" width="220" height="220" rx="60" fill="#fff"/><rect x="542" y="262" width="220" height="220" rx="60" fill="#fff" opacity="0.6"/><rect x="262" y="542" width="220" height="220" rx="60" fill="#fff" opacity="0.6"/><rect x="542" y="542" width="220" height="220" rx="60" fill="#fff" opacity="0.85"/>',
    // Two pills leaning the same way.
    '<g transform="rotate(-35 512 512)"><rect x="232" y="352" width="560" height="140" rx="70" fill="#fff"/><rect x="302" y="552" width="420" height="140" rx="70" fill="#fff" opacity="0.65"/></g>',
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.82"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
<rect width="1024" height="1024" fill="#fff"/><rect width="1024" height="1024" fill="url(#g)"/>
${motifs[seed[1]! % motifs.length]}
</svg>`;
}
