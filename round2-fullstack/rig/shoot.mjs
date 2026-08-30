import { chromium } from '/Users/wenshao/git/qwen-code/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const dir = '/Users/wenshao/git/rig-10357/shots';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  await p.goto('file://' + dir + '/' + f);
  await p.waitForTimeout(150);
  const box = await p.evaluate(() => {
    const el = document.querySelector('.footer');
    const r = el.getBoundingClientRect();
    return { bottom: r.bottom + window.scrollY, width: document.documentElement.scrollWidth };
  });
  const h = Math.ceil(box.bottom + 26);
  await p.setViewportSize({ width: 2400, height: Math.min(h, 4000) });
  await p.waitForTimeout(80);
  const png = f.replace(/\.html$/, '.png');
  await p.screenshot({ path: dir + '/' + png, clip: { x: 0, y: 0, width: 2400, height: h } });
  console.log('shot', png, h);
}
await b.close();
