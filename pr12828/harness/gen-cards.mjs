// Evidence cards for the PR #12828 report: HTML tables built from the rig's
// observation files, rendered with Playwright (element screenshots, 2x).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const RIG = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(path.join(process.env.WT, 'package.json'))('playwright');
const read = (f) => JSON.parse(fs.readFileSync(path.join(RIG, f), 'utf8'));
const head = read('out-head/obs.json');
const get = (phase, step, key) => head.find((o) => o.phase === phase && o.step === step && o.key === key)?.value;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ok = (s) => `<span class="ok">${esc(s)}</span>`;
const bad = (s) => `<span class="bad">${esc(s)}</span>`;
const dim = (s) => `<span class="dim">${esc(s)}</span>`;
const css = `
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.card{display:inline-block;padding:22px 26px;background:#0d1117;min-width:1180px}
h1{font-size:21px;margin:0 0 4px}
.sub{color:#8b949e;margin:0 0 14px;font-size:13.5px}
table{border-collapse:collapse;width:100%;margin:6px 0 12px}
th,td{border:1px solid #30363d;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#c9d1d9;font-weight:600}
td code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:4px solid #58a6ff;background:#161b22;padding:8px 12px;margin-top:6px;font-size:14px}
.note.w{border-left-color:#d29922}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div class="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div>`;
const own = (v) => Array.isArray(v) ? v.map((x) => x.replace('system/session_execution_engine', 'owner').replace('system/session_source', 'session_source')).join(', ') : String(v);

// Card 1: paired daemon matrix
const rt = [['A', 'Primary (<code>--workspace</code> #1)'], ['B', 'Startup secondary (own <code>.rt</code> storage)'], ['C', 'Dynamic (<code>POST /workspaces</code>, own <code>.rt</code>)']];
let rows = rt.map(([k, label]) => {
  const before = get('P1', k, 'transcriptBeforePrompt');
  const after = get('P1', k, 'afterPrompt');
  const eng = get('P1', k, 'engines');
  const load = get('P1', k, 'coldLoad');
  const ml = String(get('P1', `${k}-managed`, 'managed.load')).split(' |')[0];
  const mr = String(get('P1', `${k}-managed`, 'managed.resume')).split(' |')[0];
  const mb = String(get('P1', `${k}-managed`, 'managed.bytes'));
  const mc = get('P1', `${k}-managed`, 'managed.acpChildren');
  return `<tr><td>${label}</td><td class="mono">${ok(own(before))}</td><td class="mono">${after.first === 'system/session_execution_engine(legacy)' && after.owners === 1 ? ok('owner(legacy) first, 1 owner') : bad(JSON.stringify(after))}</td><td class="mono">${ok(eng.join(','))}</td><td>${load === 200 ? ok('200') : bad(load)}</td><td class="mono">${ok(`${ml} / ${mr}`)}<br>${dim(`bytes ${mb.split(' ')[0]}, new ACP children ${mc.new}`)}</td></tr>`;
}).join('');
const repl = `<tr><td>Replacement (C untrusted → trusted again)</td><td class="mono">${ok(own(get('P1R', 'C-retrusted', 'create').transcript))}</td><td>${dim('—')}</td><td class="mono">${ok(get('P1R', 'C-retrusted', 'engines').join(','))}</td><td>${ok(`P1 session: ${get('P1R', 'C-retrusted', 'loadP1Session')}`)}</td><td class="mono">${ok(String(get('P1R', 'C-retrusted', 'managedLoad')).trim())}</td></tr>`;
const sa = get('P1', 'standalone', 'afterPrompt');
const conv = `<tr><td>Conversations (<code>POST /standalone/sessions</code>)</td><td class="mono">${ok(own(get('P1', 'standalone', 'transcriptAfterCreate')))}</td><td class="mono">${sa.owners === 0 ? ok('0 owner records (single factory)') : bad(`${sa.owners} owners`)}</td><td>${dim('internal, not listed')}</td><td>${dim('—')}</td><td>${dim('—')}</td></tr>`;
const deny = get('P1', 'deny', 'touchAttempt');
const sig = ['P1', 'P1R', 'P2', 'P3', 'P4'].map((p) => get(p, 'shutdown', 'SIGTERM'));
const p2 = (s) => get('P2', s, 'load');
const p3 = (s) => get('P3', s, 'load');
const hostF = get('P5', 'hosted+flag', 'exit');
const hostN = get('P5', 'hosted-noflag', 'exit');
const card1 = page('PR #12828 · real `qwen serve --experimental-paired-engines` (bundled CLI, macOS)',
  `head 907dae03ac · real <code>qwen --acp</code> Legacy child · isolated HOME, trusted-folders file, local fake model · "engines" = <code>GET /workspaces/runtime-stop-options</code> → <code>channels[].executionEngine</code> (absent on an unpaired Bridge)`,
  `<table><tr><th>Runtime</th><th>Transcript right after create</th><th>After first prompt</th><th>engines</th><th>Close → cold load</th><th>Managed-owned copy: load / resume</th></tr>${rows}${repl}${conv}</table>
  <table><tr><th>Check</th><th>Result</th></tr>
  <tr><td>Workspace deny <code>Bash(touch *)</code> + <code>POST /workspace/reload</code> (only Legacy live)</td><td>${ok('200 / 200, rule saved')}; model's <code>touch</code> → ${ok(deny.toolResults.join(','))}, marker ${deny.marker ? bad('created') : ok('absent')}</td></tr>
  <tr><td>Restart <b>without</b> the flag over the same storage</td><td>paired session ${ok(p2('A-paired').status)}, owner-only session ${ok(p2('A-ownerOnly').status)}, secondary session ${ok(p2('B-paired').status)}; new session: ${ok('no transcript before prompt, 0 owners after')}; engines ${ok(get('P2', 'U', 'engines').join(','))}</td></tr>
  <tr><td>Restart <b>with</b> the flag again</td><td>session created while unpaired ${ok(p3('U-unpaired').status)} (${p3('U-unpaired').owners} owner records, not rewritten); paired session ${ok(p3('A-paired').status)}</td></tr>
  <tr><td>Fresh paired daemon, first request = Managed-owned load</td><td>${ok('409 / 409')}, bytes unchanged, ${ok('0 new ACP children')}; next Legacy load ${ok(get('P4', 'A-legacy-next', 'load').status)}</td></tr>
  <tr><td>SIGTERM (5 paired/unpaired daemons)</td><td>exit ${ok(sig.map((s) => s.exit).join(','))} · leftover ACP children ${ok(sig.reduce((a, s) => a + s.leftover, 0))}</td></tr>
  <tr><td><code>--profile hosted-harness</code> + flag</td><td>exit ${ok(hostF.code)} before listening: <code>${esc(hostF.line.replace('qwen serve: ', ''))}</code>; same args without the flag: ${ok('listening')}</td></tr>
  </table>`);

// Card 2: flag off parity + dist mutants
const base = read('out-base/obs.json');
const flagBase = base.find((o) => o.phase === 'P6' && o.key === 'exit')?.value;
const dm = read('dmut.json');
const pick = (m, phase, step, key) => m.obs.find((o) => o.phase === phase && o.step === step && o.key === key)?.value;
const dmRows = dm.map((m) => {
  let changed;
  switch (m.id) {
    case 'D1': changed = `A: transcript before prompt <b>${esc(own(pick(m, 'P1', 'A', 'transcriptBeforePrompt')))}</b>, engines ${esc(pick(m, 'P1', 'A', 'engines'))}, Managed-owned load <b>${esc(String(pick(m, 'P1', 'A-managed', 'managed.load')).split(' |')[0])}</b>`; break;
    case 'D2': changed = `B: transcript before prompt <b>${esc(own(pick(m, 'P1', 'B', 'transcriptBeforePrompt')))}</b>, engines ${esc(pick(m, 'P1', 'B', 'engines'))}, Managed-owned load <b>${esc(String(pick(m, 'P1', 'B-managed', 'managed.load')).split(' |')[0])}</b>`; break;
    case 'D3': changed = `B cold load <b>${esc(String(pick(m, 'P1', 'B', 'coldLoad')).split(' No')[0])}</b>; Managed-owned load <b>${esc(String(pick(m, 'P1', 'B-managed', 'managed.load')).split(' |')[0])}</b>`; break;
    case 'D4': changed = `C: transcript before prompt <b>${esc(own(pick(m, 'P1', 'C', 'transcriptBeforePrompt')))}</b>, Managed-owned load <b>${esc(String(pick(m, 'P1', 'C-managed', 'managed.load')).split(' |')[0])}</b>; replacement engines ${esc(pick(m, 'P1R', 'C-retrusted', 'engines'))}`; break;
    case 'D5': changed = `C cold load <b>${esc(String(pick(m, 'P1', 'C', 'coldLoad')).split(' No')[0])}</b>; after replacement the P1 session <b>${esc(pick(m, 'P1R', 'C-retrusted', 'loadP1Session'))}</b>`; break;
    case 'D6': changed = `standalone create <b>${esc(String(pick(m, 'P1', 'standalone', 'create')).slice(0, 4))}</b> <code>conversation_root_compromised</code> (writer lease no longer attested)`; break;
    case 'D7': changed = `still <b>409</b> — but the load now reaches the Legacy child, which refuses it itself (<code>belongs to managed, cannot execute with legacy</code>) and its channel is torn down (children ${esc(JSON.stringify(pick(m, 'P1', 'A-managed', 'managed.acpChildren')))})`; break;
  }
  return `<tr><td class="mono">${m.id}</td><td>${esc(m.desc)}</td><td>${m.id === 'D7' ? '<span class="warn">caught by 2nd layer</span>' : ok('observed')}</td><td>${changed}</td></tr>`;
}).join('');
const card2 = page('Flag off = base build · wiring mutants in the real daemon',
  'Same rig script, fresh storage per arm. Dist mutants: one bundle edit each in an APFS clone of head, paired P1 + replacement phases re-run, chunk restored byte for byte.',
  `<table><tr><th>Arm</th><th>Result</th></tr>
  <tr><td>base <code>8a170d7e45</code> vs head without the flag</td><td>${ok('50 / 50 observations identical')} after normalizing ports, timings, hashes and child counts (create, prompt, transcript shapes, cold load, Managed-owner copies, standalone, deny + reload, SIGTERM)</td></tr>
  <tr><td>base with <code>--experimental-paired-engines</code></td><td>exit ${ok(flagBase.code)}: <code>${esc(flagBase.line)}</code></td></tr></table>
  <table><tr><th>ID</th><th>Dist mutant</th><th>Rig</th><th>What changed in the real daemon</th></tr>${dmRows}</table>
  <div class="note">Every wiring mutant flips exactly the runtime it targets and leaves the others paired. D7 shows the selector refusal is what keeps a Managed-owned load away from the Legacy channel; without it the B2a check in the child still refuses, but only after dispatch and at the cost of that channel.</div>`);

// Card 3: source mutants
const mu = [...read('mut-unit-main.json').filter((m) => !['S16', 'S17'].includes(m.id)), ...read('mut-unit-rerun.json').filter((m) => m.id === 'S17'), ...read('mut-unit-rerun.json').filter((m) => m.id === 'S16' || m.id === 'S16b'), ...read('mut-unit-s16c.json')];
const cand = read('mut-unit-candidate.json');
for (const m of mu) if (m.id === 'S16b') m.desc = 'Managed owner with a non-default source restored on Legacy (purpose re-checked on restore)';
const muRows = mu.map((m) => `<tr><td class="mono">${m.id}</td><td>${esc(m.desc)}</td><td>${m.verdict === 'KILLED' ? ok('killed') : bad('survived')}</td><td class="mono">${esc(m.tests)}</td><td>${m.verdict === 'KILLED' ? esc((m.failed[0] ?? '').replace(/^src\/serve\/|^src\/commands\//, '').slice(0, 92)) : ok(`killed by candidate test (${cand.find((c) => c.id === m.id)?.tests ?? ''})`)}</td></tr>`).join('');
const card3 = page(`Source mutants vs the PR's own tests: ${mu.filter((m) => m.verdict === 'KILLED').length}/${mu.length} killed`,
  'APFS clone of head, one mutant at a time, focused vitest files per area (selector 50 tests, default Bridge 15, run-qwen-serve 498, Hosted/serve command). S01–S17 selector, V default Bridge, R daemon sites, H Hosted, C CLI mapping.',
  `<table><tr><th>ID</th><th>Mutant</th><th>Verdict</th><th>Tests</th><th>First failing test / note</th></tr>${muRows}</table>
  <div class="note w">S16/S16b/S16c: a cold restore that re-applies the creation-purpose rule and sends a Managed owner with a parent, a non-default source or a standalone restore to Legacy. Restore requests do carry <code>parentSessionId</code>/<code>sourceType</code>/<code>sourceId</code>, and the design says purposes are not evaluated again. A 4-case <code>it.each</code> (Managed owner + that metadata → <code>managed</code>) passes on head and kills all three.</div>`);

// Card 5: behaviour differences with the flag on a Legacy-only host
const ex = read('out-extra/obs.json');
const exg = (p, s, k) => ex.find((o) => o.phase === p && o.step === s && o.key === k)?.value;
const q = (f) => fs.readFileSync(path.join(RIG, f, 'rows.txt'), 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^\s*[\d.]+s\s+/, ''));
const qp = q('out-q-paired'), qu = q('out-q-unpaired'), qb = q('out-q-base');
const qrow = (i, label) => `<tr><td>${label}</td><td class="mono">${esc(qp[i].split(': ').slice(1).join(': '))}</td><td class="mono">${esc(qu[i].split(': ').slice(1).join(': '))}</td><td class="mono">${esc(qb[i].split(': ').slice(1).join(': '))}</td></tr>`;
const card5 = page('What the flag changes on a Legacy-only host (both documented; shown here in a real daemon)',
  'Top: a torn last transcript line (what a crash in the middle of an append leaves). Bottom: one session\'s restore outlives <code>--session-restore-timeout-ms 2000</code> and its settlement grace (a SessionStart hook sleeps 14 s on resume); S1 is a different, healthy, idle session on the same Legacy channel.',
  `<table><tr><th>Torn last line (Legacy session)</th><th>Result</th></tr>
  <tr><td>paired daemon: load</td><td class="mono">${bad(String(exg('E1', 'torn', 'pairedLoad')).split(' |')[0])} · bytes ${esc(exg('E1', 'torn', 'bytes'))}</td></tr>
  <tr><td>response body / daemon log</td><td>identical to a Managed-owned refusal: <code>This session cannot be resumed with the current execution engine.</code> — neither says <code>incomplete transcript</code></td></tr>
  <tr><td>unpaired daemon: load, then a prompt</td><td class="mono">${ok(String(exg('E2', 'torn', 'unpairedLoad')).trim())}; appends after the torn line (torn line stays inside: ${esc(exg('E2', 'torn', 'unpairedAppended').tornLineStillInside)})</td></tr>
  <tr><td>paired daemon again</td><td class="mono">${bad(String(exg('E3', 'torn', 'pairedLoadAfterUnpairedAppend')).split(' |')[0])} — still refused</td></tr>
  <tr><td>upper-case id: Legacy / Managed-owned</td><td class="mono">${ok(String(exg('E1', 'upper', 'legacyLoad')).trim())} / ${ok(String(exg('E1', 'upper', 'managedLoad')).trim())}</td></tr></table>
  <table><tr><th>Overdue restore</th><th>head, paired</th><th>head, no flag</th><th>base</th></tr>
  ${qrow(4, 'S2 load (hook sleeping)')}${qrow(5, 'S1 prompt ~3.5 s later')}${qrow(6, 'new session S3')}${qrow(9, 'S1 prompt after the hook finished')}${qrow(10, 'new session S4')}</table>
  <div class="note w">Paired log: <code>quarantining legacy ACP channel … (restore_settlement_overdue)</code> → <code>closing session S1 (reason: channel_quarantined)</code>; the channel retires at once and new sessions start on a fresh one. Unpaired and base keep S1 prompting but refuse new sessions (503) until the stuck restore settles. With the default 60 s restore timeout this needs a restore stuck for over 120 s.</div>`);

const browser = await chromium.launch();
const out = path.join(RIG, 'cards');
for (const [name, html] of [['01-paired-daemon', card1], ['02-flag-off-and-dist-mutants', card2], ['03-source-mutants', card3], ['05-legacy-only-differences', card5]]) {
  const f = path.join(out, `${name}.html`);
  fs.writeFileSync(f, html);
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`file://${f}`);
  await p.locator('.card').screenshot({ path: path.join(out, `${name}.png`) });
  await p.close();
  console.log('wrote', name);
}
await browser.close();
