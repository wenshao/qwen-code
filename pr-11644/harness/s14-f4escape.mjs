// S14 — F4: force an EMPTY, loading slash menu during a streaming turn:
// supported-commands fails (the session's command/skill snapshot stays unknown)
// and every Skills catalog read hangs. Type "/skills " mid-stream, press Escape once.
import fs from 'node:fs';
import { launch, openUi, save, sleep } from './ui.mjs';
const arm = process.argv[2];
const marker = `SLOWTURN s14 ${arm} ${Date.now()}`;
const { browser, context, page, reqs } = await launch();
await context.route('**/session/*/supported-commands', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"injected","code":"injected"}' }));
await context.route(/\/(config|runtime)\/skills(\?|$)|\/workspaces\/[^/]+\/skills(\?|$)|\/workspace\/skills(\?|$)/, () => { /* hang */ });
await openUi(page);
await sleep(6_000);
const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
await editor.click();
await page.keyboard.type(marker, { delay: 5 });
await page.keyboard.press('Enter');
await page.getByText(/ACK<SLOWTURN s14/).first().waitFor({ timeout: 60_000 });
await sleep(1_000);
const placeholder = async () => (await page.locator('.cm-placeholder').innerText().catch(() => '')).trim();
const streamingBefore = await placeholder();
await editor.click();
await page.keyboard.type('/skills ', { delay: 30 });
await sleep(1_500);
const menu = page.locator('[data-web-shell-slash-menu]');
const menuVisible = await menu.isVisible().catch(() => false);
const menuOptions = menuVisible ? await menu.getByRole('option').count() : -1;
const menuText = menuVisible ? (await menu.innerText()).replace(/\s+/g, ' ').slice(0, 80) : '';
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s14-${arm}-menu.png` });
const nBefore = reqs.length;
await page.keyboard.press('Escape');
await sleep(3_000);
const afterEsc = reqs.slice(nBefore).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
const log = fs.readFileSync('/root/git/h11644/mock.log', 'utf8');
const aborted = log.split('\n').some((l) => l.includes('client aborted') && l.includes(`s14 ${arm}`));
const res = { arm, streamingBefore, menuVisible, menuOptions, menuText, nonGetRequestsAfterEscape: afterEsc, upstreamStreamAborted: aborted, placeholderAfter: await placeholder(), menuVisibleAfter: await menu.isVisible().catch(() => false), editorTextAfter: (await editor.innerText()).trim() };
await page.screenshot({ path: `/root/git/h11644/shots/${process.env.OUTDIR || ''}s14-${arm}-after.png` });
save(`s14-${arm}`, res);
console.log(JSON.stringify(res, null, 2));
await browser.close();
