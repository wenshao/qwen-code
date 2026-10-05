// PR #13265 round 9 cards for the final head 5986e18d3f, rendered from this round's logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${SP}/wt-pr16/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 9 · final head 5986e18d3f (ce870e6920 + a merge of main touching only an unrelated ACP fix and one test file) · Linux: 192.168.0.75 (kernel 6.6.89, cgroup v2), exact dist bundled per build · macOS: jars + native MySQL 8.4.7 · fixture probes inside the PR\'s own tests';
const load = (dir, f) => JSON.parse(fs.readFileSync(`${R5}/${dir}/${f}`, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const line = (file, tag) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`[${tag}]`)).map((l) => l.replace(/^.*?\[[A-Za-z0-9-]+\]\s*/, ''));

// .75
const old = { l1: load('out75-r9', 'l1-head9.log'), l14: load('out75-r9', 'l14-head9.log'), l19: load('out75-r9', 'l19-head9.log'), l15b: load('out75-r9b', 'l15b-head9.log'), stop: load('out75-r9b', 'l19-head9-stop.log') };
const head = { l1: load('out75-r9b', 'l1-head10.log'), l13: load('out75-r9b', 'l13-head10.log'), l14: load('out75-r9b', 'l14-head10.log'), l15b: load('out75-r9b', 'l15b-head10.log'), l19: load('out75-r9b', 'l19-head11.log'), l20: load('out75-r9b', 'l20-head11.log') };
const fix = { l1: load('out75-r9b', 'l1-fixr10.log'), l13: load('out75-r9b', 'l13-rest10.log'), l14: load('out75-r9b', 'l14-fixr10.log'), l15b: load('out75-r9b', 'l15b-fixr10.log'), stop: load('out75-r9b', 'l19-fixr10-stop.log') };
const raceOnly = load('out75-r9b', 'l19-fix10-stop.log');
const rt = (r) => {
  const a = Object.values(r.routeTerminate).flatMap((x) => Object.entries(x.answers).filter(([k]) => !k.startsWith('status')));
  const total = a.reduce((n, [, c]) => n + c, 0);
  const errors = a.filter(([k]) => k.startsWith('error')).reduce((n, [, c]) => n + c, 0);
  const sig = a.find(([k]) => k.startsWith('exited'))?.[0];
  return errors ? `ENOENT error ${errors}/${total}` : `${sig?.includes('SIGTERM') ? 'exited {SIGTERM}' : sig} ${total}/${total}`;
};
const statusAfter = (r) => Object.values(r.routeTerminate).map((x) => x.answers['status exited'] ?? 0).reduce((a, b) => a + b, 0);
const term = (x) => (x?.error ? 'ENOENT error' : `${x?.state} ${JSON.stringify(x?.evidence ?? '')}`);
const mib = (m) => `${(m.stdoutBytes / 1048576).toFixed(0)}/256 MiB`;

// Broker, real stack, mutants
const PROBES = `${SP}/rig9/broker-probes-ce87.log`;
const j1 = JSON.parse(line(PROBES, 'R5-J1')[0]);
const j3 = line(PROBES, 'R6-J3');
const j4 = JSON.parse(line(PROBES, 'R7-J4')[0]);
const j5 = JSON.parse(line(PROBES, 'R9-J5')[0]);
const j6 = JSON.parse(line(PROBES, 'R9-J6')[0]);
const j6b = JSON.parse(line(PROBES, 'R9-J6b')[0]);
const s13 = JSON.parse(line(`${SP}/rig9/out/s13-b957.stdout`, 'RESULT')[0]);
const s14 = JSON.parse(line(`${SP}/rig9/out/s14.stdout`, 'RESULT')[0]);
const mut = Object.fromEntries(JSON.parse(fs.readFileSync(`${SP}/rig9/mutants-final/summary.json`, 'utf8')).map((m) => [m.id, m]));
const m5 = fs.readFileSync(`${SP}/rig9/mutants-final/M5-lineage-by-revision.txt`, 'utf8');
const turn = JSON.parse(line(`${SP}/rig9/out/turn-probe-ce87.log`, 'R6-TURN')[0]);
const cards = {};

{
  const body = `
${table(['since round 8', 'what it says it fixes'], [
    ['47a14bc9fe', 'the reconcile resume settles the :process row with the same not_started proof as the dispatch poll'],
    ['e2b401f53e · fecfb78ded', 'refused finalizes can be retried; ownerless watch tails commit · wake turns re-read busy(); receipts never follow a Monitor input'],
    ['b18571e172 · 4b339c9140', 'merge of main 9766e72234 (OpenAPI v1.31.0, WebShell types gain 401/413) · task journal renumbered V40 → V41'],
    ['2dea416b51 · c9009271dc · 370d933332', 'wake recovery classified by type · refused background settle re-driven by publisher.settleAttached · HTTP-store fixtures opt in'],
    ['a0fd230579', 'publication mode owns a background capture lane, so the re-drive runs in production'],
    ['2a3688d703', 'H7b/H5: a natural end settles only once the unit is empty'],
    ['b95765da88 · ce870e6920', 'output advances only along the same capture\'s lineage · the Broker v3 gate and the worker admit the native Monitor payload'],
    ['5986e18d3f', 'merge of main (unrelated ACP fix; HTTP-store fixtures resolved to main\'s loopback form)'],
  ])}
${table(['check', 'result'], [
    ['CI at 5986e18d3f', { t: '__CI__', cls: '__CICLS__' }],
    ['Java runtime-broker clean verify + MySQL ITs at ce870e6920', { t: '654 unit (1 skipped) + 7 ITs · SpotBugs 0 · Checkstyle 0', cls: 'ok' }],
    ['Java managed-agent-server (unchanged since 4b339c9140)', { t: '4b339c9140: 732 (1 skipped) · 52/52 ITs · Checkstyle 0 · SpotBugs 0. ce870e6920: one "claim expired" error in ToolPublicationStoreTest at load ~20; the class passes 85/85 twice alone', cls: 'ok' }],
    ['TS at ce870e6920: cli (22 files) · core (managed-runtime + cgroup)', { t: 'cli 1481/1482 (one takeover-family case) · core 2082/2082 · HTTP store 34/34 at 5986e18d3f', cls: 'ok' }],
    ['harness takeover family, whole file ×3 per head', { t: '4b339c9140: 5 failures · 12916c3b85: 4 — a different case each run, every one passes alone; CI passes them', cls: 'warn' }],
    ['merges b18571e172 · 5986e18d3f (remerge-diff)', { t: 'OpenAPI info block + regenerated WebShell types · the HTTP-store test takes main\'s loopback baseUrl instead of the PR\'s opt-in (34/34)', cls: 'ok' }],
    ['Flyway', { t: 'fresh schema V1–V41 · upgrade from main\'s V40: V41 adds the 2 task-journal tables · a schema that ran an earlier build of this PR refuses: checksum mismatch for version 40', cls: 'warn' }],
  ])}`;
  cards['r9-01-status'] = page('Round 9: most open items closed — and the stop route now fails', 'Twelve commits and two merges since round 8; the head moved six times during the round', body, FOOT);
}

{
  const body = `
${table(['192.168.0.75 · shell-terminate on a running background Shell', '4b339c9140', '5986e18d3f (worker = ce870e6920)', '+ terminate-race fix only', '+ race fix + H3/H4 edits'], [
    ['route answer: sleep 3198 ×10 · sleep 3199; true ×10', { t: rt(old.stop), cls: 'ok' }, { t: rt(head.l19), cls: 'bad' }, { t: rt(raceOnly), cls: 'ok' }, { t: rt(fix.stop), cls: 'ok' }],
    ['shell-status afterwards · units left', { t: `exited ${statusAfter(old.stop)}/20 · 0`, cls: 'ok' }, { t: `exited ${statusAfter(head.l19)}/20 · 0`, cls: 'ok' }, { t: `exited ${statusAfter(raceOnly)}/20 · 0`, cls: 'ok' }, { t: `exited ${statusAfter(fix.stop)}/20 · 0`, cls: 'ok' }],
    ['stop a setsid daemon · a pipe-holding child', { t: 'n/a (settled at exit)', cls: 'mut' }, { t: `${term(head.l19.setsidDaemon.terminate)} · ${term(head.l19.childHoldsPipes.terminate)}`, cls: 'bad' }, { t: `${term(raceOnly.setsidDaemon.terminate)} · ${term(raceOnly.childHoldsPipes.terminate)}`, cls: 'ok' }, { t: `${term(fix.stop.setsidDaemon.terminate)} · ${term(fix.stop.childHoldsPipes.terminate)}`, cls: 'ok' }],
    ['registry.terminate after a drain (probe cleanup)', { t: old.stop.drain.keepCleanup, cls: 'ok' }, { t: 'ENOENT', cls: 'bad' }, { t: raceOnly.drain.keepCleanup, cls: 'ok' }, { t: fix.stop.drain.keepCleanup, cls: 'ok' }],
    ['L7 registry.terminate, TERM-ignoring child: evidence', { t: JSON.stringify(old.l1.L7.evidence), cls: 'bad' }, { t: JSON.stringify(head.l1.L7.evidence), cls: 'bad' }, { t: 'not run', cls: 'mut' }, { t: JSON.stringify(fix.l1.L7.evidence), cls: 'ok' }],
  ])}
<div class="note">Mechanism. settleOnEmpty (managed-child-run-supervisor.ts:104) polls the unit and removes it the moment it empties. A terminate already waiting on the same unit (hook-command-cgroup.ts:199) then reads a missing cgroup.events as "not empty" (empty(), :157), runs out its 5 s grace and writes cgroup.kill into the removed directory: ENOENT. The route answers 409 managed_shell_unavailable; the Broker's release sweep (RuntimeBrokerService.java:1715) drops the chain on that failure, so that release answers runtime_session_busy until a later one reads the exited status. The candidate fix lets terminate (supervisor :89) answer the evidence when the natural end settled first.</div>`;
  cards['r9-02-stop-route'] = page('New since 2a3688d703: stopping a running background Shell answers an error', 'The process does stop, but the stop route throws ENOENT on every attempt; measured 20/20 on the same host, with a one-block fix measured beside it', body, FOOT);
}

{
  const body = `
${table(['192.168.0.75, exact dist', '4b339c9140 (round-9 head)', '5986e18d3f (supervisor/cgroup = 2a3688d703)', '+ race fix + H3/H4 edits'], [
    ['H1 named units · H2 fast starts ×90', { t: `${old.l1.L5.attached ? 'ok' : 'no attach'} · 90/90`, cls: 'ok' }, { t: `${head.l1.L5.attached ? 'ok' : 'no attach'} · ${Object.values(head.l13).map((v) => v.started).reduce((a, b) => a + b, 0)}/90`, cls: 'ok' }, { t: `${fix.l1.L5.attached ? 'ok' : 'no attach'} · ${Object.values(fix.l13).map((v) => v.started).reduce((a, b) => a + b, 0)}/90`, cls: 'ok' }],
    ['H3 terminate(500), TERM-ignoring member ×20', { t: `null ${old.l14.L14.nullEvidence}/20, ${old.l14.L14.unitLeft} units left`, cls: 'bad' }, { t: `null ${head.l14.L14.nullEvidence}/20, ${head.l14.L14.unitLeft} units left`, cls: 'bad' }, { t: `evidence ${fix.l14.L14.evidence}/20, ${fix.l14.L14.unitLeft} left`, cls: 'ok' }],
    ['H4 kill -KILL $$ · kill -SEGV $$', { t: `exit ${old.l1.L4_selfkill.exitCode} · exit ${old.l1.L4_segv.exitCode}`, cls: 'bad' }, { t: `exit ${head.l1.L4_selfkill.exitCode} · exit ${head.l1.L4_segv.exitCode}`, cls: 'bad' }, { t: `${fix.l1.L4_selfkill.exitSignal} · ${fix.l1.L4_segv.exitSignal}`, cls: 'ok' }],
    ['H5/H7b daemon inherits pipes: while alive · after it ends', { t: `settled at ${old.l15b.daemonInheritsPipes.during.settledAfterMs} ms, live ${old.l15b.daemonInheritsPipes.during.liveMembers}, exit 0 · unit dir left`, cls: 'bad' }, { t: `hold kept, no evidence · settled ${head.l15b.daemonInheritsPipes.after.settledMsAfterMemberEnd} ms after, unit removed`, cls: 'ok' }, { t: `same (${fix.l15b.daemonInheritsPipes.after.settledMsAfterMemberEnd} ms)`, cls: 'ok' }],
    ['H5/H7b setsid daemon, pipes closed', { t: `settled at ${old.l15b.setsidClosedPipes.during.settledAfterMs} ms with ${old.l15b.setsidClosedPipes.during.liveMembers} live`, cls: 'bad' }, { t: `hold kept · settled ${head.l15b.setsidClosedPipes.after.settledMsAfterMemberEnd} ms after the member ends`, cls: 'ok' }, { t: `same (${fix.l15b.setsidClosedPipes.after.settledMsAfterMemberEnd} ms)`, cls: 'ok' }],
    ['G5b writer outlives the launcher (256 MiB)', { t: `${old.l19.bpAfterLauncherExit.manifest.captureStatus} ${mib(old.l19.bpAfterLauncherExit.manifest)} · ${old.l19.bpAfterLauncherExit.manifest.executionStatus}`, cls: 'bad' }, { t: `${head.l19.bpAfterLauncherExit.manifest.captureStatus} ${mib(head.l19.bpAfterLauncherExit.manifest)}, digest ${head.l19.bpAfterLauncherExit.digestOk ? 'ok' : 'bad'}`, cls: 'ok' }, { t: 'not re-run', cls: 'mut' }],
    ['Monitor hold · output byte-true · fast-exit end', { t: 'holds; 0 U+FFFD; onExit fires', cls: 'ok' }, { t: `hasActiveSession ${head.l19.monHold.during.hasActiveSession} · ${head.l19.monUtf8.linesWithReplacementChar} U+FFFD · onExit ×${head.l20.exit7.exits}`, cls: 'ok' }, { t: 'not re-run', cls: 'mut' }],
  ])}
<div class="note">H7b/H5 and G5b are fixed by 2a3688d703 on bare metal. H3/H4 still need the two round-3 edits — and at this head the H3 edit only returns evidence together with the terminate-race fix (card 2, L7). L15b is a new probe; L19 and L15 now bound their waits, since a launcher that leaves a live member no longer ends.</div>`;
  cards['r9-03-linux'] = page('Exact-head Linux acceptance: H7b/H5 and G5b fixed; H3/H4 open', 'The supervisor probes, the real executor and the new L15b hold probe on 192.168.0.75', body, FOOT);
}

{
  const s14row = (k) => `${s14[k].advances} forwards ${JSON.stringify(s14[k].revisionsForwarded)}, ${s14[k].advanceRefusals} refused, finalize ${s14[k].finalize}, ${s14[k].manifest?.captureStatus}`;
  const body = `
${table(['Broker fixture at ce870e6920 · real stack · mutants', 'outcome', 'verdict'], [
    ['J4 · J5 · J6b — not_started on the dispatch poll, before start, and racing a parked start', { t: `:process ${j4.processRow} · ${j5.processRow} (no dispatch) · ${j6b.processRow}; releases succeed` }, { t: 'settles', cls: 'ok' }],
    ['reconcile arm (47a14bc9fe) · mutant dropping its sibling settle', { t: 'the PR witness passes · killed by exactly reconcileOfAnUnansweredBackgroundSettlesTheProcessRowWithTheSameProof (1 of 150)' }, { t: 'pinned', cls: 'ok' }],
    ['J6 · same race, the Runtime never answers · J1 live Shell', { t: `${j6.invocation}, :process ${j6.processRow}, busy · ${j1.release}` }, { t: 'by design', cls: 'mut' }],
    ['J3 · native Monitor payload at the v3 gate (ce870e6920)', { t: j3.find((x) => x.startsWith('r6Monitor')).replace('r6MonitorPayloadAtTheV3Gate: ', '') }, { t: 'fixed', cls: 'ok' }],
    ['S13 · refused finalize, then attach + settleAttached (b95765da88)', { t: `Shell ${s13.shellRedrive.afterAttach.replace(' outputRef=set', '')}, Java ${s13.shellRedrive.javaAfterAttach} · Monitor obs 1/notified 1, lines ${JSON.stringify(s13.monitorRedrive.observedLines)} · control stays running` }, { t: 'works', cls: 'ok' }],
    ['M1/M2 · drop settleAttached / the publication lane (a0fd230579)', { t: `${mut['M1-no-settleAttached'].tally} · ${mut['M2-no-publication-lane'].tally} — killed by "registers the Session capture lane for a background turn in publication mode"` }, { t: 'pinned', cls: 'ok' }],
    ['S14 · the lineage rule under real publisher writes (b95765da88)', { t: `sequential: ${s14row('sequential')} · 16+16 MiB concurrent: ${s14row('concurrentLarge')}` }, { t: 'no refusals', cls: 'ok' }],
    ['M5 · funnels back on "any higher revision"', { t: `${(m5.match(/^\s+Tests\s+.*$/m) ?? [''])[0].trim()} — killed by the two "refuses output outside its capture lineage" witnesses` }, { t: 'pinned', cls: 'ok' }],
    ['M4 · natural end settles on the root exit again (2a3688d703)', { t: `${mut['M4-h7b-settle-on-root-exit'].tally} — killed by "supervises a natural end until its unit proves empty"` }, { t: 'pinned', cls: 'ok' }],
    ['M3 · Session wiring of needsRecovery back on cause.name', { t: 'wake + harness: no deterministic failure (a takeover case fails only under one test filter, and passes 3/3 alone with the mutant)' }, { t: 'unpinned', cls: 'warn' }],
  ])}`;
  cards['r9-04-broker-stack'] = page('Broker, real stack and mutants: the new fixes hold and are pinned, except the wake wiring', 'Fixture probes in the PR\'s own RuntimeBrokerServiceTest; S13/S14 over the HTTP store (Spring + MySQL 8.4.7) with the production toolResultResources', body, FOOT);
}

{
  const body = `
${table(['open item', 'evidence at this head', 'status'], [
    ['Stop route fails since 2a3688d703', { t: 'shell-terminate on a running background Shell: 409 managed_shell_unavailable (ENOENT on cgroup.kill) 20/20; the first release after it answers busy. One-block fix measured (card 2)' }, { t: 'new, blocking', cls: 'bad' }],
    ['H3 · H4', { t: `null ${head.l14.L14.nullEvidence}/20 · exit 1 for SIGKILL/SIGSEGV; the two round-3 edits fix both, now together with the race fix` }, { t: 'open', cls: 'bad' }],
    ['Wake-recovery wiring', { t: 'behaviour correct; the witness keeps its own copy of the predicate, so the Session wiring (hosted-harness-session.ts:1823) is not pinned' }, { t: 'suggestion', cls: 'warn' }],
    ['H9', { t: `turn rig: finish ${turn.finish}, broker.release ×${turn.releaseCallsAtFinish} after a background admission (hosted-workspace-tool-turn.ts:2809)` }, { t: 'deferred', cls: 'bad' }],
    ['Monitor remote stop · review item 4', { t: 'HostedMonitorRemoteExecutor.terminate is still Promise.resolve() · dual-stream storage_failed stays on the author\'s ledger' }, { t: 'deferred', cls: 'bad' }],
    ['Closed this round', { t: 'reconcile settle · re-drive wiring · H7b/H5 · G5b · cross-capture forwards · Monitor v3 gate · main\'s red lane' }, { t: 'fixed', cls: 'ok' }],
  ])}`;
  cards['r9-05-open'] = page('Still open at 5986e18d3f', 'Measured here unless noted', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.rmSync(`${SP}/figs/out9b`, { recursive: true, force: true });
fs.mkdirSync(`${SP}/figs/out9b`, { recursive: true });
for (const [name, html0] of Object.entries(cards)) {
  const html = html0.replace('__CI__', esc(process.env.CI_TEXT ?? 'pending')).replace('__CICLS__', process.env.CI_CLS ?? 'warn');
  if (/__[A-Z]+__/.test(html)) throw new Error(`placeholder left in ${name}`);
  fs.writeFileSync(`${SP}/figs/out9b/${name}.html`, html);
  await pg.setContent(html);
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out9b/${name}.png` });
  console.log(name, 'ok');
}
await browser.close();
