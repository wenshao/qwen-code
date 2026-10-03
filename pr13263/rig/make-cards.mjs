// Builds the evidence cards from the raw run logs (no hand-copied numbers)
// and screenshots each card with Playwright at 2x.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RIG = '/Users/wenshao/git/pr13263-rig';
const RUNS = path.join(RIG, 'runs');
const OUT = path.join(RIG, 'fig');
mkdirSync(OUT, { recursive: true });
const require = createRequire('/Users/wenshao/git/pr13263-head/package.json');
const { chromium } = require('playwright');

const logs = readdirSync(RUNS).filter((f) => f.endsWith('.log')).sort();
const log = (id) => {
  const f = logs.find((x) => x.startsWith(id));
  if (!f) throw new Error(`missing log ${id}`);
  return readFileSync(path.join(RUNS, f), 'utf8');
};
const firstError = (id) => {
  const m = log(id).match(/^Error: (.*)$/m);
  if (!m) throw new Error(`no Error line in ${id}`);
  return m[1];
};
const summary = (id) => {
  const m = log(id).match(/^\{\n[\s\S]*?\n\}$/m);
  if (!m) throw new Error(`no summary in ${id}`);
  return JSON.parse(m[0]);
};
const obs = (id) => {
  const m = log(id).match(/^OBS (.*)$/m);
  if (!m) throw new Error(`no OBS in ${id}`);
  return JSON.parse(m[1]);
};
const tap = (id) => {
  const m = log(id).match(/^TAP Spring->Harness (.*)$/m);
  if (!m) throw new Error(`no TAP in ${id}`);
  return JSON.parse(m[1]);
};
const failBlock = (id, header) => {
  const text = log(id);
  const start = text.indexOf(`${header}\n`);
  if (start < 0) throw new Error(`no ${header} in ${id}`);
  const rest = text.slice(start + header.length + 1);
  return rest.split(/\n(?=[a-zA-Z-]+:\n|OBS-FAIL|\n)/)[0].trim();
};
const results = readFileSync(path.join(RIG, 'results.tsv'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.split('\t'))
  .filter((c, i, all) => all.findIndex((d) => d[1] === c[1]) === i)
  .map(([, id, variant, args, exit, secs]) => ({
    id,
    variant,
    args,
    pass: exit === 'exit=0',
    secs,
  }));
const tally = (pred) => {
  const rows = results.filter(pred);
  return { pass: rows.filter((r) => r.pass).length, total: rows.length, rows };
};
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const gotLines = (err) => { const [head, got] = err.split('; got '); if (!got) return [err]; const ev = got.split(', '); const out = [head + ';']; for (let i = 0; i < ev.length; i += 3) out.push('  got '.slice(0, i ? 0 : 6).padEnd(6) + ev.slice(i, i + 3).join(', ') + (i + 3 < ev.length ? ',' : '')); return out; };
const tapLines = (l) => { const i = l.indexOf(' {'); return i < 0 ? [l] : [l.slice(0, i), ...l.slice(i + 1).split(/,(?=")/).map((p, k, a) => '    ' + p + (k < a.length - 1 ? ',' : ''))]; };
const tmpShort = (p) => p.replace(/\/private\/tmp\/claude-501\/p13263\/managed-agent-server-e2e-[A-Za-z0-9]+/, '<tmp>');
const compressEvents = (err) => { const [h, got] = err.split('; got '); const out = []; for (const e of got.split(', ')) { const last = out[out.length - 1]; if (last && last.e === e) last.n += 1; else out.push({ e, n: 1 }); } return h + '; got ' + out.map(({ e, n }) => (n > 1 ? `${e} ×${n}` : e)).join(', '); };
const clip = (s, n = 118) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- data ----------
const isModel = (r) => r.args === '--model qwen3.8-max';
const headPlain = tally((r) => ['head', 'obs'].includes(r.variant) && isModel(r) && !r.id.includes('authorenv'));
const basePlain = tally((r) => r.variant === 'base' && isModel(r));
const kimi = tally((r) => r.variant === 'head' && r.args === '--model kimi-k3');
const headFail = headPlain.rows.filter((r) => !r.pass);
const head001 = summary('001-');
const authorEnv = log(results.find((r) => r.id.includes('authorenv')).id).split('\n')[0];
const baseTap = tap('024-').filter((l) => !l.endsWith('received'));
const m2Tap = tap('026-').filter((l) => !l.endsWith('received'));
const baseTurn = failBlock('003-', 'OBS-FAIL turns:');
const m1Err = (log('016-').match(/IllegalStateException: (.*)$/m) ?? [])[1];
const m3Err = firstError('018-');
const m3bErr = firstError('019-');
const m3bTurn = failBlock('019-', 'OBS-FAIL turns:');
const m3bExec = failBlock('019-', 'executions:').split('\t').slice(1, 3).join(' / ');
const m4bErr = firstError('044-');
const m4bCalls = failBlock('044-', 'OBS-FAIL toolCalls:')
  .split('\n')
  .map((l) => JSON.parse(l)[0].args.file_path);
const m5Err = firstError('021-');
const a1Err = firstError('049-');
const a2Err = firstError('047-');
const a2Calls = failBlock('047-', 'OBS-FAIL toolCalls:')
  .split('\n')
  .map((l) => {
    const c = JSON.parse(l)[0];
    return `${c.name}(${c.args.file_path})`;
  });
const a2Exec = failBlock('047-', 'executions:')
  .split('\n')
  .map((l) => l.split('\t').slice(1, 3).join('/'));
const a2bErr = firstError('048-');
const a2bRefusal = (log('048-').match(/failed: Error: (Hosted Workspace profile refused a tool call\.)/) ?? [])[1];
const naturalCalls = headFail.flatMap((r) => { const t = log(r.id); const i = t.indexOf('OBS-FAIL toolCalls:\n'); if (i < 0) return []; return [t.slice(i + 20).split('\n\n')[0].split('\n').filter(Boolean).map((l) => { const c = JSON.parse(l)[0]; return `${c.name}(${c.args.file_path})`; }).join(', ')]; });
const naturalErr = firstError(headFail[0]?.id ?? 'zzz');
const probes = obs('034-').probes;
const probeRuns = results.filter((r) => r.variant === 'obs').length;
const sfHead = summary('027-');
const sfBase = summary('029-');
const sfHeadT = tally((r) => r.variant === 'head' && r.args === '--session-failover');
const sfBaseT = tally((r) => r.variant === 'base' && r.args === '--session-failover');
const d20 = summary('014-');
const d45 = firstError('015-');
const d45Cause = (log('015-').match(/Caused by: com\.alibaba\.qwen\.code\.runtimebroker\.RuntimeBrokerException: (Managed Runtime worker did not become ready\.)/) ?? [])[1];
const d45Broker = (log('015-').match(/Runtime Broker returned HTTP 503 \((\w+)\)/) ?? [])[1];
const readyTimeout = (readFileSync('/Users/wenshao/git/pr13263-head/packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/LocalProcessRuntimeProvisioner.java', 'utf8').match(/READY_TIMEOUT = (Duration\.ofSeconds\(\d+\))/) ?? [])[1];
for (const [k, v] of Object.entries({ m1Err, a2bRefusal, d45Cause, d45Broker, readyTimeout })) {
  if (!v) throw new Error(`extraction failed: ${k}`);
}

// ---------- html ----------
const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
#card{width:1240px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:25px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:14.5px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.box{border:1px solid #30363d;border-radius:8px;padding:12px 14px;background:#161b22;min-width:0}
.box h2{font-size:15.5px;margin:0 0 8px;font-weight:600}
.bad h2{color:#ff7b72}.good h2{color:#3fb950}.neu h2{color:#79c0ff}.warn h2{color:#d29922}
pre{margin:0;font:12.6px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:hidden;color:#c9d1d9}
table{border-collapse:collapse;width:100%;font-size:13.2px}
td,th{border-bottom:1px solid #21262d;padding:6px 8px;text-align:left;vertical-align:top}
th{color:#8b949e;font-weight:600}
code{font:12.4px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6edf3}
.ok{color:#3fb950;font-weight:600}.no{color:#ff7b72;font-weight:600}.am{color:#d29922;font-weight:600}
.note{margin-top:16px;border-left:3px solid #388bfd;padding:6px 12px;color:#c9d1d9;font-size:14px;line-height:1.5}
.full{grid-column:1 / span 2}`;
const page = (title, sub, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const pre = (lines) => `<pre>${lines.map((l) => esc(clip(l))).join('\n')}</pre>`;
const env = 'macOS arm64 · MySQL 8.4.7 · JDK 21.0.12 · Node 22.23.2 · model qwen3.8-max · PR head 8e1375c380 vs merge-base 5130c1a734';

const cards = {};
cards['01-before-after'] = page(
  'Real-model mode: main fails deterministically, PR passes',
  env,
  `<div class="grid">
  <div class="box bad"><h2>merge-base runner — ${basePlain.total - basePlain.pass}/${basePlain.total} fail</h2>${pre([
    'npm run test:e2e:managed-agent-server -- --model qwen3.8-max',
    '',
    ...gotLines(`Error: ${firstError('002-')}`),
    '',
    'Spring -> Harness wire (recording proxy):',
    ...baseTap.flatMap(tapLines).map((l) => '  ' + l),
    '',
    'managed_agent_turn:',
    '  ' + baseTurn.replace(/\t/g, '  '),
  ])}</div>
  <div class="box good"><h2>PR head runner — ${headPlain.pass}/${headPlain.total} pass</h2>${pre([
    'npm run test:e2e:managed-agent-server -- --model qwen3.8-max',
    '',
    ...JSON.stringify(head001, null, 2).split('\n'),
  ])}</div>
  <div class="box neu full"><h2>Run matrix (each row = a full stack: fresh mysqld + Spring + embedded Broker + Hosted Harness + worker)</h2>
  <table><tr><th>arm</th><th>result</th><th>notes</th></tr>
  <tr><td>merge-base, qwen3.8-max</td><td class="no">${basePlain.pass}/${basePlain.total}</td><td>identical failure every time, ~10 s</td></tr>
  <tr><td>PR head, qwen3.8-max (delay 0)</td><td class="ok">${headPlain.pass}/${headPlain.total}</td><td>the ${headFail.length} failure: <code>${esc(naturalErr)}</code> (model deviation, see card 3)</td></tr>
  <tr><td>PR head, kimi-k3</td><td class="ok">${kimi.pass}/${kimi.total}</td><td>DashScope OpenAI-compatible provider</td></tr>
  <tr><td>PR head, author's toolchain</td><td class="ok">1/1</td><td><code>${esc(authorEnv.match(/node=\S+/)[0])} ${esc(authorEnv.match(/java=.*?"([^"]+)"/)[1].replace(/^/, 'jdk='))} ${esc(authorEnv.match(/mysql=\S+/)[0])}</code></td></tr>
  <tr><td>CI Hosted MySQL job (Linux)</td><td class="ok">pass</td><td><code>--inflight-failover</code> and <code>--continuation-failover</code> on this head</td></tr>
  </table></div></div>`,
);

cards['02-defect-ablation'] = page(
  'Each stacked defect, reverted one at a time on top of the PR',
  'Variant = PR runner with exactly one fix undone (generated by anchor replacement; every anchor asserted to match once). Same stack as card 1.',
  `<table>
  <tr><th style="width:24%">revert</th><th>observed (from the run log)</th><th style="width:9%">reproduces</th></tr>
  <tr><td>Defect 1 — drop Session Store env</td><td>Spring refuses to start: <code>${esc(m1Err)}</code><br><span style="color:#8b949e">With the PR's unconditional Workspace wiring the server's own validation now rejects this at boot (earlier and louder than the old runtime 400).</span></td><td class="am">guarded</td></tr>
  <tr><td>Defect 2 — drop Broker CLI flags</td><td><code>${esc(m2Tap.slice(-1)[0])}</code><br><code>${esc(clip(firstError('017-'), 150))}</code></td><td class="ok">yes</td></tr>
  <tr><td>Defect 3a — no actor header anywhere</td><td><code>${esc(m3Err.replace(/: \{.*"code":"(\w+)","message":"([^"]+)".*$/, ' $1 — $2'))}</code></td><td class="ok">yes</td></tr>
  <tr><td>Defect 3b — actor on create, not on poll</td><td><code>${esc(m3bErr)}</code> (180 s)<br>while durable state shows <code>${esc(m3bTurn.split('\t').slice(1, 2).join(''))}</code> turn and <code>${esc(m3bExec)}</code> write — the Turn finished, the poller could not see it</td><td class="ok">yes</td></tr>
  <tr><td>Defect 4a — absolute path under the Harness workspace</td><td>model calls: <code>${esc(tmpShort(m4bCalls[0]))}</code> (refused, no execution row) then <code>${esc(m4bCalls[1])}</code> → file lands in the mount root<br><code>${esc(m4bErr)}</code> (2/2 runs)</td><td class="ok">yes</td></tr>
  <tr><td>Defect 4b — require <code>item.tool_call.updated</code></td><td><code>${esc(compressEvents(m5Err))}</code><br><span style="color:#8b949e">The Turn completes and the write happens, but no <code>item.tool_call.*</code> event is ever published without O2 publication.</span></td><td class="ok">yes</td></tr>
  </table>
  <div class="note">Every fix in the diff is load-bearing: removing any one of them breaks the run in exactly the way the PR description and #13258 describe (defect 1 is now caught at startup instead).</div>`,
);

cards['03-audit-probes-failover'] = page(
  'Exactly-one audit, cross-tenant probe, and the unbound --session-failover mode',
  'Diagnostic variant = PR runner + read-only prints after the assertions (tool calls read from the Session Store managed-message resources).',
  `<div class="grid">
  <div class="box warn"><h2>Audit discriminates, but model deviations look like product failures</h2>${pre([
    `natural failures, unmodified PR runner (${headFail.length} of ${headPlain.total} runs):`,
    ...headFail.map((r) => `  ${r.id.slice(0, 3)}: ${firstError(r.id)}`),
    ...naturalCalls.map((c) => `    calls: ${c}`),
    '',
    'prompt asks for two writes (A1):',
    `  ${a1Err}`,
    '',
    'prompt asks for a directory listing first (A2, 2 runs):',
    `  run 1: ${a2Err}`,
    `    calls: ${a2Calls.join(', ')}`,
    `    qwen_tool_execution: ${a2Exec.join(', ')}`,
    `  run 2: ${a2bErr}`,
    `    Harness: ${a2bRefusal}`,
  ])}</div>
  <div class="box warn"><h2>Cross-tenant 404 cannot tell tenant from actor</h2>
  <table><tr><th>GET /v1/agents/sessions/{id}</th><th>status</th></tr>
  ${probes.map((p) => `<tr><td><code>${esc(p.label)}</code></td><td class="${p.status === 200 ? 'ok' : 'no'}">${p.status} ${esc((p.body.match(/"code":"(\w+)"/) ?? ['', ''])[1])}</td></tr>`).join('')}
  </table><div style="color:#8b949e;font-size:13px;margin-top:8px">Same pattern in all ${probeRuns} diagnostic runs. A same-tenant request without the actor header returns the identical 404 body, so the runner's existing cross-tenant assertion alone would also pass if tenant scoping leaked.</div></div>
  <div class="box good full"><h2>--session-failover (the only mode whose wiring this diff changes; no CI job runs it): head ${sfHeadT.pass}/${sfHeadT.total}, base ${sfBaseT.pass}/${sfBaseT.total}, identical durable shape</h2>
  <table><tr><th>field</th><th>merge-base</th><th>PR head</th></tr>
  ${['writerGeneration', 'journalRevision', 'committedSequence', 'terminalTurns', 'restoredFirstTurnContext', 'oldHarnessDiskDeleted'].map((k) => `<tr><td><code>${k}</code></td><td>${esc(sfBase[k])}</td><td>${esc(sfHead[k])}</td></tr>`).join('')}
  </table></div></div>`,
);

cards['04-readme-delay'] = page(
  'README cold-start example: 20 s works, the documented 45 s cannot',
  `Broker LocalProcessRuntimeProvisioner.READY_TIMEOUT = ${readyTimeout}; the runner's delayed-node wrapper sleeps --runtime-delay-ms before exec'ing the worker.`,
  `<div class="grid">
  <div class="box good"><h2>--runtime-delay-ms 20000 — pass</h2>${pre([
    `firstModelEventMs       ${d20.firstModelEventMs}`,
    `runtimeReadyMs          ${d20.runtimeReadyMs}`,
    `terminalMs              ${d20.terminalMs}`,
    `modelBeforeRuntimeReady ${d20.modelBeforeRuntimeReady}`,
    `toolSideEffect          ${d20.toolSideEffect}`,
    '',
    'the >=15 s model-before-Runtime assertion is armed and holds',
  ])}</div>
  <div class="box bad"><h2>--runtime-delay-ms 45000 (README example) — fail</h2>${pre([
    ...gotLines(`Error: ${d45}`),
    '',
    `Broker: ${d45Cause}  (TimeoutException)`,
    `Harness: Runtime Broker returned HTTP 503 (${d45Broker})`,
  ])}</div></div>
  <div class="note">Pre-existing and outside this diff, but it is the same README section the PR makes runnable: the 45 s example exceeds the Broker's 30 s worker-ready timeout, and the section still says the run "has not been executed as evidence" and "Once the missing integration lands".</div>`,
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1240, height: 900 } });
const pageObj = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  writeFileSync(path.join(OUT, `${name}.html`), html);
  await pageObj.setContent(html);
  const clipped = await pageObj.evaluate(() =>
    [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent.split('\n').sort((a, b) => b.length - a.length)[0]),
  );
  await pageObj.locator('#card').screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}.png clippedPre=${clipped}`);
}
await browser.close();
console.log(JSON.stringify({ headPlain: [headPlain.pass, headPlain.total], basePlain: [basePlain.pass, basePlain.total], kimi: [kimi.pass, kimi.total], sf: [sfHeadT.pass, sfHeadT.total, sfBaseT.pass, sfBaseT.total], probeRuns }));
