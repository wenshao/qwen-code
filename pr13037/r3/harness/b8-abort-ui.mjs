// F2 in the browser: the grant is revoked while the WebShell streams a 99 MiB download.
// How long does the panel keep showing "Downloading…" after the last byte arrives?
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, open, SHOTS, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog(process.env.LABEL ?? 'b8-abort-ui');
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === 'log100');
const ws = L.one(`SELECT workspace_id FROM managed_agent_session WHERE session_id='${big.session}'`);
const browser = await chromium.launch();
const { page, logs } = await open(browser, big.session, '&save=opfs');
await expandShell(page);
await openPanel(page);
const dialog = await waitPage(page);
const n0 = (await rig(page)).requests.length;
await dialog.getByRole('button', { name: 'Download' }).click();
await page.waitForFunction((k) => window.__rig.requests.length > k && window.__rig.requests.at(-1).status === 200, n0, { timeout: 30000 });
const t0 = Date.now();
L.sql(`UPDATE managed_workspace_access SET can_read=FALSE WHERE workspace_id='${ws}' AND actor_id='alice'`);
L.say('grant revoked while the download streams', { msAfterFirstResponse: 0 });
let label = 'Downloading…';
for (;;) {
  label = await dialog.getByRole('button', { name: /Download/ }).innerText().catch(() => '(button gone)');
  if (!/Downloading/.test(label) || Date.now() - t0 > 120000) break;
  await page.waitForTimeout(100);
}
const ms = Date.now() - t0;
const alert = await dialog.locator('[role=alert]').allInnerTexts();
L.grant(ws, 'alice');
const name = (await rig(page)).saves.at(-1)?.name;
const saved = await page.evaluate(async (n) => { try { const r = await navigator.storage.getDirectory(); return (await (await r.getFileHandle(n)).getFile()).size; } catch { return null; } }, name);
L.say('panel after the revocation', { msUntilDownloadingEnded: ms, buttonLabel: label, alert, bytesInTheSaveTarget: saved, ofTotal: big.stdout.bytes });
await page.screenshot({ path: `${SHOTS}/${process.env.LABEL ?? 'b8-abort-ui'}.png` });
L.say('browser errors', logs);
await browser.close();
