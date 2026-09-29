// Composite labelled A/B figures from real TerminalCapture PNGs.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

export type Panel = { label: string; tone: 'bad' | 'good' | 'neutral'; img: string; top?: number; height?: number; note?: string };

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function compose(out: string, title: string, subtitle: string, panels: Panel[], cols = 2) {
  const W = 940; // css px width of one terminal capture (captured at DPR 2)
  const cells = panels.map((p) => {
    const b64 = readFileSync(p.img).toString('base64');
    const top = p.top ?? 0;
    const h = p.height ?? 700;
    const color = p.tone === 'bad' ? '#f85149' : p.tone === 'good' ? '#3fb950' : '#8b949e';
    return `<div class="cell">
      <div class="lab" style="border-color:${color}"><span class="dot" style="background:${color}"></span>${esc(p.label)}</div>
      <div class="crop" style="height:${h}px"><img src="data:image/png;base64,${b64}" style="width:${W}px;margin-top:-${top}px"/></div>
      ${p.note ? `<div class="note" style="color:${color}">${esc(p.note)}</div>` : ''}
    </div>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#0d1117;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#e6edf3}
    .wrap{padding:18px 20px 20px;display:inline-block}
    h1{font-size:20px;margin:0 0 4px}
    .sub{font-size:13.5px;color:#8b949e;margin:0 0 14px;max-width:${cols * (W + 16)}px}
    .grid{display:grid;grid-template-columns:repeat(${cols},${W}px);gap:16px;align-items:start}
    .cell{background:#0a0d12;border:1px solid #30363d;border-radius:8px;overflow:hidden}
    .lab{font-size:15px;font-weight:600;padding:8px 12px;border-bottom:2px solid;display:flex;align-items:center;gap:8px}
    .dot{width:10px;height:10px;border-radius:50%;display:inline-block}
    .crop{overflow:hidden}
    .crop img{display:block}
    .note{font-size:13.5px;font-weight:600;padding:8px 12px;border-top:1px solid #30363d}
  </style></head><body><div class="wrap"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div><div class="grid">${cells.join('')}</div></div></body></html>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForTimeout(300);
  const el = await page.$('.wrap');
  const box = (await el!.boundingBox())!;
  await page.setViewportSize({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 });
  await (await page.$('.wrap'))!.screenshot({ path: out });
  await browser.close();
  console.log('wrote', out, Math.round(box.width), 'x', Math.round(box.height));
}
