// Creates a real session through the HEAD Web Shell composer. The prompt's
// scenario marker makes the mock drive the real Plan & Review flow:
// enter_plan_mode -> todo_write (dependency plan) -> exit_plan_mode, which this
// driver approves in the UI like a user -> todo_write progress -> linked agents.
// usage: node seed.mjs DAG|BIG
import fs from 'node:fs';
import { launch, openPage, ARMS, sleep, H } from './lib.mjs';

const scn = process.argv[2] || 'DAG';
const label = process.argv[3] || scn;
const browser = await launch();
const { page, problems } = await openPage(browser, { theme: 'dark' });
await page.goto(`${ARMS.head}/?theme=dark`, { waitUntil: 'domcontentloaded' });
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.waitFor({ timeout: 30000 });
await editor.click();
await page.keyboard.type(`Plan the payments-sdk v2 migration. __SCN:${scn}__`);
await page.locator('[data-web-shell-composer-submit]').click();
for (let i = 0; i < 60 && !/\/session\//.test(page.url()); i++) await sleep(500);
const sessionId = decodeURIComponent(page.url().split('/session/')[1]?.split(/[?#]/)[0] ?? '');
console.log('session', sessionId);
fs.writeFileSync(`${H}/out/session-${label}.txt`, sessionId);

// The Plan & Review card is approved by approve.mjs (a fresh page load).
await sleep(5000);
await page.screenshot({ path: `${H}/out/seed-${label}.png` });
console.log('problems', problems.filter((p) => !p.includes('Conversations')).slice(0, 10));
await browser.close();
