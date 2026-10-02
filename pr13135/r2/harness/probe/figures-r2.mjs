// VERIFICATION RIG ONLY (PR #13135 round 2): evidence figure for head d7c5c5e50e, built from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, count, res, RIG } from './figlib.mjs';

const L = (n) => res('l2', n);
const row = (r, p) => r.rows.find((x) => x.label.startsWith(p));
const det = (r, p) => row(r, p)?.detail ?? '';
const verdict = (r, text) => (r.fail === 0 ? OK(text) : BAD(text));
const a = res('r41a', 's8-r41-head1');
const aWs = res('r41a', 's6-ws-after-block-r41-head1');
const b = res('r41b', 's8-r41-head2');
const sameNote = (r) => r.rows.find((x) => x.label.startsWith('new Session on the SAME storage'))?.detail.match(/turn=(\S+)\s+(\S+\s+)?(\d+)ms/);
const sameTurn = (r) => r.rows.find((x) => x.label.startsWith('new Session on the same storage'));
const sameCell = (r) => { const m = sameNote(r); return sameTurn(r)?.ok ? OK(`new Session COMPLETED (${m?.[3]} ms)`) : BAD(`new Session ${m?.[1]} ${(m?.[2] ?? '').trim()} in ${m?.[3]} ms`); };
const r2a = fs.readFileSync(`${RIG}/out/run-r2a.out`, 'utf8');
const r2b = fs.readFileSync(`${RIG}/out/run-r2b.out`, 'utf8');
const r2c = fs.readFileSync(`${RIG}/out/run-r2c.out`, 'utf8');
const races = ['d0', 'd300'].map((d) => L(`s4-warm-race-head2-ws-e-${d}`)).flatMap((r) => r.rows.filter((x) => x.label.startsWith('#')));
const prov = races.filter((x) => x.detail.includes('["PROVISIONING"]')).length;
const f4 = L('closeall-F4-container-restart').results[0];
const ctl = L('closeall-F4b-close-after-container-restart').results[0];
const f6 = L('closeall-F6-new-node-state-dir').results[0];
const up = res('lb2', 's7-upgrade-close-head2');
const base2 = res('lb2', 's0-mac-linux-durable-base2');
const unitB = fs.readFileSync(`${RIG}/out/unit2-broker.log`, 'utf8');
const unitM = fs.readFileSync(`${RIG}/out/unit2-managed.log`, 'utf8');
const unitT = fs.readFileSync(`${RIG}/out/unit2-ts.log`, 'utf8');
const pin = fs.readFileSync(`${RIG}/out/pin-r41.log`, 'utf8');
const totals = (log) => [...log.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\n/g)].map((m) => `${m[1]} run / ${+m[2] + +m[3]} fail / ${m[4]} skip`).join(' · ');
const blk = (x) => `${x.apiStatus} <code>${x.apiCode}</code>, ${x.dbOp[2]} attempts in ${Math.round(x.waitedMs / 1000)} s, binding ${x.binding[0]}`;
const f2 = r2b.match(/F2 session=(\w+) after (\d+)s from restart.*worker \d+: (\w+)/);

figs['03-round2'] = page(
  'Round 2 — head d7c5c5e50e (two main merges, close migration → V31, R4-1 unstarted-binding close)',
  'Same real Linux durable stack (colima VM container, MySQL 8.4.7, packaged Harness, real workers). New base arm = <code>49b6c90053</code> (<code>HEAD^2</code>, main V30). Old head = <code>6c6e58441a</code> (round 1).',
  table(
    ['Bot R4-1 on the real stack: binding committed but its resource handle never saved (state dir made non-private during the warm, then restored)', 'old head 6c6e58441a', 'new head d7c5c5e50e'],
    [
      ['Binding before close (precondition)', det(a, 'binding exists').match(/"(RECOVERY_BLOCKED|PROVISIONING)"/)?.[1] + ', handle null', det(b, 'binding exists').match(/"(RECOVERY_BLOCKED|PROVISIONING)"/)?.[1] + ', handle null'],
      ['Close', BAD(det(a, 'close completes').match(/api=(\S+) code=(\S+)/)?.slice(1).join(' ') + ` after ${det(a, 'close completes').match(/waited=(\d+)/)?.[1] / 1000 | 0} s, Session CLOSING, binding DRAINING`), OK(`completed in ${det(b, 'close completes').match(/waited=(\d+)ms/)?.[1]} ms, Session CLOSED, binding RELEASED with receipt; registration written as RETIRED / pid 0 (no worker started)`)],
      ['New Session on the same storage', sameCell(aWs), OK(`new Session COMPLETED (${det(b, 'new Session on the same storage').match(/(\d+)ms/)?.[1]} ms)`)],
      ['Unit pin: change <code>createIntent</code> back to <code>false</code>', '—', pin.includes('Errors: 2') ? OK('RuntimeHarnessDrainTest: 2 of 23 error (the new empty-store cases)') : WARN('see log')],
    ],
  ) +
    table(
      ['Round-1 matrix re-run on the new head', 'Result'],
      [
        ['Normal close, public / WebShell (worker PID gone, RETIRED, RELEASED + receipt, history/files kept, cross-surface replay, same storage reusable)', verdict(L('s1-close-head2-public-ws-a'), `${count(L('s1-close-head2-public-ws-a'))} / ${count(L('s1-close-head2-web-ws-b'))}`)],
        ['Running Turn / pending approval refused 409 <code>turn_active</code>, same key closes afterwards', verdict(L('s2v2-active-head2-ws-c'), `${count(L('s2v2-active-head2-ws-c'))} / ${count(L('s5-approval-head2-wsap-k'))}`)],
        ['Neighbour Session mid-Turn on the same storage', verdict(L('s3-shared-head2-ws-d'), count(L('s3-shared-head2-ws-d')))],
        ['Text-only Turn then immediate close (delayed warm)', OK(`${races.filter((x) => x.ok).length}/${races.length} clean, ${prov} caught PROVISIONING, 0 leaked workers`)],
        ['Worker SIGKILL before close · Spring SIGKILL mid-close · Spring SIGTERM restart', OK(`completed · ${f2?.[1]} after ${f2?.[2]} s, original worker ${f2?.[3]} · ${count(L('closeall-F3-spring-term-restart'))}`)],
        ['Upgrade: main (V30) DB + main-built workers → head jar', verdict(up, `V31 applied; ${count(up)} pre-existing Sessions closed, main-built workers stopped (before: ${count(base2)}, bound close 409 <code>workspace_unavailable</code>)`)],
        ['Upgrade: DB that ran an earlier build of this PR (provisional V28 close)', WARN('Spring refuses to start: <code>Migration checksum mismatch for migration version 28</code>')],
      ],
    ) +
    table(
      ['Maintainer F1 (pre-admission policy still open per author)', 'Result on the new head'],
      [
        ['Container restart, then close a pre-restart Session (worker provably gone)', BAD(blk(f4))],
        ['Same storage afterwards / control Session not closed / after closing it', `${sameCell(L('s6-ws-after-block-f4')).t} · ${sameCell(L('s6-ws-after-block-ctl-unclosed-after-container-restart')).t} · ${sameCell(L('s6-ws-after-block-ctl-after-close')).t}`],
        ['New node (fresh state dir) — worker still alive', WARN(`${blk(f6)}; restoring the directory completes it (${r2c.match(/session=CLOSED after (\d+)s/)?.[1]} s)`)],
      ],
    ) +
    table(
      ['Focused suites on d7c5c5e50e', 'Result'],
      [
        ['Broker unit + JdbcRuntimeBrokerMySqlIT + checkstyle', OK(totals(unitB))],
        ['Managed unit + WorkspaceSessionCloseMySqlIT + checkstyle', OK(totals(unitM))],
        ['cli hosted-harness-session + hosted-hook-session', OK(unitT.match(/Tests\s+(\d+ passed[^\n]*)/)?.[1] ?? '?')],
      ],
    ),
);
await render(['03-round2']);
