import { launch, open, shot, sleep } from './ui.mjs';
const browser = await launch();
for (const [actor, lang] of [['alice', 'en'], ['alice', 'zh']]) {
  const v = await open(browser, { arm: 'head', actor, lang, session: process.argv[2], height: 1100 });
  await v.page.locator('[data-managed-workspace-binding]').waitFor({ timeout: 30_000 });
  await sleep(2500);
  console.log(await shot(v.page, `head-07-real-model-${actor}-${lang}`));
  await v.context.close();
}
await browser.close();
