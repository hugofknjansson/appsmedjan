// What App Dance does, shown before anyone is asked for an e-mail address: a short film that plays by
// itself. An idea is written, the machines build it into a phone, and the app is there to press. The
// same film as ios/Sources/Intro.swift.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { MACHINES } from '../../shared/protocol';
import { MACHINE_COLORS, MachineIcon } from './Crew';
import { Confetti } from './Mascot';
import { t } from './i18n';

/** How long each scene plays, in milliseconds. */
const LENGTHS = [3400, 4600, 3600];
/** How many parts the app on the phone is put together from: its name, three rows and a button. */
const PARTS = 5;
/** The stage is laid out at this size, and scaled to fit the room there is. */
const STAGE = { width: 420, height: 470 };
const PHONE = { width: 158, height: 316 };
const MIDDLE = { x: STAGE.width / 2, y: STAGE.height / 2 };
const EXAMPLE_COLORS = ['#4fa654', '#8c5cde', '#3880e6'];
const EXAMPLE_SYMBOLS = ['🌿', '🏆', '🧳'];

/** Three machines on each side of the phone. */
const PLACES = [-110, 0, 110].flatMap((y) => [-1, 1].map((side) => ({ x: MIDDLE.x + side * (PHONE.width / 2 + 52), y: MIDDLE.y + y })));
// In the order of the machines: the left column top to bottom, then the right.
const MACHINE_PLACES = [PLACES[0]!, PLACES[2]!, PLACES[4]!, PLACES[1]!, PLACES[3]!, PLACES[5]!];

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Intro({ onStart }: { onStart: (isNew: boolean) => void }) {
  const [scene, setScene] = useState(0);
  const [round, setRound] = useState(0);
  const [typed, setTyped] = useState(0);
  const [built, setBuilt] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [cheers, setCheers] = useState(0);
  const example = t.intro.examples[round % t.intro.examples.length]!;
  const color = EXAMPLE_COLORS[round % EXAMPLE_COLORS.length]!;

  function advance() {
    if (scene === 2) {
      setScene(0);
      setRound((r) => r + 1);
    } else {
      setScene(scene + 1);
    }
  }

  // Plays the scene through, then goes on to the next one.
  useEffect(() => {
    const timers: number[] = [];
    const later = (ms: number, then: () => void) => timers.push(window.setTimeout(then, ms));
    const reduced = reducedMotion();
    if (scene === 0) {
      setBuilt(0);
      setPressed(false);
      if (reduced) {
        setTyped(example.idea.length);
      } else {
        setTyped(0);
        // Written out in about one and a half seconds, however long the idea is.
        const step = Math.max(1, Math.round(example.idea.length / 45));
        later(350, () => {
          const typing = window.setInterval(() => {
            setTyped((n) => {
              if (n + step >= example.idea.length) window.clearInterval(typing);
              return Math.min(example.idea.length, n + step);
            });
          }, 32);
          timers.push(typing);
        });
      }
    } else if (scene === 1) {
      setTyped(example.idea.length);
      for (let part = 1; part <= PARTS; part++) later((reduced ? 0 : 700) + (part - 1) * 480, () => setBuilt(part));
    } else {
      setBuilt(PARTS);
      later(900, () => {
        setPressed(true);
        setCheers((n) => n + 1);
      });
    }
    later(LENGTHS[scene]!, advance);
    return () => timers.forEach((timer) => (window.clearTimeout(timer), window.clearInterval(timer)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, round]);

  const words = t.intro.scenes[scene]!;

  return (
    <main className="intro">
      <div className="intro-bars" aria-label={t.intro.step.replace('{n}', String(scene + 1))} role="img">
        {LENGTHS.map((length, index) => (
          <span key={index}>
            <i
              key={`${round}-${scene}`}
              data-fill={index < scene ? 'full' : index === scene ? 'now' : undefined}
              style={{ '--length': `${length}ms` } as CSSProperties}
            />
          </span>
        ))}
      </div>

      <button type="button" className="intro-stage" onClick={advance} aria-label={t.intro.next}>
        <Stage scene={scene} typed={typed} built={built} pressed={pressed} idea={example.idea} name={example.name} rows={example.rows} color={color} symbol={EXAMPLE_SYMBOLS[round % EXAMPLE_SYMBOLS.length]!} />
      </button>

      <div className="intro-words" aria-live="polite">
        <h1 key={`t${scene}`}>{words.title}</h1>
        <p key={`p${scene}`}>{words.text}</p>
      </div>

      <div className="intro-actions">
        <button type="button" className="btn intro-start" onClick={() => onStart(true)}>
          {t.intro.start}
        </button>
        <button type="button" className="link intro-login" onClick={() => onStart(false)}>
          {t.intro.haveAccount}
        </button>
      </div>
      <Confetti trigger={cheers} />
    </main>
  );
}

interface StageProps {
  scene: number;
  typed: number;
  built: number;
  pressed: boolean;
  idea: string;
  name: string;
  rows: string[];
  color: string;
  symbol: string;
}

/** Where the film plays: the idea in a speech bubble, a phone, and the machines around it. */
function Stage({ scene, typed, built, pressed, idea, name, rows, color, symbol }: StageProps) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);

  // As large as the room there is: the stage is drawn at one size and scaled to fit.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setFit(Math.min(element.clientWidth / STAGE.width, element.clientHeight / STAGE.height, 1.3));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="stage-room" ref={box} aria-hidden="true">
      <div className="stage" data-scene={scene} style={{ width: STAGE.width, height: STAGE.height, transform: `translate(-50%, -50%) scale(${fit})` }}>
        <Wires on={scene === 1} />
        <div className="intro-phone" style={{ '--app': color } as CSSProperties}>
          <div className="intro-screen">
            <span className="intro-island" />
            {built >= 1 && (
              <div className="intro-title intro-piece">
                <span>{symbol}</span>
                {name}
              </div>
            )}
            {rows.map(
              (row, index) =>
                built >= index + 2 && (
                  <div className="intro-row intro-piece" key={row} data-ticked={(index === 0 && pressed) || undefined}>
                    <i />
                    {row}
                  </div>
                ),
            )}
            {built >= PARTS && <div className="intro-add intro-piece">{t.intro.add}</div>}
          </div>
        </div>
        {MACHINES.map((machine, index) => (
          <div
            key={machine}
            className="intro-machine"
            style={{ left: MACHINE_PLACES[index]!.x, top: MACHINE_PLACES[index]!.y, '--machine': MACHINE_COLORS[machine], '--order': index } as CSSProperties}
          >
            <span>
              <MachineIcon machine={machine} />
            </span>
            {t.crew.jobs[machine]}
          </div>
        ))}
        <div className="intro-bubble">
          {idea.slice(0, typed)}
          {typed < idea.length && <i />}
        </div>
      </div>
    </div>
  );
}

/** Lines from the machines into the phone, with parcels on their way along each of them. */
function Wires({ on }: { on: boolean }) {
  const reduced = reducedMotion();
  return (
    <svg className="intro-wires" data-on={on || undefined} width={STAGE.width} height={STAGE.height} viewBox={`0 0 ${STAGE.width} ${STAGE.height}`}>
      {MACHINE_PLACES.map((place, index) => {
        const side = place.x < MIDDLE.x ? -1 : 1;
        // From the edge of the machine's round badge, which sits a little above the middle of it and its name.
        const start = { x: place.x - side * 30, y: place.y - 11 };
        const end = { x: MIDDLE.x + side * (PHONE.width / 2 - 4), y: MIDDLE.y + (place.y - MIDDLE.y) * 0.35 };
        const path = `M${start.x} ${start.y} L${end.x} ${end.y}`;
        return (
          <g key={index}>
            <path d={path} />
            {on &&
              !reduced &&
              [0, 0.5].map((lag) => (
                <rect key={lag} x={-3.5} y={-3.5} width={7} height={7} rx={2}>
                  <animateMotion dur="1.1s" repeatCount="indefinite" path={path} begin={`${-(index * 0.17 + lag) * 1.1}s`} />
                  <animate attributeName="opacity" values="0;1;0" dur="1.1s" repeatCount="indefinite" begin={`${-(index * 0.17 + lag) * 1.1}s`} />
                </rect>
              ))}
          </g>
        );
      })}
    </svg>
  );
}
