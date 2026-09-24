import { chromium } from '/Users/wenshao/git/v12546/merged/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 980, height: 400 }, deviceScaleFactor: 2 });
for (const f of ['f1', 'f2', 'f3']) {
  await p.goto(`file:///Users/wenshao/git/v12546/fig/${f}.html`);
  await (await p.$('.card')).screenshot({ path: `/Users/wenshao/git/v12546/fig/${f}.png` });
}
await b.close();
