// Evidence cards for the PR #13931 verification report: node gen.mjs -> fig/*.png (Playwright, 2x).
import fs from 'node:fs';
import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';

const RES = '/Users/wenshao/pr13931-rig/results';
const OUT = '/Users/wenshao/pr13931-rig/fig';
const J = (f) => JSON.parse(fs.readFileSync(`${RES}/${f}`, 'utf8'));
const short = (v) => { const t = String(v ?? ''); return t.length > 44 ? `${t.slice(0, 22)}…${t.slice(-8)}` : t; };
const esc = (s) => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const css = `
body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#e6edf3}
.card{width:1360px;padding:28px 32px 26px;box-sizing:border-box;background:#0d1117}
h1{font-size:25px;margin:0 0 4px;font-weight:650}
.sub{color:#8b949e;font-size:15px;margin-bottom:18px}
table{border-collapse:collapse;width:100%;font-size:15px;margin:6px 0 14px}
th{color:#8b949e;font-weight:600;text-align:left;border-bottom:1px solid #30363d;padding:7px 10px}
td{border-bottom:1px solid #21262d;padding:7px 10px;vertical-align:top}
td.mono,code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px}
.ok{color:#3fb950;font-weight:600}.bad{color:#f85149;font-weight:600}.warn{color:#d29922;font-weight:600}.dim{color:#8b949e}
pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;line-height:1.5;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:8px 0 14px;white-space:pre;overflow:hidden}
.note{border-left:4px solid #d29922;padding:8px 14px;background:#161b22;color:#e6edf3;font-size:15px;margin-top:6px;line-height:1.5}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
.h2{font-size:17px;font-weight:650;margin:14px 0 4px}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const cell = (v, good) => `<td class="${good === true ? 'ok' : good === false ? 'bad' : 'dim'}">${esc(v)}</td>`;

const cards = {};

// ---- 1. root cause ----
{
  const h = J('l4-head.json');
  const d = h.A_rest_fg_delete.identityDiff[0];
  const rows = Object.entries(d.identity).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono">${esc(short(v.manifest))}</td><td class="mono">${esc(short(v.expected))}</td>${cell(v.ok ? 'match' : 'MISMATCH', v.ok)}</tr>`).join('');
  const it = fs.readFileSync(`${RES}/it-identity.txt`, 'utf8');
  cards['01-root-cause'] = page(
    'Root cause: Shell v2 close/delete compares the capture digest with the wrong reference field',
    `WorkspaceProfileLifecycleVerifier.verifyManifest (head 86f034e9, line 284) · real stack session ${h.A_rest_fg_delete.sid.slice(0, 8)} after one approved foreground Shell call`,
    `<table><tr><th>identity field (verifyManifest guard)</th><th>stored manifest</th><th>verifier expects</th><th></th></tr>${rows}</table>
<div class="h2">Same rows from the CI-recipe IT database (HostedPublicWorkspaceIT, head and trial merge)</div>
<pre>${esc(it)}</pre>
<div class="note red">Every runtimeProtocol 3 execution stores both digests. <code>WorkspaceRuntimeTransport.wireReference</code> hands the worker
<code>reference.inputDigest</code> as its <code>argsDigest</code>, so the capture identity is the bare inputDigest. The verifier reads the outer
<code>sha256:</code> argsDigest instead, throws <code>workspace_lifecycle_resources_unsettled</code> on every retry, and the operation stays RECOVERY_BLOCKED.
The unit fixtures build references without <code>inputDigest</code>/<code>runtimeProtocol</code>, so only the Linux IT reaches this.</div>`);
}

// ---- 2. real stack matrix ----
{
  const arms = [['head 86f034e9', 'l4-head.json'], ['trial merge (+main e9789d09)', 'l4-merge.json'], ['candidate (head + 6-line fix)', 'l4-cand.json']]
    .filter(([, f]) => fs.existsSync(`${RES}/${f}`)).map(([n, f]) => [n, J(f)]);
  const sc = [
    ['A', 'REST: approved foreground Shell, then DELETE', 'A_rest_fg_delete', 'completed'],
    ['C', 'REST: approved foreground Shell, then close', 'C_rest_fg_close', 'completed'],
    ['D', 'WebShell: approved foreground Shell, then delete', 'D_web_fg_delete', 'completed'],
    ['B', 'REST: idle Session (no Shell call), DELETE', 'B_rest_idle_delete', 'completed'],
    ['E', 'REST: Shell call denied, then DELETE', 'E_rest_deny_delete', 'completed'],
  ];
  const fmt = (s) => {
    if (!s) return ['n/a', null];
    const st = s.op?.final?.status ?? s.admit;
    const ses = s.sessionAfter;
    const ms = s.op?.transitions?.find((t) => t.status === 'completed')?.atMs;
    return [`${st}${ms != null ? ` (≤${(ms / 1000).toFixed(1)} s)` : st === 'recovery_blocked' ? ' after 120 s' : ''} · Session ${ses}`, st === 'completed'];
  };
  const body = sc.map(([id, label, key]) => `<tr><td><b>${id}</b> ${esc(label)}</td>${arms.map(([, r]) => { const [t, g] = fmt(r[key]); return cell(t, g); }).join('')}</tr>`).join('');
  const comp = arms.map(([, r]) => r.A_rest_fg_delete ? `${r.A_rest_fg_delete.companionAfter}/${r.A_rest_fg_delete.sharedMarker ? 'kept' : 'LOST'}` : 'n/a');
  const v1 = fs.existsSync(`${RES}/v1off-head.json`) ? J('v1off-head.json').F_rest_fg_delete_v2off : null;
  const v1b = fs.existsSync(`${RES}/v1off-base.json`) ? J('v1off-base.json').F_rest_fg_delete_v2off : null;
  const resume = fs.existsSync(`${RES}/resume-cand.json`) ? J('resume-cand.json') : null;
  const resumeRows = resume ? Object.entries(resume.after).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td>${cell(`${resume.before[k].op} · ${resume.before[k].session}`, false)}${cell(`${v.op}${v.atMs != null ? ` after ${(v.atMs / 1000).toFixed(0)} s` : ''} · ${v.session}`, v.op === 'COMPLETED')}</tr>`).join('') : '';
  cards['02-real-stack'] = page(
    'Real stack: public Shell lifecycle v2 on Linux (durable local-process, MySQL 8.4)',
    'Spring fat jar + packaged Hosted Harness (dist/cli.js) + Runtime Broker workers + scripted model · QWEN_HOSTED_LIFECYCLE_V2_PROFILES=hosted-workspace-shell/1 · operation polled 120 s',
    `<table><tr><th>scenario</th>${arms.map(([n]) => `<th>${esc(n)}</th>`).join('')}</tr>${body}
<tr><td>A: companion Session / shared Workspace file</td>${comp.map((c) => cell(c, c === 'ACTIVE/kept')).join('')}</tr></table>
<table><tr><th>v2 advertisement off (default)</th><th>result</th></tr>
<tr><td>head, approved Shell then DELETE</td>${cell(v1 ? `${v1.admit} · ${v1.opRowCount} operation rows · Session ${v1.sessionAfter}` : 'n/a', v1 ? v1.admit.startsWith('409') : null)}</tr>
${v1b ? `<tr><td>base da224e61 (before), same steps</td>${cell(`${v1b.admit} · ${v1b.opRowCount} operation rows · Session ${v1b.sessionAfter}`, v1b.admit.startsWith('409'))}</tr>` : ''}</table>
${resume ? `<div class="h2">Upgrade path: head's stuck operations, Spring/Harness restarted on the candidate jar (same database, no data change)</div><table><tr><th>operation</th><th>before restart (head)</th><th>after restart (candidate)</th></tr>${resumeRows}</table>` : ''}
<div class="note red">Any Session that ran one approved foreground Shell command can no longer be closed or deleted through either surface; it stays CLOSING/DELETING with
the operation RECOVERY_BLOCKED (workspace_lifecycle_resources_unsettled). Sessions without a captured foreground result (B, E) complete within one 0.5 s poll.</div>`);
}

// ---- 3. CI + tests ----
{
  const t = J('tests.json');
  const rows = t.rows.map((r) => `<tr><td>${esc(r[0])}</td>${r.slice(1).map((c) => (c === null ? '<td class="dim">—</td>' : cell(c[0], c[1]))).join('')}</tr>`).join('');
  cards['03-tests'] = page(
    'CI legs and test matrix',
    t.sub,
    `<table><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows}</table>${t.note ? `<div class="note">${t.note}</div>` : ''}`);
}

fs.mkdirSync(`${OUT}/cards`, { recursive: true });
const browser = await chromium.launch();
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${OUT}/cards/${name}.html`, html);
  const p = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(`file://${OUT}/cards/${name}.html`);
  const clipped = await p.evaluate(() => { const edge = document.querySelector('.card').getBoundingClientRect().right - 31; return [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)).concat([...document.querySelectorAll('table,pre')].filter((e) => e.getBoundingClientRect().right > edge).map((e) => 'OVERFLOW ' + e.textContent.slice(0, 40))); });
  await (await p.$('.card')).screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
  await p.close();
}
await browser.close();
