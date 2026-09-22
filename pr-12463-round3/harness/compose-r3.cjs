// R2 matrix figure: base / PR head 847e289e / 847e289e + suggested patch.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const css = `body{margin:0;background:#0d1117;font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
.wrap{display:inline-block;padding:18px 20px}h1{font-size:17px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 12px;font-size:13px;max-width:1090px}
table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #30363d;padding:5px 10px;text-align:left}th{background:#161b22}
td.b{color:#ff7b72;font-weight:600}td.e{color:#7ee787;font-weight:600}td.w{background:#3b1d1d}td.chg{outline:2px solid #d29922;outline-offset:-2px}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d2a8ff}`;
const label = {
  'own-commit-amend': 'agent commit → amend', 'amend-next-turn': 'agent commit → amend in the next user turn', 'amend-of-amend': 'agent commit → amend → amend',
  'attribution-off': 'same, <code>gitCoAuthor.commit=false</code>', 'commit-then-chain-fails': '<code>git commit … &amp;&amp; false</code> (exit 1) → amend',
  'mode-reset-same-keeps': 'commit → set_permission_mode auto (no-op) → amend',
  'signed-commit-show-signature': '<b>R2</b> agent\'s <i>signed</i> commit, <code>log.showSignature=true</code> → amend',
  'acp-cwd-own': '<b>F1</b> ACP session cwd ≠ process cwd: own commit → amend',
  'user-commit-amend': 'HEAD is a human commit → amend', 'failed-commit-amend': 'agent commit fails (nothing staged) → amend',
  'cwd-shifted-commit': '<code>git -C "$PWD" commit</code> (disclosed) → amend', 'mode-switch-clears': 'commit → set_permission_mode default → auto → amend',
  'probe-commit-then-checkout': '<code>git commit … &amp;&amp; git checkout main</code> → amend', 'probe-commit-then-reset-soft': '<code>git commit … &amp;&amp; git reset --soft HEAD~2</code> → amend',
  'probe-pull-then-failed-commit': '<code>git pull &amp;&amp; git commit</code> (commit fails) → amend',
  'acp-cwd-cross': '<b>F1</b> ACP: session A commits in repoA, session B amends repoB',
  'probe-checkout-inside-amend': 'commit → <code>git checkout main &amp;&amp; git commit --amend</code>', 'probe-cd-other-repo-amend': 'commit → <code>cd ../other &amp;&amp; git commit --amend</code>',
  'tui-par': 'commit → one response, two calls: <code>git checkout main</code> | <code>git commit --amend</code> (TUI)', 'acp-bleed': 'ACP, same repo: session B amends session A\'s commit (disclosed)',
  'preexisting-flag-before-amend': '<code>git commit -q --amend</code> on a human HEAD', 'preexisting-git-C-amend': '<code>git -C ../other commit --amend</code>' };

(async () => {
  const rows = JSON.parse(fs.readFileSync('/root/verify/pr12463-harness/matrix4.json', 'utf8'));
  const cell = (v, want, changed) => { const c = v === 'BLOCKED' ? 'b' : 'e'; const wrong = c !== want; return `<td class="${c}${wrong ? ' w' : ''}${changed ? ' chg' : ''}">${v === 'BLOCKED' ? 'blocked' : 'executed'}${wrong ? ' ⚠' : ''}</td>`; };
  const body = rows.map((r) => r[0] === '#' ? `<tr><th colspan="5" style="color:#8b949e">${r[1]}</th></tr>` :
    `<tr><td>${label[r[0]]}</td><td style="color:#8b949e">${r[1] === 'e' ? 'executed' : 'blocked'}</td>${cell(r[2], r[1])}${cell(r[3], r[1])}${cell(r[4], r[1], r[4] !== r[3])}</tr>`).join('');
  const html = `<html><head><style>${css}</style></head><body><div class="wrap"><h1>Round 3 — end-to-end matrix at <code>b6dd220d</code>, real bundled CLI, <code>--approval-mode auto</code></h1>
<p class="sub">SDK stream-json unless marked ACP / TUI; one process per row; verdict of the last amend. Classifier stubbed to allow, so "blocked" = the deterministic guard. ⚠ = differs from intended. <span style="outline:2px solid #d29922;padding:0 3px">outlined</span> = cell that changed since round 2 (<code>847e289e</code>). The <code>b6dd220d</code> column equals the round-2 suggested-patch column row for row.</p>
<table><tr><th>scenario</th><th>intended</th><th>base c822995d</th><th>round 2: 847e289e</th><th>round 3: b6dd220d</th></tr>${body}</table></div></body></html>`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } });
  await page.setContent(html);
  let box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 4 });
  box = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: '/root/verify/pr12463-shots/06-e2e-matrix-r3.png', clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) } });
  console.log('wrote 06', Math.ceil(box.width), Math.ceil(box.height));
  await browser.close();
})();
