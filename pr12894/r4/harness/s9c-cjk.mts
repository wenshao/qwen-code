// Round 4: can the model actually READ a non-ASCII error line from the new
// [Recent stderr] block?
//
// decodeBufferedOutput() asks getCachedEncodingForBuffer(), which returns
// 'utf-8' only when isUtf8(buffer) is true and otherwise falls back to the
// system codepage / chardet. A ring-buffer window that starts inside a
// multi-byte character is therefore NOT valid UTF-8 and gets decoded with a
// legacy codepage. The marker length picks the alignment deterministically:
// with 3-byte CJK padding, windowStart = 3k + markerBytes - 8192, so
// markerBytes % 3 == 2 (8192 % 3) aligns the window and anything else does not.
//
// usage: tsx s9c-cjk.mts --tree <worktree> [--json <out>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const TREE = path.resolve(opt('tree') ?? '.');
const JSON_OUT = opt('json');
const HARNESS = path.dirname(new URL(import.meta.url).pathname);

const { ShellExecutionService } = await import(
  pathToFileURL(path.join(TREE, 'packages/core/src/services/shellExecutionService.ts')).href
);
const BUDGET = 64 * 1024;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12894-r4-s9c-'));
const GEN = path.join(work, 'cjk2.py');
fs.writeFileSync(GEN, `
import sys
n_out=int(sys.argv[1]); pad=int(sys.argv[2]); marker=sys.argv[3]
sys.stdout.buffer.write(b'o'*n_out); sys.stdout.buffer.flush()
sys.stderr.buffer.write(('\u9519'*pad).encode()+marker.encode()); sys.stderr.buffer.flush()
sys.exit(3)
`);

const M27 = '\u9519\u8bef\uff1a\u6784\u5efa\u5931\u8d25 step7';      // 27 bytes -> window misaligned
const M29 = '\u9519\u8bef\uff1a\u6784\u5efa\u5931\u8d25 step7XY';    // 29 bytes -> window aligned
const ASCII = 'ERROR: build failed at step 7 (missing symbol rig_link_target)';

async function run(cmd, delayMs = 10) {
  const buf = { stdout: [], stderr: [] };
  const sink = {
    async write(s, c) { if (s === 'stdout' && delayMs) await new Promise((r) => setTimeout(r, delayMs)); buf[s].push(Buffer.from(c)); },
    async finish() {}, setStarted() {}, setProcessResult() {},
  };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 180_000);
  const h = await ShellExecutionService.execute(cmd, work, () => {}, ac.signal, false,
    { maxBufferedOutputBytes: BUDGET }, { rawCapture: sink });
  const r = await h.result;
  clearTimeout(t);
  const out = r.output ?? '';
  const ri = out.indexOf('[Recent stderr]');
  const oi = out.indexOf('[Middle output omitted');
  const tail = oi >= 0 ? out.slice(out.indexOf('\n', oi) + 1, ri >= 0 ? ri : undefined) : '';
  return {
    out, exitCode: r.exitCode,
    stderrBytes: buf.stderr.reduce((n, b) => n + b.length, 0),
    omitted: oi >= 0, recent: ri >= 0,
    block: ri >= 0 ? out.slice(ri) : '',
    markerOccurrences: 0,
    tailCjk: tail.includes('\u9519'),           // correctly-decoded CJK padding in the tail
    tailMojibake: /[\u25A0\u2265\u0418\uFFFD]/.test(tail),
    blockCjk: ri >= 0 ? out.slice(ri).includes('\u9519') : false,
    blockMojibake: ri >= 0 ? /[\u25A0\u2265\u0418\uFFFD]/.test(out.slice(ri)) : false,
    previewChars: out.length,
  };
}

let pass = 0, fail = 0;
const rows = [];
const check = (id, d, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${id} ${d}${x ? ` :: ${x}` : ''}`); rows.push({ id, d, pass: !!c, x }); };
const note = (id, d, v) => { console.log(`NOTE ${id} ${d} = ${v}`); rows.push({ id, d, note: v }); };
const gen = (n, pad, marker) => `python3 ${GEN} ${n} ${pad} '${marker}'`;

const S = [];
const add = (id, fn) => S.push({ id, fn });

add('T1-cjk-misaligned', async () => {
  const r = await run(gen(61440, 13000, M27));
  const visible = r.out.includes(M27);
  note('T1', 'stderrBytes', r.stderrBytes);
  note('T1', 'windowStartMod3', (r.stderrBytes - 8192) % 3);
  note('T1', 'blockPresent', r.recent);
  note('T1', 'blockCjkDecoded', r.blockCjk);
  note('T1', 'blockMojibake', r.blockMojibake);
  note('T1', 'tailCjkDecoded', r.tailCjk);
  note('T1', 'tailMojibake', r.tailMojibake);
  note('T1', 'blockSample', JSON.stringify(r.block.slice(0, 60)));
  check('T1', 'the CJK error line is readable by the model', visible, `markerFound=${visible}`);
});

add('T3-cjk-aligned', async () => {
  const r = await run(gen(61440, 13000, M29));
  const visible = r.out.includes(M29);
  note('T3', 'stderrBytes', r.stderrBytes);
  note('T3', 'windowStartMod3', (r.stderrBytes - 8192) % 3);
  note('T3', 'blockCjkDecoded', r.blockCjk);
  note('T3', 'blockMojibake', r.blockMojibake);
  note('T3', 'blockSample', JSON.stringify(r.block.slice(0, 60)));
  check('T3', 'the aligned CJK error line is readable', visible);
});

add('T2-ascii-control', async () => {
  const r = await run(`python3 -c "import sys;sys.stdout.buffer.write(b'o'*61440);sys.stdout.flush();sys.stderr.buffer.write(b'w'*39000+b'${ASCII}\\n');sys.stderr.flush();sys.exit(3)"`);
  note('T2', 'stderrBytes', r.stderrBytes);
  note('T2', 'blockPresent', r.recent);
  check('T2', 'the ASCII error line is readable at the same size', r.out.includes(ASCII));
});

add('T4-cjk-huge', async () => {
  // stderr far larger than both windows: neither the combined tail nor the
  // stderr ring can start on a character boundary by construction.
  const r = await run(gen(61440, 40000, M27));
  note('T4', 'stderrBytes', r.stderrBytes);
  note('T4', 'tailCjkDecoded', r.tailCjk);
  note('T4', 'tailMojibake', r.tailMojibake);
  note('T4', 'blockCjkDecoded', r.blockCjk);
  note('T4', 'blockMojibake', r.blockMojibake);
  check('T4', 'exit code still reported', r.exitCode === 3, `${r.exitCode}`);
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
process.exit(0);
