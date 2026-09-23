// Renders the R3 figures from the raw matrix summary and probe JSON (no hand-typed numbers).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const SCR = process.argv[2];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ---- matrix
const res = {};
let cur;
for (const line of fs.readFileSync(`${SCR}/r3/out/matrix/summary.txt`, 'utf8').split('\n')) {
  const m = line.match(/^(\w+) (\S+) rc=\d+ tests=(\d+) passed=(\d+) failed=(\d+)/);
  if (m) { cur = { arm: m[1], mut: m[2], tests: +m[3], failed: +m[5], names: [] }; (res[m[1]] ??= {})[m[2]] = cur; continue; }
  if (cur && line.startsWith('   x ')) cur.names.push(line.slice(5));
}
const ROWS = [
  ['M2_rewind_admission', 'rewind admission term removed'],
  ['M16_rewind_relocated', 'rewind term moved into queue callback (R5-2)'],
  ['M3_branch_admission', 'branch admission term removed'],
  ['M4_branch_callback', 'branch queue-callback term removed'],
  ['M6_fork_admission', 'fork admission term removed'],
  ['M7_fork_callback', 'fork queue-callback term removed'],
  ['M9_cd_guard', 'cd guard term removed'],
  ['M10_entryHasLocalWork', 'entryHasLocalWork term removed'],
  ['M17_projection_drops_turn', 'summary projection ignores the turn (R6-1)'],
  ['M15_release_skips_child', 'release closes without asking child (R4-2)'],
];
const COLS = [['base', 'merge-base tests'], ['r2', 'R2 tests<br>02665c2c'], ['r3', 'PR head tests<br>fe6ca099'], ['prop', 'head + proposed<br>patch (+20/−7)'], ['r3settled', 'head, cd fixture<br>settled (R5-3)']];
const retention = (r) => r.names.some((n) => n.includes('retains a detached session'));
function cell(arm, mut) {
  const r = res[arm]?.[mut];
  if (!r) return '<td class="na">not run</td>';
  if (mut === 'M15_release_skips_child') {
    return retention(r) ? `<td class="caught">✓ retention test fails<small>${r.failed} failing in suite</small></td>` : `<td class="miss">— retention test passes<small>${r.failed} other tests fail</small></td>`;
  }
  return r.failed ? `<td class="caught">✓ caught<small>${r.failed} failing</small></td>` : '<td class="miss">— survives</td>';
}
const ctrl = COLS.map(([a]) => res[a]?.none ? `${res[a].none.tests - res[a].none.failed}/${res[a].none.tests}` : 'n/a');
const css = `body{margin:0;background:#fcfcfb;font:14px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2328}
.wrap{padding:22px 26px;display:inline-block}h1{font-size:18px;margin:0 0 4px}p.sub{margin:0 0 14px;color:#57606a;font-size:13px}
table{border-collapse:separate;border-spacing:2px}th{font-weight:600;font-size:12.5px;color:#424a53;padding:6px 8px;text-align:center;vertical-align:bottom}
th.l{text-align:left}td{padding:7px 10px;text-align:center;border-radius:4px;font-size:13px;min-width:120px}
td.l{text-align:left;background:#f1f1ef;min-width:0;white-space:nowrap}td.l code{font-size:12px;color:#57606a}
td.caught{background:#dff3df;color:#0b5d0b;font-weight:600}td.miss{background:#eeeeec;color:#57606a}td.na{background:#fcfcfb;color:#8c959f;font-style:italic}
td small{display:block;font-weight:400;font-size:11px;color:#57606a}tr.ctrl td{background:#fcfcfb;color:#57606a;font-size:12px}
.note{margin-top:12px;color:#57606a;font-size:12px;max-width:980px}`;
const html1 = `<html><head><style>${css}</style></head><body><div class="wrap">
<h1>PR #12250 R3 — whole <code>packages/acp-bridge</code> suite, one run per mutant</h1>
<p class="sub">Production code identical in every column (the PR touches none); only the test files differ. ✓ = at least one test fails.</p>
<table><tr><th class="l">production mutant</th>${COLS.map(([, h]) => `<th>${h}</th>`).join('')}</tr>
${ROWS.map(([m, d]) => `<tr><td class="l">${esc(d)}<br><code>${m}</code></td>${COLS.map(([a]) => cell(a, m)).join('')}</tr>`).join('\n')}
<tr class="ctrl"><td class="l">unmutated control (passed/total)</td>${ctrl.map((c) => `<td>${c}</td>`).join('')}</tr></table>
<div class="note">The "settled" column edits the queued-cd fixture to match the current test name (cd resolved before the operation is invoked); only the three rows that bear on that fixture were run there. M4/M7 are the queue-callback terms the PR declares as its residual R1-17 gap.</div></div></body></html>`;
// ---- real stack
const runs = fs.readdirSync(`${SCR}/r3/rig/out/runs`).filter((f) => /^(obs|adm)-cdlong-r\d\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(`${SCR}/r3/rig/out/runs/${f}`, 'utf8')));
const fmt = (w) => (w.status === 'client-timeout' ? `<span class="bad">client timeout (${w.ms} ms)</span>` : `<span class="ok">${w.status} ${esc(w.json?.code ?? '')}</span> <small>${w.ms} ms</small>`);
const disp = (d) => ['branch', 'fork', 'rewind'].map((k) => `${k} ${d[k]}`).join(' · ');
const rows2 = runs.map((r) => `<tr class="${r.arm}"><td class="l">${r.arm === 'obs' ? 'PR head' : 'admission terms off'}<small>${r.label}</small></td>
<td>${r.cdStillInFlightAtAdmission ? 'yes' : 'no'}</td><td>${fmt(r.window.branch)}</td><td>${fmt(r.window.fork)}</td><td>${fmt(r.window.rewind)}</td>
<td class="${Object.values(r.dispatchedToChild).slice(0, 3).some((x) => x) ? 'badc' : 'okc'}">${disp(r.dispatchedToChild)}</td>
<td class="${r.newSessions ? 'badc' : 'okc'}">${r.newSessions}</td>
<td class="${r.historyAfter.users.some((u) => u.includes('fork: review')) ? 'badc' : 'okc'}">${r.historyAfter.users.some((u) => u.includes('fork: review')) ? 'yes' : 'no'}</td>
<td>${(r.cd.ms / 1000).toFixed(1)} s</td></tr>`).join('\n');
const css2 = css + `td{min-width:0}td small{display:inline;margin-left:4px}td.l small{display:block;margin:0}.ok{color:#0b5d0b;font-weight:600}.bad{color:#a4262c;font-weight:600}
td.okc{background:#dff3df;color:#0b5d0b}td.badc{background:#fbe3e3;color:#a4262c;font-weight:600}tr td{background:#f6f6f4}`;
const html2 = `<html><head><style>${css2}</style></head><body><div class="wrap">
<h1>Real <code>qwen serve</code> + real ACP child: branch / fork / rewind while a cd is in flight and a background turn runs</h1>
<p class="sub">The child holds the cd (12 s) before the background agent's notification turn (25 s silent shell) is admitted, then the client sends branch, fork and rewind with a 5 s timeout. "admission terms off" = the head bundle with branch/fork admission terms removed and rewind's moved into its queue callback; every callback guard intact.</p>
<table><tr><th class="l">arm / run</th><th>cd in flight<br>at admission</th><th>branch</th><th>fork</th><th>rewind</th><th>dispatched to child<br>after the window</th><th>extra<br>session</th><th>fork agent ran<br>after timeout</th><th>cd answered<br>after</th></tr>
${rows2}</table>
<div class="note">With the terms off, all three requests sit behind the cd until the turn ends and then run although the caller already gave up: a branch session is created and a fork agent runs. The late rewind reaches the child but is refused (<code>invalid_rewind_target</code>), because the cd that held the queue drops the rewind snapshots — measured separately on an idle session (cd → rewind 400). Per-run JSON: <code>runs/</code>.</div></div></body></html>`;
(async () => {
  const b = await chromium.launch();
  for (const [name, html] of [['fig1-mutation-matrix-r3', html1], ['fig2-real-stack-queued-cd', html2]]) {
    const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1500, height: 900 } });
    await page.setContent(html);
    const box = await page.locator('.wrap').boundingBox();
    await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
    await page.locator('.wrap').screenshot({ path: `${SCR}/r3/fig/${name}.png` });
    fs.writeFileSync(`${SCR}/r3/fig/${name}.html`, html);
    await page.close();
  }
  await b.close();
})();
