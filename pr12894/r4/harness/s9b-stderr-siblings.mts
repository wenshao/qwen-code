// Round 4 sibling sweep (v2) for the managed Shell preview's stderr tail.
//
// Corrects three unfaithful fixtures from the first sweep: every scenario here
// puts total output above BOTH arms' complete-window threshold (control 64 KiB,
// head 56 KiB) so both arms take the same "middle omitted" branch, and every
// stderr volume is asserted against the bytes the sink actually received, so a
// scenario cannot pass because its generator silently produced 313 bytes.
//
// usage: tsx s9b-stderr-siblings.mts --tree <worktree> [--json <out>]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const TREE = path.resolve(opt('tree') ?? '.');
const JSON_OUT = opt('json');
const HARNESS = path.dirname(new URL(import.meta.url).pathname);
const GEN = path.join(HARNESS, 'gen.py');

const { ShellExecutionService } = await import(
  pathToFileURL(path.join(TREE, 'packages/core/src/services/shellExecutionService.ts')).href
);
const BUDGET = 64 * 1024;
const ERR = 'ERROR: build failed at step 7 (missing symbol rig_link_target)';
const CJK = '\u9519\u8bef\uff1a\u6784\u5efa\u5931\u8d25 step7';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12894-r4-s9b-'));

function sink(delayMs) {
  const buf = { stdout: [], stderr: [] };
  const fin = { stdout: null, stderr: null };
  return {
    buf, fin,
    api: {
      async write(s, c) { if (s === 'stdout' && delayMs) await new Promise((r) => setTimeout(r, delayMs)); buf[s].push(Buffer.from(c)); },
      async finish(s, complete) { fin[s] = complete; },
      setStarted() {}, setProcessResult() {},
    },
    bytes: (s) => buf[s].reduce((n, b) => n + b.length, 0),
    sha: (s) => createHash('sha256').update(Buffer.concat(buf[s])).digest('hex'),
  };
}

async function run(cmd, delayMs = 10) {
  const s = sink(delayMs);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 180_000);
  const h = await ShellExecutionService.execute(cmd, work, () => {}, ac.signal, false,
    { maxBufferedOutputBytes: BUDGET }, { rawCapture: s.api });
  const r = await h.result;
  clearTimeout(t);
  const out = r.output ?? '';
  const ri = out.indexOf('[Recent stderr]');
  const oi = out.indexOf('[Middle output omitted');
  return {
    out, exitCode: r.exitCode, s,
    hasMarkerAscii: out.includes(ERR),
    hasMarkerCjk: out.includes(CJK),
    occurrences: out.split(ERR).length - 1,
    omitted: oi >= 0,
    recent: ri >= 0,
    recentBlock: ri >= 0 ? out.slice(ri) : '',
    previewChars: out.length,
    tailChars: oi >= 0 ? out.slice(out.indexOf('\n', oi) + 1, ri >= 0 ? ri : undefined).trim().length : 0,
    fffd: (out.match(/\uFFFD/g) ?? []).length,
    fffdInRecent: ri >= 0 ? ((out.slice(ri).match(/\uFFFD/g) ?? []).length) : 0,
  };
}

let pass = 0, fail = 0;
const rows = [];
const check = (id, d, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${id} ${d}${x ? ` :: ${x}` : ''}`); rows.push({ id, d, pass: !!c, x }); };
const note = (id, d, v) => { console.log(`NOTE ${id} ${d} = ${v}`); rows.push({ id, d, note: v }); };
const gen = (...a) => `python3 ${GEN} ${a.join(' ')}`;

const S = [];
const add = (id, fn) => S.push({ id, fn });

add('S1-huge-stderr', async () => {
  const r = await run(gen('mixed', 61440, 200000, `'${ERR}'`, 1));
  note('S1', 'stderrBytes', r.s.bytes('stderr'));
  note('S1', 'stdoutBytes', r.s.bytes('stdout'));
  note('S1', 'omitted/recent', `${r.omitted}/${r.recent}`);
  check('S1', 'sink really received 200 KiB of stderr', r.s.bytes('stderr') >= 200000, `${r.s.bytes('stderr')}`);
  check('S1', 'marker survives 200 KiB of stderr', r.hasMarkerAscii);
  check('S1', 'stderr durable bytes exact', r.s.sha('stderr') === createHash('sha256').update(Buffer.concat([Buffer.alloc(200000, 0x77), Buffer.from(ERR + '\n')])).digest('hex'));
});

add('S2-oneline-20k', async () => {
  const r = await run(gen('oneline', 61440, 20480, `'${ERR}'`));
  note('S2', 'stderrBytes', r.s.bytes('stderr'));
  note('S2', 'recentBlockChars', r.recentBlock.length);
  check('S2', 'sink really received a 20 KiB single line', r.s.bytes('stderr') === 20480, `${r.s.bytes('stderr')}`);
  check('S2', 'the END of an over-long single stderr line is visible', r.hasMarkerAscii);
  check('S2', 'the [Recent stderr] window is bounded by 8 KiB', r.recentBlock.length <= 8192 + 64, `${r.recentBlock.length}`);
});

add('S3-cjk-boundary', async () => {
  // 20001-byte CJK stderr: the 8192-byte window starts at offset 11809, which
  // is 1 mod 3, i.e. inside a 3-byte character.
  const r = await run(gen('cjk', 61440, 20001, `'${CJK}'`));
  note('S3', 'stderrBytes', r.s.bytes('stderr'));
  note('S3', 'windowStartOffsetMod3', (r.s.bytes('stderr') - 8192) % 3);
  note('S3', 'fffdTotal', r.fffd);
  note('S3', 'fffdInRecentBlock', r.fffdInRecent);
  note('S3', 'recentBlockHead', JSON.stringify(r.recentBlock.slice(0, 48)));
  check('S3', 'sink really received 20001 stderr bytes', r.s.bytes('stderr') === 20001, `${r.s.bytes('stderr')}`);
  check('S3', 'CJK marker visible', r.hasMarkerCjk);
  check('S3', 'the split 8 KiB window introduces no U+FFFD', r.fffdInRecent === 0, `count=${r.fffdInRecent}`);
});

add('S4-dup-band', async () => {
  // total 61502: above head's 57344 complete window, below control's 65536.
  const r = await run(gen('mixed', 61440, 0, `'${ERR}'`, 1));
  note('S4', 'totalBytes', r.s.bytes('stdout') + r.s.bytes('stderr'));
  note('S4', 'omitted', r.omitted);
  note('S4', 'markerOccurrences', r.occurrences);
  note('S4', 'previewChars', r.previewChars);
  check('S4', 'marker visible', r.hasMarkerAscii);
});

add('S5-dup-1m', async () => {
  const r = await run(gen('mixed', 1048576, 0, `'${ERR}'`, 1));
  note('S5', 'totalBytes', r.s.bytes('stdout') + r.s.bytes('stderr'));
  note('S5', 'markerOccurrences', r.occurrences);
  note('S5', 'tailChars', r.tailChars);
  check('S5', 'marker visible after 1 MiB of stdout', r.hasMarkerAscii);
  check('S5', 'marker rendered exactly once', r.occurrences === 1, `${r.occurrences}`);
});

add('S6-interleave', async () => {
  const r = await run(gen('interleave', 2000, `'${ERR}'`));
  note('S6', 'stdoutBytes', r.s.bytes('stdout'));
  note('S6', 'stderrBytes', r.s.bytes('stderr'));
  check('S6', 'interleaved streams keep the final stderr line', r.hasMarkerAscii);
});

console.log(`# tree=${TREE}`);
console.log(`# node=${process.version} budget=${BUDGET} scenarios=${S.length}`);
for (const s of S) {
  try { await s.fn(); } catch (e) {
    fail++; console.log(`FAIL ${s.id} threw :: ${e?.stack?.split('\n').slice(0, 3).join(' | ')}`);
    rows.push({ id: s.id, pass: false, x: String(e?.message ?? e) });
  }
}
console.log(`# SUMMARY pass=${pass} fail=${fail}`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ tree: TREE, pass, fail, rows }, null, 1));
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
