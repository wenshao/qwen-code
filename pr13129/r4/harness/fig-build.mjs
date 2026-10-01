// VERIFICATION RIG ONLY (PR #13129): builds the four evidence figures from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, N, M, count, passed, lineChart, res, lx, RIG } from './figures.mjs';

const hk = (n) => res('hk', n);
const hkc = (n) => res('hkc', n);
const hk2 = (n) => res('hk2', n);
const note = (r, label) => r.rows.find((x) => x.label.startsWith(label))?.detail ?? '';

// ---------------------------------------------------------------- 01: F1 lease leak
const headT = hk('s2b-lease-head-ws-t9-yes-SIGTERM');
const noHook = hk('s2b-lease-head-ws-base2-no-SIGTERM');
const candT = hkc('s2b-lease-cand2-ws-t6-yes-SIGTERM');
const candK = hkc('s2b-lease-cand2-ws-t9-yes-SIGKILL');
const lxHead = lx('s2b-lease-head-ws-t1-yes-SIGTERM');
const lxNo = lx('s2b-lease-head-ws-base2-no-SIGTERM');
const lxCand = lx('s2b-lease-cand2-ws-t2-yes-SIGKILL');
const after = hk('s2c-after-after-spring-restart');
const del = hk('s2d-delete-ws-t9');
const reHead = hkc('s2e-reattach-head-ws-t6b');
const reNaive = hkc('s2e-reattach-cand-ws-t6');
const reCand = hkc('s2e-reattach-cand2-ws-t6b');
const ackHead = hk2('s5b-lost-head-ws-t9b');
const ackCand = hk2('s5b-lost-cand2-ws-t9c');
const lxAckHead = lx('s5b-lost-head-ws-t9b');
const lxAckCand = lx('s5b-lost-cand2-ws-t9e');
const cell = (r, label, yes = 'completes', no = 'hosted_turn_failed') => (passed(r, label) ? OK(yes) : BAD(no));
figs['01-f1-hook-lease'] = page(
  'F1 — a hook Runtime Session keeps the Workspace execution lease; a Harness replacement leaks it',
  'Real Spring server (Session Store + embedded Runtime Broker + spawned Tool Runtime) and packaged Hosted Harness. macOS: MySQL 8.4.7, head <code>8ffbbbb436</code>. Linux (colima, cgroup v2): MySQL 8.4.11, head <code>afe83cd828</code> (Hook code byte-identical). Session A has a Hook catalog; B is a plain Session in the same Workspace.',
  table(
    ['Step (same Workspace)', 'PR head, A with Hooks', 'PR head, A without Hooks', 'candidate v2 (+28 lines Harness)'],
    [
      ['A idle and attached → B runs a tool turn', cell(headT, 'B (no hooks'), cell(noHook, 'B (no hooks'), cell(candT, 'B (no hooks')],
      ['Harness SIGTERM → new Harness loads A → A runs a tool turn', cell(headT, 'A turn after cold load'), cell(noHook, 'A turn after cold load'), cell(candT, 'A turn after cold load')],
      ['… SIGKILL instead of SIGTERM', { c: 'bad', t: '✘ hosted_turn_failed (S1 cold load)' }, '—', cell(candK, 'A turn after cold load')],
      ['A detached on the new Harness → fresh plain Session runs a tool turn', cell(headT, 'a fresh no-hook'), cell(noHook, 'a fresh no-hook'), cell(candT, 'a fresh no-hook')],
      ['… after DELETE of the owning Session', passed(del, 'Workspace lease freed') ? OK('freed') : BAD('lease still held'), '—', OK('a head-made leak is freed once v2 loads the owner')],
      ['… after restarting Spring / the Broker', passed(after, 'ws-t1') ? OK('freed') : BAD('3 leaked Workspaces stay held (watched 4 min)'), OK('no-Hook Workspace usable'), '—'],
      ['Test plan 4: lost dispatch ack + cold reload → no duplicate effect', cell(ackHead, '(d) cold reload reconciles', 'one call, one callback'), '—', cell(ackCand, '(d) cold reload reconciles', 'one call, one callback')],
      ['… then the reconciled Session runs a tool turn', cell(ackHead, '(d) the reconciled Session'), '—', cell(ackCand, '(d) the reconciled Session')],
      ['detach → load → Hook turn, three rounds, then DELETE', { c: reHead.fail ? 'bad' : 'ok', t: `${count(reHead)}` }, '—', { c: reCand.fail ? 'bad' : 'ok', t: `${count(reCand)} (naive fixed id: ${count(reNaive)})` }],
      ['Linux replay: idle block / cold-load turn / plain Session after detach', BAD(`${['B (no hooks', 'A turn after cold load', 'a fresh no-hook'].map((l) => (passed(lxHead, l) ? '✔' : '✘')).join(' / ')}`), OK(`${['B (no hooks', 'A turn after cold load', 'a fresh no-hook'].map((l) => (passed(lxNo, l) ? '✔' : '✘')).join(' / ')}`), WARN(`${['B (no hooks', 'A turn after cold load', 'a fresh no-hook'].map((l) => (passed(lxCand, l) ? '✔' : '✘')).join(' / ')} (idle block unchanged)`)],
      ['Linux: lost ack + cold reload → next tool turn', cell(lxAckHead, '(d) the reconciled Session'), '—', cell(lxAckCand, '(d) the reconciled Session')],
    ],
  ) +
    `<div class="note nbad"><b>Mechanism.</b> <code>HostedHookSession</code> acquires its broker <code>hooks-&lt;randomUUID&gt;</code> on the first Hook and releases it only in <code>close()</code>; the lease row names that Runtime Session while A is idle (<code>${esc(note(headT, 'lease holder'))}</code>). A new Harness builds a new random broker and adopts old owners only for <i>unresolved</i> executions, so the settled owner is never released — unlike <code>HostedMcpSession</code>, which reuses its recorded owner. The Broker accepts <code>tool-sessions/&lt;old&gt;:release</code> from the new Harness (200 <code>released:true</code>, idempotent), which is what candidate v2 does on <code>ensureReady()</code>.</div>`,
);
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// ---------------------------------------------------------------- 02: F2/F3 long Session
const csv = fs
  .readFileSync(`${RIG}/run/hk2/s7-ws-t6.csv`, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => l.split(',').map(Number));
const lat = csv.map((r) => [r[3], r[1]]);
const sel = csv.map((r) => [r[3], r[2]]);
const s7 = hk2('s7-scale-ws-t6');
const load = hk2('s7c-load-089ae32a');
const load2 = hk2('s7c-load-dcaf3cbd');
const ms = (r) => (note(r, 'cold load').match(/^(\d+) ms/) ?? [])[1];
const first = csv[0];
const last = csv.at(-1);
const capAt = csv.find((r) => r[4] >= 4096);
figs['02-f2-f3-long-session'] = page(
  'F2 / F4 — one long Hook Session: per-operation Store cost grows with history; Hooks stop at 4096 receipts',
  `One Session, ${csv.length} Notification operations × 8 trusted function Hooks (fail-open), MySQL 8.4.7. Each point is one operation. <code>Com_select</code> is the MySQL global counter delta for that operation (measured idle background: ~13 SELECT/s, under 1% of any point).`,
  `<div class="charts"><div class="chart"><p class="t">Latency per 8-Hook operation (ms)</p>${lineChart(lat, { yLabel: 'ms' })}</div><div class="chart"><p class="t">MySQL SELECT statements per operation</p>${lineChart(sel, { yLabel: 'SELECT', yFmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v) })}</div></div>` +
    table(
      ['Measure', 'value'],
      [
        ['first operation (16 records) → last (' + last[3] + ' records)', M(`${first[1]} → ${last[1]} ms; SELECT ${first[2]} → ${last[2]}`)],
        ['dominant statement (performance_schema digest)', '<code>SELECT * FROM qwen_managed_session_resource WHERE session_scope_key = ? AND resource_id = ?</code> — Java <code>applyRevision</code> re-reads every earlier <code>hook_execution</code> resource of the Session for each new execution (once key / ordinal checks)'],
        ['Harness load time vs Hook history (records → ms)', M(`1 007 → 48 611 (detach+load) · 2 501 → ${ms(load2)} · 5 421 → ${ms(load)} (cold, new Harness); first operation after the 5 421 load: 5 733 ms`)],
                [`physical Hook calls: operation ${capAt?.[0] ?? '?'} reaches 4096, later operations`, M(`${esc(note(s7, 'physical handler calls'))} total — ops ${capAt?.[0]}-${last[0]} still return 200 but run nothing`)],
        ['fail-open PreToolUse guard (denies <code>blocked-*.txt</code>) before the cap', passed(s7, 'guard denies') ? OK('denied, not written') : BAD('?')],
        ['same guard after the cap', passed(s7, 'guard after the quota') ? OK('still denied') : BAD('policy bypassed: blocked-after.txt written, turn_complete, no error')],
        ['fail-closed guard after the cap', WARN('not driven to 4096 here; the cap returns the same refusal receipt as the 16-active limit, which S6 shows becomes a blocking aggregate under fail-closed → every guarded call would be refused')],
      ],
      'kv',
    ),
);

// ---------------------------------------------------------------- 03: test-plan coverage
const s1m = hk2('s1-permission');
const s1l = lx('s1-permission');
const s3m = hk2('s3-catalog-head');
const s3l = lx('s3-catalog-head');
const s4m = hk2('s4-prompt-head');
const s4l = lx('s4-prompt-head');
const s5m = hk2('s5-lost-head');
const s6m = hk2('s6-limits');
const s6b = hk2('s6-limits-bounds');
const s8 = hk2('s8-secrets');
const s9 = lx('s9-linux');
const s10h = hk2('s10-baseline-head');
const s10m = res('base', 's10-baseline-main');
const refusal = hk2('s9mac-refusal-ws-hv');
const pm = (r) => ({ c: r.fail ? 'warn' : 'ok', t: `${r.fail ? '▲' : '✔'} ${count(r)}` });
figs['03-coverage'] = page(
  'Reviewer test plan on the real stack',
  'Every scenario drives the packaged Harness over HTTP against the real Spring server and spawned Tool Runtime; physical effects are counted by the trusted handler ledger, a local HTTP endpoint, marker files or the command ledger. “▲” rows carry a finding listed underneath.',
  table(
    ['Test plan item', 'macOS · MySQL 8.4.7', 'Linux · MySQL 8.4.11', 'what failed'],
    [
      ['1 · PermissionRequest before PreToolUse, rewritten args re-approved, top-level ask always asks, context after tool, once after reload', pm(s1m), pm(s1l), 'F5: PreToolUse deny reason replaced by “No reason provided”'],
      ['2 · catalog replacement pins only future occurrences; failed once stays consumed; status/cancel dispatch nothing', pm(s3m), pm(s3l), '—'],
      ['3 · prompt Hook outside a turn, exclusive model owner, DELETE runs SessionEnd→SessionDelete, detach runs neither', pm(s4m), pm(s4l), '—'],
      ['4 · lost HTTP reply / partial body stay unknown, one request; 500 settles; lost dispatch ack reconciles once', pm(s5m), '(d) via Linux S5b', 'F1: the reconciled Session cannot run its next tool turn; an unknown outcome also blocks every other Session of the Workspace'],
      ['5 · 17 parallel Hooks vs 16-active limit, fail-open / fail-closed', pm(s6m), '—', '—'],
      ['5 · 70 KB receipt / 8×10 KB aggregate → bounded, replay without re-run', pm(s6b), '—', '—'],
      ['6 · Linux delegated cgroup v2: execute, detached descendant, TERM-ignoring child on cancel, deny, argv', '—', pm(s9), 'bot claim 1 confirmed (argv)'],
      ['refusal before effect (no cgroup / unknown handler revision) then continue', pm(refusal), '—', 'F3: Session never accepts another prompt'],
      ['public catalog: no recipe, credential, URL token, module path; other actor 404; DB dump', pm(s8), '—', 'prompt Hook text is stored (by design)'],
      ['no-Hook baseline: tool turn, ambient Legacy Hooks inert (main vs head)', pm(s10h), `main ${count(s10m)}`, '—'],
    ],
  ),
);

// ---------------------------------------------------------------- 04: Linux cgroup
const linuxUnit = fs.readFileSync(`${RIG}/lx/unit-core-linux.log`, 'utf8');
const linuxUnit2 = fs.readFileSync(`${RIG}/lx/unit-cli-linux.log`, 'utf8');
const argv = JSON.parse(fs.readFileSync(`${RIG}/lx/argv-probe.out`, 'utf8'));
const s99 = lx('s9-linux-99db');
const detach = JSON.parse(fs.readFileSync(`${RIG}/lx/detach-record.json`, 'utf8'));
figs['04-linux-cgroup'] = page(
  'Linux delegated cgroup v2: the path the PR could not run',
  'colima arm64 VM, privileged container with a private cgroup namespace, <code>QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/hooks</code> (type <code>domain</code>, <code>cgroup.kill</code> present). Conditional unit tests plus the full Hosted stack.',
  table(
    ['Check', 'result'],
    [
      ['core <code>hook-runner-managed-process.test.ts</code> (5 Linux-only cases)', OK((linuxUnit.match(/Tests\s+(\d+ passed[^\n]*)/) ?? [])[1] ?? '?')],
      ['cli <code>managed-hook-runtime.test.ts</code> (4 Linux-only cases)', OK((linuxUnit2.match(/Tests\s+(\d+ passed[^\n]*)/) ?? [])[1] ?? '?')],
      ['stack: PreToolUse command runs in <code>/hooks/qwen-hook-&lt;uuid&gt;</code>, context reaches the model', passed(s9, 'A: PreToolUse command') ? OK(esc(note(s9, 'A: PreToolUse command').match(/cgroup=\S+/)?.[0] ?? '')) : BAD('')],
      ['stack: <code>setsid … sleep 300 &amp;</code> left by a UserPromptSubmit hook', passed(s9, 'A: detached') ? OK('descendant killed with the unit; no unit left behind') : BAD('')],
      ['… its receipt', WARN(`${detach.run.state}: outcome timeout after ~4.9 s, success=false — the hook printed valid JSON and exited at once; legacy runner would return success`)],
      ['stack: cancel a command whose child ignores SIGTERM', passed(s9, 'C: cancel drains') ? OK(esc(note(s9, 'C: cancel drains').match(/settled=\S+ \S+ms/)?.[0] ?? 'drained')) : BAD('')],
      ['stack: command PreToolUse deny', passed(s9, 'B: command') ? OK('write prevented (model sees “No reason provided”, F5)') : BAD('')],
      ['bot claim 1 at <code>afe83cd828</code>: recipe <code>env</code> on the launcher argv', BAD(`uid 65534 reads ${esc(argv.readAsNobody_cmdlineArgsWithSecret[0])} from /proc/${argv.launcherPid}/cmdline (owner ${argv.launcherOwner}); /proc/…/environ: permission denied`)],
      ['at <code>99db6e527e</code> (argv fix): same stack probe', s99.fail === 0 ? OK(`${count(s99)} — ${esc(note(s99, 'D: recipe env is NOT').replace(/ op=200$/, ''))}`) : BAD(count(s99))],
      ['at <code>99db6e527e</code>: core cgroup + launcher tests on Linux', OK((fs.readFileSync(`${RIG}/lx/unit-core-linux-99db.log`, 'utf8').match(/Tests\s+(\d+ passed[^\n]*)/) ?? [])[1] ?? '?')],
    ],
  ),
);

await render(process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(figs));
