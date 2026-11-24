// Credits: where the service counts them in place of messages, a message to the builder costs what
// the model's work behind it cost. Every piece of work is recorded with its cost in dollars whether
// credits are counted or not, so the people who run the service can see what each person costs.
//
// A plan gives credits every calendar month, and they last until the end of the next month. The
// smallest plan gives its credits once, to start with. Credits given outside a plan, bought or
// handed out, last a year. Spending takes from the credits that run out first.
import { PLANS, allocateSpend, creditsFor, planCredits, tokenCost, type CreditState, type PlanId, type TokenUse } from '../../shared/protocol';
import { config } from './config';
import * as db from './db';
import { isOperator } from './routing';

const YEAR = 365 * 24 * 60 * 60 * 1000;

const creditsHere: Record<PlanId, number> = {
  free: PLANS.free.credits,
  create: PLANS.create.credits,
  publish: PLANS.publish.credits,
  ...planCredits(config.planCredits),
};

/** How many credits the plan gives on this server. */
export function creditsOf(plan: PlanId): number {
  return creditsHere[plan];
}

/** Whether credits are counted: plans must be on, and credits asked for. */
export function counting(): boolean {
  return config.paywall && config.credits;
}

const period = (now: Date) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

/** The first moment of the month after next (UTC): when a month's credits run out. */
function endOfNextMonth(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1);
}

/** Gives the person what their plan holds for this month, unless they have it already. */
function grantPlan(user: db.User, plan: PlanId, now = new Date()): void {
  const amount = creditsOf(plan);
  if (amount <= 0) return;
  if (PLANS[plan].creditsOnce) {
    db.topUpPeriod(user.id, 'once', plan, amount, null);
    return;
  }
  db.topUpPeriod(user.id, period(now), plan, amount, endOfNextMonth(now));
}

/** Credits the person can spend now. Their plan's credits for this month are given first, if they are due. */
export function balance(user: db.User, plan: PlanId): number {
  grantPlan(user, plan);
  return db.liveGrants(user.id).reduce((sum, g) => sum + g.left, 0);
}

/** What the plan page shows about credits. */
export function state(user: db.User, plan: PlanId): CreditState {
  const now = Date.now();
  const grants = (grantPlan(user, plan), db.liveGrants(user.id, now));
  const soon = endOfNextMonth(new Date(now));
  const expiring = grants.filter((g) => g.expiresAt !== null && g.expiresAt <= soon);
  const first = Math.min(...expiring.map((g) => g.expiresAt!));
  return {
    balance: grants.reduce((sum, g) => sum + g.left, 0),
    expiring: expiring.length > 0 ? { amount: expiring.reduce((sum, g) => sum + g.left, 0), at: first } : undefined,
    recent: db.recentSpends(user.id).map((s) => ({
      at: s.at,
      app: s.app ?? undefined,
      what: s.what === 'listing' ? 'listing' : 'build',
      credits: s.charged,
    })),
    maxPerMessage: config.maxCreditsPerMessage,
  };
}

/**
 * Records what a piece of work cost and, where credits are counted, takes them from the person: at
 * most the most a message costs, and never more than they have. Work the service itself failed to
 * finish (`charge: false`) is recorded and not charged. Returns the credits taken.
 */
export function spend(
  user: db.User,
  plan: PlanId,
  work: { projectId: string | null; what: 'build' | 'listing'; uses: TokenUse[]; charge: boolean },
): { dollars: number; credits: number; charged: number } {
  const dollars = tokenCost(work.uses);
  const credits = creditsFor(dollars, config.creditDollars);
  if (dollars <= 0) return { dollars, credits, charged: 0 };
  const due = counting() && work.charge && !isOperator(user.email) ? Math.min(credits, config.maxCreditsPerMessage) : 0;
  const now = Date.now();
  const takes = due > 0 ? (grantPlan(user, plan), allocateSpend(db.liveGrants(user.id, now), due, now)) : [];
  try {
    const charged = db.recordSpend({ userId: user.id, projectId: work.projectId, what: work.what, dollars, credits }, takes);
    return { dollars, credits, charged };
  } catch (err) {
    // The grants changed under the spend (another one at the same moment): record the cost, charge nothing.
    console.warn(`[credits] user ${user.id}: could not take ${due} credits (${(err as Error).message})`);
    db.recordSpend({ userId: user.id, projectId: work.projectId, what: work.what, dollars, credits }, []);
    return { dollars, credits, charged: 0 };
  }
}

/**
 * Gives credits outside a plan, lasting a year: what the people who run the service hand out, and
 * later what a payment buys. Null when nobody has that email.
 */
export function give(email: string, amount: number, by: string): db.User | null {
  const user = db.userByEmail(email);
  if (!user || !Number.isInteger(amount) || amount <= 0 || amount > 100_000) return null;
  db.addGrant(user.id, 'gift', amount, Date.now() + YEAR, by);
  console.log(`[credits] user ${user.id} was given ${amount} credits by ${by}`);
  return user;
}
