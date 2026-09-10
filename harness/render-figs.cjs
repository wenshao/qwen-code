/* Render PR #9541 round-2 verification figures to PNG. */
const { chromium } = require('/root/git/qwen-code-x8/node_modules/playwright-core');
const fs = require('node:fs');
const path = require('node:path');

const SP = '/tmp/claude-0/-root-git-qwen-code-x8/7ddbc933-9760-4997-8103-bf6ed440567f/scratchpad';
const OUT = path.join(SP, 'figs');
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
  :root { color-scheme: dark; }
  body { margin:0; background:#0d1117; color:#e6edf3;
         font-family: 'DejaVu Sans Mono', ui-monospace, Menlo, monospace; }
  .wrap { display:inline-block; padding:22px 26px; }
  h1 { font-size:19px; margin:0 0 4px; color:#e6edf3; font-weight:600; }
  .sub { font-size:13px; color:#9198a1; margin:0 0 16px; }
  table { border-collapse:collapse; font-size:13.5px; }
  th, td { padding:7px 12px; border-bottom:1px solid #30363d; text-align:left; white-space:nowrap; }
  th { color:#9198a1; font-weight:600; border-bottom:2px solid #444c56; }
  td.num { text-align:right; font-variant-numeric: tabular-nums; }
  .ok { color:#3fb950; }
  .bad { color:#f85149; }
  .warn { color:#d29922; }
  .dim { color:#7d8590; }
  .grp { border-left:1px solid #30363d; }
  caption { caption-side:bottom; text-align:left; font-size:12px; color:#7d8590;
            padding-top:14px; max-width:900px; white-space:normal; line-height:1.5; }
  p.cap { font-size:12.5px; color:#7d8590; max-width:1180px; white-space:normal;
          line-height:1.6; margin:16px 0 0; }
  .panes { display:flex; gap:18px; align-items:flex-start; }
  .pane { }
  .pane .label { font-size:13px; margin-bottom:6px; color:#e6edf3; }
  .pane .label b { color:#d29922; }
  .shot { border:1px solid #30363d; border-radius:6px; overflow:hidden; height:210px; }
  .shot img { display:block; margin-top:-448px; }
`;

async function shoot(browser, html, file) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(`<style>${CSS}</style><div class="wrap">${html}</div>`);
  await page.waitForTimeout(250);
  const box = await page.locator('.wrap').boundingBox();
  await page.setViewportSize({
    width: Math.ceil(box.width) + 40,
    height: Math.ceil(box.height) + 40,
  });
  await page.waitForTimeout(150);
  const box2 = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: path.join(OUT, file), clip: box2 });
  await page.close();
  console.log('wrote', file);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: require('fs')
      .readdirSync('/root/.cache/ms-playwright')
      .filter((d) => d.startsWith('chromium-'))
      .map((d) => `/root/.cache/ms-playwright/${d}/chrome-linux/chrome`)
      .find((p) => fs.existsSync(p)),
    args: ['--no-sandbox'],
  });

  // ── Figure 1: TUI A/B ────────────────────────────────────────────────
  const b64 = (f) => fs.readFileSync(path.join(SP, 'tui', f)).toString('base64');
  await shoot(
    browser,
    `<h1>Same Chinese session, same fake provider, only the build differs — <code>/compress</code></h1>
     <p class="sub">128,000-token window · session at <b>52.1%</b> of it in real provider tokens (counted with the real Qwen2.5 tokenizer)</p>
     <div class="panes">
       <div class="pane">
         <div class="label"><b>BEFORE</b> — merge base <code>db8897d5</code></div>
         <div class="shot"><img src="data:image/png;base64,${b64('BEFORE-2-compress.png')}"></div>
       </div>
       <div class="pane">
         <div class="label"><b>AFTER</b> — PR head <code>7820a426</code></div>
         <div class="shot"><img src="data:image/png;base64,${b64('AFTER-2-compress.png')}"></div>
       </div>
     </div>
     <p class="cap">BEFORE puts a 73,841-token compression request on the wire with a 20,000-token output budget; the provider accepts it (73,841 + 20,000 &lt;= 128,000) and the session compresses. AFTER sends nothing: it scores the same payload at 148,090 tokens and refuses locally. The bare <code>&#9670;</code> line above the warning on the right is the empty COMPRESSION item — no CLI switch case exists for the new status.</p>`,
    '01-tui-ab-compress.png',
  );

  // ── Figure 2: admission ladder ───────────────────────────────────────
  const ladder = JSON.parse(fs.readFileSync(path.join(SP, 'fig-ladder.json'), 'utf8'));
  const cell = (v) =>
    v == null
      ? '<td class="dim">·</td>'
      : `<td class="${v.cls}">${esc(v.text)}</td>`;
  await shoot(
    browser,
    `<h1>Admission ladder — real compiled service, real tokenizer as the provider's oracle</h1>
     <p class="sub">128,000-token window, cold compression path (no prompt-cache sharing). Each row is one session; the % is REAL provider tokens.</p>
     <table>
       <tr><th>session content</th><th>real tokens</th><th>% of window</th><th>BEFORE (db8897d5)</th><th>AFTER (7820a426)</th><th>guard's estimate</th><th>estimate / real</th></tr>
       ${ladder
         .map(
           (r) =>
             `<tr><td>${esc(r.corpus)}</td><td class="num">${esc(r.real.toLocaleString())}</td><td class="num">${esc(r.pct)}</td>` +
             cell(r.before) +
             cell(r.after) +
             `<td class="num">${r.est ? esc(r.est.toLocaleString()) : '<span class="dim">·</span>'}</td><td class="num">${r.ratio ? esc(r.ratio) : '<span class="dim">·</span>'}</td></tr>`,
         )
         .join('')}
       <caption>“refused locally” = 0 requests reached the provider (COMPRESSION_FAILED_INPUT_TOO_LARGE). “provider 400” = the request was sent and rejected for exceeding the window. “1-token summary” = the #9455 failure mode (max_tokens floored to 1). Rows where BEFORE compressed and AFTER refuses are the regression band.</caption>
     </table>`,
    '02-admission-ladder.png',
  );

  // ── Figure 3: estimator calibration ──────────────────────────────────
  const cal = JSON.parse(fs.readFileSync(path.join(SP, 'calibration.json'), 'utf8'));
  await shoot(
    browser,
    `<h1>Admission estimator vs the real Qwen2.5 tokenizer</h1>
     <p class="sub">Measured with <code>@lenml/tokenizer-qwen2_5</code>. “head” is this PR's estimate; “round&nbsp;1” is what the 2026-08-31 comment measured at <code>17f8aae</code>.</p>
     <table>
       <tr><th>corpus</th><th>chars</th><th>real tokens</th><th>chars / token</th>
           <th class="grp">base (char/4)</th><th>× real</th>
           <th class="grp">round 1 (17f8aae)</th><th>× real</th>
           <th class="grp">head (7820a426)</th><th>× real</th></tr>
       ${cal
         .map((r) => {
           const cls = (x) => (x > 1.5 ? 'bad' : x > 1.25 ? 'warn' : x < 0.8 ? 'bad' : 'ok');
           return `<tr><td>${esc(r.corpus)}</td><td class="num">${r.chars.toLocaleString()}</td><td class="num">${r.realTokens.toLocaleString()}</td><td class="num">${r.charsPerRealToken}</td>
             <td class="num grp">${r.baseEstimate.toLocaleString()}</td><td class="num ${cls(r.baseRatio)}">${r.baseRatio.toFixed(2)}×</td>
             <td class="num grp">${r.round1Estimate.toLocaleString()}</td><td class="num ${cls(r.round1Ratio)}">${r.round1Ratio.toFixed(2)}×</td>
             <td class="num grp">${r.headEstimate.toLocaleString()}</td><td class="num ${cls(r.headRatio)}">${r.headRatio.toFixed(2)}×</td></tr>`;
         })
         .join('')}
       <caption>The base char/4 estimate under-counts CJK ~2.5× (the defect this PR set out to fix). The round-1 estimate over-counted it ~5×. The head estimate charges a flat 1.25 tokens per 3-byte CJK character, versus the 0.65 the tokenizer actually assigns to Chinese prose and 0.34 to the repo's own Chinese design docs — and that estimate is what gates admission.</caption>
     </table>`,
    '03-estimator-calibration.png',
  );

  // ── Figure 4: #9455 repro + causal controls ──────────────────────────
  const controls = JSON.parse(fs.readFileSync(path.join(SP, 'fig-controls.json'), 'utf8'));
  await shoot(
    browser,
    `<h1>What the fix closes, and what causes the remaining refusals</h1>
     <p class="sub">Same compiled AFTER build; the bottom two arms patch <b>only the estimator</b> inside <code>packages/core/dist</code> — “calibrated” charges ~0.58 tokens per CJK char, “exact” asks the real Qwen2.5 tokenizer.</p>
     <table>
       <tr><th>scenario</th><th>arm</th><th>requests on the wire</th><th>provider verdict</th><th>result</th></tr>
       ${controls
         .map(
           (r) =>
             `<tr><td>${esc(r.scenario)}</td><td>${esc(r.arm)}</td><td class="num">${esc(r.requests)}</td><td class="${r.verdictCls}">${esc(r.verdict)}</td><td class="${r.cls}">${esc(r.result)}</td></tr>`,
         )
         .join('')}
       <caption>Only the estimator changes between the last three arms. Calibrating it (~0.58 tokens per CJK char) restores compression for the two mid-range Chinese sessions; an exact estimate compresses all six — including the #9455 repro, where the PR's own output-budget clamp then requests 9,887 tokens and lands at prompt + max_tokens = 126,976 &lt;= 128,000. So the refusals measured on the PR head are estimator error, not sessions that genuinely cannot fit. Note also that a slight UNDER-estimate (calibrated arm, the two 86% rows) re-creates the provider 400 — which is why bounding the estimate by the provider-reported prompt count is safer than any fixed multiplier.</caption>
     </table>`,
    '04-controls.png',
  );

  await browser.close();
})();
