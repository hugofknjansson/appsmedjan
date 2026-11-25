// Paying for a plan, through Stripe.
//
// A person chooses a plan and pays for it on Stripe's own page (Checkout), as a monthly subscription.
// Stripe then tells the service about it (a webhook to /api/pay/webhook), and the person has the plan
// for as long as the subscription is alive. Changing plan, changing card and cancelling happen on
// Stripe's page for that (the customer portal), and reach the service the same way.
//
// The service never trusts what a webhook carries beyond which subscription it is about: it asks
// Stripe for the subscription as it is now and goes by that, so events that arrive late, twice or
// out of order do no harm.
//
// Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICES. Without them nobody can pay and
// plans are given by the people who run the service, as before.
import crypto from 'node:crypto';
import { PLAN_ORDER, isPlanId, planPrices, type PayState, type PlanId } from '../../shared/protocol';
import { config } from './config';
import * as db from './db';

/** The price in Stripe that each plan is bought with. */
const prices = planPrices(config.stripePrices);

/** While a subscription is in one of these states the person has its plan. */
const LIVE = new Set(['active', 'trialing', 'past_due']);
/** In these the subscription is over. */
const ENDED = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused']);
/** In these the period has been paid for, so its credits are given. */
const PAID = new Set(['active', 'trialing']);

export function enabled(): boolean {
  return Boolean(config.stripeKey && config.stripeWebhookSecret && PLAN_ORDER.some((id) => prices[id]));
}

/** Whether the plan can be bought here. */
export function sells(plan: PlanId): boolean {
  return enabled() && Boolean(prices[plan]);
}

class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function stripe<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string>): Promise<T> {
  const res = await fetch(`${config.stripeApi}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${config.stripeKey}` },
    body: params ? new URLSearchParams(params) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new StripeError(res.status, data.error?.message ?? `Stripe answered ${res.status}`);
  return data as T;
}

/** A subscription as Stripe gives it. Newer versions of its API keep the period on the item, older ones on the subscription. */
interface StripeSubscription {
  id: string;
  customer?: string | { id?: string };
  status: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ price?: { id?: string }; current_period_start?: number; current_period_end?: number }> };
}

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : typeof (value as { id?: unknown } | null)?.id === 'string' ? (value as { id: string }).id : null;

const planOfPrice = (price: string | undefined): PlanId | null => PLAN_ORDER.find((id) => prices[id] !== undefined && prices[id] === price) ?? null;

const ms = (seconds: number | undefined): number | null => (typeof seconds === 'number' && Number.isFinite(seconds) ? seconds * 1000 : null);

/** The subscription the person pays for now, if they pay for one. */
function live(userId: string): (db.Subscription & { plan: PlanId; subscriptionId: string }) | null {
  const sub = db.subscriptionOf(userId);
  return sub && sub.subscriptionId && isPlanId(sub.plan) && LIVE.has(sub.status ?? '') ? (sub as db.Subscription & { plan: PlanId; subscriptionId: string }) : null;
}

/** What the plan page shows about paying. Undefined where nobody can pay. */
export function state(user: db.User): PayState | undefined {
  if (!enabled()) return undefined;
  const sub = live(user.id);
  return {
    plans: PLAN_ORDER.filter((id) => prices[id]),
    ...(sub
      ? {
          plan: sub.plan,
          renewsAt: sub.ends ? undefined : (sub.periodEnd ?? undefined),
          endsAt: sub.ends ? (sub.periodEnd ?? undefined) : undefined,
          pastDue: sub.status === 'past_due' ? true : undefined,
        }
      : {}),
  };
}

/**
 * The period the person has paid for, for giving them its credits: one lot for each period paid,
 * not one for each calendar month. Null when they pay for nothing, or not for this plan. `paid` is
 * false while the latest payment has not gone through.
 */
export function paidPeriod(userId: string, plan: PlanId): { start: number; end: number; paid: boolean } | null {
  const sub = live(userId);
  if (!sub || sub.plan !== plan || sub.periodStart === null || sub.periodEnd === null) return null;
  return { start: sub.periodStart, end: sub.periodEnd, paid: PAID.has(sub.status ?? '') };
}

/**
 * Starts a payment for the plan and gives the address of Stripe's page for it. 'already' when the
 * person pays for a plan already: changing it is done from the portal, so that nobody ends up with
 * two subscriptions.
 */
export async function checkout(user: db.User, plan: PlanId, base: string): Promise<{ url: string } | 'already'> {
  const price = prices[plan];
  if (!enabled() || !price) throw new Error(`the plan "${plan}" has no price`);
  if (live(user.id)) return 'already';
  const known = db.subscriptionOf(user.id);
  const session = await stripe<{ url?: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    client_reference_id: user.id,
    // The same customer at Stripe every time the person pays; the first time, Stripe makes one from the address.
    ...(known ? { customer: known.customerId } : { customer_email: user.email }),
    'metadata[user]': user.id,
    'subscription_data[metadata][user]': user.id,
    ...(config.stripeTaxRate ? { 'subscription_data[default_tax_rates][0]': config.stripeTaxRate } : {}),
    success_url: `${base}/?paid=1`,
    cancel_url: `${base}/?paid=0`,
  });
  if (!session.url) throw new Error('Stripe gave no page to pay on');
  console.log(`[pay] user ${user.id} starts paying for the plan "${plan}"`);
  return { url: session.url };
}

/** The address of Stripe's page where the person changes plan or card, or cancels. Null when they have never paid. */
export async function portal(user: db.User, base: string): Promise<string | null> {
  const known = db.subscriptionOf(user.id);
  if (!enabled() || !known) return null;
  const session = await stripe<{ url?: string }>('POST', '/billing_portal/sessions', { customer: known.customerId, return_url: `${base}/?paid=0` });
  return session.url ?? null;
}

/**
 * Whether the webhook's body was signed by Stripe with the secret, and recently: the header holds
 * the time and an HMAC-SHA256 of "time.body" ("t=1700000000,v1=abc...").
 */
export function signatureOk(raw: Buffer, header: string, secret: string, now = Date.now()): boolean {
  const parts = header.split(',').map((part) => part.trim().split('='));
  const time = Number(parts.find(([key]) => key === 't')?.[1]);
  if (!secret || !Number.isFinite(time) || Math.abs(now / 1000 - time) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${time}.`).update(raw).digest();
  return parts.some(([key, value]) => {
    if (key !== 'v1' || !value || !/^[0-9a-f]{64}$/.test(value)) return false;
    return crypto.timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
}

/** The subscription an event is about, whatever kind of thing the event carries. */
function subscriptionIn(object: unknown): string | null {
  const thing = (object ?? {}) as { object?: unknown; id?: unknown; subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } } };
  if (thing.object === 'subscription') return idOf(thing.id);
  if (thing.object === 'checkout.session') return idOf(thing.subscription);
  if (thing.object === 'invoice') return idOf(thing.subscription) ?? idOf(thing.parent?.subscription_details?.subscription);
  return null;
}

/**
 * An event from Stripe. 'failed' has Stripe send it again later: the subscription could not be
 * looked up just now.
 */
export async function webhook(raw: Buffer, signature: string): Promise<'ok' | 'bad_signature' | 'failed'> {
  if (!signatureOk(raw, signature, config.stripeWebhookSecret)) return 'bad_signature';
  let event: { type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(raw.toString('utf8')) as typeof event;
  } catch {
    return 'ok';
  }
  const id = subscriptionIn(event.data?.object);
  if (!id) return 'ok';
  try {
    await sync(id);
    return 'ok';
  } catch (err) {
    console.warn(`[pay] ${String(event.type)}: the subscription could not be looked up: ${(err as Error).message}`);
    return 'failed';
  }
}

/** Brings what the service knows about a subscription, and the person's plan, in line with Stripe. */
async function sync(subscriptionId: string): Promise<void> {
  const sub = await stripe<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const customerId = idOf(sub.customer);
  // The person is named on the subscription when it is started here; failing that, they are whoever the customer is.
  const named = sub.metadata?.user ? db.getUser(sub.metadata.user) : null;
  const userId = named?.id ?? (customerId ? db.subscriptionOfCustomer(customerId)?.userId : undefined);
  if (!userId || !customerId) {
    console.warn(`[pay] the subscription ${sub.id} belongs to nobody here`);
    return;
  }
  const known = db.subscriptionOf(userId);
  if (LIVE.has(sub.status)) {
    const item = sub.items?.data?.[0];
    const plan = planOfPrice(item?.price?.id);
    if (!plan) {
      console.warn(`[pay] the subscription ${sub.id} is for a price that stands for no plan here`);
      return;
    }
    db.saveSubscription({
      userId,
      customerId,
      subscriptionId: sub.id,
      plan,
      status: sub.status,
      periodStart: ms(sub.current_period_start ?? item?.current_period_start),
      periodEnd: ms(sub.current_period_end ?? item?.current_period_end),
      ends: Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === 'number',
    });
    if (db.getPlan(userId) !== plan) {
      db.setPlan(userId, plan);
      console.log(`[plans] user ${userId} was given the plan "${plan}" by a payment`);
    }
    return;
  }
  if (!ENDED.has(sub.status)) return; // The first payment has not gone through yet.
  // The end of an older subscription must not take away a newer one.
  if (known?.subscriptionId && known.subscriptionId !== sub.id) return;
  db.saveSubscription({ userId, customerId, subscriptionId: null, plan: null, status: null, periodStart: null, periodEnd: null, ends: false });
  // Only the plan the payment gave is taken away, not one the people who run the service gave since.
  if (known?.subscriptionId && db.getPlan(userId) === known.plan) {
    db.clearPlan(userId);
    console.log(`[plans] user ${userId} no longer pays for the plan "${known.plan}"`);
  }
}

/**
 * Ends the person's subscription at once, for when they delete their account. False when Stripe
 * could not be told: the account is then kept, so that nobody goes on paying for an account that
 * is gone.
 */
export async function end(user: db.User): Promise<boolean> {
  const sub = db.subscriptionOf(user.id);
  if (!sub?.subscriptionId) return true;
  if (!config.stripeKey) {
    console.warn(`[pay] user ${user.id} has a subscription, and there is no key to end it with`);
    return true;
  }
  try {
    await stripe('DELETE', `/subscriptions/${encodeURIComponent(sub.subscriptionId)}`);
  } catch (err) {
    // Gone already is as good as ended.
    if (!(err instanceof StripeError && err.status === 404)) {
      console.warn(`[pay] user ${user.id}: the subscription could not be ended: ${(err as Error).message}`);
      return false;
    }
  }
  console.log(`[pay] user ${user.id}: the subscription was ended`);
  return true;
}
