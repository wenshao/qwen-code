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

// ---- Figure 9: G1 / F1 / O1 on f72edd01e6 vs the merge-base and round 3.
{
  const pB = M('r43m1'), pH = P('r43p1'), r3 = R3('r43h3');
  const eB = M('r43m4'), eH = P('r43p4'), e3 = R3('r43h6');
  const dB = M('r43m2'), dH = P('r43p2');
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
    'Round 4 — f72edd01e6 closes G1, keeps F1 closed, and now recovers once the module finishes',
    'Real stack, each arm on a fresh DB. Base = merge-base 5ddd43815b (its own jar); head f72edd01e6 (its own jar — the PR now changes Java). Round-3 column = be10a118a1 from the previous report. Times are wall clock on a shared host (load 30–70).',
    table(['scenario', 'base <code>5ddd43815b</code>', 'round 3 <code>be10a118a1</code>', 'head <code>f72edd01e6</code>'], rows, ['25%', '25%', '25%', '25%']),
  );
}

// ---- Figure 10: bot R8-1 on the real stack (S8), Windows, unit.
{
  const aB = M('r43m5'), aH = P('r43p5');
  const strip = (v) => v.replace(/^kill \d+ ms after cancel; /, '');
  const rows = [
    { section: 'S8a — cancel while the PreToolUse callback runs, Harness alive' },
    ['callback ledger (side effect)', SAME(get(aB, 'S8a', '2 callback ledger')), SAME(get(aH, 'S8a', '2 callback ledger'))],
    ['turn · tool', SAME(get(aB, 'S8a', '1 cancel').replace(/^idle recoveryBlocked=\w+ /, '').replace(' file written=false', ' · tool did not run')), SAME(get(aH, 'S8a', '1 cancel').replace(/^idle recoveryBlocked=\w+ /, '').replace(' file written=false', ' · tool did not run'))],
    ['next prompt', OK(brief(get(aB, 'S8a', '4 next prompt'))), OK(brief(get(aH, 'S8a', '4 next prompt')))],
    { section: 'S8d — same cancel, but the Harness is SIGKILLed after the hook-cancel reaches the Broker and before the turn settles' },
  ];
  const sweep = [80, 150, 250].map((d) => [d, load(`r43p8k${d}`, 'h43p')]);
  const bd = aB;
  rows.push(['callback ledger (side effect)', SAME(strip(get(bd, 'S8d', '1 cancel then SIGKILL')) + ' (kill 20 ms after cancel)'), SAME(sweep.map(([d, r]) => `${d} ms: ${strip(get(r, 'S8d', '1 cancel then SIGKILL')).replace('callback ledger: ', '')}`).join(' · '))]);
  rows.push(['load in replacement Harness', SAME(get(bd, 'S8d', '2 load in replacement Harness').replace(/ after \d+ ms/, '')), SAME(sweep.map(([d, r]) => `${d} ms: ${get(r, 'S8d', '2 load in replacement Harness').replace(/ after \d+ ms/, '')}`).join(' · '))]);
  rows.push(['next prompt', BAD(brief(get(bd, 'S8d', '4 next prompt'))), OK(sweep.map(([d, r]) => `${d} ms: ${brief(get(r, 'S8d', '4 next prompt'))}`).join(' · '))]);
  rows.push(['parked turn afterwards', SAME(get(bd, 'S8d', '5 parked turn after the next prompt').replace(/ PreToolUse=.*$/, '').replace(' file written=false', ' · tool did not run')), WARN(get(sweep[0][1], 'S8d', '5 parked turn after the next prompt').replace(/ PreToolUse=.*$/, '').replace(' file written=false', ' · tool did not run') + ' (all three delays)')]);
  const W = `${RIG}/out/windows-r4`;
  const pj = fs.readdirSync(W).filter((x) => /^probe-.*\.txt$/.test(x)).flatMap((x) => fs.readFileSync(`${W}/${x}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const armc = (a) => { const xs = pj.filter((x) => x.arm === a); const ok = xs.length > 0 && xs.every((x) => x.exit === 0); return (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} exit 0 · ${[...new Set(xs.map((x) => x.tests))].join(' / ')}`); };
  rows.push({ section: 'Windows (windows-2022, PR head f72edd01e6 + probe workflow; base = 5ddd43815b)' });
  rows.push(['head ×5 / merge-base ×3 / raw-import mutant ×2', SAME(`${armc('base').t.slice(2)} / ${armc('rawimport').t.slice(2)}`), armc('head')]);
  figs['10-r4-r8-1-windows'] = page(
    'Round 4 — bot R8-1 reproduced: a cancelled callback that really ran settles a parked turn the same way a live cancel does',
    'PreToolUse function Hook (write_file) whose callback runs ~4 s and logs to the ledger at start/abort/end; the user cancels ~1.5 s in. In the head S8d runs a Harness→Broker capture shows hook-execute and hook-cancel both reached the Broker before the kill (a 400 ms delay settled before the kill and is not a parked case); in the base run the callback-aborted ledger line shows the cancel reached the Runtime.',
    table(['scenario', 'base <code>5ddd43815b</code>', 'head <code>f72edd01e6</code>'], rows, ['24%', '38%', '38%']) +
      `<div class="note">With the Harness alive (S8a) both arms end the turn <code>turn_complete(cancelled)</code> and the Session stays usable. When the Harness dies after the cancel reached the Runtime (S8d), base leaves the Session blocked for good; the head's prompt-gate reconcile settles the parked turn as cancelled — writing "The turn was cancelled before this tool call ran." (true for the tool; the callback did run 1.6 s) — and the Session continues. R8-1's suggested narrowing (cancelled arm requires <code>duration === 0</code>) would make this exact sequence behave like base again, per the bot's own end-to-end witness in R8-1 (409, blocked). Which reading is intended is a maintainer decision.</div>`,
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
