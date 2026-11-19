import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: configuration comes from the real environment.
}

const production = process.env.NODE_ENV === 'production';

function workerToken(): string {
  const token = process.env.WORKER_TOKEN ?? '';
  if (token) return token;
  if (production) {
    throw new Error('WORKER_TOKEN must be set in production (shared secret for the Mac build workers).');
  }
  console.warn('[config] WORKER_TOKEN is not set; using the development token "dev-token".');
  return 'dev-token';
}

export const config = {
  production,
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? path.join(ROOT, 'data'),
  webDist: path.join(ROOT, 'web', 'dist'),
  workerToken: workerToken(),
  inviteCode: process.env.INVITE_CODE ?? '',
  model: process.env.AGENT_MODEL ?? 'claude-opus-5-5',
  effort: (process.env.AGENT_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  dailyMessageLimit: Number(process.env.DAILY_MESSAGE_LIMIT ?? 50),
  bundleIdPrefix: process.env.BUNDLE_ID_PREFIX ?? 'app.appsmedjan',
  trustProxy: Boolean(process.env.TRUST_PROXY),
  /** Extra origins allowed to open the browser WebSocket (comma separated), besides the server's own host. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** How long a simulator stays up after the last viewer leaves. */
  releaseAfterMs: Number(process.env.RELEASE_AFTER_MS ?? 5 * 60_000),
};
