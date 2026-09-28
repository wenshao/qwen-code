// Renders the PR #12932 verification evidence cards from the rig's result
// files, then screenshots each .card element at 2x with Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const FIG = path.dirname(new URL(import.meta.url).pathname);
const SP = path.dirname(FIG);
const OUT = path.join(SP, 'rig', 'out');
const require = createRequire(path.join(SP, 'wt-pr', 'package.json'));
const { chromium } = require('playwright');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{width:1400px;padding:28px 32px 30px;background:#0d1117}
h1{font-size:25px;margin:0 0 6px;font-weight:650} .sub{color:#8b949e;font-size:14.5px;margin-bottom:18px;line-height:1.45}
.grid{display:grid;gap:16px} .g2{grid-template-columns:1fr 1fr}
.panel{border:1px solid #30363d;border-radius:8px;background:#161b22;overflow:hidden}
.ph{padding:9px 14px;border-bottom:1px solid #30363d;font-size:14px;font-weight:600;display:flex;justify-content:space-between}
pre{margin:0;padding:12px 14px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
table{border-collapse:collapse;width:100%;font-size:13.5px} th,td{padding:6px 10px;border-bottom:1px solid #21262d;text-align:left;vertical-align:top}
th{color:#8b949e;font-weight:600;background:#161b22} td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600} .bad{color:#f85149;font-weight:600} .warn{color:#d29922;font-weight:600} .dim{color:#8b949e}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600}
.p-ok{background:#12351f;color:#3fb950} .p-bad{background:#3d1417;color:#f85149} .p-warn{background:#3a2a0b;color:#d29922} .p-dim{background:#21262d;color:#8b949e}
.note{margin-top:16px;border-left:4px solid #3fb950;padding:8px 14px;background:#11161d;font-size:14px;line-height:1.5}
.note.w{border-color:#d29922} .k{color:#79c0ff}
`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
const cards = {};

// ---------- 01: before / after ----------
{
  const base = J('s0-base-mysql.json');
  const pr = J('s0-pr-mysql.json');
  const show = (x) => `GET /v1/agents/sessions/{id}/turns\n→ ${x.list.status}\n${JSON.stringify(x.list.body, null, 2)}\n\nGET /v1/agents/sessions/{id}/turns/${x.turnId}\n→ ${x.detail.status}\n${JSON.stringify(x.detail.body, null, 2)}`;
  cards['01-before-after-real-stack'] = `<div class="card">
<h1>Same real stack, base vs PR: a Session whose first Turn the Hosted Harness completed</h1>
<div class="sub">Spring server jar + packaged Hosted Harness (<span class="mono">dist/cli.js serve --profile hosted-harness</span>) + fake OpenAI-compatible model + MySQL 8.4 (Docker).
Only the jar differs: base <span class="mono">b32f261afd</span> (merge base) vs PR <span class="mono">dcfbbeb9da</span>. The Turn came from a real <span class="mono">POST /v1/agents/sessions</span> with input.</div>
<div class="grid g2">
<div class="panel"><div class="ph"><span>base b32f261afd</span><span class="pill p-bad">route absent</span></div><pre>${esc(show(base))}</pre></div>
<div class="panel"><div class="ph"><span>PR dcfbbeb9da</span><span class="pill p-ok">served</span></div><pre>${esc(show(pr))}</pre></div>
</div>
<div class="note">After: one Turn, <span class="k">status "completed"</span>, <span class="k">has_more false</span>, <span class="k">next_cursor null</span>; the detail body is byte-identical to the list entry.
<span class="k">input_item_id</span> names a real Item of the Session, and <span class="k">created_at/completed_at</span> are the stored milliseconds in whole seconds.</div>
</div>`;
}

// ---------- 02: test plan matrix ----------
{
  const parse = (f) => {
    const lines = fs.readFileSync(path.join(OUT, f), 'utf8').split('\n');
    const res = {};
    for (const l of lines) {
      const m = /\[(PASS|FAIL)\] ([A-E])\d? /.exec(l);
      if (m) {
        res[m[2]] = res[m[2]] ?? { pass: 0, fail: 0 };
        res[m[2]][m[1] === 'PASS' ? 'pass' : 'fail']++;
      }
    }
    return res;
  };
  const arms = [['PR · MySQL 8.4', parse('s1-pr-mysql.log')], ['PR · MariaDB 10.11.18', parse('s1-pr-mariadb.log')], ['main a765229c0a + PR · MySQL 8.4', parse('s1-merge-mysql.log')]];
  const groups = [
    ['A', 'Test plan: first Turn; running Turn = Session.active_turn; 25 Harness-run Turns paged at limit 1,2,3,4,5,7,10,20,24,25,26,100,default; 3 Turns created mid-walk'],
    ['B', 'Validation + scoping: limit 0/101/-1/abc/2^31/1.5; 7 malformed cursor shapes (incl. 513 chars, beyond long, leading zero); blank cursor; 64/65-char + emoji IDs; trailing-space and upper-cased IDs; unknown Session; validate-before-lookup; other tenant; tenant differing by case; other Session'],
    ['C', 'Lifecycle: closed and archived Sessions stay readable; deleted Session → 404 session_not_found on both routes; delete operation still readable'],
    ['D', 'Workspace-bound Session: reader 200; actor without grant 404; can_create without can_read 404'],
    ['E', 'Five Turns in the same millisecond with IDs differing only by case (utf8mb4_bin), paged at limit 1,2,3; input "not json {" never parsed'],
  ];
  const cell = (r) => (r ? `<span class="${r.fail ? 'bad' : 'ok'}">${r.pass}/${r.pass + r.fail}</span>` : '-');
  const tot = (res) => Object.values(res).reduce((a, r) => ({ pass: a.pass + r.pass, fail: a.fail + r.fail }), { pass: 0, fail: 0 });
  cards['02-real-stack-test-plan'] = `<div class="card">
<h1>Reviewer test plan + edge probes on the real stack: 71/71 on each arm</h1>
<div class="sub">Turns 1–28 were created by real input and completed by the packaged Hosted Harness; D and E insert rows directly (as the PR's own tests do) to reach states the API cannot create. Every response of the two routes was then validated against the PR's OpenAPI 3.1 contract.</div>
<table><tr><th style="width:40px">#</th><th>What</th>${arms.map(([n]) => `<th style="width:150px">${esc(n)}</th>`).join('')}</tr>
${groups.map(([g, w]) => `<tr><td class="mono">${g}</td><td>${esc(w)}</td>${arms.map(([, r]) => `<td class="num">${cell(r[g])}</td>`).join('')}</tr>`).join('')}
<tr><td></td><td><b>Total</b></td>${arms.map(([, r]) => `<td class="num">${cell(tot(r))}</td>`).join('')}</tr>
<tr><td></td><td>Live responses matching the declared status + schema (Ajv 2020, OpenAPI components)</td><td class="num" colspan="3"><span class="ok">477/477</span> <span class="dim">· getTurn 200/400/404 · listTurns 200/400/404 · negative controls rejected 3/3</span></td></tr>
</table>
<div class="note">Keyset walk: every limit returns each of the 25 Turns exactly once, newest first, <span class="k">has_more</span> true with a cursor on every page but the last, <span class="k">next_cursor null</span> on the last.
Three Turns created after page 1 do not enter the walk; a fresh first page starts with them. Ties in the same ms page in <span class="k">utf8mb4_bin</span> order: turn_tie2, turn_tie, turn_tiE, turn_Tie, turn_TIE.</div>
</div>`;
}

// ---------- 03: mutants ----------
{
  const m = J('mutants.json');
  const v = (x) => (x === 'killed' ? '<span class="pill p-ok">killed</span>' : x === 'survived' ? '<span class="pill p-warn">survived</span>' : x ? `<span class="pill p-dim">${esc(x)}</span>` : '<span class="dim">–</span>');
  const rows = m.map((r) => {
    const eq = r.id === 'M18';
    const verdict = eq ? '<span class="pill p-dim">equivalent</span>' : v(r.verdict);
    const by = eq ? 'no input can tell the decoders apart (below)' : r.unit === 'killed' ? r.unitFailed.map((t) => t.replace('ManagedTurnQueryTest.', 'TurnQuery.').replace('ManagedAgentApiContractTest.', 'Contract.')).join(', ') : 'ManagedAgentMySqlIT.pagesTurnsNewestFirstOnMySql';
    return `<tr><td class="mono">${r.id}</td><td>${esc(r.what)}</td><td>${v(r.unit)}</td><td>${v(r.it_mariadb)}</td><td>${v(r.it_mysql)}</td><td>${verdict}</td><td class="mono" style="font-size:11.5px">${esc(by)}</td></tr>`;
  }).join('');
  cards['03-mutants'] = `<div class="card">
<h1>24 independent mutants of the PR's production code: 23 killed, 1 equivalent</h1>
<div class="sub">One exact text replacement per mutant (anchors must match once), run against the PR's own tests (<span class="mono">ManagedTurnQueryTest</span> + <span class="mono">ManagedAgentApiContractTest</span>, H2). Mutants that only a real collation can expose also run <span class="mono">ManagedAgentMySqlIT#pagesTurnsNewestFirstOnMySql</span> on MariaDB 10.11.18 and MySQL 8.4. Baseline green; tree restored after each.</div>
<table><tr><th style="width:48px">#</th><th>Mutation</th><th style="width:90px">H2 unit</th><th style="width:90px">IT MariaDB</th><th style="width:90px">IT MySQL</th><th style="width:96px">Verdict</th><th>Killed by</th></tr>${rows}</table>
<div class="note">M08 (drop the exact Turn ID filter, the sandbox report's S1) and M09 (drop the tenant predicate) survive H2 and are killed by the IT on <b>both</b> databases, which the sandbox run could not execute.
M18 is equivalent: every string the cursor grammar accepts base64-encodes without <span class="k">- _ + /</span> (274,625/274,625 aligned triples), and 0 of 1,414,649 random standard-base64 inputs containing <span class="k">+</span> or <span class="k">/</span> decode to a valid cursor.</div>
</div>`;
}

// ---------- 04: performance ----------
{
  const no = J('s2b-db-noindex.json');
  const ix = J('s2b-db-index.json');
  const http = { mysql: J('s2-perf-mysql.json'), mariadb: J('s2-perf-mariadb.json') };
  const f = (x) => x.toFixed(x < 10 ? 2 : 1);
  const rows = ['mysql', 'mariadb'].flatMap((e) => no[e].map((r, i) => `<tr><td>${e === 'mysql' ? 'MySQL 8.4' : 'MariaDB 10.11.18'}</td><td class="num">${r.n.toLocaleString('en')}</td><td class="num">${f(r.firstPageMs)}</td><td class="num">${f(r.lastPageMs)}</td><td class="num">${f(r.detailMs)}</td><td class="num">${f(http[e][i].first20)}</td><td class="num ok">${f(ix[e][i].firstPageMs)}</td><td class="num ok">${f(ix[e][i].lastPageMs)}</td></tr>`)).join('');
  const walk = ['mysql', 'mariadb'].map((e) => `${e === 'mysql' ? 'MySQL' : 'MariaDB'} ${http[e][1].walk.pages} pages → ${http[e][1].walk.seen.toLocaleString('en')} distinct of 10,000`).join(' · ');
  cards['04-long-session-cost'] = `<div class="card">
<h1>Cost of a page on long Sessions (the "no index covers the sort" trade-off, measured)</h1>
<div class="sub">N Turns bulk-inserted into one Session (every 7th tied on created_at). DB-side time from SHOW PROFILES, median of 5; HTTP is the median of 7 real requests to the PR jar on a host at load 55–85, so it is dominated by noise. Right columns add a candidate index <span class="mono">(tenant_id, session_id, created_at, turn_id)</span> to the same data.</div>
<table><tr><th>Database</th><th style="text-align:right">Turns in Session</th><th style="text-align:right">first page ms</th><th style="text-align:right">last page ms</th><th style="text-align:right">detail ms</th><th style="text-align:right">HTTP first page ms</th><th style="text-align:right">+index first ms</th><th style="text-align:right">+index last ms</th></tr>${rows}</table>
<pre style="margin-top:12px;border:1px solid #30363d;border-radius:8px;background:#161b22">PR as written (PK is tenant_id, session_id, turn_id):
  ${esc(http.mysql[2].plan[0])}
With the candidate index:
  1 | SIMPLE | managed_agent_turn | NULL | ref | PRIMARY,rig_turn_page_idx | rig_turn_page_idx | 772 | const,const | 53440 | 100.00 | Backward index scan
Full walk at limit 100 over 10,000 Turns (1,428 ties): ${esc(walk)}</pre>
<div class="note w">Each page sorts the whole Session (filesort), so a page costs O(Turns in the Session) and a full walk O(n²/limit): about 1.3 ms at 1k, 7–9 ms at 10k, 74–87 ms at 100k Turns.
The candidate index keeps every page under 1 ms at all three sizes. This matches the design note's §8 follow-up ("an index … if Sessions grow long"); it needs a Flyway migration, which is why the PR defers it.</div>
</div>`;
}

// ---------- 05: races, paths, IT ----------
{
  const race = { mysql: J('s4-race-mysql.json'), mariadb: J('s4-race-mariadb.json') };
  const sum = (e) => race[e].reduce((a, r) => ({ reads: a.reads + r.reads, ok: a.ok + r.ok, nf: a.nf + r.notFound, step: a.step + r.okStartedAfterFirst404, after: a.after + r.okAfterCompleted, other: a.other + r.otherResponses, inflight: a.inflight + r.okInFlightAcross404.length }), { reads: 0, ok: 0, nf: 0, step: 0, after: 0, other: 0, inflight: 0 });
  const rr = ['mysql', 'mariadb'].map((e) => {
    const s = sum(e);
    return `<tr><td>${e === 'mysql' ? 'MySQL 8.4' : 'MariaDB 10.11.18'}</td><td class="num">${race[e].length}</td><td class="num">${s.reads.toLocaleString('en')}</td><td class="num">${s.ok.toLocaleString('en')}</td><td class="num">${s.nf.toLocaleString('en')}</td><td class="num ok">${s.step}</td><td class="num ok">${s.after}</td><td class="num ok">${s.other}</td><td class="num dim">${s.inflight}</td></tr>`;
  }).join('');
  const p3 = J('s3-pr-mysql.json');
  const b3 = J('s3-base-mysql.json');
  const short = (x) => `${x.status} ${x.body.startsWith('{') ? (JSON.parse(x.body).code ?? (JSON.parse(x.body).data ? 'data=' + JSON.stringify(JSON.parse(x.body).data) : 'id=' + JSON.parse(x.body).id?.slice(0, 13) + '…')) : 'Tomcat HTML page'}`;
  const pr = p3.map((x, i) => `<tr><td class="mono">${esc(x.what)}</td><td class="mono">${esc(short(b3[i]))}</td><td class="mono">${esc(short(x))}</td></tr>`).join('');
  cards['05-races-paths-it'] = `<div class="card">
<h1>Reads racing a delete, documented path shapes, and the MySQL/MariaDB IT</h1>
<div class="sub">Race: 4 readers walk the list (limit 2, each page re-checks the Session) and read details in a tight loop while the Session is deleted through the durable lifecycle (Harness-attached Session with 6 completed Turns). A step back = a 200 on a request that <i>started</i> after another request had already received a 404.</div>
<table><tr><th>Database</th><th style="text-align:right">rounds</th><th style="text-align:right">racing reads</th><th style="text-align:right">200</th><th style="text-align:right">404 session_not_found</th><th style="text-align:right">step backs</th><th style="text-align:right">200 after completed</th><th style="text-align:right">other status</th><th style="text-align:right">in flight across</th></tr>${rr}</table>
<div class="grid g2" style="margin-top:16px">
<div class="panel"><div class="ph"><span>Design note §8 path shapes (real Tomcat + MySQL)</span><span class="pill p-dim">documented, not new</span></div>
<table><tr><th>Request</th><th style="width:170px">base</th><th style="width:210px">PR</th></tr>${pr}</table></div>
<div class="panel"><div class="ph"><span>ManagedAgentMySqlIT (-Pmysql-integration verify)</span><span class="pill p-ok">14/14 both</span></div>
<pre>MariaDB 10.11.18  14/14   MySQL 8.4  14/14   (host load ≈ 60)
  incl. pagesTurnsNewestFirstOnMySql (this PR)

First run at host load ≈ 128:
  MariaDB 13/14, MySQL 12/14 — only
  shortWriterLeaseKeepsSubsecondDatabasePrecision
  (588 ms vs [700, 1000]); not a Turn test.
Isolated rerun of that test + the D5 test:
  PR   MariaDB 5/5  MySQL 5/5
  base MariaDB 4/4  MySQL 4/4  → load flake, pre-existing

mvn clean test + checkstyle:  PR 176/176
trial merge main a765229c0a + PR: 178/178</pre></div>
</div>
<div class="note">Turn reads answer 200 while the Session is <span class="k">deleting</span> and 404 <span class="k">session_not_found</span> once the tombstone commits; no read that started after a 404 ever answered 200, none after the delete operation reported completed, and no 5xx. A trailing space on the Session ID reaching the same Session is the §8 behaviour and pre-exists on <span class="mono">GET /sessions/{id}</span> in base.</div>
</div>`;
}

fs.mkdirSync(path.join(FIG, 'png'), { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
for (const [name, html] of Object.entries(cards)) {
  const file = path.join(FIG, `${name}.html`);
  fs.writeFileSync(file, page(html));
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  const box = await p.locator('.card').boundingBox();
  const overflow = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('.card').screenshot({ path: path.join(FIG, 'png', `${name}.png`) });
  console.log(`${name}.png ${Math.round(box.width)}x${Math.round(box.height)} overflowing=${overflow}`);
  await p.close();
}
await browser.close();
