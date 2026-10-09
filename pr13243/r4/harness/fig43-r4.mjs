// VERIFICATION RIG ONLY (PR #13243): evidence figures rendered from the s43 probe ledgers and the Windows
// probe artifact. Cell text comes from the ledgers; only labels and the ok/bad colouring are written here.
// usage: node fig43.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13243-rig';
const require = createRequire(`${RIG}/wt43/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig43`;
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (db, arm) => JSON.parse(fs.readFileSync(`${RIG}/out/${db}/s43-${arm}.json`, 'utf8'));
const get = (r, scenarioPrefix, key) => {
  const o = r.obs.find((x) => x.scenario.startsWith(scenarioPrefix) && x.key === key);
  if (!o) throw new Error(`missing ${scenarioPrefix} / ${key} in ${r.name}`);
  return String(o.value);
};

// Compress one ledger value into a short cell.
function brief(v) {
  let m;
  if ((m = v.match(/STILL ACTIVE after (\d+) ms/))) return `still running after ${(m[1] / 1000).toFixed(0)} s`;
  if ((m = v.match(/STILL ACTIVE (\d+) ms after cancel/))) return `cancel 204; still running ${(m[1] / 1000).toFixed(0)} s later`;
  if ((m = v.match(/^admit=(\d+) (\S+) \((\d+) ms\)/))) return `refused ${m[1]} ${m[2]}`;
  if ((m = v.match(/admit=202 terminal=(.*?) idle after (\d+) ms recoveryBlocked=(\w+)/))) {
    let t = m[1];
    const code = t.match(/"code":"([^"]+)"/);
    if (t.startsWith('turn_error')) t = `turn_error ${code ? code[1] : ''}`;
    if (t === '<none>') t = 'ended, no turn event';
    return `${t} · ${m[2]} ms${m[3] === 'true' ? ' · recoveryBlocked' : ''}`;
  }
  if ((m = v.match(/idle after (\d+) ms terminal=(\S+)/))) return `${m[2]} after ${m[1]} ms`;
  if ((m = v.match(/idle (\d+) ms after cancel terminal=(\S+)/))) return `${m[2]} ${(m[1] / 1000).toFixed(1)} s after cancel`;
  if ((m = v.match(/^(\d{3})( [a-z_]+)? \((\d+) ms\)/))) return `${m[1]}${m[2] ?? ''}`;
  return v;
}
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:1180px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#52514e;margin:0 0 12px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0 10px;table-layout:fixed}
  th,td{border:1px solid #d9d8d4;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.sc{font-weight:600;background:#f6f5f2}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}.same{color:#52514e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const cell = (c) => (c && typeof c === 'object' ? `<td class="${c.c}">${esc(c.t)}</td>` : `<td>${esc(c ?? '')}</td>`);
const table = (head, rows, widths) =>
  `<table>${widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : ''}<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => (r.section ? `<tr><td class="sc" colspan="${head.length}">${esc(r.section)}</td></tr>` : `<tr>${r.map(cell).join('')}</tr>`))
    .join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const SAME = (t) => ({ c: 'same', t });

const figs = {};
const nb = (v) => brief(v.replace(/ wrote=(\w+)$/, '')) + (/wrote=true/.test(v) ? ' · file written' : / wrote=false/.test(v) ? ' · nothing written' : '');
const R3 = (db) => JSON.parse(fs.readFileSync(`${RIG}/pr13243/r3/results/${db}/s43-h43h.json`, 'utf8'));
const P = (db) => load(db, 'h43p');
const M = (db) => load(db, 'b43m');
const Q = (db) => load(db, 'h43q');

// ---- Figure 9: G1 / F1 / O1 on f72edd01e6 vs the merge-base and round 3.
{
  const pB = M('r43m1'), pH = Q('r43q1'), r3 = R3('r43h3');
  const eB = M('r43m4'), eH = Q('r43q4'), e3 = R3('r43h6');
  const dB = M('r43m2'), dH = Q('r43q2');
  const g = (r, s, k) => brief(get(r, s, k));
  const st = (r) => get(r, 'S2e', '4 status').match(/"recoveryBlocked":\w+/)[0];
  const rows = [
    { section: 'G1 (round 3) — cancel while the module evaluates, then the module finishes' },
    ['S2b cancel', SAME(g(pB, 'S2b', 'cancel').replace(/^started=\S+ /, '') + ' (ends when the module finishes)'), BAD(get(r3, 'S2b', 'cancel').replace(/^started=\S+ idle after (\d+) ms terminal=<none>$/, 'turn ends after $1 ms, no turn event')), OK(get(pH, 'S2b', 'cancel').replace(/^started=\S+ idle after (\d+) ms terminal=<none>$/, 'turn ends after $1 ms, no turn event'))],
    ['S2b next prompt after the module finished', OK(g(pB, 'S2b', 'next prompt after evaluation finished')), BAD(g(r3, 'S2b', 'next prompt after evaluation finished')), OK(g(pH, 'S2b', 'next prompt after evaluation finished'))],
    ['S2e detach + load → status', OK(st(eB)), BAD(st(e3)), OK(st(eH))],
    ['S2e turn events of the cancelled prompt', OK(get(eB, 'S2e', '5 transcript events of the cancelled prompt')), BAD(get(e3, 'S2e', '5 transcript events of the cancelled prompt')), OK(get(eH, 'S2e', '5 transcript events of the cancelled prompt'))],
    ['S2e prompt in a replacement Harness', OK(g(eB, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, '')), BAD(g(e3, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, '')), OK(g(eH, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, ''))],
    { section: 'F1 (rounds 1–2) — detach while the module evaluates (S2d, Broker capture)' },
    ['detach while evaluating · Broker row', SAME(get(dB, 'S2d', '2 detach while evaluation pending').replace(/ \(\d+ ms\)/, '').replace(/broker=hooks-activation-[0-9a-f]+…\s*/, '· ')), SAME('503 · READY v1 (fixed in round 3)'), OK(get(dH, 'S2d', '2 detach while evaluation pending').replace(/ \(\d+ ms\)/, '').replace(/broker=hooks-activation-[0-9a-f]+…\s*/, '· '))],
    ['next Hook turn after the module finished', OK(g(dB, 'S2d', '4 next Hook turn').replace(/ callbacks=\d+ broker=.*$/, '')), SAME('409 (G1)'), OK(brief(get(dH, 'S2d', '4 next Hook turn').replace(/ callbacks=\d+ broker=.*$/, '')))],
    ['prompt after detach + load', OK(brief(get(dB, 'S2d', '7 prompt after load').replace(/ callbacks=\d+$/, ''))), SAME('409 (G1)'), OK(brief(get(dH, 'S2d', '7 prompt after load').replace(/ callbacks=\d+$/, '')))],
    { section: 'O1 — finite evaluation over max(timeout, 500 ms): 1.5 s, timeout 10 (S4a)' },
    ['turn', OK(g(pB, 'S4a', 'turn')), WARN(g(r3, 'S4a', 'turn')), WARN(g(pH, 'S4a', 'turn'))],
    ['next prompt after the module finished', OK(g(pB, 'S4a', 'next prompt, same Session')), BAD(g(r3, 'S4a', 'next prompt, same Session')), OK(g(pH, 'S4a', 'next prompt, same Session'))],
    ['other Session in the Workspace', OK(nb(get(pB, 'S4a', 'neighbour Session (no Hooks, same Workspace)'))), BAD(nb(get(r3, 'S4a', 'neighbour Session (no Hooks, same Workspace)'))), OK(nb(get(pH, 'S4a', 'neighbour Session (no Hooks, same Workspace)')))],
    { section: 'Others' },
    ['S1 never-settling module — turn', BAD(g(pB, 'S1', 'turn')), OK(g(r3, 'S1', 'turn')), OK(g(pH, 'S1', 'turn'))],
    ['S6 replacement Harness: Hook turn after the module finished', BAD(g(pB, 'S6', 'Hook turn after evaluation finished').replace(/ callbacks=\d+$/, '')), BAD(g(r3, 'S6', 'Hook turn after evaluation finished').replace(/ callbacks=\d+$/, '')), OK(g(pH, 'S6', 'Hook turn after evaluation finished').replace(/ callbacks=\d+$/, ''))],
    ['S5 module throws — turn / next prompt', SAME(`${g(pB, 'S5', 'turn')} / ${g(pB, 'S5', 'next prompt, same Session')}`), SAME('same'), SAME(`${g(pH, 'S5', 'turn')} / ${g(pH, 'S5', 'next prompt, same Session')}`)],
  ];
  figs['09-r4-recovery'] = page(
    'Round 4 — the head closes G1, keeps F1 closed, and now recovers once the module finishes',
    'Real stack, each arm on a fresh DB. Base = merge-base 5ddd43815b (its own jar); head = 93129b50c6 on the f72edd01e6 jar (the PR now changes Java; 93129b50c6 changes TS only). f72edd01e6 gave the same results on every row. Round-3 column = be10a118a1 from the previous report. Times are wall clock on a shared host (load 30–70).',
    table(['scenario', 'base <code>5ddd43815b</code>', 'round 3 <code>be10a118a1</code>', 'head <code>93129b50c6</code>'], rows, ['25%', '25%', '25%', '25%']),
  );
}

// ---- Figure 10: bot R8-1 on the real stack (S8) across base, f72edd01e6 and 93129b50c6; Windows.
{
  const aB = M('r43m5'), aP = P('r43p5'), aQ = Q('r43q5');
  const strip = (v) => v.replace(/^kill \d+ ms after cancel; callback ledger: /, '');
  const sw = (arm, dbs) => dbs.map((d) => [d.match(/(\d+)$/)[1], load(d, arm)]);
  const pS = sw('h43p', ['r43p8k80', 'r43p8k150', 'r43p8k250']);
  const qS = sw('h43q', ['r43q8k80', 'r43q8k150']);
  const bS = [['20', M('r43m5')]];
  const cell = (S, k, f = (v) => v) => S.map(([d, r]) => `${d} ms: ${f(get(r, 'S8d', k))}`).join(' · ');
  const att = (r) => get(r, 'S8d', '6 recovery attempts').replace(/ \(\d+ ms\)/g, '').replace(/^managed-runtime\/cancel=(\S+ \S+) /, 'managed-runtime/cancel $1 · ').replace(/ prompt: /, ' · prompt ');
  const rows = [
    { section: 'S8a — cancel while the PreToolUse callback runs, Harness alive' },
    ['callback ledger (side effect)', SAME(get(aB, 'S8a', '2 callback ledger')), SAME(get(aP, 'S8a', '2 callback ledger')), SAME(get(aQ, 'S8a', '2 callback ledger'))],
    ['turn · tool · next prompt', ...[aB, aP, aQ].map((r) => OK(`${get(r, 'S8a', '1 cancel').match(/terminal=(\S+)/)[1]} · tool did not run · next: ${brief(get(r, 'S8a', '4 next prompt'))}`))],
    { section: 'S8d — cancel reaches the Runtime (callback aborted after ~1.6 s), then the Harness is SIGKILLed before the turn settles; replacement Harness loads recoveryRequired' },
    ['callback ledger (side effect)', SAME(cell(bS, '1 cancel then SIGKILL', strip)), SAME(cell(pS, '1 cancel then SIGKILL', strip)), SAME(cell(qS, '1 cancel then SIGKILL', strip))],
    ['next prompt', BAD(cell(bS, '4 next prompt', brief)), OK(cell(pS, '4 next prompt', brief)), BAD(cell(qS, '4 next prompt', brief))],
    ['parked turn afterwards', SAME(cell(bS, '5 parked turn after the next prompt', (v) => v.match(/terminal=(\S+)/)[1])), WARN(cell(pS, '5 parked turn after the next prompt', (v) => `${v.match(/terminal=(\S+)/)[1]}, refusal written=${/ran"=true/.test(v)}`)), SAME(cell(qS, '5 parked turn after the next prompt', (v) => v.match(/terminal=(\S+)/)[1]))],
    ['managed-runtime/cancel · detach · load · prompt', BAD(att(M('r43m8r80')) + ' (80 ms run)'), OK(att(P('r43p8r80')) + ' (80 ms run)'), BAD(att(Q('r43q8r80')) + ' (80 ms run; 150 ms identical)')],
  ];
  const W = `${RIG}/out/windows-r4`;
  const pj = fs.readdirSync(W).filter((x) => /^probe-.*\.txt$/.test(x)).flatMap((x) => fs.readFileSync(`${W}/${x}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const armc = (a) => { const xs = pj.filter((x) => x.arm === a); const ok = xs.length > 0 && xs.every((x) => x.exit === 0); return (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} exit 0 · ${[...new Set(xs.map((x) => x.tests))].join(' / ')}`); };
  rows.push({ section: 'Windows (windows-2022; head f72edd01e6 — 93129b50c6 changes neither the two test files nor their sources)' });
  rows.push(['merge-base ×3 · raw-import mutant ×2 · head ×5', SAME(`${armc('base').t.slice(2)} · ${armc('rawimport').t.slice(2)}`), armc('head'), SAME('same files as f72edd01e6')]);
  figs['10-r4-r8-1-windows'] = page(
    'Round 4 — bot R8-1 on the real stack: the 93129b50c6 narrowing turns a crash-parked cancel back into base\x27s permanent block',
    'PreToolUse function Hook (write_file) whose callback runs ~4 s and logs to the ledger at start/abort/end; the user cancels ~1.5 s in. In the head S8d runs a Harness→Broker capture shows hook-execute and hook-cancel both reached the Broker before the kill; the base 20 ms run shows the same through its callback-aborted ledger line. The base 80 ms run (recovery row) did not get the cancel through before the kill and is blocked as well.',
    table(['scenario', 'base <code>5ddd43815b</code>', '<code>f72edd01e6</code>', 'head <code>93129b50c6</code>'], rows, ['19%', '27%', '27%', '27%']) +
      `<div class="note">With the Harness alive (S8a) all three arms end the turn <code>turn_complete(cancelled)</code> and continue. After a crash between the cancel and the turn settle (S8d), f72edd01e6 settled the parked turn as cancelled and wrote "The turn was cancelled before this tool call ran." (true for the tool; the callback ran ~1.6 s), so the Session continued. 93129b50c6 applies R8-1\x27s narrowing: the record is no longer a fence, the turn stays parked, and detach + load + prompt stay 409 — the same as base. No regression against base, but the crash-window recovery that f72edd01e6 had is gone.</div>`,
  );
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(figs);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
for (const name of names) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, figs[name]);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}.png ${clipped ? `(${clipped} clipped cells!)` : 'ok'}`);
}
await browser.close();
