// Historical-page App binding: App turn falls outside the live replay window, user navigates back to it via the session timeline.
// usage: node hist-r4.cjs <engine> <arm> <base> <runDir> <outDir>
const pw = require(process.env.PW_PATH || 'playwright');
const fs = require('fs'); const path = require('path');
const [ENGINE, ARM, BASE, RUN, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const R = { engine: ENGINE, arm: ARM, steps: [] };
const step = (name, data) => { R.steps.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 700)); fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const toolCalls = (tool) => jsonl(`${RUN}/mcp-calls.jsonl`).filter(e => e.ev === 'call' && e.tool === tool);
let PAGE;
(async () => {
  const browser = await pw[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--no-proxy-server'] } : {});
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 })).newPage(); PAGE = page;
  const toolReqs = []; page.on('request', r => { if (r.url().includes('/mcp-app/tools/call')) toolReqs.push(r.url().replace(BASE, '')); });
  await page.goto(`${BASE}/?token=tok-${ARM}`);
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  await composer.waitFor({ timeout: 30000 });
  const send = async (t) => { await composer.click(); await page.keyboard.type(t); await page.locator('[data-web-shell-composer-submit]').click(); };
  const answer = async (id, timeout = 15000) => { const p = page.locator('[data-web-shell-permission-panel]').first(); try { await p.waitFor({ timeout }); } catch { return false; } await p.locator(`[data-web-shell-permission-option][data-option-id="${id}"]`).click(); await sleep(300); return true; };
  await send('hello'); await page.getByText('[done:plain]').first().waitFor({ timeout: 60000 });
  await send('show dashboard'); await answer('proceed_once'); await page.getByText('[done:dashboard]').first().waitFor({ timeout: 60000 });
  await page.locator('[data-testid="mcp-app"]').first().waitFor({ timeout: 60000 });
  const NT = Number(process.env.NTURNS || 25);
  for (let i = 0; i < NT; i++) { await send('filler ' + i); for (let k = 0; k < 120 && jsonl(`${RUN}/openai.jsonl`).filter(x => /filler /.test(JSON.stringify(x.messages.slice(-1))) && x.decision.text).length < i + 1; k++) await sleep(300); await sleep(1200); }
  step('built', { sessionUrl: page.url() });
  await page.reload();
  await composer.waitFor({ timeout: 30000 }); await sleep(4000);
  const liveCards = await page.locator('[data-testid="mcp-app"]').count();
  const ordinals = await page.locator('[data-turn-ordinal]').evaluateAll(els => els.map(e => e.getAttribute('data-turn-ordinal') + ':' + (e.getAttribute('aria-label') || '').slice(0, 30)));
  step('after-reload', { liveCards, ordinals, viewport: await page.locator('[data-history-viewport]').first().getAttribute('data-history-viewport').catch(() => null) });
  // Navigate to the App turn through the session timeline.
  const target = page.locator('[data-global-turn-navigation] [data-turn-ordinal="1"]').first();
  await target.evaluate(e => e.click());
  await page.locator('[data-history-viewport="historical"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  const view = await page.locator('[data-history-viewport]').first().getAttribute('data-history-viewport').catch(() => null);
  const card = page.locator('[data-testid="mcp-app"]').first();
  const cardVisible = await card.waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  let res = { view, cardVisible };
  if (cardVisible) {
    const proxy = await (await card.locator('iframe').elementHandle()).contentFrame();
    let inner; for (let i = 0; i < 120 && !inner; i++) { inner = proxy?.childFrames()[0]; if (!inner) await sleep(250); }
    const ready = await inner.waitForFunction(() => window.__ready === true, null, { timeout: 45000 }).then(() => true).catch(() => false);
    res.ready = ready;
    if (ready) {
      res.hostServerTools = await inner.evaluate(() => JSON.stringify(window.__hostCaps?.serverTools ?? null));
      const before = toolCalls('stable_app_tool').length;
      await inner.click('#btn-stable');
      res.prompted = await answer('proceed_once', 10000);
      await inner.waitForFunction(() => window.__calls.length >= 1, null, { timeout: 30000 }).catch(() => {});
      res.appOutcome = await inner.evaluate(() => window.__calls.map(c => c.outcome.slice(0, 120)));
      res.serverExec = toolCalls('stable_app_tool').length - before;
      res.toolCallRequests = toolReqs.slice();
      res.feedbackButtons = await page.locator('[data-history-viewport="historical"] button[aria-label*="eedback" i], [data-history-viewport="historical"] [data-assistant-feedback]').count();
    }
    await card.screenshot({ path: path.join(OUT, 'historical-app-card.png') });
  }
  await page.screenshot({ path: path.join(OUT, 'historical-page.png') });
  step('historical', res);
  await browser.close();
})().catch(async (e) => { try { await PAGE.screenshot({ path: path.join(OUT, 'page-fatal.png') }); } catch {} step('FATAL', { error: String(e && e.stack || e).slice(0, 1200) }); process.exit(1); });
