// VERIFICATION RIG ONLY (PR #13247): renders the evidence cards from the result ledgers (no screenshots edited).
// usage: node figures.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13247-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig/out`;
fs.mkdirSync(OUT, { recursive: true });
const R = (p) => JSON.parse(fs.readFileSync(`${RIG}/results/${p}`, 'utf8'));
const score = (p) => { const r = R(p); return `${r.pass}/${r.pass + r.fail}`; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 1000;
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:22px 26px 24px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:12.5px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 7px}
  table{border-collapse:collapse;width:${W}px;font-size:12.5px;margin-bottom:10px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td.n{text-align:left;white-space:normal;font-family:ui-monospace,Menlo,monospace;width:250px}
  table{table-layout:fixed}
  td,th{overflow-wrap:anywhere}
  .ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#1f2630;padding:1px 4px;border-radius:4px}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#161b22;border:1px solid #30363d;padding:8px 10px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;line-height:1.45}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin-top:8px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;

// ---- card 1: overview
const mut = fs.readFileSync(`${RIG}/results/mutation/ledger.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const latest = Object.values(Object.fromEntries(mut.filter((m) => (m.suite ?? 'focused') === 'focused').map((m) => [m.id, m])));
const killed = latest.filter((m) => m.verdict === 'KILLED').length;
const survived = latest.filter((m) => m.verdict === 'SURVIVED');
const card1 = page(
  'PR #13247 · W2 same-Workspace cwd change — real-stack verification',
  'head <code>a2d7bd3b02</code> · macOS host · JDK 21 · MySQL 8.4.7 · Spring fat jar with embedded Runtime Broker · packaged Hosted Harness (<code>dist/cli.js</code>) · deterministic fixture model · rig actor adapter',
  `<table><colgroup><col style="width:600px"><col style="width:120px"><col style="width:280px"></colgroup><tr><th>Scenario</th><th>Arm</th><th>Result</th></tr>
  ${row(['S1 happy path on both surfaces: 202 → completed, normalized replay (<code>child2//</code>, <code>child2/./</code>), 409 idempotency/revision, cross-surface reads, DB row, exactly one <code>session.context.changed</code> per change, live public + WebShell SSE', 'head', `<span class="ok">${score('h1/s1-basic.json')}</span>`], ['', '', 'n'])}
  ${row(['S2 admission matrix over HTTP: 401/400/404/403/409 order, lexical cwd rule (12 shapes), cross-tenant, stranger vs reader vs other creator, Registry facts, busy barrier, type coercion', 'head', `<span class="ok">50</span> + 4 rig expectations <span class="dim">(tenant filter answers 400; bound close is unavailable on macOS → S2b)</span>`], ['', '', 'n'])}
  ${row(['S2b status gate CLOSING/CLOSED/ARCHIVING/ARCHIVED/DELETING/DELETED (status seeded by SQL), replay precedes the gate', 'head', `<span class="ok">${score('h1/s2b-states.json')}</span>`], ['', '', 'n'])}
  ${row(['S3 settlement probe on real APFS shapes: missing, file, FIFO, symlink in/out, inner symlink, case alias, NFD alias, &gt;NAME_MAX → failed+unchanged; NFC, CJK+spaces, nested, <code>.</code>, same dir → completed', 'head', `<span class="ok">${score('h1/s3-settlement.json')}</span>`], ['', '', 'n'])}
  ${row(['S4 races: 10 rounds × 20 concurrent admissions (mixed surfaces) → 1 winner/commit/event each; 20× same key → 1 row; same key, different payload → 409', 'head', `<span class="ok">${score('h1/s4-races.json')}</span>`], ['', '', 'n'])}
  ${row(['S5 durability: injected commit failure ×2 → retried once-only; kill -9 inside commit → reclaimed after lease (59.6 s), gen 2, one event; kill -9 inside claim; grants/Registry/dir move between claim and commit → failed, binding kept', 'head', `<span class="ok">11/11</span> <span class="dim">(1 read from the DB row)</span>`], ['', '', 'n'])}
  ${row(['S7 base routes 404 → upgrade V33→V34 → pre-upgrade Session changes dir → rollback to base (starts; GET cwd op 400) → open op survives base, head completes it', 'base↔head', `<span class="ok">${score('u1/s7-upgrade.json')}</span>`], ['', '', 'n'])}
  ${row(['S9/S13 next tool Turn after a change (needs #13112): writes land in <code>child2/</code>, root, old dir after a refusal; dir swapped to a symlink after commit → typed failure; Turn racing an open change → change fails busy', 'head⊕main<br><span class="dim">2b15eac862 (#13112 merged)</span>', `<span class="ok">6/6 + 1/1</span>`], ['', '', 'n'])}
  ${row(['F1 change to a dir the worker cannot read/search (000, 444, 111) → <b>completed</b>, next Turn wedges, storage held', 'head⊕main', `<span class="bad">3/3 wedged</span> · candidate <span class="ok">3/3 refused</span>`], ['', '', 'n'])}
  ${row(['B1 trial merge with current main (#13225 also adds V34)', 'head⊕main', `<span class="bad">startup fails</span> · V35 <span class="ok">24/24</span>`], ['', '', 'n'])}
  ${row(['Unit suite (H2) · HostedPublicWorkspaceIT H2 · MySQL 8.4.7', 'head', `<span class="ok">485/485 · 3/3 · 3/3</span> <span class="dim">(+1 Linux-only skip)</span>`], ['', '', 'n'])}
  ${row([`Mutation: ${latest.length} mutants of the W2 guards vs the PR's focused tests. Survivors: M15 (digest over raw spelling) — killed only by HostedPublicWorkspaceIT; M18/M18b (drop the additive-column tolerance) — killed only by the MySQL retention IT, <b>not</b> by the H2 twin; M17 near-equivalent`, 'head', `<span class="warn">${killed}/${latest.length} killed</span>`], ['', '', 'n'])}
  </table>`,
);

// ---- card 2: F1
const x12 = R('lm/s11-unreadable-main.json').out;
const x12c = R('lmc/s11-unreadable-main-cand.json').out;
const g0 = R('x1/s10-g0-locked.json').rows[0].detail;
const g0c = R('lmc/s10-g0-locked-main-cand.json').rows[0].detail;
const tr = (o) => row([`st-${o.st}`, o.mode, o.change, o.laterTurn, o.neighbour, o.nextChange]);
const card2 = page(
  'F1 · The settlement probe accepts a directory the worker will refuse → next Turn wedges and holds the storage',
  'Java <code>requireDirectory</code> has no <code>access(R_OK|X_OK)</code> step; the worker (<code>managed-context-worker.ts:123</code>) has one. The change commits; the next tool Turn claims storage, the install fails, ownership is retained by design.',
  `<h2>head ⊕ main 2b15eac862 (#13112 merged; W2 migration renumbered V35) — one fresh storage per trial</h2>
  <table><tr><th>storage</th><th>dir mode</th><th>cwd change</th><th>next later Turn</th><th>neighbour Session, same storage</th><th>next cwd change</th></tr>${x12.map(tr).join('')}</table>
  <h2>same + candidate (+7/−1 in <code>WorkspaceRuntimeResolver.requireDirectory</code>: <code>Files.isReadable &amp;&amp; Files.isExecutable</code>)</h2>
  <table><tr><th>storage</th><th>dir mode</th><th>cwd change</th><th>next later Turn</th><th>neighbour Session, same storage</th><th>next cwd change</th></tr>${x12c.map(tr).join('')}</table>
  <h2>Attribution: G0 creation straight into a mode-000 dir (no W2 involved)</h2>
  <pre>main+#13112 code (d20a1895): ${esc(g0)}\ncandidate:                    ${esc(g0c)}</pre>
  <pre>harness: qwen serve: Hosted Harness turn f5eee721-… is recovery blocked: Error: Runtime Broker returned HTTP 503 (runtime_session_acquire_failed).
harness: qwen serve: Hosted Harness turn ea6ea48d-… failed: Error: Runtime Broker returned HTTP 409 (workspace_busy).      ← neighbour
qwen_runtime_session f5eee721-…  session_state=ACQUIRING   managed_workspace_execution_lease.runtime_session_id=f5eee721-…</pre>
  <div class="note bad">chmod 755 afterwards, then a Spring + Harness restart, and 3 more minutes: the Turn is still RUNNING and the lease is still held (macOS non-durable stack; Linux durable recovery not exercised). The wedge itself exists on main for G0; W2 is the first path that moves a <i>working</i> Session into it, and the design's "surfaces at the first turn, still typed" does not hold for this divergence.</div>`,
);

// ---- card 3: B1
const flyLog = fs.readFileSync(`${RIG}/results/merge-main/spring-merge-fresh.log`, 'utf8');
const offenders = (flyLog.match(/Found more than one migration with version 34[\s\S]*?Offenders:\n(?:-> [^\n]*\n){2}/) ?? [''])[0].replace(/\/Users\/wenshao\/pr13247-rig\/nested:\/Users\/wenshao\/pr13247-rig\/server\//g, '');
const card3 = page(
  'B1 · Flyway V34 collides with main (#13225, merged 2026-10-03 00:17 UTC)',
  'The PR\'s CI ran against the older merge ref. Against fa795e0232 git merges cleanly (different file names) but the server cannot start; since #13112 landed (2b15eac862) the merge also conflicts textually.',
  `<h2>head ⊕ origin/main fa795e0232 — fresh MySQL database</h2>
  <pre>${esc(offenders.trim())}</pre>
  <table><tr><th>arm</th><th>migrations in the jar</th><th>result</th></tr>
  ${row(['head ⊕ main fa795e0232', '<code>V34__managed_cwd_operation</code> + <code>V34__managed_tool_output_collection</code>', '<span class="bad">APPLICATION FAILED TO START, 0 migrations applied</span>'])}
  ${row(['head ⊕ main 2b15eac862', 'same V34 pair + text conflicts in <code>README.md</code> and the OpenAPI contract (<code>info.version</code> 1.30.0 vs main 1.29.0)', '<span class="bad">needs a merge commit</span> · resolved locally (keep 1.30.0) + V35 → S1 <span class="ok">' + score('lm/s1-basic.json') + '</span>, later Turns 6/6, unit 553/553 (candidate 554/554)'])}
  ${row(['head ⊕ main fa795e0232, W2 file renamed to V35', '<code>V34__managed_tool_output_collection</code>, <code>V35__managed_cwd_operation</code>', `<span class="ok">starts on a main-built DB (V34) and applies V35; S1 ${score('m35/s1-basic.json')}; Session created by the main jar changes dir ${score('m35/s12-pre-upgrade-m35.json')}</span>`])}
  </table>
  <div class="note">Open PRs #13210 (V34) and #13217 (V34, V35) also claim these numbers — coordinate the next free version before merging.</div>`,
);

const browser = await chromium.launch();
const pg = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
for (const [name, html] of [['01-overview', card1], ['02-f1-unreadable-dir-wedge', card2], ['03-b1-flyway-v34-collision', card3]]) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await pg.goto(`file://${OUT}/${name}.html`);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
