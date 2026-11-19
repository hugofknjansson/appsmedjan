// End-to-end test of everything that does not need a Mac or a real API key:
// sign-up, creating an app from a prompt, the agent's write/build/fix loop (against a scripted
// fake of the Claude API), the mock build worker, the streamed preview and input.
//
//   npm run build && npm run test:e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeAnthropic } from './fake-anthropic.mjs';

// Playwright is not a dependency of the project; require() also finds a globally installed copy (NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appsmedjan-e2e-'));
const shots = process.env.E2E_SHOTS;
const PORT = 8788;
const API_PORT = 8799;
const children = [];

const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** Starts the server or the worker directly (not through npm), so it can be stopped reliably. */
function start(name, args, env) {
  const child = spawn(process.execPath, [tsx, 'src/index.ts', ...args], {
    cwd: path.join(root, name),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
}

async function waitFor(what, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ok  ${message}`);
}

async function main() {
  const fake = await startFakeAnthropic(API_PORT);
  start('server', [], {
    PORT: String(PORT),
    DATA_DIR: dataDir,
    WORKER_TOKEN: 'e2e-token',
    INVITE_CODE: 'smedja',
    ANTHROPIC_API_KEY: 'test-key',
    ANTHROPIC_BASE_URL: `http://localhost:${API_PORT}`,
  });
  const base = `http://localhost:${PORT}`;
  await waitFor('server', async () => (await fetch(`${base}/api/config`)).ok);
  start('worker', ['--mock'], {
    SERVER_URL: `ws://localhost:${PORT}`,
    WORKER_TOKEN: 'e2e-token',
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'sv-SE' });
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));

  // Sign up (an invite code is required in this run).
  await page.goto(base);
  await page.getByLabel('E-post').fill('test@example.com');
  await page.getByLabel('Lösenord').fill('hemligt-lösenord');
  await page.getByLabel('Inbjudningskod').fill('fel-kod');
  await page.getByRole('button', { name: 'Skapa konto' }).click();
  await page.getByText('Inbjudningskoden stämmer inte.').waitFor();
  assert(true, 'a wrong invite code is rejected');
  await page.getByLabel('Inbjudningskod').fill('smedja');
  await page.getByRole('button', { name: 'Skapa konto' }).click();
  await page.getByRole('heading', { name: 'Vad vill du bygga?' }).waitFor();
  await waitFor('worker to connect', async () => {
    const s = await page.evaluate(() => fetch('/api/status').then((r) => r.json()));
    return s.workers === 1;
  });
  await shot('1-dashboard');

  // Create an app from a prompt.
  await page.getByLabel('Vad vill du bygga?').fill('En vanespårare med streaks');
  await page.getByRole('button', { name: 'Bygg min app' }).click();
  await page.waitForURL(/\/p\/[a-z0-9]+$/);
  await page.getByText('Klart! Din vanespårare är igång.').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Skicka' }).waitFor();
  assert(true, 'the agent finished and the final answer is shown');
  assert((await page.locator('.project-name').textContent()) === 'Vanor', 'the agent renamed the app');
  assert((await page.locator('.msg.user').textContent()) === 'En vanespårare med streaks', 'the prompt is in the chat');

  // The preview shows frames from the worker.
  await page.locator('.phone img:not(.hidden)').waitFor();
  const frame = async () =>
    page.evaluate(async () => (await fetch(document.querySelector('.phone img').src)).text());
  assert((await frame()).includes('Vanor'), 'the preview shows the built app');
  assert((await frame()).includes('3 source files, build #1'), 'the build used the fixed files');
  await shot('2-project');

  // Input reaches the worker and comes back as a new frame.
  await page.locator('.phone img').click({ position: { x: 150, y: 400 } });
  await waitFor('tap to show', async () => (await frame()).includes('<circle'));
  await page.keyboard.type('hej');
  await waitFor('typing to show', async () => (await frame()).includes('Typed: hej'));
  assert(true, 'taps and typing reach the simulator');

  // The agent's loop: first build failed, the fix was applied, second build passed.
  const projectId = page.url().split('/').pop();
  const { files } = await page.evaluate((id) => fetch(`/api/projects/${id}/files`).then((r) => r.json()), projectId);
  assert(!files['Sources/ContentView.swift'].includes('MOCK_BUILD_ERROR'), 'the build error was fixed by edit_file');
  assert('Sources/Models/Habit.swift' in files, 'files in subfolders are stored');
  const errorResult = fake.requests
    .flatMap((r) => r.messages)
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .find((b) => b.type === 'tool_result' && b.is_error);
  assert(String(errorResult?.content).includes("cannot find 'MOCK_BUILD_ERROR'"), 'compiler errors were sent back to the model');
  const first = fake.requests[0];
  assert(first.model === 'claude-opus-5-5' && first.fallbacks === 'default', 'model and refusal fallback are requested');
  assert(first.messages.at(-1).content[0].text.includes('<file path="Sources/App.swift">'), 'the project files are in the prompt');

  // Code tab.
  await page.getByRole('tab', { name: 'Kod' }).click();
  await page.getByRole('button', { name: 'Models/Habit.swift' }).click();
  await page.getByText('struct Habit').waitFor();
  assert(true, 'the code view lists and shows files');
  await shot('3-code');

  // A second message replays the history as plain text.
  await page.getByRole('tab', { name: 'Förhandsvisning' }).click();
  const before = fake.requests.length;
  await page.getByLabel('Beskriv vad du vill ändra').fill('Gör den blå');
  await page.getByRole('button', { name: 'Skicka' }).click();
  await waitFor('second run', async () => fake.requests.length > before);
  const second = fake.requests[before];
  assert(second.messages.length === 3 && second.messages[1].role === 'assistant', 'earlier turns are replayed as history');
  await page.locator('.msg.user').nth(1).waitFor();

  // Another account cannot reach this project.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(base);
  const status = await otherPage.evaluate(async (id) => {
    await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', password: 'annat-lösenord', inviteCode: 'smedja' }),
    });
    return (await fetch(`/api/projects/${id}/files`)).status;
  }, projectId);
  assert(status === 404, "another user cannot read the project's files");

  // Phone-sized layout.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.getByText('Klart! Din vanespårare är igång.').first().waitFor();
  await shot('4-mobile-chat');

  await browser.close();
  fake.server.close();
  console.log('\nAll end-to-end checks passed.');
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\n${err.stack ?? err}`);
} finally {
  for (const c of children) c.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
