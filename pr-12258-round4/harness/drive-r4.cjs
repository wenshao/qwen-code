// Real browser -> real bundled WebShell -> real daemon -> ACP child -> real stdio MCP fixture.
// usage: node drive-r4.cjs <engine chromium|webkit> <arm> <pageBase e.g. http://127.0.0.1:18601> <runDir> <outDir> [--block-isolated] [--steps a,b,c]
const pw = require(process.env.PW_PATH || 'playwright');
const fs = require('fs'); const path = require('path');
const [ENGINE, ARM, BASE, RUN, OUT] = process.argv.slice(2);
const BLOCK = process.argv.includes('--block-isolated');
const stepsArg = process.argv[process.argv.indexOf('--steps') + 1];
const STEPS = new Set((process.argv.includes('--steps') ? stepsArg : 'render,token,recover,burst,attack').split(','));
fs.mkdirSync(OUT, { recursive: true });
const R = { engine: ENGINE, arm: ARM, base: BASE, blockIsolated: BLOCK, steps: [] };
const step = (name, data) => { R.steps.push({ name, t: Date.now(), ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 600)); fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)); };
let PAGE;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const mcpLog = () => jsonl(`${RUN}/mcp-calls.jsonl`);
const toolCalls = (tool) => mcpLog().filter(e => e.ev === 'call' && e.tool === tool);
const vendorLog = () => jsonl(`${RUN}/vendor.jsonl`);
const exfilLog = () => jsonl(`${RUN}/exfil.jsonl`);
const modelLog = () => jsonl(`${RUN}/openai.jsonl`);

(async () => {
  const browser = await pw[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--no-proxy-server'] } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); PAGE = page;
  const popups = []; ctx.on('page', p => popups.push(p.url()));
  const netLog = []; const reqStart = new Map();
  ctx.on('request', r => { if (r.url().startsWith(BASE) && !/\/assets\//.test(r.url())) reqStart.set(r, Date.now()); });
  const fin = (r, st) => { const t = reqStart.get(r); if (t) netLog.push({ m: r.method(), path: new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id'), st, t0: t, ms: Date.now() - t }); };
  ctx.on('requestfinished', async r => fin(r, (await r.response().catch(() => null))?.status()));
  ctx.on('requestfailed', r => fin(r, 'failed:' + r.failure()?.errorText));
  const toolReqs = []; const toolResps = [];
  ctx.on('request', r => { if (r.url().includes('/mcp-app/tools/call')) toolReqs.push(Date.now()); });
  ctx.on('response', r => { if (r.url().includes('/mcp-app/tools/call')) toolResps.push(r.status()); });
  const consoleLines = []; page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  const sandboxResp = []; page.on('response', r => { if (r.url().includes('mcp-app-sandbox')) sandboxResp.push({ status: r.status(), url: r.url().replace(/csp=[^&]*/, 'csp=…'), csp: (r.headers()['content-security-policy'] || '').slice(0, 90) }); });
  if (BLOCK) {
    // Emulate a forwarded single-port connection: the dedicated isolated-origin listener is unreachable.
    await page.route(/\/mcp-app-sandbox\?/, (route) => {
      const u = new URL(route.request().url());
      if (['data', 'opaque'].includes(u.searchParams.get('mode'))) return route.continue();
      return route.abort('connectionrefused');
    });
  }
  await page.goto(`${BASE}/?token=tok-${ARM}`);
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  await composer.waitFor({ timeout: 30000 });
  const send = async (text) => { await composer.click(); await page.keyboard.type(text); await page.locator('[data-web-shell-composer-submit]').click(); };
  const waitText = async (t, nth = 0, timeout = 60000) => page.getByText(t, { exact: false }).nth(nth).waitFor({ timeout });
  const panelLoc = () => page.locator('[data-web-shell-permission-panel]').first();
  const answer = async (choose, timeout = 20000) => {
    const panel = panelLoc();
    try { await panel.waitFor({ timeout }); } catch { return null; }
    const text = (await panel.textContent()).replace(/\s+/g, ' ').slice(0, 240);
    const optionId = typeof choose === 'function' ? choose(text) : choose;
    await panel.locator(`[data-web-shell-permission-option][data-option-id="${optionId}"]`).click();
    await sleep(250);
    return { text, optionId };
  };
  const cardInfo = async (idx = 0) => {
    const card = page.locator('[data-testid="mcp-app"]').nth(idx);
    await card.waitFor({ timeout: 60000 });
    const iframeEl = card.locator('iframe');
    const proxy = await (await iframeEl.elementHandle()).contentFrame();
    let inner; for (let i = 0; i < 200 && !inner; i++) { inner = proxy?.childFrames()[0]; if (!inner) await sleep(250); }
    return { card, iframeEl, proxy, inner };
  };

  await send('hello'); await waitText('[done:plain]');
  step('warmup', {});
  await send('show dashboard');
  step('model-permission', await answer('proceed_once'));
  await waitText('[done:dashboard]');
  const t0 = Date.now();
  let { card, iframeEl, proxy, inner } = await cardInfo();
  const ready = inner ? await inner.waitForFunction(() => window.__ready === true, null, { timeout: 45000 }).then(() => true).catch(() => false) : false;
  const readyMs = Date.now() - t0;
  // data-mode may swap the inner frame after the 10 s fallback; re-resolve.
  ({ proxy, inner } = await cardInfo());
  await sleep(2500);
  const iframeAttrs = await iframeEl.evaluate(e => ({ src: e.src.replace(/csp=[^&]*/, 'csp=…'), sandbox: e.getAttribute('sandbox') })).catch(e => ({ error: String(e) }));
  const proxyState = await proxy.evaluate(() => ({ url: location.href.replace(/csp=[^&]*/, 'csp=…'), origin: self.origin, innerSandbox: document.querySelector('iframe')?.getAttribute('sandbox'), innerSrcPrefix: (document.querySelector('iframe')?.getAttribute('src') || '(srcdoc)').slice(0, 40) })).catch(e => ({ error: String(e).slice(0, 200) }));
  const appState = inner ? await inner.evaluate(() => ({ url: location.href.slice(0, 40), probes: window.__probes, ready: !!window.__ready })).catch(e => ({ error: String(e) })) : { error: 'no inner frame' };
  const vendorFrame = inner?.childFrames()[0];
  const vendorState = vendorFrame ? await vendorFrame.evaluate(() => ({ origin: self.origin, status: document.getElementById('s')?.textContent })).catch(e => ({ error: String(e) })) : null;
  const fallbackText = await card.evaluate(e => e.innerText.slice(0, 300)).catch(() => null);
  step('app-rendered', { pageOrigin: new URL(page.url()).origin, ready, readyMs, iframeAttrs, proxyState, appState, vendorState, fallbackText, sandboxResp: [...sandboxResp], exfilHits: exfilLog() });
  await card.screenshot({ path: path.join(OUT, 'app-card-initial.png') });
  if (!ready) { step('stop-not-ready', { consoleTail: consoleLines.slice(-30) }); await browser.close(); return; }
  const callsNow = () => inner.evaluate(() => window.__calls.map(c => ({ name: c.name, outcome: c.outcome.slice(0, 200), ms: c.ms })));
  const nCalls = () => inner.evaluate(() => window.__calls.length);
  const waitCalls = async (n, timeout = 30000) => inner.waitForFunction((n) => window.__calls.length >= n, n, { timeout });

  if (STEPS.has('token')) {
    const n0 = await nCalls();
    await inner.click('#btn-token');
    const perm = await answer('proceed_once');
    await waitCalls(n0 + 1);
    step('app-token', { perm, call: (await callsNow()).slice(-1), serverCalls: toolCalls('get_embed_token').length });
    await card.screenshot({ path: path.join(OUT, 'app-card-token.png') });
  }

  if (STEPS.has('recover')) {
    const starts0 = mcpLog().filter(e => e.ev === 'start').length;
    let n0 = await nCalls();
    await inner.click('#btn-expiring');
    const p1 = await answer('proceed_once');
    await waitCalls(n0 + 1, 60000);
    const first = (await callsNow()).slice(-1)[0];
    await sleep(1500);
    n0 = await nCalls();
    await inner.click('#btn-stable');
    const p2 = await answer('proceed_once', 8000);
    await waitCalls(n0 + 1, 60000);
    const second = (await callsNow()).slice(-1)[0];
    n0 = await nCalls();
    await inner.click('#btn-expiring');
    const p3 = await answer('proceed_once', 8000);
    await waitCalls(n0 + 1, 60000);
    const third = (await callsNow()).slice(-1)[0];
    const reqBefore = modelLog().length;
    await send('show dashboard');
    const p4 = await answer('proceed_once', 20000);
    await waitText('[done:dashboard]', 1, 60000).catch(() => {});
    const req = modelLog().slice(reqBefore).find(r => r.tools && r.tools.length);
    step('recover-after-session-error', {
      firstCall: first, secondCallStable: second, thirdCallExpiring: third,
      prompts: [p1, p2, p3].map(p => p && p.text.slice(0, 80)),
      injected: mcpLog().filter(e => e.ev === 'inject').length,
      serverProcessStartsDelta: mcpLog().filter(e => e.ev === 'start').length - starts0,
      serverExec: { expiring: toolCalls('expiring_app_tool').length, stable: toolCalls('stable_app_tool').length },
      nextModelTurnTools: req ? req.tools.filter(t => t.startsWith('mcp__')) : null,
      nextModelTurnPrompt: p4 && p4.text.slice(0, 80),
    });
    await card.screenshot({ path: path.join(OUT, 'app-card-recover.png') });
  }

  if (STEPS.has('burst')) {
    const N = Number(process.env.BURSTN || 70);
    const tok0 = toolCalls('get_embed_token').length;
    const n0 = await nCalls();
    await inner.evaluate((n) => window.__burst(n), N);
    await sleep(4000);
    const resolvedEarly = (await nCalls()) - n0;
    const diag = { toolCallRequestsIn4s: toolReqs.length, toolCallResponsesIn4s: toolResps.slice(), panelsInDom: await page.locator('[data-web-shell-permission-panel]').count(), panelOptionIds: await page.locator('[data-web-shell-permission-panel]').first().locator('[data-web-shell-permission-option]').evaluateAll(els => els.map(e => e.dataset.optionId + ':' + e.textContent.trim())).catch(() => null) };
    step('burst-diag', diag);
    const earlyOutcomes = (await callsNow()).slice(n0).map(c => c.outcome.slice(0, 60));
    // model turn needing approval while App approvals are pending
    const reqBefore = modelLog().length;
    // A second client posts a model prompt while the App approvals are pending
    // (the WebShell composer is replaced by the approval panel meanwhile).
    const sid = new URL(page.url()).pathname.split('/').pop();
    const restPrompt = process.env.NOREST ? "skipped" : await fetch(`${BASE}/session/${sid}/prompt`, { method: 'POST', headers: { authorization: `Bearer tok-${ARM}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: [{ type: 'text', text: 'show dashboard' }] }) }).then(async r => r.status + ' ' + (await r.text()).slice(0, 120)).catch(e => 'ERR ' + e);
    await sleep(5000);
    let appPrompts = 0, modelPrompt = null, answered = 0;
    for (let i = 0; i < Number(process.env.MAXANS || 80); i++) {
      const a = await answer((text) => /show_dashboard/.test(text) ? 'proceed_once' : 'proceed_once', 3000);
      if (!a) break;
      answered++;
      if (/show_dashboard/.test(a.text)) modelPrompt = a.text.slice(0, 120); else appPrompts++;
    }
    await sleep(3000);
    const tClick = Date.now();
    const pending = [...reqStart.entries()].filter(([r, t]) => !netLog.some(n => n.t0 === t)).map(([r, t]) => ({ m: r.method(), path: new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id'), ageMs: tClick - t }));
    step('burst-net', { unfinishedRequests: pending.filter(x => x.ageMs > 1000), permissionRequests: netLog.filter(n => /permission/.test(n.path)).concat(pending.filter(x => /permission/.test(x.path))) });
    const outcomes = (await callsNow()).slice(n0).map(c => c.outcome.replace(/SECRET-\S+/g, 'SECRET…').slice(0, 50));
    const hist = outcomes.reduce((m, o) => (m[o] = (m[o] || 0) + 1, m), {});
    const modelReqs = modelLog().slice(reqBefore);
    const toolMsgs = modelReqs.flatMap(r => (r.messages || []).filter(m => m.role === 'tool').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 120)));
    step('burst', { N, restPrompt, resolvedWithin4s: resolvedEarly, earlyOutcomeSample: [...new Set(earlyOutcomes)], appPromptsShown: appPrompts, answered, modelPromptShown: modelPrompt, appOutcomeHistogram: hist, serverTokenExec: toolCalls('get_embed_token').length - tok0, modelShowDashboardExec: toolCalls('show_dashboard').length, lastToolMsgs: [...new Set(toolMsgs)].slice(-3) });
    await page.screenshot({ path: path.join(OUT, 'page-after-burst.png') });
  }

  if (STEPS.has('wedge')) {
    const n0 = await nCalls();
    const tBurst = Date.now();
    await inner.evaluate((n) => window.__burst(n), 5);
    await sleep(3000);
    await page.screenshot({ path: path.join(OUT, 'page-wedged.png') });
    const timeline = [];
    let firstResolvedAt = null;
    while (Date.now() - tBurst < 420000) {
      const a = await answer('proceed_once', 2000);
      const done = (await nCalls()) - n0;
      if (a || done) timeline.push({ s: Math.round((Date.now() - tBurst) / 1000), clicked: !!a, resolved: done });
      if (done && !firstResolvedAt) firstResolvedAt = Math.round((Date.now() - tBurst) / 1000);
      if (done >= 5) break;
      await sleep(8000);
    }
    const outcomes = (await callsNow()).slice(n0).map(c => ({ o: c.outcome.replace(/SECRET-\S+/g, 'SECRET…').slice(0, 70), ms: c.ms }));
    step('wedge', { firstResolvedAtSec: firstResolvedAt, outcomes, serverTokenExec: toolCalls('get_embed_token').length, timeline: timeline.slice(0, 6).concat(timeline.slice(-4)) });
    await page.screenshot({ path: path.join(OUT, 'page-after-wedge.png') });
  }

  if (STEPS.has('kill')) {
    const pidNow = mcpLog().filter(e => e.ev === 'start').slice(-1)[0].pid;
    process.kill(pidNow, 'SIGKILL');
    await sleep(1500);
    const starts0 = mcpLog().filter(e => e.ev === 'start').length;
    const res = [];
    for (const btn of ['#btn-stable', '#btn-stable', '#btn-token']) {
      const n0 = await nCalls();
      await inner.click(btn);
      const p = await answer('proceed_once', 8000);
      await waitCalls(n0 + 1, 90000).catch(() => {});
      res.push({ btn, prompted: !!p, outcome: (await callsNow()).slice(-1)[0]?.outcome.replace(/SECRET-\S+/g, 'SECRET…').slice(0, 90) });
      await sleep(1500);
    }
    const reqBefore = modelLog().length;
    await send('show dashboard');
    const pm = await answer('proceed_once', 20000);
    await sleep(6000);
    const req = modelLog().slice(reqBefore).find(r => r.tools && r.tools.length);
    await waitText('[done:dashboard]', 1, 30000).catch(() => {});
    const after = [];
    for (let k = 0; k < 2; k++) {
      const n0 = await nCalls();
      await inner.click('#btn-stable');
      const p = await answer('proceed_once', 8000);
      await waitCalls(n0 + 1, 90000).catch(() => {});
      after.push({ prompted: !!p, outcome: (await callsNow()).slice(-1)[0]?.outcome.slice(0, 90) });
      await sleep(1500);
    }
    const modelToolMsgs = modelLog().slice(reqBefore).flatMap(r => (r.messages || []).filter(m => m.role === 'tool').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 160)));
    step('kill-server-then-app-calls', { appCallsAfterModelTurn: after, modelToolResult: [...new Set(modelToolMsgs)].slice(-2), mcpEvents: mcpLog().filter(e => e.t > 0).slice(-12).map(e => e.ev + ':' + (e.tool || '') + ':' + e.pid), killedPid: pidNow, appCalls: res, serverStartsAfterKill: mcpLog().filter(e => e.ev === 'start').length - starts0, serverExecAfter: { stable: toolCalls('stable_app_tool').length }, nextModelTurnTools: req ? req.tools.filter(t => t.startsWith('mcp__')) : null, modelPrompted: !!pm, showDashboardExec: toolCalls('show_dashboard').length });
    await card.screenshot({ path: path.join(OUT, 'app-card-after-kill.png') });
  }

  if (STEPS.has('fresh')) {
    const cardsBefore = await page.locator('[data-testid="mcp-app"]').count();
    await send('show dashboard');
    const pm = await answer('proceed_once', 20000);
    await page.locator('[data-testid="mcp-app"]').nth(cardsBefore).waitFor({ timeout: 60000 }).catch(() => {});
    const cardsAfter = await page.locator('[data-testid="mcp-app"]').count();
    const res = [];
    if (cardsAfter > cardsBefore) {
      const c = await cardInfo(cardsAfter - 1);
      await c.inner.waitForFunction(() => window.__ready === true, null, { timeout: 45000 });
      for (let k = 0; k < 2; k++) {
        const n0 = await c.inner.evaluate(() => window.__calls.length);
        await c.inner.click('#btn-stable');
        const p = await answer('proceed_once', 8000);
        await c.inner.waitForFunction((n) => window.__calls.length >= n, n0 + 1, { timeout: 90000 }).catch(() => {});
        res.push({ prompted: !!p, outcome: await c.inner.evaluate(() => window.__calls.slice(-1)[0]?.outcome.slice(0, 90)) });
      }
      await c.card.screenshot({ path: path.join(OUT, 'app-card-fresh.png') });
    }
    step('fresh-card-after-reconnect', { modelPrompted: !!pm, cardsBefore, cardsAfter, freshCardCalls: res, stableExec: toolCalls('stable_app_tool').length, showExec: toolCalls('show_dashboard').length });
  }

  if (STEPS.has('attack')) {
    const before = page.url();
    const r = await inner.evaluate(() => window.__attack()).catch(e => ({ error: String(e) }));
    await sleep(4000);
    step('attack', { result: r, topBefore: before, topAfter: page.url(), popups, vendorHits: vendorLog().filter(e => /topnav|popup/.test(e.url)).map(e => e.url) });
    await page.screenshot({ path: path.join(OUT, 'page-after-attack.png') });
  }
  step('done', { consoleTail: consoleLines.filter(l => /error|warn|refused|violat/i.test(l)).slice(-25) });
  await browser.close();
})().catch(async (e) => { try { await PAGE.screenshot({ path: path.join(OUT, "page-fatal.png") }); } catch {} step('FATAL', { error: String(e && e.stack || e).slice(0, 1500) }); process.exit(1); });
