// Renders evidence cards (JSON spec -> HTML -> PNG) with the repo's Playwright.
// usage: node render.mjs <spec.json> <out.png>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/5b0e58b6-6b84-4099-862a-65878f027ec4/scratchpad/wt-pr/package.json');
const { chromium } = require('playwright');
const [specPath, out] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cell = (c) => {
  const s = String(c);
  const cls = /^(PASS|KILLED|OK|409|held|yes)\b/.test(s) ? 'ok' : /^(FAIL|SURVIVED|503)\b/.test(s) ? 'bad' : /^(masked|n\/a|—)/.test(s) ? 'dim' : /^(WARN|flaky)/.test(s) ? 'warn' : '';
  return `<td class="${cls}">${esc(s)}</td>`;
};
const section = (s) => `
  <section>
    ${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}
    ${s.table ? `<table><thead><tr>${s.table.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>` : ''}
    ${s.pre ? `<pre>${s.pre.map((l) => {
      const t = esc(l);
      if (l.startsWith('++ ')) return `<span class="ok">${t.slice(3)}</span>`;
      if (l.startsWith('-- ')) return `<span class="bad">${t.slice(3)}</span>`;
      if (l.startsWith('!! ')) return `<span class="warn">${t.slice(3)}</span>`;
      if (l.startsWith('== ')) return `<span class="dim">${t.slice(3)}</span>`;
      if (l.startsWith('## ')) return `<span class="hd">${t.slice(3)}</span>`;
      return t;
    }).join('\n')}</pre>` : ''}
    ${s.note ? `<div class="note ${s.noteKind ?? ''}">${esc(s.note)}</div>` : ''}
  </section>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #0d1117; }
  #card { display: inline-block; padding: 28px 32px 30px; background: #0d1117; color: #e6edf3;
    font: 15px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; min-width: ${spec.minWidth ?? 1200}px; }
  h1 { margin: 0 0 4px; font-size: 24px; color: #f0f6fc; }
  .sub { color: #8b949e; margin-bottom: 18px; font-size: 14px; }
  h2 { font-size: 16px; color: #79c0ff; margin: 20px 0 8px; }
  table { border-collapse: collapse; font: 13.5px/1.4 ui-monospace, Menlo, monospace; width: 100%; }
  th { text-align: left; color: #8b949e; font-weight: 600; border-bottom: 1px solid #30363d; padding: 6px 10px; white-space: nowrap; }
  td { border-bottom: 1px solid #21262d; padding: 6px 10px; white-space: nowrap; vertical-align: top; }
  pre { margin: 0; padding: 12px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 6px;
    font: 13px/1.5 ui-monospace, Menlo, monospace; white-space: pre; overflow: hidden; }
  .ok { color: #3fb950; } .bad { color: #f85149; } .warn { color: #d29922; } .dim { color: #8b949e; } .hd { color: #79c0ff; }
  .note { margin-top: 12px; padding: 8px 12px; border-left: 3px solid #3fb950; background: #0f2a17; color: #c9d1d9; font-size: 14px; }
  .note.bad { border-color: #f85149; background: #2a1010; } .note.warn { border-color: #d29922; background: #2a2210; }
</style></head><body><div id="card"><h1>${esc(spec.title)}</h1><div class="sub">${esc(spec.subtitle ?? '')}</div>${spec.sections.map(section).join('')}</div></body></html>`;
writeFileSync(out.replace(/\.png$/, '.html'), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 2 });
await page.setContent(html);
const clipped = await page.evaluate(() => [...document.querySelectorAll('pre')].filter((p) => p.scrollWidth > p.clientWidth).length);
await page.locator('#card').screenshot({ path: out });
await browser.close();
console.log(`${out} clippedPre=${clipped}`);
