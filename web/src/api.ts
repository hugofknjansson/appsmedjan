import type { PlanId, PlanState, PublishState, ReleaseGuide, ReviewContact, StoreChoices, StoreListing, StorePages, StoreState, TesterPerson } from '../../shared/protocol';

/** An app someone is waiting for the operator to create in App Store Connect. */
export interface AppRequest {
  projectId: string;
  name: string;
  bundleId: string;
  email: string;
  requestedAt: number;
}

export interface User {
  id: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  /** When the app's icon last changed, or null while it has none. Missing from servers before icons were always made. */
  icon?: number | null;
}

/** A person as the people who run the service see them: their plan, what they ask for and what they have used. */
export interface PlanPerson {
  userId: string;
  email: string;
  plan: string | null;
  requested: string | null;
  requestedAt: number | null;
  apps: number;
  messages: number;
  /** Missing from servers before credits. */
  credits?: number;
  dollars?: number;
}

interface OperatorPlans {
  enforced: boolean;
  /** Whether credits are counted in place of messages. Missing from servers before credits. */
  credits?: boolean;
  defaultPlan: PlanId;
  people: PlanPerson[];
}

export interface AppleStatus {
  enabled: boolean;
  connected: boolean;
  teamId?: string;
  keyId?: string;
  connectedAt?: number;
}

/** An error code from the server, e.g. "daily_limit". The UI translates it. */
export class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    // A file goes as it is (the app icon); everything else is JSON.
    const file = body instanceof Blob;
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': file ? 'image/png' : 'application/json' },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('network');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : 'internal');
  return data as T;
}

export const api = {
  config: () => call<{ inviteRequired: boolean; paywall?: boolean }>('GET', '/api/config'),
  me: () => call<{ user: User | null }>('GET', '/api/me'),
  signup: (email: string, password: string, inviteCode: string) =>
    call<{ user: User }>('POST', '/api/auth/signup', { email, password, inviteCode }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
  projects: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  createProject: (text: string, name: string) =>
    call<{ project: ProjectSummary }>('POST', '/api/projects', { text, name }),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
  sendMessage: (id: string, text: string) => call<{ ok: true }>('POST', `/api/projects/${id}/messages`, { text }),
  stop: (id: string) => call<{ ok: true }>('POST', `/api/projects/${id}/stop`, {}),
  appleAccount: () => call<AppleStatus>('GET', '/api/apple-account'),
  connectApple: (body: { key: string; keyId: string; issuerId: string; teamId: string }) =>
    call<AppleStatus>('PUT', '/api/apple-account', body),
  disconnectApple: () => call<AppleStatus>('DELETE', '/api/apple-account'),
  testflight: (id: string) => call<{ ok: true }>('POST', `/api/projects/${id}/testflight`, {}),
  shareAgain: (id: string, contact?: ReviewContact) =>
    call<{ publish: PublishState }>('POST', `/api/projects/${id}/testlink`, contact ? { contact } : {}),
  fastTrack: (id: string, person: TesterPerson) => call<{ publish: PublishState }>('POST', `/api/projects/${id}/fasttrack`, person),
  handoff: (id: string) => call<{ path: string; expiresInMs: number }>('POST', `/api/projects/${id}/handoff`, {}),
  plan: () => call<PlanState>('GET', '/api/plan'),
  /** Asks for a larger plan. There is no payment yet: the people who run the service answer. */
  requestPlan: (plan: PlanId) => call<PlanState>('POST', '/api/plan/request', { plan }),
  unlockPlan: (code: string) => call<PlanState>('POST', '/api/plan/unlock', { code }),
  operatorPlans: () => call<OperatorPlans>('GET', '/api/operator/plans'),
  givePlan: (email: string, plan: PlanId) => call<OperatorPlans>('POST', '/api/operator/plans', { email, plan }),
  giveCredits: (email: string, amount: number) => call<OperatorPlans>('POST', '/api/operator/credits', { email, amount }),
  /** A link for adding a phone, to open (or scan) on that phone. */
  phoneTicket: () => call<{ path: string; expiresInMs: number }>('POST', '/api/phones/ticket', {}),
  /** Builds the app for the person's own phones. */
  direct: (id: string) => call<{ publish: PublishState }>('POST', `/api/projects/${id}/direct`, {}),
  operatorRequests: () => call<{ requests: AppRequest[] }>('GET', '/api/operator/requests'),
  store: (id: string) => call<StoreState>('GET', `/api/projects/${id}/store`),
  release: (id: string) => call<ReleaseGuide>('GET', `/api/projects/${id}/release`),
  saveListing: (id: string, page: { listing: StoreListing; choices: StoreChoices; contact: ReviewContact; pages: StorePages }) =>
    call<StoreState>('PUT', `/api/projects/${id}/store/listing`, page),
  draftListing: (id: string) =>
    call<{ draft: Partial<StoreListing>; ageRatingNotes: string[]; privacyPolicy: string }>('POST', `/api/projects/${id}/store/draft`, {}),
  captureScreenshot: (id: string) => call<StoreState>('POST', `/api/projects/${id}/store/screenshots`, {}),
  deleteScreenshot: (id: string, shot: string) => call<StoreState>('DELETE', `/api/projects/${id}/store/screenshots/${shot}`),
  uploadIcon: (id: string, file: Blob) => call<StoreState>('PUT', `/api/projects/${id}/store/icon`, file),
  deleteIcon: (id: string) => call<StoreState>('DELETE', `/api/projects/${id}/store/icon`),
  syncStore: (id: string) => call<StoreState>('POST', `/api/projects/${id}/store/sync`, {}),
  submitStore: (id: string) => call<StoreState>('POST', `/api/projects/${id}/store/submit`, {}),
};
