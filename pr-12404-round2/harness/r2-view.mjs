// r2-view.mjs <arm> <label> <sids-json> — open each session in a fresh browser (the disk /load path).
import fs from 'node:fs';
import { launch, BASE, TOKEN, OUT, sleep, save } from './ui.mjs';
const [arm, label, from] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(`${OUT}/${from}`, 'utf8')).cases;
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(cases);
const res = {};
for (const name of only) {
  const { browser, page, log } = await launch();
  const loads = [];
  page.on('response', async (r) => { const p = new URL(r.url()).pathname; if (/\/(load|transcript)$/.test(p)) { let n = 0; try { n = (await r.body()).length; } catch {} loads.push({ status: r.status(), path: p, bytes: n }); } });
  await page.goto(`${BASE}/session/${cases[name].sid}#token=${TOKEN}`); await sleep(7000);
  const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const st = {
    bubble: await page.locator('[class*="chatBubble"]', { hasText: name }).count(),
    tags: await page.locator('[class*="chatBubble"] [class*="messageTag"]').evaluateAll((els) => els.filter((e) => !e.parentElement.closest('[class*="messageTag"]')).map((e) => e.textContent.trim())),
    couldNotDisplay: (body.match(/This message could not be displayed/g) || []).length,
    appCrashed: /Something went wrong/.test(body),
    reply: body.includes('Done. (mock reply)'),
    loads,
    pageErrors: log.filter((l) => l.startsWith('[pageerror]') || /TypeError/.test(l)).slice(0, 3),
  };
  await page.screenshot({ path: `${OUT}/${arm}-${name}-${label}.png` });
  console.log(`[${arm}] ${label} ${name}: ${JSON.stringify({ ...st, loads: st.loads.map((l) => `${l.path}:${l.status}:${l.bytes}`) })}`);
  res[name] = st;
  await browser.close();
}
save(`${arm}-r2-view-${label}.json`, res);
