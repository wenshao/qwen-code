// R4-12 against the SHIPPED stylesheet in a real touch-profile Chromium.
// The daemon serves its own built Web Shell CSS; we mount the sidebar row
// markup with that build's hashed class names and let Chromium's cascade
// decide, under (hover: none)/(pointer: coarse).
import pw from '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wtHEAD/node_modules/playwright/index.js';
import fs from 'node:fs';
import * as O from './obs.mjs';
const { chromium } = pw;

const WT = O.ARM === 'pre'
  ? '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wtPRE'
  : '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/wtHEAD';
const dir = `${WT}/dist/web-shell/assets`;
const cssFile = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort((a, b) => fs.statSync(`${dir}/${b}`).size - fs.statSync(`${dir}/${a}`).size)[0];
const css = fs.readFileSync(`${dir}/${cssFile}`, 'utf8');

const m = css.match(/\.(_sessionRow_[a-z0-9]+_\d+):has\(\.(_sessionBackgroundRunning_[a-z0-9]+_\d+):hover\)\s*\.(_sessionActions_[a-z0-9]+_\d+)/);
if (!m) { console.log(JSON.stringify({ arm: O.ARM, error: 'rule not found in shipped CSS', cssFile })); process.exit(1); }
const [, rowCls, dotCls, actionsCls] = m;
const idx = css.indexOf(m[0]);
const wrappedInHoverMedia = /@media \(hover: ?hover\)\{$/.test(css.slice(Math.max(0, idx - 40), idx).trim());

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
body{background:#0d1117;color:#e6edf3;font:14px -apple-system,system-ui,sans-serif;margin:0;padding:24px}
#wrap{width:420px}
#row{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:#161b22}
#actions{margin-left:auto;display:flex;gap:6px}
#actions button{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:4px 10px}
h1{font-size:13px;font-weight:600;margin:0 0 10px;color:#8b949e;letter-spacing:.04em;text-transform:uppercase}
</style></head><body><div id="wrap"><div class="${rowCls}" id="row">
  <span class="${dotCls}" id="dot">●</span>
  <span>Fix the flaky reaper test</span>
  <span class="${actionsCls}" id="actions"><button aria-label="Pin">Pin</button><button aria-label="More actions">⋯</button></span>
</div></div></body></html>`;
const file = `/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/css-${O.ARM}.html`;
fs.writeFileSync(file, html);

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = {};
for (const profile of ['desktop', 'touch']) {
  const ctx = await browser.newContext(
    profile === 'touch'
      ? { viewport: { width: 900, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 },
  );
  const page = await ctx.newPage();
  await page.goto('file://' + file);
  const media = await page.evaluate(() => ({ hoverNone: matchMedia('(hover: none)').matches, pointerCoarse: matchMedia('(pointer: coarse)').matches, hoverHover: matchMedia('(hover: hover)').matches }));
  const read = async () => page.evaluate(() => { const cs = getComputedStyle(document.getElementById('actions')); return { opacity: cs.opacity, pointerEvents: cs.pointerEvents }; });
  const before = await read();
  if (profile === 'touch') await page.locator('#wrap').screenshot({ path: `/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/shots/${process.env.ARM || 'head'}-css-touch-1-idle.png` });
  await page.locator('#dot').hover();
  await page.waitForTimeout(300);
  const hovering = await read();
  if (profile === 'touch') await page.locator('#wrap').screenshot({ path: `/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/shots/${process.env.ARM || 'head'}-css-touch-2-hover.png` });
  results[profile] = { media, actionsWithoutDotHover: before, actionsWithDotHover: hovering };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ arm: O.ARM, cssFile, rowCls, dotCls, actionsCls, ruleWrappedInHoverMedia: wrappedInHoverMedia, ...results }, null, 1));
fs.writeFileSync(`/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/badda020-42a9-49a9-a576-6a2155aeabb3/scratchpad/h/out/runs/${O.ARM}-csstouch.json`, JSON.stringify({ arm: O.ARM, cssFile, ruleWrappedInHoverMedia: wrappedInHoverMedia, ...results }, null, 1));
process.exit(0);
