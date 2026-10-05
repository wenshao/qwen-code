// VERIFICATION RIG ONLY (PR #13243): evidence figures rendered from the s43 probe ledgers and the Windows
// probe artifact. Cell text comes from the ledgers; only labels and the ok/bad colouring are written here.
// usage: node fig43.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13129-rig';
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
const b = (db) => load(db, 'b43n');
const h = (db) => load(db, 'h43h');

// ---- Figure 7: G1 — a cancel during module evaluation leaves the Session unrecoverable (S2e).
{
  const B = b('r43n4');
  const H = h('r43h6');
  const loadJ = (v) => { const m = v.match(/^(\d+) /); return `${m ? m[1] : v}`; };
  const rows = [
    ['1 cancel while the module evaluates', SAME(brief(get(B, 'S2e', '1 cancel'))), BAD(get(H, 'S2e', '1 cancel').replace('idle terminal=<none>', 'turn ends with no turn event ·').replace('recoveryBlocked=true', 'recoveryBlocked'))],
    ['2 module finishes, then detach', OK(get(B, 'S2e', '2 detach after the module finished').replace(/ \(\d+ ms\)/, '').replace('records=', '· Hook record ')), OK(get(H, 'S2e', '2 detach after the module finished').replace(/ \(\d+ ms\)/, '').replace('records=', '· Hook record '))],
    ['3 load', OK(loadJ(get(B, 'S2e', '3 load (response)'))), WARN(loadJ(get(H, 'S2e', '3 load (response)')))],
    ['4 status', OK(get(B, 'S2e', '4 status').match(/"recoveryBlocked":\w+/)[0]), BAD(get(H, 'S2e', '4 status').match(/"recoveryBlocked":\w+/)[0])],
    ['5 turn events of the cancelled prompt', OK(get(B, 'S2e', '5 transcript events of the cancelled prompt')), BAD(get(H, 'S2e', '5 transcript events of the cancelled prompt') + ' (no terminal event)')],
    ['6 recovery routes managed-runtime/cancel · /continue', SAME(get(B, 'S2e', '6 recovery routes').replace(/ \(\d+ ms\)/g, '').replace('managed-runtime/cancel=', '').replace(' managed-runtime/continue=', ' · ')), BAD(get(H, 'S2e', '6 recovery routes').replace(/ \(\d+ ms\)/g, '').replace('managed-runtime/cancel=', '').replace(' managed-runtime/continue=', ' · '))],
    ['7 prompt', OK(brief(get(B, 'S2e', '7 prompt'))), BAD(brief(get(H, 'S2e', '7 prompt')))],
    ['8 detach, replacement Harness, load', OK(get(B, 'S2e', '8 detach, new Harness, load').replace(/ \(\d+ ms\)/, '')), BAD(get(H, 'S2e', '8 detach, new Harness, load').replace(/ \(\d+ ms\)/, ''))],
    ['9 prompt in the replacement Harness', OK(brief(get(B, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, ''))), BAD(brief(get(H, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, '')))],
  ];
  const r2 = load('r43g', 'h43g');
  rows.push(['round 2 (ee0f4c901c), same cancel — S2b', SAME('—'), OK(`cancel: ${brief(get(r2, 'S2b', 'cancel').replace(/^started=\S+ /, ''))}; next turn: ${brief(get(r2, 'S2b', 'next prompt after evaluation finished'))}`)]);
  figs['07-r3-cancel-bricks-session'] = page(
    'Round 3 — a cancel during module evaluation now leaves the Session unrecoverable (G1)',
    'S2e on be10a118a1 vs the new merge-base 6136786c0c: a UserPromptSubmit function Hook whose module awaits a gate file at top level (manifest timeout 60 s); the user cancels while it evaluates, then the module finishes. Each arm on a fresh DB; same jar (built from 6136786c0c).',
    table(['step', 'base <code>6136786c0c</code>', 'head <code>be10a118a1</code>'], rows, ['26%', '37%', '37%']) +
      `<div class="note nbad">930b3092d7 fences a mid-evaluation cancel as <code>outcome_unknown</code>; be10a118a1 republishes the receipt once the module finishes, and drain() then reconciles the Hook record to cancelled. But the turn itself never gets a terminal event, so every load reports recovery required, prompts answer 409, and both <code>managed-runtime</code> recovery routes answer 409 <code>hosted_hook_recovery_required</code> for Hook Sessions — including from a replacement Harness. Base waits for the module and then ends the turn <code>turn_complete(cancelled)</code>; round 2 (ee0f4c901c) cancelled in ~0.4 s and kept the Session usable.</div>`,
  );
}

// ---- Figure 8: F1 fixed (S2d), regression summary, Windows.
{
  const B = b('r43n'); const H = h('r43h3');
  const Bd = b('r43n2'); const Hd = h('r43h4');
  const Bc = b('r43n3'); const Hc = h('r43h5');
  const short = (v) => {
    const broker = v.match(/broker=(.*)$/)?.[1]?.replace(/hooks-activation-[0-9a-f]+…\s*/g, '') ?? '';
    const main = brief(v.replace(/\s*broker=.*$/, '').replace(/status\.recoveryBlocked=/, 'recoveryBlocked=').replace(/ hasActivePrompt=\w+/, '').replace(/ callbacks=\d+/, ''));
    return `${main}${broker ? ` ‖ Broker row ${broker}` : ''}`;
  };
  const step = (label, k, colH = SAME) => [label, SAME(short(get(Bd, 'S2d', k))), colH(short(get(Hd, 'S2d', k)))];
  const pair = (label, s, k, colH = SAME, Br = B, Hr = H) => [label, SAME(brief(get(Br, s, k))), colH(brief(get(Hr, s, k)))];
  const rows = [
    { section: 'F1 (rounds 1–2) — detach while the module evaluates, then the module finishes (S2d, Broker capture)' },
    step('2 detach while evaluating', '2 detach while evaluation pending', OK),
    ['2 Harness→Broker', SAME('— (the turn is still running; detach is refused before any release)'), OK(get(Hd, 'S2d', '2 Harness->Broker').replace(/hooks-activation-[0-9a-f]+/g, '<owner>').replace(/POST \/tool-sessions\/<owner>/g, '').replace(/ \|\| /g, '; ') + ' — no :release')],
    step('5 detach after the module finished', '5 detach', OK),
    step('7 prompt after load', '7 prompt after load', BAD),
    { section: 'Regression (each on a fresh DB)' },
    pair('S1 never-settling module — turn', 'S1', 'turn', OK),
    pair('S1 — other Session in the Workspace', 'S1', 'neighbour Session (no Hooks, same Workspace)', SAME),
    ['S2b cancel while evaluating — cancel', SAME(brief(get(B, 'S2b', 'cancel').replace(/^started=\S+ /, '')) + ' (ends when the module finishes)'), WARN(get(H, 'S2b', 'cancel').replace(/^started=\S+ idle after (\d+) ms terminal=<none>$/, 'turn ends after $1 ms with no turn event'))],
    pair('S2b — next prompt after the module finished', 'S2b', 'next prompt after evaluation finished', BAD),
    pair('S3 300 ms evaluation, timeout 10', 'S3', 'turn', OK),
    pair('S4b 1.5 s evaluation, timeout 3000', 'S4b', 'turn', OK),
    pair('S4a 1.5 s evaluation, timeout 10 (O1)', 'S4a', 'turn', WARN),
    pair('S5 module throws', 'S5', 'turn'),
    pair('S7 DELETE after the module finished', 'S7', 'DELETE after evaluation finished', OK),
    ['S6c replacement Harness: detach retried · other Session', SAME(`${brief(get(Bc, 'S6c', '4 detach retried').replace(/ lease=.*$/, ''))} · ${nb(get(Bc, 'S6c', '5 other Session after the retry'))}`), OK(`${brief(get(Hc, 'S6c', '4 detach retried').replace(/ lease=.*$/, ''))} · ${nb(get(Hc, 'S6c', '5 other Session after the retry'))}`)],
  ];
  const W = `${RIG}/out/r43/windows-r3`;
  const pj = fs.readdirSync(W).filter((x) => /^probe-.*\.txt$/.test(x)).flatMap((x) => fs.readFileSync(`${W}/${x}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const armc = (a) => { const xs = pj.filter((x) => x.arm === a); const ok = xs.length > 0 && xs.every((x) => x.exit === 0); return (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} exit 0 · ${[...new Set(xs.map((x) => x.tests))].join(' / ')}`); };
  rows.push({ section: 'Windows (windows-2022, PR head be10a118a1 + probe workflow; base = 6136786c0c)' });
  rows.push(['head ×5 / merge-base ×3 / raw-import mutant ×2', SAME(`${armc('base').t.slice(2)} / ${armc('rawimport').t.slice(2)}`), armc('head')]);
  figs['08-r3-f1-regression-windows'] = page(
    'Round 3 — F1 is fixed; regression on main 6136786c0c; Windows',
    'be10a118a1 merges origin/main 6136786c0c (Java changed, so the jar was rebuilt; durable local-process mode switched off for macOS). Base arm = 6136786c0c. Other Sessions blocked on a held Workspace now queue (#13366) instead of failing, so those rows show "still running".',
    table(['scenario', 'base <code>6136786c0c</code>', 'head <code>be10a118a1</code>'], rows, ['30%', '35%', '35%']),
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
