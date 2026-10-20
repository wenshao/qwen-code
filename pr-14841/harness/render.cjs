const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const SC = '/root/verify/pr14841/scen';
const OUT = '/root/verify/pr14841/publish/pr-14841';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const latest = (scen, arm) => {
  const dirs = fs.readdirSync(path.join(SC, `${scen}-${arm}`)).filter((d) => d.startsWith(`wire-${arm}-`)).sort();
  return path.join(SC, `${scen}-${arm}`, dirs.at(-1));
};
const tail = (scen, arm, nEntries = 2) => {
  const t = fs.readFileSync(path.join(latest(scen, arm), 'catalog-project.txt'), 'utf8').replace(/\n<\/system-reminder>\s*$/, '');
  const lines = t.split('\n');
  const entries = lines.filter((l) => l.startsWith('- ['));
  const warn = lines.filter((l) => l.startsWith('> WARNING'));
  return { entries: entries.slice(-nEntries), warn, count: entries.length };
};
const hl = (s) => esc(s)
  .replace(/(index entries are too long|Keep index entries to one line at most 150 UTF-16 code units; move detail into topic files\.|Keep index entries concise and move detail into topic files\.)/g, '<span class="bad">$1</span>')
  .replace(/(too many index entries \(\d+\)|Dropped \d+ of \d+ entries:[^.]*?(?:more)?\.|shortening entries cannot help — prune or merge entries\.)/g, '<span class="good">$1</span>');
const pane = (title, sub, t) => `<div class="pane"><div class="ph">${esc(title)}<span class="sub">${esc(sub)}</span></div><pre>${
  t.entries.map((e) => `<span class="dim">${esc(e.length > 96 ? e.slice(0, 95) + '…' : e)}</span>`).join('\n')}\n\n${t.warn.map(hl).join('\n')}</pre>
  <div class="foot">${t.count} entries delivered to the model</div></div>`;
const css = `body{margin:0;background:#0d1117;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono',monospace;color:#d0d7de}
.wrap{padding:22px;width:1360px;box-sizing:border-box}
h1{font-size:19px;margin:0 0 4px;color:#f0f6fc} .lede{font-size:13px;color:#8b949e;margin:0 0 16px;line-height:1.5}
h2{font-size:15px;margin:18px 0 8px;color:#f0f6fc}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pane{border:1px solid #30363d;border-radius:8px;background:#010409;overflow:hidden}
.ph{background:#161b22;padding:7px 12px;font-size:13px;color:#f0f6fc;border-bottom:1px solid #30363d}
.sub{color:#8b949e;margin-left:10px;font-size:12px}
pre{margin:0;padding:10px 12px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.dim{color:#6e7681} .bad{color:#ff7b72;font-weight:600} .good{color:#7ee787;font-weight:600}
.foot{font-size:11.5px;color:#8b949e;padding:5px 12px 8px}
table{border-collapse:collapse;font-size:12.5px;width:100%} th,td{border:1px solid #30363d;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#161b22;color:#f0f6fc} td.k{color:#7ee787} td.x{color:#ff7b72} td.w{color:#e3b341}
.note{font-size:12.5px;color:#8b949e;line-height:1.55;margin-top:8px}`;
async function shot(page, html, file) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="wrap">${html}</div></body></html>`);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({ width: Math.ceil(box.width) + 4, height: Math.ceil(box.height) + 4 });
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: path.join(OUT, file), clip: box2 });
  console.log('wrote', file, Math.round(box2.width), 'x', Math.round(box2.height));
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1400, height: 900 } });
  // Figure 1: wire A/B
  await shot(page, `<h1>PR #14841: MEMORY.md catalog the model actually receives (captured request body, real CLI bundles)</h1>
  <p class="lede">Each pane is the tail of the project-tier <b>MEMORY.md</b> block in the request-tail auto-memory catalog, cut from the HTTP body the CLI sent to a loopback fake OpenAI server. Base = merge-base 6ec1b83, head = 55fb2f3. Red = advice that cannot move the number, green = new diagnosis.</p>
  <h2>S1: hand-written MEMORY.md, 170 entries × 150 units (every entry legal)</h2>
  <div class="row">${pane('base 6ec1b83', 'S1 hand-written', tail('s1-hand-count', 'base'))}${pane('head 55fb2f3', 'S1 hand-written', tail('s1-hand-count', 'head'))}</div>
  <h2>S4: real writer path. 202 topic files, TUI save → qwen rebuilds MEMORY.md → fresh session</h2>
  <div class="row">${pane('base 6ec1b83', 'S4 writer-generated', tail('s4-writer-longlink', 'base'))}${pane('head 55fb2f3', 'S4 writer-generated', tail('s4-writer-longlink', 'head'))}</div>
  <p class="note">S4: the writer already dropped 31 of 202 entries before the file was read, so the reader drops none and head names none. Cause and lever are corrected; the evicted entries stay anonymous.</p>`, 'fig1-wire-ab.png');
  // Figure 2: writer path
  const s2b = tail('s2-writer-realistic', 'base'), s2h = tail('s2-writer-realistic', 'head');
  await shot(page, `<h1>Default path: MEMORY.md is regenerated by the writer, which trims before the reader sees it</h1>
  <p class="lede">In the interactive TUI, a memory write triggers <code>refreshMemoryAfterManagedWrite</code> → <code>rebuildManagedAutoMemoryIndex</code>. The writer trims to 25,000 units and appends its own 126-unit notice. The reader therefore only crosses the budget when the trimmed body lands within 126 units of it.</p>
  <h2>S2: 201 topic files (TUI save) → writer lists 170 → file is 24,989 units → reader passes it through unchanged</h2>
  <div class="row">${pane('base 6ec1b83', 'S2 writer-generated', s2b)}${pane('head 55fb2f3', 'S2 writer-generated', s2h)}</div>
  <h2>What reaches the model on the writer path</h2>
  <table><tr><th>Run</th><th>topic files</th><th>listed</th><th>dropped by writer</th><th>reader warning (head)</th><th>entries named</th></tr>
  <tr><td>S2 E2E (TUI save + fresh session)</td><td>201</td><td>170</td><td>31</td><td class="w">none; writer notice "Keep index entries concise…" on both arms</td><td class="x">0</td></tr>
  <tr><td>S3 E2E (181 files, 147-unit lines)</td><td>181</td><td>168</td><td>13</td><td class="w">none; same writer notice on both arms</td><td class="x">0</td></tr>
  <tr><td>S4 E2E (202 files)</td><td>202</td><td>171</td><td>31</td><td class="k">"too many index entries (171)" + prune/merge</td><td class="x">0</td></tr>
  <tr><td>Census: writer → reader, 2,251 random over-budget stores</td><td>160–320</td><td colspan="2">140,842 dropped in total</td><td class="k">2,251 / 2,251 corrected cause</td><td class="x">0 / 2,251</td></tr>
  <tr><td>Census, long-description profile, 2,996 stores</td><td>160–320</td><td colspan="2">275,604 dropped in total</td><td class="k">2,996 / 2,996 corrected cause</td><td class="x">0 / 2,996</td></tr>
  <tr><td>Simulated follow-up "exclude the writer notice from the count" (1,997 stores + the real S4 file)</td><td colspan="3">same stores</td><td class="x">1,997 / 1,997 revert to the writer notice "Keep index entries concise…"</td><td class="x">0</td></tr></table>
  <p class="note">The reader-side drop note works when MEMORY.md was not regenerated by the writer: hand-edited files, or headless <code>-p</code> sessions, which never run the post-write rebuild (observed here: a headless save wrote the topic file and left MEMORY.md untouched).</p>`, 'fig2-writer-path.png');
  // Figure 3: evidence summary
  const mut = JSON.parse(fs.readFileSync('/root/verify/pr14841/mutation.json', 'utf8'));
  const s5 = fs.readFileSync(path.join(latest('s5-hand-surrogate', 'head'), 'req-0.json'), 'latin1');
  const i = s5.indexOf('Dropped 5 of 170');
  const s5raw = Buffer.from(s5.slice(i, i + 96), 'latin1').toString('utf8');
  await shot(page, `<h1>PR #14841: supporting evidence</h1>
  <table><tr><th>Check</th><th>Result</th></tr>
  <tr><td>index-budget / prompt / indexer tests at head</td><td class="k">90 passed | 1 skipped (91)</td></tr>
  <tr><td>Full <code>src/memory/</code> at head (this box)</td><td class="k">48 files, 1101 passed | 2 skipped, 0 failed</td></tr>
  <tr><td>Negative control: PR's prompt.test.ts against base prompt.ts</td><td class="k">exactly the 3 new tests fail, 45 pass; restored → 48/48</td></tr>
  <tr><td>Differential fuzz: head vs base <code>trimIndexToBudget</code>, 20,000 random indexes (BMP/CJK/emoji, 0–260 lines, up to 26k-unit lines)</td><td class="k">0 mismatches; 0 violations of "every line lands in content XOR dropped, in index order"</td></tr>
  <tr><td>S6 control: 3-entry in-budget index</td><td class="k">no warning on either arm</td></tr>
  <tr><td>S7: 250 lines × 150 units (line cap + char budget)</td><td class="k">head: "Dropped 85 of 250 entries" (35 by budget + 50 by line cap); correct</td></tr>
  <tr><td>S5: dropped title with 😀 straddling the 60-unit name cut, raw request bytes</td><td class="w">${esc(s5raw)}</td></tr></table>
  <h2>Mutation sweep (PR's three test files per mutant)</h2>
  <table><tr><th>Mutant</th><th>Outcome</th><th>Tests</th></tr>${mut.map((m) => `<tr><td>${esc(m.name)}</td><td class="${m.status === 'KILLED' ? 'k' : 'x'}">${m.status}</td><td>${esc(m.summary)}</td></tr>`).join('')}</table>
  <p class="note">M5 survives: no test pins the drop count on the combined line-cap + char-budget path. Behaviour is correct at head (S7); only the pin is missing.</p>`, 'fig3-evidence.png');
  await browser.close();
})();
