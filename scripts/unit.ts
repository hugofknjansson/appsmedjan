import assert from 'node:assert';
import { JpegSplitter } from '../worker/src/stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStoreConnect, StoreError, StoreLocked, bundleIdName, signToken, waitForApp } from '../shared/appstore';
import { pngInfo } from '../shared/png';
import { iconPng } from '../worker/src/icon';
import { Publisher, classifyPublishFailure, publishConfigFromEnv } from '../worker/src/publish';
import { listFolders, pruneAfterDays, staleIds, touch } from '../worker/src/prune';
import { extractErrors, projectSpec } from '../worker/src/xcode';
import {
  EMPTY_CONTACT,
  EMPTY_LISTING,
  buildNumberFor,
  contactComplete,
  contactProblem,
  copyrightLine,
  decodeFrame,
  directProgress,
  encodeFrame,
  fitWords,
  isUdid,
  isValidSourcePath,
  listingProblems,
  readPhoneAnswer,
  parseContact,
  type StoreListing,
} from '../shared/protocol';
import { keepAlive } from '../shared/keepalive';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';

// Phones: what an identifier looks like, and reading one out of what a phone posts when it is added
assert.ok(isUdid('00008110-000A1B2C3D4E5F60') && isUdid('a'.repeat(40)));
assert.ok(!isUdid('00008110-000A1B2C3D4E5F6') && !isUdid('g'.repeat(40)) && !isUdid('') && !isUdid(42));
{
  const answer = (udid: string, product: string) =>
    Buffer.concat([
      Buffer.from([0x30, 0x82, 0x0a, 0xff, 0x00]),
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>PRODUCT</key><string>${product}</string><key>UDID</key>\n\t<string>${udid}</string></dict></plist>`),
      Buffer.from([0xa0, 0x82, 0x00, 0x01]),
    ]);
  assert.deepEqual(readPhoneAnswer(answer('00008110-000a1b2c3d4e5f60', 'iPhone19,2')), { udid: '00008110-000A1B2C3D4E5F60', model: 'iPhone19,2' });
  assert.equal(readPhoneAnswer(answer('00008110-000A1B2C3D4E5F60', 'weird/model"'))?.model, 'iPhone');
  assert.equal(readPhoneAnswer(answer('not a udid', 'iPhone19,2')), null);
  assert.equal(readPhoneAnswer(Buffer.from('nothing here')), null);
}

// The way onto the phone as one number: it only grows from the build to the app file arriving
{
  const way = [
    directProgress({ status: 'working', stage: 'queued' }),
    directProgress({ status: 'working', stage: 'preparing' }),
    directProgress({ status: 'working', stage: 'archiving' }),
    directProgress({ status: 'working', stage: 'signing' }),
    directProgress({ status: 'ready' }),
    directProgress({ status: 'ready', install: 'asked' }),
    directProgress({ status: 'ready', install: 'fetching' }),
    directProgress({ status: 'ready', install: 'fetched' }),
  ] as number[];
  assert.ok(way.every((value, index) => index === 0 || value > way[index - 1]!), 'grows at every step');
  assert.equal(way.at(-1), 1);
  assert.equal(directProgress({ status: 'idle' }), null);
  assert.equal(directProgress({ status: 'failed' }), null);
}

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
assert.equal(bundleIdName('Min "bästa" app!', 'abc123def456'), 'App Dance Min basta app abc123def456');
assert.equal(bundleIdName('🎉', 'abc123def456'), 'App Dance abc123def456');

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
  assert.equal(await scripted([{ status: 200, json: { data: [row(`${id}.widget`)] } }, { status: 201, json: { data: row(id) } }]).ensureBundleId(id, 'App Dance App abc'), 'created');
  assert.equal(calls[1]!.method, 'POST');
  assert.deepEqual(calls[1]!.body, { data: { type: 'bundleIds', attributes: { identifier: id, name: 'App Dance App abc', platform: 'IOS' } } });
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
      attributes: { name: 'App Dance', isInternalGroup: true, hasAccessToAllBuilds: true },
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

  // A fitting group is reused, and so is the tester record the person already has in this app.
  calls.length = 0;
  assert.equal(
    await scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g7', attributes: { hasAccessToAllBuilds: true } }] } },
      { status: 200, json: { data: [] } },
      { status: 200, json: { data: [{ id: 't9' }] } },
      { status: 204, json: {} },
    ]).ensureAccountHolderTests('app1'),
    true,
  );
  assert.equal(calls.length, 5);
  assert.ok(calls[2]!.url.includes('filter[betaGroups]=g7'));
  // Only a record in this app counts: Apple keeps one per app and refuses another app's in this group.
  assert.ok(calls[3]!.url.includes('filter[apps]=app1'));
  assert.ok(calls[4]!.url.endsWith('/v1/betaGroups/g7/relationships/betaTesters'));
  assert.deepEqual(calls[4]!.body, { data: [{ type: 'betaTesters', id: 't9' }] });
  // Already in the group: nothing is sent.
  calls.length = 0;
  assert.equal(
    await scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g7', attributes: { hasAccessToAllBuilds: true } }] } },
      { status: 200, json: { data: [{ id: 't9' }] } },
    ]).ensureAccountHolderTests('app1'),
    true,
  );
  assert.equal(calls.length, 3);
  // A tester of another app only: a new record is created in this app's group.
  calls.length = 0;
  assert.equal(
    await scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g7', attributes: { hasAccessToAllBuilds: true } }] } },
      { status: 200, json: { data: [] } },
      { status: 200, json: { data: [] } },
      { status: 201, json: { data: { id: 't10' } } },
    ]).ensureAccountHolderTests('app1'),
    true,
  );
  assert.ok(calls[4]!.url.endsWith('/v1/betaTesters') && calls[4]!.method === 'POST');
  // Apple refusing is an error, not a success.
  await assert.rejects(
    scripted([
      { status: 200, json: { data: [holder] } },
      { status: 200, json: { data: [{ id: 'g7', attributes: { hasAccessToAllBuilds: true } }] } },
      { status: 200, json: { data: [] } },
      { status: 200, json: { data: [{ id: 't9' }] } },
      { status: 409, json: { errors: [{ detail: 'Tester(s) cannot be assigned' }] } },
    ]).ensureAccountHolderTests('app1'),
    (err: unknown) => err instanceof StoreError && err.status === 409 && err.message.includes('cannot be assigned'),
  );
  // Phones for installing without TestFlight: a known one is left alone, a new one is registered, a disabled one switched on.
  calls.length = 0;
  const device = (id: string, udid: string, status: string) => ({ id, attributes: { udid, status } });
  assert.deepEqual(
    await scripted([
      { status: 200, json: { data: [device('d1', '00008110-000A1B2C3D4E5F60', 'ENABLED'), device('d2', '00008120-AAAAAAAAAAAAAAAA', 'DISABLED')] } },
      { status: 201, json: { data: device('d3', '00008110-BBBBBBBBBBBBBBBB', 'PROCESSING') } },
      { status: 200, json: { data: device('d2', '00008120-AAAAAAAAAAAAAAAA', 'ENABLED') } },
    ]).ensurePhones([
      { udid: '00008110-000a1b2c3d4e5f60', name: 'One' },
      { udid: '00008110-BBBBBBBBBBBBBBBB', name: 'Two' },
      { udid: '00008120-AAAAAAAAAAAAAAAA', name: 'Three' },
    ]),
    [
      { udid: '00008110-000a1b2c3d4e5f60', status: 'ENABLED' },
      { udid: '00008110-BBBBBBBBBBBBBBBB', status: 'PROCESSING' },
      { udid: '00008120-AAAAAAAAAAAAAAAA', status: 'ENABLED' },
    ],
  );
  assert.ok(calls[0]!.url.includes('/v1/devices?filter[udid]=00008110-000a1b2c3d4e5f60,00008110-BBBBBBBBBBBBBBBB,00008120-AAAAAAAAAAAAAAAA'));
  assert.deepEqual(calls[1]!.body, { data: { type: 'devices', attributes: { name: 'Two', platform: 'IOS', udid: '00008110-BBBBBBBBBBBBBBBB' } } });
  assert.equal(calls[2]!.method, 'PATCH');
  assert.ok(calls[2]!.url.endsWith('/v1/devices/d2'));
  // An account with no room for more phones: Apple's refusal is an error, not a registered phone.
  await assert.rejects(
    scripted([{ status: 200, json: { data: [] } }, { status: 409, json: { errors: [{ detail: 'You have already reached the maximum allowed number of registered devices.' }] } }]).ensurePhones([
      { udid: '00008110-BBBBBBBBBBBBBBBB', name: 'Two' },
    ]),
    (err: unknown) => err instanceof StoreError && err.status === 409 && err.message.includes('maximum'),
  );
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

// A connection that stops answering pings is dropped, so its owner can reconnect
{
  class FakeSocket extends EventEmitter {
    OPEN = 1;
    readyState = 1;
    pings = 0;
    terminated = false;
    answers = true;
    ping() {
      this.pings++;
      if (this.answers) this.emit('pong');
    }
    terminate() {
      this.terminated = true;
      this.emit('close');
    }
  }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const sock = new FakeSocket();
  let dead = 0;
  keepAlive(sock as unknown as WebSocket, 10, () => dead++);
  await wait(45);
  assert.ok(sock.pings >= 2 && !sock.terminated, 'an answering connection is kept');
  sock.answers = false;
  await wait(45);
  assert.ok(sock.terminated && dead === 1, 'a silent connection is dropped once');
  const pings = sock.pings;
  await wait(30);
  assert.equal(sock.pings, pings, 'nothing is sent after it closed');
}

// The App Store page: what counts as ready, and what is sent to Apple
{
  const listing: StoreListing = {
    name: 'Borstkoll',
    subtitle: 'Två minuter, varje gång',
    promo: '',
    description: 'En timer som hjälper dig att borsta tänderna i två minuter.',
    keywords: 'tandborste,timer,barn',
    supportUrl: 'https://example.com/support',
    marketingUrl: '',
    privacyUrl: 'https://example.com/privacy',
    category: 'HEALTH_AND_FITNESS',
  };
  assert.deepEqual(listingProblems(listing, 1), []);
  assert.deepEqual(listingProblems(listing, 0), ['screenshots']);
  assert.deepEqual(listingProblems({ ...EMPTY_LISTING }, 0), [
    'name_missing', 'description_missing', 'keywords_missing', 'support_url', 'privacy_url', 'category', 'screenshots',
  ]);
  assert.deepEqual(listingProblems({ ...listing, name: 'x'.repeat(31), marketingUrl: 'example.com', supportUrl: 'http://example.com' }, 1), [
    'name_long', 'support_url', 'marketing_url',
  ]);
  // Pages shown from here need an address to write to and a policy to show.
  const hosted = { hosted: true, supportEmail: 'hjalp@example.com', privacyText: 'Appen sparar dina borstningar på telefonen och skickar ingenting vidare till någon annan.', lang: 'sv' as const };
  assert.deepEqual(listingProblems(listing, 1, hosted), []);
  assert.deepEqual(listingProblems(listing, 1, { ...hosted, supportEmail: 'inte en adress', privacyText: 'Kort.' }), ['page_email', 'page_policy']);
  assert.deepEqual(listingProblems(listing, 1, { ...hosted, hosted: false, supportEmail: '', privacyText: '' }), [], 'own pages need neither');
  // Thirty emoji are thirty characters to Apple, though sixty to JavaScript.
  assert.deepEqual(listingProblems({ ...listing, name: '🪥'.repeat(30) }, 1), []);

  const placeholder = pngInfo(iconPng('app.appsmedjan.pabc'));
  assert.deepEqual(placeholder && { width: placeholder.width, height: placeholder.height, alpha: placeholder.alpha }, { width: 1024, height: 1024, alpha: false });
  assert.equal(pngInfo(Buffer.from('not a png at all, just some text that is long enough')), null);

  // A small stand-in for App Store Connect that remembers what it was told.
  interface Row { id: string; attributes?: Record<string, unknown> }
  const fakeStore = (start: { versions: Row[]; builds: Row[]; priced?: boolean; refuseSubmit?: boolean; review?: string; inGroup?: boolean; users?: Row[]; invitations?: Row[] }) => {
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const uploads: number[] = [];
    const state = { ...start, shots: [{ id: 'old1' }, { id: 'old2' }] as Row[], sets: [] as Row[], groups: [] as Row[], next: 1 };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.startsWith('https://upload.example/')) {
        uploads.push((init.body as Uint8Array).length);
        return new Response(null, { status: 200 });
      }
      const path = url.replace('https://api.example', '');
      const method = init.method!;
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
      const bare = path.split('?')[0]!;
      if (method === 'GET' && bare === '/v1/apps/app1/appStoreVersions') return ok(state.versions);
      if (method === 'POST' && bare === '/v1/appStoreVersions') return ok({ id: 'vNew', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } }, 201);
      if (method === 'GET' && bare === '/v1/apps/app1') return ok({ id: 'app1', attributes: { primaryLocale: 'sv' } });
      if (method === 'GET' && bare.endsWith('/appStoreVersionLocalizations')) return ok([{ id: 'vl-en', attributes: { locale: 'en-US' } }, { id: 'vl-sv', attributes: { locale: 'sv' } }]);
      if (method === 'GET' && bare === '/v1/apps/app1/appInfos') return ok([{ id: 'info1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }]);
      if (method === 'GET' && bare.endsWith('/appInfoLocalizations')) return ok([]);
      if (method === 'GET' && bare.endsWith('/appScreenshotSets')) return ok(state.sets);
      if (method === 'POST' && bare === '/v1/appScreenshotSets') return ok({ id: 'set1' }, 201);
      if (method === 'GET' && bare.endsWith('/appScreenshots')) return ok(state.shots);
      if (method === 'POST' && bare === '/v1/appScreenshots') {
        const size = body.data.attributes.fileSize as number;
        const half = Math.floor(size / 2);
        return ok({
          id: `shot${state.next++}`,
          attributes: {
            uploadOperations: [
              { method: 'PUT', url: 'https://upload.example/a', offset: 0, length: half, requestHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }] },
              { method: 'PUT', url: 'https://upload.example/b', offset: half, length: size - half, requestHeaders: [] },
            ],
          },
        }, 201);
      }
      if (method === 'GET' && bare === '/v1/builds') return ok(state.builds);
      // Only some of the questions exist in this account's API version, and one it must not touch.
      if (method === 'GET' && bare === '/v1/appInfos/info1/ageRatingDeclaration') {
        return ok({ id: 'age1', attributes: { violenceRealistic: null, gambling: null, advertising: null, kidsAgeBand: null } });
      }
      if (method === 'GET' && bare === '/v1/appPriceSchedules/app1/manualPrices' && start.priced) return ok([{ id: 'p1' }]);
      if (method === 'GET' && bare === '/v1/apps/app1/appPricePoints') {
        return ok([{ id: 'pp-099', attributes: { customerPrice: '0.99' } }, { id: 'pp-free', attributes: { customerPrice: '0.0' } }]);
      }
      if (method === 'GET' && bare === '/v1/apps/app1/appAvailabilityV2' && start.priced) return ok({ id: 'av1' });
      if (method === 'GET' && bare === '/v1/territories') return ok([{ id: 'USA' }, { id: 'SWE' }]);
      // Beta testing: the review details always exist, the rest is made on demand.
      if (method === 'GET' && bare === '/v1/apps/app1/betaAppReviewDetail') return ok({ id: 'app1' });
      if (method === 'GET' && bare === '/v1/apps/app1/betaAppLocalizations') return ok([]);
      if (method === 'GET' && bare === '/v1/builds/b1/betaBuildLocalizations') return ok([]);
      if (method === 'GET' && bare === '/v1/betaGroups') return ok(state.groups);
      if (method === 'POST' && bare === '/v1/betaGroups') {
        // The link is not in the answer to the request that makes the group, only when it is read again.
        state.groups.push({ id: 'g1', attributes: { name: body.data.attributes.name, publicLinkEnabled: true, publicLink: 'https://testflight.apple.com/join/AbCd1234' } });
        return ok({ id: 'g1', attributes: { name: body.data.attributes.name, publicLinkEnabled: true } }, 201);
      }
      if (method === 'POST' && bare === '/v1/betaGroups/g1/relationships/builds' && start.inGroup) {
        return new Response(JSON.stringify({ errors: [{ detail: 'The build is already in the group.' }] }), { status: 409 });
      }
      if (method === 'GET' && bare === '/v1/builds/b1/betaAppReviewSubmission' && start.review) {
        return ok({ id: 's1', attributes: { betaReviewState: start.review } });
      }
      if (method === 'POST' && bare === '/v1/betaAppReviewSubmissions') return ok({ id: 's1', attributes: { betaReviewState: 'WAITING_FOR_REVIEW' } }, 201);
      // The team: its members, and invitations that have not been accepted yet.
      if (method === 'GET' && bare === '/v1/users') return ok(start.users ?? []);
      if (method === 'GET' && bare === '/v1/userInvitations') return ok(start.invitations ?? []);
      if (method === 'POST' && bare === '/v1/users/u1/relationships/visibleApps') return new Response(null, { status: 204 });
      if (method === 'GET' && bare === '/v1/betaTesters') return ok([]);
      if (method === 'GET' && bare === '/v1/reviewSubmissions') return ok([]);
      if (method === 'POST' && bare === '/v1/reviewSubmissions') return ok({ id: 'sub1' }, 201);
      if (method === 'PATCH' && bare === '/v1/reviewSubmissions/sub1' && start.refuseSubmit) {
        return new Response(
          JSON.stringify({
            errors: [{
              detail: 'The provided entity is not in a valid state.',
              meta: { associatedErrors: { '/v1/appStoreVersions/v1': [{ detail: 'App Privacy answers are missing.' }, { detail: 'App Privacy answers are missing.' }] } },
            }],
          }),
          { status: 409 },
        );
      }
      if (method === 'DELETE' || bare.endsWith('/relationships/build')) return new Response(null, { status: 204 });
      if (method === 'PATCH' || method === 'POST') return ok({ id: 'x' });
      return new Response(JSON.stringify({ errors: [{ detail: `unexpected ${method} ${path}` }] }), { status: 404 });
    }) as typeof fetch;
    return { calls, uploads, store: new AppStoreConnect({ keyId: 'KEY1234567', issuerId: 'issuer', key: pem }, fetchImpl, 'https://api.example') };
  };
  const editable = { id: 'v1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION' } };
  const build = { id: 'b1', attributes: { version: '202611200729', processingState: 'VALID' } };
  const shot = Buffer.alloc(1001, 7);

  const full = fakeStore({ versions: [{ id: 'v0', attributes: { appVersionState: 'READY_FOR_SALE' } }, editable], builds: [build] });
  const stages: string[] = [];
  assert.deepEqual(await full.store.syncListing('app1', { listing, screenshots: [shot, shot], build: '202611200729' }, (s) => stages.push(s)), { attached: 'attached' });
  assert.deepEqual(stages, ['version', 'texts', 'screenshots', 'build', 'details']);
  // Nothing was stated about the app, so none of the details are touched.
  assert.ok(!full.calls.some((c) => /ageRating|appPrice|appAvailab|appStoreReviewDetail|\/v1\/apps\/app1$/.test(c.path) && c.method !== 'GET'));
  const did = (method: string, path: string) => full.calls.filter((c) => c.method === method && c.path.split('?')[0] === path);
  // The texts go into the app's own language, not the first one in the list.
  assert.deepEqual(did('PATCH', '/v1/appStoreVersionLocalizations/vl-sv')[0]!.body.data.attributes, {
    description: listing.description, keywords: listing.keywords, promotionalText: null, supportUrl: listing.supportUrl, marketingUrl: null,
  });
  // The name had no entry in that language yet, so one is created.
  assert.deepEqual(did('POST', '/v1/appInfoLocalizations')[0]!.body.data.attributes, {
    locale: 'sv', name: 'Borstkoll', subtitle: listing.subtitle, privacyPolicyUrl: listing.privacyUrl,
  });
  assert.equal(did('PATCH', '/v1/appInfos/info1')[0]!.body.data.relationships.primaryCategory.data.id, 'HEALTH_AND_FITNESS');
  // Old pictures go, new ones are reserved, sent in the parts Apple asked for, and confirmed with a checksum.
  assert.equal(did('DELETE', '/v1/appScreenshots/old1').length + did('DELETE', '/v1/appScreenshots/old2').length, 2);
  assert.equal(did('POST', '/v1/appScreenshotSets')[0]!.body.data.attributes.screenshotDisplayType, 'APP_IPHONE_67');
  assert.deepEqual(full.uploads, [500, 501, 500, 501]);
  assert.deepEqual(did('PATCH', '/v1/appScreenshots/shot1')[0]!.body.data.attributes, {
    uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(shot).digest('hex'),
  });
  assert.deepEqual(did('PATCH', '/v1/appStoreVersions/v1/relationships/build')[0]!.body, { data: { type: 'builds', id: 'b1' } });

  // A brand-new app has no version yet: one is created. A build Apple has not finished is not selected.
  const fresh = fakeStore({ versions: [], builds: [] });
  assert.deepEqual(await fresh.store.syncListing('app1', { listing, screenshots: [shot], build: '202611200729' }), { attached: 'processing' });
  assert.deepEqual(fresh.calls.find((c) => c.method === 'POST' && c.path === '/v1/appStoreVersions')!.body.data.attributes, { platform: 'IOS', versionString: '1.0' });
  assert.deepEqual(await fakeStore({ versions: [editable], builds: [] }).store.syncListing('app1', { listing, screenshots: [shot] }), { attached: 'none' });

  // A released or reviewed version is left alone.
  const released = fakeStore({ versions: [{ id: 'v0', attributes: { appVersionState: 'WAITING_FOR_REVIEW' } }], builds: [] });
  await assert.rejects(released.store.syncListing('app1', { listing, screenshots: [shot] }), StoreLocked);
  assert.equal(released.calls.length, 1, 'nothing is changed once the version turns out to be locked');

  // The details the person asked for: each only when stated, and nothing they chose themselves is replaced.
  const contact = { firstName: 'Hugo', lastName: 'Jansson', phone: '+46 70 123 45 67', email: 'hugo@example.com', holder: '' };
  assert.ok(contactComplete(contact));
  assert.ok(!contactComplete({ ...contact, phone: '070-123 45 67' }), 'the country code is needed');
  assert.ok(!contactComplete(EMPTY_CONTACT));
  assert.equal(contactProblem(EMPTY_CONTACT), 'name');
  assert.equal(contactProblem({ ...contact, phone: '0701234567' }), 'phone');
  assert.equal(contactProblem({ ...contact, email: 'hugo(at)example.com' }), 'email');
  assert.equal(contactProblem(contact), null);

  // A text that is still too long is cut at a word, never in the middle of one.
  assert.equal(fitWords('Påminnelser och tandborstning varje dag', 30), 'Påminnelser och tandborstning');
  assert.equal(fitWords('Kort nog', 30), 'Kort nog');
  assert.equal(fitWords('Borsta tänderna, varje dag', 16), 'Borsta tänderna');
  assert.equal(fitWords('Ettendalångtordutanmellanslagalls', 10), 'Ettendalån');
  assert.equal([...fitWords('🪥'.repeat(40), 30)].length, 30);
  assert.equal(copyrightLine(contact, 2026), '2026 Hugo Jansson');
  assert.equal(copyrightLine({ ...contact, holder: 'Smedjan AB' }, 2026), '2026 Smedjan AB');

  const everything = { noMatureContent: true, noThirdPartyContent: true, free: true };
  const detailed = fakeStore({ versions: [editable], builds: [build] });
  await detailed.store.syncListing('app1', { listing, screenshots: [shot], build: '202611200729', choices: everything, contact });
  const sent = (method: string, path: string) => detailed.calls.find((c) => c.method === method && c.path.split('?')[0] === path)?.body;
  assert.match(sent('PATCH', '/v1/appStoreVersions/v1').data.attributes.copyright, /^\d{4} Hugo Jansson$/);
  assert.deepEqual(sent('POST', '/v1/appStoreReviewDetails').data.attributes, {
    contactFirstName: 'Hugo', contactLastName: 'Jansson', contactPhone: '+46 70 123 45 67', contactEmail: 'hugo@example.com', demoAccountRequired: false,
  });
  assert.equal(sent('PATCH', '/v1/apps/app1').data.attributes.contentRightsDeclaration, 'DOES_NOT_USE_THIRD_PARTY_CONTENT');
  // Only the questions this account's API knows are answered, and never the ones that are not about content.
  assert.deepEqual(sent('PATCH', '/v1/ageRatingDeclarations/age1').data.attributes, { violenceRealistic: 'NONE', advertising: false, gambling: false });
  const schedule = sent('POST', '/v1/appPriceSchedules');
  assert.equal(schedule.included[0].relationships.appPricePoint.data.id, 'pp-free');
  assert.equal(schedule.data.relationships.manualPrices.data[0].id, schedule.included[0].id);
  const availability = sent('POST', '/v2/appAvailabilities');
  assert.deepEqual(availability.included.map((t: any) => [t.relationships.territory.data.id, t.attributes.available]), [['USA', true], ['SWE', true]]);
  assert.deepEqual(availability.data.relationships.territoryAvailabilities.data.map((t: any) => t.id), availability.included.map((t: any) => t.id));

  // An app that already has a price and countries keeps them.
  const priced = fakeStore({ versions: [editable], builds: [], priced: true });
  await priced.store.syncListing('app1', { listing, screenshots: [shot], choices: { noMatureContent: false, noThirdPartyContent: false, free: true } });
  assert.ok(!priced.calls.some((c) => c.method === 'POST' && /appPriceSchedules|appAvailabilities/.test(c.path)));
  assert.ok(!priced.calls.some((c) => /ageRating/.test(c.path)), 'the age rating is left alone when nothing was stated');

  // Submitting: a submission is opened, the version is put in it, and it is sent.
  const submitted = fakeStore({ versions: [editable], builds: [] });
  await submitted.store.submitForReview('app1');
  assert.deepEqual(
    submitted.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`),
    ['POST /v1/reviewSubmissions', 'POST /v1/reviewSubmissionItems', 'PATCH /v1/reviewSubmissions/sub1'],
  );
  assert.deepEqual(submitted.calls.at(-2)!.body.data.relationships.appStoreVersion.data, { type: 'appStoreVersions', id: 'v1' });
  assert.deepEqual(submitted.calls.at(-1)!.body.data.attributes, { submitted: true });
  // What Apple finds missing sits one level down in its answer, and is said once.
  await assert.rejects(
    fakeStore({ versions: [editable], builds: [], refuseSubmit: true }).store.submitForReview('app1'),
    (err: unknown) => err instanceof StoreError && err.detail === 'The provided entity is not in a valid state. App Privacy answers are missing.',
  );
  await assert.rejects(fakeStore({ versions: [{ id: 'v0', attributes: { appVersionState: 'WAITING_FOR_REVIEW' } }], builds: [] }).store.submitForReview('app1'), StoreLocked);

  // The public test link: nothing can be done until Apple has processed the build.
  const unprocessed = fakeStore({ versions: [editable], builds: [{ id: 'b1', attributes: { version: '202611200729', processingState: 'PROCESSING' } }] });
  assert.deepEqual(await unprocessed.store.shareBuild('app1', { build: '202611200729', contact, description: 'En app.' }), { state: 'processing' });
  assert.ok(unprocessed.calls.every((c) => c.method === 'GET'));

  // Then: who to contact, what the app is, a group with a public link, the build in it, and the review.
  const shared = fakeStore({ versions: [editable], builds: [build] });
  assert.deepEqual(await shared.store.shareBuild('app1', { build: '202611200729', contact, description: 'En app.' }), {
    state: 'review', url: 'https://testflight.apple.com/join/AbCd1234',
  });
  const told = (method: string, path: string) => shared.calls.find((c) => c.method === method && c.path.split('?')[0] === path)?.body;
  assert.equal(told('PATCH', '/v1/betaAppReviewDetails/app1').data.attributes.contactPhone, '+46 70 123 45 67');
  assert.deepEqual(told('POST', '/v1/betaAppLocalizations').data.attributes, { locale: 'sv', description: 'En app.', feedbackEmail: 'hugo@example.com' });
  assert.equal(told('POST', '/v1/betaBuildLocalizations').data.attributes.whatsNew, 'Prova appen och berätta vad du tycker.');
  assert.deepEqual(told('POST', '/v1/betaGroups').data.attributes, {
    name: 'App Dance link', isInternalGroup: false, publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true,
  });
  assert.deepEqual(told('POST', '/v1/betaGroups/g1/relationships/builds'), { data: [{ type: 'builds', id: 'b1' }] });
  assert.deepEqual(told('POST', '/v1/betaAppReviewSubmissions').data.relationships.build.data, { type: 'builds', id: 'b1' });

  // Run again for a build that is in the group and in review already: nothing is submitted twice.
  const again = fakeStore({ versions: [editable], builds: [build], review: 'IN_REVIEW', inGroup: true });
  assert.equal((await again.store.shareBuild('app1', { build: '202611200729', contact, description: 'En app.' })).state, 'review');
  assert.ok(!again.calls.some((c) => c.method === 'POST' && c.path === '/v1/betaAppReviewSubmissions'));

  // Asking how it is going changes nothing.
  const approved = fakeStore({ versions: [editable], builds: [build], review: 'APPROVED' });
  assert.deepEqual(await approved.store.shareStatus('app1', '202611200729'), { state: 'approved', url: undefined });
  assert.ok(approved.calls.every((c) => c.method === 'GET'));
  assert.equal((await fakeStore({ versions: [editable], builds: [build], review: 'REJECTED' }).store.shareStatus('app1', '202611200729')).state, 'rejected');
  assert.equal((await fakeStore({ versions: [editable], builds: [] }).store.shareStatus('app1', '202611200729')).state, 'processing');

  // The fast way: someone outside the team is invited to it, for this one app and nothing else.
  const tester = { email: 'Kund@Example.com', firstName: 'Kim', lastName: 'Kund' };
  const outsider = fakeStore({ versions: [editable], builds: [build] });
  assert.equal(await outsider.store.inviteAsTester('app1', tester), 'invited');
  const invitation = outsider.calls.find((c) => c.method === 'POST' && c.path === '/v1/userInvitations')!.body.data;
  assert.deepEqual(invitation.attributes, {
    email: 'Kund@Example.com', firstName: 'Kim', lastName: 'Kund', roles: ['DEVELOPER'], allAppsVisible: false, provisioningAllowed: false,
  });
  assert.deepEqual(invitation.relationships.visibleApps.data, [{ type: 'apps', id: 'app1' }]);
  assert.ok(!outsider.calls.some((c) => c.path.startsWith('/v1/betaTesters') && c.method === 'POST'), 'nobody is a tester before they have accepted');

  // Asked again while the invitation is waiting: no second invitation.
  const waiting = fakeStore({ versions: [editable], builds: [build], invitations: [{ id: 'i1', attributes: { email: 'kund@example.com' } }] });
  assert.equal(await waiting.store.inviteAsTester('app1', tester), 'invited');
  assert.ok(!waiting.calls.some((c) => c.method === 'POST'));

  // Once they are in the team they get to see the app, and are put in its internal group.
  const member = fakeStore({ versions: [editable], builds: [build], users: [{ id: 'u1', attributes: { username: 'kund@example.com', allAppsVisible: false } }] });
  assert.equal(await member.store.inviteAsTester('app1', tester), 'added');
  const posted = member.calls.filter((c) => c.method === 'POST').map((c) => c.path);
  assert.deepEqual(posted, ['/v1/users/u1/relationships/visibleApps', '/v1/betaGroups', '/v1/betaTesters']);
  assert.equal(member.calls.find((c) => c.path === '/v1/betaGroups' && c.method === 'POST')!.body.data.attributes.isInternalGroup, true);

  // The operator's own contact, as one line in the settings.
  assert.deepEqual(parseContact('Hugo Fredrik Jansson, +46 70 123 45 67, hugo@example.com'), {
    firstName: 'Hugo', lastName: 'Fredrik Jansson', phone: '+46 70 123 45 67', email: 'hugo@example.com', holder: '',
  });
  assert.equal(parseContact(''), null);
  assert.equal(parseContact('Hugo Jansson, 070 123 45 67, hugo@example.com'), null, 'the country code is needed');

  // What the worker tells the server, by what Apple answered
  const job = { projectId: 'abcdefgh1234', bundleId: 'app.appsmedjan.pabcdefgh1234', listing, screenshots: [shot.toString('base64')] };
  const account = { teamId: 'ABCDE12345', keyId: 'KEY1234567', issuerId: '69a6de70-03db-47e3-e053-5b8c7c11a4d1', key: pem };
  const worker = (appId: string | null, sync: () => Promise<{ attached: 'attached' }>) =>
    new Publisher(null, os.tmpdir(), {
      storeFor: () => ({
        ensureBundleId: async () => 'exists' as const,
        ensureAccountHolderTests: async () => true,
        appId: async () => appId,
        syncListing: sync,
        submitForReview: async () => { if (appId === 'refuses') throw new StoreError(409, 'not valid', 'App Privacy answers are missing.'); },
        inviteAsTester: async () => 'invited' as const,
        shareBuild: async () => ({ state: 'review' as const, url: 'https://testflight.apple.com/join/x' }),
        shareStatus: async () => ({ state: 'approved' as const, url: 'https://testflight.apple.com/join/x' }),
      }),
    });
  // Signing for the person's own phones: what is wrong is said before any archive is built.
  {
    const directJob = { projectId: 'abcdefgh1234', appName: 'App', bundleId: 'app.appsmedjan.pabcdefgh1234', buildNumber: '202611201600', files: {}, account };
    const phone = { udid: '00008110-000A1B2C3D4E5F60', name: 'Phone' };
    const signer = (ensurePhones: () => Promise<Array<{ udid: string; status: string }>>) =>
      new Publisher(null, os.tmpdir(), { storeFor: () => ({ ensureBundleId: async () => 'exists' as const, ensurePhones }) as never });
    const untouched = async () => { throw new Error('must not be called'); };
    assert.equal((await signer(untouched).direct({ ...directJob, phones: [] }, () => undefined)).error, 'no_phones');
    assert.equal((await signer(untouched).direct({ ...directJob, phones: [{ udid: 'not-a-udid', name: 'x' }] }, () => undefined)).error, 'internal');
    assert.equal((await signer(untouched).direct({ ...directJob, account: undefined, phones: [phone] }, () => undefined)).error, 'unavailable');
    assert.equal((await signer(async () => [{ udid: phone.udid, status: 'PROCESSING' }]).direct({ ...directJob, phones: [phone] }, () => undefined)).error, 'phone_processing');
    assert.equal(
      (await signer(async () => { throw new StoreError(409, 'App Store Connect answered 409: You have already reached the maximum allowed number of registered devices.'); }).direct({ ...directJob, phones: [phone] }, () => undefined)).error,
      'phone_limit',
    );
    assert.equal((await signer(async () => { throw new StoreError(401, 'bad token'); }).direct({ ...directJob, phones: [phone] }, () => undefined)).error, 'auth');
  }

  const never = async () => { throw new Error('must not be called'); };
  assert.deepEqual(await worker('app1', async () => ({ attached: 'attached' })).syncStore({ ...job, account }, () => undefined), { ok: true, attached: 'attached' });
  assert.equal((await worker(null, never).syncStore({ ...job, account }, () => undefined)).error, 'no_app_record');
  assert.equal((await worker('app1', never).syncStore(job, () => undefined)).error, 'unavailable', 'no account in the job and none on the worker');
  assert.equal((await worker('app1', never).syncStore({ ...job, account, listing: { ...listing, name: '' } }, () => undefined)).error, 'internal');
  assert.equal((await worker('app1', async () => { throw new StoreLocked('in review'); }).syncStore({ ...job, account }, () => undefined)).error, 'locked');
  assert.equal((await worker('app1', async () => { throw new StoreError(401, 'bad token'); }).syncStore({ ...job, account }, () => undefined)).error, 'auth');
  // Inviting testers is only ever done with the worker's own account, and this one has none.
  const inviteJob = { projectId: job.projectId, bundleId: job.bundleId, person: { email: 'kund@example.com', firstName: 'Kim', lastName: 'Kund' } };
  assert.equal((await worker('app1', never).invite(inviteJob)).error, 'unavailable');
  assert.equal((await worker('app1', never).invite({ ...inviteJob, person: { ...inviteJob.person, email: 'inte en adress' } })).error, 'internal');
  const shareJob = { projectId: job.projectId, bundleId: job.bundleId, build: '202611200729', account };
  assert.deepEqual(await worker('app1', never).share({ ...shareJob, contact }), { ok: true, state: 'review', url: 'https://testflight.apple.com/join/x' });
  assert.deepEqual(await worker('app1', never).share({ ...shareJob, check: true }), { ok: true, state: 'approved', url: 'https://testflight.apple.com/join/x' });
  assert.equal((await worker('app1', never).share(shareJob)).error, 'internal', 'preparing the link needs a contact');
  assert.equal((await worker(null, never).share({ ...shareJob, check: true })).error, 'no_app_record');
  assert.deepEqual(await worker('app1', never).submit({ projectId: job.projectId, bundleId: job.bundleId, account }), { ok: true });
  assert.equal((await worker(null, never).submit({ projectId: job.projectId, bundleId: job.bundleId, account })).error, 'no_app_record');
  assert.deepEqual(await worker('refuses', never).submit({ projectId: job.projectId, bundleId: job.bundleId, account }), {
    ok: false, error: 'rejected', detail: 'App Privacy answers are missing.',
  });
  assert.deepEqual(
    await worker('app1', async () => { throw new StoreError(409, 'App Store Connect answered 409', 'The app name is already being used.'); }).syncStore({ ...job, account }, () => undefined),
    { ok: false, error: 'rejected', detail: 'The app name is already being used.' },
  );
}

console.log('Unit checks passed.');
