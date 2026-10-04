// VERIFICATION RIG ONLY (PR #13243): evidence figures rendered from the s43 probe ledgers and the Windows
// probe artifact. Cell text comes from the ledgers; only labels and the ok/bad colouring are written here.
// usage: node fig43.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13129-rig';
const require = createRequire(`${RIG}/wt43/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig43`; // round 2
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
const lease = (v) => v.replace(/ lease=(.*)$/, ' · lease: $1');
const nb = (v) => brief(v.replace(/ wrote=(\w+)$/, '')) + (/wrote=true/.test(v) ? ' · file written' : / wrote=false/.test(v) ? ' · nothing written' : '');

// ---- Figure 5: S6c — replacement Harness, detach while the cancelled operation's module still evaluates.
{
  const arms = [
    ['base 0f140e3a5d', load('r43b3', 'b43')],
    ['f8775584fe', load('r43f5', 'h43f')],
    ['head ee0f4c901c', load('r43g3', 'h43g')],
  ];
  const step = (label, key, fmt, colour) => [label, ...arms.map(([, r], i) => (colour ? colour(i) : SAME)(fmt(get(r, 'S6c', key))))];
  const rows = [
    step('cancel (old Harness, then SIGKILL)', 'cancel', (v) => brief(v.replace(/^started=\S+ /, ''))),
    step('load in replacement Harness', 'load in new Harness', (v) => v.replace(/^(\d+) \((\d+) ms\) after (\d+) ms/, (_, s, __, t) => `${s} after ${(t / 1000).toFixed(0)} s (writer lease)`)),
    step('1 detach while the module still evaluates', '1 detach while evaluation pending', (v) => lease(brief(v.replace(/ lease=.*$/, ''))) + (v.match(/ lease=(.*)$/) ? ` · lease: ${v.match(/ lease=(.*)$/)[1]}` : ''), (i) => (i === 1 ? BAD : SAME)),
    step('1 Harness→Broker', '1 Harness->Broker', (v) => v.replace(/POST \/tool-sessions\/<owner>/g, '').replace(/ \|\| /g, '; ')),
    step('2 module finishes', '2 module finished', (v) => v.replace(/^after \d+ ms /, '').replace('lease=', 'lease: ')),
    step('3 other Session in the Workspace', '3 other Session in the Workspace', nb),
    step('4 detach retried', '4 detach retried', (v) => brief(v.replace(/ lease=.*$/, '')) + ` · lease: ${v.match(/ lease=(.*)$/)?.[1]}`, (i) => (i === 1 ? BAD : OK)),
    step('5 other Session after the retry', '5 other Session after the retry', nb, (i) => (i === 1 ? BAD : OK)),
    step('Harness stderr', 'Harness stderr: hook owner lines', (v) => v),
  ];
  figs['05-r2-detach-after-replacement'] = page(
    'Round 2 — ee0f4c901c fixes the "204 while the earlier owner stays attached" case (bot R4-1) on the real stack',
    'S6c: a cancelled operation\'s module is still evaluating in the worker when the old Harness is SIGKILLed; the replacement Harness loads the Session and the client detaches without running a Hook turn. Lease = the Workspace execution lease holder in MySQL. Broker traffic recorded by a Harness→Broker proxy.',
    table(['step', 'base <code>0f140e3a5d</code>', '<code>f8775584fe</code>', 'head <code>ee0f4c901c</code>'], rows, ['20%', '26.6%', '26.7%', '26.7%']) +
      `<div class="note nok">On f8775584fe the refused earlier-owner release was absorbed and the detach answered 204, deleting the only Session that could retry it: the earlier owner kept the Workspace lease, the retry got 404 and other Sessions in the Workspace kept failing. ee0f4c901c answers 503 <code>hosted_hook_recovery_required</code>, keeps the Session, and a retried detach after the module finishes releases the lease (same end state as base).</div>`,
  );
}

// ---- Figure 6: round-2 regression on ee0f, F1 status, Windows.
{
  const f = load('r43f', 'h43f');
  const f2 = load('r43f2', 'h43f');
  const g = load('r43g', 'h43g');
  const gd = load('r43g2', 'h43g');
  const pair = (label, s, k, fr = f, gr = g, colour = SAME) => [label, colour(brief(get(fr, s, k))), colour(brief(get(gr, s, k)))];
  const rows = [
    { section: 'Regression: same scenarios as round 1 (each on a fresh DB)' },
    pair('S1 never-settling module — turn', 'S1', 'turn'),
    pair('S1 — detach', 'S1', 'detach'),
    pair('S2b cancel while evaluating — cancel', 'S2b', 'cancel', f2),
    pair('S2b — next turn after the module finished', 'S2b', 'next prompt after evaluation finished', f2),
    pair('S3 300 ms evaluation, timeout 10', 'S3', 'turn'),
    pair('S4b 1.5 s evaluation, timeout 3000', 'S4b', 'turn'),
    pair('S4a 1.5 s evaluation, timeout 10 — turn (O1)', 'S4a', 'turn', f, g, WARN),
    pair('S4a — other Session in the Workspace (O1)', 'S4a', 'neighbour Session (no Hooks, same Workspace)', f, g, WARN),
    pair('S5 module throws — turn', 'S5', 'turn'),
    pair('S7 DELETE after the module finished', 'S7', 'DELETE after evaluation finished'),
    pair('S6 Hook turn in replacement Harness (O2)', 'S6', 'Hook turn in new Harness, evaluation still pending', f, g, WARN),
    { section: 'F1 — refused detach while evaluating, then a Hook turn (S2d, Broker capture on ee0f)' },
    ['2 detach while evaluating', SAME('see round 1: 503 · Broker row RELEASING v2'), BAD(get(gd, 'S2d', '2 detach while evaluation pending').replace(/broker=hooks-activation-[0-9a-f]+…\s*/, 'Broker row: ').replace(/ \(\d+ ms\)/, ''))],
    ['2 Harness→Broker', SAME('—'), BAD(get(gd, 'S2d', '2 Harness->Broker').replace(/hooks-activation-[0-9a-f]+/g, '<owner>').replace(/POST \/tool-sessions\/<owner>/g, ''))],
    ['4 next Hook turn', SAME('see round 1: recoveryBlocked'), BAD(brief(get(gd, 'S2d', '4 next Hook turn').replace(/ callbacks=\d+ broker=.*$/, '')))],
    ['4 Harness→Broker', SAME('—'), BAD(get(gd, 'S2d', '4 Harness->Broker').replace(/hooks-activation-[0-9a-f]+/g, '<owner>').replace(/POST \/tool-sessions\/<owner>/g, '').split(' || ').filter((x) => !x.includes('runtimes:warm')).join('; '))],
    ['5 detach / 6 another prompt', SAME('see round 1'), BAD(`${brief(get(gd, 'S2d', '5 detach').replace(/ broker=.*$/, ''))} / ${brief(get(gd, 'S2d', '6 another prompt'))}`)],
  ];
  const W = `${RIG}/out/r43/windows-r2`;
  const pj = fs.readdirSync(W).filter((x) => /^probe-.*\.txt$/.test(x)).flatMap((x) => fs.readFileSync(`${W}/${x}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const arm = (a) => pj.filter((x) => x.arm === a);
  const winCell = (a) => {
    const xs = arm(a);
    const ok = xs.length > 0 && xs.every((x) => x.exit === 0 && x.ignoreAbort.startsWith('✓'));
    return (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} exit 0 · ${[...new Set(xs.map((x) => x.tests))].join(' / ')}`);
  };
  const slot = fs.readdirSync(W).filter((x) => /^head-\d+\.txt$/.test(x)).map((x) => fs.readFileSync(`${W}/${x}`, 'utf8').match(/✓ [^\n]*keeps admitting operations after abandoned evaluations release their slots (\d+)ms/)?.[1] ?? 'missing');
  rows.push({ section: 'Windows (windows-2022, PR head ee0f4c901c + probe workflow)' });
  rows.push(['head ×5 · new 16-slot case', SAME('round 1: 5/5 · 131 passed | 4 skipped'), (slot.every((x) => x !== 'missing') ? OK : BAD)(`${winCell('head').t.slice(2)} · 16-slot case ✓ in every run (${slot.join(', ')} ms)`)]);
  rows.push(['merge-base ×3 / raw-import mutant ×2', SAME('round 1: 3/3 / 2/2'), OK(`${winCell('base').t.slice(2)} / ${winCell('rawimport').t.slice(2)}`)]);
  figs['06-r2-regression'] = page(
    'Round 2 — ee0f4c901c regression, F1 status and Windows',
    'Same rig, jar and base as round 1 (ee0f4c901c touches no Java, core or lockfile; its parent is f8775584fe). Host load was 130–170 during this round, so absolute timings are slower than round 1.',
    table(['scenario', '<code>f8775584fe</code> (round 1)', 'head <code>ee0f4c901c</code>'], rows, ['30%', '35%', '35%']) +
      `<div class="note nbad">F1 is unchanged: ee0f4c901c retries <em>earlier</em> fenced owners each turn and blocks DELETE while one is fenced, but the Session's <em>own</em> owner still goes RELEASING when its release is refused at close, and the next Hook turn is refused <code>runtime_session_not_ready</code> and recorded <code>outcome_unknown</code>.</div>`,
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
