const { chromium } = require('playwright-core');
const fs = require('fs');
const E = '/root/verify/pr13156/e2e';
const OUT = '/root/verify/pr13156/publish/pr-13156';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const css = `body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{display:inline-block;padding:20px 22px}
h1{font-size:19px;margin:0 0 4px} .sub{color:#8b949e;font-size:13px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.lab{font-size:14px;font-weight:600;margin:0 0 6px} .bad{color:#ff7b72} .good{color:#7ee787}
.crop{overflow:hidden;border-radius:8px;border:1px solid #30363d}
.crop img{display:block;width:100%}
.mono{font-family:"DejaVu Sans Mono",Menlo,monospace;font-size:12px}
.row{border:1px solid #30363d;border-radius:6px;padding:6px 8px;margin:0 0 6px;background:#161b22}
.row .ln{word-break:break-all;white-space:pre-wrap}
.tag{display:inline-block;font-size:11px;font-weight:600;border-radius:10px;padding:1px 8px;margin-bottom:3px}
.tok{background:#033a16;color:#7ee787} .tbad{background:#490202;color:#ff7b72}
.meta{color:#8b949e;font-size:11px;margin-left:6px}
.foot{color:#8b949e;font-size:12px;margin-top:10px}`;

async function shot(page, html, file, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
  await page.waitForTimeout(150);
  let box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 4 });
  box = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: `${OUT}/${file}`, clip: box });
  console.log('wrote', file, Math.round(box.width), Math.round(box.height));
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  // Fig 1: links TUI A/B
  const pane = (p, h, label, cls) => `<div><p class="lab ${cls}">${esc(label)}</p><div class="crop" style="height:${h}px"><img src="${img(p)}"></div></div>`;
  await shot(page, `<div class="wrap" style="width:1500px"><h1>Real TUI, same scripted model: write one memory note, then open every link the rebuilt MEMORY.md shows in the system prompt</h1>
<p class="sub">node dist/cli.js (interactive, --approval-mode yolo) on Linux · fake OpenAI endpoint · 6 seeded notes + 1 written by the model's write_file → host rebuilds MEMORY.md and refreshes the system prompt → model issues read_file on &lt;memoryDir&gt;/&lt;decoded link target&gt;</p>
<div class="grid">${pane(`${E}/out-links-base/tui-base.png`, 640, 'merge-base 47463b79 — 3 of 7 links open, 4 × File not found', 'bad')}${pane(`${E}/out-links-head/tui-head.png`, 640, 'PR head 5078d2af — 7 of 7 links open', 'good')}</div></div>`, '01-links-e2e-tui-ab.png', 1540);

  // Fig 2: index lines as captured from the model request's system prompt
  const panel = (arm, label, cls) => {
    const r = JSON.parse(fs.readFileSync(`${E}/out-links-${arm}/result.json`, 'utf8'));
    const rows = r.followed.map((f) => `<div class="row"><span class="tag ${f.exists ? 'tok' : 'tbad'}">${f.exists ? '✓ opens' : (f.closed ? '✗ File not found' : '✗ cut inside target — no closing )')}</span><span class="meta">${f.line.length} chars</span><div class="ln mono">${esc(f.line)}</div></div>`).join('');
    return `<div><p class="lab ${cls}">${esc(label)}</p>${rows}</div>`;
  };
  await shot(page, `<div class="wrap" style="width:1500px"><h1>The index block the model actually received (copied out of the captured /chat/completions system prompt)</h1>
<p class="sub">Section "## &lt;memoryDir&gt;/MEMORY.md" of the request sent right after the write_file tool call. Each line is checked by decodeURIComponent(target) → fs.existsSync(&lt;memoryDir&gt;/target). The prompt copy is byte-identical to MEMORY.md on disk in both arms.</p>
<div class="grid">${panel('base', 'merge-base 47463b79 — 4 / 7 dead', 'bad')}${panel('head', 'PR head 5078d2af — 0 / 7 dead', 'good')}</div>
<p class="foot">Base failure shapes: three lines sliced at column 150 inside "](…" (title too long, CJK path percent-encoded 9×), one path capped at 120 code points before encoding. Head: three lines run long (167 / 173 / 175 chars) because the link alone exceeds 150; they carry no hook, by design.</p></div>`, '02-index-in-system-prompt-ab.png', 1540);

  // Fig 3: budget TUI A/B
  await shot(page, `<div class="wrap" style="width:1500px"><h1>Over-budget store through the real TUI: 199 seeded notes + 1 written in-session (40 with a link longer than 150 chars, interleaved by mtime)</h1>
<p class="sub">The 25,000-unit cap trips in both arms. Counts are computed from the index block in the system prompt the model received; "open a real note" = decoded target exists on disk.</p>
<div class="grid">${pane(`${E}/out-budget-base/tui-base.png`, 365, 'merge-base 47463b79 — 34 dead links, 132/160 ordinary notes', 'bad')}${pane(`${E}/out-budget-head/tui-head.png`, 365, 'PR head 5078d2af — 0 dead links, 160/160 ordinary + 6 complete long links', 'good')}</div></div>`, '03-budget-e2e-tui-ab.png', 1540);
  await browser.close();
})();
