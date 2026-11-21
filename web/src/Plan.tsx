// The person's plan: what it holds, how much of it is used, and a way to ask for a larger one.
// There is no payment yet: asking sends a request, and the people who run the service answer it.
import { useEffect, useRef, useState } from 'react';
import { PLAN_ORDER, type PlanId, type PlanLimits, type PlanState } from '../../shared/protocol';
import { ApiError, api, type PlanPerson } from './api';
import { apiErrorText, lang, t } from './i18n';
import { Mascot } from './Mascot';

/** What a plan holds, as lines to read. */
function lines(limits: PlanLimits): string[] {
  const text = t.plan;
  return [
    (limits.apps === 1 ? text.oneApp : text.apps).replace('{n}', String(limits.apps)),
    text.messages.replace('{n}', String(limits.messages)),
    ...(limits.install ? [text.install] : []),
    ...(limits.store ? [text.store] : []),
  ];
}

export function PlanDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' });

  return (
    <dialog ref={dialog} className="sheet wide" aria-labelledby="plan-title" onClose={onClose}>
      <header className="sheet-head">
        <h2 id="plan-title">{text.title}</h2>
        <button className="btn ghost" onClick={() => dialog.current?.close()}>
          {t.dismiss}
        </button>
      </header>
      <div className="sheet-body">
        {!plan && !error && <Mascot dancing className="big" />}
        {plan && (
          <>
            {!plan.enforced && <p className="notice">{text.open}</p>}
            <div className="plan-used">
              <Used label={text.usedMessages} used={plan.used.messages} of={plan.limits.messages} />
              <Used label={text.usedApps} used={plan.used.apps} of={plan.limits.apps} />
              <p className="muted fine">{text.resets.replace('{date}', date.format(plan.resetsAt))}</p>
            </div>
            <ul className="plans">
              {PLAN_ORDER.map((id) => {
                const mine = id === plan.plan;
                const larger = PLAN_ORDER.indexOf(id) > PLAN_ORDER.indexOf(plan.plan);
                return (
                  <li key={id} data-mine={mine}>
                    <h3>
                      {text.name[id]} {mine && <span className="plan-mine">{text.mine}</span>}
                    </h3>
                    <ul>
                      {lines(plan.plans[id]).map((line) => (
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
  const [state, setState] = useState<{ enforced: boolean; defaultPlan: PlanId; people: PlanPerson[] } | null>(null);
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PlanId>('create');
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

  const asking = state.people.filter((p) => p.requested);
  return (
    <section>
      <h2>{text.operatorTitle}</h2>
      <p className="muted">{state.enforced ? text.operatorOn : text.operatorOff}</p>
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="plan-people">
        <summary>{text.everyone.replace('{n}', String(state.people.length))}</summary>
        <table>
          <thead>
            <tr>
              <th>{t.email}</th>
              <th>{text.column}</th>
              <th>{text.usedApps}</th>
              <th>{text.usedMessages}</th>
            </tr>
          </thead>
          <tbody>
            {state.people.map((p) => (
              <tr key={p.userId}>
                <td>{p.email}</td>
                <td>{text.name[(p.plan as PlanId | null) ?? state.defaultPlan] ?? p.plan}</td>
                <td>{p.apps}</td>
                <td>{p.messages}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
