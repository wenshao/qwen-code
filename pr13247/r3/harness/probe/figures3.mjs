// VERIFICATION RIG ONLY (PR #13247 round 3): evidence card rendered from the round-3 ledgers.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13247-rig';
const require = createRequire(`${RIG}/wt/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/r3/fig`;
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
  .note.bad{border-left-color:#f85149}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const row = (cells, cls = []) => `<tr>${cells.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('')}</tr>`;
const ok = (t) => `<span class="ok">${t}</span>`, bad = (t) => `<span class="bad">${t}</span>`, dim = (t) => `<span class="dim">${t}</span>`;
const fly = fs.readFileSync(`${RIG}/r3/flyway-check.txt`, 'utf8').split('\n').filter((l) => /V36|unique|real exits/.test(l) && !/exit shown/.test(l)).map((l) => l.replace(/packages\/sdk-java\/managed-agent-server\/src\/main\/resources\/db\/migration\//g, '')).join('\n');
const startup = (fs.readFileSync(`${RIG}/r3/results/merge-main/spring-r3m-fresh.log`, 'utf8').match(/Found more than one migration with version 36[\s\S]*?Offenders:\n(?:-> [^\n]*\n){2}/) ?? [''])[0].replace(/\/Users\/wenshao\/pr13247-rig\/nested:\/Users\/wenshao\/pr13247-rig\/server\//g, '');
const r = (n) => `r3/results/r3s/${n}.json`;
const card = page(
  'PR #13247 · round 3 — <code>1a55a6b246</code>: the migration collides again',
  'Since round 2 the PR only merged main and renumbered V35 → V36 (W2 sources and tests unchanged). #13217 merged 40 minutes later with <code>V36__managed_session_journal_activation.sql</code>; main is now at V39 (<code>17c182eda0</code>).',
  `<h2>B1 again — head ⊕ main 17c182eda0</h2>
  <pre>${esc(startup.trim())}</pre>
  <pre>${esc(fly)}</pre>
  <table><colgroup><col style="width:330px"><col style="width:670px"></colgroup><tr><th>arm</th><th>result</th></tr>
  ${row(['head 1a55a6b246 alone', ok('boots in the Hosted IT (H2, MySQL); uniqueness script passes') + dim(' (its CI check finished 13:20:49 UTC; #13217 merged at 13:57)')])}
  ${row(['head ⊕ main, fresh DB / DB built by the main jar (V39)', bad('APPLICATION FAILED TO START') + ' — both; the CI script <code>check-flyway-migrations.js</code> exits 1 on this tree'])}
  ${row(['head ⊕ main with the W2 file renamed to V40', ok('starts; full suite below')])}
  </table>
  <div class="note bad">GitHub reports the PR as MERGEABLE (no text conflict). Merging as is lands two V36 files on main: the server stops starting and the push-run uniqueness check goes red. V40 is itself claimed by open #13354, #13265, #13210 and #13289 — pick the next free number at merge time and re-run the check.</div>
  <h2>Everything else, re-run on head ⊕ main (V40)</h2>
  <table><colgroup><col style="width:740px"><col style="width:260px"></colgroup><tr><th>scenario</th><th>result</th></tr>
  ${row(['S1 both surfaces · S4 races · S9/S13/S17 later Turns and interplay', ok(`${sc(r('s1-basic'))} · ${sc(r('s4-races'))} · ${sc(r('s9-later-turns-nolock'))} · ${sc(r('s13-reverse-race'))} · ${sc(r('s17-interplay'))}`)], ['', 'n'])}
  ${row(['S2 / S2b / S3 (same expectation updates as round 2: tenant filter, macOS bound close, reader-on-DELETED 403, 000 dir refused)', ok('50 · 13/14 · 15/16') + dim(' (+ expected)')], ['', 'n'])}
  ${row(['F1 stays fixed: 000 / 444 / 111 refused, later Turn + neighbour complete; G0 into 000 → typed in 733 ms, 0 leases', ok('3/3 · typed')], ['', 'n'])}
  ${row(['S5 retry + kill -9 in commit (reclaimed 59.4 s) / in claim · S15 transient mount · S16 destroyed current dir', ok(`11/11 (D1 from DB row) · ${sc(r('s15-transient-mount'))} · ${sc(r('s16-destroyed-current'))}`)], ['', 'n'])}
  ${row(['S8 opt-in off · S14 Action gate · S18 deleted reader = siblings · S19 barrier population', ok(`${sc(r('s8-optin-off'))} · ${sc(r('s14-actions'))} · ✓ · ${sc(r('s19-barrier-population'))}`)], ['', 'n'])}
  ${row(['S20 new: same-tenant bursts (#13365 shape) — 4 × (8 cwd changes + 8 later Turns + 8 creations), barrier-released', ok(`${sc(r('s20-tenant-burst'))}`) + dim(' 96/96 202, lock_deadlocks 0→0')], ['', 'n'])}
  ${row(['S7 main jar V39 → head ⊕ main V40 → rollback → roll-forward', ok(sc('r3/results/u3/s7-upgrade-r3m40.json'))], ['', 'n'])}
  ${row(['<code>clean verify checkstyle:check</code> (SpotBugs) · Hosted IT H2 / MySQL', ok('head 607 · 3/3 · 3/3') + '<br>' + ok('merge 676 · 3/3 · 3/3') + dim(' (1 H2 load timeout, 3/3 on rerun)')], ['', 'n'])}
  ${row(['Round-2 test gap: N5 / N11 / N12 still survive the PR\'s tests; the round-2 candidate tests apply cleanly (37/37) and kill all three', '<span class="warn">open</span>'], ['', 'n'])}
  </table>`,
);
const browser = await chromium.launch();
const pg = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 900 } });
fs.writeFileSync(`${OUT}/r3-01-overview.html`, card);
await pg.goto(`file://${OUT}/r3-01-overview.html`);
await pg.locator('#card').screenshot({ path: `${OUT}/r3-01-overview.png` });
console.log(`${OUT}/r3-01-overview.png`);
await browser.close();
