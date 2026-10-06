// Real Web Shell (served by the real daemon) driven in Chromium against a scripted model.
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = 'http://127.0.0.1:18932';
const FAKE = 'http://127.0.0.1:18931';
const ARM = process.env.ARM || 'head';
const OUT = process.env.OUT || `out-${ARM}`;
fs.mkdirSync(OUT, { recursive: true });
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const results = [];
const editorSel = '[data-web-shell-composer-editor] .cm-content';
async function open(browser, url = `${BASE}/?token=rigtoken`) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  if (process.env.CONSOLE) page.on('console', (m) => { if (m.type() !== 'log' && m.type() !== 'debug') console.log('console.' + m.type(), m.text().slice(0, 300)); });
  await page.goto(url);
  await page.waitForSelector(editorSel, { timeout: 20000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const users = (page) => page.$$eval('[data-web-shell-user-bubble]', (els) => els.map((e) => e.textContent.trim()));
const composer = (page) => page.$eval(editorSel, (e) => e.textContent.trim());
const banner = (page) => page.getByRole('button', { name: 'Continue execution' }).count();
const toasts = (page) => page.$$eval('[data-web-shell-toast-host] > *', (els) => els.map((e) => e.textContent.trim().slice(0, 120)));
const bodyText = (page) => page.$eval('[data-web-shell-message-list]', (e) => e.innerText).catch(() => '');
const state = async (page) => ({ users: await users(page), composer: await composer(page), banner: await banner(page), toasts: await toasts(page) });
async function send(page, text) { await page.locator(editorSel).click(); await page.keyboard.type(text); await page.keyboard.press('Enter'); }
async function retype(page, text) { await page.locator(editorSel).click(); await page.keyboard.press('Control+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); }
async function firstTurn(page) { await send(page, 'hello first'); await page.getByText('ok: hello first').waitFor({ timeout: 15000 }); await page.waitForTimeout(400); }
async function escEsc(page, gap = 120) { await page.keyboard.press('Escape'); await page.waitForTimeout(gap); await page.keyboard.press('Escape'); }
const modelRequests = async () => (await (await fetch(`${FAKE}/control/requests`)).json()).filter((r) => r.stream && !/SUGGESTION MODE|Managed memory has/.test(r.text));
const modelSaw = async (needle) => { const r = (await modelRequests()).filter((q) => q.text.includes(needle)).pop(); return r ? { users: r.users, images: r.images } : null; };
async function scenario(name, fn) {
  if (only && !only.has(name)) return;
  const browser = await chromium.launch();
  let r;
  try { r = { name, ...(await fn(browser)) }; } catch (e) { r = { name, error: String(e?.stack || e).slice(0, 400) }; }
  finally { await browser.close(); }
  results.push(r); console.log(JSON.stringify(r));
}
(async () => {
  await scenario('S1-hold', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD oops typo S1');
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/S1-a-sent.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/S1-b-armed.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/S1-c-after.png` });
    const after = await state(page);
    await retype(page, 'fixed prompt S1');
    await page.getByText('ok: fixed prompt S1').waitFor({ timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/S1-d-resent.png` });
    const saw = await modelSaw('fixed prompt S1');
    await page.reload(); await page.waitForSelector(editorSel); await page.getByText('fixed prompt S1').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(700);
    return { after, modelSaw: saw, reloadedUsers: await users(page) };
  });
  await scenario('S2-think', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'THINK oops typo S2');
    await page.getByText('Let me think about this').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/S2-a-thinking.png` });
    await escEsc(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/S2-b-after.png` });
    return { after: await state(page), tail: (await bodyText(page)).replace(/\s+/g, ' ').slice(-90) };
  });
  await scenario('S3-text', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'SLOWTEXT keep me S3');
    await page.getByText('Partial answer').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    await escEsc(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/S3-after.png` });
    return { after: await state(page) };
  });
  await scenario('S4-tool', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'TOOL keep me S4');
    await page.getByText('Tool finished').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    await escEsc(page);
    await page.waitForTimeout(1200);
    return { after: await state(page) };
  });
  await scenario('S5-draft', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD keep me S5');
    await page.waitForTimeout(300);
    await page.locator(editorSel).click(); await page.keyboard.type('my new draft');
    await page.waitForTimeout(100);
    await escEsc(page);
    await page.waitForTimeout(1200);
    return { after: await state(page) };
  });
  await scenario('S6-queued', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD keep me S6');
    await page.waitForTimeout(300);
    await send(page, 'queued follow up S6');
    await page.waitForTimeout(300);
    await escEsc(page);
    await page.getByText('ok: queued follow up S6').waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    return { after: await state(page) };
  });
  await scenario('S7-stop-button', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD oops typo S7');
    await page.waitForTimeout(400);
    await page.locator('[data-web-shell-composer-submit]').click();
    await page.waitForTimeout(1200);
    return { after: await state(page) };
  });
  await scenario('S8-first-prompt', async (browser) => {
    const { page } = await open(browser);
    await send(page, 'HOLD oops first S8');
    await page.waitForTimeout(900);
    await escEsc(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/S8-after.png` });
    return { after: await state(page) };
  });
  await scenario('S9-observer', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    const obs = await open(browser, `${page.url()}?token=rigtoken`);
    await obs.page.getByText('ok: hello first').waitFor({ timeout: 15000 });
    await send(page, 'HOLD oops typo S9');
    await obs.page.getByText('HOLD oops typo S9').first().waitFor({ timeout: 10000 });
    const observerDuring = await users(obs.page);
    await escEsc(page);
    await page.waitForTimeout(1500);
    return { after: await state(page), observerDuring, observerAfter: await state(obs.page) };
  });
  await scenario('S10-observer-cancels', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    const obs = await open(browser, `${page.url()}?token=rigtoken`);
    await obs.page.getByText('ok: hello first').waitFor({ timeout: 15000 });
    await send(page, 'HOLD peer prompt S10');
    await obs.page.getByText('HOLD peer prompt S10').first().waitFor({ timeout: 10000 });
    await obs.page.waitForTimeout(500);
    await obs.page.locator(editorSel).click();
    await escEsc(obs.page);
    await page.waitForTimeout(1500);
    return { sender: await state(page), observer: await state(obs.page) };
  });
  await scenario('S11-instant', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await page.locator(editorSel).click(); await page.keyboard.type('HOLD oops instant S11');
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const after = await state(page);
    await retype(page, 'fixed prompt S11');
    await page.getByText('ok: fixed prompt S11').waitFor({ timeout: 12000 }).catch(() => {});
    return { after, finalUsers: await users(page), modelSaw: await modelSaw('fixed prompt S11') };
  });
  await scenario('S12-image', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await page.locator(editorSel).click();
    await page.evaluate((sel) => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, editorSel);
    await page.waitForTimeout(600);
    const imgs = () => page.locator('[data-web-shell-composer-images] img').count();
    const imagesBefore = await imgs();
    await page.keyboard.type('HOLD describe this S12'); await page.keyboard.press('Enter');
    await page.getByText('HOLD describe this S12').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(600);
    const imagesWhileRunning = await imgs();
    await escEsc(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/S12-after.png` });
    const after = await state(page); const imagesAfter = await imgs();
    await retype(page, 'what is in this image S12');
    await page.getByText('ok: what is in this image S12').waitFor({ timeout: 12000 }).catch(() => {});
    return { imagesBefore, imagesWhileRunning, imagesAfter, after, finalUsers: await users(page), modelSaw: await modelSaw('what is in this image S12') };
  });
  await scenario('S13-repeat', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    const rounds = [];
    for (let i = 0; i < 12; i++) {
      await page.locator(editorSel).click(); await page.keyboard.press('Control+A'); await page.keyboard.type(`${i % 2 ? 'THINK' : 'HOLD'} oops round ${i}`); await page.keyboard.press('Enter');
      await page.waitForTimeout([120, 250, 500, 900][i % 4]);
      await escEsc(page, [60, 120, 200][i % 3]);
      await page.waitForTimeout(700);
      const s = await state(page);
      rounds.push({ ok: s.users.length === 1 && /oops round/.test(s.composer) && s.banner === 0 && s.toasts.length === 0, s });
    }
    await retype(page, 'final real prompt S13');
    await page.getByText('ok: final real prompt S13').waitFor({ timeout: 15000 });
    return { takenBack: rounds.filter((r) => r.ok).length, rounds: rounds.length, bad: rounds.filter((r) => !r.ok), finalUsers: await users(page), modelSaw: await modelSaw('final real prompt S13') };
  });
  await scenario('S14-reload-mid-turn', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD keep me S14');
    await page.waitForTimeout(500);
    await page.reload(); await page.waitForSelector(editorSel); await page.getByText('HOLD keep me S14').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
    await page.locator(editorSel).click();
    await escEsc(page);
    await page.waitForTimeout(1500);
    return { after: await state(page) };
  });
  // Review P1: output the daemon produced right as the cancel landed must never be rewound.
  await scenario('S15-late-output', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    const runs = [];
    const waits = [700, 760, 820, 860, 900, 940, 980, 1040, 1100, 1200];
    for (let i = 0; i < waits.length; i++) {
      const tag = `S15 r${i}`;
      await page.locator(editorSel).click(); await page.keyboard.press('Control+A'); await page.keyboard.type(`DELAYTEXT900 ${tag}`); await page.keyboard.press('Enter');
      await page.waitForTimeout(waits[i]);
      await escEsc(page, 40);
      await page.waitForTimeout(1800);
      const s = await state(page);
      const req = (await modelRequests()).filter((q) => q.text.includes(tag)).pop();
      const answerShown = (await bodyText(page)).includes(`late answer: DELAYTEXT900 ${tag}`);
      const promptKept = s.users.some((u) => u.includes(tag));
      const modelFinished = req ? req.aborted === false : null;
      // Taking the turn back while the model had delivered its answer is the bug.
      const violation = modelFinished === true && !promptKept;
      runs.push({ wait: waits[i], modelFinished, answerShown, promptKept, composer: s.composer.slice(0, 40), banner: s.banner, toasts: s.toasts, violation });
      // Reset for the next round: an answered turn stays; a taken-back one left the prompt in the composer.
      if (!promptKept) { await page.locator(editorSel).click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); }
      await page.waitForTimeout(200);
    }
    return { violations: runs.filter((r) => r.violation).length, finished: runs.filter((r) => r.modelFinished).length, takenBack: runs.filter((r) => !r.promptKept).length, runs, finalUsers: await users(page) };
  });
  // Review P2: a correction sent the instant the prompt is back must neither be lost nor merged.
  await scenario('S16-instant-correction', async (browser) => {
    const { page } = await open(browser);
    await firstTurn(page);
    await send(page, 'HOLD oops typo S16');
    await page.waitForTimeout(400);
    await escEsc(page, 60);
    await page.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes('oops typo S16'), editorSel, { polling: 'raf', timeout: 5000 });
    const tRestored = Date.now();
    await page.locator(editorSel).click(); await page.keyboard.press('Control+A'); await page.keyboard.type('fixed prompt S16'); await page.keyboard.press('Enter');
    const tEnter = Date.now() - tRestored;
    await page.waitForTimeout(150);
    const firstEnterRefused = (await composer(page)).includes('fixed prompt S16');
    if (firstEnterRefused) { await page.waitForTimeout(400); await page.keyboard.press('Enter'); }
    await page.getByText('ok: fixed prompt S16').waitFor({ timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(600);
    const after = await state(page);
    await page.reload(); await page.waitForSelector(editorSel); await page.getByText('fixed prompt S16').first().waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(700);
    return { msToEnter: tEnter, firstEnterRefused, after, modelSaw: await modelSaw('fixed prompt S16'), reloadedUsers: await users(page) };
  });
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
