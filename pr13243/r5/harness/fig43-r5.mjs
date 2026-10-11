// VERIFICATION RIG ONLY (PR #13243): evidence figures rendered from the s43 probe ledgers and the Windows
// probe artifact. Cell text comes from the ledgers; only labels and the ok/bad colouring are written here.
// usage: node fig43-r5.mjs
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


// R12-1 evidence: local whole-file runs (head and base) and the GitHub macOS / Windows run.
function r121Rows() {
  const rd = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const headFiles = [`${RIG}/out/r43/unit-h43s/consumers.txt`, `${RIG}/out/r43/unit-h43s/hhs-2.txt`, `${RIG}/out/r43/unit-h43s/hhs-3.txt`, ...[1, 2, 3].map((i) => `${RIG}/out/unit-ab5c/head-file-${i}.txt`)];
  const stray = headFiles.map(rd).map((t) => {
    const fails = [...new Set((t.match(/^ FAIL .*$/gm) ?? []).map((l) => l.replace(/.*> /, '')))];
    return { strayHit: /writeStderrLineSafe" to not be called/.test(t), fails };
  });
  const hits = stray.filter((x) => x.strayHit).length;
  const byTest = {};
  for (const x of stray) if (x.strayHit) for (const f of x.fails) if (/cold reattach|Hook-only operation/.test(f)) byTest[f] = (byTest[f] ?? 0) + 1;
  const ab = rd(`${RIG}/out/unit-ab5c.log`);
  const baseRuns = (ab.match(/^base file run\d+ .*$/gm) ?? []);
  const baseOk = baseRuns.filter((l) => /exit=0 .*stray-stderr-fail=0/.test(l)).length;
  const alone = (ab.match(/^head alone run\d+ exit=0/gm) ?? []).length;
  const rows = [[
    'macOS (this rig, load 17–40)',
    (baseOk === baseRuns.length ? OK : BAD)(`${baseOk}/${baseRuns.length} green (365 passed)`),
    (hits ? BAD : OK)(`strict guard failed in ${hits}/${headFiles.length} runs — ${Object.entries(byTest).map(([k, v]) => `${k.replace(/^reports an aborted live turn as cancelled after a Java-style /, '')} ×${v}`).join(', ')}; every failure is the leaked "Hosted wake turn … aftermath could not be settled: … resource … is not present" line. The case alone: ${alone}/3 green`),
  ]];
  for (const os of ['macos-latest', 'windows-2022']) {
    const f = `${RIG}/out/r12-1/probe-pr13243-r12-1-${os}/summary.txt`;
    const xs = rd(f).split('\n').filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
    if (!xs.length) { rows.push([`GitHub ${os}`, SAME('—'), WARN('no result')]); continue; }
    const strayN = xs.filter((x) => x.strayStderrFailures > 0).length;
    const all = [...new Set(xs.flatMap((x) => x.failed.split(';').filter(Boolean)))];
    const guard = all.filter((f) => /cold reattach|Hook-only operation/.test(f)).map((f) => f.replace(/^reports an aborted live turn as cancelled after a Java-style /, '').replace(/^runs and queries a /, ''));
    const other = all.filter((f) => !/cold reattach|Hook-only operation/.test(f));
    rows.push([`GitHub ${os} ×${xs.length} (run 38167719477)`, SAME('—'), (strayN ? BAD : xs.every((x) => x.exit === 0) ? OK : WARN)(`strict guard failed in ${strayN}/${xs.length} runs (${guard.join(', ')}), same leaked line${other.length ? ` · other one-off failures: ${other.join('; ')}` : ''}`)]);
  }
  rows.push(['Linux (PR CI Test ubuntu-latest)', SAME('—'), OK('pass (one run at this head)')]);
  return rows;
}

const figs = {};
const nb = (v) => brief(v.replace(/ wrote=(\w+)$/, '')) + (/wrote=true/.test(v) ? ' · file written' : / wrote=false/.test(v) ? ' · nothing written' : '');
const H = (db) => load(db, 'h43s');
const B = (db) => load(db, 'b43r');
const g = (r, s, k) => brief(get(r, s, k));
const row = (r) => r.replace(/ broker=hooks-activation-[0-9a-f]+…\s*/, ' · Broker row ').replace(/ \(\d+ ms\)/, '');

// ---- Figure 11: bot R4-3 — native Windows runtime + real-stack consequence chain.
{
  const W = `${RIG}/out/windows-r5c`;
  const pj = fs.readdirSync(W).filter((x) => x.endsWith('.jsonl')).flatMap((x) => fs.readFileSync(`${W}/${x}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const NW = `${RIG}/out/windows-r5`;
  const native = fs.readFileSync(`${NW}/probe-native.txt`, 'utf8').split('\n').filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const nat = (name) => native.find((x) => x.name === name);
  const rt = (arm, name) => pj.find((x) => x.arm === arm && x.name === name);
  const holds = (x) => `${x.receiptError ?? x.receiptResult?.outcome} · hasHolds ${x.holdsAtSettle}/${x.holdsAfterBudget}/${x.holdsAfter4500ms}`;
  const hc = (x) => (x.holdsAfter4500ms ? BAD(holds(x)) : OK(holds(x)));
  const names = [['unc-host', '\\\\host'], ['unc-empty-server', '\\\\\\\\'], ['unc-long-empty', '\\\\?\\UNC\\'], ['unc-long-host', '\\\\?\\UNC\\host'], ['unc-host-trailing-sep', '\\\\host\\ (control: converts, import fails later)'], ['posix-missing-file', '/no/such/dir/h.mjs (control)'], ['control-real-module', 'a real module file (control)']];
  const rows = [{ section: 'windows-2022, real ManagedHookRuntime (real manifest validation, dispatch and node:url). hasHolds at settle / after the 500 ms budget / 4.5 s later' }];
  for (const [n, label] of names) {
    const nv = nat(n);
    const conv = nv ? (nv.throws ? `isAbsolute ${nv.isAbsolute} · pathToFileURL throws ${nv.throws.split(' ')[0]}` : `isAbsolute ${nv.isAbsolute} · converts`) : '—';
    rows.push([`${label}`, SAME(conv), hc(rt('base', n)), hc(rt('prev-9aa7997', n)), hc(rt('head', n))]);
  }
  const um = fs.readFileSync(`${W}/probe-unit-mutant.txt`, 'utf8').split('\n').filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)))[0];
  rows.push(['the PR\x27s new unit test (pathToFileURL mocked to throw)', SAME('—'), SAME('—'), um.exit !== 0 ? OK(`fails with only the fix reverted (${um.tests})`) : BAD(`passes with the fix reverted (${um.tests})`), OK('passes (in the 3/3 suite runs)')]);
  const i = load('r43r9i', 'h43r-inj'), f = load('r43s9i', 'h43s-inj'), b = load('r43b9i', 'b43r-inj');
  const s9 = (r, k) => get(r, 'S9', k);
  const rel = (r) => s9(r, '3 Harness->Broker').replace(/hooks-activation-[0-9a-f]+/, '<owner>').replace(/^POST \/tool-sessions\//, '');
  const rows2 = [
    { section: 'Real stack (Spring + Broker + local worker + Hosted Harness). The injected dists throw Node\x27s own ERR_INVALID_ARG_VALUE at the import site for one marker module — the Windows trigger above, moved to macOS' },
    ['first Hook turn (handler unavailable)', SAME(brief(s9(b, '1 turn'))), SAME(brief(s9(i, '1 turn'))), SAME(brief(s9(f, '1 turn')))],
    ['DELETE /session', OK(row(s9(b, '3 DELETE'))), BAD(row(s9(i, '3 DELETE'))), OK(row(s9(f, '3 DELETE')))],
    ['Harness → Broker on that DELETE', OK(rel(b)), BAD(rel(i)), OK(rel(f))],
    ['DELETE again 10 s later · detach', SAME('—'), BAD(`${row(s9(i, '4 DELETE again after 10 s'))} · detach ${row(s9(i, '5 detach')).split(' · ')[0]}`), SAME('—')],
    ['Workspace lease · Hook-less Session in the Workspace', OK(`${s9(b, '7 lease holder').startsWith('<none>') ? 'released' : 'held'} · ${nb(s9(b, 'neighbour Session (no Hooks, same Workspace)'))}`), BAD(`held by the Hook owner · ${nb(s9(i, 'neighbour Session (no Hooks, same Workspace)'))}`), OK(`${s9(f, '7 lease holder').startsWith('<none>') ? 'released' : 'held'} · ${nb(s9(f, 'neighbour Session (no Hooks, same Workspace)'))}`)],
    ['replacement Harness: load · Hook turn · DELETE', SAME('—'), BAD(`load ${brief(s9(i, '8 load in a replacement Harness')).replace(' recoveryRequired', '')} recoveryRequired · ${brief(s9(i, '9 Hook turn in the replacement Harness'))} · DELETE ${row(s9(i, '10 DELETE in the replacement Harness')).split(' · ')[0]}; Broker answers every control ${s9(i, '10 Harness->Broker since step 9').match(/409 \w+/)[0]}`), SAME('—')],
  ];
  figs['11-r5-r4-3'] = page(
    'Round 5 — R4-3: real on native Windows and on the real stack at 9aa7997816, fixed by c4f98b15c5',
    'Base = merge-base d9c6f8c0fe; 9aa7997816 = head before the fix; c4f98b15c5 = current head (converts the path in a try before arming the hold). Windows: GitHub-hosted windows-2022, Node 22, run 38161701055 (9aa7997816 and base also in runs 38158577096 / 38159674854, same results).',
    table(['input', 'native Windows', 'base <code>d9c6f8c0fe</code>', '<code>9aa7997816</code>', 'head <code>c4f98b15c5</code>'], rows, ['20%', '20%', '20%', '20%', '20%']) +
      table(['real stack (macOS, injected trigger)', 'base + injection', '<code>9aa7997816</code> + injection', 'head <code>c4f98b15c5</code> + injection'], rows2, ['22%', '26%', '26%', '26%']) +
      `<div class="note">Base and <code>c4f98b15c5</code> publish the same <code>handler_unavailable</code> receipt and then release normally (the review\x27s suggested patch on <code>9aa7997816</code> measured the same: DELETE 204, <code>RELEASED v3</code>). <code>9aa7997816</code> keeps <code>moduleEvaluationPending</code> set, so the worker refuses <code>:release</code> with <code>managed_runtime_owner_hold_pending</code>. The Broker has already persisted <code>RELEASING</code> (round-1 F1\x27s Java root) and does not roll it back: the row was set at the first DELETE and was still <code>RELEASING v2</code> when the run ended about 1¾ min later. A replacement Harness then gets <code>runtime_session_not_ready</code> on every control. The asynchronous failure in S5 (module throws at top level) detaches with 204 on every arm.</div>`,
  );
}

// ---- Figure 12: what bf90e3bb2e changed (notStarted marker) on the real stack, and the regression matrix.
{
  const h1 = H('r43s1'), b1 = B('r43b1'), h4 = H('r43s4'), b4 = B('r43b4'), h2 = H('r43s2');
  const hS = (db) => H(db);
  const dur = (r, s) => { const v = get(r, s, s === 'S2e' ? '2b durable Hook result (classifier input)' : 'durable Hook results (classifier input)'); const m = v.match(/\{"success":false,"outcome":"(\w+)","duration":0(,"notStarted":true)?\}/); return m ? `{outcome:"${m[1]}", duration:0${m[2] ? ', notStarted:true' : ''}}` : 'no fence record'; };
  const st = (r) => get(r, 'S2e', '4 status').match(/"recoveryBlocked":\w+/)[0];
  const att = (r) => get(r, 'S8d', '6 recovery attempts').replace(/ \(\d+ ms\)/g, '').replace(/^managed-runtime\/cancel=(\S+ \S+) /, 'managed-runtime/cancel $1 · ').replace(/ prompt: /, ' · prompt ');
  const pjOf = (dir, file) => fs.readFileSync(`${RIG}/out/${dir}/${file}`, 'utf8').split('\n').filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const pj = [...pjOf('windows-r5', 'probe-base.txt'), ...pjOf('windows-r5c', 'probe-head.txt')];
  const armc = (a) => { const xs = pj.filter((x) => x.arm === a); const ok = xs.length > 0 && xs.every((x) => x.exit === 0); return (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} exit 0 · ${[...new Set(xs.map((x) => x.tests))].join(' / ')}`); };
  const rows = [
    { section: 'bf90e3bb2e — the fence classifier now needs the Runtime\x27s notStarted marker: does it survive Runtime → Broker → Session store?' },
    ['S2e cancel mid-evaluation: Broker-relayed receipt', SAME('—'), OK(get(h4, 'S2e', '2c Broker-relayed Hook receipts since cancel').replace(/^POST \/tool-sessions\/[^/]+\/control /, ''))],
    ['S2e durable result the classifier reads', SAME(dur(b4, 'S2e') + ' — base has no fence classifier; it waits for the module'), OK(dur(h4, 'S2e'))],
    ['S4a over-budget evaluation: durable result', SAME('the hook ran (base has no budget)'), OK(dur(h1, 'S4a'))],
    { section: 'G1 / F1 / O1 and the replacement-Harness cases (same as round 4)' },
    ['S2e detach + load → status · prompt in a replacement Harness', OK(`${st(b4)} · ${g(b4, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, '')}`), OK(`${st(h4)} · ${g(h4, 'S2e', '9 prompt in new Harness').replace(/ callbacks=\d+$/, '')}`)],
    ['S2b next prompt after the module finished', OK(g(b1, 'S2b', 'next prompt after evaluation finished')), OK(g(h1, 'S2b', 'next prompt after evaluation finished'))],
    ['S2d detach while evaluating · Broker row', SAME(row(get(B('r43b2'), 'S2d', '2 detach while evaluation pending'))), OK(row(get(h2, 'S2d', '2 detach while evaluation pending')))],
    ['S4a 1.5 s evaluation, timeout 10: next prompt · Hook-less Session', OK(`${g(b1, 'S4a', 'next prompt, same Session')} · ${nb(get(b1, 'S4a', 'neighbour Session (no Hooks, same Workspace)'))}`), OK(`${g(h1, 'S4a', 'next prompt, same Session')} · ${nb(get(h1, 'S4a', 'neighbour Session (no Hooks, same Workspace)'))}`)],
    ['S1 never-settling module — turn', BAD(g(b1, 'S1', 'turn')), OK(g(h1, 'S1', 'turn'))],
    ['S6 replacement Harness: Hook turn after the module finished', BAD(g(b1, 'S6', 'Hook turn after evaluation finished').replace(/ callbacks=\d+$/, '')), OK(g(h1, 'S6', 'Hook turn after evaluation finished').replace(/ callbacks=\d+$/, ''))],
    ['S6c replacement Harness detach while evaluating → retry', SAME(`${row(get(B('r43b3'), 'S6c', '1 detach while evaluation pending')).replace(/ lease=.*/, '')} → ${row(get(B('r43b3'), 'S6c', '4 detach retried')).replace(/ lease=.*/, '')}`), SAME(`${row(get(H('r43s3'), 'S6c', '1 detach while evaluation pending')).replace(/ lease=.*/, '')} → ${row(get(H('r43s3'), 'S6c', '4 detach retried')).replace(/ lease=.*/, '')}`)],
    { section: 'R8-1 — cancel reaches the Runtime while the PreToolUse callback runs, Harness SIGKILLed before the turn settles (S8d)' },
    ['S8a (Harness alive): turn · next prompt', OK(`${get(B('r43b5'), 'S8a', '1 cancel').match(/terminal=(\S+)/)[1]} · ${brief(get(B('r43b5'), 'S8a', '4 next prompt'))}`), OK(`${get(H('r43s5'), 'S8a', '1 cancel').match(/terminal=(\S+)/)[1]} · ${brief(get(H('r43s5'), 'S8a', '4 next prompt'))}`)],
    ['S8d callback ledger', SAME(get(B('r43b8k80'), 'S8d', '1 cancel then SIGKILL').replace(/; callback ledger: /, ': ') + ' — the cancel did not reach the Broker before the kill (capture: ' + get(B('r43b8k80'), 'S8d', '1b Harness->Broker before the replacement').replace(/^POST \/tool-sessions\/<owner>\/control /, '') + ' only); round 4 showed base equally blocked when it did'), SAME(get(H('r43s8k80'), 'S8d', '1 cancel then SIGKILL').replace(/; callback ledger: /, ': '))],
    ['S8d recovery: managed-runtime/cancel · detach · load · prompt', BAD(att(B('r43b8k80'))), BAD(att(H('r43s8k80')) + ' (9aa7997816: 80 and 150 ms identical)')],
    { section: 'R12-1 — whole-file runs of hosted-harness-session.test.ts; c4f98b15c5 restored the strict expect(log).not.toHaveBeenCalled()' },
    ...r121Rows(),
    { section: 'Windows (windows-2022): PR suites managed-hook-runtime + hosted-hook-session — base in run 38158577096, head in run 38161701055' },
    ['merge-base ×2 · head ×3', armc('base'), armc('head')],
  ];
  figs['12-r5-regression'] = page(
    'Round 5 — notStarted reaches the classifier and round-4 behaviour holds; the strict stderr guard c4f98b15c5 restored fails on macOS and Windows',
    'Real stack, each arm on a fresh DB and its own jar. Base = merge-base d9c6f8c0fe; head = c4f98b15c5 (its Java is unchanged from 9aa7997816, so it runs on that jar). 9aa7997816 gave the same result on every row. Durable results are read from the Session store tables; the Broker capture is a proxy between Harness and Broker.',
    table(['scenario', 'base <code>d9c6f8c0fe</code>', 'head <code>c4f98b15c5</code>'], rows, ['30%', '35%', '35%']),
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
