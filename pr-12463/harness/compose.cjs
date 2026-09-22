// Compose the evidence PNGs (Playwright chromium from the repo's node_modules).
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const SH = '/root/verify/pr12463-shots';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(`${SH}/${f}`).toString('base64');
const css = `body{margin:0;background:#0d1117;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
.wrap{display:inline-block;padding:18px 20px}
h1{font-size:17px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 12px;font-size:13px}
.grid{display:flex;gap:14px;align-items:flex-start}
.pane{border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#282a36}
.cap{padding:7px 10px;font-weight:600;font-size:13px;background:#161b22;border-bottom:1px solid #30363d}
.cap.bad{color:#ff7b72}.cap.good{color:#7ee787}
.crop{overflow:hidden;position:relative}.crop img{display:block;position:relative}
table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #30363d;padding:5px 10px;text-align:left}
th{background:#161b22}td.b{color:#ff7b72;font-weight:600}td.e{color:#7ee787;font-weight:600}td.w{background:#3b1d1d}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d2a8ff}`;
function pane(file, caption, cls, top, height) {
  return `<div class="pane"><div class="cap ${cls}">${esc(caption)}</div><div class="crop" style="height:${height}px;width:940px"><img src="${img(file)}" style="margin-top:-${top}px"></div></div>`;
}
async function shoot(page, html, out) {
  await page.setContent(`<html><head><style>${css}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 4 });
  const b2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: `${SH}/${out}`, clip: { x: 0, y: 0, width: Math.ceil(b2.width), height: Math.ceil(b2.height) } });
  console.log('wrote', out, Math.ceil(b2.width), 'x', Math.ceil(b2.height));
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE });
  const mk = async () => browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } });
  let page = await mk();
  await shoot(page, `<h1>Amend of the agent's own commit — real TUI, <code>--approval-mode auto</code></h1>
<p class="sub">Same scripted model, same two prompts (commit, then amend). Left: main @ c822995d. Right: PR head 0cf69caf.</p>
<div class="grid">${pane('base-fix.png', 'base (main) — amend hard-blocked', 'bad', 318, 360)}${pane('head-fix.png', 'PR head — amend executes, HEAD rewritten', 'good', 318, 360)}</div>`, '01-own-commit-amend-ab.png');
  await page.close(); page = await mk();
  await shoot(page, `<h1>F2 — <code>git commit … &amp;&amp; git checkout -q main</code>, then a plain <code>git commit --amend</code></h1>
<p class="sub">Repo: human commits on <code>feature</code> and on <code>main</code>. The agent commits on feature and switches to main in one command; the next amend targets the human's main commit.</p>
<div class="grid">${pane('base-probe.png', 'base (main) — amend blocked', 'bad', 318, 400)}${pane('head-probe.png', "PR head — human's 'user: main release notes' rewritten", 'bad', 318, 400)}</div>`, '02-probe-commit-then-checkout-ab.png');
  await page.close(); page = await mk();
  const rows = JSON.parse(fs.readFileSync('/root/verify/pr12463-harness/matrix2.json', 'utf8'));
  const label = {
    'own-commit-amend': 'agent commit → amend', 'amend-next-turn': 'agent commit → amend in the next user turn', 'amend-of-amend': 'agent commit → amend → amend',
    'attribution-off': 'same, <code>gitCoAuthor.commit=false</code>', 'commit-then-chain-fails': '<code>git commit … &amp;&amp; false</code> (exit 1, HEAD moved) → amend',
    'mode-reset-same-keeps': 'commit → set_permission_mode auto (no-op) → amend', 'acp-cwd-own': '<b>F1</b> ACP session cwd ≠ process cwd: own commit → amend',
    'user-commit-amend': 'HEAD is a human commit → amend', 'failed-commit-amend': 'agent commit fails (nothing staged) → amend',
    'cwd-shifted-commit': '<code>git -C "$PWD" commit</code> (disclosed) → amend', 'mode-switch-clears': 'commit → set_permission_mode default → auto → amend',
    'probe-commit-then-checkout': '<b>F2</b> <code>git commit … &amp;&amp; git checkout main</code> → amend', 'probe-commit-then-reset-soft': "<b>F2</b> <code>git commit … &amp;&amp; git reset --soft HEAD~2</code> → amend",
    'acp-cwd-cross': '<b>F1</b> ACP: session A commits in repoA, session B amends repoB', 'probe-checkout-inside-amend': '<b>FU</b> commit → <code>git checkout main &amp;&amp; git commit --amend</code>',
    'probe-cd-other-repo-amend': '<b>FU</b> commit → <code>cd ../other &amp;&amp; git commit --amend</code>', 'tui-par': '<b>FU</b> commit → one response with two calls: <code>git checkout main</code> | <code>git commit --amend</code> (TUI)',
    'acp-bleed': 'ACP, same repo: session B amends session A\'s commit (disclosed)', 'preexisting-flag-before-amend': 'pre-existing: <code>git commit -q --amend</code> on a human HEAD',
    'preexisting-git-C-amend': 'pre-existing: <code>git -C ../other commit --amend</code>' };
  const group = { 'own-commit-amend': 'Legitimate — should execute', 'user-commit-amend': 'Negative controls — should stay blocked', 'probe-commit-then-checkout': 'Holes closed by the suggested patch', 'probe-checkout-inside-amend': 'Left for a follow-up (FU) — consumer-side, needs execution-time re-check', 'preexisting-flag-before-amend': 'Pre-existing on main — regex never matches' };
  const cell = (v, want) => { const c = v === 'BLOCKED' ? 'b' : 'e'; const wrong = c !== want; return `<td class="${c}${wrong ? ' w' : ''}">${v === 'BLOCKED' ? 'blocked' : 'executed'}${wrong ? ' ⚠' : ''}</td>`; };
  const body = rows.map(([s, want, b, h, f]) => (group[s] ? `<tr><th colspan="5" style="text-align:left;color:#8b949e;font-weight:600">${group[s]}</th></tr>` : '') + `<tr><td>${label[s]}</td><td style="color:#8b949e">${want === 'e' ? 'executed' : 'blocked'}</td>${cell(b, want)}${cell(h, want)}${cell(f, want)}</tr>`).join('');
  await shoot(page, `<h1>End-to-end matrix — real bundled CLI, <code>--approval-mode auto</code>, one process per row</h1>
<p class="sub">SDK stream-json unless marked ACP / TUI. Verdict of the <b>last</b> amend. Classifier stubbed to allow, so every "blocked" is the deterministic destructive-command guard. ⚠ = differs from intended.</p>
<table><tr><th>scenario</th><th>intended</th><th>base c822995d</th><th>PR head 0cf69caf</th><th>head + suggested patch</th></tr>${body}</table>`, '03-e2e-matrix.png');
  await page.close(); page = await mk();
  await shoot(page, `<h1><code>/clear</code> starts a new session, but the registry survives it</h1>
<p class="sub">PR head, real TUI: commit in session 1 → <code>/clear</code> (new session id; two chat files on disk) → amend in session 2 is still exempt.</p>
<div class="grid">${pane('head-clear.png', 'PR head — amend after /clear executes', 'bad', 190, 210)}</div>`, '04-clear-keeps-registry.png');
  await browser.close();
})();
