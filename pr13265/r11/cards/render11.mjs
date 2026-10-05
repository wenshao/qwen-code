// PR #13265 round 11 cards (head abf9687ce6), rendered from this round's logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${SP}/wt-pr19/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 11 · head abf9687ce6 (edcbe0e537 + three fixes + merges of main 864850816e, none hand-resolved) · Linux: 192.168.0.75 (kernel 6.6.89, cgroup v2) · macOS: jar built at abf9687ce6 + native MySQL 8.4.7 · mutants in a local worktree, restored afterwards';
const load = (f) => JSON.parse(fs.readFileSync(`${R5}/${f}`, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const line = (file, tag) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`[${tag}]`)).map((l) => l.replace(/^.*?\[[A-Za-z0-9-]+\]\s*/, ''));
const h = { l1: load('out75-r11/l1-head13.log'), l13: load('out75-r11/l13-head13.log'), l14: load('out75-r11/l14-head13.log'), l15b: load('out75-r11/l15b-head13.log'), l19: load('out75-r11/l19-head13.log') };
const r = { l1: load('out75-r11/l1-rest13.log'), l14: load('out75-r11/l14-rest13.log'), l19: load('out75-r11/l19-rest13.log') };
const rt = (x) => { const a = Object.values(x.routeTerminate).flatMap((v) => Object.entries(v.answers).filter(([k]) => !k.startsWith('status'))); const n = a.reduce((s, [, c]) => s + c, 0); const e = a.filter(([k]) => k.startsWith('error')).reduce((s, [, c]) => s + c, 0); return e ? `ENOENT ${e}/${n}` : `exited {SIGTERM} ${n}/${n}`; };
const s13 = JSON.parse(line(`${SP}/rig9/out/s13-r11.stdout`, 'RESULT')[0]);
const s14 = JSON.parse(line(`${SP}/rig9/out/s14-r11.stdout`, 'RESULT')[0]);
const s15 = JSON.parse(line(`${SP}/rig9/out/s15-fail2.stdout`, 'RESULT')[0]);
const b0 = JSON.parse(line(`${SP}/rig9/out/s15b-retry0.stdout`, 'RESULT')[0]).sequential;
const b1 = JSON.parse(line(`${SP}/rig9/out/s15b-retry1.stdout`, 'RESULT')[0]).sequential;
const mut = Object.fromEntries(JSON.parse(fs.readFileSync(`${SP}/rig9/mutants-r11/summary.json`, 'utf8')).map((m) => [m.id, m]));
const m8c = fs.readFileSync(`${SP}/rig9/mutants-r11/M8c-finish-forward-failure-propagates.txt`, 'utf8');
const cards = {};

{
  const body = `
${table(['check', 'result'], [
    ['CI at abf9687ce6', { t: '__CI__', cls: 'ok' }],
    ['Java (server changed via main: SessionEventHub, hosted harness connector)', { t: 'runtime-broker 654 (1 skipped) + 7 ITs · managed-agent-server 744 (1 skipped) + 52/52 ITs · Checkstyle 0 · SpotBugs 0', cls: 'ok' }],
    ['TS: cli (22 files) · core (managed-runtime + cgroup)', { t: 'cli 1495/1495 · core 2110/2111 (hook-scale timeout; 6/6 alone)', cls: 'ok' }],
    ['merges 954d9c516d · c19022c116 · abf9687ce6', { t: 'no hand-resolved hunks (remerge-diff empty)', cls: 'ok' }],
  ])}
${table(['192.168.0.75, exact dist', 'abf9687ce6', '+ the two round-3 edits'], [
    ['shell-terminate on running Shells ×20', { t: rt(h.l19), cls: 'ok' }, { t: rt(r.l19), cls: 'ok' }],
    ['H3 terminate(500), TERM-ignoring member ×20 · L7', { t: `null ${h.l14.L14.nullEvidence}/20 · ${JSON.stringify(h.l1.L7.evidence)}`, cls: 'bad' }, { t: `evidence ${r.l14.L14.evidence}/20, ${r.l14.L14.unitLeft} left · ${r.l1.L7.evidence?.exitSignal}`, cls: 'ok' }],
    ['H4 kill -KILL $$ · kill -SEGV $$', { t: `exit ${h.l1.L4_selfkill.exitCode} · exit ${h.l1.L4_segv.exitCode}`, cls: 'bad' }, { t: `${r.l1.L4_selfkill.exitSignal} · ${r.l1.L4_segv.exitSignal}`, cls: 'ok' }],
    ['H7b/H5 (L15b) · G5b · H1/H2', { t: `hold kept, settles ${h.l15b.daemonInheritsPipes.after.settledMsAfterMemberEnd} ms after · ${h.l19.bpAfterLauncherExit.manifest.captureStatus} 256/256 · ${Object.values(h.l13).map((v) => v.started).reduce((a, b) => a + b, 0)}/90`, cls: 'ok' }, { t: 'same', cls: 'ok' }],
  ])}
<div class="note">Every .75 result matches round 10 field for field (L14's null count moves between 19 and 20 run to run).</div>`;
  cards['r11-01-status'] = page('Round 11: checks green; bare metal unchanged from round 10', 'Three fixes and three merges since round 10; the server jar rebuilt because main changed server Java', body, FOOT);
}

{
  const body = `
${table(['real stack (Spring + MySQL 8.4.7, jar at abf9687ce6)', 'measured', 'result'], [
    ['S13 · S14', { t: `re-drive settles Shell (${s13.shellRedrive.javaAfterAttach}) and Monitor; lineage forwards ${JSON.stringify(s14.concurrentLarge.revisionsForwarded)}, 0 refusals at 16+16 MiB concurrent` }, { t: 'holds', cls: 'ok' }],
    ['S15 · one injected failure on the 2nd record forward (68ff69aa72)', { t: `forwards ${JSON.stringify(s15.sequential.revisionsForwarded)}: the thrown revision is retried by the next edge; finalize ${s15.sequential.finalize}, ${s15.sequential.manifest.captureStatus}, Java ${s15.sequential.javaRow}` }, { t: 'retried', cls: 'ok' }],
    ['S15b · one injected failure on the final forward (inside finalize)', { t: `finalize ${b0.finalize.split(' ')[0]}; record after 20 s ${b0.recordAfterWait.replace(' stopReason=null', '')}, Java ${b0.javaRow}, capture ${b0.manifest.captureStatus} — nothing retries it` }, { t: 'stranded', cls: 'bad' }],
    ['S15b · same, then one more finalize (as a retry would send)', { t: `retry ${b1.retryFinalize} → ${b1.record.replace(' stopReason=exited', '')}, ${b1.manifest.captureStatus}, Java ${b1.javaRow}` }, { t: 'one retry heals it', cls: 'ok' }],
  ])}
${table(['mutant (site)', 'result', 'verdict'], [
    ['M3a · shared monitorWakeNeedsRecovery matches by name', { t: `${mut['M3a-shared-predicate-by-name'].tally} — the three per-class witnesses` }, { t: 'killed', cls: 'ok' }],
    ['M3b · the Session passes its own name predicate instead of the shared one', { t: 'whole-file failures are takeover-family cases that change per run; the first passes 3/3 alone with the mutant' }, { t: 'survives', cls: 'warn' }],
    ['M7 · cancelled-Hook settle excludes every monitor input again', { t: `${mut['M7-cancelled-hook-excludes-every-monitor-input'].tally} — "settles a monitor wake that already started and parks"` }, { t: 'killed', cls: 'ok' }],
    ['M8c · a thrown finish-arm forward propagates', { t: `${(m8c.match(/^\s+Tests\s+.*$/m) ?? [''])[0].trim()} — "retries the record forward a wedge threw once…"` }, { t: 'killed', cls: 'ok' }],
    ['M8 · latch lastManifest before the forward · M8b · write-arm forward propagates', { t: `${mut['M8-latch-lastManifest-before-forward'].tally} · ${mut['M8b-write-forward-failure-propagates'].tally} — the witness's first forward is a finish; with skip-tolerant lineage, latching early is caught up by the next edge` }, { t: 'survive', cls: 'warn' }],
  ])}`;
  cards['r11-02-stack-mutants'] = page('Real stack: a failed final forward strands the record; the new fixes are pinned', 'S13–S15 over the HTTP store with the production toolResultResources; mutants in a local worktree of abf9687ce6', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.rmSync(`${SP}/figs/out11`, { recursive: true, force: true });
fs.mkdirSync(`${SP}/figs/out11`, { recursive: true });
for (const [name, html0] of Object.entries(cards)) {
  const html = html0.replace('__CI__', esc(process.env.CI_TEXT ?? 'pending'));
  if (/__[A-Z]+__/.test(html)) throw new Error(`placeholder left in ${name}`);
  fs.writeFileSync(`${SP}/figs/out11/${name}.html`, html);
  await pg.setContent(html);
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out11/${name}.png` });
  console.log(name, 'ok');
}
await browser.close();
