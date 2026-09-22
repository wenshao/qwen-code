// Differential oracle: does the PR's NODE_OPTIONS rewrite preserve what the
// real Node binary parses out of the original string?
//
// For each input S (no heap flags), compare
//   node(NODE_OPTIONS=S)            -> {exit, report.filename, report.directory, stderr[0]}
//   node(NODE_OPTIONS=rewrite(S))   -> same tuple
// where rewrite = applyChildHeapLimit([], {NODE_OPTIONS:S}, 768) from the PR.
// If the PR throws, the original must also be rejected by Node.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { applyChildHeapLimit } from './child-heap-args.mjs';

const bins = process.argv.slice(2);
const N = Number(process.env.N ?? 1500);
let seed = Number(process.env.SEED ?? 12353);
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ALPHA = ['a', 'b', ' ', '"', '\\', '=', '-', 'x', '\t'];
const val = () => {
  let s = '';
  const n = 1 + Math.floor(rnd() * 8);
  for (let i = 0; i < n; i++) s += pick(ALPHA);
  return s;
};
const tokens = [
  () => `--report-filename=${val()}`,
  () => `--report-filename ${val()}`,
  () => `--report-dir=${val()}`,
  () => `"--report-dir=${val()}"`,
  () => `--report-filename="${val()}"`,
  () => `--report-dir "${val()}"`,
];
const gen = () => {
  const n = 1 + Math.floor(rnd() * 3);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(pick(tokens)());
  return parts.join(pick([' ', '  ']));
};

const hand = [
  '--report-filename="C:\\tools\\hook.cjs"',
  '--report-filename=C:\\tools\\hook.cjs',
  '--report-filename="C:\\\\tools\\\\hook.cjs"',
  '--report-filename=C:\\\\tools\\\\hook.cjs',
  '--report-filename="a\\"b"',
  '--report-filename="a b" --report-dir="c\\\\d e"',
  '--report-filename=""',
  '--report-filename "x\\ty"',
  '--report-filename="trailing\\',
  '--report-filename="unterminated',
];

const inputs = [...hand];
while (inputs.length < N) inputs.push(gen());

const probe =
  'process.stdout.write(JSON.stringify([process.report.filename, process.report.directory]))';
const run = (bin, nodeOptions) =>
  new Promise((resolve) => {
    const env = { PATH: process.env.PATH, NODE_OPTIONS: nodeOptions };
    const child = spawn(bin, ['-e', probe], { env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) =>
      resolve({
        code,
        out,
        err: err.split('\n').find((l) => l.trim()) ?? '',
      }),
    );
  });

async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        res[k] = await fn(items[k], k);
      }
    }),
  );
  return res;
}

const summary = {};
const mismatches = [];
for (const bin of bins) {
  const version = (await run(bin, '')).out ? '' : '';
  const stats = {
    inputs: inputs.length,
    nodeAccepted: 0,
    nodeRejected: 0,
    prRewrote: 0,
    prThrew: 0,
    equal: 0,
    mismatch: 0,
    prThrewNodeAccepted: 0,
  };
  await pool(inputs, 16, async (s) => {
    const orig = await run(bin, s);
    if (orig.code === 0) stats.nodeAccepted++;
    else stats.nodeRejected++;
    let rewritten;
    try {
      const env = { NODE_OPTIONS: s };
      applyChildHeapLimit([], env, 768);
      rewritten = env.NODE_OPTIONS;
      stats.prRewrote++;
    } catch (e) {
      stats.prThrew++;
      if (orig.code === 0) {
        stats.prThrewNodeAccepted++;
        mismatches.push({ bin, s, kind: 'pr-threw-node-accepted', orig, e: String(e) });
      }
      return;
    }
    const again = await run(bin, rewritten);
    const same =
      again.code === orig.code &&
      again.out === orig.out &&
      (orig.code === 0 || again.err === orig.err);
    if (same) stats.equal++;
    else {
      stats.mismatch++;
      mismatches.push({ bin, s, rewritten, orig, again });
    }
  });
  summary[bin] = stats;
  void version;
}
const handResults = [];
for (const bin of bins) {
  for (const s of hand) {
    const orig = await run(bin, s);
    let rewritten = null;
    let threw = null;
    try {
      const env = { NODE_OPTIONS: s };
      applyChildHeapLimit([], env, 768);
      rewritten = env.NODE_OPTIONS;
    } catch (e) {
      threw = String(e.message);
    }
    const again = rewritten === null ? null : await run(bin, rewritten);
    handResults.push({ bin: bin.split('/').slice(-3)[0], s, orig, rewritten, threw, again });
  }
}
writeFileSync(
  new URL('./roundtrip-result.json', import.meta.url),
  JSON.stringify({ summary, mismatches: mismatches.slice(0, 50), handResults }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
console.log('mismatches:', mismatches.length);
for (const m of mismatches.slice(0, 10)) console.log(JSON.stringify(m));
