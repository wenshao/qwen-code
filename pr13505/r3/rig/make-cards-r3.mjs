// VERIFICATION RIG ONLY (PR #13505 round 3): evidence cards for head 3261e4d4, rendered from result files.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13505-rig';
const FIG = `${RIG}/fig/r3`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13505-h3/package.json');
const { chromium } = require('playwright');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const tsv = (f) => existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:26px 30px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:18px 0 8px;color:#c9d1d9}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:14px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1300px}
.cols{display:flex;gap:24px;align-items:flex-start}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;
const vd = (f) => { const s = readFileSync(`${RIG}/diff/${f}`, 'utf8').split('VERDICT-DIFFS ')[1].split('\n')[0]; const m = s.match(/'accept': (\d+)/); return m ? Number(m[1]) : 0; };
const key = (r) => JSON.stringify([r.scenario, r.case ?? r.domain, r.http, r.reopen?.status ?? r.reopen]);
const same = (a, b) => a.length === b.length && a.every((r, i) => key(r) === key(b[i]));

const card1 = () => {
  const h2 = jsonl(`${RIG}/results/probe-h2.jsonl`);
  const arms = ['h3', 'm3'];
  const probe = Object.fromEntries(arms.map((a) => [a, jsonl(`${RIG}/results/probe-${a}.jsonl`)]));
  const settle = Object.fromEntries(arms.map((a) => [a, jsonl(`${RIG}/results/probe-${a}-settle.jsonl`)]));
  const idOk = (rows) => rows.filter((r) => r.scenario === 'id-parity' && r.case !== 'control' && r.http === 409 && r.reopen === 'OPENED').length;
  const xrOk = (rows) => rows.filter((r) => r.scenario === 'java-cross-record' && (r.case.includes('control') ? r.http === 200 : r.http === 409) && r.reopen === 'OPENED').length;
  const scOk = (rows) => rows.filter((r) => (r.case === 'control' ? r.http === 200 : r.http === 409) && r.reopen === 'OPENED').length;
  const f3 = tsv(`${RIG}/results/f3-probe.tsv`).find((r) => r[0].startsWith('h3'));
  const jt = Object.fromEntries(tsv(`${RIG}/results/jtest.tsv`).map((r) => [r[1], r]));
  const ts = tsv(`${RIG}/results/ts.tsv`);
  const foc = (a) => ts.filter((r) => r[1] === 'focused-6files' && r[2] === a).pop()?.[5]?.trim() ?? '';
  const rows = [
    ['TS ↔ Java differential, 573,903 rows', `${vd('compare-h3.txt')} disagreements`, `${vd('compare-m3.txt')} disagreements`, (a) => vd(`compare-${a}.txt`) === 0],
    ['7 malformed child_agent identities → 409, Session opens', `${idOk(probe.h3)}/7`, `${idOk(probe.m3)}/7`, (a) => idOk(probe[a]) === 7],
    ['acceptance cross-record checks (10 × 409 + 2 controls)', `${xrOk(probe.h3)}/12`, `${xrOk(probe.m3)}/12`, (a) => xrOk(probe[a]) === 12],
    ['settling revision citing unheld result / receipt (+ control)', `${scOk(settle.h3)}/3`, `${scOk(settle.m3)}/3`, (a) => scOk(settle[a]) === 3],
    ['all 23 probe rows vs round 2 (h2)', same(probe.h3, h2) ? 'identical' : 'DIFFERENT', same(probe.m3, h2) ? 'identical' : 'DIFFERENT', (a) => same(probe[a], h2)],
    ['F3: Background Shell capture vs a child_agent record', f3 ? f3[1].slice(0, 60) : '–', '–', () => !!f3 && f3[1].startsWith('REFUSED')],
    ['TS focused suites (6 files incl. local-shell-stream)', foc('h3'), foc('m3'), (a) => /^Tests \d+ passed/.test(foc(a))],
    ['PR ManagedExtensionRecordStoreTest on native MySQL 8.4.7', (jt['store-on-mysql-h3']?.[3] ?? '').replace('[INFO] ', ''), '–', () => jt['store-on-mysql-h3']?.[2] === 'exit=0'],
  ];
  const t = rows.map(([l, a, b, ok]) => `<tr><td>${esc(l)}</td><td class="mono ${ok('h3') ? 'ok' : 'bad'}">${esc(a)}</td><td class="mono ${b === '–' ? 'dim' : ok('m3') ? 'ok' : 'bad'}">${esc(b)}</td></tr>`).join('');
  const mut = tsv(`${RIG}/results/mutants-r3.tsv`);
  const base = mut.filter((r) => r[0] === 'BASELINE').map((r) => `${r[1]} ${r[3]}`).join(' · ');
  const ms = mut.filter((r) => r[0] !== 'BASELINE');
  const mt = ms.map((r) => `<tr><td class="mono">${esc(r[0])}</td><td class="${r[1] === 'KILLED' ? 'ok' : (r[0].startsWith('J9') ? 'warn' : 'bad')}">${r[1]}${r[0].startsWith('J9') ? ' (pre-existing)' : ''}</td></tr>`).join('');
  return page('Round 3 (3261e4d4): F3 and F4 landed as verified; the merge with main is clean',
    'h3 = PR head 3261e4d4 (round-2 head + automatic merge of main ac81c07d, tree identical to git\'s own merge + the F3 commit) · m3 = trial merge of h3 into current main ac497aee · same rig: Spring Session Store on native MySQL 8.4.7, real TS authority over HTTP, raw-HTTP second writer',
    `<div class="cols"><div><table><tr><th>check</th><th>h3 3261e4d4</th><th>m3 trial merge</th></tr>${t}</table></div>
     <div><h2 style="margin-top:0">Mutants on h3 (PR suites)</h2><table><tr><th>id</th><th>result</th></tr>${mt}</table>
     <div class="dim" style="margin-top:6px;font-size:12.5px">baselines: ${esc(base)}</div></div></div>`,
    'The F3 fix and all four candidate tests are byte-identical to what was verified in round 2. The only difference is one comment word in the F3 test. Every acceptance rule, the F1 identity checks, the settling-revision closure and the F3 parser gate now fail their PR suites when removed. J9 is the pre-existing non-task-row expression noted in round 1.');
};

const card2 = () => {
  const rows = [
    ['Test (ubuntu-latest, Node 22.x)', 'cli acp-integration/session/Session.test.ts: 2 failed (tool_call bridge refusal text)', 'h3 local: same 2 fail', 'pure main ac81c07d local: same 2 fail', 'tracked in #13522'],
    ['Runtime Broker and Managed Agent MariaDB / Java 21', 'job exceeded the 15-minute ceiling and was cancelled', 'PR run 37500049676: cancelled at 15 min', 'main ac81c07d run 37496091771: cancelled at 15 min too', ''],
    ['(the same lane\'s unit suite)', 'ManagedSessionStoreIntegrationTest.holdsRestorePagesInsideThePerPageByteBudget → 409 "Record line 1 is not an event line…"', 'h3 / m3 local: same error', 'pure main ac81c07d local: same error', '#13348 added the test (15:51); #13355 added the line check (16:29)'],
  ];
  const t = rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 ? '' : 'mono'} ${i >= 2 && c ? 'warn' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  const it = tsv(`${RIG}/results/it.tsv`).filter((r) => r[1] === 'm3');
  const ts = tsv(`${RIG}/results/ts.tsv`).filter((r) => r[2] === 'm3' && r[1] !== 'focused-6files');
  const suite = (() => { const s = readFileSync(`${RIG}/logs/suite-m3.log`, 'utf8'); const m = [...s.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].sort((a, b) => Number(b[1]) - Number(a[1]))[0]; return `run ${m[1]} · failed ${m[2]} · errors ${m[3]} · skipped ${m[4]}`; })();
  const extra = [
    ['m3 Java surefire', suite, 'the 1 error is the main-red store test above'],
    ...it.map((r) => ['m3 Java MySQL ITs (native MySQL 8.4.7)', r[4].replace('[INFO] ', ''), r[3]]),
    ...ts.map((r) => [`m3 TS ${r[1]}`, r[5].trim().replace(' | ', ' · '), r[1] === 'managed-runtime' ? 'hook-scale 15 s timeout (round 1/2 family; also on base)' : '']),
  ].map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'mono' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return page('Round 3: the two red CI legs on 3261e4d4 come from main, not from this PR',
    'Each red leg was pulled from the job log and reproduced locally on h3 and on a pure-main worktree at ac81c07d (the main commit this head merged). The PR changes none of these files.',
    `<table><tr><th>CI leg</th><th>what fails</th><th>PR head</th><th>main</th><th>note</th></tr>${t}</table>
     <h2>Local suites on m3 (h3 + main ac497aee)</h2><table><tr><th>run</th><th>result</th><th>note</th></tr>${extra}</table>`,
    'Both failures reproduce identically on main without this PR. The store test is a merge-order collision on main: the test #13348 pinned at 15:51 commits a transaction that the stricter event-line check from #13355 (merged 16:29) now refuses. Main\'s own MariaDB lane at ac81c07d also hit the 15-minute ceiling. Nothing here blocks this PR; the same reds will clear once main is fixed.');
};


const card3 = () => {
  const crit = tsv(`${RIG}/results/crit-r3.tsv`);
  const r11 = tsv(`${RIG}/results/r1-1-probe.tsv`);
  const cls = (v) => /refuse|succ=False/.test(v) ? 'ok' : 'bad';
  const want = (id) => id.startsWith('R1-4') ? !/worktrees|'\.'|CON|NUL/.test(id) : !/repair/.test(id);
  const rows = crit.map(([id, h, c]) => `<tr><td class="mono">${esc(id)}</td><td class="mono">${esc(h)}</td><td class="mono">${esc(c)}</td></tr>`).join('');
  const r1 = r11.map(([arm, code, body]) => `<tr><td class="mono">${esc(arm)}</td><td class="mono ${code === '200' ? 'ok' : 'bad'}">${esc(code)}</td><td class="mono">${esc(body.slice(0, 90))}</td></tr>`).join('');
  const g = [
    ['R1-4: refuse /^[A-Za-z]:/ in isRelativeDirectory (TS) + requireWorkingDirectory (Java)', 'TS 340/340, 0 fixture or test changes', 'ok'],
    ['R1-2: childSessionId needs run.runtime — placed first (as suggested)', '8 invalid fixtures now report a different clause', 'warn'],
    ['R1-2: same guard placed last (TS clause order, like F1)', 'TS 340/340', 'ok'],
    ['R1-3: definition required once dispatched', '13 tests fail: the authority suite\'s runBlock() dispatches with definition: null', 'warn'],
  ].map(([a, b, c]) => `<tr><td>${esc(a)}</td><td class="mono ${c}">${esc(b)}</td></tr>`).join('');
  return page('Round 3: the /review Criticals on 0a1b1d2e (R1-1…R1-4) reproduce on 3261e4d4',
    'Posted 17:43 as a historical-head review (CHANGES_REQUESTED) while round 3 ran. Each finding probed on the current head through the real validators (h3 TS dist + h3 jar) and, for R1-1, through the Hosted Harness /session/:id/load route; candidate = R1-1 + R1-2 (late) + R1-4 on top of 3261e4d4',
    `<div class="cols"><div><h2>R1-2 / R1-3 / R1-4 — verdict (TS / Java)</h2><table><tr><th>body or transition</th><th>h3 3261e4d4</th><th>candidate</th></tr>${rows}</table></div>
     <div><h2>R1-1 — restore of a Session whose journal also holds a child_agent run</h2><table><tr><th>code</th><th>/load</th><th>body</th></tr>${r1}</table>
     <h2>Guard impact on the PR's own suites (TS)</h2><table><tr><th>guard</th><th>result</th></tr>${g}</table>
     <h2>Candidate (R1-1 + R1-2 late + R1-4, TS + Java + 3 fixtures + 1 restore test)</h2>
     <table><tr><td>Java contracts + store</td><td class="mono ok">36/36 · checkstyle clean</td></tr>
     <tr><td>TS focused 6 files · cli 3 files</td><td class="mono ok">381/381 · 232/232 · tsc core+cli clean · eslint/prettier clean</td></tr>
     <tr><td>Differential 573,903 rows</td><td class="mono ok">0 disagreements</td></tr>
     <tr><td>Witness: new fixtures without the fix</td><td class="mono ok">Java fails (agent-attached-without-runtime) · TS 3 fail</td></tr>
     <tr><td>Witness: restore test without the R1-1 fix</td><td class="mono ok">expected 409 to be 200 (fails) · with fix 5/5</td></tr></table></div></div>`,
    'All four reproduce on the current head, identically in both languages. R1-1 is the mirror image of F3: the restore walk enumerates every child_run revision and now refuses the whole Session on a child_agent one. My round-2 report listed the cli callers as already correct; this walk is not. R1-2 and R1-4 have drop-in guards. R1-3 needs the authority suite\'s builders to pin a definition before dispatch, which is the author\'s call. Two smaller follow-ups remain open: dispatch_started with no runtime (only not_started_proven may lack one), and Windows device names (CON, NUL.txt).');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1700, height: 1200 } });
const pg = await ctx.newPage();
for (const [name, fn] of [['r3-01-verification', card1], ['r3-02-ci-attribution', card2], ['r3-03-review-criticals', card3]]) {
  const file = `${FIG}/${name}.html`;
  writeFileSync(file, fn());
  await pg.goto(`file://${file}`);
  await pg.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png`);
}
await browser.close();
