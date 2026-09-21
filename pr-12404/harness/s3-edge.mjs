// s3-edge.mjs <arm> <phase>  — offset-alignment edge prompts, each with tags, in ONE session.
import fs from 'node:fs';
import { launch, UI_URL, OUT, sleep, save, TOKEN } from './ui.mjs';
const [arm, phase] = process.argv.slice(2);
const { browser, page, log } = await launch({ height: 1100 });
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300)); });
await page.goto(UI_URL); await sleep(4000);
const pickFile = async (name) => {
  await page.keyboard.type('@'); await sleep(700);
  await page.locator('[role="option"]', { hasText: 'Files' }).first().click(); await sleep(1100);
  await page.locator('[role="option"]', { hasText: name }).first().click(); await sleep(900);
};
const pickExt = async () => {
  await page.keyboard.type('@'); await sleep(700);
  await page.locator('[role="option"]', { hasText: 'Extensions' }).first().click(); await sleep(1100);
  await page.locator('[role="option"]', { hasText: 'browser-kit' }).first().click(); await sleep(900);
};
const CASES = [
  { id: 'E1', steps: async () => { await page.keyboard.type('   E1 leading spaces '); await pickFile('README.md'); await page.keyboard.type('  '); } },
  { id: 'E2', steps: async () => { await page.keyboard.type('E2 first line'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('second line '); await pickExt(); } },
  { id: 'E3', steps: async () => { await page.keyboard.type('E3 '); await page.keyboard.insertText('看一下 🚀🎉 '); await pickFile('README.md'); await page.keyboard.type(' and '); await pickExt(); } },
  { id: 'E4', steps: async () => { await page.keyboard.type('E4 twice '); await pickFile('README.md'); await page.keyboard.type('vs '); await pickFile('README.md'); } },
];
const perBubble = async () => page.$$eval('[class*="chatBubble"]', (els) => els.map((b) => ({
  text: b.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
  tags: [...b.querySelectorAll('[class*="messageTag"][title]')].map((t) => t.textContent.trim()),
})).filter((b) => /^E\d/.test(b.text)));
const result = { arm, phase, sent: [] };
async function visitAll(label) {
  const out = [];
  const sent = result.sent.length ? result.sent : JSON.parse(fs.readFileSync(`${OUT}/${arm}-s3-submit.json`, 'utf8')).sent;
  for (const c of CASES) {
    const url = sent.find((x) => x.id === c.id).url;
    await page.goto(`${url}#token=${TOKEN}`); await sleep(5000);
    const b = (await perBubble()).filter((x) => x.text.startsWith(c.id));
    out.push(...b);
    await page.screenshot({ path: `${OUT}/${arm}-edge-${label}-${c.id}.png` });
  }
  return out;
}
if (phase === 'submit') {
  for (const c of CASES) {
    await page.getByText('New task').first().click(); await sleep(1500);
    const ed = page.locator('[contenteditable="true"]').first();
    await ed.click(); await c.steps();
    const isPrompt = (r) => r.method() === 'POST' && /\/prompt$/.test(new URL(r.url()).pathname);
    await page.screenshot({ path: `${OUT}/${arm}-edge-composer-${c.id}.png` });
    let reqP = page.waitForRequest(isPrompt, { timeout: 30000 });
    await page.keyboard.press('Enter');
    let req = await reqP.catch(() => null);
    if (!req) {
      console.log(`[${arm}] ${c.id}: Enter did not submit; clicking send`);
      reqP = page.waitForRequest(isPrompt, { timeout: 10000 });
      const btns = await page.locator('button[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const name = btns.find((n) => /send|submit/i.test(n));
      console.log('send button:', name);
      await page.locator('button[aria-label="Send message"]').last().click();
      req = await reqP;
    }
    const body = req.postDataJSON();
    const text = body.prompt[0].text;
    const anns = (body._meta?.inputAnnotations || []).map((a) => ({ s: a.start, e: a.end, t: a.text, ok: text.slice(a.start, a.end) === a.text }));
    await page.waitForURL(/\/session\//, { timeout: 15000 });
    result.sent.push({ id: c.id, text, anns, url: page.url() });
    console.log(`[${arm}] ${c.id} sent ${JSON.stringify(text)} anns=${JSON.stringify(anns)}`);
    await page.getByText('Done. (mock reply)').first().waitFor({ timeout: 30000 });
    await sleep(2500);
  }
  await page.reload(); await sleep(5000);
  result.refresh = await visitAll('2-refresh');
} else {
  result.reopen = await visitAll('3-restart');
}
for (const k of ['live', 'refresh', 'reopen']) if (result[k]) console.log(`[${arm}] ${k}:`, JSON.stringify(result[k].map((b) => `${b.text.slice(0, 3)}=${b.tags.length}`)));
result.log = log;
save(`${arm}-s3-${phase}.json`, result);
console.log(`[${arm}] pageerrors:`, log.filter((l) => l.startsWith('[pageerror]')).length);
await browser.close();
