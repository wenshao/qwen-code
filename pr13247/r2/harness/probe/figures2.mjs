// VERIFICATION RIG ONLY (PR #13247 round 2): evidence cards rendered from the round-2 ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13247-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/r2/fig`;
fs.mkdirSync(OUT, { recursive: true });
const R = (p) => JSON.parse(fs.readFileSync(`${RIG}/${p}`, 'utf8'));
const sc = (p) => { const r = R(p); return `${r.pass}/${r.pass + r.fail}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 1000;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:22px 26px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:12.5px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 7px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:10px;table-layout:fixed}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{font-family:ui-monospace,Menlo,monospace}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#1f2630;padding:1px 4px;border-radius:4px}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#161b22;border:1px solid #30363d;padding:8px 10px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;line-height:1.45}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;
const ok = (t) => `<span class="ok">${t}</span>`, warn = (t) => `<span class="warn">${t}</span>`, dim = (t) => `<span class="dim">${t}</span>`;

const card1 = page(
  'PR #13247 · round 2 — re-verified at <code>4f9e60b300</code>',
  'Arms: <code>head</code> and <code>head ⊕ main 2c591ecc08</code> (clean merge; W2 migration is V35). macOS host, JDK 21, MySQL 8.4.7, real Spring fat jar + embedded Broker, packaged Hosted Harness, fixture model. Every scenario re-run on head ⊕ main unless noted.',
  `<h2>Round-1 items</h2>
  <table><colgroup><col style="width:200px"><col style="width:520px"><col style="width:280px"></colgroup><tr><th>item</th><th>what the real stack shows now</th><th>status</th></tr>
  ${row(['B1 Flyway V34 collision', 'head ⊕ main merges cleanly and starts; main jar (V34) → head ⊕ main applies V35; pre-upgrade Session changes directory', ok('resolved') + ' ' + dim('(#13210, #13217 now also claim V35)')])}
  ${row(['F1 unreadable target wedges the next Turn', 'modes 000 / 444 / 111 → <code>failed/workspace_unavailable</code>, later Turn and neighbour complete; G0 into a 000 dir → typed <code>hosted_turn_failed</code>, 0 leases held', ok('fixed') + ' (R2-3)'])}
  ${row(['T1 schema-upgrade test read an empty table', 'test now seeds a row; mutant M18b (drop the additive tolerance) is killed by the H2 test itself', ok('fixed')])}
  ${row(['N1 stranger 409 / replay 409 with opt-in off', `stranger 404 like an unknown id; replay of a completed change → 202 <code>replayed</code> (S8 ${sc('r2/results/r2m/s8-optin-off.json')})`, ok('fixed') + ' (R2-1)'])}
  ${row(['N5 later Turn not gated on an open change', 'later Turn during an open change → 409 <code>session_context_busy</code>; admitted again after settle; stuck rename / open ACTION_RESPONSE do not block Turns (R2-4)', ok('fixed') + ' (handshake)'])}
  ${row(['N2 rollback with an open op · N3 lenient JSON · N4 "installing" during backoff · N6 M15 pinned only by Hosted IT', 'unchanged', dim('minor, unchanged')])}
  </table>
  <h2>Scenarios (head ⊕ main unless noted)</h2>
  <table><colgroup><col style="width:740px"><col style="width:260px"></colgroup><tr><th>scenario</th><th>result</th></tr>
  ${row(['S1 both surfaces, normalized replay, events, live SSE', ok(sc('r2/results/r2m/s1-basic.json')) + ' · head ' + ok(sc('r2/results/r2/s1-basic.json'))], ['', 'n'])}
  ${row(['S2 admission matrix · S2b status gate (reader on DELETED now 403, same as sibling close/archive/delete — S18)', ok('50') + ' + 4 rig · ' + ok('13/14') + dim(' + reader-on-DELETED expectation updated')], ['', 'n'])}
  ${row(['S3 settlement on real APFS shapes', ok('15/16') + dim(' + the 000 dir now refused (F1 fix)')], ['', 'n'])}
  ${row(['S4 races 10 × 20 · S5 retry / kill -9 in commit (reclaimed 58.7 s) / kill -9 in claim / facts move', ok(sc('r2/results/r2m/s4-races.json')) + ' · ' + ok('11/11') + dim(' (1 from DB row)')], ['', 'n'])}
  ${row(['S7 main jar V34 → head ⊕ main V35 → rollback → roll-forward', ok(sc('r2/results/u2/s7-upgrade-r2m.json'))], ['', 'n'])}
  ${row(['S9/S13/S17 next Turn in the new dir; Turn / rename / cancel against an open change', ok(sc('r2/results/r2m/s9-later-turns-nolock.json') + ' · ' + sc('r2/results/r2m/s13-reverse-race.json') + ' · ' + sc('r2/results/r2m/s17-interplay.json'))], ['', 'n'])}
  ${row(['S14 permission Action gate (R3-1): waiting approval, cancel, approve, requested Action without a Turn, expiry', ok(sc('r2/results/r2m/s14-actions.json')) + dim(' (case C: Turn row forced terminal by SQL)')], ['', 'n'])}
  ${row(['S15 mount root missing mid-settlement: retried; same root back → completed; replaced root → FAILED', ok(sc('r2/results/r2m/s15-transient-mount.json'))], ['', 'n'])}
  ${row(['S16 change away from a destroyed current dir; S19 barrier population (SQL-seeded rows, head)', ok(sc('r2/results/r2m/s16-destroyed-current.json') + ' · ' + sc('r2/results/r2/s19-barrier-population.json'))], ['', 'n'])}
  ${row(['head: <code>clean verify checkstyle:check</code> (SpotBugs on) · Hosted IT H2 / MySQL', ok('585/585 · 3/3 · 3/3') + dim(' (+1 Linux-only skip)')], ['', 'n'])}
  ${row(['head ⊕ main: same gates', ok('591/591 · 3/3 · 3/3') + dim(' (first run 1 flaky artifact-read timeout, see notes)')], ['', 'n'])}
  </table>`,
);

const mut = fs.readFileSync(`${RIG}/r2/mutation/ledger.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const foc = Object.values(Object.fromEntries(mut.filter((m) => (m.suite ?? 'focused') === 'focused').map((m) => [m.id, m])));
const killed = foc.filter((m) => m.verdict === 'KILLED').length;
const s15 = R('r2/results/r2m/s15-transient-mount.json').rows.filter((r) => r.note).map((r) => `${r.label}: ${r.detail}`).join('\n');
const card2 = page(
  'Round 2 · what pins the R3 claims — mutation + real stack',
  `${foc.length} mutants of the new and old W2 guards against the PR's focused tests: ${killed} killed. Survivors re-run against the full unit suite and HostedPublicWorkspaceIT, then against the real stack with mutant jars.`,
  `<table><colgroup><col style="width:330px"><col style="width:170px"><col style="width:200px"><col style="width:300px"></colgroup><tr><th>survivor</th><th>full unit (585)</th><th>Hosted IT</th><th>real stack / candidate tests</th></tr>
  ${row(['N5 admission ignores a requested Action (R3-1 admission half)', warn('survives'), warn('survives'), ok('S14-C admits 202') + ' · candidate test kills'])}
  ${row(['N12 a transient probe refusal fails terminally', warn('survives'), warn('survives'), ok('S15-A FAILED in 15 ms') + ' · candidate test kills'])}
  ${row(['N11 mount-continuity I/O failure classified structural', warn('survives'), warn('survives') + dim(' (rerun)'), ok('S15-A FAILED') + ' · candidate test kills'])}
  ${row(['N10 requireDirectory I/O failure classified structural', warn('survives'), warn('survives'), dim('reachable only by a race between isDirectory and toRealPath')])}
  ${row(['M15 digest over the raw spelling', warn('survives'), ok('killed'), dim('(round 1: same)')])}
  </table>
  <div class="note">Why N5 survives: <code>aRequestedActionBlocksAdmissionAndSettlement</code> plants the Action on a Session that already has an open cwd operation, so <code>hasOpenOperation</code> refuses first. The transient test injects an <code>IllegalStateException</code>, not the new retryable <code>RuntimeBrokerException</code>. Candidate: 3 tests, +65 lines, 37/37 on head, each kills its mutant.</div>
  <h2>S15 — mount root missing for 9 s (head ⊕ main)</h2>
  <pre>${esc(s15)}</pre>
  <div class="note">Retry attempts are unbounded (delay capped at 60 s; the code comment says "bounded retry"). While the operation is open the Session refuses later Turns and further changes (409 <code>session_context_busy</code>, measured) and rename (409 <code>session_operation_active</code>, S17); by code close/archive/delete hit the same barrier (bound close is unavailable on this macOS stack) — indefinitely if the same root never returns.</div>`,
);

const browser = await chromium.launch();
const pg = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
for (const [name, html] of [['r2-01-overview', card1], ['r2-02-mutation-and-transient', card2]]) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await pg.goto(`file://${OUT}/${name}.html`);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
