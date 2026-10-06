// PR #13265 round 13 card (head c370c5582b), rendered from this round's logs.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/375ea070-7eb1-408b-8193-ec64d7c2959a/scratchpad';
const R5 = '/Users/wenshao/pr13265-rig/r5';
const require = createRequire(`${SP}/wt-pr21/package.json`);
const { chromium } = require('playwright');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CSS = fs.readFileSync(`${SP}/figs/render.mjs`, 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
const page = (title, sub, body, foot) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="card"><h1>${esc(title)}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div></body></html>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.html ?? esc(c.t ?? c)}</td>`).join('')}</tr>`).join('')}</table>`;
const FOOT = 'PR #13265 round 13 · head c370c5582b (b883b6631c + 14 commits, no merge, no Java change) · Linux: 192.168.0.75 (kernel 6.6.89, cgroup v2) · macOS: the b883b6631c jar (Java unchanged) + native MySQL 8.4.7 · mutants in a local worktree, restored afterwards';
const load = (f) => JSON.parse(fs.readFileSync(`${R5}/${f}`, 'utf8').split('\n').find((l) => l.startsWith('[RESULT]')).slice(9));
const line = (file, tag) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`[${tag}]`)).map((l) => l.replace(/^.*?\[[A-Za-z0-9-]+\]\s*/, ''));
const h = { l1: load('out75-r13/l1-head15.log'), l14: load('out75-r13/l14-head15.log'), l19: load('out75-r13/l19-head15.log') };
const r = { l1: load('out75-r13/l1-rest15.log'), l14: load('out75-r13/l14-rest15.log') };
const rt = (x) => { const a = Object.values(x.routeTerminate).flatMap((v) => Object.entries(v.answers).filter(([k]) => !k.startsWith('status'))); const n = a.reduce((s, [, c]) => s + c, 0); const e = a.filter(([k]) => k.startsWith('error')).reduce((s, [, c]) => s + c, 0); return e ? `ENOENT ${e}/${n}` : `exited {SIGTERM} ${n}/${n}`; };
const s15 = (tag) => JSON.parse(line(`${SP}/rig9/out/s15c-r13-${tag}.stdout`, 'RESULT')[0]).sequential;
const mut = Object.fromEntries(JSON.parse(fs.readFileSync(`${SP}/rig9/mutants-r13/summary.json`, 'utf8')).map((m) => [m.id, m]));
const row = (label, tag) => { const v = s15(tag); const ok = v.settledAfterMs !== null; return [label, { t: ok ? `settled ${v.settledAfterMs} ms after the refused finalize · Java ${v.javaRow}` : `still ${v.record.replace(' stopReason=null', '')} after 10 s · Java ${v.javaRow}` }, { t: ok ? 'heals' : 'stranded', cls: ok ? 'ok' : 'warn' }]; };
const cards = {};
{
  const body = `
${table(['round-12 item', 'at c370c5582b', 'result'], [
    ['merge dropped hasInstalledPublication (117e0116ba)', { t: `getter back on the selector · M11 (remove it): ${mut['M11-selector-without-hasInstalledPublication'].tally} — main's boot3 container test` }, { t: 'fixed, pinned', cls: 'ok' }],
    ['racy re-drive witness (0e01478f4d)', { t: 'fake timers around the refused finalize; Test (ubuntu) green' }, { t: 'fixed', cls: 'ok' }],
    ['CI', { t: '__CI__' }, { t: 'green', cls: 'ok' }],
  ])}
${table(['S15c · bounded re-drive (3a700a389b), real stack, no client retry', 'measured', 'result'], [
    row('1 failure on the final forward', 'oneshot'),
    row('2 consecutive failures', 'twoshot'),
    row('3 consecutive failures', 'threeshot'),
    row('4 consecutive failures', 'fourshot'),
    row('forwards failing for 300 ms', 'outage300'),
    row('forwards failing for 1000 ms', 'outage1000'),
  ])}
${table(['also measured', 'result'], [
    ['M12 · bounded chain cut to one attempt', { t: `${mut['M12-redrive-single-attempt'].tally} — the S15c and drain-window witnesses`, cls: 'ok' }],
    ['TS · cli (24 files incl. the container test) · core (managed-runtime + hooks)', { t: 'cli 1579/1580 (one takeover-family case, 2/2 alone) · core 3298 (5 skipped)', cls: 'ok' }],
    ['.75 · head · + the two round-3 edits', { t: `same as round 12: stop route ${rt(h.l19)}; H3 null ${h.l14.L14.nullEvidence}/20 → evidence ${r.l14.L14.evidence}/20 with the edits; H4 exit ${h.l1.L4_selfkill.exitCode} → ${r.l1.L4_selfkill.exitSignal}/${r.l1.L4_segv.exitSignal}; G5b ${h.l19.bpAfterLauncherExit.manifest.captureStatus}`, cls: 'ok' }],
    ['S13 · S14 on the real stack', { t: 'hold', cls: 'ok' }],
  ])}`;
  cards['r13-01-status'] = page('Round 13: both CI blockers fixed and pinned; the re-drive now rides out ~0.8 s', 'Fourteen commits since round 12; the bounded re-drive measured on Spring + MySQL 8.4.7', body, FOOT);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1400, height: 1000 } });
const pg = await ctx.newPage();
fs.rmSync(`${SP}/figs/out13`, { recursive: true, force: true });
fs.mkdirSync(`${SP}/figs/out13`, { recursive: true });
for (const [name, html0] of Object.entries(cards)) {
  const html = html0.replace('__CI__', esc(process.env.CI_TEXT ?? 'pending'));
  if (/__[A-Z]+__/.test(html)) throw new Error(`placeholder left in ${name}`);
  fs.writeFileSync(`${SP}/figs/out13/${name}.html`, html);
  await pg.setContent(html);
  await pg.locator('#card').screenshot({ path: `${SP}/figs/out13/${name}.png` });
  console.log(name, 'ok');
}
await browser.close();
