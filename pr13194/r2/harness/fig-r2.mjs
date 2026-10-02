// VERIFICATION RIG ONLY (PR #13194): evidence figures from the probe JSON files.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13135-rig';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13194/package.json');
const { chromium } = require('playwright');
const OUT = `${RIG}/p94/fig`;
fs.mkdirSync(OUT, { recursive: true });
const res = (db, name) => JSON.parse(fs.readFileSync(`${RIG}/out/${db}/${name}.json`, 'utf8'));
const W = 1080;
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:${W}px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#52514e;margin:0 0 14px;line-height:1.45}
  h2{font-size:14px;margin:16px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0 10px}
  th,td{border:1px solid #d9d8d4;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  td.mono,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
  pre{background:#f6f5f2;border:1px solid #d9d8d4;border-radius:6px;padding:8px 10px;margin:6px 0;white-space:pre;overflow:hidden}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c !== null ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const cnt = (r) => `${r.pass}/${r.pass + r.fail}`;
const figs = {};
const dd = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const obsE = res('q5', 'p5-mixed-observe-ws-mxe-base-norun'), obsF = res('q5', 'p5-mixed-observe-ws-mxf-base-norun');
const healE = res('q5', 'p5-heal-ws-mxe-h2'), healF = res('q5', 'p5-heal-ws-mxf-h2');
const st = (o) => `${o[0]} / ${o[1]} · gen ${o[2]}`;
const reg = ['p1-public-ws-h2a-fromARCHIVED', 'p1-web-ws-h2b-fromCLOSED', 'p2-edges-ws-h2e', 'p3-race-ws-h2r-n16', 'p3-race-ws-h2s-n32', 'p7-reads-ws-h2v', 'p4-crash-ws-h2k-p94h2'].map((n) => [n, res('q6', n)]);
const m2 = JSON.parse(fs.readFileSync(`${RIG}/p94/mut/results2.json`, 'utf8'));
const short = (t) => t.replace('WorkspaceSessionRetentionTest.', 'RetentionTest.').replace('WorkspaceSessionRetentionMySqlIT.', 'RetentionMySqlIT.').replace('ManagedSessionOperationStoreTest.', 'OperationStoreTest.');
figs['04-round2-f1-fixed'] = page(
  'Round 2 — #13194 @ a1c205021f: F1 fixed, re-verified on the same Linux stack',
  'Same rig as round 1 (colima Linux 6.8 aarch64, durable local-process Broker, packaged Hosted Harness, MySQL 8.4.7), fresh databases. The fix is the round-1 candidate: the two SQL predicates in the new <code>ManagedAgentStore.class</code> have the same constant-pool strings as the candidate jar.',
  `<h2>F1: DELETE admitted by the fixed head, killed mid-completion, then parked by an older coordinator without Runtime close support</h2>` +
  table(['Source state', 'after the older coordinator', 'then fixed head only', 'Runtime-table writes'], [
    ['CLOSED', { c: 'mono', t: `${st(obsE.final)} · ${obsE.status}` }, OK(`${st(healE.final)} · DELETED, 1 retirement, ~0.2 s after Spring started`), OK('0')],
    ['ARCHIVED', { c: 'mono', t: `${st(obsF.final)} · ${obsF.status}` }, OK(`${st(healF.final)} · DELETED, 1 retirement, ~0.16 s after Spring started`), OK('0')],
    ['round 1 (2486d3dad7), same scenario', { c: 'mono', t: 'RECOVERY_BLOCKED / BLOCKED · gen 2 · DELETING' }, BAD('still BLOCKED after 180 s, every API 409'), '—'],
  ]) +
  `<div class="note nok">MySQL general log ran across the whole fixed-head start: it shows each operation's <code>INSERT INTO qwen_output_session_retirement</code> and completion <code>UPDATE</code>, and no write to runtime/lease/drain tables for either Session or binding.</div>` +
  `<h2>Regression on the fixed head</h2>` +
  table(['Probe', 'Result'], reg.map(([n, r]) => [n.replace(/-ws-.*$/, '').replace(/^p1-(public|web)$/, 'p1') + (n.includes('public') ? ' public, delete from ARCHIVED' : n.includes('web-') ? ' WebShell, delete from CLOSED' : n.includes('n32') ? ' (32 parallel)' : n.includes('n16') ? ' (16 parallel)' : ''), r.fail ? BAD(`${r.pass}/${r.pass + r.fail}`) : OK(`${r.pass}/${r.pass + r.fail}`)])) +
  `<h2>Tests and mutation of the new predicate</h2>` +
  table(['Check', 'Result'], [
    ['managed-agent-server unit', OK('450/450')],
    ['real-MySQL ITs (TZ=UTC): Retention · Close · ManagedAgentMySqlIT · WorkspaceRecovery · ToolPublicationRecovery', OK('16/16 · 5/5 · 19/19 · 3/3 · 8/8')],
    ...Object.values(m2).filter((x) => x.id !== 'BASELINE').map((x) => [`${x.id} ${dd(x.what)}`, x.verdict === 'KILLED' ? OK(`killed by ${dd(short(x.failed[0]))}${x.failed.length > 1 ? ` (+${x.failed.length - 1})` : ''}`) : WARN(x.verdict)]),
  ]),
);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 80, height: 900 } });
const pg = await ctx.newPage();
for (const [name, html] of Object.entries(figs)) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, html);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}.png ${clipped ? `(${clipped} clipped!)` : ''}`);
}
await browser.close();
