// s5-view.mjs <arm> <label> — open each s5 session in a fresh browser; report bubble/tag/error state + /load status.
import fs from 'node:fs';
import { launch, BASE, TOKEN, OUT, sleep, save } from './ui.mjs';
const [arm, label, sidsFrom] = process.argv.slice(2);
const sids = JSON.parse(fs.readFileSync(sidsFrom ? `${OUT}/${sidsFrom}` : `${OUT}/${arm}-s5-sids.json`, "utf8")).cases;
const res = {};
for (const [name, c] of Object.entries(sids)) {
  const { browser, page, log, wire } = await launch();
  const loads = [];
  page.on('response', async (r) => { const p = new URL(r.url()).pathname; if (/\/(load|transcript)/.test(p)) loads.push({ status: r.status(), path: p, bytes: Number(r.headers()['content-length'] || 0) || (await r.body().catch(() => Buffer.alloc(0))).length }); });
  await page.goto(`${BASE}/session/${c.sid}#token=${TOKEN}`); await sleep(7000);
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const state = {
    bubbleVisible: await page.locator('[class*="chatBubble"]', { hasText: name }).count(),
    tags: await page.locator('[class*="chatBubble"] [class*="messageTag"][title]').evaluateAll((els) => els.map((e) => e.textContent.trim())),
    appCrashed: /Something went wrong/.test(body),
    messageErrorBoundary: /(failed to render|could not be displayed|render error)/i.test(body),
    replyVisible: body.includes('Done. (mock reply)'),
    loads, errors: log.filter((l) => !/live-state|Bad Request|failed to set model|Internal Server Error/.test(l)).slice(0, 6),
    bodySnippet: body.replace(/\s+/g, ' ').slice(0, 300),
  };
  await page.screenshot({ path: `${OUT}/${arm}-s5-${label}-${name}.png` });
  console.log(`[${arm}] ${label} ${name}:`, JSON.stringify({ ...state, bodySnippet: undefined }));
  res[name] = state;
  await browser.close();
}
save(`${arm}-s5-view-${label}.json`, res);
