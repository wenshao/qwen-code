// Compose evidence figures for the PR #12531 round-2 report.
// usage: node compose.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const V = '/Users/wenshao/git/verify-pr12531';
const OUT = path.resolve(process.argv[2] ?? `${V}/publish/pr-12531-r2`);
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const browser = await chromium.launch();
async function shoot(html, file, width) {
  const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('#card');
  await el.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log('wrote', file);
}
const BASE_CSS = `
  *{box-sizing:border-box} body{margin:0;background:#fff;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
  #card{display:inline-block;padding:20px 24px;background:#fff}
  h1{font-size:19px;margin:0 0 4px} .sub{color:#57606a;margin:0 0 14px;font-size:13px}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
`;

// ---------- Fig 1: U1 real TUI, three arms ----------
{
  const arms = [
    ['base', 'base b3dda468f2 (main)', 'blocked by the deny rule — server log: 0 calls'],
    ['head', 'head dbab8f48f0 (this PR)', 'tool runs with no prompt — server log: 1 call'],
    ['candC', 'head + restrictive-only fallback (suggested)', 'blocked again — server log: 0 calls'],
  ];
  const S = 0.62; // display scale of the 2056px-wide capture
  const cropsFor = (arm) => [[0, 82], [546, arm === 'head' ? 748 : 858]]; // title bar + transcript, original px
  const panel = (arm, label, note) => {
    const src = 'data:image/png;base64,' + fs.readFileSync(`${V}/runs/tui/U1-${arm}.png`).toString('base64');
    const parts = cropsFor(arm).map(([y0, y1]) => `<div style="width:${2056 * S}px;height:${(y1 - y0) * S}px;overflow:hidden"><img src="${src}" style="width:${2056 * S}px;margin-top:${-y0 * S}px;display:block"></div>`).join('');
    const bad = arm === 'head';
    return `<div class="pane"><div class="lab"><b>${esc(label)}</b> <span class="${bad ? 'bad' : 'ok'}">${esc(note)}</span></div><div class="shot">${parts}</div></div>`;
  };
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    .pane{margin:0 0 14px} .lab{margin:0 0 6px;font-size:14px} .shot{border-radius:10px;overflow:hidden;background:#0d1117;display:inline-block}
    .bad{color:#cf222e;font-weight:600} .ok{color:#1a7f37;font-weight:600}
  </style></head><body><div id="card">
    <h1>R18-1 in the real TUI: a wildcard deny copied from <code>/tools</code> stops matching</h1>
    <p class="sub">Trusted server <code>https://mcp.services.example.internal/sse?team=infra</code> (52-char key, <code>trust: true</code>), tool <code>deploy</code>.
    Registered name <code>mcp__https___mcp_services_example_internal_sse_team_inf_01wr6ix</code> (63 chars, <code>__</code> cut by the budget).<br>
    <code>permissions.deny: ["mcp__https___mcp_services_example_internal_sse_team_inf_01wr6ix*"]</code> · default approval mode · scripted model calls the tool by its registered name.</p>
    ${arms.map((a) => panel(...a)).join('')}
  </div></body></html>`;
  await shoot(html, '01-tui-u1-r18-fail-open.png', 1360);
}

// ---------- Fig 2: real-CLI matrix ----------
{
  const bh = read(`${V}/runs/bh/results.json`);
  const cA = read(`${V}/runs/cand/results.json`).filter((r) => r.arm === 'candA');
  const cC = read(`${V}/runs/candC-final/results.json`);
  const acp = read(`${V}/runs/acp/acp-results.json`);
  const rows = {};
  for (const r of [...bh, ...cA, ...cC]) (rows[r.id] ??= { meta: r })[r.arm] = r;
  for (const r of acp) (rows[r.id].acp ??= {})[r.arm] = r;
  const EXPECT = {
    S1: 'ask', S1c: 'ran', S1w: 'ask', S4: 'ask', S4c: 'ran',
    D1: 'block', D2: 'block', D3: 'block', D4: 'block', D5: 'block', D6: 'block', D7: 'block', D8: 'block',
    M1: 'block', M2: 'ran', M3: 'block', M4: 'ask', M5: 'ran',
    T0: 'ran', T1: 'block', T2: 'ask', T3: 'ask', T4: 'block', T5: 'ran',
    U0: 'ran', U1: 'block', U2: 'block', U3: 'block', U4: 'block', U5: 'block', U6: 'ask|ran', U7: 'ask', U8: 'block',
    A0: 'ran', A1: 'block', A2: 'block', A3: 'block', A4: 'block', A5: 'ran',
  };
  const norm = (v) => ({ 'EXECUTED': 'ran', 'DENY-RULE': 'block', 'NOT-AVAILABLE': 'block', 'ASK': 'ask' }[v] ?? v);
  const acpNorm = (r) => r.executed ? 'ran' : r.permissionRequests ? 'ask' : /is disabled|deny rule|denied/i.test(r.toolResult) ? 'block' : 'other';
  const LABEL = { ran: 'ran', block: 'blocked', ask: 'ask' };
  const cell = (got, exp, extra = '') => {
    const okSet = exp.split('|');
    let cls = 'ok';
    if (!okSet.includes(got)) cls = got === 'ran' || (got === 'ask' && exp === 'block') ? 'open' : 'closed';
    return `<td class="v ${cls} ${got}">${LABEL[got] ?? got}${extra}</td>`;
  };
  const GROUPS = { R: 'Previous round’s matrix (fail-open at 985683eb4d) — re-run at dbab8f48f0', T: 'R15-1: truncated legacy exact restrictions (24-char key, 40-char tool)', U: 'R18-1 (open Critical): wildcards copied from a budget-cut registration', A: 'Real subagent dispatch — disallowedTools is the only guard (YOLO)' };
  const ruleOf = (m) => {
    const parts = [];
    if (m.allow?.length) parts.push(`allow ${m.allow.join(', ')}`);
    if (m.ask?.length) parts.push(`ask ${m.ask.join(', ')}`);
    if (m.deny?.length) parts.push(`deny ${m.deny.join(', ')}`);
    if (m.disallowedTools?.length) parts.push(`disallowedTools ${m.disallowedTools.join(', ')}`);
    return parts.join(' · ') || '(no rules)';
  };
  let body = '';
  let lastGroup = '';
  for (const [id, r] of Object.entries(rows)) {
    const m = r.meta;
    if (m.group !== lastGroup) { body += `<tr class="g"><td colspan="11">${esc(GROUPS[m.group])}</td></tr>`; lastGroup = m.group; }
    const exp = EXPECT[id];
    const acpCells = ['base', 'head', 'candC'].map((a) => r.acp?.[a] ? cell(acpNorm(r.acp[a]), exp) : '<td class="v na">·</td>').join('');
    body += `<tr><td class="id">${id}</td><td class="t">${esc(m.title)}${m.trusted?.length ? ' <span class="tr">trusted</span>' : ''}<div class="mono r">${esc(ruleOf(m))}</div></td>
      <td class="e">${esc(exp.replace('|', ' or '))}</td>
      ${['base', 'head', 'candA', 'candC'].map((a) => cell(norm(r[a].verdict), exp)).join('')}${acpCells}</tr>`;
  }
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    table{border-collapse:collapse;font-size:12.5px} th,td{border:1px solid #d0d7de;padding:4px 7px;vertical-align:top}
    th{background:#f6f8fa;text-align:center;font-weight:600} tr.g td{background:#eef1f4;font-weight:600;font-size:12.5px;padding:5px 8px}
    td.id{font-weight:700;text-align:center} td.t{width:560px} .r{color:#57606a;margin-top:2px;word-break:break-all} .tr{font-size:10.5px;background:#ddf4ff;color:#0969da;border-radius:6px;padding:0 5px}
    td.e{text-align:center;color:#57606a;white-space:nowrap} td.v{text-align:center;white-space:nowrap;font-weight:600;min-width:64px}
    td.ran{background:#fff8c5} td.block{background:#dafbe1} td.ask{background:#ddf4ff} td.na{color:#8c959f}
    td.open{outline:3px solid #cf222e;outline-offset:-3px;color:#a40e26} td.closed{outline:2px dashed #8c959f;outline-offset:-3px}
    .legend span{display:inline-block;margin-right:14px}
  </style></head><body><div id="card">
    <h1>Real CLI matrix — PR #12531 @ dbab8f48f0 (39 scenarios × 4 arms, headless <code>qwen -p</code> + ACP subset)</h1>
    <p class="sub">Real stdio MCP servers (execution oracle = server-side call log), scripted OpenAI-compatible model, fresh HOME per run. base = merge-base b3dda468f2 · head = dbab8f48f0 · cand A = head + the discriminator proposed in the R18-1 thread · cand C = head + restrictive-only fallback (suggested below).</p>
    <p class="sub legend"><span><b style="outline:3px solid #cf222e;padding:0 4px">red box</b> fail-open vs expected</span><span><b style="outline:2px dashed #8c959f;padding:0 4px">dashed</b> fail-closed deviation (over-restricts)</span><span style="background:#fff8c5;padding:0 4px">ran</span><span style="background:#dafbe1;padding:0 4px">blocked (deny rule / disabled / filtered from subagent)</span><span style="background:#ddf4ff;padding:0 4px">ask (headless declines / ACP request_permission)</span></p>
    <table><thead><tr><th rowspan="2">id</th><th rowspan="2">scenario · rules</th><th rowspan="2">expected</th><th colspan="4">headless <code>qwen -p</code> (scheduler path)</th><th colspan="3">ACP <code>qwen --acp</code></th></tr>
    <tr><th>base</th><th>head</th><th>cand A</th><th>cand C</th><th>base</th><th>head</th><th>cand C</th></tr></thead><tbody>${body}</tbody></table>
  </div></body></html>`;
  await shoot(html, '02-real-cli-matrix.png', 1500);
}

// ---------- Fig 3: prefix sweep ----------
{
  const pr = read(`${V}/runs/probe/probe-r18.json`);
  const arms = [['base', 'base (main)'], ['head', 'head'], ['candA', 'cand A (author)'], ['candC', 'cand C (restrictive-only)']];
  const strip = (shape) => {
    const Ls = shape.rows.map((r) => r.L);
    const head = `<tr><th></th>${Ls.map((L) => `<th class="L">${L}</th>`).join('')}</tr>`;
    const line = (arm, label, kind) => `<tr><td class="al">${label} <span class="k">${kind}</span></td>${shape.rows.map((r) => {
      const v = r[arm][kind];
      const hit = v === kind;
      return `<td class="c ${hit ? (kind === 'deny' ? 'dh' : 'ah') : (kind === 'deny' ? 'dm' : 'am')}">${hit ? '✓' : '–'}</td>`;
    }).join('')}</tr>`;
    return `<div class="shape"><div class="sh"><code>${esc(shape.server)}</code> / <code>${esc(shape.tool)}</code> — raw ${shape.rawLen} chars → <code>${esc(shape.registered)}</code></div>
      <table>${head}${arms.map(([a, l]) => line(a, l, 'deny')).join('')}${arms.map(([a, l]) => line(a, l, 'allow')).join('')}</table></div>`;
  };
  const html = `<!doctype html><html><head><style>${BASE_CSS}
    .shape{margin:0 0 16px} .sh{margin:0 0 4px;font-size:13px}
    table{border-collapse:collapse;font-size:12px} th,td{border:1px solid #d0d7de;padding:2px 6px;text-align:center}
    th.L{background:#f6f8fa;min-width:30px} td.al{text-align:left;white-space:nowrap;min-width:250px} .k{color:#57606a;font-family:ui-monospace,Menlo,monospace}
    td.dh{background:#dafbe1;color:#1a7f37} td.dm{background:#ffebe9;color:#cf222e;font-weight:700}
    td.ah{background:#fff8c5;color:#9a6700} td.am{background:#f6f8fa;color:#8c959f}
  </style></head><body><div id="card">
    <h1>Which copied prefixes still match? <code>registered[:L] + "*"</code>, real producer + <code>PermissionManager.evaluate</code> with identity</h1>
    <p class="sub">deny rows: ✓ = the rule restricts the tool (green); – = falls through to <code>default</code>, i.e. a trusted server runs the tool (red).
    allow rows: ✓ = explicit grant; – = no grant (prompts). Registration keeps sanitized characters [0, 55) and appends <code>_&lt;hash&gt;</code>; for a key of ≥ 50 sanitized characters the <code>__</code> separator lies at or past index 55 and is lost, so L ≥ 56 reaches past the cut.</p>
    ${pr.shapes.slice(0, 2).map(strip).join('')}
    <p class="sub">The PR's own fixtures <code>'k'.repeat(53)</code> and <code>'a.b-' + 'k'.repeat(50)</code> (<code>mcp-server-rule-collision.test.ts:644-645</code>) give exactly the first table's pattern on every arm (raw data: <code>data/probe-r18.txt</code>).</p>
    <p class="sub">Sibling key <code>…?team=infra-staging</code> under <code>${esc(pr.sibling.rule)}</code> (deny/allow):
      ${arms.map(([a, l]) => `${esc(l)} = <b>${pr.sibling[a].deny}/${pr.sibling[a].allow}</b>`).join(' · ')}.
      Pins unchanged on head / cand A / cand C: ${pr.pins.map((p) => `<code>${p.kind} ${esc(p.rule)}</code> → ${esc(p.server)}: ${p.head}/${p.candA}/${p.candC}`).join('; ')}.</p>
  </div></body></html>`;
  await shoot(html, '03-prefix-sweep.png', 1100);
}
await browser.close();
