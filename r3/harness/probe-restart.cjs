// Restart the daemon under an open long session; no search/navigation involved (unless NAV=1).
const { chromium } = require('playwright');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const LONG = require('./seed-long.json').sessionId;
const BASE = 'http://127.0.0.1:14234';
const btn = (p) => p.getByRole('button', { name: /^Search this conversation$/ });
const snap = async (p) => ({
  rail: await p.locator('[data-global-turn-navigation]').count(),
  railHidden: await p.evaluate(() => !!document.querySelector('[data-global-turn-navigation]')?.closest('[hidden]')),
  search: await btn(p).count(),
  title: (await p.locator('header, [class*="header"]').first().textContent().catch(() => ''))?.slice(0, 40),
});
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const sse = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (/events|load|turn-index|capabilities/.test(u.pathname)) sse.push(`${((Date.now()-t0)/1000).toFixed(1)} ${r.method()} ${u.pathname.replace(LONG,'<S>')}`); });
  let t0 = Date.now();
  await p.goto(`${BASE}/session/${LONG}?token=verify-token-12234`);
  await p.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(3000);
  console.log('before', JSON.stringify(await snap(p)));
  t0 = Date.now(); sse.length = 0;
  execFileSync('kill', [fs.readFileSync('/var/tmp/pr12234-r3/daemon.pid', 'utf8').trim()]);
  await p.waitForTimeout(1500);
  execFileSync('tmux', ['-L', 'pr12234r3', 'kill-window', '-t', 'main:daemon']);
  execFileSync('tmux', ['-L', 'pr12234r3', 'new-window', '-t', 'main', '-n', 'daemon', `env -i PATH=${process.env.PATH} /var/tmp/pr12234-r3/harness/start-daemon.sh 14234 2>&1 | tee -a /var/tmp/pr12234-r3/daemon.log`]);
  for (const s of [5, 10, 20, 40, 60]) {
    await p.waitForTimeout((s - (s === 5 ? 0 : [5,10,20,40,60][[5,10,20,40,60].indexOf(s)-1])) * 1000);
    console.log(`t+${s}s`, JSON.stringify(await snap(p)));
  }
  console.log(sse.slice(0, 30).join('\n'));
  await p.screenshot({ path: __dirname + '/shots/r3-restart-plain.png' });
  // Does a reload restore it?
  await p.reload();
  await p.getByText('Answer #600:', { exact: false }).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(3000);
  console.log('after reload', JSON.stringify(await snap(p)));
  await b.close();
})();
