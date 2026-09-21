// s1.mjs <arm> <phase>  phase = submit | reopen
// submit: compose via the REAL @ picker (file, extension, MCP, long file) -> send -> live -> browser refresh
// reopen: fresh browser after daemon restart -> open the session from the sidebar -> click the file tag
import fs from 'node:fs';
import { launch, UI_URL, OUT, sleep, userTags, userBubbleTexts, save } from './ui.mjs';
const [arm, phase] = process.argv.slice(2);
const { browser, page, log, wire } = await launch();
const snap = async (label) => {
  await sleep(600);
  const tags = await userTags(page);
  const bubbles = await userBubbleTexts(page);
  await page.screenshot({ path: `${OUT}/${arm}-${label}.png` });
  console.log(`[${arm}] ${label}: ${tags.length} tags`, JSON.stringify(tags.map((t) => ({ text: t.text, h: t.h, padR: t.padR, radius: t.radius, font: t.font, bg: t.bg, role: t.role }))));
  console.log(`[${arm}] ${label}: bubbles`, JSON.stringify(bubbles.slice(0, 3)));
  return { tags, bubbles };
};
const result = { arm, phase };
await page.goto(UI_URL);
await sleep(4000);
if (phase === 'submit') {
  const ed = page.locator('[contenteditable="true"]').first();
  await ed.click();
  const pick = async (prov, ...path) => {
    await page.keyboard.type('@');
    await sleep(700);
    await page.locator('[role="option"]', { hasText: prov }).first().click();
    await sleep(1200);
    for (const p of path) {
      await page.locator('[role="option"]', { hasText: p }).first().click();
      await sleep(1200);
    }
  };
  await page.keyboard.type('Review ');
  await pick('Files', 'README.md');
  await page.keyboard.type('using ');
  await pick('Extensions', 'browser-kit');
  await page.keyboard.type('and ');
  await pick('MCP resources', 'o2-docs');
  await page.keyboard.type('plus ');
  await pick('Files', 'src/', 'very-long-module-name');
  await page.screenshot({ path: `${OUT}/${arm}-0-composer.png` });
  const reqP = page.waitForRequest((r) => r.method() === 'POST' && /\/prompt$/.test(new URL(r.url()).pathname), { timeout: 15000 });
  await page.keyboard.press('Enter');
  const req = await reqP;
  const body = req.postDataJSON();
  result.promptRequest = { prompt: body.prompt, _meta: body._meta };
  console.log(`[${arm}] POST prompt body:`, JSON.stringify({ prompt: body.prompt, _meta: body._meta }));
  await page.getByText('Done. (mock reply)').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  result.url = page.url();
  result.live = await snap('1-live');
  await page.reload();
  await sleep(6000);
  result.refresh = await snap('2-after-refresh');
  fs.writeFileSync(`${OUT}/${arm}-session-url.txt`, result.url);
} else {
  // fresh browser, open the session row from the sidebar
  await page.locator('text=/^Review/').first().click().catch(() => {});
  await sleep(5000);
  result.reopen = await snap('3-after-restart');
  // close any preview, then click the restored file tag
  const fileTag = page.locator('[class*="messageTag"][role="button"]', { hasText: 'README.md' }).first();
  const fileReq = page.waitForResponse((r) => /\/file\b/.test(new URL(r.url()).pathname), { timeout: 10000 }).catch(() => null);
  const hasTag = await fileTag.count();
  result.fileTagClickable = hasTag > 0;
  if (hasTag) {
    await fileTag.click();
    const resp = await fileReq;
    result.fileResponse = resp ? { status: resp.status(), url: resp.url().replace(/token=[^&]+/, 'token=…') } : null;
    await sleep(2000);
    result.previewHasFixture = await page.getByText('tag reload test fixture').count();
    await page.screenshot({ path: `${OUT}/${arm}-4-file-preview.png` });
    console.log(`[${arm}] file tag click ->`, JSON.stringify(result.fileResponse), 'fixture visible:', result.previewHasFixture);
  } else {
    console.log(`[${arm}] no clickable README.md tag after restart`);
  }
}
result.wire = wire; result.log = log;
save(`${arm}-s1-${phase}.json`, result);
console.log(`[${arm}] pageerrors:`, log.filter((l) => l.startsWith('[pageerror]')).length);
await browser.close();
