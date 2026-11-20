// The mascot: the app tile from the logo, standing in its pose or dancing.
// Drawn on the logo's 32-unit grid; the same figure and the same dance as ios/Sources/Mascot.swift.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

type Point = [number, number];

// The four limbs of the logo's pose, from the tile outwards.
const ARM_UP: Point[] = [[21.5, 12.5], [24.5, 9.8], [27.4, 7.2]];
const ARM_BENT: Point[] = [[11, 13.5], [5.8, 15.6], [6.6, 11.2]];
const LEG_STANDING: Point[] = [[13.4, 18], [12.6, 22.6], [13.4, 27.2], [10.6, 27.2]];
const LEG_KICKING: Point[] = [[18, 18.5], [20.8, 23.2], [25.8, 21.8], [25.8, 21.8]];

const mirrored = (limb: Point[]): Point[] => limb.map(([x, y]) => [32 - x, y]);

/** Each limb on its way to what the limb on the other side does in the logo. */
const LIMBS: Array<[Point[], Point[]]> = [
  [ARM_UP, mirrored(ARM_BENT)],
  [ARM_BENT, mirrored(ARM_UP)],
  [LEG_STANDING, mirrored(LEG_KICKING)],
  [LEG_KICKING, mirrored(LEG_STANDING)],
];

/** Where the mascot is in its dance. */
export interface MascotPose {
  /** 0 is the pose of the logo, 1 its mirror image: the other arm in the air, the other leg kicking. */
  swing: number;
  /** How high off the ground it is, in hops: 1 is the small hop between two poses. */
  lift: number;
  /** 0 with the eyes open, 1 with them shut. */
  blink: number;
  /** 1 facing us, -1 facing away, and everything between while it spins on the spot. */
  turn: number;
}

const LOGO: MascotPose = { swing: 0, lift: 0, blink: 0, turn: 1 };
const BEAT = 1.15;
const BLINK_EVERY = 3.4;

/**
 * The dance goes in phrases of four beats: the swing, a row of jumps, the swing again, a pirouette.
 * Every phrase starts and ends in the logo's pose, so one move flows into the next.
 */
export function mascotPose(time: number): MascotPose {
  const phrase = BEAT * 4;
  const local = (time % phrase) / phrase;
  const angle = (time / BEAT) * 2 * Math.PI;
  // A sine that lingers at both ends, so each pose is held for a moment before the swap.
  const wave = (1 - Math.cos(angle)) / 2;
  const swung = wave * wave * (3 - 2 * wave);
  const blink = time % BLINK_EVERY < 0.13 ? 1 : 0;
  switch (Math.floor(time / phrase) % 4) {
    case 1:
      // Jumps: both arms half-way up, straight up and down.
      return { swing: 0.5 * Math.min(1, local / 0.12, (1 - local) / 0.12), lift: Math.abs(Math.sin(angle)) ** 0.8 * 2.2, blink, turn: 1 };
    case 3:
      // A pirouette: the swing goes on while it turns around twice.
      return { swing: swung, lift: Math.abs(Math.sin(angle)) ** 3, blink, turn: Math.cos(local * 4 * Math.PI) };
    default:
      return { swing: swung, lift: Math.abs(Math.sin(angle)) ** 3, blink, turn: 1 };
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

function limbsPath(swing: number): string {
  return LIMBS.map(([from, to]) => 'M' + from.map(([x, y], i) => `${round(x + (to[i]![0] - x) * swing)} ${round(y + (to[i]![1] - y) * swing)}`).join('L')).join('');
}

const hopOf = (pose: MascotPose) => `translate(0 ${round(-pose.lift * 1.3)})`;
// Turning on the spot: the figure narrows to nothing and widens again as its mirror image.
const turnOf = (pose: MascotPose) => {
  const width = Math.abs(pose.turn) < 0.03 ? (pose.turn < 0 ? -0.03 : 0.03) : pose.turn;
  return `translate(16 0) scale(${round(width)} 1) translate(-16 0)`;
};
// The tile leans into the step: ten degrees one way in the logo, ten the other in its mirror image.
const leanOf = (pose: MascotPose) => `rotate(${round(10 * (1 - 2 * pose.swing))})`;
const eyeOf = (pose: MascotPose) => 3 * (1 - 0.85 * pose.blink);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

interface Props {
  dancing?: boolean;
  /** The tile and its arms and legs; the eyes. Any CSS colour. */
  tile?: string;
  eyes?: string;
  className?: string;
}

/** Decoration: what it stands next to says what is going on. */
export function Mascot({ dancing = false, tile = 'var(--accent)', eyes = '#fff', className }: Props) {
  // The hook is called on every render, whether the mascot dances or not: React needs the same hooks each time.
  const reduced = useReducedMotion();
  const moves = dancing && !reduced;
  const hop = useRef<SVGGElement>(null);
  const turn = useRef<SVGGElement>(null);
  const limbs = useRef<SVGPathElement>(null);
  const lean = useRef<SVGGElement>(null);

  // The figure is moved by setting its attributes every frame, so a dance never re-renders the page.
  useEffect(() => {
    const show = (pose: MascotPose) => {
      hop.current?.setAttribute('transform', hopOf(pose));
      turn.current?.setAttribute('transform', turnOf(pose));
      limbs.current?.setAttribute('d', limbsPath(pose.swing));
      lean.current?.setAttribute('transform', leanOf(pose));
      const open = eyeOf(pose);
      for (const eye of lean.current?.querySelectorAll('.mascot-eye') ?? []) {
        eye.setAttribute('height', String(round(open)));
        eye.setAttribute('y', String(round(-0.9 - open / 2)));
      }
    };
    if (!moves) {
      show(LOGO);
      return;
    }
    let frame = 0;
    const step = () => {
      // The clock is shared, so every mascot on the page dances in step.
      show(mascotPose(Date.now() / 1000));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [moves]);

  return (
    <svg className={className ? `mascot ${className}` : 'mascot'} viewBox="0 0 32 32" aria-hidden="true">
      <g ref={hop}>
        <g ref={turn}>
          <path ref={limbs} d={limbsPath(0)} fill="none" stroke={tile} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <g transform="translate(16 12.5)">
            <g ref={lean} transform={leanOf(LOGO)}>
              <rect x="-6.5" y="-6.5" width="13" height="13" rx="3.6" fill={tile} />
              {[-3.05, 1.55].map((x) => (
                <rect key={x} className="mascot-eye" x={x} y="-2.4" width="1.5" height="3" rx="0.75" fill={eyes} />
              ))}
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

/** The mascot in white on the brand orange, as in the logo. */
export function MascotBadge({ dancing = false, className }: { dancing?: boolean; className?: string }) {
  return (
    <span className={className ? `mascot-badge ${className}` : 'mascot-badge'}>
      <Mascot dancing={dancing} tile="#fff" eyes="#c74005" />
    </span>
  );
}

/** One line at a time from a list, each pushing the last one out of the way. */
export function WaitingCaption({ lines, every = 3200 }: { lines: readonly string[]; every?: number }) {
  const [turn, setTurn] = useState(() => Math.floor(Date.now() / every));
  useEffect(() => {
    const timer = setInterval(() => setTurn(Math.floor(Date.now() / every)), 500);
    return () => clearInterval(timer);
  }, [every]);
  const line = lines[turn % lines.length] ?? '';
  return (
    <span className="caption">
      <span key={line} className="caption-line">
        {line}
      </span>
    </span>
  );
}

const CONFETTI_COLORS = ['#f57a24', '#d9500a', '#e34578', '#8c5cde', '#29999e', '#f2c230', '#4fa654'];
const CONFETTI_MS = 2400;

/** A burst of confetti from the top of the page, once every time `trigger` changes from what it was. */
export function Confetti({ trigger }: { trigger: number }) {
  const [burst, setBurst] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    // Not for the value the page happened to open with.
    if (first.current) {
      first.current = false;
      return;
    }
    setBurst(trigger);
    const timer = setTimeout(() => setBurst(0), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [trigger]);
  if (burst === 0) return null;
  return (
    <div className="confetti" key={burst} aria-hidden="true">
      {Array.from({ length: 48 }, (_, piece) => {
        // Made up from the piece's number, so the burst looks the same however often it is drawn.
        const noise = (salt: number) => {
          const mixed = Math.sin((piece * 97 + salt * 131) * 12.9898) * 43758.5453;
          return mixed - Math.floor(mixed);
        };
        const style = {
          '--x': `${round((noise(1) * 2 - 1) * 48)}vw`,
          '--fall': `${round(50 + noise(2) * 40)}vh`,
          '--spin': `${round((noise(4) * 2 - 1) * 1080)}deg`,
          '--size': `${round(7 + noise(3) * 7)}px`,
          background: CONFETTI_COLORS[piece % CONFETTI_COLORS.length],
          animationDelay: `${round(noise(5) * 0.15)}s`,
        } as CSSProperties;
        return <i key={piece} style={style} />;
      })}
    </div>
  );
}
