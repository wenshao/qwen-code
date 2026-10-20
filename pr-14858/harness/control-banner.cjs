// Control: a normal turn (no loop stop). Does the "interrupted" banner appear?
const { chromium } = require('/root/verify/pr14858/wt-head/node_modules/playwright');
const [base, token, prompt, out] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${base}/?token=${token}`);
  const ed = p.locator('[data-web-shell-composer-editor] .cm-content');
  await ed.waitFor({ timeout: 60000 });
  await ed.click();
  await p.keyboard.type(prompt);
  await p.locator('[data-web-shell-composer-submit]').click();
  await p.getByText(/^(ok|DONE .*)$/).first().waitFor({ timeout: 120000 });
  await p.waitForTimeout(3000);
  const live = await p.getByText('The previous request was interrupted').count();
  await p.screenshot({ path: out.replace('.png', '-live.png') });
  await p.reload();
  await p.getByText(/^(ok|DONE .*)$/).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(4000);
  const reload = await p.getByText('The previous request was interrupted').count();
  await p.screenshot({ path: out.replace('.png', '-reload.png') });
  console.log(JSON.stringify({ prompt, bannerLive: live, bannerAfterReload: reload, url: p.url() }));
  await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
