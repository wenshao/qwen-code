// Compose report figures (Playwright, 2x DPR). usage: node compose.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = '/root/verify/pr12531/publish/pr-12531';
const TUI = '/root/verify/pr12531/runs/tui2';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dataUri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

const CSS = `
  body { margin:0; background:#0d1117; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color:#e6edf3; }
  .fig { padding: 22px 24px 24px; display:inline-block; background:#0d1117; }
  h1 { font-size: 21px; margin: 0 0 4px; font-weight: 600; }
  .sub { font-size: 14px; color:#9da7b3; margin: 0 0 16px; font-family: ui-monospace, Menlo, monospace; }
  .grid { display:flex; gap:14px; align-items:flex-start; }
  .pane { width: 760px; border:1px solid #30363d; border-radius:8px; overflow:hidden; background:#0b0e14; }
  .lab { padding: 8px 12px; font-size: 14px; font-weight:600; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; }
  .lab .v { font-family: ui-monospace, Menlo, monospace; font-size: 13px; padding: 1px 8px; border-radius: 10px; }
  .bad { background:#5a1d1d; color:#ffb3b3; } .good { background:#163d22; color:#9be9a8; } .neutral { background:#1f2a3a; color:#a5c8ff; }
  .crop { height: 330px; overflow:hidden; }
  .crop img { width: 760px; display:block; }
  table { border-collapse: collapse; font-size: 13.5px; }
  th, td { border: 1px solid #30363d; padding: 6px 9px; text-align:left; vertical-align: top; }
  th { background:#161b22; font-weight:600; }
  td.code, .code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
  td.v { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; text-align:center; white-space:nowrap; }
  .EXECUTED { color:#ffa657; } .ASK { color:#79c0ff; } .DENY-RULE { color:#7ee787; }
  .flipgood { background:#123320; } .flipbad { background:#3d1515; } .same { }
  tr.sec td { background:#161b22; color:#9da7b3; font-weight:600; font-size: 12.5px; }
  .note { font-size: 12.5px; color:#9da7b3; margin-top: 10px; max-width: 1400px; line-height: 1.45; }
`;

async function shot(page, html, file) {
  await page.setViewportSize({ width: 2200, height: 1400 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.waitForTimeout(200);
  const el = await page.$('.fig');
  const box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await (await page.$('.fig')).screenshot({ path: path.join(OUT, file) });
  console.log('wrote', file, Math.ceil(box.width), Math.ceil(box.height));
}

function tuiFigure(title, sub, panes, offset) {
  return `<div class="fig"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div><div class="grid">${panes.map((p) => `
    <div class="pane"><div class="lab"><span>${esc(p.label)}</span><span class="v ${p.cls}">${esc(p.verdict)}</span></div>
    <div class="crop" style="height:${p.h ?? 330}px"><img src="${dataUri(p.img)}" style="margin-top:-${offset}px"></div></div>`).join('')}</div></div>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  // Fig 1: central claim, S1
  await shot(page, tuiFigure(
    'Fig 1 — #10199 variant 1 in the real TUI: allow "mcp__foo.bar", model calls server foo_bar\'s tool',
    'settings: permissions.allow ["mcp__foo.bar"] · two real stdio MCP servers foo.bar + foo_bar · default approval mode · hits = calls the foo_bar server actually received',
    [
      { label: 'base e083d6a6b8', verdict: 'executed, no prompt (hits=1)', cls: 'bad', img: `${TUI}/S1-base.png`, h: 238 },
      { label: 'PR head 985683eb4d', verdict: 'confirmation prompt (hits=0)', cls: 'good', img: `${TUI}/S1-head.png`, h: 238 },
      { label: 'head + suggested patch', verdict: 'confirmation prompt (hits=0)', cls: 'good', img: `${TUI}/S1-fix.png`, h: 238 },
    ], 214), '01-tui-s1-cross-server-allow.png');
  // Fig 2: regression, M1
  await shot(page, tuiFigure(
    'Fig 2 — regression at 1e29efde68 in the real TUI: deny "mcp__*" no longer blocks an MCP tool',
    'settings: permissions.deny ["mcp__*"] · one real stdio MCP server github (tool create_issue, provider-safe name) · YOLO mode · hits = calls the server actually received',
    [
      { label: 'base e083d6a6b8', verdict: 'blocked by deny rule (hits=0)', cls: 'good', img: `${TUI}/M1-base.png`, h: 218 },
      { label: 'PR head 985683eb4d', verdict: 'EXECUTED despite deny (hits=1)', cls: 'bad', img: `${TUI}/M1-head.png`, h: 218 },
      { label: 'head + suggested patch', verdict: 'blocked by deny rule (hits=0)', cls: 'good', img: `${TUI}/M1-fix.png`, h: 218 },
    ], 214), '02-tui-m1-deny-mcp-star-fail-open.png');

  // Fig 3: matrix
  const rows = JSON.parse(fs.readFileSync('/root/verify/pr12531/runs/final/results.json', 'utf8'));
  const fix2 = JSON.parse(fs.readFileSync('/root/verify/pr12531/runs/final-fix2/results.json', 'utf8'));
  const get = (id, arm) => (arm === 'fix' ? fix2 : rows).find((r) => r.id === id && r.arm === arm);
  const sections = [
    ['#10199 cross-server authorization — the PR\'s fix (head should stop executing)', [
      ['S1', 'allow mcp__foo.bar', 'foo_bar / evil'], ['S1w', 'allow mcp__foo.bar__*', 'foo_bar / evil'], ['S4', 'allow mcp__foo', 'foo_ / x  (registered mcp__foo___x)']]],
    ['own-server coverage and controls (should not change)', [
      ['S1c', 'allow mcp__foo.bar', 'foo.bar / evil'], ['S4c', 'allow mcp__foo', 'foo / deploy'], ['D4', 'deny mcp__zybio.db  (raw spelling)', 'zybio.db / search_pubmed'],
      ['D5', 'deny <exact registered name>', 'zybio.db / search_pubmed'], ['M3', 'deny mcp__github__*', 'github / create_issue'], ['M4', '(no rules), default', 'github / create_issue'], ['M5', '(no rules), yolo', 'github / create_issue']]],
    ['NEW at 1e29efde68 — rules base honours stop matching once mcpIdentity is threaded', [
      ['M1', 'deny mcp__*  (yolo)', 'github / create_issue'], ['M2', 'allow mcp__*  (default)', 'github / create_issue'],
      ['D1', 'deny mcp__zybio_db  (yolo)', 'zybio.db / search_pubmed'], ['D2', 'deny mcp__zybio_db__*  (yolo)', 'zybio.db / search_pubmed'],
      ['D8', 'deny mcp__foo_bar  (yolo)', 'foo:bar / a.b'], ['D3', 'deny mcp__github__search_*  (yolo)', 'github / search.repos'],
      ['D6', 'deny mcp__foo.bar__get_data_for_a_specific*  (yolo)', 'foo.bar / get+data_for_a_specific_…']]],
    ['carried forward from the sandbox round (F6) — not addressed by the patch', [
      ['D7', 'deny <truncated legacy exact spelling>  (yolo)', 'com.example.enterprise-search / a×32']]],
  ];
  const cell = (r, base) => {
    const cls = r.verdict === base.verdict ? 'same' : '';
    return `<td class="v ${r.verdict} ${cls}">${esc(r.verdict)}</td>`;
  };
  let body = '';
  for (const [title, list] of sections) {
    body += `<tr class="sec"><td colspan="6">${esc(title)}</td></tr>`;
    for (const [id, rule, target] of list) {
      const b = get(id, 'base'), h = get(id, 'head'), f = get(id, 'fix');
      const regress = title.startsWith('NEW') || title.startsWith('carried');
      const hcls = h.verdict === b.verdict ? '' : (regress ? 'flipbad' : 'flipgood');
      const fcls = f.verdict === b.verdict ? '' : (regress ? 'flipbad' : 'flipgood');
      body += `<tr><td class="code">${id}</td><td class="code">${esc(rule)}</td><td class="code">${esc(target)}</td>
        <td class="v ${b.verdict}">${esc(b.verdict)}</td><td class="v ${h.verdict} ${hcls}">${esc(h.verdict)}</td><td class="v ${f.verdict} ${fcls}">${esc(f.verdict)}</td></tr>`;
    }
  }
  const acp = [
    ...JSON.parse(fs.readFileSync('/root/verify/pr12531/runs/acp/acp-results.json', 'utf8')),
    ...JSON.parse(fs.readFileSync('/root/verify/pr12531/runs/acp2/acp-results.json', 'utf8')),
  ];
  const acpRow = (id, rule) => {
    const b = acp.find((r) => r.id === id && r.arm === 'base'), h = acp.find((r) => r.id === id && r.arm === 'head');
    const short = (r) => r.executed ? 'EXECUTED' : r.permissionRequests ? 'ASK (request_permission)' : /disabled/.test(r.toolResult) ? 'DENY (L1 "is disabled")' : r.verdict;
    return `<tr><td class="code">${id}</td><td class="code">${esc(rule)}</td><td class="v">${esc(short(b))}</td><td class="v">${esc(short(h))}</td></tr>`;
  };
  const html = `<div class="fig"><h1>Fig 3 — real-CLI matrix: real stdio MCP servers, scripted model, headless <span class="code">qwen -p</span> (scheduler path)</h1>
  <div class="sub">verdict = what the MCP server observed + the tool result the model received · EXECUTED = server got the call · ASK = needs confirmation (declined headless) · DENY-RULE = blocked citing the deny rule</div>
  <table><tr><th>id</th><th>rule (settings.json)</th><th>tool called (server / tool)</th><th>base e083d6a6b8</th><th>head 985683eb4d</th><th>head + suggested patch</th></tr>${body}</table>
  <div class="note">Green background = intended change vs base; red background = coverage lost vs base. 18 scenarios × 3 arms, each a fresh HOME + fresh MCP server processes. Raw rows, CLI stdout/stderr and model logs: data/matrix/.</div>
  <h1 style="margin-top:22px;font-size:18px">ACP session path (<span class="code">qwen --acp</span>, Session.ts)</h1>
  <table><tr><th>id</th><th>rule</th><th>base</th><th>head</th></tr>
  ${acpRow('S1', 'allow mcp__foo.bar → foo_bar/evil')}${acpRow('S4', 'allow mcp__foo → foo_/x')}${acpRow('M2', 'allow mcp__* → github/create_issue')}${acpRow('M1', 'deny mcp__* (yolo) → github/create_issue')}${acpRow('D1', 'deny mcp__zybio_db (yolo) → zybio.db/search_pubmed')}</table>
  <div class="note">On ACP the deny rows are still blocked because Session.ts's own L1 gate (pm.isToolEnabled) is called with aliases but without mcpIdentity, so it keeps the spelling logic; the L3/L4 context it builds does carry the identity, which is why "allow mcp__*" regresses there too.</div></div>`;
  await shot(page, html, '03-real-cli-matrix.png');
  await browser.close();
})();
