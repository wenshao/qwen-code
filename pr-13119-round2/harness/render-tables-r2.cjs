const fs = require('fs');
const { chromium } = require('playwright-core');
const R = '/root/verify/pr13119/run';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (f) => JSON.parse(fs.readFileSync(`${R}/${f}`, 'utf8'));
const shortLabel = (l) => l.replace('unlinkSync()', 'unlinkSync(write-XXXXXX/settings.json.orig) [inside rmSync]').replace(/settings\.json\.write-[A-Za-z0-9]{6}/g, 'write-XXXXXX').replace(/ -> \[object Object\]/, '');
const cls = (row) => row.agent.startsWith('ESCAPED') ? 'bad' : 'good';
const sb = (s) => s.startsWith('Tool execution sandbox: none') ? 'none' : (s.startsWith('Boundary') ? 'bwrap (full)' : s);
const CSS = `body{margin:0;background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328}
.wrap{display:inline-block;padding:20px}
h1{font-size:18px;margin:0 0 4px}
.sub{font-size:12.5px;color:#59636e;margin:0 0 14px}
h2{font-size:14px;margin:16px 0 6px}
table{border-collapse:collapse;font-size:12.5px;margin-bottom:6px}
th,td{border:1px solid #d1d9e0;padding:4px 8px;text-align:left;vertical-align:top}
th{background:#f6f8fa;font-weight:600}
td.mono{font-family:DejaVu Sans Mono,monospace;font-size:11.5px}
tr.bad td{background:#ffebe9}
tr.good td.st{color:#1a7f37;font-weight:600}
tr.bad td.st{color:#cf222e;font-weight:700}
td.ok{color:#1a7f37;font-weight:600;background:#ffffff !important}
td.ko{color:#cf222e;font-weight:700;background:#ffebe9 !important}
tr.plain td{background:#ffffff}
.cols{display:flex;gap:18px;align-items:flex-start}
.note{font-size:12px;color:#59636e;max-width:1500px;margin-top:8px}`;
function probeTable(rows) {
  return `<table><tr><th>checkpoint (writer paused after)</th><th>settings.json</th><th><code>qwen sandbox</code></th><th>agent shell tool: write outside workspace</th></tr>
  ${rows.map((r) => `<tr class="${cls(r)}"><td class="mono">${esc(shortLabel(r.label))}</td><td>${esc(r.target === 'ABSENT' ? 'ABSENT' : r.target.split(' ')[0] + (r.policy === 'MISSING' ? ', policy MISSING' : ', policy present'))}</td><td>${esc(sb(r.sandbox.replace(/ \[rc=\d+\]$/, '')))}</td><td class="st">${esc(r.agent.startsWith('ESCAPED') ? 'ESCAPED (file written on host)' : 'blocked: EROFS')}</td></tr>`).join('')}</table>`;
}
function killTable(arm, n) {
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const j = load(`result-${arm}-kill${k}.json`);
    const [after, next] = j.rows;
    const cell = (r) => `${r.target === 'ABSENT' ? 'ABSENT' : 'complete'}${r.policy === 'MISSING' ? ', policy MISSING' : r.policy === 'present' ? ', policy present' : ''} · ${r.agent.startsWith('ESCAPED') ? 'ESCAPED' : 'confined'}`;
    const bad = after.agent.startsWith('ESCAPED') || next.agent.startsWith('ESCAPED');
    const left = after.listing.split('  ').filter((x) => x !== 'settings.json').map((x) => x.replace(/write-[A-Za-z0-9]{6}/, 'write-XXXXXX')).join(' ') || '—';
    rows.push(`<tr class="${bad ? 'bad' : 'good'}"><td class="mono">${esc(shortLabel(j.killedAt))}</td><td class="st">${esc(cell(after))}</td><td class="st">${esc(cell(next))}</td><td class="mono">${esc(left)}</td></tr>`);
  }
  return `<table><tr><th>SIGKILL at</th><th>next startup</th><th>after the next ordinary save</th><th>artifacts left</th></tr>${rows.join('')}</table>`;
}
async function shot(html, out) {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2400, height: 1400 } });
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const el = page.locator('.wrap');
  let box = await el.boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await el.screenshot({ path: out });
  box = await el.boundingBox();
  console.log('wrote', out, Math.round(box.width), 'x', Math.round(box.height));
  await browser.close();
}
const mut = JSON.parse(fs.readFileSync('/root/verify/pr13119/r2/mutants2.json', 'utf8'));
function mutTable() {
  const rows = mut.testResults.map((f) => {
    const m = f.name.split('__mut__/')[1].split('/')[0];
    const a = f.assertionResults; const fails = a.filter((x) => x.status !== 'passed');
    return { m, nf: fails.length, n: a.length, titles: fails.map((x) => x.title.replace(/ on (EPERM|EACCES)$/, ' on $1')) };
  }).filter((r) => r.m.startsWith('n1')).sort((a, b) => a.m.localeCompare(b.m));
  const what = { n100_r1_head_writer: 'negative control: R1 writer (d0be922868) under the new tests', n101_revert_fix_keep_every_copy: 'keep every recovery copy (revert the fix)',
    n102_always_identical: 'treat every copy as identical', n103_unreadable_counts_as_identical: 'unreadable comparison input counts as identical',
    n104_compare_staged_not_backup: 'compare the staged file instead of the backup', n105_identical_dir_left_behind: 'identical case unlinks staging but leaves the dir',
    n106_message_claims_removed_copy: 'error still claims a copy that was removed', n107_size_only_compare: 'compare sizes only (stat)',
    n108_compare_before_failure_ignores_copy_flag: 'compare even when no backup was made', n109_string_compare_utf8: 'compare as UTF-8 strings instead of bytes' };
  return `<table><tr><th>mutant of the new identical-copy cleanup</th><th>failing / 17</th><th>result</th></tr>${rows.map((r) =>
    `<tr class="plain"><td>${esc(what[r.m] || r.m)}</td><td>${r.nf}</td><td class="${r.nf ? 'ok' : ''}">${r.nf ? 'killed' : 'survived — equivalent for UTF-8 settings'}</td></tr>`).join('')}</table>`;
}
function stressTable() {
  const txt = fs.readFileSync('/root/verify/pr13119/r2/log-stress-head2.txt', 'utf8').split('== ').filter(Boolean);
  return `<table><tr><th>writers × saves</th><th>saves OK</th><th>reader samples</th><th>absent</th><th>torn JSON</th><th>policy lost</th></tr>${txt.map((blk) => {
    const w = blk.match(/writers=(\d+) iters=(\d+)/); const ok = [...blk.matchAll(/"ok":(\d+)/g)].reduce((s, x) => s + +x[1], 0);
    const rd = [...blk.matchAll(/\{"samples":(\d+),"absent":(\d+),"parseError":(\d+),"policyLost":(\d+)/g)];
    const sum = (i) => rd.reduce((s, x) => s + +x[i], 0);
    return `<tr class="plain"><td>${w[1]} × ${w[2]}</td><td class="ok">${ok} / ${w[1] * w[2]}</td><td>${sum(1).toLocaleString('en-US')}</td><td class="ok">${sum(2)}</td><td class="ok">${sum(3)}</td><td class="ok">${sum(4)}</td></tr>`; }).join('')}</table>`;
}
(async () => {
  const head2 = load('result-head2.json').rows;
  await shot(`<h1>Round 2 — the central claim re-run on a fresh build of a8beb51cd5</h1>
  <p class="sub">Fresh <code>pnpm install --frozen-lockfile</code> + <code>npm run build</code> + <code>npm run bundle</code> at a8beb51cd5. Same harness as round 1: real bundled CLI writer paused after every fs step (preload hook), independent real <code>qwen sandbox</code> and a <code>qwen -p</code> agent at each step. Linux 6.12 / ext4, bubblewrap 0.12.0, policy <code>workspace-write / network closed</code>.</p>
  <div class="cols"><div><h2>Checkpoint probes — PR HEAD a8beb51cd5</h2>${probeTable(head2)}</div>
  <div><h2>Crash matrix — SIGKILL at each checkpoint, then a new start, then an ordinary save</h2>${killTable('head2', 6)}</div></div>
  <div class="cols"><div><h2>Concurrency — compiled writer vs 2 reader processes (real <code>readOperatorSandboxSettings()</code>)</h2>${stressTable()}</div>
  <div><h2>Mutation of the new code — 17 tests in <code>write-with-backup.test.ts</code></h2>${mutTable()}</div></div>
  <p class="note">Artifacts after a crash (right-hand table) are the documented trade-off: a SIGKILL inside a save leaves that invocation's private directory, and no later save removes it. Round 1 on base 78143fe335 had the target ABSENT at checkpoint #2 and the agent escaped. Those rows are unchanged and not repeated here.</p>`,
  '/root/verify/pr13119/r2/publish/pr-13119-round2/02-rerun-matrix-a8beb51cd5.png');
})();
