// Real Chromium → real WebShell (bundled dist) → real daemon → ACP child → real stdio MCP fixture.
// usage: node drive.cjs <arm> <daemonPort> <outDir>
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [ARM, DP, OUT] = process.argv.slice(2);
const RUN = process.env.RUNDIR || `/root/verify/pr12258-r2/run-${ARM}`;
fs.mkdirSync(OUT, { recursive: true });
const R = { arm: ARM, steps: [] };
const step = (name, data) => { R.steps.push({ name, t: Date.now(), ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 400)); fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R, null, 1)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mcpLog = () => fs.existsSync(`${RUN}/mcp-calls.jsonl`) ? fs.readFileSync(`${RUN}/mcp-calls.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const toolCalls = (tool, tag = 'fixture') => mcpLog().filter(e => e.ev === 'call' && e.tool === tool && e.tag === tag);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const consoleLines = []; page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  const toolCallReqs = []; page.on('request', r => { if (r.url().includes('/mcp-app/tools/call')) toolCallReqs.push({ url: r.url(), body: r.postData() }); });
  const sandboxNavs = []; page.on('framenavigated', f => { if (f.url().includes('mcp-app-sandbox')) sandboxNavs.push(f.url()); });
  await page.goto(`http://127.0.0.1:${DP}/?token=tok-${ARM}`);
  const composer = page.locator('[data-web-shell-composer-editor] .cm-content');
  await composer.waitFor({ timeout: 30000 });
  const send = async (text) => { await composer.click(); await page.keyboard.type(text); await page.locator('[data-web-shell-composer-submit]').click(); };
  const waitText = async (t, timeout = 60000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });
  const approve = async (optionId, label) => {
    const panel = page.locator('[data-web-shell-permission-panel]').first();
    await panel.waitFor({ timeout: 30000 });
    const opts = await panel.locator('[data-web-shell-permission-option]').evaluateAll(els => els.map(e => ({ id: e.dataset.optionId, label: e.textContent.trim() })));
    const heading = (await panel.textContent()).slice(0, 300);
    if (label) await panel.screenshot({ path: path.join(OUT, `${label}.png`) });
    await panel.locator(`[data-web-shell-permission-option][data-option-id="${optionId}"]`).click();
    await panel.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    return { opts, heading };
  };
  // 1. warm-up turn (MCP discovery)
  await send('hello'); await waitText('[done:plain]');
  step('warmup', {});
  // 2. model renders the App
  await send('show dashboard');
  const p1 = await approve('proceed_once', 'perm-show-dashboard');
  step('model-tool-permission', p1);
  await waitText('[done:dashboard]');
  const card = page.locator('[data-testid="mcp-app"]').first();
  await card.waitFor({ timeout: 30000 });
  const iframeEl = card.locator('iframe');
  const iframeAttrs = await iframeEl.evaluate(e => ({ src: e.src, sandbox: e.getAttribute('sandbox') }));
  const proxy = await (await iframeEl.elementHandle()).contentFrame();
  let inner;
  for (let i = 0; i < 60 && !inner; i++) { inner = proxy.childFrames()[0]; if (!inner) await sleep(250); }
  const innerReady = await inner.waitForFunction(() => window.__ready === true || window.__probes, null, { timeout: 30000 }).then(() => true).catch(() => false);
  await sleep(1500);
  const appState = await inner.evaluate(() => ({ probes: window.__probes, hostCaps: window.__hostCaps ?? null, ready: !!window.__ready })).catch(e => ({ error: String(e) }));
  const proxyState = await proxy.evaluate(() => ({ url: location.href, origin: self.origin, innerSandbox: document.querySelector('iframe')?.getAttribute('sandbox') })).catch(e => ({ error: String(e) }));
  const vendorFrame = inner.childFrames()[0];
  await sleep(1500);
  const vendorState = vendorFrame ? await vendorFrame.evaluate(() => ({ origin: self.origin, status: document.getElementById('s')?.textContent })).catch(e => ({ error: String(e) })) : null;
  step('app-rendered', { pageOrigin: new URL(page.url()).origin, iframeAttrs, proxyState, appState, vendorState, innerReady, sandboxNavs: [...sandboxNavs] });
  await card.screenshot({ path: path.join(OUT, 'app-card-initial.png') });
  if (!appState.ready) { step('app-not-ready-stop', { consoleTail: consoleLines.slice(-30) }); await browser.close(); return; }
  if (ARM === 'base') {
    await inner.click('#btn-token');
    await inner.waitForFunction(() => window.__calls.length >= 1, null, { timeout: 20000 }).catch(() => {});
    const panel = await page.locator('[data-web-shell-permission-panel]').count();
    step('base-app-token', { calls: await inner.evaluate(() => window.__calls.map(c => ({ name: c.name, outcome: c.outcome }))), permissionPanel: panel, serverCalls: toolCalls('get_embed_token').length, toolCallReqs: toolCallReqs.length });
    await card.screenshot({ path: path.join(OUT, 'app-card-token.png') });
    const r = await fetch(`http://127.0.0.1:${DP}/session/x/mcp-app/tools/call`, { method: 'POST', headers: { authorization: `Bearer tok-${ARM}`, 'content-type': 'application/json' }, body: '{}' });
    step('base-route', { status: r.status });
    step('done', { consoleTail: consoleLines.filter(l => /error|warn/i.test(l)).slice(-25) });
    await browser.close(); return;
  }
  const callsNow = () => inner.evaluate(() => window.__calls.map(c => ({ name: c.name, outcome: c.outcome, ms: c.ms })));
  const waitCalls = async (n, timeout = 30000) => inner.waitForFunction((n) => window.__calls.length >= n, n, { timeout });
  // 3. App-initiated App-only tool → permission → approve
  const beforeTok = toolCalls('get_embed_token').length;
  await inner.click('#btn-token');
  const p2 = await approve('proceed_once', 'perm-app-token');
  await waitCalls(1);
  step('app-token-approved', { perm: p2, calls: await callsNow(), serverCallsDelta: toolCalls('get_embed_token').length - beforeTok, reqs: toolCallReqs.slice(-1) });
  await card.screenshot({ path: path.join(OUT, 'app-card-token.png') });
  // composer idle after background App call?
  const composerBusy = async () => page.evaluate(() => { const b = document.querySelector('[data-web-shell-composer-submit]'); return { submitLabel: b?.getAttribute('aria-label') ?? b?.textContent, processingText: /Processing/i.test(document.body.innerText) }; });
  step('composer-after-app-call', await composerBusy());
  // 4. model-only tool from App → must be rejected, no permission prompt, no server execution
  const beforeMO = toolCalls('model_only_tool').length;
  await inner.click('#btn-model-only'); await waitCalls(2);
  const promptShown = await page.locator('[data-web-shell-permission-panel]').count();
  step('app-model-only', { calls: (await callsNow()).slice(-1), promptShown, serverCallsDelta: toolCalls('model_only_tool').length - beforeMO });
  // 5. unknown tool
  await inner.click('#btn-unknown'); await waitCalls(3);
  step('app-unknown', { calls: (await callsNow()).slice(-1) });
  // 6. failing tool (isError) → approve → App sees isError
  await inner.click('#btn-fail');
  const p3 = await approve('proceed_once');
  await waitCalls(4);
  step('app-failing', { perm: p3.opts.map(o => o.id), calls: (await callsNow()).slice(-1) });
  // 7. deny
  const beforeDeny = toolCalls('get_embed_token').length;
  await inner.click('#btn-token');
  const p4 = await approve('cancel', 'perm-app-token-deny');
  await waitCalls(5);
  step('app-token-denied', { calls: (await callsNow()).slice(-1), serverCallsDelta: toolCalls('get_embed_token').length - beforeDeny });
  await card.screenshot({ path: path.join(OUT, 'app-card-after-matrix.png') });
  // 8. follow-up model turn: must not carry the raw App result
  await send('follow up question'); await page.getByText('[done:plain]').nth(1).waitFor({ timeout: 60000 });
  const busySeries = []; for (let i = 0; i < 20; i++) { busySeries.push((await composerBusy()).submitLabel); if (busySeries[busySeries.length - 1] === 'Send message') break; await sleep(500); }
  step('followup-turn', { busySeries, final: await composerBusy() });
  await page.screenshot({ path: path.join(OUT, 'page-after-followup.png'), fullPage: false });
  // 9. slow App tool → approve → reload mid-call → server must observe cancellation
  await inner.click('#btn-slow');
  await approve('proceed_once');
  for (let i = 0; i < 40 && !toolCalls('slow_app_tool').some(e => e.phase === 'start'); i++) await sleep(250);
  const tReload = Date.now();
  await page.reload();
  for (let i = 0; i < 60 && !toolCalls('slow_app_tool').some(e => e.phase !== 'start'); i++) await sleep(250);
  step('slow-cancel-on-reload', { slow: toolCalls('slow_app_tool'), msFromReload: (toolCalls('slow_app_tool').find(e => e.phase !== 'start')?.t ?? 0) - tReload });
  // 10. after reload: replayed App gets a fresh origin and can still call tools
  await composer.waitFor({ timeout: 30000 });
  const card2 = page.locator('[data-testid="mcp-app"]').first();
  await card2.waitFor({ timeout: 60000 });
  const proxy2 = await (await card2.locator('iframe').elementHandle()).contentFrame();
  let inner2; for (let i = 0; i < 60 && !inner2; i++) { inner2 = proxy2.childFrames()[0]; if (!inner2) await sleep(250); }
  await inner2.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const origin2 = await inner2.evaluate(() => self.origin);
  const beforeTok2 = toolCalls('get_embed_token').length;
  await inner2.click('#btn-token');
  await approve('proceed_once');
  await inner2.waitForFunction(() => window.__calls.length >= 1, null, { timeout: 30000 });
  step('after-reload', { origin1: appState.probes.selfOrigin, origin2, calls: await inner2.evaluate(() => window.__calls.map(c => c.outcome)), serverCallsDelta: toolCalls('get_embed_token').length - beforeTok2, composer: await composerBusy() });
  await card2.screenshot({ path: path.join(OUT, 'app-card-after-reload.png') });
  // 11. two Apps in one page: sibling isolation
  await send('show two dashboards');
  await approve('proceed_once'); await approve('proceed_once').catch(() => {});
  await page.getByText('[done:dashboard]').nth(1).waitFor({ timeout: 60000 }).catch(() => {});
  await sleep(3000);
  const cards = page.locator('[data-testid="mcp-app"]');
  const nCards = await cards.count();
  const sib = [];
  for (let i = 0; i < nCards; i++) {
    const pf = await (await cards.nth(i).locator('iframe').elementHandle()).contentFrame();
    const inf = pf?.childFrames()[0];
    if (!inf) { sib.push({ i, missing: true }); continue; }
    await inf.waitForFunction(() => !!window.__probes, null, { timeout: 20000 }).catch(() => {});
    sib.push({ i, origin: await inf.evaluate(() => self.origin).catch(() => null), siblingAppDocs: await inf.evaluate(() => window.__probes?.siblingAppDocs).catch(() => null), documentDomainSet: await inf.evaluate(() => window.__probes?.documentDomainSet).catch(() => null) });
  }
  step('sibling-apps', { nCards, sib });
  await page.screenshot({ path: path.join(OUT, 'page-two-apps.png') });
  step('done', { consoleTail: consoleLines.filter(l => /error|warn/i.test(l)).slice(-25), toolCallReqs: toolCallReqs.length });
  await browser.close();
})().catch(async (e) => { step('FATAL', { error: String(e && e.stack || e).slice(0, 1500) }); process.exit(1); });
