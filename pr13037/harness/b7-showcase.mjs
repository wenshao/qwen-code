// b7: a clean set of Sessions (actor "dana") for the figures: live card, outputs panel, large-output paging,
// streaming download, result states, coloured output.
import fs from 'node:fs';
import * as L from './lib.mjs';
import { chromium, SHOTS, url, transcript, expandShell, openPanel, waitPage, rig } from './pw.mjs';
L.openLog(process.env.B7_LOG ?? 'b7-showcase');
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const VIEW = { width: 1180, height: 760 };
const MAIN = { x: 236, y: 0, width: VIEW.width - 236, height: VIEW.height };
const setMode = (m) => fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify(m));
async function page(session) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const p = await context.newPage();
  await p.goto(url(session, '&save=opfs&actor=dana'), { waitUntil: 'load' });
  return p;
}
const shot = (p, name, clip = MAIN) => p.screenshot({ path: `${SHOTS}/${name}.png`, clip });
const dialogShot = (p, name) => p.locator('[role=dialog]').screenshot({ path: `${SHOTS}/${name}.png` });
const make = async (n, name, prompt, mode = { shell: true, capture: 2147483648 }) => {
  L.register(`ws-${name}`, `st-s${n}`, { actors: ['dana'] });
  setMode(mode);
  return L.createShellSession(`ws-${name}`, prompt, { actor: 'dana' });
};
const outFile = `${L.R}/out/b7-showcase.json`;
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};

// --- A. failed build, watched live
if (!process.env.SKIP_AB)
{
  const s = await make('59', 'release', 'Run the release build and tell me whether it passed. [O3_CMD:build]');
  out.build = s;
  const p = await page(s);
  await p.getByText('Shell', { exact: true }).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(300);
  L.say('A while the model is still answering', await transcript(p));
  await shot(p, 'f-a1-live-running');
  await L.waitTurn(s, {});
  await p.waitForTimeout(3500);
  await expandShell(p);
  const live = await transcript(p);
  await shot(p, 'f-a2-live-card');
  await p.reload({ waitUntil: 'load' });
  await expandShell(p);
  const restored = await transcript(p);
  L.say('A live == restored', { equal: live === restored, transcript: restored.slice(0, 500) });
  await shot(p, 'f-a3-restored-card');
  await openPanel(p);
  let d = await waitPage(p);
  await dialogShot(p, 'f-a4-panel-stdout');
  await d.getByRole('button', { name: /^stderr/ }).click();
  await p.waitForTimeout(400);
  await waitPage(p);
  L.say('A stderr', (await d.locator('pre[data-managed-output-bytes]').innerText()).replace(/\n/g, ' | '));
  await dialogShot(p, 'f-a5-panel-stderr');
  await p.context().close();
}
// --- B. not executed
if (!process.env.SKIP_AB)
{
  const s = await make('60', 'staging', 'Wait a few seconds, then deploy to staging. [O3_CMD:deploy]');
  out.deploy = s;
  await L.waitTurn(s, {});
  await L.waitProjection(s);
  const p = await page(s);
  await expandShell(p);
  L.say('B card', (await p.locator('[data-managed-tool-result]').first().innerText()).replace(/\n+/g, ' | '));
  await shot(p, 'f-b1-not-executed', { ...MAIN, height: 560 });
  await p.context().close();
}
// --- C. blocked capture (capture budget 1 MiB, 3 MiB of output)
if (!process.env.ONLY_AB) {
  const s = await make('16', 'module-dump', 'Dump the module table. [O3_CMD:dump]', { shell: true, capture: 1048576 });
  out.dump = s;
  for (let i = 0; i < 100 && !fs.readFileSync(`${L.R}/run/tap-sessions.json`, 'utf8').includes(s); i++) await L.sleep(100);
  setMode({ shell: true, capture: 2147483648 });
  await L.waitProjection(s, { timeoutMs: 60000 });
  const p = await page(s);
  await expandShell(p);
  L.say('C card', (await p.locator('[data-managed-tool-result]').first().innerText()).replace(/\n+/g, ' | '));
  await shot(p, 'f-c1-capture-blocked', { ...MAIN, height: 560 });
  await p.context().close();
}
// --- D. coloured output
if (!process.env.ONLY_C && !process.env.ONLY_AB) {
  const s = await make('14', 'tests', 'Run the unit tests. [O3_CMD:tests]');
  out.tests = s;
  await L.waitTurn(s, {});
  await L.waitProjection(s);
  const p = await page(s);
  await expandShell(p);
  await shot(p, 'f-d1-ansi-card', { ...MAIN, height: 640 });
  await openPanel(p);
  await waitPage(p);
  await dialogShot(p, 'f-d2-ansi-panel');
  await p.context().close();
}
// --- E. 12 MiB log: paging and streaming download
if (!process.env.ONLY_C && !process.env.ONLY_AB) {
  const s = await make('15', 'ci-log', 'Run the full build with verbose logging. [O3_CMD:log]');
  out.log = s;
  await L.waitTurn(s, {});
  await L.waitProjection(s);
  const a = (await L.api('GET', `/v1/agents/sessions/${s}/artifacts`, undefined, { actor: 'dana' })).json.data.map((e) => e.artifact).find((x) => x.stream_role === 'stdout');
  const p = await page(s);
  await expandShell(p);
  await openPanel(p);
  const d = await waitPage(p);
  for (let i = 0; i < 5; i++) { await d.getByRole('button', { name: 'Next page' }).click(); await p.waitForTimeout(200); await waitPage(p); }
  await d.locator('pre[data-managed-output-bytes]').scrollIntoViewIfNeeded();
  await d.getByRole('button', { name: 'Download' }).scrollIntoViewIfNeeded();
  await dialogShot(p, 'f-e1-paging');
  const before = await rig(p);
  const t0 = Date.now();
  await d.getByRole('button', { name: 'Download' }).click();
  await p.waitForFunction(() => /Downloading/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {});
  await dialogShot(p, 'f-e2-downloading');
  await p.waitForFunction(() => !/Downloading/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), null, { timeout: 120000 });
  const after = await rig(p);
  const name = after.saves.at(-1)?.name;
  const saved = await p.evaluate(async (n) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(n)).getFile();
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return { size: file.size, sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }, name);
  L.say('E download', { ms: Date.now() - t0, bytes: a.byte_length, savedBytes: saved.size, shaEqualsMetadata: saved.sha256 === a.sha256, blobs: after.blobs - before.blobs, objectUrls: after.objectUrls - before.objectUrls });
  await p.context().close();
}
fs.writeFileSync(`${L.R}/out/b7-showcase.json`, JSON.stringify(out, null, 2));
await browser.close();
