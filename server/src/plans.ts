// Plans: what a person may do, counted against what they have used. There is no payment here yet. A
// person asks for a plan, and the people who run the service give it to them; a payment provider
// can later call `give` in their place.
import { PLANS, isPlanId, planFor, type PlanAccess, type PlanId, type PlanNeed, type PlanState } from '../../shared/protocol';
import { config } from './config';
import * as db from './db';
import { isOperator } from './routing';

/** The plan of a person who has not been given one. */
export const defaultPlan: PlanId = isPlanId(config.defaultPlan) ? config.defaultPlan : 'free';
const fallback = defaultPlan;

/** The person's plan. The people who run the service have the largest one. */
export function planOf(user: db.User): PlanId {
  if (isOperator(user.email)) return 'publish';
  const given = db.getPlan(user.id);
  return isPlanId(given) ? given : fallback;
}

function used(user: db.User): { apps: number; messages: number } {
  return { apps: db.listProjects(user.id).length, messages: db.messagesThisMonth(user.id) };
}

/** The first moment of next month (UTC), when the count of messages starts over. */
function nextMonth(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

export function state(user: db.User): PlanState {
  const plan = planOf(user);
  const requested = db.getPlanRequest(user.id);
  return {
    enforced: config.paywall,
    plan,
    limits: PLANS[plan],
    used: used(user),
    requested: isPlanId(requested) ? requested : undefined,
    resetsAt: nextMonth(),
    plans: PLANS,
  };
}

/**
 * Whether the person's plan lets them do this now. Always true while plans are off, and for the
 * people who run the service, who are not counted.
 */
export function allows(user: db.User, need: PlanNeed): boolean {
  if (!config.paywall || isOperator(user.email)) return true;
  const limits = PLANS[planOf(user)];
  if (need === 'install') return limits.install;
  if (need === 'store') return limits.store;
  const now = used(user);
  return need === 'apps' ? now.apps < limits.apps : now.messages < limits.messages;
}

/** What the open project needs to know about its owner's plan. */
export function access(user: db.User | null): PlanAccess {
  const plan = user ? planOf(user) : fallback;
  const open = !config.paywall || (user !== null && isOperator(user.email));
  return { id: plan, install: open || PLANS[plan].install, store: open || PLANS[plan].store };
}

export type AskResult = 'asked' | 'not_larger';

/** The person asks for a larger plan. Asking again changes what they ask for. */
export function ask(user: db.User, plan: PlanId): AskResult {
  const order = Object.keys(PLANS);
  if (order.indexOf(plan) <= order.indexOf(planOf(user))) return 'not_larger';
  db.requestPlan(user.id, plan);
  console.log(`[plans] user ${user.id} asks for the plan "${plan}"`);
  return 'asked';
}

/** Gives a person a plan. Null when nobody has that email. */
export function give(email: string, plan: PlanId, by: string): db.User | null {
  const user = db.userByEmail(email);
  if (!user) return null;
  db.setPlan(user.id, plan);
  console.log(`[plans] user ${user.id} was given the plan "${plan}" by ${by}`);
  return user;
}

/** The plan that would let the person past the limit they ran into, for saying which one to ask for. */
export function needed(user: db.User, need: PlanNeed): PlanId | null {
  return planFor(need, used(user));
}
