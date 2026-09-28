// Round 4 core-level A/B: the managed Shell preview's stderr tail.
//
// Drives the REAL ShellExecutionService (child_process path, the only path a
// rawCapture sink can take — see tools/shell.ts `rawCapture ? false : pty`)
// against a REAL shell subprocess at the PRODUCTION preview budget (64 KiB,
// the value tools/shell.ts passes when a raw capture sink is installed).
//
// The capture sink is the one stand-in: it records byte-exact stdout/stderr
// and can delay stdout writes. That delay is what reproduces the mechanism
// round 3 measured end to end — captureData() pauses the stream's pipe and
// only feeds the preview rings after rawCapture.write() resolves, so a slow
// stdout publication lets an unpaused stderr line enter the rings first and
// the later stdout flood evict it. This reproduces the mechanism at the core
// seam, not the HTTP segment POST that triggers it in the Hosted worker.
//
// usage: tsx s9-stderr-preview.mts --tree <worktree> [--only <ids>] [--json <out>]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TREE = path.resolve(opt('tree') ?? '.');
const ONLY = opt('only')?.split(',');
const JSON_OUT = opt('json');

const mod = await import(
  pathToFileURL(path.join(TREE, 'packages/core/src/services/shellExecutionService.ts')).href
);
const { ShellExecutionService } = mod;

const BUDGET = 64 * 1024; // production value for the managed raw-capture path
const ERR_LINE = 'ERROR: build failed at step 7 (missing symbol rig_link_target)';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pr12894-r4-s9-'));

// --- generators -----------------------------------------------------------
// buildlog2.sh verbatim from the round-3 rig, so the reported repro is the
// same instrument that produced the round-3 measurement.
fs.writeFileSync(
  path.join(work, 'buildlog2.sh'),
  `#!/bin/sh
N=\${1:-3000}; P=\${2:-0}
i=1
while [ $i -le $N ]; do echo "compiling module \${i} of \${N} ... ok"; i=$((i+1)); done
[ "$P" != "0" ] && sleep $P
echo "${ERR_LINE}" >&2
exit 3
`
);
// stderr-only, exact byte length, optional trailing newline
fs.writeFileSync(
  path.join(work, 'erronly.sh'),
  `#!/bin/sh
BYTES=$1; NL=$2; ERR=$3
python3 - "$BYTES" "$NL" "$ERR" <<'PY'
import sys
n=int(sys.argv[1]); nl=sys.argv[2]=='1'; err=sys.argv[3]
pad='e'*(max(0,n-len(err)-(1 if nl else 0)))
sys.stdout.flush()
sys.stderr.write(pad+err+('\\n' if nl else ''))
sys.stderr.flush()
PY
exit 3
`
);
// CJK stderr of an exact byte length (3-byte chars) + final marker line
fs.writeFileSync(
  path.join(work, 'cjkerr.sh'),
  `#!/bin/sh
python3 - "$1" <<'PY'
import sys
n=int(sys.argv[1])
marker='\\u9519\\u8bef\\uff1a\\u6784\\u5efa\\u5931\\u8d25 step7'
mb=marker.encode()
pad=(('\\u9519'*(n//3+1)).encode())[:max(0,n-len(mb))]
sys.stderr.buffer.write(pad+mb)
sys.stderr.buffer.flush()
PY
exit 3
`
);
fs.writeFileSync(
  path.join(work, 'stdoutonly.sh'),
  `#!/bin/sh
python3 - "$1" <<'PY'
import sys
n=int(sys.argv[1])
sys.stdout.buffer.write(b'o'*n)
sys.stdout.buffer.flush()
PY
exit 0
`
);
for (const f of ['buildlog2.sh', 'erronly.sh', 'cjkerr.sh', 'stdoutonly.sh'])
  fs.chmodSync(path.join(work, f), 0o755);

// --- sink -----------------------------------------------------------------
function makeSink(stdoutDelayMs) {
  const buf = { stdout: [], stderr: [] };
  let finished = { stdout: null, stderr: null };
  return {
    buf,
    finished,
    sink: {
      async write(stream, chunk) {
        if (stream === 'stdout' && stdoutDelayMs)
          await new Promise((r) => setTimeout(r, stdoutDelayMs));
        buf[stream].push(Buffer.from(chunk));
      },
      async finish(stream, complete) {
        finished[stream] = complete;
      },
      setStarted() {},
      setProcessResult() {},
    },
    sha: (stream) => createHash('sha256').update(Buffer.concat(buf[stream])).digest('hex'),
    bytes: (stream) => buf[stream].reduce((n, b) => n + b.length, 0),
  };
}

async function run(cmd, { stdoutDelayMs = 0, timeoutMs = 120_000 } = {}) {
  const s = makeSink(stdoutDelayMs);
  const events = [];
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  const handle = await ShellExecutionService.execute(
    cmd,
    work,
    (e) => events.push(e),
    ac.signal,
    false, // shouldUseNodePty: false, as tools/shell.ts forces for rawCapture
    { maxBufferedOutputBytes: BUDGET },
    { rawCapture: s.sink }
  );
  const result = await handle.result;
  clearTimeout(t);
  const out = result.output ?? '';
  const recentIdx = out.indexOf('[Recent stderr]');
  const omittedIdx = out.indexOf('[Middle output omitted');
  return {
    result,
    out,
    s,
    exitCode: result.exitCode,
    hasErrLine: out.includes(ERR_LINE),
    errLineOccurrences: out.split(ERR_LINE).length - 1,
    hasOmissionNotice: omittedIdx >= 0,
    hasRecentStderr: recentIdx >= 0,
    recentStderrBlock: recentIdx >= 0 ? out.slice(recentIdx) : '',
    previewChars: out.length,
    // bytes of the tail section (between the omission notice and [Recent stderr])
    tailSectionChars:
      omittedIdx >= 0
        ? out.slice(out.indexOf('\n', omittedIdx) + 1, recentIdx >= 0 ? recentIdx : undefined).trim().length
        : 0,
    replacementChars: (out.match(/\uFFFD/g) ?? []).length,
    rawEvents: events.length,
  };
}

// --- assertions -----------------------------------------------------------
let pass = 0;
let fail = 0;
const rows = [];
function check(id, desc, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${id} ${desc}${detail ? ` :: ${detail}` : ''}`);
  rows.push({ id, desc, pass: !!cond, detail });
}
function note(id, desc, value) {
  console.log(`NOTE ${id} ${desc} = ${value}`);
  rows.push({ id, desc, note: value });
}

const scenarios = [];
const add = (id, fn) => scenarios.push({ id, fn });

// ===== A: the round-3 reported repro, real subprocess, production budget ====
for (const [n, delay] of [
  [30000, 20],
  [30000, 0],
  [10000, 20],
  [3000, 20],
  [1500, 20],
]) {
  add(`A-n${n}-d${delay}`, async () => {
    const r = await run(`sh ${path.join(work, 'buildlog2.sh')} ${n} 0`, { stdoutDelayMs: delay });
    note(`A-n${n}-d${delay}`, 'exitCode', r.exitCode);
    note(`A-n${n}-d${delay}`, 'stdoutBytesCaptured', r.s.bytes('stdout'));
    note(`A-n${n}-d${delay}`, 'previewChars', r.previewChars);
    note(`A-n${n}-d${delay}`, 'omissionNotice', r.hasOmissionNotice);
    note(`A-n${n}-d${delay}`, 'recentStderrBlock', r.hasRecentStderr);
    note(`A-n${n}-d${delay}`, 'errLineOccurrences', r.errLineOccurrences);
    check(`A-n${n}-d${delay}`, 'exit code is 3', r.exitCode === 3, `got ${r.exitCode}`);
    check(
      `A-n${n}-d${delay}`,
      'model preview contains the final stderr line',
      r.hasErrLine,
      `output tail: ${JSON.stringify(r.out.slice(-160))}`
    );
    check(
      `A-n${n}-d${delay}`,
      'durable capture is byte-exact (stderr)',
      r.s.sha('stderr') === createHash('sha256').update(ERR_LINE + '\n').digest('hex'),
      r.s.sha('stderr')
    );
    check(`A-n${n}-d${delay}`, 'durable capture finished complete', r.s.finished.stdout === true && r.s.finished.stderr === true, JSON.stringify(r.s.finished));
    return r;
  });
}

// ===== B: sibling sweep of the same mechanism =============================
add('B-stderr-first', async () => {
  // stderr written first, then ~1 MiB of stdout: the error line lands in the head.
  const r = await run(`sh -c 'echo "${ERR_LINE}" >&2; sh ${path.join(work, 'buildlog2.sh')} 30000 0 2>/dev/null'`, {
    stdoutDelayMs: 10,
  });
  check('B-stderr-first', 'final stderr line visible', r.hasErrLine);
  note('B-stderr-first', 'recentStderrBlock', r.hasRecentStderr);
});
add('B-huge-stderr', async () => {
  // 200 KiB of stderr whose last line is the marker, plus 1 MiB stdout.
  const r = await run(
    `sh -c 'sh ${path.join(work, 'buildlog2.sh')} 30000 0 2>/dev/null & python3 -c "import sys;sys.stderr.write(\'w\'*204800);sys.stderr.write(\'${ERR_LINE}\\n\');sys.stderr.flush()" ; wait'`,
    { stdoutDelayMs: 10 }
  );
  check('B-huge-stderr', 'marker survives 200 KiB of stderr', r.hasErrLine);
  note('B-huge-stderr', 'stderrBytes', r.s.bytes('stderr'));
});
add('B-long-stderr-line', async () => {
  // a single stderr line far larger than the 8 KiB reservation
  const r = await run(`sh ${path.join(work, 'erronly.sh')} 20480 1 "${ERR_LINE}"`, { stdoutDelayMs: 0 });
  note('B-long-stderr-line', 'stderrBytes', r.s.bytes('stderr'));
  check('B-long-stderr-line', 'the END of an over-long stderr line is visible', r.hasErrLine);
  note('B-long-stderr-line', 'recentBlockChars', r.recentStderrBlock.length);
});
add('B-stderr-only-60k', async () => {
  const r = await run(`sh ${path.join(work, 'erronly.sh')} 61440 1 "${ERR_LINE}"`, { stdoutDelayMs: 0 });
  note('B-stderr-only-60k', 'totalBytes', r.s.bytes('stderr'));
  note('B-stderr-only-60k', 'omissionNotice', r.hasOmissionNotice);
  check('B-stderr-only-60k', 'stderr-only 60 KiB keeps the last line', r.hasErrLine);
});
add('B-no-trailing-newline', async () => {
  const r = await run(`sh ${path.join(work, 'buildlog2.sh')} 30000 0 | cat; printf '%s' "${ERR_LINE}" >&2`, {
    stdoutDelayMs: 10,
  });
  check('B-no-trailing-newline', 'stderr without trailing newline is visible', r.hasErrLine);
});
add('B-cjk-boundary', async () => {
  // stderr whose 8 KiB window boundary lands inside a 3-byte character
  for (const total of [8192 + 1, 8192 + 2, 20000]) {
    const r = await run(`sh ${path.join(work, 'cjkerr.sh')} ${total}`, { stdoutDelayMs: 0 });
    note(`B-cjk-${total}`, 'stderrBytes', r.s.bytes('stderr'));
    note(`B-cjk-${total}`, 'replacementCharsInPreview', r.replacementChars);
    check(`B-cjk-${total}`, 'CJK marker visible', r.out.includes('step7'));
    check(
      `B-cjk-${total}`,
      'no U+FFFD introduced by the 8 KiB window boundary',
      r.replacementChars === 0,
      `count=${r.replacementChars} block=${JSON.stringify(r.recentStderrBlock.slice(0, 40))}`
    );
  }
});
add('B-ansi-stderr', async () => {
  const r = await run(
    `sh -c 'sh ${path.join(work, 'buildlog2.sh')} 30000 0 2>/dev/null; printf "\\033[31m${ERR_LINE}\\033[0m\\n" >&2; exit 3'`,
    { stdoutDelayMs: 10 }
  );
  check('B-ansi-stderr', 'coloured stderr line visible', r.hasErrLine);
  check('B-ansi-stderr', 'ANSI escapes stripped from [Recent stderr]', !/\u001b\[/.test(r.recentStderrBlock), JSON.stringify(r.recentStderrBlock.slice(0, 60)));
});

// ===== C: the budget/threshold shift nobody measured ======================
// completePreviewBytes moved 65536 -> 57344 and the read-order tail 32768 ->
// 24576. Characterise both, stdout-only so the stderr reservation cannot pay
// anything back.
for (const total of [55 * 1024, 56 * 1024, 57 * 1024, 60 * 1024, 63 * 1024, 64 * 1024, 65 * 1024, 80 * 1024]) {
  add(`C-${total}`, async () => {
    const r = await run(`sh ${path.join(work, 'stdoutonly.sh')} ${total}`, { stdoutDelayMs: 0 });
    note(`C-${total}`, 'omissionNotice', r.hasOmissionNotice);
    note(`C-${total}`, 'previewChars', r.previewChars);
    note(`C-${total}`, 'tailSectionChars', r.tailSectionChars);
    note(`C-${total}`, 'recentStderrBlock', r.hasRecentStderr);
    // A characterization, identical on both arms: the preview must show every
    // byte when the run fits the complete window, and must say so when it does not.
    check(
      `C-${total}`,
      'preview shape matches the branch it took',
      r.hasOmissionNotice === r.previewChars < total,
      `notice=${r.hasOmissionNotice} previewChars=${r.previewChars} total=${total}`
    );
    check(`C-${total}`, 'stdout-only run emits no [Recent stderr] block', !r.hasRecentStderr);
  });
}
add('C-duplication', async () => {
  // stderr last, small enough to also sit inside the read-order tail
  const r = await run(`sh -c 'sh ${path.join(work, 'buildlog2.sh')} 30000 0 2>/dev/null; echo "${ERR_LINE}" >&2; exit 3'`, {
    stdoutDelayMs: 10,
  });
  note('C-duplication', 'errLineOccurrences', r.errLineOccurrences);
  note('C-duplication', 'previewChars', r.previewChars);
  check('C-duplication', 'final stderr line visible', r.hasErrLine);
});
add('C-tail-shrink-1m', async () => {
  const r = await run(`sh ${path.join(work, 'stdoutonly.sh')} 1048576`, { stdoutDelayMs: 5 });
  note('C-tail-shrink-1m', 'tailSectionChars', r.tailSectionChars);
  note('C-tail-shrink-1m', 'previewChars', r.previewChars);
  check('C-tail-shrink-1m', 'preview stays within the 64 KiB budget', r.previewChars <= BUDGET + 512, `${r.previewChars}`);
});

// ===== D: durable capture integrity on the reported repro =================
add('D-bytes-1m', async () => {
  const r = await run(`sh -c 'sh ${path.join(work, 'buildlog2.sh')} 30000 0; exit 3'`, { stdoutDelayMs: 5 });
  const expectedStderr = createHash('sha256').update(ERR_LINE + '\n').digest('hex');
  check('D-bytes-1m', 'stderr durable bytes exact', r.s.sha('stderr') === expectedStderr);
  note('D-bytes-1m', 'stdoutBytes', r.s.bytes('stdout'));
  check('D-bytes-1m', 'stdout durable bytes > 1 MiB', r.s.bytes('stdout') > 1_000_000, `${r.s.bytes('stdout')}`);
  check('D-bytes-1m', 'both streams finished complete', r.s.finished.stdout === true && r.s.finished.stderr === true);
});

const selected = ONLY ? scenarios.filter((s) => ONLY.some((o) => s.id.startsWith(o))) : scenarios;
console.log(`# tree=${TREE}`);
console.log(`# node=${process.version} budget=${BUDGET} scenarios=${selected.length}`);
for (const s of selected) {
  try {
    await s.fn();
  } catch (e) {
    fail++;
    console.log(`FAIL ${s.id} scenario threw :: ${e?.stack?.split('\n').slice(0, 3).join(' | ')}`);
    rows.push({ id: s.id, pass: false, detail: String(e?.message ?? e) });
  }
}
console.log(`# SUMMARY pass=${pass} fail=${fail}`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ tree: TREE, pass, fail, rows }, null, 1));
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
