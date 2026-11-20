// The mascot: the app tile from the logo, standing in its pose or dancing.
// Drawn on the logo's 32-unit grid; the same figure and the same dance as ios/Sources/Mascot.swift.
import { useEffect, useState } from 'react';

type Point = [number, number];

// The four limbs of the logo's pose, from the tile outwards.
const ARM_UP: Point[] = [[21.5, 12.5], [24.5, 9.8], [27.4, 7.2]];
const ARM_BENT: Point[] = [[11, 13.5], [5.8, 15.6], [6.6, 11.2]];
const LEG_STANDING: Point[] = [[13.4, 18], [12.6, 22.6], [13.4, 27.2], [10.6, 27.2]];
const LEG_KICKING: Point[] = [[18, 18.5], [20.8, 23.2], [25.8, 21.8], [25.8, 21.8]];

const mirrored = (limb: Point[]): Point[] => limb.map(([x, y]) => [Math.round((32 - x) * 10) / 10, y]);
const path = (limbs: Point[][]) => limbs.map((limb) => 'M' + limb.map(([x, y]) => `${x} ${y}`).join('L')).join('');

/** The logo's pose, and its mirror image: each limb doing what the one on the other side did. */
const POSE = path([ARM_UP, ARM_BENT, LEG_STANDING, LEG_KICKING]);
const MIRROR = path([mirrored(ARM_BENT), mirrored(ARM_UP), mirrored(LEG_KICKING), mirrored(LEG_STANDING)]);

const BEAT = '1.15s';
const BLINK = '3.4s';
// Lingers at both ends, so each pose is held for a moment before the swap.
const HOLD = '0.7 0 0.3 1';

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
  const moves = dancing && !useReducedMotion();
  const loop = { dur: BEAT, repeatCount: 'indefinite' } as const;
  const eased = { calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: `${HOLD};${HOLD}` } as const;
  return (
    <svg className={className ? `mascot ${className}` : 'mascot'} viewBox="0 0 32 32" aria-hidden="true">
      <g>
        {/* A hop at each swap, between the two poses. */}
        {moves && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0;0 -1.3;0 0;0 -1.3;0 0"
            keyTimes="0;0.25;0.5;0.75;1"
            calcMode="spline"
            keySplines="0.3 0 0.7 1;0.3 0 0.7 1;0.3 0 0.7 1;0.3 0 0.7 1"
            {...loop}
          />
        )}
        <path d={POSE} fill="none" stroke={tile} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          {moves && <animate attributeName="d" values={`${POSE};${MIRROR};${POSE}`} {...eased} {...loop} />}
        </path>
        <g transform="translate(16 12.5)">
          {/* The tile leans into the step: ten degrees one way in the logo, ten the other in its mirror image. */}
          <g transform="rotate(10)">
            {moves && <animateTransform attributeName="transform" type="rotate" values="10;-10;10" {...eased} {...loop} />}
            <rect x="-6.5" y="-6.5" width="13" height="13" rx="3.6" fill={tile} />
            {[-3.05, 1.55].map((x) => (
              <rect key={x} x={x} y="-2.4" width="1.5" height="3" rx="0.75" fill={eyes}>
                {moves && <animate attributeName="height" values="3;3;0.45;3" keyTimes="0;0.955;0.98;1" dur={BLINK} repeatCount="indefinite" />}
                {moves && <animate attributeName="y" values="-2.4;-2.4;-1.125;-2.4" keyTimes="0;0.955;0.98;1" dur={BLINK} repeatCount="indefinite" />}
              </rect>
            ))}
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
