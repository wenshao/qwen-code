// Measure: DB Turn COMPLETED -> page composer re-enabled / progress row gone. usage: node ui/lag.mjs <arm> <sid> <n>
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
const require = createRequire('/Users/wenshao/pr13973-rig/src-merge/package.json');
const { chromium } = require('playwright');
const [arm, sid, nArg] = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync('/Users/wenshao/pr13973-rig/state/serve-merge.json', 'utf8'));
const port = { merge: 5973, main: 5974 }[arm];
const sql = (q) => spawnSync(`${process.env.HOME}/Install/mysql-8.4.7-macos15-arm64/bin/mysql`, ['--protocol=tcp', '-h127.0.0.1', '-P23973', '-uroot', '--batch', '--skip-column-names', st.db, '-e', q], { encoding: 'utf8' }).stdout.trim();
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(`http://localhost:${port}/e2e/fixtures/rig-13973.html?session=${sid}`);
await page.waitForTimeout(3000);
const res = [];
for (let i = 0; i < Number(nArg ?? 5); i++) {
  const m = `RIG_TEXT_lag${randomBytes(2).toString('hex')}`;
  const t0 = Date.now();
  if (arm === 'main') { await page.locator('textarea').last().fill(m); await page.locator('button[type=submit]').last().click(); }
  else { await page.locator('.cm-content').last().click(); await page.keyboard.type(m); await page.keyboard.press('Enter'); }
  // poll page readiness: progress row absent AND composer editable
  let tDb = null, tUi = null;
  const busySel = arm === 'main' ? 'textarea[disabled]' : '.cm-content[contenteditable="false"]';
  let sawBusy = false;
  while (Date.now() - t0 < 30000 && (tDb === null || tUi === null)) {
    if (tDb === null && sql(`SELECT status FROM managed_agent_turn WHERE input_json LIKE '%${m}%'`) === 'COMPLETED') {
      const c = Number(sql(`SELECT completed_at FROM managed_agent_turn WHERE input_json LIKE '%${m}%'`)); tDb = c - t0;
    }
    const busy = (await page.locator(busySel).count()) > 0 || (await page.getByText('This turn is running').count()) > 0;
    if (busy) sawBusy = true;
    if (sawBusy && !busy && tUi === null) tUi = Date.now() - t0;
    await page.waitForTimeout(100);
  }
  res.push({ dbCompletedMs: tDb, uiReadyMs: tUi, lagMs: tUi !== null && tDb !== null ? tUi - tDb : null });
  console.log(arm, JSON.stringify(res.at(-1)));
  await page.waitForTimeout(500);
}
const lags = res.map((r) => r.lagMs).filter((x) => x !== null).sort((a, b) => a - b);
console.log(arm, 'lag median', lags[Math.floor(lags.length / 2)], 'all', lags.join(','));
await b.close();
