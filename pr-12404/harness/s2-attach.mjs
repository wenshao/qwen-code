// s2-attach.mjs <arm> <phase> <kind>  kind = image | text ; phase = submit | reopen
// A message with tags AND an uploaded attachment: do tags survive refresh/restart?
import fs from 'node:fs';
import { launch, UI_URL, OUT, sleep, userTags, userBubbleTexts, save, TOKEN } from './ui.mjs';
const [arm, phase, kind] = process.argv.slice(2);
const marker = kind === 'image' ? 'IMGCASE' : 'TXTCASE';
const { browser, page, log } = await launch();
await page.goto(UI_URL);
await sleep(4000);
const result = { arm, phase, kind };
const snap = async (label) => {
  await sleep(600);
  const bubble = page.locator('[class*="chatBubble"]', { hasText: marker }).first();
  const tags = await bubble.locator('[class*="messageTag"][title]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  await page.screenshot({ path: `${OUT}/${arm}-attach-${kind}-${label}.png` });
  const text = await bubble.innerText().catch(() => '(no bubble)');
  console.log(`[${arm}] ${kind} ${label}: tags=${JSON.stringify(tags)} text=${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 160))}`);
  return { tags, text };
};
if (phase === 'submit') {
  // new task
  await page.getByText('New task').first().click(); await sleep(1500);
  const ed = page.locator('[contenteditable="true"]').first();
  await ed.click();
  const fileInputs = await page.locator('input[type="file"]').count();
  console.log('file inputs:', fileInputs);
  await page.locator('input[type="file"]').nth(1).setInputFiles(kind === 'image' ? `${OUT}/red.png` : `${OUT}/notes.txt`);
  await sleep(1500);
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.type(`${marker} check `);
  await page.keyboard.type('@'); await sleep(700);
  await page.locator('[role="option"]', { hasText: 'Files' }).first().click(); await sleep(1200);
  await page.locator('[role="option"]', { hasText: 'README.md' }).first().click(); await sleep(1000);
  await page.keyboard.type('with '); await page.keyboard.type('@'); await sleep(700);
  await page.locator('[role="option"]', { hasText: 'MCP resources' }).first().click(); await sleep(1200);
  await page.locator('[role="option"]', { hasText: 'o2-docs' }).first().click(); await sleep(1000);
  await page.screenshot({ path: `${OUT}/${arm}-attach-${kind}-0-composer.png` });
  const reqP = page.waitForRequest((r) => r.method() === 'POST' && /\/prompt$/.test(new URL(r.url()).pathname), { timeout: 15000 });
  await page.keyboard.press('Enter');
  const body = (await reqP).postDataJSON();
  result.prompt = body.prompt.map((b) => b.type === 'text' ? { type: 'text', text: b.text } : { type: b.type, uri: b.uri, name: b.name, mimeType: b.mimeType });
  result.meta = body._meta;
  console.log(`[${arm}] prompt blocks:`, JSON.stringify(result.prompt), '\nannotations:', JSON.stringify((body._meta?.inputAnnotations || []).map((a) => [a.start, a.end, a.text])));
  await page.getByText('Done. (mock reply)').first().waitFor({ timeout: 30000 });
  await sleep(1500);
  result.live = await snap('1-live');
  await page.reload(); await sleep(6000);
  result.refresh = await snap('2-after-refresh');
} else {
  await page.goto(`${process.env.SESSION_URL}#token=${TOKEN}`);
  await sleep(5000);
  result.reopen = await snap('3-after-restart');
}
result.log = log;
save(`${arm}-s2-${kind}-${phase}.json`, result);
console.log(`[${arm}] pageerrors:`, log.filter((l) => l.startsWith('[pageerror]')).length);
await browser.close();
