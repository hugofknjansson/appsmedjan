// Plans: what a person may do, counted against what they have used. There is no payment here yet. A
// person asks for a plan, and the people who run the service give it to them; a payment provider
// can later call `give` in their place.
import crypto from 'node:crypto';
import { PLANS, PLAN_ORDER, isPlanId, planFor, planPrices, unlockCodes, type PlanAccess, type PlanId, type PlanLimits, type PlanNeed, type PlanState, type TokenUse } from '../../shared/protocol';
import { config } from './config';
import * as credits from './credits';
import * as db from './db';
import { isOperator } from './routing';

/**
 * The plans as they are on this server: the smallest one holds what the operator has said it is to
 * hold, which may be nothing. Then it is a paywall: nothing is built before the person has a
 * larger plan, by paying or by giving a code.
 */
const plansHere: Record<PlanId, PlanLimits> = {
  free: { ...PLANS.free, apps: config.freeApps ?? PLANS.free.apps, messages: config.freeMessages ?? PLANS.free.messages, credits: credits.creditsOf('free') },
  create: { ...PLANS.create, credits: credits.creditsOf('create') },
  publish: { ...PLANS.publish, credits: credits.creditsOf('publish') },
};
const codes = unlockCodes(config.unlockCodes);
const prices = planPrices(config.planPrices);

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
    limits: plansHere[plan],
    used: used(user),
    requested: isPlanId(requested) ? requested : undefined,
    resetsAt: nextMonth(),
    plans: plansHere,
    locked: config.paywall && !isOperator(user.email) && plansHere[plan].apps === 0,
    takesCode: codes.length > 0,
    prices,
    credits: credits.counting() ? credits.state(user, plan) : undefined,
  };
}

/**
 * Whether the person's plan lets them do this now. Always true while plans are off, and for the
 * people who run the service, who are not counted.
 */
export function allows(user: db.User, need: PlanNeed): boolean {
  if (!config.paywall || isOperator(user.email)) return true;
  const limits = plansHere[planOf(user)];
  if (need === 'install') return limits.install;
  if (need === 'store') return limits.store;
  // Where credits are counted, a message needs credits left and the month's count of messages does not apply.
  if ((need === 'messages' || need === 'credits') && credits.counting()) return credits.balance(user, planOf(user)) >= 1;
  if (need === 'credits') return true;
  const now = used(user);
  return need === 'apps' ? now.apps < limits.apps : now.messages < limits.messages;
}

/** What a message runs into when the person may not send one: their credits, or the month's messages. */
export function messageNeed(): PlanNeed {
  return credits.counting() ? 'credits' : 'messages';
}

/** What the open project needs to know about its owner's plan. */
export function access(user: db.User | null): PlanAccess {
  const plan = user ? planOf(user) : fallback;
  const open = !config.paywall || (user !== null && isOperator(user.email));
  return { id: plan, install: open || plansHere[plan].install, store: open || plansHere[plan].store };
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
  return planFor(need, { ...used(user), credits: plansHere[planOf(user)].credits }, plansHere);
}

const sameCode = (a: string, b: string) => {
  const one = crypto.createHash('sha256').update(a).digest();
  const other = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(one, other);
};

/**
 * A code in place of paying: gives the person the plan the code stands for, unless theirs is as
 * large already. False when it is not one of the operator's codes.
 */
export function unlock(user: db.User, given: string): boolean {
  const code = given.trim();
  const match = codes.find((entry) => sameCode(entry.code, code));
  if (!match) return false;
  if (PLAN_ORDER.indexOf(match.plan) > PLAN_ORDER.indexOf(planOf(user))) {
    db.setPlan(user.id, match.plan);
    console.log(`[plans] user ${user.id} was given the plan "${match.plan}" by a code`);
  }
  return true;
}

/**
 * Records what a piece of work for the person cost and charges it where credits are counted. Null
 * when the person no longer exists.
 */
export function chargeWork(
  userId: string,
  work: { projectId: string | null; what: 'build' | 'listing'; uses: TokenUse[]; charge: boolean },
): { dollars: number; credits: number; charged: number } | null {
  const user = db.getUser(userId);
  return user ? credits.spend(user, planOf(user), work) : null;
}
