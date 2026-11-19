import assert from 'node:assert';
import { JpegSplitter } from '../worker/src/stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStoreConnect, StoreError, bundleIdName, signToken, waitForApp } from '../shared/appstore';
import { iconPng } from '../worker/src/icon';
import { classifyPublishFailure, publishConfigFromEnv } from '../worker/src/publish';
import { listFolders, pruneAfterDays, staleIds, touch } from '../worker/src/prune';
import { extractErrors, projectSpec } from '../worker/src/xcode';
import { buildNumberFor, decodeFrame, encodeFrame, isValidSourcePath } from '../shared/protocol';

// JPEG splitting across arbitrary chunk boundaries
const jpg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
const all = Buffer.concat([jpg(10), jpg(300), jpg(1)]);
for (const size of [1, 3, 7, 64, 1000]) {
  const sp = new JpegSplitter();
  const frames: Buffer[] = [];
  for (let i = 0; i < all.length; i += size) frames.push(...sp.push(all.subarray(i, i + size)));
  assert.deepEqual(frames.map((f) => f.length), [14, 304, 5], `chunk ${size}`);
}

// Error extraction
const out = `note: Using codesigning identity override
/w/p1/Sources/ContentView.swift:5:9: error: cannot find 'Foo' in scope
        Foo()
        ^~~
/w/p1/Sources/ContentView.swift:5:9: error: cannot find 'Foo' in scope
** BUILD FAILED **`;
assert.equal(extractErrors(out, '/w/p1'), "Sources/ContentView.swift:5:9: error: cannot find 'Foo' in scope");
assert.ok(extractErrors('ld: something odd\n** BUILD FAILED **', '/w/p1').includes('BUILD FAILED'));

// Frames
const f = decodeFrame(encodeFrame('abc123def456', new Uint8Array([1, 2, 3])))!;
assert.equal(f.projectId, 'abc123def456');
assert.deepEqual([...f.image], [1, 2, 3]);

// Paths
for (const ok of ['Sources/App.swift', 'Sources/Views/Home View.swift', 'Sources/A/B/c+d.json']) assert.ok(isValidSourcePath(ok), ok);
for (const bad of ['App.swift', 'Sources/../x.swift', '/etc/passwd', 'Sources/a.sh', 'Sources//a.swift', 'Sources/.hidden.swift', 'Sources/a.swift/', 'project.yml', 'Sources/a\n.swift'])
  assert.ok(!isValidSourcePath(bad), bad);

const spec = projectSpec({ appName: 'Min "bästa": $(HOME) app\n#1', bundleId: 'app.appsmedjan.pabc123def456' });
assert.ok(spec.includes(String.raw`INFOPLIST_KEY_CFBundleDisplayName: "Min \"bästa\": (HOME) app #1"`), spec);

assert.ok(!spec.includes('DEVELOPMENT_TEAM'), 'simulator builds stay unsigned');

// Store builds: signing, build number and icon
const storeSpec = projectSpec({ appName: 'App', bundleId: 'app.appsmedjan.pabc123def456' }, { teamId: 'ABCDE12345', buildNumber: '202611191545' });
for (const line of ['DEVELOPMENT_TEAM: "ABCDE12345"', 'CURRENT_PROJECT_VERSION: "202611191545"', 'ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon', '- path: Resources'])
  assert.ok(storeSpec.includes(line), line);
assert.equal(buildNumberFor(new Date('2026-11-19T15:45:59Z')), '202611191545');

// Icon: a real PNG of the right size, without alpha, stable per app and different between apps
const icon = iconPng('app.appsmedjan.pabc', 64);
assert.deepEqual([...icon.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.equal(icon.subarray(12, 16).toString('latin1'), 'IHDR');
assert.deepEqual([icon.readUInt32BE(16), icon.readUInt32BE(20), icon[24], icon[25]], [64, 64, 8, 2]);
assert.ok(icon.equals(iconPng('app.appsmedjan.pabc', 64)));
assert.ok(!icon.equals(iconPng('app.appsmedjan.pxyz', 64)));

// Upload failures are sorted into something the person can act on
assert.equal(classifyPublishFailure("/w/Sources/A.swift:3:5: error: cannot find 'x' in scope", 'archive'), 'compile');
assert.equal(classifyPublishFailure('error: exportArchive: No suitable application records were found. Verify your bundle identifier', 'upload'), 'no_app_record');
assert.equal(classifyPublishFailure('error: exportArchive: Failed to log in', 'upload'), 'auth');
assert.equal(classifyPublishFailure('error: No profiles for \'app.x\' were found', 'archive'), 'signing');
assert.equal(classifyPublishFailure('something else entirely', 'upload'), 'internal');

// Signing settings: all four or nothing
const signing = { APPLE_TEAM_ID: 'ABCDE12345', ASC_KEY_ID: 'KEY1234567', ASC_ISSUER_ID: '69a6de70-03db-47e3-e053-5b8c7c11a4d1', ASC_KEY_PATH: '/keys/AuthKey.p8' };
const quiet = console.warn;
console.warn = () => undefined;
assert.equal(publishConfigFromEnv({}), null);
assert.equal(publishConfigFromEnv({ ...signing, ASC_KEY_PATH: '' }), null);
assert.equal(publishConfigFromEnv({ ...signing, APPLE_TEAM_ID: 'not a team' }), null);
console.warn = quiet;
assert.deepEqual(publishConfigFromEnv(signing), { teamId: 'ABCDE12345', keyId: 'KEY1234567', issuerId: signing.ASC_ISSUER_ID, keyPath: '/keys/AuthKey.p8' });

// App Store Connect: token format and signature
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const [head, body, sig] = signToken(pem, 'KEY1234567', signing.ASC_ISSUER_ID, 1_800_000_000_000).split('.');
assert.deepEqual(JSON.parse(Buffer.from(head!, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
assert.deepEqual(JSON.parse(Buffer.from(body!, 'base64url').toString()), { iss: signing.ASC_ISSUER_ID, iat: 1_800_000_000, exp: 1_800_000_600, aud: 'appstoreconnect-v1' });
assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url')));
assert.equal(bundleIdName('Min "bästa" app!', 'abc123def456'), 'Appsmedjan Min basta app abc123def456');
assert.equal(bundleIdName('🎉', 'abc123def456'), 'Appsmedjan abc123def456');

// App Store Connect: bundle id registration and app lookup, against a scripted API
const keyFile = path.join(os.tmpdir(), `appsmedjan-unit-${process.pid}.p8`);
fs.writeFileSync(keyFile, pem);
try {
  const calls: Array<{ method: string; url: string; body?: unknown; auth: string }> = [];
  const scripted = (answers: Array<{ status: number; json: unknown }>) =>
    new AppStoreConnect({ keyId: 'KEY1234567', issuerId: signing.ASC_ISSUER_ID, key: () => fs.promises.readFile(keyFile, 'utf8') }, (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).authorization! });
      const answer = answers.shift()!;
      // A 204 carries no body, like Apple's answer when a relationship is added.
      return new Response(answer.status === 204 ? null : JSON.stringify(answer.json), { status: answer.status });
    }) as typeof fetch);
  const id = 'app.appsmedjan.pabc123def456';
  const row = (identifier: string) => ({ type: 'bundleIds', attributes: { identifier } });

  // Already registered: one lookup, nothing created. A longer id that only starts the same is not a match.
  assert.equal(await scripted([{ status: 200, json: { data: [row(`${id}.widget`), row(id)] } }]).ensureBundleId(id, 'Name'), 'exists');
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.includes(`filter[identifier]=${id}`) && calls[0]!.auth.startsWith('Bearer '));

  calls.length = 0;
  assert.equal(await scripted([{ status: 200, json: { data: [row(`${id}.widget`)] } }, { status: 201, json: { data: row(id) } }]).ensureBundleId(id, 'Appsmedjan App abc'), 'created');
  assert.equal(calls[1]!.method, 'POST');
  assert.deepEqual(calls[1]!.body, { data: { type: 'bundleIds', attributes: { identifier: id, name: 'Appsmedjan App abc', platform: 'IOS' } } });
  assert.equal(await scripted([{ status: 200, json: { data: [] } }, { status: 409, json: { errors: [{ detail: 'exists' }] } }]).ensureBundleId(id, 'Name'), 'exists');

  assert.equal(await scripted([{ status: 200, json: { data: [{ id: '111', attributes: { bundleId: `${id}2` } }] } }]).hasApp(id), false);
  assert.equal(await scripted([{ status: 200, json: { data: [{ id: '111', attributes: { bundleId: `${id}2` } }, { id: '222', attributes: { bundleId: id } }] } }]).appId(id), '222');
  await assert.rejects(
    scripted([{ status: 401, json: { errors: [{ detail: 'Provide a properly configured and signed bearer token' }] } }]).hasApp(id),
    (err: unknown) => err instanceof StoreError && err.status === 401 && err.message.includes('bearer token'),
  );

  // Checking a key: the team id comes from any registered bundle id; a brand-new account has none.
  calls.length = 0;
  assert.deepEqual(await scripted([{ status: 200, json: { data: [] } }, { status: 200, json: { data: [{ attributes: { seedId: 'ABCDE12345' } }] } }]).probe(), { teamId: 'ABCDE12345' });
  assert.ok(calls[0]!.url.includes('/v1/apps?') && calls[1]!.url.includes('/v1/bundleIds?'));
  assert.deepEqual(await scripted([{ status: 200, json: { data: [] } }, { status: 200, json: { data: [] } }]).probe(), { teamId: null });
  assert.deepEqual(await scripted([{ status: 200, json: { data: [] } }, { status: 403, json: { errors: [{ detail: 'no access' }] } }]).probe(), { teamId: null });
  await assert.rejects(scripted([{ status: 401, json: { errors: [{ detail: 'bad token' }] } }]).probe(), (err: unknown) => err instanceof StoreError && err.status === 401);

  // The account holder becomes an internal tester: a new group that gets every build, and a new tester in it.
  const holder = { id: 'u1', attributes: { username: 'holder@example.com', firstName: 'Ada', lastName: 'Berg' } };
  calls.length = 0;
  assert.equal(
    await scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g0', attributes: { name: 'Friends', hasAccessToAllBuilds: false } }] } },
      { status: 201, json: { data: { id: 'g1' } } },
      { status: 200, json: { data: [] } },
      { status: 201, json: { data: { id: 't1' } } },
    ]).ensureAccountHolderTests('app1'),
    true,
  );
  assert.ok(calls[0]!.url.includes('filter[roles]=ACCOUNT_HOLDER'));
  assert.ok(calls[1]!.url.includes('filter[app]=app1') && calls[1]!.url.includes('filter[isInternalGroup]=true'));
  assert.deepEqual(calls[2]!.body, {
    data: {
      type: 'betaGroups',
      attributes: { name: 'Appsmedjan', isInternalGroup: true, hasAccessToAllBuilds: true },
      relationships: { app: { data: { type: 'apps', id: 'app1' } } },
    },
  });
  assert.deepEqual(calls[4]!.body, {
    data: {
      type: 'betaTesters',
      attributes: { email: 'holder@example.com', firstName: 'Ada', lastName: 'Berg' },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: 'g1' }] } },
    },
  });

  // A fitting group and a known tester are reused: nothing is created, the tester is only added to the group.
  calls.length = 0;
  assert.equal(
    await scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g7', attributes: { hasAccessToAllBuilds: true } }] } },
      { status: 200, json: { data: [{ id: 't9' }] } },
      { status: 204, json: {} },
    ]).ensureAccountHolderTests('app1'),
    true,
  );
  assert.equal(calls.length, 4);
  assert.ok(calls[3]!.url.endsWith('/v1/betaGroups/g7/relationships/betaTesters'));
  assert.deepEqual(calls[3]!.body, { data: [{ type: 'betaTesters', id: 't9' }] });
  // A key that cannot list users: nothing is changed and the person is told to add themselves.
  assert.equal(await scripted([{ status: 200, json: { data: [] } }]).ensureAccountHolderTests('app1'), false);
} finally {
  fs.rmSync(keyFile, { force: true });
}

// Waiting for a person to create the app: polls until it exists, says so once, gives up at the deadline
{
  const answers: Array<string | null> = [null, null, 'app42'];
  let told = 0;
  assert.equal(await waitForApp({ appId: async () => answers.shift() ?? null }, 'x.y', { waitMs: 1000, pollMs: 5 }, () => told++), 'app42');
  assert.equal(told, 1);
  told = 0;
  assert.equal(await waitForApp({ appId: async () => 'app1' }, 'x.y', { waitMs: 1000, pollMs: 5 }, () => told++), 'app1');
  assert.equal(told, 0, 'no waiting is announced when the app is already there');
  let looks = 0;
  const started = Date.now();
  assert.equal(await waitForApp({ appId: async () => (looks++, null) }, 'x.y', { waitMs: 40, pollMs: 10 }, () => undefined), null);
  assert.ok(looks >= 2 && Date.now() - started < 500);
}

// Stored secrets: readable only with the same key and for the same owner
process.env.SECRETS_KEY = 'unit-test-secret-key-0123456789abcdef';
const { seal, open } = await import('../server/src/secrets');
const sealed = seal(pem, 'user-1');
assert.ok(!sealed.includes('PRIVATE KEY') && sealed.startsWith('v1.'));
assert.equal(open(sealed, 'user-1'), pem);
assert.equal(open(sealed, 'user-2'), null, 'a value moved to another owner does not open');
assert.equal(open(sealed.slice(0, -4) + 'AAAA', 'user-1'), null, 'tampered data does not open');
assert.notEqual(seal(pem, 'user-1'), sealed, 'every encryption uses a fresh nonce');

// Clean-up on unattended Macs: only what is old and not in use goes
{
  const day = 24 * 3600_000;
  const now = 100 * day;
  const items = [
    { id: 'fresh', lastUsedMs: now - 2 * day },
    { id: 'old', lastUsedMs: now - 20 * day },
    { id: 'oldbutopen', lastUsedMs: now - 20 * day },
    { id: 'orphan', lastUsedMs: null },
  ];
  assert.deepEqual(staleIds(items, new Set(['oldbutopen']), now, 14), ['old', 'orphan']);
  assert.deepEqual(staleIds(items, new Set(), now, 0), [], 'zero days keeps everything');
  assert.equal(pruneAfterDays({}), 14);
  assert.equal(pruneAfterDays({ PRUNE_AFTER_DAYS: '0' }), 0);
  assert.equal(pruneAfterDays({ PRUNE_AFTER_DAYS: '3' }), 3);
  assert.equal(pruneAfterDays({ PRUNE_AFTER_DAYS: 'nonsense' }), 14);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appsmedjan-prune-'));
  try {
    fs.mkdirSync(path.join(root, 'aaaaaaaa1111'));
    fs.mkdirSync(path.join(root, 'bbbbbbbb2222'));
    fs.writeFileSync(path.join(root, 'not-a-folder'), '');
    const longAgo = new Date(Date.now() - 30 * day);
    fs.utimesSync(path.join(root, 'aaaaaaaa1111'), longAgo, longAgo);
    assert.deepEqual(staleIds(await listFolders(root), new Set(), Date.now(), 14), ['aaaaaaaa1111']);
    await touch(path.join(root, 'aaaaaaaa1111'));
    assert.deepEqual(staleIds(await listFolders(root), new Set(), Date.now(), 14), [], 'using a project keeps it');
    assert.deepEqual(await listFolders(path.join(root, 'missing')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('Unit checks passed.');
