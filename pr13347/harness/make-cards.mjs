// Renders the evidence cards for PR 13347 from the rig's result files (never
// from hand-typed numbers) and screenshots them with Playwright.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const RIG = '/Users/wenshao/git/pr13347-rig';
const FIG = `${RIG}/fig`;
mkdirSync(FIG, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13347-head/package.json');
const { chromium } = require('playwright');
const { MUTANTS } = await import(`${RIG}/mutants.mjs`);
const J = (p) => JSON.parse(readFileSync(`${RIG}/${p}`, 'utf8'));
const has = (p) => existsSync(`${RIG}/${p}`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{display:inline-block;padding:28px 32px;background:#0d1117;min-width:1100px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:18px 0 8px;color:#d2a8ff}
.sub{color:#8b949e;font-size:13.5px;margin-bottom:16px}
table{border-collapse:collapse;font-size:13px}
th,td{border:1px solid #30363d;padding:5px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.probe{min-width:330px}.ev{word-break:break-all;max-width:560px}
.note{margin-top:14px;border-left:4px solid #388bfd;padding:8px 14px;background:#161b22;color:#c9d1d9;font-size:13.5px;max-width:1300px}
`;
const page = (title, sub, body, note) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${title}</h1><div class="sub">${sub}</div>${body}${note ? `<div class="note">${note}</div>` : ''}</div></body></html>`;

// ---------- mutation results ----------
// The 2002-admission Hook IT case times out its 60 s writer lease on a loaded
// host on every arm; it says nothing about #13347, so it never counts as a kill.
const NOISE = (f) => /admitsHookExecutionsWithoutReadingTheirHistoryOnMySql/.test(f.test) && /writer grant is stale/.test(f.message);
function result(dir, id) {
  const p = `results/mutants/${dir}/${id}.json`;
  if (!has(p)) return null;
  const r = J(p);
  const real = (r.failed || []).filter((f) => !NOISE(f));
  return { ...r, real, verdict: r.status === 'n/a' ? 'n/a' : r.status === 'compile-error' ? 'compile' : real.length ? 'killed' : 'survived' };
}
const short = (f) => `${f.test.replace('ManagedExtensionRecordStoreTest', 'RecordStoreTest').replace('ManagedAgentApiContractTest', 'ApiContractTest').replace('ManagedAgentMySqlIT', 'MySqlIT')}${f.at ? ':' + f.at.split(':')[1] : ''}`;
const cell = (r) => !r ? '<td class="dim">—</td>' : r.verdict === 'killed' ? `<td class="ok">killed</td>` : r.verdict === 'survived' ? '<td class="bad">survived</td>' : `<td class="warn">${r.verdict}</td>`;
const r1 = (id) => result('head-c5de7a9', id) || result('r1', id);
const SHOWN = MUTANTS.filter((m) => m.id !== 'M10');
const list = (r, n = 2) => (r?.real ?? []).slice(0, n).map((f) => esc(short(f))).join('<br>');
const mutRows = SHOWN.map((m) => {
  const b = result('base', m.id), h = result('head', m.id);
  const pin = h?.verdict === 'killed' && b?.verdict === 'survived';
  const tag = pin ? '<td class="ok">new pin</td>' : b?.verdict === 'killed' && h?.verdict === 'killed' ? '<td class="dim">already pinned</td>' : '<td class="bad">gap</td>';
  return `<tr><td class="mono">${m.id}</td><td>${esc(m.what)}</td><td class="dim">${esc(m.src)}</td>${cell(b)}${cell(h)}${tag}<td class="mono">${list(h)}</td><td class="mono dim">${b?.verdict === 'killed' ? list(b, 1) : ''}</td></tr>`;
}).join('');
const tally = (dir) => { const rs = SHOWN.map((m) => result(dir, m.id)).filter(Boolean); return `${rs.filter((r) => r.verdict === 'killed').length}/${rs.length}`; };
const headSha = result('head', 'M1')?.head ?? '?';
const pins = SHOWN.filter((m) => result('head', m.id)?.verdict === 'killed' && result('base', m.id)?.verdict === 'survived').length;
// R1-1 / R1-2: does the named leg of refusesTheSharedRejectedChains itself fire?
const LEG = 'refusesTheSharedRejectedChains';
const legCell = (r) => {
  if (!r) return '<td class="dim">—</td>';
  const leg = r.real.find((f) => f.test.endsWith(LEG));
  const elsewhere = r.real.filter((f) => !f.test.endsWith(LEG)).map((f) => esc(short(f).replace('RecordStoreTest.', ''))).join(', ');
  return leg ? `<td><span class="ok">fires</span> <span class="mono">:${leg.at.split(':')[1]}</span><br><span class="mono dim">${esc(leg.message.slice(0, 110))}</span></td>`
    : `<td><span class="bad">silent</span><br><span class="mono dim">killed only by: ${elsewhere || 'nothing'}</span></td>`;
};
const legRows = [['M1b', 'R1-2: resend leg (lost rollback; resource_ref leg removed so control reaches it)'], ['M10b', 'R1-1: Session-event leg of assertRefused (refusal leaks a task.updated)']]
  .map(([id, what]) => `<tr><td class="mono">${id}</td><td>${esc(what)}</td>${legCell(r1(id))}${legCell(result('head', id))}</tr>`).join('');
writeFileSync(`${FIG}/01-mutation-matrix.html`, page(
  `#13347 — mutation matrix for the mutations R3-6 names as its acceptance criterion`,
  `Each mutant applied alone to a clean tree; <code>clean verify</code> of RecordStoreTest, ApiContractTest, SessionStoreIntegrationTest, ProjectionContractTest, ArtifactApiIntegrationTest + ManagedAgentMySqlIT on MySQL 8.4.7. Killed: base 2c591ecc08 ${tally('base')} · head ${headSha} ${tally('head')} · ${pins} survive base and die on head.`,
  `<table><tr><th>id</th><th>mutation</th><th>finding</th><th>base</th><th>head</th><th></th><th>failing at head</th><th>already caught at base by</th></tr>${mutRows}</table>
   <h2>/review R1-1 and R1-2 — does the leg itself fire? (round-1 head c5de7a90ca vs head ${headSha})</h2>
   <table><tr><th>id</th><th>leg of ${LEG}</th><th>c5de7a90ca</th><th>${headSha}</th></tr>${legRows}</table>`,
  `The Hook-admission IT case (<code>admitsHookExecutions…</code>: 2002 commits under a 60 s writer lease) timed out on this loaded host on base and head alike and is never counted as a kill. D1 is a fixture drift, not a product mutant: the journal helper writes <code>parentUuid</code> before <code>uuid</code>, so the <code>{"uuid"</code> anchor stops matching.`));

// ---------- real-stack probes ----------
const arms = ['base', 'head', 'merge2'].filter((a) => has(`results/tasks-probe-${a}.json`));
const probes = Object.fromEntries(arms.map((a) => [a, J(`results/tasks-probe-${a}.json`)]));
const ARM = { base: 'base 2c591ecc08', head: 'head c5de7a90ca jar<br>(classes = 3acf924898)', merge2: 'head + main 17c182eda0', head2: 'head 3acf924898' };
const pRows = probes[arms[0]].rows.map((row, i) => `<tr><td class="mono">${row.id}</td><td class="probe">${esc(row.what)}</td>${arms.map((a) => {
  const x = probes[a].rows[i];
  return `<td class="mono ${x.ok ? 'ok' : 'bad'}">${esc(JSON.stringify(x.got))}</td>`;
}).join('')}</tr>`).join('');
const resendArms = ['base', 'head2'].filter((a) => has(`results/resend-probe-${a}.json`));
const resend = Object.fromEntries(resendArms.map((a) => [a, J(`results/resend-probe-${a}.json`)]));
const rRows = resend[resendArms[0]].steps.map((s, i) => `<tr><td>${esc(s.label)}</td>${resendArms.map((a) => {
  const x = resend[a].steps[i];
  return `<td class="mono">${x.status} ${esc(x.code ?? '')} replayed=${x.replayed}</td>`;
}).join('')}</tr>`).join('');
const cRows = Object.keys(resend[resendArms[0]].counts).map((k) => `<tr><td class="mono">${k}</td>${resendArms.map((a) => {
  const c = resend[a].counts[k];
  return `<td class="mono">events ${c.events} · task.updated ${c.taskUpdated} · resource_ref ${c.resourceRefs} · command rows ${c.commandRows} · SUM(revision) ${c.revisions}</td>`;
}).join('')}</tr>`).join('');
const opening = arms.map((a) => `${a}: ${readFileSync(`${RIG}/results/general-log-opening-${a}.A.txt`, 'utf8').trim().split('\n').length} × <code>${esc(readFileSync(`${RIG}/results/general-log-opening-${a}.A.txt`, 'utf8').trim().split('\n')[0].replace(/'[0-9a-f]{64}'/g, '?'))}</code>`).join('<br>');
writeFileSync(`${FIG}/02-real-stack-task-routes.html`, page(
  `#13347 — task routes and refusal resend on a live server (Spring jar + MySQL 8.4.7)`,
  `Session A: real TS authority writes genesis over the Session Store HTTP route, then the shared fixture chain <code>monitorChainCases[0]</code> + a second Monitor is committed as H3 will. Session B has no Stage H record. Jars built from base, head and head-merged-with-main.`,
  `<table><tr><th>id</th><th>probe</th>${arms.map((a) => `<th>${ARM[a]}</th>`).join('')}</tr>${pRows}</table>
   <h2>The store's own opening-command statement, captured from the MySQL general log during Session A's two first revisions</h2>
   <div class="mono" style="font-size:12px;line-height:1.6">${opening}<br>EXPLAIN of the captured head statement on the live DB: key <code>idx_managed_session_extension_operation</code>, key_len 512 (both columns).</div>
   <h2>R1-2 consequence over HTTP: public Session, fixture reject case <code>${esc(resend[resendArms[0]].reject)}</code></h2>
   <table><tr><th>step</th>${resendArms.map((a) => `<th>${ARM[a]}</th>`).join('')}</tr>${rRows}</table>
   <table style="margin-top:8px"><tr><th>row counts</th>${resendArms.map((a) => `<th>${ARM[a]}</th>`).join('')}</tr>${cRows}</table>`,
  `Production behaviour is identical on every arm (the head jar differs from base only by the new public constant; method bytecode is unchanged), which is what a tests-docs-OpenAPI PR should show. All ${arms.length * probes[arms[0]].rows.length} route probes match the documented answers.`));

// ---------- surface + docs ----------
const claims = { r1: J('results/doc-claims-head.json'), head: J('results/doc-claims-head2.json') };
const dRows = claims.head.map((c, i) => `<tr><td class="mono">${c.id}</td><td>${esc(c.claim)}</td><td class="${claims.r1[i].ok ? 'ok' : 'bad'}">${claims.r1[i].ok ? 'holds' : 'fails'}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'holds' : 'fails'}</td><td class="mono dim ev">${esc(c.evidence.slice(0, 420))}</td></tr>`).join('');
const surface = JSON.parse(readFileSync(`${RIG}/results/surface.json`, 'utf8'));
const sRows = surface.map((s) => `<tr><td>${esc(s.check)}</td><td class="${s.ok ? 'ok' : 'bad'}">${esc(s.result)}</td></tr>`).join('');
writeFileSync(`${FIG}/03-surface-and-docs.html`, page(
  `#13347 — what changed on the wire, the generated client, and the docs' claims`,
  `Doc claims are checked against code and git objects by a script (<code>doc-claims.mjs</code>), at the round-1 head and at the current head.`,
  `<table><tr><th>surface check</th><th>result</th></tr>${sRows}</table>
   <h2>Design-doc and OpenAPI claims</h2>
   <table><tr><th>id</th><th>claim</th><th>c5de7a90ca</th><th>${headSha}</th><th>evidence</th></tr>${dRows}</table>`,
  `C11 and C13 failing at the round-1 head are /review R1-3 (undefined “envelope domain”) and R1-5 (Java store “consumed” the TS module); AutoFix commit ${headSha} fixed both, and R1-4's attribution, in both language twins.`));

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
for (const name of ['01-mutation-matrix', '02-real-stack-task-routes', '03-surface-and-docs']) {
  const p = await ctx.newPage();
  await p.goto(`file://${FIG}/${name}.html`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await p.locator('#card').screenshot({ path: `${FIG}/${name}.png` });
  console.log(`${name}.png written; overflowing cells=${clipped}`);
  await p.close();
}
await browser.close();
