// The person's plan: what it holds, how much of it is used, and a way to ask for a larger one.
// For someone whose plan lets them build nothing this is the paywall: what they get, what it
// costs, and a field for a code that lets them past it.
// Where credits are counted, it shows how many are left and what the latest messages cost.
// There is no payment yet: asking sends a request, and the people who run the service answer it.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PLAN_ORDER, type CreditState, type PlanId, type PlanLimits, type PlanState } from '../../shared/protocol';
import { ApiError, api, type PlanPerson } from './api';
import { apiErrorText, lang, t } from './i18n';
import { Mascot } from './Mascot';

/** What a plan holds, as lines to read: its credits where credits are counted, otherwise its messages. */
function lines(limits: PlanLimits, credits: boolean): string[] {
  const text = t.plan;
  return [
    (limits.apps === 1 ? text.oneApp : text.apps).replace('{n}', String(limits.apps)),
    credits
      ? (limits.creditsOnce ? text.creditsOnce : text.credits).replace('{n}', String(limits.credits))
      : text.messages.replace('{n}', String(limits.messages)),
    ...(limits.install ? [text.install] : []),
    ...(limits.store ? [text.store] : []),
  ];
}

/** `onUnlock` is called when a code has let the person past the paywall, after the dialog has closed. */
export function PlanDialog({ onClose, onUnlock }: { onClose: () => void; onUnlock?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const text = t.plan;

  useEffect(() => {
    dialog.current?.showModal();
    api.plan().then(setPlan).catch((err) => setError(apiErrorText(err instanceof ApiError ? err.code : 'internal')));
  }, []);

  async function ask(id: PlanId) {
    setBusy(true);
    setError('');
    try {
      setPlan(await api.requestPlan(id));
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const wasLocked = plan?.locked === true;
      const now = await api.unlockPlan(code.trim());
      setPlan(now);
      setCode('');
      // Past the paywall: back to what the person was about to do.
      if (wasLocked && !now.locked) {
        dialog.current?.close();
        onUnlock?.();
      }
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    } finally {
      setBusy(false);
    }
  }

  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' });
  const locked = plan?.locked === true;

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="plan-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="plan-title">{locked ? text.lockedTitle : text.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>
      <div className="sheet-body">
        {!plan && !error && <Mascot dancing className="big" />}
        {plan && (
          <>
            {!plan.enforced && <p className="notice">{text.open}</p>}
            {locked ? (
              <div className="plan-pitch">
                <Mascot dancing tile="#fff" eyes="#c74005" />
                <strong>{text.pitch}</strong>
                <p>{text.pitchText}</p>
              </div>
            ) : plan.credits ? (
              <Credits credits={plan.credits} apps={plan.used.apps} maxApps={plan.limits.apps} date={date} />
            ) : (
              <div className="plan-used">
                <Used label={text.usedMessages} used={plan.used.messages} of={plan.limits.messages} />
                <Used label={text.usedApps} used={plan.used.apps} of={plan.limits.apps} />
                <p className="muted fine">{text.resets.replace('{date}', date.format(plan.resetsAt))}</p>
              </div>
            )}
            <ul className="plans">
              {/* A plan that holds nothing is the paywall itself, not something to choose. */}
              {PLAN_ORDER.filter((id) => plan.plans[id].apps > 0).map((id) => {
                const mine = id === plan.plan;
                const larger = PLAN_ORDER.indexOf(id) > PLAN_ORDER.indexOf(plan.plan);
                return (
                  <li key={id} data-mine={mine}>
                    <h3>
                      {text.name[id]} {mine && <span className="plan-mine">{text.mine}</span>}
                      {plan.prices?.[id] && <span className="plan-price">{plan.prices[id]}</span>}
                    </h3>
                    <ul>
                      {lines(plan.plans[id], plan.credits !== undefined).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    {larger &&
                      (plan.requested === id ? (
                        <p className="notice">{text.asked}</p>
                      ) : (
                        <button className="btn primary" disabled={busy} onClick={() => void ask(id)}>
                          {text.ask.replace('{plan}', text.name[id])}
                        </button>
                      ))}
                  </li>
                );
              })}
            </ul>
            {plan.takesCode && plan.plan !== PLAN_ORDER.at(-1) && (
              <form className="plan-code" onSubmit={unlock}>
                <label htmlFor="plan-code">{text.code}</label>
                <div>
                  <input id="plan-code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={text.codeHint} value={code} onChange={(e) => setCode(e.target.value)} />
                  <button className="btn primary" disabled={busy || !code.trim()}>
                    {text.unlock}
                  </button>
                </div>
              </form>
            )}
            <p className="muted fine">{text.noPayment}</p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}

const creditCount = (n: number) => (n === 1 ? t.plan.oneCredit : t.plan.creditCount.replace('{n}', String(n)));

/** How many credits are left, when some of them run out, and what the latest messages cost. */
function Credits({ credits, apps, maxApps, date }: { credits: CreditState; apps: number; maxApps: number; date: Intl.DateTimeFormat }) {
  const text = t.plan;
  const when = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  return (
    <div className="plan-used">
      <p className="plan-balance">
        <span>{text.creditsLeft}</span>
        <strong>{credits.balance}</strong>
      </p>
      {credits.expiring && credits.expiring.amount > 0 && (
        <p className="muted fine">{text.creditsExpire.replace('{n}', String(credits.expiring.amount)).replace('{date}', date.format(credits.expiring.at))}</p>
      )}
      <Used label={text.usedApps} used={apps} of={maxApps} />
      <p className="muted fine">{text.creditsWhat.replace('{max}', creditCount(credits.maxPerMessage))}</p>
      {credits.recent.length > 0 && (
        <details className="plan-recent">
          <summary>{text.recent}</summary>
          <ul>
            {credits.recent.map((spend) => (
              <li key={`${spend.at}-${spend.what}`}>
                <span>
                  {spend.what === 'listing' ? text.spendListing : text.spendBuild}
                  {spend.app && <span className="muted"> · {spend.app}</span>}
                  <span className="muted"> · {when.format(spend.at)}</span>
                </span>
                <strong>{creditCount(spend.credits)}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Used({ label, used, of }: { label: string; used: number; of: number }) {
  return (
    <label className="plan-meter">
      <span>
        {label} <strong>{t.plan.usedOf.replace('{used}', String(used)).replace('{of}', String(of))}</strong>
      </span>
      <progress value={Math.min(used, of)} max={of} />
    </label>
  );
}

/** For the people who run the service: who has asked for a plan, and a way to give anyone one. */
export function OperatorPlans() {
  const [state, setState] = useState<{ enforced: boolean; credits?: boolean; defaultPlan: PlanId; people: PlanPerson[] } | null>(null);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PlanId>('create');
  const [creditsTo, setCreditsTo] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const text = t.plan;

  // Only the people who run the service get an answer; for everyone else there is nothing to show.
  useEffect(() => {
    api.operatorPlans().then(setState).catch(() => undefined);
  }, []);
  if (!state) return null;

  async function give(to: string, id: PlanId) {
    setError('');
    try {
      setState(await api.givePlan(to, id));
      setEmail('');
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'bad_plan' ? text.noSuchPerson : apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    }
  }

  async function giveCredits() {
    setError('');
    try {
      setState(await api.giveCredits(creditsTo, Number(amount)));
      setCreditsTo('');
      setAmount('');
    } catch (err) {
      setError(apiErrorText(err instanceof ApiError ? err.code : 'internal'));
    }
  }

  const asking = state.people.filter((p) => p.requested);
  return (
    <section>
      <h2>{text.operatorTitle}</h2>
      <p className="muted">
        {state.enforced ? text.operatorOn : text.operatorOff} {state.credits && text.operatorCredits}
      </p>
      {asking.length > 0 && (
        <ul className="requests">
          {asking.map((p) => (
            <li key={p.userId} className="plan-request">
              <span>
                <strong>{p.email}</strong> {text.asksFor.replace('{plan}', text.name[p.requested as PlanId] ?? String(p.requested))}
              </span>
              <button className="btn primary" onClick={() => void give(p.email, p.requested as PlanId)}>
                {text.give}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="plan-give"
        onSubmit={(e) => {
          e.preventDefault();
          void give(email, plan);
        }}
      >
        <input type="email" required placeholder={t.email} aria-label={t.email} value={email} onChange={(e) => setEmail(e.target.value)} />
        <select aria-label={text.column} value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
          {PLAN_ORDER.map((id) => (
            <option key={id} value={id}>
              {text.name[id]}
            </option>
          ))}
        </select>
        <button className="btn">{text.give}</button>
      </form>
      {state.credits && (
        <form
          className="plan-give"
          onSubmit={(e) => {
            e.preventDefault();
            void giveCredits();
          }}
        >
          <input type="email" required placeholder={t.email} aria-label={t.email} value={creditsTo} onChange={(e) => setCreditsTo(e.target.value)} />
          <input type="number" required min={1} max={100000} step={1} placeholder={text.amount} aria-label={text.amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn">{text.giveCredits}</button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="plan-people">
        <summary>{text.everyone.replace('{n}', String(state.people.length))}</summary>
        <p className="muted fine">{text.operatorDollars}</p>
        <table>
          <thead>
            <tr>
              <th>{t.email}</th>
              <th>{text.column}</th>
              <th>{text.usedApps}</th>
              <th>{text.usedMessages}</th>
              {state.credits && <th>{text.creditsColumn}</th>}
              <th>{text.dollarsColumn}</th>
            </tr>
          </thead>
          <tbody>
            {state.people.map((p) => (
              <tr key={p.userId}>
                <td>{p.email}</td>
                <td>{text.name[(p.plan as PlanId | null) ?? state.defaultPlan] ?? p.plan}</td>
                <td>{p.apps}</td>
                <td>{p.messages}</td>
                {state.credits && <td>{p.credits ?? 0}</td>}
                <td>{p.dollars !== undefined ? `$${p.dollars.toFixed(2)}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
