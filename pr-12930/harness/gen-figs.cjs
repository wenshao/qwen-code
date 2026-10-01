// Build ANSI transcripts for the figures from the raw run data.
const fs = require('fs'), path = require('path');
const ROOT = '/root/verify/pr12930';
const R = fs.readFileSync(ROOT + '/results.tsv', 'utf8').trim().split('\n').map((l) => {
  const [tag, arm, fault, scope, rc, ms, summary] = l.split('\t');
  return { tag, arm, fault, scope, rc: +rc, ms: +ms, summary: summary || '' };
}).filter((r) => r.summary); // drop invalid runs (no test executed)
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', m: '\x1b[35m', c: '\x1b[36m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m', gr: '\x1b[90m' };
const tl = (tag) => {
  const L = fs.readFileSync(`${ROOT}/runs/${tag}/timeline.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  return L.filter((e) => e.ev !== 'preload_active');
};
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const cell = (s, n) => s + ' '.repeat(Math.max(0, n - vis(s).length));
const stat = (rows) => { const p = rows.filter((r) => r.rc === 0).length; return { p, n: rows.length }; };
const pf = ({ p, n }, goodIsPass = true) => {
  const col = p === n ? C.g : p === 0 ? C.r : C.y;
  return `${col}${p}/${n} pass${C.x}`;
};

// ---------- Fig 1: ordering timeline ----------
function timelineBlock(tag, label) {
  const L = tl(tag); const g = L.find((e) => e.ev === 'sse_get_dispatch'); const out = [];
  for (const e of L) {
    const dt = e.t - g.t; let txt;
    if (e.ev === 'sse_get_dispatch') txt = `${C.c}fetch(GET /session/:id/events) called${C.x}`;
    else if (e.ev === 'kill_returned') txt = `${C.gr}execSync('kill -KILL') returns${C.x}`;
    else if (e.ev === 'sse_response') txt = e.status === 200 ? `${C.g}daemon answers 200 (subscriber registered)${C.x}` : `${C.r}daemon answers ${e.status} (session already removed)${C.x}`;
    else if (e.ev === 'kill_sent') txt = `${C.m}execSync('kill -KILL <acp child>') starts${C.x}`;
    else continue;
    out.push(`   ${C.gr}${lpad('+' + dt, 5)} ms${C.x}  ${txt}`);
  }
  return [`  ${label}`, ...out];
}
function killVsResp(tags) {
  const v = tags.map((t) => { const L = tl(t); return L.find((e) => e.ev === 'kill_sent').t - L.find((e) => e.ev === 'sse_response').t; }).sort((a, b) => a - b);
  return { before: v.filter((x) => x < 0).length, n: v.length, min: v[0], med: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
}
{
  const nat = (a) => R.filter((r) => r.arm === a && r.fault === 'none' && r.scope === 'sigkill').map((r) => r.tag);
  const sb = killVsResp(nat('base')), sh = killVsResp(nat('head'));
  const respAfterKillReturned = nat('base').map((t) => { const L = tl(t); return L.find((e) => e.ev === 'sse_response').t - L.find((e) => e.ev === 'kill_returned').t; }).sort((a, b) => a - b);
  const lines = [
    `${C.B}SIGKILL vs. SSE subscription — real daemon, real qwen --acp child, recorded in the vitest worker${C.x}`,
    `${C.gr}(timestamps from a --require preload wrapping fetch() and execSync('kill -KILL …'); product code identical in both arms)${C.x}`,
    '',
    ...timelineBlock('e0-base-01', `${C.B}base @ 6b66321a5a${C.x}  ${C.gr}(natural run, no injection — passed only because the daemon won)${C.x}`),
    '',
    ...timelineBlock('e4-base-01', `${C.B}base @ 6b66321a5a${C.x}  ${C.gr}(natural run on 3 contended cores, no injection)${C.x}  ${C.r}→ FAIL: expected undefined to be defined${C.x}`),
    '',
    ...timelineBlock('e0-head-01', `${C.B}head @ 9162fd0064${C.x}  ${C.gr}(natural run, no injection)${C.x}`),
    '',
    `${C.B}All natural (no-injection) runs: base ${sb.n}, head ${sh.n}${C.x}`,
    `  base: the synchronous execSync kill runs before the queued request can leave the process; the daemon's answer came`,
    `        ${respAfterKillReturned[0]}–${respAfterKillReturned[respAfterKillReturned.length - 1]} ms after the kill returned in ${C.r}${sb.before}/${sb.n}${C.x} runs ${C.gr}→ base passes only if the daemon registers the subscriber${C.x}`,
    `        ${C.gr}before it processes the child's exit${C.x}`,
    `  head: kill starts after the daemon's 200 in ${C.g}${sh.n - sh.before}/${sh.n}${C.x} runs  (+${sh.min}…+${sh.max} ms); never a 404`,
  ];
  fs.writeFileSync(ROOT + '/shots/fig1-timeline.ansi', lines.join('\n') + '\n');
}

// ---------- Fig 2: A/B matrix ----------
{
  const row = (label, b, h) => `  ${cell(label, 52)}${cell(b, 24)}${h}`;
  const S = (pfx) => stat(R.filter((r) => r.tag.startsWith(pfx)));
  const lines = [
    `${C.B}A/B matrix — same build (dist/cli.js @ 9162fd0064), only the test file differs, --retry=0${C.x}`,
    '',
    row(`${C.B}condition${C.x}`, `${C.B}base test${C.x}`, `${C.B}head test${C.x}`),
    row('natural, uncontended (20 runs / arm)', pf(S('e0-base')), pf(S('e0-head'))),
    row('natural, 3 pinned cores + 6 busy loops', pf(S('e4-base')), pf(S('e4-head'))),
  ];
  if (R.some((r) => r.tag.startsWith('e5-'))) lines.push(row('natural, 2 pinned cores + 10 busy loops', pf(S('e5-base')), pf(S('e5-head'))));
  lines.push('', `${C.gr}  SSE GET held back in the test process for N ms (emulates a starved test event loop):${C.x}`);
  for (const d of [5, 10, 20, 50, 100, 250, 1000, 3000]) {
    const b = S(`e1-base-d${d}-`), h = S(`e1-head-d${d}-`);
    lines.push(row(`  +${d} ms`, b.n ? pf(b) : `${C.gr}—${C.x}`, h.n ? pf(h) : `${C.gr}—${C.x}`));
  }
  lines.push('', `  ${C.gr}every base failure above: daemon answered the late GET with 404, the consumer's catch{} swallowed it,${C.x}`,
    `  ${C.gr}and the test died at line 692:18 (expect(died).toBeDefined()) "expected undefined to be defined" — same line and message as the CI log.${C.x}`);
  fs.writeFileSync(ROOT + '/shots/fig2-matrix.ansi', lines.join('\n') + '\n');
}

// ---------- Fig 3: failure diagnostics ----------
{
  const pick = (pfx) => R.find((r) => r.tag.startsWith(pfx));
  const msg = (r) => { const m = r.summary.split(':'); const ms = m[1]; const text = r.summary.slice(r.summary.indexOf(':', r.summary.indexOf(':') + 1) + 1); return { ms, text }; };
  const lines = [`${C.B}What a failing run tells you — injected faults, both arms, same daemon${C.x}`, ''];
  const cases = [
    ['404', 'stream never opens (unknown session id → real daemon 404)'],
    ['cut', 'transport error after the SSE handshake'],
    ['eof', 'stream ends cleanly without session_died'],
    ['hold', 'stream stays open, no session_died within the 5 s window'],
    ['stall', 'SSE open never completes (wedged daemon)'],
  ];
  for (const [m, d] of cases) {
    const b = msg(pick(`e3-base-${m}-`)), h = msg(pick(`e3-head-${m}-`));
    lines.push(`${C.c}${d}${C.x}`);
    lines.push(`  base  ${C.gr}${lpad(b.ms, 7)}${C.x}  ${C.r}${b.text}${C.x}`);
    lines.push(`  head  ${C.gr}${lpad(h.ms, 7)}${C.x}  ${C.y}${h.text}${C.x}`);
    lines.push('');
  }
  fs.writeFileSync(ROOT + '/shots/fig3-diagnostics.ansi', lines.join('\n'));
}
console.log('ok');

// ---------- Fig 4: real vitest output, same contention, both arms ----------
{
  const grab = (tag) => fs.readFileSync(`${ROOT}/runs/${tag}/stdout.txt`, 'utf8')
    .replace(/⎯/g, '─').split('\n').filter((l) => vis(l).trim() && !/JSON report written|output directory|CLI path/.test(vis(l)))
    .filter((l) => !/^\s*↓ /.test(vis(l)));
  const lines = [
    `${C.B}base test @ 6b66321a5a${C.x} ${C.gr}— vitest --retry=0 on 3 cores shared with 6 busy loops, no fault injection${C.x}`,
    `${C.gr}(the merge-base copy of qwen-serve-streaming.test.ts runs beside the PR's file as cli/armbase-serve-streaming.test.ts)${C.x}`,
    ...grab('e4-base-01'),
    '',
    `${C.B}head test @ 9162fd0064${C.x} ${C.gr}— same build, same contention, next run in the interleaved sequence${C.x}`,
    ...grab('e4-head-01'),
  ];
  fs.writeFileSync(ROOT + '/shots/fig4-vitest-ab.ansi', lines.join('\n') + '\n');
}
