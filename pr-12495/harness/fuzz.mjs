// Two-arm differential fuzz of classifySedCommandSafety + real GNU sed ground truth.
// For every vector: classify with base and head; for every vector either arm calls
// read-only (and every vector whose verdict changed), run real GNU sed in a fresh
// sandbox dir and record whether it created/modified/deleted any file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as base from './arms/base.mjs';
import * as head from './arms/head.mjs';

const N = Number(process.argv[2] ?? 60000);
let seed = 12495;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const OPTS = [
  ['-n'], ['--quiet'], ['--silent'], ['--qui'], ['--sil'], ['--q'], ['--s'],
  ['--quiet=x'], ['--silent=1'], ['-s'], ['-E'], ['-r'], ['-u'], ['-z'], ['-nE'],
  ['--posix'], ['--debug'], ['--sandbox'], ['--separate'], ['--null-data'],
  ['--follow-symlinks'], ['--regexp-extended'], ['--unbuffered'], ['--zero-terminated'],
  ['-l', '5'], ['--line-length=5'], ['--line-length', '5'], ['-i'], ['-i.bak'],
  ['--in-place'], ['--in-place=.bak'], ['-f', 'scr'], ['--file=scr'], ['--help'],
  ['--version'], ['--QUIET'], ['---quiet'], ['--quiet', '--silent'], ['-n', '--quiet'],
  ['--expression=p'], ['--expression=w out'], ['-ep'], ['--', ], ['-'],
];
const SCRIPTS = [
  'p', '1p', '$p', 's/a/b/', 's/a/b/p', 's/a/b/gp', 's/a/b/w out', 'w out', 'W out',
  'r in2', 'R in2', 'e touch PWN', 's/a/touch PWN2/e', '1d', 'p;w out2', 'p\nw out3',
  'q', 'l', '=', 'y/a/b/', 'F', 'z', 'Q', 'n;p', '/a/p', '/a/w out4', 's|a|b|w out5',
  '1{p}', '1{w out6\n}', 'x;G', 'v', '0~1p', 's/a/b/e', 'l 0', 'w /dev/stdout',
];
const FILES = ['file', 'file2', 'nonexist'];

function gen() {
  const out = [];
  const n = 1 + Math.floor(rnd() * 5);
  let haveScript = false;
  for (let k = 0; k < n; k++) {
    const r = rnd();
    if (r < 0.45) out.push(...pick(OPTS));
    else if (r < 0.6) out.push(pick(['-e', '--expression']), pick(SCRIPTS));
    else if (!haveScript) { out.push(pick(SCRIPTS)); haveScript = true; }
    else out.push(pick(FILES));
  }
  if (rnd() < 0.7) out.push(pick(FILES));
  return out;
}

// Deterministic exhaustive part: every opt × every script × file, and opt pairs.
const vectors = [];
for (const o of OPTS) for (const s of SCRIPTS) {
  vectors.push([...o, s, 'file']);
  vectors.push([s, ...o, 'file']);
}
for (const o1 of OPTS) for (const o2 of OPTS) for (const s of ['p', 's/a/b/', 'w out', 'e touch PWN'])
  vectors.push([...o1, ...o2, s, 'file']);
for (let i = 0; i < N; i++) vectors.push(gen());

const seen = new Set();
const uniq = vectors.filter((v) => { const k = JSON.stringify(v); if (seen.has(k)) return false; seen.add(k); return true; });

function snapshot(dir) {
  const m = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    m[f] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
  }
  return JSON.stringify(m);
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sedfuzz-'));
let runIdx = 0;
function realSed(args) {
  const dir = path.join(tmpRoot, String(runIdx++));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'file'), 'a\nb\nabc\n');
  fs.writeFileSync(path.join(dir, 'file2'), 'xa\n');
  fs.writeFileSync(path.join(dir, 'in2'), 'IN2\n');
  fs.writeFileSync(path.join(dir, 'scr'), 'w outscr\n');
  const before = snapshot(dir);
  const r = spawnSync('sed', args, { cwd: dir, timeout: 3000, input: 'stdin-a\n', encoding: 'utf8' });
  const after = snapshot(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { effect: before !== after, status: r.status, stdout: r.stdout, stderr: (r.stderr || '').split('\n')[0] };
}

const transitions = {};
const changed = [];
let ranSed = 0;
const violations = { base: [], head: [] };
for (const v of uniq) {
  const b = base.classifySedCommandSafety(v);
  const h = head.classifySedCommandSafety(v);
  const key = `${b}->${h}`;
  transitions[key] = (transitions[key] ?? 0) + 1;
  if (b !== h) changed.push({ v, b, h });
  if (b === 'read-only' || h === 'read-only' || b !== h) {
    ranSed++;
    const g = realSed(v);
    if (g.effect && h === 'read-only') violations.head.push({ v, g });
    if (g.effect && b === 'read-only') violations.base.push({ v, g });
    if (b !== h) changed.at(-1).ground = g;
  }
}

// Distinct shapes of the changed set: which args are responsible.
const changedTokens = {};
for (const c of changed) {
  const t = c.v.filter((a) => a.startsWith('--') && !/^--(line-length|expression)/.test(a)).join(' ') || '(none)';
  changedTokens[`${t}  ${c.b}->${c.h}`] = (changedTokens[`${t}  ${c.b}->${c.h}`] ?? 0) + 1;
}
// Real-sed alias ground truth: --quiet / --silent produce byte-identical output to -n.
const alias = [];
for (const s of SCRIPTS.filter((s) => !/[wWe]\b|w |e /.test(s))) {
  const n = realSed(['-n', s, 'file']).stdout;
  alias.push({ s, quiet: realSed(['--quiet', s, 'file']).stdout === n, silent: realSed(['--silent', s, 'file']).stdout === n });
}
const report = {
  vectors: uniq.length, ranRealSed: ranSed, transitions, changed: changed.length,
  changedTokens, violations: { base: violations.base.length, head: violations.head.length },
  headViolationSamples: violations.head.slice(0, 5), baseViolationSamples: violations.base.slice(0, 5),
  changedSamples: changed.slice(0, 12).map((c) => ({ argv: c.v, base: c.b, head: c.h, realSedWrote: c.ground?.effect })),
  changedWithRealWrite: changed.filter((c) => c.ground?.effect).map((c) => ({ argv: c.v, base: c.b, head: c.h })).slice(0, 10),
  changedWithRealWriteCount: changed.filter((c) => c.ground?.effect).length,
  aliasIdenticalToN: alias.every((a) => a.quiet && a.silent), aliasChecked: alias.length,
};
fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.writeFileSync('fuzz-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
// appended: list changed unknown->write vectors whose real sed run did not write
if (process.env.LIST_NOWRITE) for (const c of changed) if (c.h === 'write' && !c.ground?.effect) console.error('NOWRITE', JSON.stringify(c.v), c.ground?.status, c.ground?.stderr);
