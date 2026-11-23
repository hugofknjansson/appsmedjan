// The machines that make an app, each with a job of its own: while an app is built they are on the
// page side by side, and the person sees several of them at work on it at once. The same board as
// ios/Sources/Crew.swift.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { MACHINES, machineStates, type Machine, type RunProgress } from '../../shared/protocol';
import { t } from './i18n';

export const MACHINE_COLORS: Record<Machine, string> = {
  planner: '#ed9e0d',
  designer: '#e34578',
  coder: '#8c5cde',
  painter: '#29999e',
  builder: '#3880e6',
  tester: '#4fa654',
};

/** A machine's picture: a few strokes in the colour of the text around it. */
export function MachineIcon({ machine }: { machine: Machine }) {
  const shapes: Record<Machine, ReactNode> = {
    planner: (
      <>
        <path d="M9 18h6M10 21h4" />
        <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" fill="currentColor" stroke="none" />
      </>
    ),
    designer: (
      <>
        <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" fill="currentColor" stroke="none" />
        <circle cx="7.5" cy="11" r="1.4" fill="#fff" stroke="none" />
        <circle cx="10.5" cy="7" r="1.4" fill="#fff" stroke="none" />
        <circle cx="15" cy="7.5" r="1.4" fill="#fff" stroke="none" />
      </>
    ),
    coder: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
    painter: (
      <>
        <path d="M20.5 3.5c-3 1-7.6 5.2-9.3 7.6l2.2 2.2c2.4-1.7 6.6-6.3 7.1-9.8z" fill="currentColor" stroke="none" />
        <path d="M10 12.5c-2.6 0-4 1.8-4 3.7 0 1.6-1 2.6-2.5 2.8 1 1.3 2.7 2 4.3 2 2.6 0 4.6-2 4.6-4.4z" fill="currentColor" stroke="none" />
      </>
    ),
    builder: (
      <>
        <rect x="4" y="4" width="16" height="7" rx="2" />
        <rect x="4" y="13" width="16" height="7" rx="2" />
        <path d="M8 7.5h.01M8 16.5h.01M12 7.5h5M12 16.5h5" />
      </>
    ),
    tester: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
        <path d="M10.5 18.5h3" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shapes[machine]}
    </svg>
  );
}

/** The machines at work on the app, in two rows on the orange. They start up one after the other when the board appears. */
export function CrewBoard({ progress, done }: { progress: RunProgress; done: boolean }) {
  const states = machineStates(progress, done);
  const [started, setStarted] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? MACHINES.length : 0));

  useEffect(() => {
    if (started >= MACHINES.length) return;
    const timer = window.setTimeout(() => setStarted((n) => n + 1), started === 0 ? 350 : 140);
    return () => window.clearTimeout(timer);
  }, [started]);

  const heading = done ? t.crew.allDone : started < MACHINES.length ? t.crew.starting : t.crew.working;
  const doing = (machine: Machine) =>
    machine === 'coder' && progress.pieces > 0 ? t.crew.written(progress.pieces) : t.crew.doing[machine];

  return (
    <div className="crew">
      <p className="crew-heading" data-live={!done || undefined}>
        <i aria-hidden="true" />
        <span key={heading}>{heading}</span>
      </p>
      <ul>
        {MACHINES.map((machine, index) => {
          const state = states[machine];
          return (
            <li
              key={machine}
              className="machine"
              data-state={state}
              data-on={index < started || undefined}
              style={{ '--machine': MACHINE_COLORS[machine], '--offset': `${-index * 0.37}s` } as CSSProperties}
            >
              <span className="machine-tile">
                <MachineIcon machine={machine} />
                {state === 'done' && <b className="machine-tick" aria-hidden="true">✓</b>}
              </span>
              <strong>{t.crew.names[machine]}</strong>
              <span className="machine-status" key={state}>
                {state === 'waiting' ? t.crew.waiting : state === 'done' ? t.crew.done : doing(machine)}
              </span>
              <span className="machine-shine" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
