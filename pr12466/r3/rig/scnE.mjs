import { openShell, send, sleep, SHOTS } from './lib.mjs';
const delay = Number(process.argv[2] || 300);
const { ctx, page, requests } = await openShell(4661, { height: 900 });
const t0 = Date.now();
await send(page, `SCN:slow fresh-${delay}`);
await sleep(delay);
const btn = page.getByRole('button', { name: 'View tool calls' }).last();
await btn.waitFor({ timeout: 20000 }); await btn.click();
const samples = [];
for (let i = 0; i < 16; i++) {
  await sleep(1000);
  samples.push(await page.evaluate(() => { const p = document.querySelector('section[aria-label="Tool calls"]'); return `${p?.querySelector('[role=alert]')?.innerText.replace(/\s+/g, ' ') ?? '-'} | rows=${document.querySelectorAll('ul[data-web-shell-turn-calls] > li').length} | combo=${p?.querySelector('[aria-label="Prompt"]')?.innerText}`; }));
  if (i === 2) await page.screenshot({ path: `${SHOTS}/E-fresh-${delay}.png` });
}
console.log(samples.map((s, i) => `${i + 1}s ${s}`).join('\n'));
console.log(requests.filter((r) => r.url.includes('turn-index') || r.url.includes('tool-calls')).map((r) => `${r.t - t0}ms ${r.method ?? r.status} ${r.url.replace(/\/session\/[^/]+/, '/session/:id').replace(/workspaces\/[^/]+/, 'ws').slice(0, 90)}`).join('\n'));
await ctx.close();
