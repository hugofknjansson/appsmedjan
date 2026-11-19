export interface User {
  id: string;
  email: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
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
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  config: () => call<{ inviteRequired: boolean }>('GET', '/api/config'),
  me: () => call<{ user: User | null }>('GET', '/api/me'),
  signup: (email: string, password: string, inviteCode: string) =>
    call<{ user: User }>('POST', '/api/auth/signup', { email, password, inviteCode }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout', {}),
  projects: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  createProject: (text: string, name: string) =>
    call<{ project: ProjectSummary }>('POST', '/api/projects', { text, name }),
  deleteProject: (id: string) => call<{ ok: true }>('DELETE', `/api/projects/${id}`),
  files: (id: string) => call<{ files: Record<string, string> }>('GET', `/api/projects/${id}/files`),
  sendMessage: (id: string, text: string) => call<{ ok: true }>('POST', `/api/projects/${id}/messages`, { text }),
  stop: (id: string) => call<{ ok: true }>('POST', `/api/projects/${id}/stop`, {}),
  appleAccount: () => call<AppleStatus>('GET', '/api/apple-account'),
  connectApple: (body: { key: string; keyId: string; issuerId: string; teamId: string }) =>
    call<AppleStatus>('PUT', '/api/apple-account', body),
  disconnectApple: () => call<AppleStatus>('DELETE', '/api/apple-account'),
  testflight: (id: string) => call<{ ok: true }>('POST', `/api/projects/${id}/testflight`, {}),
};
