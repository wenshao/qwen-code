// Round 7: real browser -> bundled WebShell -> daemon -> ACP child -> stdio MCP fixture.
// usage: node drive-r7.cjs <engine> <arm> <base> <runDir> <outDir> --steps timeouts|failinit
//   [--servers a,b,c] [--fail-method ui/notifications/tool-result] [--no-inject]
const pw = require(process.env.PW_PATH || 'playwright');
const fs = require('fs'); const path = require('path');
const [ENGINE, ARM, BASE, RUN, OUT] = process.argv.slice(2);
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STEPS = new Set(opt('--steps', 'timeouts').split(','));
const SERVERS = opt('--servers', 'fxdefault,fxgen,fxshort,fxapp').split(',');
const FAIL_METHOD = opt('--fail-method', 'ui/notifications/tool-result');
const NO_INJECT = process.argv.includes('--no-inject');
fs.mkdirSync(OUT, { recursive: true });
const R = { engine: ENGINE, arm: ARM, base: BASE, steps: [] };
const step = (name, data) => { R.steps.push({ name, t: Date.now(), ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 900)); fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const mcpLog = () => jsonl(`${RUN}/mcp-calls.jsonl`);
const toolCalls = (tool, tag) => mcpLog().filter(e => e.ev === 'call' && e.tool === tool && (!tag || e.tag === tag));
let PAGE;

(async () => {
  const browser = await pw[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--no-proxy-server'] } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage(); PAGE = page;
  const consoleLines = []; page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  const appCallReqs = []; ctx.on('request', r => { if (r.url().includes('/mcp-app/tools/call')) appCallReqs.push({ t: Date.now(), body: (r.postData() || '').slice(0, 200) }); });
  let patched = 0;
  if (STEPS.has('failinit')) {
    // Fault injection in the host adapter: make PostMessageTransport.send throw for one
    // notification method (the "postMessage transport errors" trigger named in R8-3).
    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      const re = /this\.eventTarget\.postMessage\(([A-Za-z_$][\w$]*),"\*"\)/g;
      const n = (body.match(re) || []).length;
      if (n) {
        body = body.replace(re, (_m, v) => `(globalThis.__qwenFail&&${v}&&${v}.method===globalThis.__qwenFail?(globalThis.__qwenFailHits=(globalThis.__qwenFailHits||0)+1,(()=>{throw new Error("injected transport failure: "+${v}.method)})()):this.eventTarget.postMessage(${v},"*"))`);
        patched += n;
      }
      await route.fulfill({ response: resp, body, headers: { ...resp.headers(), 'cache-control': 'no-store' } });
    });
  }
  await page.goto(`${BASE}/?token=tok-${ARM}&lang=en`);
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  await composer.waitFor({ timeout: 30000 });
  const send = async (text) => { await composer.click(); await page.keyboard.type(text); await page.locator('[data-web-shell-composer-submit]').click(); };
  const waitText = async (t, nth = 0, timeout = 60000) => page.getByText(t, { exact: false }).nth(nth).waitFor({ timeout });
  const panelLoc = () => page.locator('[data-web-shell-permission-panel]').first();
  const answer = async (choose, timeout = 20000) => {
    const panel = panelLoc();
    try { await panel.waitFor({ timeout }); } catch { return null; }
    const text = (await panel.textContent()).replace(/\s+/g, ' ').slice(0, 240);
    await panel.locator(`[data-web-shell-permission-option][data-option-id="${choose}"]`).click();
    await sleep(250);
    return { text };
  };

  await send('hello'); await waitText('[done:plain]');
  step('warmup', { patchedPostMessageSites: patched });

  if (STEPS.has('timeouts')) {
    let done = 0;
    for (const srv of SERVERS) {
      const t0 = Date.now();
      await send(`show ${srv} slow dashboard`);
      const perm = await answer('proceed_once');
      await waitText('[done:dashboard]', done, 60000);
      done++;
      const toolMs = Date.now() - t0;
      await sleep(800);
      const reads = mcpLog().filter(e => e.tag === srv && e.ev === 'resources/read').map(e => ({ phase: e.phase, ms: e.ms, reason: e.reason && e.reason.slice(0, 60) }));
      const warnLoc = page.getByText(`from '${srv}' could not be displayed`, { exact: false }).last();
      let warning = null, rendered = null;
      if (await warnLoc.count()) {
        warning = (await warnLoc.innerText()).trim();
        await warnLoc.scrollIntoViewIfNeeded();
        await warnLoc.screenshot({ path: path.join(OUT, `warn-${srv}.png`) }).catch(() => {});
      } else {
        const card = page.locator('[data-testid="mcp-app"]').last();
        if (await card.count()) {
          const proxy = await (await card.locator('iframe').elementHandle()).contentFrame();
          let inner; for (let i = 0; i < 120 && !inner; i++) { inner = proxy?.childFrames()[0]; if (!inner) await sleep(250); }
          rendered = inner ? await inner.waitForFunction(() => window.__ready === true, null, { timeout: 45000 }).then(() => true).catch(() => false) : false;
          await card.scrollIntoViewIfNeeded();
          await card.screenshot({ path: path.join(OUT, `card-${srv}.png`) }).catch(() => {});
        }
      }
      step(`timeout-${srv}`, { perm: perm && perm.text.slice(0, 80), toolMs, reads, warning, rendered });
    }
    await page.screenshot({ path: path.join(OUT, 'page-timeouts.png') });
  }

  if (STEPS.has('failinit')) {
    if (!NO_INJECT) await page.evaluate((m) => { globalThis.__qwenFail = m; globalThis.__qwenFailHits = 0; }, FAIL_METHOD);
    const cardsBefore = await page.locator('[data-testid="mcp-app"]').count();
    const stable0 = toolCalls('stable_app_tool').length;
    await send('show autocall dashboard');
    const perm = await answer('proceed_once');
    await waitText('[done:dashboard]', 0, 60000);
    const card = page.locator('[data-testid="mcp-app"]').nth(cardsBefore);
    await card.waitFor({ timeout: 60000 });
    const tCard = Date.now();
    const iframeEl = card.locator('iframe');
    const snap = async () => ({
      sinceCardMs: Date.now() - tCard,
      failHits: await page.evaluate(() => globalThis.__qwenFailHits || 0),
      cardText: (await card.innerText()).replace(/\s+/g, ' ').slice(0, 200),
      iframeSrcAttr: await iframeEl.evaluate(e => e.hasAttribute('src') ? e.getAttribute('src').replace(/csp=[^&]*/, 'csp=…').slice(0, 90) : null).catch(e => 'ERR ' + e.message),
      iframeDisplay: await iframeEl.evaluate(e => getComputedStyle(e).display).catch(() => null),
      frames: page.frames().map(f => f.url().replace(/csp=[^&]*/, 'csp=…').slice(0, 70)),
      appReady: await (async () => { for (const f of page.frames()) { try { if (await f.evaluate(() => window.__ready === true)) return true; } catch {} } return false; })(),
      appCallRequests: appCallReqs.length,
    });
    await sleep(2500);
    const early = await snap();
    step('failinit-early', { inject: NO_INJECT ? null : FAIL_METHOD, perm: perm && perm.text.slice(0, 80), ...early });
    await page.screenshot({ path: path.join(OUT, 'failinit-early.png') });
    // The App issues stable_app_tool on its own ~5 s after connecting.
    const panel = panelLoc();
    let appPrompt = null;
    try { await panel.waitFor({ timeout: 15000 }); appPrompt = (await panel.textContent()).replace(/\s+/g, ' ').slice(0, 200); } catch {}
    const mid = await snap();
    await page.screenshot({ path: path.join(OUT, 'failinit-prompt.png') });
    let clicked = false;
    if (appPrompt) { await panel.locator('[data-web-shell-permission-option][data-option-id="proceed_once"]').click(); clicked = true; await sleep(3000); }
    const late = await snap();
    const exec = toolCalls('stable_app_tool').slice(stable0).map(e => ({ tag: e.tag, args: e.args }));
    step('failinit', { inject: NO_INJECT ? null : FAIL_METHOD, appPromptShown: appPrompt, clickedApprove: clicked, serverExecutedStable: exec, mid, late });
    await page.screenshot({ path: path.join(OUT, 'failinit-late.png') });
  }
  step('done', { consoleTail: consoleLines.filter(l => /error|warn|inject|fail/i.test(l)).slice(-15) });
  await browser.close();
})().catch(async (e) => { try { await PAGE.screenshot({ path: path.join(OUT, 'page-fatal.png') }); } catch {} step('FATAL', { error: String(e && e.stack || e).slice(0, 1500) }); process.exit(1); });
