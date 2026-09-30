// Renders evidence cards (PNG) from card spec files. Each spec is a JSON file
// in fig/specs/<name>.json: { title, subtitle, sections: [{ heading, lines:
// [{ text, tone }] }], note }. Text comes from the raw run logs via
// build-specs.mjs; this file only draws.
// usage: node render-cards.mjs <worktree-with-playwright> <figDir>
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const worktree = process.argv[2];
const figDir = process.argv[3];
const require = createRequire(path.join(worktree, 'package.json'));
const { chromium } = require('playwright');

const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tones = {
  ok: '#3fb950',
  bad: '#f85149',
  warn: '#d29922',
  dim: '#8b949e',
  key: '#79c0ff',
  plain: '#e6edf3',
};

function html(spec) {
  const sections = spec.sections
    .map((section) => {
      const lines = section.lines
        .map((line) => {
          const text = escape(line.text).replace(
            /\[\[(.+?)\]\]/g,
            '<b class="hl">$1</b>',
          );
          return `<span style="color:${tones[line.tone ?? 'plain']}">${text}</span>`;
        })
        .join('\n');
      return `<h2>${escape(section.heading)}</h2><pre>${lines}</pre>`;
    })
    .join('');
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
    #card{display:inline-block;padding:28px 32px 26px;background:#0d1117;color:#e6edf3;min-width:900px}
    h1{font-size:21px;margin:0 0 4px;font-weight:600}
    .sub{color:#8b949e;font-size:13.5px;margin:0 0 14px}
    h2{font-size:13px;color:#79c0ff;margin:16px 0 6px;font-weight:600;text-transform:none}
    pre{margin:0;padding:12px 14px;background:#161b22;border:1px solid #30363d;border-radius:6px;
        font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
    .hl{color:#ffa657;font-weight:700}
    .note{margin-top:16px;padding:8px 12px;border-left:3px solid #3fb950;color:#c9d1d9;font-size:13.5px;max-width:1180px;line-height:1.5}
    .note.warn{border-left-color:#d29922}
  </style><div id="card"><h1>${escape(spec.title)}</h1><p class="sub">${escape(spec.subtitle)}</p>${sections}<div class="note ${spec.noteTone ?? ''}">${escape(spec.note)}</div></div>`;
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2 });
for (const file of readdirSync(path.join(figDir, 'specs')).sort()) {
  if (!file.endsWith('.json')) continue;
  const spec = JSON.parse(
    readFileSync(path.join(figDir, 'specs', file), 'utf8'),
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.setContent(html(spec));
  const box = await page.locator('#card').boundingBox();
  const out = path.join(figDir, file.replace(/\.json$/, '.png'));
  await page.locator('#card').screenshot({ path: out });
  writeFileSync(out.replace(/\.png$/, '.html'), html(spec));
  console.log(`${file} -> ${path.basename(out)} ${Math.round(box.width)}x${Math.round(box.height)}`);
  await page.close();
}
await browser.close();
