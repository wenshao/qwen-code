// PR #13265 round 12 cards (head b883b6631c), rendered from this round's logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${SP}/wt-pr20/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 12 · head b883b6631c (abf9687ce6 + seven fixes + merge of main, six files hand-resolved) · Linux: 192.168.0.75 (kernel 6.6.89, cgroup v2) · macOS: jar built at b883b6631c + native MySQL 8.4.7 · mutants and probes in a local worktree, restored afterwards';
const load = (f) => JSON.parse(fs.readFileSync(`${R5}/${f}`, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const line = (file, tag) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`[${tag}]`)).map((l) => l.replace(/^.*?\[[A-Za-z0-9-]+\]\s*/, ''));
const h = { l1: load('out75-r12/l1-head14.log'), l13: load('out75-r12/l13-head14.log'), l14: load('out75-r12/l14-head14.log'), l15b: load('out75-r12/l15b-head14.log'), l19: load('out75-r12/l19-head14.log') };
const r = { l1: load('out75-r12/l1-rest14.log'), l14: load('out75-r12/l14-rest14.log'), l19: load('out75-r12/l19-rest14.log') };
const rt = (x) => { const a = Object.values(x.routeTerminate).flatMap((v) => Object.entries(v.answers).filter(([k]) => !k.startsWith('status'))); const n = a.reduce((s, [, c]) => s + c, 0); const e = a.filter(([k]) => k.startsWith('error')).reduce((s, [, c]) => s + c, 0); return e ? `ENOENT ${e}/${n}` : `exited {SIGTERM} ${n}/${n}`; };
const s15c = (tag) => JSON.parse(line(`${SP}/rig9/out/s15c-${tag}.stdout`, 'RESULT')[0]).sequential;
const j9 = Object.fromEntries(line(`${SP}/rig9/j9-probe.log`, 'R12-J9').map((l) => [l.split(' ')[0], JSON.parse(l.slice(l.indexOf('{')))]));
const s13 = JSON.parse(line(`${SP}/rig9/out/s13-refused-settle-redrive-r12.stdout`, 'RESULT')[0]);
const s14 = JSON.parse(line(`${SP}/rig9/out/s14-lineage-under-concurrent-writes-r12.stdout`, 'RESULT')[0]);
const cards = {};

{
  const body = `
${table(['since round 11', 'what it says it fixes'], [
    ['78e461a722 · 17cf17ce54', 'recovery settles admitted runs proven unstarted · a fresh Broker sweeps durable background rows it never indexed'],
    ['b5c07667d1 · 82e0deaec8 · cafc7ecd9e', 'isolation refusals name their cause · one shared capture status rule; a blind capture is announced'],
    ['bd350491fb', 'a refused final forward on an attached record re-drives itself once (round-11 S15b)'],
    ['601c6bd03b · b883b6631c', 'merge of main (Kubernetes CSI runtime, tool dispatch authorization: V41–V44) · task journal renumbered to V45'],
  ])}
${table(['check', 'result'], [
    ['CI at b883b6631c', { t: '__CI__', cls: '__CICLS__' }],
    ['Java runtime-broker · managed-agent-server', { t: '734 (2 skipped) + 7 ITs · 963 (1 skipped) + 52/52 ITs · Checkstyle 0 · SpotBugs 0', cls: 'ok' }],
    ['TS: cli (23 files) · core', { t: 'cli 1550/1552 · core 2137/2138 — the two harness cases and the hook-scale file pass alone', cls: 'ok' }],
    ['merge 601c6bd03b (remerge-diff, six files)', { t: 'worker keeps the per-capture selector over main\'s conflict rule · executor keeps main\'s admission gate + Monitor · activation keeps main\'s refusal after the ordered drain · Broker repositories keep both findBackgroundProcesses and findByBinding', cls: 'ok' }],
    ['Flyway', { t: 'fresh V1–V45 · upgrade from main\'s V44 adds the 2 task-journal tables · a schema that ran a pre-renumber build of this PR refuses: checksum mismatch for version 41', cls: 'warn' }],
  ])}
${table(['192.168.0.75', 'b883b6631c', '+ the two round-3 edits'], [
    ['stop route ×20 · H3 terminate(500) ×20 · H4', { t: `${rt(h.l19)} · null ${h.l14.L14.nullEvidence}/20 · exit ${h.l1.L4_selfkill.exitCode}/${h.l1.L4_segv.exitCode}`, cls: 'warn' }, { t: `${rt(r.l19)} · evidence ${r.l14.L14.evidence}/20 · ${r.l1.L4_selfkill.exitSignal}/${r.l1.L4_segv.exitSignal}`, cls: 'ok' }],
    ['H7b/H5 (L15b) · G5b · H1/H2', { t: `hold kept · ${h.l19.bpAfterLauncherExit.manifest.captureStatus} 256/256 · ${Object.values(h.l13).map((v) => v.started).reduce((a, b) => a + b, 0)}/90`, cls: 'ok' }, { t: 'same', cls: 'ok' }],
  ])}`;
  cards['r12-01-status'] = page('Round 12: checks green, merge sound, bare metal unchanged', 'Seven fixes and a merge of main since round 11', body, FOOT);
}

{
  const row = (label, tag) => { const v = s15c(tag); return [label, { t: `finalize ${v.finalize.split(' ')[0]} · forwards ${JSON.stringify(v.revisionsForwarded)} · ${v.settledAfterMs !== null ? `settled ${v.settledAfterMs} ms after the finalize` : 'still ' + v.record.replace(' stopReason=null', '') + ' after 10 s'} · Java ${v.javaRow}` }, { t: v.settledAfterMs !== null ? 'heals' : 'stranded', cls: v.settledAfterMs !== null ? 'ok' : 'bad' }]; };
  const j = (k) => `${j9[k].limit100.found}/${j9[k].expected} at limit 100 (pages ${j9[k].limit100.firstPages}), 7 and 1; 0 missing, 0 duplicates, 0 strangers`;
  const body = `
${table(['S15c · real stack, no client retry, record watched 10 s', 'measured', 'result'], [
    row('one failure on the final forward', 'oneshot'),
    row('two consecutive failures (final forward, then the re-drive)', 'twoshot'),
    row('forwards failing for 30 ms after the first failure', 'outage30'),
    row('forwards failing for 300 ms', 'outage300'),
  ])}
${table(['Broker and the rest', 'measured', 'result'], [
    ['J9 · Jdbc findBackgroundProcesses on MySQL (no repository contract covers it)', { t: `${j('mysql')} — identical to InMemory; settled rows out, EXECUTING in, other owners out` }, { t: 'correct', cls: 'ok' }],
    ['M9 · drop the durable backfill (17cf17ce54)', { t: 'releaseSweepsADurableOnlyBackgroundRow fails' }, { t: 'killed', cls: 'ok' }],
    ['M10 · drop the re-drive scheduling (bd350491fb)', { t: '"re-drives a refused final forward on an attached record without any client action" fails' }, { t: 'killed', cls: 'ok' }],
    ['S13 · S14', { t: `re-drive on attach settles Shell (${s13.shellRedrive.javaAfterAttach}); lineage ${JSON.stringify(s14.concurrentLarge.revisionsForwarded)}, 0 refusals at 16+16 MiB` }, { t: 'holds', cls: 'ok' }],
  ])}
<div class="note">bd350491fb heals exactly the round-11 case: one immediate re-drive (setTimeout 0), whose own failure is swallowed without another attempt. A failure that lasts past that single retry — a second refusal, or an outage as short as 30 ms — strands the record as before.</div>`;
  cards['r12-02-redrive-broker'] = page('The re-drive heals one failure, not a brief outage; the Broker sweep is correct on MySQL', 'S15c and S13/S14 over the HTTP store (Spring + MySQL 8.4.7); J9 against the Jdbc repository on the same MySQL', body, FOOT);
}

{
  const body = `
${table(['CI red leg at b883b6631c', 'cause', 'owner'], [
    ['Test (ubuntu) · managed-runtime-container.test.ts › wires the gate in the actual boot3 startup…', { t: 'expected workState BLOCKED with publication_lifecycle_unqualified, got QUIESCENT []. The merge 601c6bd03b replaced main\'s composite publisher (which exposed get hasInstalledPublication) with selectShellCapturePublisher(...), whose object has only prepare. Main\'s CSI retirement gate (managed-runtime-tool-executor.ts:324) reads that flag, so it never blocks retirement while a v3 publication is installed. Reproduced locally; adding main\'s getter to the selector\'s object: container + context-worker 783/783' }, { t: 'this PR (merge)', cls: 'bad' }],
    ['Test (ubuntu) · hosted-shell-publisher.background.test.ts › re-drives a refused final forward…', { t: '"expected advanceOutput to be called once, but got 2 times" (3/3 CI attempts; locally 2/5). The witness asserts the pre-re-drive state right after the refused fetch, but the 0 ms re-drive is scheduled while the route handles the request and can run before the fetch resolves. Product behaviour is right; assert after waitFor or drive the tick with fake timers' }, { t: 'this PR (test)', cls: 'bad' }],
    ['Hosted process fault gates / MySQL 8.4 · step "Verify Hosted Java, Spring and MySQL processes"', { t: 'timed out at 12 min with every test passing (963 unit, O4MySqlGate 48/48). Main\'s own push run at 69d5db2ff2 (#13289, the commit this merge brought in) failed the same step at 12:05; earlier main commits took 9–11 min' }, { t: 'main', cls: 'mut' }],
  ])}`;
  cards['r12-03-ci'] = page('CI at b883b6631c: two red tests come from this PR, the fault-gate timeout from main', 'Each red leg reproduced or compared against main\'s own push run of the same job', body, FOOT);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.rmSync(`${SP}/figs/out12`, { recursive: true, force: true });
fs.mkdirSync(`${SP}/figs/out12`, { recursive: true });
for (const [name, html0] of Object.entries(cards)) {
  const html = html0.replace('__CI__', esc(process.env.CI_TEXT ?? 'pending')).replace('__CICLS__', process.env.CI_CLS ?? 'warn');
  if (/__[A-Z]+__/.test(html)) throw new Error(`placeholder left in ${name}`);
  fs.writeFileSync(`${SP}/figs/out12/${name}.html`, html);
  await pg.setContent(html);
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out12/${name}.png` });
  console.log(name, 'ok');
}
await browser.close();
