// Round-2 evidence cards for head 9f0da8a14b, built from r2/ run logs.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RIG = '/Users/wenshao/git/pr13263-rig';
const RUNS = path.join(RIG, 'r2/runs');
const R1RUNS = path.join(RIG, 'runs');
const OUT = path.join(RIG, 'fig-r2');
mkdirSync(OUT, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13263-head/package.json');
const { chromium } = require('playwright');

const logsIn = (dir) => readdirSync(dir).filter((f) => f.endsWith('.log')).sort();
const r2logs = logsIn(RUNS);
const log = (label, dir = RUNS, list = r2logs) => {
  const f = list.find((x) => x.replace(/^\d+-/, '').replace(/\.log$/, '') === label);
  if (!f) throw new Error(`missing log ${label}`);
  return readFileSync(path.join(dir, f), 'utf8');
};
const firstError = (text) => {
  const m = text.match(/^Error: (.*)$/m);
  if (!m) throw new Error('no Error line');
  return m[1];
};
const summary = (text) => {
  const m = text.match(/^\{\n[\s\S]*?\n\}$/m);
  if (!m) throw new Error('no summary');
  return JSON.parse(m[0]);
};
const results = readFileSync(path.join(RIG, 'r2/results.tsv'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split('\t'))
  .filter((c, i, all) => all.findIndex((d) => d[1] === c[1]) === i)
  .map(([, id, variant, args, exit]) => ({ id, label: id.replace(/^\d+-/, ''), variant, args, pass: exit === 'exit=0' }));
const tally = (pred) => {
  const rows = results.filter(pred);
  return [rows.filter((r) => r.pass).length, rows.length];
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- data ----------
const M = '--model qwen3.8-max';
const headReal = tally((r) => ['head', 'obs'].includes(r.variant) && r.args === M && !r.label.includes('authorenv') && !r.label.startsWith('leakjar'));
const authorEnv = tally((r) => r.label === 'head-authorenv');
const sfHead = tally((r) => r.variant === 'head' && r.args === '--session-failover');
const baseReal = firstError(log('base-realmodel'));
const d20 = summary(log('head-delay20s'));
const d45 = log('head-delay45s');
const head01 = summary(log('head-r01'));
const leakHead = [1, 2].map((i) => firstError(log(`leakjar-head-r${i}`)));
const leakR1 = [1, 2].map((i) => summary(log(`leakjar-r1runner-r${i}`)));
const obsRuns = results.filter((r) => r.variant === 'obs');
const probes = JSON.parse(log('obs-r01').match(/^OBS (.*)$/m)[1]).probes;
const a2 = log('a2obs-r2');
const a2Err = a2.slice(a2.indexOf('Error: Tool execution audit failed'), a2.indexOf('\n    at ', a2.indexOf('Error: Tool execution audit failed'))).split('\n');
const a2Calls = a2.slice(a2.indexOf('OBS-FAIL toolCalls:\n') + 20).split('\n\n')[0].split('\n').filter(Boolean).map((l) => { const c = JSON.parse(l)[0]; return `${c.name}(${c.args.file_path})`; });
const pins = JSON.parse(readFileSync(path.join(RIG, 'r2/pin-mutants.json'), 'utf8'));
const p8sf = log('p8-session-failover');
const p8Err = firstError(p8sf);
const p8Cause = (p8sf.match(/IllegalStateException: (.*)$/m) ?? [])[1];
const sfRows = [
  ...logsIn(R1RUNS).filter((f) => f.includes('session-failover')).map((f) => ['R1 ' + (f.includes('base') ? 'base' : 'head 8e1375'), readFileSync(path.join(R1RUNS, f), 'utf8')]),
  ...r2logs.filter((f) => /session-failover|sfobs/.test(f) && !f.includes('p8')).map((f) => ['R2 ' + (f.includes('base') ? 'base' : f.includes('sfobs-r1') ? 'head 8e1375' : 'head 9f0da8'), readFileSync(path.join(RUNS, f), 'utf8')]),
].map(([arm, t]) => ({ arm, s: summary(t) }));
const sfOps = Object.fromEntries(['base', 'r1', 'head'].map((v) => {
  const o = JSON.parse(log(`sfobs-${v}`).match(/^SFOBS (.*)$/m)[1]);
  return [v, { ops: o.ops.split('\n').map((l) => l.split('\t')[1]), session: o.session }];
}));
const opSet = (ops) => [...new Set(ops)].sort().join(',');
const sameOpSet = opSet(sfOps.base.ops) === opSet(sfOps.r1.ops) && opSet(sfOps.r1.ops) === opSet(sfOps.head.ops);
for (const [k, v] of Object.entries({ p8Cause, sameOpSet })) if (!v) throw new Error(`extraction: ${k}`);

// ---------- html ----------
const css = readFileSync(path.join(RIG, 'make-cards.mjs'), 'utf8').match(/const css = `([\s\S]*?)`;/)[1];
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const pre = (lines) => `<pre>${lines.map((l) => esc(l)).join('\n')}</pre>`;
const env = 'Round 2 · head 9f0da8a14b (no product-code delta since 8e1375c380; same dist/cli.js and jars) · macOS arm64 · MySQL 8.4.7 · JDK 21 · Node 22 · qwen3.8-max';
const cls = (ok) => (ok ? 'ok' : 'no');

const cards = {};
cards['05-r2-head'] = page(
  'Round 2: the real-model mode at the current head',
  env,
  `<div class="grid">
  <div class="box good"><h2>npm run test:e2e:managed-agent-server -- --model qwen3.8-max</h2>${pre(JSON.stringify(head01, null, 2).split('\n'))}</div>
  <div class="box neu"><h2>Run matrix at 9f0da8a14b</h2><table>
  <tr><th>arm</th><th>result</th></tr>
  <tr><td>real-model, qwen3.8-max (documented command + diagnostic copy)</td><td class="${cls(headReal[0] === headReal[1])}">${headReal[0]}/${headReal[1]}</td></tr>
  <tr><td>author's toolchain (Node 24 / JDK 26 / MySQL 26.7)</td><td class="${cls(authorEnv[0] === authorEnv[1])}">${authorEnv[0]}/${authorEnv[1]}</td></tr>
  <tr><td><code>--runtime-delay-ms 20000</code></td><td class="ok">pass · model ${d20.firstModelEventMs} ms &lt; Runtime ${d20.runtimeReadyMs} ms</td></tr>
  <tr><td><code>--runtime-delay-ms 45000</code> (still in README)</td><td class="no">fail · ${esc((d45.match(/HTTP 503 \((\w+)\)/) ?? [])[1])}</td></tr>
  <tr><td><code>--session-failover</code></td><td class="ok">${sfHead[0]}/${sfHead[1]}</td></tr>
  <tr><td>merge-base runner (control)</td><td class="no">fail · <code>turn.failed</code></td></tr>
  <tr><td><code>managed-agent-server-e2e.test.js</code></td><td class="ok">7/7</td></tr>
  <tr><td>CI Hosted MySQL job on 9f0da8a14b</td><td class="ok">session / in-flight / continuation failover steps all success</td></tr>
  </table></div></div>`,
);

cards['06-r2-cross-tenant'] = page(
  'Cross-tenant probe now discriminates: tenant-scoping leak A/B',
  'Mutant server jar: requireVisibleSession looks the Session up under its owning tenant when the request says other-tenant (a simulated tenant-filter leak). Good jar restored and hash-checked after every mutant run.',
  `<div class="grid">
  <div class="box bad"><h2>runner @ 8e1375c380 (probe: tenant header only) — leak missed 2/2</h2>${pre([
    ...leakR1.map((s, i) => `run ${i + 1}: exit 0, "crossTenantStatus": ${s.crossTenantStatus}`),
    '',
    'requireReadGrant(session, actor=null) -> 404 session_not_found',
    'masks the leaked tenant lookup',
  ])}</div>
  <div class="box good"><h2>runner @ 9f0da8a14b (probe: tenant + actor) — leak caught 2/2</h2>${pre([
    ...leakHead.map((e, i) => `run ${i + 1}: Error: ${e}`),
    '',
    'requireReadGrant checks canRead(session.tenantId(), actor, ws)',
    "-> the actor's grant passes, so only the tenant filter can 404",
  ])}</div>
  <div class="box neu full"><h2>Same probes on the good jar (${obsRuns.length}/${obsRuns.length} diagnostic runs identical)</h2><table>
  <tr><th>GET /v1/agents/sessions/{id}</th><th>status</th></tr>
  ${probes.map((p) => `<tr><td><code>${esc(p.label)}</code></td><td class="${p.status === 200 ? 'ok' : 'no'}">${p.status} ${esc((p.body.match(/"code":"(\w+)"/) ?? ['', ''])[1])}</td></tr>`).join('')}
  </table></div></div>`,
);

cards['07-r2-pins-failover-audit'] = page(
  'Pin test mutants, session-failover shape, new audit message',
  'Pin mutants run in a mirror directory (copied scripts/, symlinked node_modules) with only the runner file swapped.',
  `<div class="grid">
  <div class="box neu"><h2>"pins the G0 workspace admission" — ${pins.filter((p) => p.outcome === 'FAIL').length}/${pins.length - 1} mutants killed</h2><table>
  <tr><th>runner variant</th><th>pin test</th></tr>
  ${pins.map((p) => `<tr><td>${esc(p.name)}</td><td class="${p.name.startsWith('P0') ? (p.outcome === 'PASS' ? 'ok' : 'no') : p.outcome === 'FAIL' ? 'ok' : 'am'}">${p.name.startsWith('P0') ? (p.outcome === 'PASS' ? 'pass (control)' : p.outcome) : p.outcome === 'FAIL' ? 'killed' : 'SURVIVES'}</td></tr>`).join('')}
  </table><div style="color:#8b949e;font-size:13px;margin-top:8px">P8 at runtime: <code>--session-failover</code> → <code>${esc(p8Err)}</code> (${esc(p8Cause.slice(0, 60))}…), so the new CI step catches what the pin misses.</div></div>
  <div class="box neu"><h2>--session-failover: same shape, run-to-run count noise</h2><table>
  <tr><th>arm</th><th>journal rev</th><th>committed seq</th><th>gen / terminals / ctx</th></tr>
  ${sfRows.map(({ arm, s }) => `<tr><td>${esc(arm)}</td><td>${esc(s.journalRevision)}</td><td>${esc(s.committedSequence)}</td><td>${esc(s.writerGeneration)} / ${s.terminalTurns} / ${s.restoredFirstTurnContext}</td></tr>`).join('')}
  </table><div style="color:#8b949e;font-size:13px;margin-top:8px">Journal operation sets identical on base, 8e1375c380 and 9f0da8a14b; Session unbound (workspace_id ${esc(sfOps.head.session)}) on all three. Counts move ±1–2 with <code>renewActivation</code> timing (1 s writer lease) within each arm.</div></div>
  <div class="box warn full"><h2>New audit failure message (prompt invites a listing; model calls ${esc(a2Calls.join(' + '))})</h2>${pre([
    ...a2Err.map((l) => (l.startsWith('Error') ? l : '  ' + l)),
    '',
    'two tool_call_ids -> "another tool call", but not which tool, and not that one row is execution_status=error',
  ])}</div></div>`,
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1240, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  writeFileSync(path.join(OUT, `${name}.html`), html);
  await pg.setContent(html);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.split('\n').sort((a, b) => b.length - a.length)[0]));
  await pg.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}.png clipped=${JSON.stringify(clipped)}`);
}
await browser.close();
console.log(JSON.stringify({ headReal, authorEnv, sfHead, obs: obsRuns.length, pinsKilled: pins.filter((p) => p.outcome === 'FAIL').length }));
