// b3: streaming download of a 100 MiB output through the bundled browserArtifactSave path.
// Only the native save dialog is replaced (OPFS handle); fetch, stream, pipeTo and the writable are the browser's own.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, open, SHOTS, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog(process.env.LABEL ?? 'b3-download');
const s4 = JSON.parse(fs.readFileSync(`${L.R}/out/s4.json`, 'utf8'));
const big = s4.find((r) => r.case === (process.env.CASE ?? 'log100'));
const springLog = `${L.S}/logs/spring-${process.env.SPRING_TAG ?? `pr-${L.DB}`}.log`;
const readsLogged = () => fs.readFileSync(springLog, 'utf8').split('\n').filter((l) => l.includes('artifact_read') && l.includes(big.stdout.id)).map((l) => Number(/bytes=(\d+)/.exec(l)[1]));
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const { page, logs } = await open(browser, big.session, '&save=opfs');
await expandShell(page);
await openPanel(page);
const dialog = await waitPage(page);
const heap = () => page.evaluate(() => performance.memory.usedJSHeapSize);
const opfs = (name) => page.evaluate(async (n) => {
  const root = await navigator.storage.getDirectory();
  try { const h = await root.getFileHandle(n); return (await h.getFile()).size; } catch { return null; }
}, name);
const before = await rig(page);
const heap0 = await heap();
const readsBefore = readsLogged().length;
L.say('artifact', { bytes: big.stdout.bytes, sha256: big.stdout.sha256 });
// --- full download
const t0 = Date.now();
await dialog.getByRole('button', { name: 'Download' }).click();
const samples = [];
for (;;) {
  await page.waitForTimeout(250);
  samples.push(await heap());
  const label = await dialog.getByRole('button', { name: /Download/ }).innerText();
  if (label === 'Download' && Date.now() - t0 > 1000) break;
  if (Date.now() - t0 > 600000) { L.say('download', 'TIMEOUT'); break; }
}
const ms = Date.now() - t0;
const after = await rig(page);
const name = after.saves.at(-1)?.name;
const size = await opfs(name);
L.say('download finished', { ms, MBps: +(big.stdout.bytes / 1e6 / (ms / 1000)).toFixed(1), file: name, savedBytes: size, alert: await dialog.locator('[role=alert]').allInnerTexts() });
L.say('JS heap during download (MiB)', { before: +(heap0 / 1048576).toFixed(1), min: +(Math.min(...samples) / 1048576).toFixed(1), max: +(Math.max(...samples) / 1048576).toFixed(1), samples: samples.length });
L.say('allocations by page code during download', { blobsCreated: after.blobs - before.blobs, largestBlob: after.maxBlob, objectUrls: after.objectUrls - before.objectUrls });
const dl = after.requests.filter((q) => q.range === null);
L.say('download request', dl.map((q) => `${q.status} range=${q.range} if-match=${q.ifMatch ? 'yes' : 'no'} actor=${q.auth} url-has-credentials=${/token|auth|actor/i.test(q.url)}`));
// verify saved bytes (after the measurement window)
const digest = await page.evaluate(async (n) => {
  const root = await navigator.storage.getDirectory();
  const file = await (await root.getFileHandle(n)).getFile();
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, name);
L.say('saved file sha256', { digest, equalsMetadata: digest === big.stdout.sha256, equalsLocalRun: big.stdout.matchesLocalRun && digest === big.stdout.sha256 });
await page.screenshot({ path: `${SHOTS}/b3-01-after-download.png` });
// --- cancel: start again, close the panel while bytes are flowing
await page.evaluate(async (n) => { const root = await navigator.storage.getDirectory(); await root.removeEntry(n).catch(() => {}); }, name);
const n0 = (await rig(page)).requests.length;
const tc = Date.now();
await dialog.getByRole('button', { name: 'Download' }).click();
await page.waitForFunction((k) => window.__rig.requests.length > k && window.__rig.requests.at(-1).status === 200, n0, { timeout: 30000 });
await page.waitForTimeout(400);
await dialog.getByRole('button', { name: 'Close output' }).click();
await page.waitForTimeout(3000);
const c = await rig(page);
const last = c.requests.at(-1);
const partial = await opfs(name);
const serverReads = readsLogged().slice(readsBefore);
L.say('cancel on close', { panelOpen: await page.locator('[role=dialog]').count(), requestAborted: last.aborted === true, fileBytesAfterCancel: partial, serverLoggedBytes: serverReads, serverStoppedEarly: serverReads.at(-1) < big.stdout.bytes, msToCancel: Date.now() - tc });
// the page still works after a cancelled download
await openPanel(page);
await waitPage(page);
L.say('panel reopens after cancel', (await page.locator('[role=dialog] p.text-xs').first().innerText()));
L.say('browser errors', logs);
await browser.close();
