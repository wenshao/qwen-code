// Real Chromium -> daemon-served Web Shell -> real daemon -> real ACP children.
// usage: node browser-flow.cjs <daemonUrl> <arm> <outDir> <fakeBase>
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const [base, arm, outDir, fake] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const log = [];
const t0 = Date.now();
const note = (m, d = {}) => { const e = { t: ((Date.now() - t0) / 1000).toFixed(1), m, ...d }; log.push(e); console.log(JSON.stringify(e)); };
const held = () => fetch(`${fake}/control/held`).then((r) => r.json()).then((j) => j.held);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const sideTaskCalls = [];
  p.on('response', async (r) => {
    if (r.url().includes('/side-task')) {
      let body = ''; try { body = await r.text(); } catch {}
      sideTaskCalls.push({ status: r.status(), url: r.url().replace(base, ''), body: body.slice(0, 400) });
      note('wire: POST side-task', { status: r.status(), body: body.slice(0, 300) });
    }
  });
  const shot = async (name) => { await p.screenshot({ path: path.join(outDir, `${arm}-${name}.png`) }); note('shot', { name }); };
  const send = async (text) => {
    const ed = p.locator('[data-web-shell-composer-editor] .cm-content').first();
    await ed.click();
    await p.keyboard.type(text, { delay: 5 });
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape').catch(() => {});
    await p.locator('[data-web-shell-composer-submit]').first().click();
  };
  await p.goto(`${base}/?token=tok13468`);
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label="New task"],button[title="New task"]')];
    for (const b of btns) {
      let el = b;
      for (let i = 0; i < 6 && el; i++) {
        el = el.parentElement;
        if (el && el.innerText.split('\n')[0].trim() === 'secondary') { b.setAttribute('data-pr13468', 'secondary-new'); return; }
      }
    }
  });
  const nb = p.locator('[data-pr13468="secondary-new"]');
  await p.getByText('secondary', { exact: true }).first().hover();
  await p.waitForTimeout(300);
  await nb.evaluate((el) => el.click());
  await p.waitForTimeout(1500);
  note('opened new task in secondary', { workspaceChip: await p.locator('button[aria-label="Workspace"],[aria-label="Workspace"]').first().innerText().catch(() => '?') });
  await send('Please remember the codeword ORCHID-7 for later.');
  await p.getByText('Noted. I will remember the codeword ORCHID-7.').first().waitFor({ timeout: 30000 });
  note('parent context turn rendered');
  await send('HOLD-PARENT: run the long parent task');
  for (let i = 0; i < 60 && (await held()) === 0; i++) await p.waitForTimeout(250);
  await p.getByText('Working on the long parent task').first().waitFor({ timeout: 15000 });
  note('parent busy', { held: await held() });
  await send('/btw side What is the codeword?');
  if (arm === 'head') {
    await p.getByText('From the inherited parent context: the codeword is ORCHID-7.').first().waitFor({ timeout: 30000 });
    note('side-task answered while parent busy', { held: await held() });
    await p.waitForTimeout(800);
    await shot('1-busy-parent-side-task');
  } else {
    await p.waitForTimeout(4000);
    note('base after /btw side', { held: await held() });
    await shot('1-busy-parent-side-task');
  }
  await fetch(`${fake}/control/release`);
  await p.getByText('finished the long parent task').first().waitFor({ timeout: 30000 });
  note('parent released');
  await p.waitForTimeout(800);
  await shot('2-after-release');
  fs.writeFileSync(path.join(outDir, `${arm}-browser.json`), JSON.stringify({ log, sideTaskCalls }, null, 2));
  await b.close();
})().catch(async (e) => { console.error('FLOW ERROR', e.message); fs.writeFileSync(path.join(outDir, `${arm}-browser.json`), JSON.stringify({ log, error: e.message }, null, 2)); process.exit(1); });
