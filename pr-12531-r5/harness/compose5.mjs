// Compose evidence figures for the PR #12531 round-5 delta report (head 0a5e943bf1).
// usage: node compose5.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS } from './scenarios.mjs';

const V = '/root/verify/pr12531-r4';
const OUT = path.resolve(process.argv[2] ?? `${V}/publish/pr-12531-r5`);
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await chromium.launch();
async function shoot(html, file, width) {
  const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const box = await (await page.$('#card')).boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await (await page.$('#card')).screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log('wrote', file);
}
const BASE_CSS = `
  *{box-sizing:border-box} body{margin:0;background:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
  #card{display:inline-block;padding:20px 24px;background:#fff}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#57606a;margin:0 0 14px;font-size:13px;max-width:1300px}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .pane{margin:0 0 14px} .lab{margin:0 0 6px;font-size:14px} .shot{border-radius:10px;overflow:hidden;background:#0d1117;display:inline-block}
  .bad{color:#cf222e;font-weight:600} .ok{color:#1a7f37;font-weight:600}
`;
const S = 0.62;
// Crop a 2048-px-wide TerminalCapture PNG: title bar + transcript rows [y0, y1].
function panel(file, label, note, bad, y0, y1) {
  const src = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const parts = [[0, 82], [y0, y1]].map(([a, b]) => `<div style="width:${2048 * S}px;height:${(b - a) * S}px;overflow:hidden"><img src="${src}" style="width:${2048 * S}px;margin-top:${-a * S}px;display:block"></div>`).join('');
  return `<div class="pane"><div class="lab"><b>${esc(label)}</b> <span class="${bad ? 'bad' : 'ok'}">${esc(note)}</span></div><div class="shot">${parts}</div></div>`;
}
const T4 = `${V}/runs/tui`;
const T5 = `${V}/runs/tui-r5`;

const tui = [
  ['N8', '01-tui-n8-raw-key-fixed.png',
    'Family B closed at <code>0a5e943bf1</code>: <code>deny mcp__zybio.db_*</code> blocks the trusted <code>zybio.db</code> tool again',
    'Trusted server <code>zybio.db</code>, tool <code>search_pubmed</code> (registered <code>mcp__zybio_db__search_pubmed_02a87mm</code>), <code>permissions.deny: ["mcp__zybio.db_*"]</code>, default approval mode. Real interactive TUI; the stdio MCP server\'s own call log decides whether the tool ran.'],
  ['N2', '02-tui-n2-underscore-tool-fixed.png',
    'Family A (R26-2) closed at <code>0a5e943bf1</code>: <code>deny mcp__foo_*</code> blocks <code>foo/_internal</code> again',
    'Trusted server <code>foo</code>, tool <code>_internal</code> (registered <code>mcp__foo___internal</code>), <code>permissions.deny: ["mcp__foo_*"]</code>, default approval mode.'],
];
for (const [id, file, title, sub] of tui) {
  const html = `<!doctype html><html><head><style>${BASE_CSS}</style></head><body><div id="card">
    <h1>${title}</h1><p class="sub">${sub}</p>
    ${panel(`${T4}/${id}-head.png`, 'round-4 head 7e489a5b33', 'tool ran with no prompt — server log: 1 call', true, 545, 733)}
    ${panel(`${T5}/${id}-r5.png`, 'round-5 head 0a5e943bf1 (this PR now)', 'blocked by the deny rule — server log: 0 calls', false, 545, 812)}
    ${panel(`${T5}/${id}-base.png`, 'base b3dda468f2 (main), re-captured this round', 'blocked by the deny rule — server log: 0 calls', false, 545, 812)}
  </div></body></html>`;
  await shoot(html, file, 1360);
}

// ---------- Fig 3: what changed between the round-4 head and the round-5 head ----------
{
  const M4 = read(`${V}/publish/pr-12531-r4/data/matrix-base-prev-head-merge.json`);
  const E4 = read(`${V}/publish/pr-12531-r4/data/matrix-candE.json`);
  const R5 = read(`${V}/runs/matrix-r5/results.json`);
  const A4 = read(`${V}/publish/pr-12531-r4/data/acp-results.json`);
  const A5 = read(`${V}/runs/acp-r5/acp-results.json`);
  const D = read(`${V}/data/deny-diff-base-candE-r5.json`);
  const cell = {};
  for (const r of [...M4, ...E4, ...R5]) cell[`${r.id}/${r.arm}`] = r;
  const acp = {};
  for (const r of [...A4, ...A5]) acp[`${r.id}/${r.arm}`] = r;
  const arms = ['base', 'head', 'candE', 'r5'];
  const armHead = { base: 'base (main)<br><code>b3dda468f2</code>', head: 'R4 head<br><code>7e489a5b33</code>', candE: 'R4 head +<br>cand E', r5: '<b>R5 head</b><br><code>0a5e943bf1</code>' };
  const word = (v) => ({ EXECUTED: 'ran', 'DENY-RULE': 'deny', ASK: 'ask', 'NOT-AVAILABLE': 'filtered', OTHER: 'disabled' }[v] ?? (String(v).startsWith('ASK') ? 'ask (prompt)' : v));
  const cls = (v, base) => (v === 'EXECUTED' && base !== 'EXECUTED' ? 'failopen' : v === 'EXECUTED' ? 'ran' : 'stop');
  const changed = SCENARIOS.filter((sc) => cell[`${sc.id}/head`].verdict !== cell[`${sc.id}/r5`].verdict);
  let rows = `<tr class="g"><td colspan="6">Real CLI <code>qwen -p</code> — the ${changed.length} rows (of 83) whose verdict changed from the R4 head; the other ${83 - changed.length} are identical on all four columns</td></tr>`;
  for (const sc of changed) {
    const base = cell[`${sc.id}/base`].verdict;
    rows += `<tr><td class="id">${sc.id}</td><td class="t">${esc(sc.title)}</td>` + arms.map((a) => { const v = cell[`${sc.id}/${a}`].verdict; return `<td class="${cls(v, base)}">${word(v)}</td>`; }).join('') + '</tr>';
  }
  const acpIds = [...new Set(A5.map((r) => r.id))].filter((id) => acp[`${id}/head`].verdict !== acp[`${id}/r5`].verdict);
  rows += `<tr class="g"><td colspan="6">ACP (<code>qwen --acp</code>, permission requests answered "cancelled") — rows whose verdict changed; P1 and E1 unchanged</td></tr>`;
  for (const id of acpIds) {
    const sc = SCENARIOS.find((s) => s.id === id);
    const base = acp[`${id}/base`].verdict;
    rows += `<tr><td class="id">${id}</td><td class="t">${esc(sc.title)}</td>` + arms.map((a) => { const v = acp[`${id}/${a}`].verdict; return `<td class="${cls(v, base)}">${word(v)}</td>`; }).join('') + '</tr>';
  }
  const s = D.summary['base->r5'];
  const loss = (s.denyLoss + s.askLoss + s.l1Loss + s.saLoss);
  rows += `<tr class="g"><td colspan="6">Module differential — ${s.rows.toLocaleString('en-US')} rule × tool rows, losses against main summed over deny / ask / <code>isToolEnabled</code> / subagent <code>disallowedTools</code></td></tr>`;
  rows += `<tr><td class="id">D</td><td class="t">restrictions main enforces that the arm drops</td><td class="stop">—</td><td class="failopen">152 rows</td><td class="stop">0</td><td class="stop">${loss}</td></tr>`;
  rows += `<tr><td class="id">D′</td><td class="t">rows where R5 head differs from R4 head + cand E</td><td class="stop">—</td><td class="stop">—</td><td class="stop">—</td><td class="stop">${D.summary['candE<->r5'].differingRows}</td></tr>`;
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    table{border-collapse:collapse;font-size:12px} td,th{border:1px solid #d0d7de;padding:2px 8px;text-align:center;white-space:nowrap}
    th{background:#f6f8fa;font-weight:600;font-size:12px} td.t{text-align:left;max-width:600px;overflow:hidden;text-overflow:ellipsis}
    td.id{font-family:ui-monospace,Menlo,monospace} tr.g td{background:#f6f8fa;text-align:left;font-weight:600}
    td.failopen{background:#ffebe9;color:#cf222e;font-weight:700} td.ran{color:#57606a} td.stop{color:#1f2328}
  </style></head><body><div id="card">
    <h1>Round 5: the R4 head's fail-open rows are closed at <code>0a5e943bf1</code>, and nothing else moved</h1>
    <p class="sub">Same rig as round 4 (Linux x86_64, fresh HOME per run, real stdio MCP servers whose call log decides “ran”, scripted OpenAI-compatible model). Red = a restriction main enforces that the arm lets run.
    The R5 head is built from the PR branch itself (candidate E landed verbatim as <code>cdb3cb189e</code>, then main <code>43a6e1e5e4</code> merged in).</p>
    <table><tr><th>id</th><th>scenario</th>${arms.map((a) => `<th>${armHead[a]}</th>`).join('')}</tr>${rows}</table>
  </div></body></html>`;
  await shoot(html, '03-r4-to-r5-delta.png', 1200);
}
await browser.close();
