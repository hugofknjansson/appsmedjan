import assert from 'node:assert';
import { JpegSplitter } from '../worker/src/stream';
import { extractErrors, projectSpec } from '../worker/src/xcode';
import { decodeFrame, encodeFrame, isValidSourcePath } from '../shared/protocol';

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

console.log('Unit checks passed.');
