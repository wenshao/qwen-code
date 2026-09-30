// Render the evidence cards to PNG with the repo's Playwright.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/12fa9b24-1d30-4fad-b831-ba32169a2e71/scratchpad';
const D = `${SP}/pr12998`;
const OUT = `${D}/figs`;
await mkdir(OUT, { recursive: true });
const require = createRequire(`${SP}/wt-pr/package.json`);
const { chromium } = require('playwright');
const live = JSON.parse(await readFile(`${D}/rig/live-probe.json`, 'utf8'));
const ajv = JSON.parse(await readFile(`${D}/ajv-summary.json`, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
#card{width:1240px;padding:28px 32px 26px;background:#0d1117}
h1{font-size:22px;margin:0 0 4px;color:#f0f6fc} .sub{color:#8b949e;margin:0 0 18px;font-size:14px}
h2{font-size:15px;margin:18px 0 8px;color:#79c0ff;text-transform:uppercase;letter-spacing:.04em}
table{border-collapse:collapse;width:100%;font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
th{color:#8b949e;text-align:left;font-weight:600;border-bottom:1px solid #30363d;padding:5px 8px}
td{border-bottom:1px solid #21262d;padding:5px 8px;vertical-align:top;white-space:nowrap} td:last-child{white-space:normal}
.ok{color:#3fb950}.bad{color:#f85149}.warn{color:#d29922}.dim{color:#8b949e}.hl{background:#1f2a1f}.hb{background:#2d1d1d}.hy{background:#2b2512}
.note{border-left:3px solid #388bfd;background:#121d2f;padding:10px 14px;margin-top:16px;font-size:14px}
.note.warnb{border-color:#d29922;background:#231d0f}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.kpi{display:flex;gap:14px;margin:6px 0 4px}.k{flex:1;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:10px 12px}
.k b{display:block;font-size:24px;color:#f0f6fc}.k span{color:#8b949e;font-size:12.5px}
code{font:12.5px ui-monospace,Menlo,monospace;color:#ffa657}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;

// Card 1: zero runtime change + real stack A/B
const rows1 = live.table.map((t) => {
  const planned = t.marker === 'planned';
  const valid = [t.headJarVsBaseSpec, t.headJarVsHeadSpec, t.baseJarVsHeadSpec].every((v) => v.startsWith('valid'));
  return `<tr class="${planned ? 'hy' : ''}"><td>${esc(t.label)}</td><td class="dim">${esc(t.marker)}</td><td>${esc(t.head)}</td><td>${esc(t.base)}</td><td class="${t.same ? 'ok' : 'bad'}">${t.same ? 'identical' : 'DIFF'}</td><td class="${valid ? 'ok' : 'bad'}">${valid ? 'valid' : 'INVALID'} <span class="dim">${esc(t.headJarVsHeadSpec.replace(/^valid /, ''))}</span></td></tr>`;
}).join('');
const card1 = page(
  'PR #12998 @ 05047ae6 — zero runtime change, real server A/B',
  'Base a1c90bd2 (merge base) vs head 05047ae6 · JDK 21.0.12 · Spring Boot jars on a dedicated MySQL 8.4.11 · JVM and DB in UTC',
  `<div class="kpi"><div class="k"><b>406 / 407</b><span>jar entries with identical CRC-32 (incl. all 52 nested jars)</span></div>
   <div class="k"><b>1</b><span>differing entry: BOOT-INF/classes/openapi/managed-agent-public-api.openapi.json (202,266 → 210,109 B)</span></div>
   <div class="k"><b>196 / 196</b><span>module tests pass on head · Checkstyle 0 violations</span></div>
   <div class="k"><b>19 / 19</b><span>live requests: identical status + normalized body on both jars</span></div></div>
   <h2>Same request sequence against both real servers; every body validated with Ajv against base and head contracts</h2>
   <table><tr><th>request</th><th>route marker</th><th>head jar</th><th>base jar</th><th>A/B</th><th>schema (76 checks)</th></tr>${rows1}</table>
   <div class="note">No class in <code>src/main/java</code> reads the OpenAPI resource; the planned task-events and task-cancel routes stay unmapped (404 on both surfaces). Real close / archive / delete operations — the served <code>PublicCommandOperation</code> / <code>WebShellCommandOperation</code> that carry the new planned conditional — validate under the new contract. A same-key close retry returned the same operation id with its latest durable state and <code>replayed: true</code>: the served precedent that A6 now writes down.</div>`);

// Card 2: Ajv differential + generator
const named = ajv.rows.map((r) => `<tr class="${r.slice(1).some((c) => c.endsWith('--')) ? 'hb' : ''}"><td>${esc(r[0])}</td>${r.slice(1).map((c) => { const [b, h] = c.split('/'); return `<td><span class="${b === 'ok' ? 'ok' : 'bad'}">${b === 'ok' ? 'valid' : 'invalid'}</span> → <span class="${h === 'ok' ? 'ok' : 'bad'}">${h === 'ok' ? 'valid' : 'invalid'}</span></td>`; }).join('')}</tr>`).join('');
const card2 = page(
  'Independent schema differential (Ajv 2020-12, not the networknt validator the PR tests use)',
  'Exhaustive operation matrix: 8 types × 6 statuses × 2 admission stages × 4 delivery states × receipt × failure code × task id, across 4 schemas',
  `<div class="kpi"><div class="k"><b>12,288</b><span>validations per contract (base and head)</span></div>
   <div class="k"><b>132</b><span>verdict flips, all valid → invalid, all <code>task_cancel</code></span></div>
   <div class="k"><b>0</b><span>flips for any other operation type (no shared enum narrowed)</span></div>
   <div class="k"><b>2</b><span>structural differences in the whole contract after dropping descriptions and info</span></div></div>
   <h2>Flip breakdown (per schema: PublicCommandOperation, PublicOperation, WebShellCommandOperation, WebShellOperation)</h2>
   <table><tr><th>instance class</th><th>per schema</th><th>total</th></tr>
   <tr><td>task_cancel · status cancelled (with or without failure code)</td><td>22</td><td>88</td></tr>
   <tr><td>task_cancel · status failed without failure code</td><td>11</td><td>44</td></tr>
   <tr><td>any other type or status</td><td>0</td><td>0</td></tr></table>
   <h2>Reviewer test plan cases (base → head)</h2>
   <table><tr><th>instance</th><th>PublicCommandOperation</th><th>PublicOperation</th><th>WebShellCommandOperation</th><th>WebShellOperation</th></tr>${named}</table>
   <h2>Structural diff and generated client</h2>
   <table><tr><th>check</th><th>result</th></tr>
   <tr><td>contract structure, descriptions/info excluded</td><td>only <code>PublicCommandOperation.allOf[4]</code> and <code>WebShellCommandOperation.allOf[4]</code> added (both planned)</td></tr>
   <tr><td>regenerate head types (PR generator + openapi-typescript)</td><td class="ok">byte-identical to committed managed-agent-api.ts</td></tr>
   <tr><td>base → head generated diff</td><td>1 line (WebShellCommandOperation description)</td></tr>
   <tr><td>un-plan the conditional only (future cancel slice)</td><td>1 line: one more <code>&amp; unknown</code>; openapi-typescript does not render if/then, so no required-but-undeclared field</td></tr>
   <tr><td>un-plan conditional + taskId + failureCode</td><td>adds optional <code>taskId?</code> / <code>failureCode?</code> — the activation the doc prescribes</td></tr></table>`);

// Card 3: mutation matrix
const M = [
  ['C1', 'drop the new conditional from PublicCommandOperation only', 'killed', 'killed', ''],
  ['C2', 'drop it from WebShellCommandOperation only', 'killed', 'killed', ''],
  ['C3', 'allow task_cancel status cancelled', 'killed', 'killed', ''],
  ['C4', 'failed task_cancel needs no failure code', 'killed', 'killed', ''],
  ['C5', 'swap failure_code / failureCode casing', 'killed', 'killed', ''],
  ['C6', 'apply the rule to every operation type', 'killed', 'killed', ''],
  ['C7', 'remove the planned marker from the conditional', 'survives', 'survives', 'web-shell generated-sync test fails (output changes)'],
  ['E1', 'next_cursor nullable', 'killed', 'killed', ''],
  ['E2', 'next_cursor optional (empty page)', 'killed', 'killed', ''],
  ['E3', 'task event object open (additionalProperties)', 'killed', 'killed', ''],
  ['B1c', 'artifact_refs maxItems 100 → 101', 'killed', 'killed', ''],
  ['B3c', 'output no longer forbids artifact_id', 'killed', 'killed', ''],
  ['B1', 'artifact_refs maxItems 100 → 50', 'SURVIVES', 'killed', 'open thread R2-1'],
  ['B2', 'state_changed forbids its companion runtime_state', 'SURVIVES', 'killed', 'open thread R2-2'],
  ['B3', 'output forbids only {artifact_id AND state} (conjunction)', 'SURVIVES', 'killed', 'open thread R1-2 (fix-induced)'],
];
const cls = (v) => v === 'killed' ? 'ok' : v === 'SURVIVES' ? 'bad' : 'warn';
const rows3 = M.map(([id, what, pr, cand, note]) => `<tr class="${pr === 'SURVIVES' ? 'hb' : ''}"><td>${id}</td><td>${esc(what)}</td><td class="${cls(pr)}">${pr}</td><td class="${cls(cand)}">${cand}</td><td class="dim">${esc(note)}</td></tr>`).join('');
const card3 = page(
  'Mutation check of the contract tests — 15 single-rule contract mutants',
  'Each mutant replaces the contract on the test classpath; PlannedTaskContractTest + ManagedAgentApiContractTest + ManagedSessionStoreContractFixtureTest (15 tests, networknt) · unmutated baseline 15/15 green',
  `<table><tr><th>id</th><th>mutation (both mirrors unless noted)</th><th>PR tests @05047ae6</th><th>+ candidate (+15/−6)</th><th>other guard / thread</th></tr>${rows3}</table>
   <div class="kpi" style="margin-top:14px"><div class="k"><b>11 / 15</b><span>killed by the PR's Java suites (+ C7 by the web-shell sync test)</span></div>
   <div class="k"><b>3</b><span>survivors = exactly the three unresolved bot Suggestions</span></div>
   <div class="k"><b>14 / 15</b><span>killed with the candidate; baseline still 15/15 green, Checkstyle 0</span></div></div>
   <div class="note">Candidate: accept exactly 100 unique <code>artifact_refs</code> (and reject 101 from the same instance); accept <code>state_changed</code> with <code>runtime_state</code>; in <code>pinEventFieldTotality</code> count only single-name <code>not.anyOf</code> branches as forbidding a field. All three are test-strength gaps; none is a contract defect.</div>`);

// Card 4: merge order and doc drift
const card4 = page(
  'Version numbering and doc drift after the /resolve renumber',
  'origin/main 19684f37 · trial merges with git merge-tree (no worktree changes)',
  `<h2>Contract version claimed by each branch</h2>
   <table><tr><th>ref</th><th>info.version</th><th>newest history sentence</th><th>merge with main</th></tr>
   <tr><td>origin/main</td><td>1.22.0</td><td>v1.22 (G0, #12955)</td><td class="dim">—</td></tr>
   <tr class="hy"><td>#12998 (this PR)</td><td>1.23.0</td><td>v1.23 task event + cancel semantics</td><td class="ok">clean</td></tr>
   <tr class="hy"><td>#12946 (H1 Hosted MCP)</td><td>1.23.0</td><td>v1.23 (H1)</td><td class="ok">clean alone</td></tr>
   <tr><td>#13037 (O3 tool results)</td><td>1.22.0</td><td>v1.22</td><td class="warn">already behind main's v1.22</td></tr></table>
   <h2>main + #12998, then merge #12946</h2>
   <table><tr><th>line</th><th>git result</th></tr>
   <tr><td><code>"version": "1.23.0"</code></td><td class="warn">identical on both sides → merges silently, no conflict</td></tr>
   <tr><td><code>"description": "… v1.23 …"</code></td><td class="bad">CONFLICT (content) — the only conflict</td></tr></table>
   <h2>References left at v1.22.0 after 05047ae6 renumbered the contract</h2>
   <table><tr><th>where</th><th>text</th></tr>
   <tr><td>docs/design/…task-contract.md:52</td><td>"settles A1–A8 … in contract v1.22.0"</td></tr>
   <tr><td>docs/design/…task-contract.zh-CN.md:41</td><td>"在契约 v1.22.0 中确定"</td></tr>
   <tr><td>PR description</td><td>"Contract v1.22.0 …", "The contract version is 1.22.0 on top of main's 1.21.0."</td></tr></table>
   <div class="note warnb">Whichever of #12998 / #12946 lands second must bump to 1.24.0 by hand: git flags only the description, and a resolver that concatenates both sentences keeps two v1.23 entries under one version. The last /resolve fixed the JSON but not the two design-doc lines.</div>`);

const cards = { '01-zero-runtime-change-live-ab': card1, '02-ajv-differential-generator': card2, '03-mutation-matrix': card3, '04-version-and-doc-drift': card4 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1300, height: 900 } });
const p = await ctx.newPage();
for (const [name, html] of Object.entries(cards)) {
  await writeFile(`${OUT}/${name}.html`, html);
  await p.setContent(html);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  const width = await p.evaluate(() => document.querySelector('#card').scrollWidth);
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'clipped cells:', clipped, 'card scrollWidth:', width);
}
await browser.close();
