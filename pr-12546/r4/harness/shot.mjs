import { chromium } from '/Users/wenshao/git/v12546/merged/node_modules/playwright/index.mjs';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/50c97716-7195-475a-a8de-b9dfb77ea084/scratchpad/r4';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: 2 });
for (const f of ['f1', 'f2']) { await p.goto(`file://${SP}/fig/${f}.html`); await (await p.$('.card')).screenshot({ path: `${SP}/fig/${f}.png` }); }
await b.close();
