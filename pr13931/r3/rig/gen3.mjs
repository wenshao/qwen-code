// Evidence cards for the PR #13931 round-3 report (exact head 86656d10 + trial merge with main 6373fc4e).
// node gen3.mjs -> fig3/*.png (Playwright, 2x). Every number is read from the rig results.json files.
import fs from 'node:fs';
import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';

const RUNS = '/Users/wenshao/pr13931-rig/r3/host/rig/runs';
const OUT = '/Users/wenshao/pr13931-rig/r3/fig3';
const R = (d) => JSON.parse(fs.readFileSync(`${RUNS}/${d}/results.json`, 'utf8'));
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const pass = (r) => `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`;
const ok = (v) => (v === 'completed' ? 'ok' : 'bad');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{width:1400px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:25px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:15px;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:6px 0 14px}
th{color:#8b949e;font-weight:600;text-align:left;border-bottom:1px solid #30363d;padding:6px 9px}
td{border-bottom:1px solid #21262d;padding:6px 9px;vertical-align:top}
.mono,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
.note{border-left:4px solid #d29922;padding:8px 14px;background:#161b22;font-size:14.5px;margin-top:6px;line-height:1.5}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
.h2{font-size:17px;font-weight:650;margin:14px 0 4px}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#161b22;border:1px solid #30363d;padding:10px 14px;margin:6px 0 12px;white-space:pre;overflow:hidden;line-height:1.5}
pre .r{color:#f85149}pre .g{color:#3fb950}pre .y{color:#d29922}pre .d{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const td = (v, cls = '') => `<td class="${cls}">${esc(v)}</td>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.join('')}</table>`;

const d = {
  l4h: R('rig_l4_head3-l4-head3'), l4m: R('rig_l4_merge3-l4-merge3'),
  l4xh: R('rig_l4x_head3-l4x-head3'), l4xm: R('rig_l4x_merge3-l4x-merge3'),
  v1h: R('rig_v1off_head3-v1off-head3'),
  cuth: R('rig_cut_head3-cut-head3'), cutbh: R('rig_cutb_head3-cut-head3'), cutm: R('rig_cutc_merge3-cut-merge3'),
  l15h: R('rig_lease15_head3-lease-head3'), l15m: R('rig_lease15_merge3-lease-merge3'), l60h: R('rig_lease60_head3-lease-head3'),
  idle: R('rig_idle15_head3-idle-head3'),
  mcph: R('rig_mcp_head3-mcp-head3'), mcpm: R('rig_mcp_merge3-mcp-merge3'),
  offh: R('rig_mcpoff_head3-mcpoff-head3'), offm: R('rig_mcpoff_merge3-mcpoff-merge3'),
};
const cards = {};

// ---- 1. matrix ----
{
  const op = (s) => (s ? `${s.op?.final?.status ?? s.admit} · ${s.sessionAfter}` : '—');
  const opc = (s) => (s ? ok(s.op?.final?.status) : 'dim');
  const reg = [
    ['Round-2 rig: l4 (A–E, REST/WebShell close+delete)', pass(d.l4h), pass(d.l4m)],
    ['Round-2 rig: l4x (two calls, exit 3, 1 MiB capture)', pass(d.l4xh), pass(d.l4xm)],
    ['v2 not advertised: Shell delete → 409, 0 op rows', pass(d.v1h), '—'],
    ['HostedPublicWorkspaceIT', 'deletion-to-O4 method ✔ 134.5 s', 'class 10/10 ✔ 267.0 s'],
    ['qwencode HostedHarnessClientTest / runtime-broker full', '70/70 · 807 run, 0 fail', '70/70 · 807 run, 0 fail'],
    ['managed-agent-server lifecycle + coordinator', '125/125', '125/125'],
    ['vitest: 6 touched suites / hosted-harness-session', '118/118 · 450/450', '118/118 · 451/451'],
    ['main #13928 HostedTeamMemberCommandMySqlIT', '—', '2/2 ✔ 87.7 s'],
  ].map(([a, b, c]) => `<tr>${td(a)}${td(b, b.includes('/') || b.includes('✔') ? 'ok' : 'dim')}${td(c, c.includes('/') || c.includes('✔') ? 'ok' : 'dim')}</tr>`);
  const sh = (k, h, m, what) => `<tr>${td(k, 'mono')}${td(what)}${td(op(h), opc(h))}${td(op(m), opc(m))}</tr>`;
  const ch = d.cuth, cb = d.cutbh, cm = d.cutm;
  const fault = [
    sh('X2', ch.X2_lost_reply_prepare, cm.X2_lost_reply_prepare, 'prepare_resources reply lost, then retried'),
    sh('X3', ch.X3_lost_reply_settle, cm.X3_lost_reply_settle, 'settle_resources reply lost, then retried'),
    sh('X7', cb.X7_close_lost_reply_settle, cm.X7_close_lost_reply_settle, 'CLOSE, settle_resources reply lost'),
    sh('X4', ch.X4_kill_harness_in_settle, cm.X4_kill_harness_in_settle, 'Harness SIGKILL while settle_resources in flight, restart'),
    sh('X6', cb.X6_original_worker_killed, cm.X6_original_worker_killed, 'original Runtime worker SIGKILL before DELETE'),
    sh('I1/I2', d.idle.I1_idle_then_delete, null, 'ACTIVE idle 40 s (> 15 s writer lease), then DELETE / CLOSE'),
    sh('Z2', d.l15h.Z2_hold_prepare_short, d.l15m.Z2_hold_prepare_short, 'prepare_resources delayed 5 s (< 15 s writer lease)'),
    sh('Z1', d.l15h.Z1_hold_prepare_long, d.l15m.Z1_hold_prepare_long, 'prepare_resources delayed 40 s (> 15 s writer lease)'),
    sh('Z1·60', d.l60h.Z1_hold_prepare_long, null, 'same with the default 60 s lease, delayed 85 s'),
    sh('X5', ch.X5_kill_spring_in_prepare, cm.X5_kill_spring_in_prepare, 'Spring SIGKILL in DRAINING, restart (15 s lease)'),
    sh('X5·60', d.l60h.X5L_kill_spring_in_prepare, null, 'same with the default 60 s writer lease'),
  ];
  const mc = (k, h, m, what) => sh(k, h, m, what);
  const mcp = [
    mc('M1', d.mcph.M1_mcp_both_delete, d.mcpm.M1_mcp_both_delete, 'stdio + HTTP tool calls, DELETE'),
    mc('M2', d.mcph.M2_mcp_both_close, d.mcpm.M2_mcp_both_close, 'stdio + HTTP tool calls, CLOSE'),
    mc('M3', d.mcph.M3_mcp_idle_delete, d.mcpm.M3_mcp_idle_delete, 'idle MCP Session, DELETE'),
    mc('M5', d.mcph.M5_mcp_lost_reply_settle, d.mcpm.M5_mcp_lost_reply_settle, 'stdio call, settle_resources reply lost'),
    mc('N', d.offh.N_mcp_delete_v2_not_advertised, d.offm.N_mcp_delete_v2_not_advertised, 'MCP v2 not advertised: 409, 0 op rows, ACTIVE'),
    mc('M4', d.mcph.M4_mcp_worker_killed_delete, d.mcpm.M4_mcp_worker_killed_delete, 'original worker SIGKILL, then DELETE'),
  ];
  // N is expected to be refused: recolor
  const body = `<div class="h2">Regression (round-2 recipe on the exact head and on the trial merge)</div>${table(['check', 'head3 = 86656d10', 'merge3 = head + main 6373fc4e'], reg)}`
    + `<div class="h2">New: Shell v2 fault cuts (tap between Spring and Harness)</div>${table(['id', 'scenario', 'head3', 'merge3'], fault)}`
    + `<div class="h2">New: MCP v2 with live stdio + streamable-HTTP MCP servers</div>${table(['id', 'scenario', 'head3', 'merge3'], mcp).replaceAll('<td class="bad">409 workspace_unavailable · ACTIVE</td>', '<td class="ok">409 workspace_unavailable · ACTIVE</td>')}`
    + `<div class="note red">Two failure classes, identical on both arms: <b>A</b> — any DRAINING gap longer than the Session Store writer lease (Spring restart, slow phase) leaves the operation RECOVERY_BLOCKED until the Harness restarts (Z1, X5). <b>B</b> — an MCP Session whose original worker died never closes or deletes (M4); a Shell Session in the same position does (X6).</div>`;
  cards['01-matrix'] = page('#13931 round 3 — real Linux stack, exact head and trial merge', 'Ubuntu 24.04 container, Node 22 + OpenJDK 21, MySQL 8.4.11, Spring fat jar + packaged Harness + durable local-process workers, scripted model. Rows show operation status · Session status.', body);
}

// ---- 2. finding A: writer lease ----
{
  const row = (label, L, s, how, arm) => {
    const frozen = s.writerAtRelease ?? null;
    const restart = s.afterHarnessRestart ? `${s.afterHarnessRestart.final?.status} · ${s.sessionAfterRestart} after ${Math.round(s.afterHarnessRestart.sinceRestartMs / 1000)} s` : '—';
    const toS = (t) => { const [h, mi, se] = t.split(':').map(Number); return h * 3600 + mi * 60 + se; };
    const until = frozen ? frozen.split(' ')[1].slice(0, 8) : null;
    const rel = s.dbNowAtRelease?.slice(0, 8);
    const late = until && rel ? toS(rel) - toS(until) : null;
    const wtxt = until ? `lease to ${until}, released ${rel}${late > 0 ? ` (${late} s after expiry)` : ` (${-late} s left)`}` : '—';
    return `<tr>${td(label, 'mono')}${td(arm)}${td(`${L} s`)}${td(how)}${td(wtxt, late > 0 ? 'mono bad' : 'mono')}`
      + `${td(`${s.op?.final?.status} · ${s.sessionAfter}`, ok(s.op?.final?.status))}${td(s.opMeta?.[0] ? `${s.opMeta[0].attempts} attempts${s.opMeta[0].error ? ', ' + s.opMeta[0].error.replace('workspace_lifecycle_', '') : ''}` : '—', 'mono')}${td(restart, s.afterHarnessRestart ? 'ok' : 'dim')}</tr>`;
  };
  const x5row = (label, L, s, arm, now) => `<tr>${td(label, 'mono')}${td(arm)}${td(`${L} s`)}${td('Spring SIGKILL while prepare_resources in flight; restart')}${td(now, 'mono')}${td(`${s.op?.final?.status} · ${s.sessionAfter}`, 'bad')}${td(s.opMeta?.[0] ? `${s.opMeta[0].attempts} attempts, ${s.opMeta[0].error.replace('workspace_lifecycle_', '')}` : '—', 'mono')}${td('not tried', 'dim')}</tr>`;
  const I1 = d.idle.I1_idle_then_delete;
  const idleRow = `<tr>${td('I1', 'mono')}${td('head3')}${td('15 s')}${td('ACTIVE, idle 40 s, then DELETE')}${td(`advances: ${I1.samples.map((x) => x.writer.split(' ')[1].slice(3, 8)).filter((v, i, a) => a.indexOf(v) === i).join(' ')}`, 'mono')}${td(`${I1.op.final.status} · ${I1.sessionAfter}`, 'ok')}${td('0 attempts', 'mono')}${td('—', 'dim')}</tr>`;
  const rows = [
    idleRow,
    row('Z2', 15, d.l15h.Z2_hold_prepare_short, 'prepare_resources delayed 5 s', 'head3'),
    row('Z2', 60, d.l60h.Z2_hold_prepare_short, 'prepare_resources delayed 30 s', 'head3'),
    row('Z1', 15, d.l15h.Z1_hold_prepare_long, 'prepare_resources delayed 40 s', 'head3'),
    row('Z1', 15, d.l15m.Z1_hold_prepare_long, 'prepare_resources delayed 40 s', 'merge3'),
    row('Z1', 60, d.l60h.Z1_hold_prepare_long, 'prepare_resources delayed 85 s', 'head3'),
    x5row('X5', 15, d.cuth.X5_kill_spring_in_prepare, 'head3', 'frozen 04:18:31; still DELETING at 04:51'),
    x5row('X5', 15, d.cutm.X5_kill_spring_in_prepare, 'merge3', 'still DELETING after 240 s'),
    x5row('X5', 60, d.l60h.X5L_kill_spring_in_prepare, 'head3', 'frozen 04:38:54; still DELETING at 04:51'),
  ];
  const chain = `<span class="d"># 86656d10, Shell v2, no Hook catalog</span>
DELETE admitted → Java derives the effects receipt itself → saveEffects → <span class="y">harness_drain.phase = DRAINING</span>
<span class="d">observed:</span> writer_lease_until stops advancing at DRAINING (while ACTIVE it advances every ~7.5 s, see I1)
<span class="d">code (my reading):</span> renewWriter → checkLifecycleWriter → <span class="y">authority != null || v2</span> → requireClaim(null)
    → <span class="r">workspace_lifecycle_claim_fenced</span>
    <span class="d">ManagedSessionStore.java:186 (added by this PR), renewWriter :397</span>
next lifecycle request after the lease has lapsed:
    prepare_resources → stores.assertWritable() → <span class="r">"writer grant is stale or unavailable"</span>
        → 503 workspace_lifecycle_resources_unsettled         <span class="d">hosted-harness-session.ts:5427</span>
    lifecycle load → resident.stores.assertWritable()
        → <span class="r">503 managed_session_open_failed</span>                   <span class="d">hosted-harness-session.ts:3431, 3439</span>
nothing re-acquires the writer for a resident Session → backoff to 60 s → <span class="r">RECOVERY_BLOCKED</span>
a Harness restart clears it: the cold lifecycle load takes <span class="g">writer_generation 2</span> under the current claim`;
  cards['02-writer-lease'] = page('Finding A — a DRAINING gap longer than the writer lease wedges v2 cleanup', 'Spring → tap → Harness; the tap delays one prepare_resources, or Spring is SIGKILLed while it is in flight. Writer lease = QWEN_MANAGED_AGENT_SESSION_STORE_WRITER_LEASE_DURATION (default 60 s).',
    table(['id', 'arm', 'writer lease', 'what happened', 'writer_lease_until (DB)', 'operation · Session', 'coordinator (at rig end)', 'after Harness restart'], rows) + `<pre>${chain}</pre>`
    + `<div class="note red">With the default 60 s writer lease, a Spring crash or redeploy during DRAINING is enough: the restarted Spring cannot reclaim before the 60 s dispatch lease ends, and by then the Harness writer lease has lapsed (X5·60: 15 attempts over 13 min, still DELETING). No model request is made and the Shell does not re-run; the Session just never finishes deleting until the Harness process is restarted.</div>`);
}

// ---- 3. MCP ----
{
  const m = (s) => {
    const sb = s.stdioBefore, sa = s.stdioAfter, hb = s.httpBefore, ha = s.httpAfter;
    return [`pid alive ${sb.alive} → ${sa.alive}; ${sa.ended.join(', ') || '—'}`, `calls ${sb.calls}`, `init ${ha.inits}, calls ${ha.calls}, DELETE ${ha.deletes}, transport close ${ha.transportCloses}, live ${hb.live} → ${ha.live}`];
  };
  const rows = [];
  for (const [arm, r, off] of [['head3', d.mcph, d.offh], ['merge3', d.mcpm, d.offm]]) {
    for (const [k, s] of [['M1 DELETE', r.M1_mcp_both_delete], ['M2 CLOSE', r.M2_mcp_both_close], ['M5 lost settle reply', r.M5_mcp_lost_reply_settle], ['N v2 off', off.N_mcp_delete_v2_not_advertised], ['M4 worker killed', r.M4_mcp_worker_killed_delete]]) {
      const [stdio, calls, http] = m(s);
      const res = s.op ? `${s.op.final?.status} · ${s.sessionAfter}` : `${s.admit} · ${s.sessionAfter}`;
      const good = k.startsWith('N') ? s.admit.startsWith('409') : s.op?.final?.status === 'completed';
      rows.push(`<tr>${td(arm)}${td(k, 'mono')}${td(stdio, 'mono')}${td(http, 'mono')}${td(res, good ? 'ok' : 'bad')}</tr>`);
    }
  }
  const M4 = d.mcph.M4_mcp_worker_killed_delete;
  const seq = M4.tap.map((e) => `${e.phase.replace('_resources', '')}:${e.upstream}${e.code ? ' ' + e.code.replace('workspace_', '') : ''}`);
  const chain = `<span class="d"># M4: one stdio + one HTTP tool call, then worker pid ${M4.killedWorker?.pid} SIGKILLed (local process record ${M4.workersAfter?.[0]?.stateAfter}; broker binding LOST)</span>
qwen_runtime_binding  W4  <span class="r">LOST</span>, drain_requested 0, no drain receipt
qwen_runtime_session  mcp-… (bootstrap, MCP connection owner)  <span class="r">READY</span>   <span class="d">← never released</span>
attempt 1   settle_resources → Harness: "MCP requires reconciliation of its original operation"
              → 503 resources_unsettled → coordinator MCP branch → recoverStoppedWorkspaceResources
              → reconcile proves NOT_FOUND → drainBinding(LOST) → countActiveByBinding != 0
              → <span class="r">workspace_close_execution_unsettled "Lost Runtime resources require recovery"</span>
              <span class="d">RuntimeBrokerService.java:337-349 → :439</span>
attempt 2+  settle_resources → <span class="r">503 workspace_close_identity_unverified</span> → coordinator rethrows workspace_close*
              <span class="d">SessionLifecycleCoordinator.java:386</span> → the stopped-worker branch (:391) is not entered again
tap: ${seq.slice(0, 4).join('  ')} …  (${seq.length} calls in ${Math.round(M4.op.waitedMs / 1000)} s)`;
  cards['03-mcp'] = page('MCP v2 with live servers — normal paths release everything; a dead worker never settles', 'The tap adds the two MCP pins to the Harness create/ordinary-load bodies (Spring never sends mcpServers); the worker reads QWEN_MANAGED_MCP_CONFIG. stdio server = SDK 1.30 Server over StdioServerTransport; HTTP server = StreamableHTTPServerTransport.',
    table(['arm', 'scenario', 'stdio MCP server process', 'streamable-HTTP MCP server', 'operation · Session'], rows) + `<pre>${chain}</pre>`
    + `<div class="note red">The stop proof itself succeeds; the broker then refuses the LOST binding because the MCP owner runtime session is still READY, and nothing releases it — the Harness cannot reach the dead worker, and once it answers workspace_close_identity_unverified the coordinator stops trying the stopped-worker path. The same kill on a Shell Session (X6) deletes in 0.5–2 s. After the kill, the stdio server exits on stdin EOF; the remote HTTP MCP session is left live (no DELETE), as the PR states.</div>`);
}

fs.mkdirSync(`${OUT}/cards`, { recursive: true });
const browser = await chromium.launch();
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${OUT}/cards/${name}.html`, html);
  const pg = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await pg.goto(`file://${OUT}/cards/${name}.html`);
  const clipped = await pg.evaluate(() => { const edge = document.querySelector('.card').getBoundingClientRect().right - 31; return [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)).concat([...document.querySelectorAll('table,pre')].filter((e) => e.getBoundingClientRect().right > edge).map((e) => 'OVERFLOW ' + e.textContent.slice(0, 40))); });
  await (await pg.$('.card')).screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
  await pg.close();
}
await browser.close();
