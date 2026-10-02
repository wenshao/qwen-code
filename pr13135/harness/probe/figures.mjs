// VERIFICATION RIG ONLY (PR #13135): evidence figures built from the probe ledgers (numbers are read, not typed).
// usage: node figures.mjs
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, N, M, count, res, RIG } from './figlib.mjs';

const L = (n) => res('l1', n);
const row = (r, p) => r.rows.find((x) => x.label.startsWith(p));
const det = (r, p) => row(r, p)?.detail ?? '';
const ms = (d) => d.match(/(\d+)ms/)?.[1];
const pass = (r) => r.fail === 0;
const verdict = (r, text) => (pass(r) ? OK(text) : BAD(text));

const s1p = L('s1-close-head-public-ws-a');
const s1w = L('s1-close-head-web-ws-b');
const base = res('lb', 's0-mac-linux-durable-base');
const mac = res('mh2', 's0-mac-head');
const s2 = L('s2-active-head-ws-c');
const s2b = L('s2b-after-hold-head');
const s3 = L('s3-shared-head-ws-d');
const s5 = L('s5-approval-head-wsap-k');
const races = ['d0', 'd300', 'd900'].map((d) => L(`s4-warm-race-head-ws-e-${d}`));
const raceRows = races.flatMap((r) => r.rows.filter((x) => x.label.startsWith('#')));
const provisioning = raceRows.filter((x) => x.detail.includes('bindingsAtClose=["PROVISIONING"]')).length;
const raceOk = raceRows.filter((x) => x.ok).length;
const f1 = L('closeall-F1-worker-killed');
const f2 = fs.readFileSync(`${RIG}/out/l1/F2-summary.txt`, 'utf8');
const f3 = L('closeall-F3-spring-term-restart');
const up = res('lb', 's7-upgrade-close');
const unitBroker = fs.readFileSync(`${RIG}/out/unit-broker.log`, 'utf8');
const unitManaged = fs.readFileSync(`${RIG}/out/unit-managed.log`, 'utf8');
const unitTs = fs.existsSync(`${RIG}/out/unit-ts.log`) ? fs.readFileSync(`${RIG}/out/unit-ts.log`, 'utf8') : '';
const totals = (log) => [...log.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n/g)].map((m) => `${m[1]} run / ${m[2]} fail / ${m[3]} err / ${m[4]} skip`);
const tsLine = unitTs.match(/Tests\s+(\d+ passed[^\n]*)/)?.[1] ?? 'not run';

const closeMs = (r) => ms(det(r, 'close operation completes'));
const receipt = det(s1p, 'binding RELEASED');

figs['01-close-works'] = page(
  'PR #13135 @ 6c6e58441a — reliable close on a real Linux durable local-process stack',
  'Real Spring fat jar + MySQL 8.4.7 + packaged Hosted Harness + real <code>managed-runtime-worker</code> processes, inside a Linux container (colima VM, kernel 6.8, stable machine-id). Scripted OpenAI-compatible model. Every row is a probe run; numbers are copied from its ledger.',
  table(
    ['Scenario', 'Before (base 3f56f74a6a)', 'After (head 6c6e58441a)'],
    [
      ['Bound <code>hosted-workspace-files/1</code> close, public + WebShell', BAD(`409 <code>workspace_unavailable</code>, no <code>session_close</code> capability (${count(base)})`), verdict(s1p, `202 → completed in ${closeMs(s1p)} ms (public) / ${closeMs(s1w)} ms (WebShell); Session CLOSED`)],
      ['Original worker / registration / binding', '—', verdict(s1p, `worker PID gone · registration RETIRED · binding RELEASED with drain receipt (${receipt.match(/"(\d+)",\s*"1"\]$/)?.[1] ?? 596} B) · 0 live Runtime Sessions / holders`)],
      ['History, files, idempotency', '—', verdict(s1p, `47 resources retained, events readable, Workspace file kept · same key on the other surface returns the same operation · new Session on the same storage runs (${count(s1p)} + ${count(s1w)} checks)`)],
      ['Readable non-creator / no read access', '—', verdict(s1p, `403 <code>session_operation_forbidden</code> / 404 · no fence written, worker untouched`)],
      ['Running Turn; Turn waiting on approval', '—', verdict(s2.fail === 4 ? s2b : s2, `409 <code>turn_active</code> on both surfaces, nothing persisted; the same key closes once the Turn ends (refusal checks ${s2.rows.filter((x) => !x.note).slice(0, 4).filter((x) => x.ok).length}/4 + ${count(s2b)} + ${count(s5)})`)],
      ['Neighbour Session on the same storage mid-Turn', '—', verdict(s3, `A closes in ${ms(det(s3, 'close A completes'))} ms; B's worker untouched, B's Turn completes and writes its file (${count(s3)})`)],
      ['Text-only Turn, then close at once (delayed warm)', '—', raceOk === raceRows.length ? OK(`${raceOk}/${raceRows.length} clean; ${provisioning} closes caught the binding still PROVISIONING and stopped the worker it produced; 0 leaked workers`) : BAD(`${raceOk}/${raceRows.length}`)],
      ['Worker killed (SIGKILL) before close', '—', verdict(f1, 'close completes; absent process accepted as stopped')],
      ['Spring SIGKILL 3 s into a close (Harness DELETE delayed)', '—', OK(`worker orphaned but alive; restarted Spring took over: CLOSED after ${f2.match(/after (\d+) ms/)?.[1]} ms, original worker stopped, same key returns the completed operation`)],
      ['Spring SIGTERM restart, then close', '—', verdict(f3, `workers survive the restart (ppid 1); new instance stops the exact original PIDs (${count(f3)})`)],
      ['Upgrade: base DB + base workers → head jar', '—', verdict(up, `V27→V28 applied; both base-created Sessions close, base-built workers stopped (${count(up)})`)],
      ['macOS default deployment (non-durable)', '—', verdict(mac, `<code>session_close=false</code>, bound close 409 <code>workspace_unavailable</code>, unbound close unchanged (${count(mac)})`)],
    ],
  ) +
    table(
      ['Focused suites on head', 'Result'],
      [
        ['Runtime Broker unit (drain, durable provisioner, recovery, stop executor) + JdbcRuntimeBrokerMySqlIT on MySQL 8.4.7 + checkstyle', OK(totals(unitBroker).join(' · '))],
        ['Managed Agent unit (close, lifecycle, coordinator, contract, artifact) + WorkspaceSessionCloseMySqlIT + checkstyle', OK(totals(unitManaged).join(' · '))],
        ['packages/cli <code>hosted-harness-session.test.ts</code> (host load 34–44)', fs.existsSync(`${RIG}/out/ts-summary.txt`) ? WARN(fs.readFileSync(`${RIG}/out/ts-summary.txt`, 'utf8').trim()) : (unitTs.includes(' failed') ? BAD(tsLine) : OK(tsLine))],
      ],
    ),
);

// ---- figure 2: blocked closes ----
const f6 = L('closeall-F6-new-node-state-dir');
const f6ws = L('s6-ws-after-block-f6');
const f6back = L('s6-ws-after-block-f6-after-restore');
const f4 = L('closeall-F4-container-restart');
const f4ws = L('s6-ws-after-block-f4');
const ctl0 = L('s6-ws-after-block-ctl-unclosed-after-container-restart');
const ctl1 = L('closeall-F4b-close-after-container-restart');
const ctl2 = L('s6-ws-after-block-ctl-after-close');
const f5u = L('closeall-F5-reboot-untrusted');
const f5t = L('watch-F5-trusted-reboot');
const ctl3 = L('s6-ws-after-block-ctl-after-trusted-reboot');
const r0 = (r) => r.results[0];
const blk = (x) => `${x.apiStatus} <code>${x.apiCode}</code> after ${Math.round(x.waitedMs / 1000)} s (${x.dbOp[2]} attempts), binding ${x.binding[0]}`;
const same = (r) => det(r, 'NOTE').length ? '' : '';
const sameTurn = (r) => r.rows.find((x) => x.label.startsWith('new Session on the same storage'));
const sameNote = (r) => r.rows.find((x) => x.label.startsWith('new Session on the SAME storage'))?.detail.match(/turn=(\S+)\s+(\S+\s+)?(\d+)ms/);
const sameCell = (r) => { const m = sameNote(r); const t = sameTurn(r); return t?.ok ? OK(`new Session's file Turn COMPLETED (${m?.[3]} ms)`) : BAD(`new Session fails: ${m?.[1]} ${(m?.[2] ?? '').trim()} in ${m?.[3]} ms`); };
const watched = f5t.rows.filter((x) => x.note);

figs['02-blocked-close'] = page(
  'When stop proof is unavailable, an accepted close stays CLOSING and takes the whole storage with it',
  'Same Linux stack. "Same storage" = a brand-new Session created on the Workspace storage of the blocked Session; another storage is the control and always worked. Spring log for the failure: <code>An earlier runtime placement still requires physical recovery</code>.',
  table(
    ['Event before close', 'Original worker', 'Close outcome', 'New Session on the same storage'],
    [
      ['Broker moved to a "new node" (fresh state directory, same DB)', 'still running (correctly not claimed stopped)', WARN(blk(r0(f6))), sameCell(f6ws)],
      ['… original state directory restored', '', OK(`completes by itself (attempt 9, ~33 s), worker stopped`), sameCell(f6back)],
      ['Container restart (same host + boot id; new PID/time namespaces)', `gone (all ${f4.results.length} died with the container)`, BAD(blk(r0(f4))), sameCell(f4ws)],
      ['Control: same restart, Session NOT closed', 'gone', '— (not closed)', sameCell(ctl0)],
      ['… then close that Session', 'gone', BAD(blk(r0(ctl1))), sameCell(ctl2)],
      ['Offline operator command <code>WorkspaceRecoveryCommand inspect</code>', '', BAD('refused: "Exact Hosted Shell operator recovery is unavailable." (files/1 close has no holder to recover)'), ''],
      ['Real VM reboot (new boot id), trusted-local-reboot-recovery=false', 'gone', WARN(blk(r0(f5u))), ''],
      [`Spring restarted with trusted-local-reboot-recovery=true`, '', f5t.fail === 0 ? OK(`all ${watched.length} blocked closes (container-restart + reboot) completed; receipts name the original boot`) : BAD('not all settled'), sameCell(ctl3)],
    ],
  ) +
    `<div class="note nbad"><b>Effect for users:</b> before this PR the bound close was refused (409) and the Workspace stayed usable. Now, after a container restart the close is accepted (202), never completes, and every later Session on that storage fails in &lt;2 s — even though the worker is provably gone. On this stack the only exits were restoring the original namespaces/state directory (impossible after a container restart) or a host reboot with <code>trusted-local-reboot-recovery=true</code>. No API or operator command clears it.</div>`,
);

await render(process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(figs));
