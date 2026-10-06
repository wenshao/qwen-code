// Compose evidence figures for the PR #12531 round-4 report (head 7e489a5b33).
// usage: node compose4.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS } from './scenarios.mjs';

const V = '/root/verify/pr12531-r4';
const OUT = path.resolve(process.argv[2] ?? `${V}/publish/pr-12531-r4`);
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await chromium.launch();
async function shoot(html, file, width) {
  const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const card = await page.$('#card');
  const box = await card.boundingBox();
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
const T = `${V}/runs/tui`;

// ---------- Fig 1: N8 (new family B) ----------
{
  const html = `<!doctype html><html><head><style>${BASE_CSS}</style></head><body><div id="card">
    <h1>New at <code>7e489a5b33</code>: a deny written with the raw server key and one trailing underscore no longer matches</h1>
    <p class="sub">Trusted server <code>zybio.db</code> (<code>trust: true</code>), tool <code>search_pubmed</code>, registered as <code>mcp__zybio_db__search_pubmed_02a87mm</code>.
    <code>permissions.deny: ["mcp__zybio.db_*"]</code> · default approval mode · real interactive TUI, real stdio MCP server whose call log is the execution oracle.
    The registered spelling <code>mcp__zybio_db_*</code> is blocked on head (row N12); the raw spelling is not. Same result on ACP, in YOLO, for <code>ask</code> and for a subagent <code>disallowedTools</code> entry (rows N9–N11).</p>
    ${panel(`${T}/N8-base.png`, 'base b3dda468f2 (main)', 'blocked by the deny rule — server log: 0 calls', false, 545, 812)}
    ${panel(`${T}/N8-head.png`, 'head 7e489a5b33 (this PR)', 'tool runs with no prompt — server log: 1 call', true, 545, 733)}
    ${panel(`${T}/N8-candE.png`, 'head + candidate E (suggested)', 'blocked again — server log: 0 calls', false, 545, 812)}
  </div></body></html>`;
  await shoot(html, '01-tui-n8-raw-key-partial-separator.png', 1360);
}

// ---------- Fig 2: N2 (bot R26-2) ----------
{
  const html = `<!doctype html><html><head><style>${BASE_CSS}</style></head><body><div id="card">
    <h1>R26-2 reproduced by execution: <code>deny mcp__foo_*</code> skips tools whose name starts with <code>_</code></h1>
    <p class="sub">Trusted server <code>foo</code>, tool <code>_internal</code> (registered verbatim as <code>mcp__foo___internal</code>), <code>permissions.deny: ["mcp__foo_*"]</code>, default approval mode.
    On head the same rule blocks <code>foo/navigate</code> (row N5), so only the leading-underscore tool escapes. <code>mcp__github_*</code> vs <code>github/_admin_reset</code> behaves the same (N6/N7).</p>
    ${panel(`${T}/N2-base.png`, 'base b3dda468f2 (main)', 'blocked by the deny rule — server log: 0 calls', false, 545, 812)}
    ${panel(`${T}/N2-head.png`, 'head 7e489a5b33 (this PR)', 'tool runs with no prompt — server log: 1 call', true, 545, 733)}
    ${panel(`${T}/N2-candE.png`, 'head + candidate E (suggested)', 'blocked again — server log: 0 calls', false, 545, 812)}
  </div></body></html>`;
  await shoot(html, '02-tui-n2-underscore-tool.png', 1360);
}

// ---------- Fig 3: real-CLI matrix ----------
{
  const M = read(`${V}/runs/matrix/results.json`);
  const E = read(`${V}/runs/matrix-candE/results.json`);
  const cell = {};
  for (const r of [...M, ...E]) cell[`${r.id}/${r.arm}`] = r;
  const arms = ['base', 'prev', 'head', 'merge', 'candE'];
  const armHead = { base: 'base<br><code>b3dda468f2</code>', prev: 'prev (R3 cand D)<br><code>d62f5b79d2</code>', head: 'head<br><code>7e489a5b33</code>', merge: 'head+main<br><code>43a6e1e5e4</code>', candE: 'head +<br>cand E' };
  const word = { EXECUTED: 'ran', 'DENY-RULE': 'deny', ASK: 'ask', 'NOT-AVAILABLE': 'filtered', OTHER: 'other' };
  const groupTitle = {
    R: 'R — round-1 rows (#10199 grant collision, provider-safe deny spellings)', T: 'T — R15-1 truncated legacy exact restrictions', U: 'U — R18-1 budget-cut registrations',
    F: 'F — round-3 F13: key ending in _', K: 'K — round-3 R17-1: key containing __', N: 'N — round 4: partial-separator restrictive prefix (R24 fix, R26-2, new raw-key family)',
    E: 'E — round 4: legacy exact grant with a same-spelling server registered (R23-1)', P: 'P — round 4: ambiguity pool vs a subagent registry (R26-1)', Q: 'Q — round 4: PR test-plan nested-key rows', A: 'A — real subagent dispatch, disallowedTools only',
  };
  const restrictive = (sc) => (sc.deny?.length || sc.ask?.length || sc.agent?.disallowedTools?.length) > 0;
  let rows = '';
  let lastGroup = '';
  for (const sc of SCENARIOS) {
    if (sc.group !== lastGroup) { rows += `<tr class="g"><td colspan="7">${esc(groupTitle[sc.group] ?? sc.group)}</td></tr>`; lastGroup = sc.group; }
    const base = cell[`${sc.id}/base`]?.verdict;
    rows += `<tr><td class="id">${sc.id}</td><td class="t">${esc(sc.title)}</td>` + arms.map((a) => {
      const v = cell[`${sc.id}/${a}`]?.verdict ?? '-';
      const w = word[v] ?? v;
      let cls = '';
      if (restrictive(sc) && v === 'EXECUTED' && base !== 'EXECUTED' && sc.id !== 'A5') cls = 'failopen';
      else if (v === 'EXECUTED') cls = 'ran';
      else cls = 'stop';
      return `<td class="${cls}">${w}</td>`;
    }).join('') + '</tr>';
  }
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    table{border-collapse:collapse;font-size:12px} td,th{border:1px solid #d0d7de;padding:2px 7px;text-align:center;white-space:nowrap}
    th{background:#f6f8fa;font-weight:600;font-size:12px} td.t{text-align:left;max-width:560px;overflow:hidden;text-overflow:ellipsis}
    td.id{font-family:ui-monospace,Menlo,monospace} tr.g td{background:#f6f8fa;text-align:left;font-weight:600}
    td.failopen{background:#ffebe9;color:#cf222e;font-weight:700} td.ran{color:#57606a} td.stop{color:#1f2328}
  </style></head><body><div id="card">
    <h1>Real CLI (<code>qwen -p</code>), 83 scenarios × 5 arms — the MCP server's own call log decides “ran”</h1>
    <p class="sub">Fresh HOME per run; real stdio MCP servers; scripted OpenAI-compatible model that calls exactly the target tool. Red = a restriction (deny / ask / disallowedTools) that <b>main enforces</b> but the arm lets run. A5 is the PR's declared cross-server narrowing (a <code>foo.bar</code> entry no longer blocks server <code>foo_bar</code>) and is not marked.
    <code>head</code> and <code>head+main</code> agree on all 83 rows; <code>cand E</code> differs from head on exactly the 10 red rows.</p>
    <table><tr><th>id</th><th>scenario</th>${arms.map((a) => `<th>${armHead[a]}</th>`).join('')}</tr>${rows}</table>
  </div></body></html>`;
  await shoot(html, '03-real-cli-matrix.png', 1200);
}
await browser.close();
