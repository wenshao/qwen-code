// Compose evidence figures for the PR #12531 round-3 report (head 5bfea95dd7).
// usage: node compose3.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SCENARIOS } from './scenarios.mjs';

const V = '/Users/wenshao/git/verify-pr12531';
const OUT = path.resolve(process.argv[2] ?? `${V}/publish/pr-12531-r3`);
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await chromium.launch();
async function shoot(html, file, width) {
  const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await (await page.$('#card')).screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log('wrote', file);
}
const BASE_CSS = `
  *{box-sizing:border-box} body{margin:0;background:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
  #card{display:inline-block;padding:20px 24px;background:#fff}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#57606a;margin:0 0 14px;font-size:13px}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .pane{margin:0 0 14px} .lab{margin:0 0 6px;font-size:14px} .shot{border-radius:10px;overflow:hidden;background:#0d1117;display:inline-block}
  .bad{color:#cf222e;font-weight:600} .ok{color:#1a7f37;font-weight:600}
`;
const S = 0.62;
function panel(file, label, note, bad, y1) {
  const src = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  const parts = [[0, 82], [546, y1]].map(([a, b]) => `<div style="width:${2056 * S}px;height:${(b - a) * S}px;overflow:hidden"><img src="${src}" style="width:${2056 * S}px;margin-top:${-a * S}px;display:block"></div>`).join('');
  return `<div class="pane"><div class="lab"><b>${esc(label)}</b> <span class="${bad ? 'bad' : 'ok'}">${esc(note)}</span></div><div class="shot">${parts}</div></div>`;
}

// ---------- Fig 1: F1 real TUI, three arms ----------
{
  const T = `${V}/runs/tui3`;
  const html = `<!doctype html><html><head><style>${BASE_CSS}</style></head><body><div id="card">
    <h1>Still open at <code>5bfea95dd7</code>: a deny that is a literal prefix of the tool's own registered name stops matching</h1>
    <p class="sub">Trusted server <code>foo_</code> (<code>trust: true</code>), tool <code>_internal</code>, registered verbatim as <code>mcp__foo____internal</code>.
    <code>permissions.deny: ["mcp__foo____*"]</code> · default approval mode. The split reads the rule as server <code>foo</code>; the same happens for keys that contain <code>__</code> (<code>mcp__a__b___*</code>, rows K1–K3).</p>
    ${panel(`${T}/F1-base.png`, 'base b3dda468f2 (main)', 'blocked by the deny rule — server log: 0 calls', false, 858)}
    ${panel(`${T}/F1-head3.png`, 'head 5bfea95dd7 (this PR)', 'tool runs with no prompt — server log: 1 call', true, 748)}
    ${panel(`${T}/F1-candD.png`, 'head + candidate D (suggested)', 'blocked again — server log: 0 calls', false, 858)}
  </div></body></html>`;
  await shoot(html, '01-tui-f1-underscore-prefix-fail-open.png', 1360);
}

// ---------- Fig 3: U1 now blocked on head ----------
{
  const html = `<!doctype html><html><head><style>${BASE_CSS}</style></head><body><div id="card">
    <h1>R18-1 fixed at <code>5bfea95dd7</code>: the round-2 U1 case is blocked again in the real TUI</h1>
    <p class="sub">Same setup as round 2 Fig 1: trusted 52-char URL key, <code>permissions.deny: ["mcp__https___mcp_services_example_internal_sse_team_inf_01wr6ix*"]</code>.</p>
    ${panel(`${V}/runs/tui3/U1-head3.png`, 'head 5bfea95dd7', 'blocked by the deny rule — server log: 0 calls', false, 858)}
  </div></body></html>`;
  await shoot(html, '03-tui-u1-fixed-on-head.png', 1360);
}

// ---------- Fig 2: real-CLI matrix ----------
{
  const rows = {};
  const add = (list, armMap = {}) => { for (const r of list) { const arm = armMap[r.arm] ?? r.arm; (rows[r.id] ??= {})[arm] = r; } };
  add(read(`${V}/runs/bh/results.json`));
  add(read(`${V}/runs/bh-F/results.json`));
  add(read(`${V}/runs/K/results.json`));
  add(read(`${V}/runs/head3/results.json`));
  add(read(`${V}/runs/candD/results.json`));
  const acp = {};
  for (const r of read(`${V}/runs/acp3/acp-results.json`)) (acp[r.id] ??= {})[r.arm] = r;
  const EXPECT = {
    S1: 'ask', S1c: 'ran', S1w: 'ask', S4: 'ask', S4c: 'ran',
    D1: 'block', D2: 'block', D3: 'block', D4: 'block', D5: 'block', D6: 'block', D7: 'block', D8: 'block',
    M1: 'block', M2: 'ran', M3: 'block', M4: 'ask', M5: 'ran',
    T0: 'ran', T1: 'block', T2: 'ask', T3: 'ask', T4: 'block', T5: 'ran',
    U0: 'ran', U1: 'block', U2: 'block', U3: 'block', U4: 'block', U5: 'block', U6: 'ask|ran', U7: 'ask', U8: 'block',
    F0: 'ran', F1: 'block', F2: 'block', F3: 'ask', F4: 'block', F5: 'block', F6: 'block', F7: 'ask', F8: 'ran',
    K1: 'block', K2: 'block', K3: 'block', K4: 'block', K5: 'ask|ran',
    A0: 'ran', A1: 'block', A2: 'block', A3: 'block', A4: 'block', A5: 'ran',
  };
  const norm = (v) => ({ EXECUTED: 'ran', 'DENY-RULE': 'block', 'NOT-AVAILABLE': 'block', ASK: 'ask' }[v] ?? v);
  const acpNorm = (r) => r.executed ? 'ran' : r.permissionRequests ? 'ask' : /is disabled|deny rule|denied/i.test(r.toolResult) ? 'block' : 'other';
  const LABEL = { ran: 'ran', block: 'blocked', ask: 'ask' };
  const cell = (got, exp) => {
    if (got === undefined) return '<td class="v na">·</td>';
    let cls = 'ok';
    if (!exp.split('|').includes(got)) cls = got === 'ran' || (got === 'ask' && exp === 'block') ? 'open' : 'closed';
    return `<td class="v ${cls} ${got}">${LABEL[got] ?? got}</td>`;
  };
  const GROUPS = {
    R: 'Round-1 matrix (fail-open at 985683eb4d)',
    T: 'R15-1: truncated legacy exact restrictions',
    U: 'R18-1: wildcards copied from a budget-cut registration — fixed by 5bfea95dd7',
    F: 'Sandbox F13: key ending in `_`, pure-underscore tool prefix — still open',
    K: 'Bot R17-1 (round 19): key containing `__`, pure-underscore tool prefix — still open',
    A: 'Real subagent dispatch — disallowedTools is the only guard (YOLO)',
  };
  const ruleOf = (m) => {
    const p = [];
    if (m.allow?.length) p.push(`allow ${m.allow.join(', ')}`);
    if (m.ask?.length) p.push(`ask ${m.ask.join(', ')}`);
    if (m.deny?.length) p.push(`deny ${m.deny.join(', ')}`);
    if (m.disallowedTools?.length) p.push(`disallowedTools ${m.disallowedTools.join(', ')}`);
    return p.join(' · ') || '(no rules)';
  };
  let body = '', last = '';
  for (const sc of SCENARIOS) {
    const r = rows[sc.id];
    if (!r) continue;
    const m = r.head3 ?? r.base;
    if (sc.group !== last) { body += `<tr class="g"><td colspan="10">${esc(GROUPS[sc.group])}</td></tr>`; last = sc.group; }
    const exp = EXPECT[sc.id];
    body += `<tr><td class="id">${sc.id}</td><td class="t">${esc(sc.title)}${m.trusted?.length ? ' <span class="tr">trusted</span>' : ''}<div class="mono r">${esc(ruleOf(m))}</div></td>
      <td class="e">${esc(exp.replace('|', ' or '))}</td>
      ${['base', 'head', 'head3', 'candD'].map((a) => cell(r[a] ? norm(r[a].verdict) : undefined, exp)).join('')}
      ${['base', 'head3', 'candD'].map((a) => cell(acp[sc.id]?.[a] ? acpNorm(acp[sc.id][a]) : undefined, exp)).join('')}</tr>`;
  }
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    table{border-collapse:collapse;font-size:12.5px} th,td{border:1px solid #d0d7de;padding:4px 7px;vertical-align:top}
    th{background:#f6f8fa;text-align:center;font-weight:600} tr.g td{background:#eef1f4;font-weight:600;padding:5px 8px}
    td.id{font-weight:700;text-align:center} td.t{width:560px} .r{color:#57606a;margin-top:2px;word-break:break-all} .tr{font-size:10.5px;background:#ddf4ff;color:#0969da;border-radius:6px;padding:0 5px}
    td.e{text-align:center;color:#57606a;white-space:nowrap} td.v{text-align:center;white-space:nowrap;font-weight:600;min-width:64px}
    td.ran{background:#fff8c5} td.block{background:#dafbe1} td.ask{background:#ddf4ff} td.na{color:#8c959f}
    td.open{outline:3px solid #cf222e;outline-offset:-3px;color:#a40e26} td.closed{outline:2px dashed #8c959f;outline-offset:-3px}
    .legend span{display:inline-block;margin-right:14px}
  </style></head><body><div id="card">
    <h1>Real CLI matrix — PR #12531 @ 5bfea95dd7 (53 scenarios, headless <code>qwen -p</code> + ACP subset)</h1>
    <p class="sub">Real stdio MCP servers (execution oracle = server-side call log), scripted OpenAI-compatible model, fresh HOME per run. base = merge-base b3dda468f2 · prev = round-2 head dbab8f48f0 · head = 5bfea95dd7 (built from git) · cand D = head + the restrictive registered-prefix fallback below.</p>
    <p class="sub legend"><span><b style="outline:3px solid #cf222e;padding:0 4px">red box</b> fail-open vs expected</span><span><b style="outline:2px dashed #8c959f;padding:0 4px">dashed</b> fail-closed deviation (over-restricts)</span><span style="background:#fff8c5;padding:0 4px">ran</span><span style="background:#dafbe1;padding:0 4px">blocked (deny rule / disabled / filtered from subagent)</span><span style="background:#ddf4ff;padding:0 4px">ask</span></p>
    <table><thead><tr><th rowspan="2">id</th><th rowspan="2">scenario · rules</th><th rowspan="2">expected</th><th colspan="4">headless <code>qwen -p</code></th><th colspan="3">ACP <code>qwen --acp</code></th></tr>
    <tr><th>base</th><th>prev</th><th>head</th><th>cand D</th><th>base</th><th>head</th><th>cand D</th></tr></thead><tbody>${body}</tbody></table>
  </div></body></html>`;
  await shoot(html, '02-real-cli-matrix.png', 1500);
}
await browser.close();
