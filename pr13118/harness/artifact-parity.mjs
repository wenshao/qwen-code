// Production artifact parity between two builds of the same production source.
// The bundle's chunk file names are content hashes and the build embeds the
// short commit id, so each file is normalized (commit id -> GITSHA, chunk hash
// -> HASH) and the two trees are compared as multisets of normalized bytes.
// Jars are compared by CRC-32 of every entry (timestamps ignored).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const arms = { pr: '7326290a04', base: 'd3c2edc606' };

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}
const CHUNK = /([A-Za-z0-9_$.-]+?)-[A-Z0-9]{8}(\.(?:js|css|mjs))/g;
function normalized(root, sha, { skip = () => false } = {}) {
  const hashes = [];
  let count = 0;
  for (const f of files(root)) {
    const rel = path.relative(root, f);
    if (skip(rel)) continue;
    count++;
    let text = fs.readFileSync(f).toString('latin1');
    text = text.split(sha).join('GITSHA').replace(CHUNK, '$1-HASH$2');
    const name = rel.replace(CHUNK, '$1-HASH$2');
    hashes.push(`${name}\t${createHash('sha256').update(text).digest('hex')}`);
  }
  hashes.sort();
  return { count, digest: createHash('sha256').update(hashes.join('\n')).digest('hex').slice(0, 16), hashes };
}

function report(label, a, b) {
  const same = a.digest === b.digest;
  const onlyA = a.hashes.filter((h) => !b.hashes.includes(h));
  const onlyB = b.hashes.filter((h) => !a.hashes.includes(h));
  console.log(`${label}: files pr=${a.count} base=${b.count} normalized digest pr=${a.digest} base=${b.digest} ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
  for (const h of onlyA.slice(0, 8)) console.log(`  only pr:   ${h}`);
  for (const h of onlyB.slice(0, 8)) console.log(`  only base: ${h}`);
  return same;
}

const isMap = (rel) => rel.endsWith('.map') || rel.endsWith('.tsbuildinfo');
// 1. The shipped bundle (dist/ at the repository root).
report('bundle dist/', normalized(`${SP}/wt-pr/dist`, arms.pr, { skip: isMap }), normalized(`${SP}/wt-base/dist`, arms.base, { skip: isMap }));
// 2. Compiled packages, production files only (test outputs excluded).
const isTest = (rel) => isMap(rel) || /\.test\.(js|d\.ts)$/.test(rel) || rel.includes('/__tests__/') || rel.includes('test-utils');
for (const pkg of ['cli', 'core']) {
  report(`packages/${pkg}/dist (non-test)`, normalized(`${SP}/wt-pr/packages/${pkg}/dist`, arms.pr, { skip: isTest }), normalized(`${SP}/wt-base/packages/${pkg}/dist`, arms.base, { skip: isTest }));
}
// 3. The test output that differs (expected: the one changed test file).
const testOnly = (rel) => !/\.test\.js$/.test(rel);
const t = [normalized(`${SP}/wt-pr/packages/cli/dist`, arms.pr, { skip: testOnly }), normalized(`${SP}/wt-base/packages/cli/dist`, arms.base, { skip: testOnly })];
const changed = t[0].hashes.filter((h) => !t[1].hashes.includes(h)).map((h) => h.split('\t')[0]);
console.log(`packages/cli/dist compiled tests: ${t[0].count} files, differing: ${changed.join(', ') || 'none'}`);

// 4. Jars: CRC of every entry.
function crcs(jar) {
  const out = execFileSync('unzip', ['-v', jar], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+([0-9a-f]{8})\s+(.+)$/);
    if (m) rows.push(`${m[3]}\t${m[2]}\t${m[1]}`);
  }
  return rows.sort();
}
for (const [label, a, b] of [
  ['managed-agent-server jar', `${SP}/jars/pr-server.jar`, `${SP}/jars/base-server.jar`],
  ['runtime-broker jar', `${SP}/jars/pr-qwen-managed-runtime-broker-0.1.0-alpha.jar`, `${SP}/jars/base-qwen-managed-runtime-broker-0.1.0-alpha.jar`],
  ['runtime-broker tests jar', `${SP}/jars/pr-qwen-managed-runtime-broker-0.1.0-alpha-tests.jar`, `${SP}/jars/base-qwen-managed-runtime-broker-0.1.0-alpha-tests.jar`],
]) {
  const x = crcs(a);
  const y = crcs(b);
  let diff = x.filter((r) => !y.includes(r));
  // A nested jar differs byte-wise when its entries carry new timestamps;
  // compare its entries by CRC instead.
  const nested = [];
  diff = diff.filter((row) => {
    const name = row.split('\t')[0];
    if (!name.endsWith('.jar')) return true;
    const dir = fs.mkdtempSync(path.join(SP, 'nested-'));
    execFileSync('unzip', ['-q', '-o', a, name, '-d', path.join(dir, 'a')]);
    execFileSync('unzip', ['-q', '-o', b, name, '-d', path.join(dir, 'b')]);
    const ia = crcs(path.join(dir, 'a', name));
    const ib = crcs(path.join(dir, 'b', name));
    const d = ia.filter((r) => !ib.includes(r));
    nested.push(`${name.split('/').pop()}: ${ia.length} entries, ${d.length} differing by CRC${d.length ? ' ' + d.slice(0, 3).join(' ; ') : ''}`);
    return d.length > 0;
  });
  if (nested.length) console.log(`  nested: ${nested.join(' ; ')}`);
  console.log(`${label}: entries pr=${x.length} base=${y.length} differing=${diff.length}${diff.length ? ' :: ' + diff.slice(0, 5).join(' ; ') : ' IDENTICAL CRCs'}`);
}
