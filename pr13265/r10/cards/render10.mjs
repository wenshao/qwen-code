// PR #13265 round 10 cards (head edcbe0e537), rendered from this round's logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${SP}/wt-pr18/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 10 · head edcbe0e537 (5986e18d3f + five TS commits; Java unchanged) · Linux: 192.168.0.75 (kernel 6.6.89, cgroup v2), exact dist bundled per build · macOS: jar + native MySQL 8.4.7 · mutants in local worktrees, restored afterwards';
const load = (f) => JSON.parse(fs.readFileSync(`${R5}/${f}`, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const line = (file, tag) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`[${tag}]`)).map((l) => l.replace(/^.*?\[[A-Za-z0-9-]+\]\s*/, ''));
const prev = { l1: load('out75-r9b/l1-head10.log'), l14: load('out75-r9b/l14-head10.log'), l15b: load('out75-r9b/l15b-head10.log'), l19: load('out75-r9b/l19-head11.log') };
const head = { l1: load('out75-r10/l1-head12.log'), l13: load('out75-r10/l13-head12.log'), l14: load('out75-r10/l14-head12.log'), l15b: load('out75-r10/l15b-head12.log'), l19: load('out75-r10/l19-head12.log'), l20: load('out75-r10/l20-head12.log') };
const rest = { l1: load('out75-r10/l1-rest12.log'), l13: load('out75-r10/l13-rest12.log'), l14: load('out75-r10/l14-rest12.log'), l15b: load('out75-r10/l15b-rest12.log'), l19: load('out75-r10/l19-rest12.log') };
const rt = (r) => {
  const a = Object.values(r.routeTerminate).flatMap((x) => Object.entries(x.answers).filter(([k]) => !k.startsWith('status')));
  const total = a.reduce((n, [, c]) => n + c, 0);
  const errors = a.filter(([k]) => k.startsWith('error')).reduce((n, [, c]) => n + c, 0);
  return errors ? `ENOENT ${errors}/${total}` : `exited {SIGTERM} ${total}/${total}`;
};
const term = (x) => (x?.error ? 'ENOENT' : x?.state);
const h90 = (x) => Object.values(x).map((v) => v.started).reduce((a, b) => a + b, 0);
const mut = Object.fromEntries(JSON.parse(fs.readFileSync(`${SP}/rig9/mutants-r10/summary.json`, 'utf8')).map((m) => [m.id, m]));
const s13 = JSON.parse(line(`${SP}/rig9/out/s13-r10.stdout`, 'RESULT')[0]);
const s14 = JSON.parse(line(`${SP}/rig9/out/s14-r10.stdout`, 'RESULT')[0]);
const cards = {};

{
  const body = `
${table(['since round 9', 'what it says it fixes'], [
    ['581578466b', 'v3 admission gates prove, refuse and resume correctly; background/monitor validated by their own admission'],
    ['be54aabf54', 'pending-turn count ignores monitor inputs; overlong partial lines force-emit; resumes register'],
    ['058ff3a152', 'the stop route answers the natural end\'s evidence when that settle won the race (round-9 regression)'],
    ['9fca22b76e', 'foreground and background captures pick their own funnel (the concurrent review\'s mixed-batch conflict)'],
    ['edcbe0e537', 'Monitor enabled on the publication lane: monitors, wake scheduler, admission and loops'],
  ])}
${table(['check', 'result'], [
    ['CI at edcbe0e537', { t: '__CI__', cls: 'ok' }],
    ['TS: cli (22 files) · core (managed-runtime + cgroup)', { t: 'cli 1491/1491 · core 2081/2083 (both hook-scale timeouts; the file passes 6/6 alone)', cls: 'ok' }],
    ['Java', { t: 'unchanged since ce870e6920 (broker: 654 + 7 ITs) and 4b339c9140 (server: 732 + 52/52 ITs)', cls: 'ok' }],
    ['S13 · S14 on the real stack', { t: `re-drive settles Shell (Java ${s13.shellRedrive.javaAfterAttach}) and Monitor (lines ${JSON.stringify(s13.monitorRedrive.observedLines)}); lineage forwards ${JSON.stringify(s14.concurrentLarge.revisionsForwarded)} with 0 refusals at 16+16 MiB concurrent`, cls: 'ok' }],
  ])}`;
  cards['r10-01-status'] = page('Round 10: the stop-route regression is fixed on bare metal', 'Five commits since round 9, and the checks on edcbe0e537', body, FOOT);
}

{
  const body = `
${table(['192.168.0.75, exact dist', 'round-9 head (ce870e6920)', 'edcbe0e537', '+ the two round-3 edits'], [
    ['shell-terminate on running Shells (sleep ×10, sleep; true ×10)', { t: rt(prev.l19), cls: 'bad' }, { t: rt(head.l19), cls: 'ok' }, { t: rt(rest.l19), cls: 'ok' }],
    ['stop a setsid daemon · a pipe-holding child · cleanup after drain', { t: `${term(prev.l19.setsidDaemon.terminate)} · ${term(prev.l19.childHoldsPipes.terminate)} · ENOENT`, cls: 'bad' }, { t: `${term(head.l19.setsidDaemon.terminate)} · ${term(head.l19.childHoldsPipes.terminate)} · ${head.l19.drain.keepCleanup}`, cls: 'ok' }, { t: `${term(rest.l19.setsidDaemon.terminate)} · ${term(rest.l19.childHoldsPipes.terminate)} · ${rest.l19.drain.keepCleanup}`, cls: 'ok' }],
    ['H3 terminate(500), TERM-ignoring member ×20', { t: `null ${prev.l14.L14.nullEvidence}/20`, cls: 'bad' }, { t: `null ${head.l14.L14.nullEvidence}/20, ${head.l14.L14.unitLeft} units left`, cls: 'bad' }, { t: `evidence ${rest.l14.L14.evidence}/20, ${rest.l14.L14.unitLeft} left`, cls: 'ok' }],
    ['H3 L7 registry.terminate, TERM-ignoring child', { t: JSON.stringify(prev.l1.L7.evidence), cls: 'bad' }, { t: JSON.stringify(head.l1.L7.evidence), cls: 'bad' }, { t: JSON.stringify(rest.l1.L7.evidence), cls: 'ok' }],
    ['H4 kill -KILL $$ · kill -SEGV $$', { t: `exit ${prev.l1.L4_selfkill.exitCode} · exit ${prev.l1.L4_segv.exitCode}`, cls: 'bad' }, { t: `exit ${head.l1.L4_selfkill.exitCode} · exit ${head.l1.L4_segv.exitCode}`, cls: 'bad' }, { t: `${rest.l1.L4_selfkill.exitSignal} · ${rest.l1.L4_segv.exitSignal}`, cls: 'ok' }],
    ['H7b/H5 L15b: hold while the member lives · settle after it ends', { t: 'kept · settles', cls: 'ok' }, { t: `${head.l15b.daemonInheritsPipes.during.holdKept ? 'kept' : 'released'} · ${head.l15b.daemonInheritsPipes.after.settledMsAfterMemberEnd} ms, unit removed`, cls: 'ok' }, { t: `${rest.l15b.daemonInheritsPipes.during.holdKept ? 'kept' : 'released'} · ${rest.l15b.daemonInheritsPipes.after.settledMsAfterMemberEnd} ms`, cls: 'ok' }],
    ['G5b writer outlives the launcher · H1/H2 · Monitor', { t: 'complete 256/256 · ok 90/90 · holds', cls: 'ok' }, { t: `${head.l19.bpAfterLauncherExit.manifest.captureStatus} ${(head.l19.bpAfterLauncherExit.manifest.stdoutBytes / 1048576).toFixed(0)}/256 · ok ${h90(head.l13)}/90 · onExit ×${head.l20.exit7.exits}`, cls: 'ok' }, { t: `${rest.l19.bpAfterLauncherExit.manifest.captureStatus} · ok ${h90(rest.l13)}/90`, cls: 'ok' }],
  ])}
<div class="note">With 058ff3a152 in the head, the two round-3 edits alone now fix H3 and H4: the third column is identical, field for field, to round 9's head + race fix + edits build.</div>`;
  cards['r10-02-linux'] = page('Exact-head Linux acceptance: the stop route answers again; H3/H4 need only the two edits', 'The supervisor probes, L15b and the real executor on 192.168.0.75', body, FOOT);
}

{
  const body = `
${table(['mutant (site edited)', 'tests run', 'result'], [
    ['M6 · supervisor terminate without the new settled guard (managed-child-run-supervisor.ts)', { t: `${mut['M6-no-stop-race-guard'].tally} — "${mut['M6-no-stop-race-guard'].failed[0]?.split(' > ').pop()}"` }, { t: 'killed', cls: 'ok' }],
    ['M4 · natural end settles on the root exit (managed-background-shell-registry.ts)', { t: `${mut['M4-h7b-settle-on-root-exit'].tally} — "${mut['M4-h7b-settle-on-root-exit'].failed[0]?.split(' > ').pop()}"` }, { t: 'killed', cls: 'ok' }],
    ['M3 · the value hosted-harness-session.ts:1846 passes as needsRecovery, by cause.name', { t: `${mut['M3-session-needsRecovery-by-name'].tally} over wake + harness + tool-turn; its one failure (settles the parked execution…) passes alone 3/3 with the mutant; two more whole-file runs under the mutant failed a different takeover-family case each (re-answers…, refuses continue…)` }, { t: 'survives', cls: 'warn' }],
  ])}
<div class="note">Why M3 survives: the wake witnesses build the run-turn with their own copy of the predicate (hosted-monitor-wake.test.ts:35, passed at :379/:418/:452/:485) and real exception instances. That pins how createMonitorWakeRunTurn uses whatever predicate it is given — not the value the Session injects. Exporting one predicate and importing it in both places, or driving one recovery error through the Session, would pin it.</div>`;
  cards['r10-03-mutants'] = page('Mutants: the stop-race guard and H7b are pinned; the Session\'s needsRecovery value is not', 'Each mutant applied to a local worktree of edcbe0e537 and restored; git diff clean after each', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.rmSync(`${SP}/figs/out10`, { recursive: true, force: true });
fs.mkdirSync(`${SP}/figs/out10`, { recursive: true });
for (const [name, html0] of Object.entries(cards)) {
  const html = html0.replace('__CI__', esc(process.env.CI_TEXT ?? 'pending'));
  if (/__[A-Z]+__/.test(html)) throw new Error(`placeholder left in ${name}`);
  fs.writeFileSync(`${SP}/figs/out10/${name}.html`, html);
  await pg.setContent(html);
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out10/${name}.png` });
  console.log(name, 'ok');
}
await browser.close();
