// VERIFICATION RIG ONLY (PR #13354): evidence figures from the probe JSON files (host side, Playwright from the head worktree).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13354-rig';
const require = createRequire('/Users/wenshao/git/qwen-code-pr13354-head/package.json');
const { chromium } = require('playwright');
const OUT = `${RIG}/fig`;
const res = (db, name) => JSON.parse(fs.readFileSync(`${RIG}/results/${db}/${name}.json`, 'utf8'));
const has = (db, name) => fs.existsSync(`${RIG}/results/${db}/${name}.json`);
const W = 1180;
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:${W}px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:12.5px;color:#52514e;margin:0 0 12px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0 8px}
  th,td{border:1px solid #d9d8d4;padding:4px 7px;text-align:left;vertical-align:top;line-height:1.38}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.num{text-align:right;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#f6f5f2;border:1px solid #d9d8d4;border-radius:6px;padding:7px 9px;margin:6px 0;white-space:pre;overflow:hidden;line-height:1.4}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}.mute{color:#6b6a66}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:6px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const cell = (c) => (typeof c === 'object' && c !== null ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`);
const table = (head, rows) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const MUTE = (t) => ({ c: 'mute', t });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cnt = (r) => `${r.pass}/${r.pass + r.fail}`;
const okc = (r, extra = '') => (r.fail === 0 ? OK(`${cnt(r)}${extra}`) : BAD(`${cnt(r)}${extra}`));
const figs = {};
const S = JSON.parse(fs.readFileSync(`${RIG}/fig/summary.json`, 'utf8'));

// ---------- figure 1: L3 behaviour matrix ----------
{
  const col = (arm) => S.matrix[arm] ?? {};
  const rows = S.rows.map((row) => [row.label, ...S.arms.map((a) => col(a)[row.key] ?? MUTE('—'))]);
  figs['01-l3-real-linux-matrix'] = page(
    'PR #13354 on a real Linux durable stack: ACTIVE files Session delete / close (L3)',
    `colima VM (Linux aarch64, 4 vCPU), isolated Docker network, no published ports: Spring fat jar with the durable local-process Runtime Broker, packaged Hosted Harness built from each arm, real worker processes, MySQL 8.4, deterministic model, a recording tap between Spring and the Harness. Arms: <code>base</code> = merge base <code>69d060e24c</code>; <code>facc4ab1f</code> and <code>c65e46d04e</code> = PR heads; <code>+main</code> = each head trial-merged with main (<code>85ea2358dc</code> / <code>91cf9ed6c0</code>). Cells are passed/total checks.`,
    table(['Scenario (both public and WebShell surfaces unless noted)', ...S.armLabels], rows) +
      `<div class="note nok">Every Session Spring creates today has no Hook catalog, so delete/close take the Store's no-Hook receipt + operation-authorized <code>detach</code> path (no <code>/lifecycle</code> call). That path holds across both surfaces, refusals, the DELETING fence, Spring TERM/KILL restarts, three SIGKILL takeover points, and a main → PR upgrade.</div>`,
  );
}

// ---------- figure 2: R3-1 ----------
{
  figs['02-r3-1-hooked-after-spring-restart'] = page(
    'R3-1 on the real stack: hooked close/delete after a Spring restart (Harness keeps the attachment)',
    'Spring never pins a Hook catalog, so the tap injects one into the Harness create (HTTP SessionEnd → /end, SessionDelete → /delete, recorded by a local endpoint). This simulates a hook-pinning coordinator; everything else is the real stack.',
    S.r31html,
  );
}

// ---------- figure 3: rollout + contention ----------
{
  figs['03-rollout-and-contention'] = page('Rollout order and ordinary-path cost', 'Same rig. Contention: one tenant, N concurrent Workspace Sessions over 4 Workspaces, each running one write→edit→read Turn (4 model calls, 3 tools); MySQL global-status deltas over the rounds.', S.rollhtml);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 1000 } });
const p = await ctx.newPage();
for (const [name, html] of Object.entries(figs)) {
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  await p.goto(`file://${OUT}/${name}.html`);
  const clipped = await p.evaluate(() => [...document.querySelectorAll('pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)));
  if (clipped.length) console.log('CLIPPED in', name, clipped);
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log('wrote', name);
}
await browser.close();
