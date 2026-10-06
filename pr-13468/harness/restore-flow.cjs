// After a daemon restart: cold-load the parent, reopen the persisted side
// task from the right-panel list, continue it, close + reopen (no new create).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const [base, outDir, fake, modelLog] = process.argv.slice(2);
const log = []; const t0 = Date.now();
const note = (m, d = {}) => { const e = { t: ((Date.now() - t0) / 1000).toFixed(1), m, ...d }; log.push(e); console.log(JSON.stringify(e)); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1560, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const wire = [];
  p.on('request', (r) => { const u = r.url(); if (/side-task|\/load$|\/sessions\?/.test(u) && r.method() !== 'OPTIONS') wire.push(`${r.method()} ${u.replace(base, '').slice(0, 160)}`); });
  const shot = async (name) => { await p.screenshot({ path: path.join(outDir, `head-${name}.png`) }); note('shot', { name }); };
  const openList = async () => {
    const tog = p.getByRole('button', { name: 'Toggle right panel' });
    if (!(await p.getByText('View or create side tasks').isVisible().catch(() => false))) await tog.click();
    await p.getByText('View or create side tasks').click();
    await p.waitForTimeout(1500);
  };
  await p.goto(`${base}/?token=tok13468`);
  await p.waitForTimeout(2500);
  await p.getByText('Please remember the codeword', { exact: false }).first().click();
  await p.getByText('Noted. I will remember the codeword ORCHID-7.').first().waitFor({ timeout: 30000 });
  note('parent cold-loaded after daemon restart');
  const parentPaneHasChildPrompt = await p.locator('main, body').first().innerText().then((t) => t.includes('What is the codeword?'));
  await openList();
  const entries = await p.getByText('What is the codeword?', { exact: true }).count();
  note('side-task list after restart', { entriesNamedWhatIsTheCodeword: entries, parentPaneHasChildPromptBeforeOpen: parentPaneHasChildPrompt });
  await shot('3-restored-list');
  const createdBefore = wire.filter((w) => w.includes('side-task')).length;
  await p.getByText('What is the codeword?', { exact: true }).first().click();
  await p.getByText('From the inherited parent context: the codeword is ORCHID-7.').first().waitFor({ timeout: 30000 });
  note('reopened persisted child; prior answer restored');
  const ed = p.locator('[data-web-shell-composer-editor] .cm-content').last();
  await ed.click();
  await p.keyboard.type('What is the codeword after reopen? AFTER-REOPEN', { delay: 5 });
  await p.locator('[data-web-shell-composer-submit]').last().click();
  for (let i = 0; i < 80; i++) {
    const n = await p.getByText('From the inherited parent context: the codeword is ORCHID-7.').count();
    if (n >= 2) break; await p.waitForTimeout(250);
  }
  await p.waitForTimeout(800);
  const req = fs.readFileSync(modelLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.kind === 'main' && (l.lastUser || '').includes('AFTER-REOPEN')).at(-1);
  note('continued child after restore', { modelMarkers: req?.markers, reply: req?.reply });
  await shot('4-reopened-continued');
  // close tab, reopen again: must not create a new side task
  const tabSel = 'button[role="tab"][title="What is the codeword?"]';
  await p.locator(tabSel).locator('xpath=following-sibling::button').first().click();
  await p.locator(tabSel).waitFor({ state: 'detached', timeout: 10000 });
  note('tab closed', { tabsLeft: await p.locator(tabSel).count() });
  await shot('5a-closed');
  await openList();
  const entries2 = await p.getByText('What is the codeword?', { exact: true }).count();
  await p.getByText('What is the codeword?', { exact: true }).first().click();
  await p.getByText('AFTER-REOPEN', { exact: false }).first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(800);
  const createdAfter = wire.filter((w) => w.includes('side-task')).length;
  note('close + reopen', { listEntries: entries2, sideTaskCreatesDuringRestoreFlow: createdAfter, tabs: await p.locator(tabSel).count() });
  await shot('5-close-reopen');
  fs.writeFileSync(path.join(outDir, 'head-restore-browser.json'), JSON.stringify({ log, wire }, null, 2));
  await b.close();
})().catch((e) => { console.error('FLOW ERROR', e.message); fs.writeFileSync(path.join(outDir, 'head-restore-browser.json'), JSON.stringify({ log, error: e.message }, null, 2)); process.exit(1); });
