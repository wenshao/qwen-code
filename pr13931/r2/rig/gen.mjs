// Evidence cards for the PR #13931 round-2 report (head 2ef8fba0): node gen.mjs -> fig2/*.png (Playwright, 2x).
import fs from 'node:fs';
import { chromium } from '/Users/wenshao/pr13674-rig/src-merge/node_modules/playwright/index.mjs';

const RES = '/Users/wenshao/pr13931-rig/results';
const OUT = '/Users/wenshao/pr13931-rig/fig2';
const J = (f) => JSON.parse(fs.readFileSync(`${RES}/${f}`, 'utf8'));
const short = (v, a = 10, b = 4) => { const t = String(v ?? '—'); return t.length > a + b + 2 ? `${t.slice(0, a)}…${t.slice(-b)}` : t; };
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
.note{border-left:4px solid #d29922;padding:8px 14px;background:#161b22;color:#e6edf3;font-size:15px;margin-top:6px;line-height:1.5}
.note.red{border-color:#f85149}.note.green{border-color:#3fb950}
.h2{font-size:17px;font-weight:650;margin:14px 0 4px}
`;
const page = (title, sub, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="card"><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>${body}</div></body></html>`;
const cell = (v, good, mono = false) => `<td class="${[good === true ? 'ok' : good === false ? 'bad' : 'dim', mono ? 'mono' : ''].join(' ').trim()}">${esc(v)}</td>`;

const cards = {};

// ---- 1. fix check: every real-stack Shell capture, field by field ----
{
  const sources = [['head2', 'l4-head2.json'], ['head2', 'l4x-head2.json'], ['merge2', 'l4-merge2.json'], ['merge2', 'l4x-merge2.json']];
  const rows = [];
  for (const [arm, f] of sources) {
    const d = J(f);
    for (const [key, s] of Object.entries(d)) {
      if (!Array.isArray(s?.identityBefore)) continue;
      for (const it of s.identityBefore.filter((i) => i.identity)) {
        const id = it.identity;
        const otherEntries = Object.entries(id).filter(([k]) => !k.startsWith('invocationDigest~'));
        const others = otherEntries.every(([, v]) => v.ok);
        rows.push(`<tr><td>${esc(arm)}</td><td>${esc(key.split('_')[0])}</td><td class="mono">${esc(`${it.runtimeProtocol} / ${it.dispatchMode}`)}</td>`
          + `<td class="mono">${esc(short(id['invocationDigest~reference.inputDigest'].manifest))}</td>`
          + `<td class="mono">${esc(short(id['invocationDigest~reference.inputDigest'].expected))}</td>`
          + `<td class="mono">${esc(short(id['invocationDigest~reference.argsDigest'].expected, 14, 4))}</td>`
          + cell(id['invocationDigest~reference.argsDigest'].ok ? 'match' : 'mismatch → blocked', id['invocationDigest~reference.argsDigest'].ok)
          + cell(id['invocationDigest~2ef8fba0 selection'].ok ? 'match' : 'MISMATCH', id['invocationDigest~2ef8fba0 selection'].ok)
          + cell(others ? `all ${otherEntries.length} match` : 'MISMATCH', others)
          + cell(`${s.op?.final?.status} · ${s.sessionAfter}`, s.op?.final?.status === 'completed')
          + '</tr>');
      }
    }
  }
  cards['01-fix-check'] = page(
    'F1 on the exact head: every real-stack Shell capture now passes the verifier identity guard',
    `WorkspaceProfileLifecycleVerifier.verifyManifest @ 2ef8fba0 · rows read from MySQL after the turn, before close/delete · head2 = 2ef8fba0 · merge2 = head2 + main 6ececc39 · ${rows.length} Shell executions`,
    `<table><tr><th>arm</th><th>scen.</th><th>runtimeProtocol / dispatchMode</th><th>manifest invocationDigest</th><th>reference.inputDigest</th><th>reference.argsDigest</th><th>86f034e9 guard (argsDigest)</th><th>2ef8fba0 guard</th><th>other identity fields</th><th>close/delete</th></tr>${rows.join('')}</table>
<div class="h2">Which digest the worker receives, by dispatch path (code trace at 2ef8fba0)</div>
<table><tr><th>saved reference</th><th>how it reaches the worker</th><th>digest in the capture identity</th><th>2ef8fba0 compares</th></tr>
<tr><td class="mono">runtimeProtocol 3 + deferred</td><td>public foreground Shell (all rows above) · <code>WorkspaceRuntimeTransport.wireReference</code> puts <code>inputDigest</code> into the wire <code>argsDigest</code></td><td class="mono">bare inputDigest</td>${cell('inputDigest (hex64 required)', true)}</tr>
<tr><td class="mono">deferred_v3 (+ payloadDigest, publicationId)</td><td>O2 publication · <code>HttpRuntimeTransport.v3Body → referenceIdentity</code> sends <code>reference.argsDigest</code>. Background Shell/Monitor holds are only admitted from this path (<code>RuntimeBrokerService.admitBackgroundProcess</code>)</td><td class="mono">sha256:argsDigest</td>${cell('argsDigest', true)}</tr>
<tr><td class="mono">background_v3_process / _monitor</td><td>hold row; its argsDigest is the start's payload digest, never a capture identity</td><td class="dim">—</td>${cell('start record only', true)}</tr></table>
<div class="note green">The broker's stage step only lets <code>inputDigest</code> appear together with <code>runtimeProtocol: 3</code>, and that combination is always saved as <code>dispatchMode: deferred</code>. So the PR's exact predicate and a field-presence rule give the same answer on every reference production can save; the PR's version also rejects a malformed inputDigest.</div>`);
}

// ---- 2. real stack matrix, round 1 vs round 2 ----
{
  const arms = [['round 1: head 86f034e9', ['l4-head.json']], ['head2 2ef8fba0', ['l4-head2.json', 'l4x-head2.json']], ['merge2 (+ main 6ececc39)', ['l4-merge2.json', 'l4x-merge2.json']]]
    .map(([n, fs_]) => [n, Object.assign({}, ...fs_.filter((f) => fs.existsSync(`${RES}/${f}`)).map(J))]);
  const sc = [
    ['A', 'REST: approved foreground Shell, then DELETE', 'A_rest_fg_delete'],
    ['C', 'REST: approved foreground Shell, then close', 'C_rest_fg_close'],
    ['D', 'WebShell: approved foreground Shell, then delete', 'D_web_fg_delete'],
    ['B', 'REST: idle Session (no Shell call), DELETE', 'B_rest_idle_delete'],
    ['E', 'REST: Shell call denied, then DELETE', 'E_rest_deny_delete'],
    ['G', 'new: two approved Shell calls in one turn, DELETE', 'G_rest_fg2_delete'],
    ['H', 'new: Shell exits 3 (executionStatus error), DELETE', 'H_rest_fgx_delete'],
    ['K', 'new: 1 MiB stdout capture, DELETE', 'K_rest_fgbig_delete'],
  ];
  const fmt = (s) => {
    if (!s) return ['not run', null];
    const st = s.op?.final?.status ?? s.admit;
    const ms = s.op?.transitions?.find((t) => t.status === 'completed')?.atMs;
    return [`${st}${ms != null ? ` (≤${(ms / 1000).toFixed(1)} s)` : st === 'recovery_blocked' ? ' after 120 s' : ''} · ${s.sessionAfter}`, st === 'completed'];
  };
  const body = sc.map(([id, label, key]) => `<tr><td><b>${id}</b> ${esc(label)}</td>${arms.map(([, r]) => { const [t, g] = fmt(r[key]); return cell(t, g); }).join('')}</tr>`).join('');
  const comp = arms.map(([, r]) => r.A_rest_fg_delete ? `${r.A_rest_fg_delete.companionAfter} / ${r.A_rest_fg_delete.sharedMarker ? 'kept' : 'LOST'}` : 'n/a');
  const v1 = J('v1off-head2.json').F_rest_fg_delete_v2off;
  const v1old = J('v1off-head.json').F_rest_fg_delete_v2off;
  const passOf = (files) => files.map(J).reduce((a, d) => [a[0] + d.checks.filter((c) => c.pass).length, a[1] + d.checks.length], [0, 0]);
  const p = [passOf(['l4-head.json']), passOf(['l4-head2.json', 'l4x-head2.json']), passOf(['l4-merge2.json', 'l4x-merge2.json'])];
  cards['02-real-stack'] = page(
    'Real stack: public Shell lifecycle v2 on Linux, round 1 vs the exact head',
    'Spring fat jar + packaged Hosted Harness (dist/cli.js) + Runtime Broker durable local-process workers + scripted model · MySQL 8.4.11 · QWEN_HOSTED_LIFECYCLE_V2_PROFILES=hosted-workspace-shell/1 · each operation polled 120 s',
    `<table><tr><th>scenario</th>${arms.map(([n]) => `<th>${esc(n)}</th>`).join('')}</tr>${body}
<tr><td>A: companion Session / shared Workspace file</td>${comp.map((c) => cell(c, c === 'ACTIVE / kept')).join('')}</tr>
<tr><td><b>checks passed</b></td>${p.map(([a, b]) => cell(`${a}/${b}`, a === b)).join('')}</tr></table>
<table><tr><th>v2 advertisement off (default)</th><th>round 1 head 86f034e9</th><th>head2 2ef8fba0</th></tr>
<tr><td>approved Shell, then DELETE</td>${cell(`${v1old.admit} · ${v1old.opRowCount} operation rows · ${v1old.sessionAfter}`, v1old.admit.startsWith('409'))}${cell(`${v1.admit} · ${v1.opRowCount} operation rows · ${v1.sessionAfter}`, v1.admit.startsWith('409'))}</tr></table>
<div class="note green">Every Session that ran an approved foreground Shell call (A, C, D, G, H, K) now closes or deletes on both surfaces within one 0.5 s poll, with the companion Session and the shared Workspace file intact. G, H and K are new this round: in each of them the manifest digest also differs from the outer argsDigest, so 86f034e9 would have blocked them too.</div>`);
}

// ---- 3. CI + tests ----
if (fs.existsSync(`${RES}/tests2.json`)) {
  const t = J('tests2.json');
  const rows = t.rows.map((r) => `<tr><td>${esc(r[0])}</td>${r.slice(1).map((c) => (c === null ? '<td class="dim">—</td>' : cell(c[0], c[1]))).join('')}</tr>`).join('');
  cards['03-tests'] = page('CI legs, tests and mutation probes', t.sub,
    `<table><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows}</table>${t.note ? `<div class="note">${t.note}</div>` : ''}`);
}

fs.mkdirSync(`${OUT}/cards`, { recursive: true });
const browser = await chromium.launch();
for (const [name, html] of Object.entries(cards)) {
  fs.writeFileSync(`${OUT}/cards/${name}.html`, html);
  const pg = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  await pg.goto(`file://${OUT}/cards/${name}.html`);
  const clipped = await pg.evaluate(() => { const edge = document.querySelector('.card').getBoundingClientRect().right - 31; return [...document.querySelectorAll('pre,td')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 60)).concat([...document.querySelectorAll('table,pre')].filter((e) => e.getBoundingClientRect().right > edge).map((e) => 'OVERFLOW ' + e.textContent.slice(0, 40))); });
  await (await pg.$('.card')).screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, clipped.length ? `CLIPPED: ${JSON.stringify(clipped)}` : 'ok');
  await pg.close();
}
await browser.close();
