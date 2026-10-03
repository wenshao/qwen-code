// Timeline of the detail panel after an activation toggle: painted states with timestamps + detail/summary requests.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDaemon } from './daemon.mjs';
import { chromium, EXE, openShell, openExtensions, card } from './browser-common.mjs';
const [label, armDir, home, ws, port, outDir] = process.argv.slice(2);
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `timeline-${label}.daemon.log`) });
await new Promise((r) => setTimeout(r, 15_000));
const browser = await chromium.launch({ executablePath: EXE });
const reps = [];
try {
  const { page } = await openShell(browser, d, { scale: 1, width: 1280, height: 860 });
  await openExtensions(page);
  await card(page, 'Rich Qwen Extension').click();
  for (let i = 0; i < 4; i++) {
    const target = i % 2 === 0 ? 'Disabled' : 'Enabled';
    await page.getByRole('tab', { name: /^Skills/ }).waitFor({ timeout: 30_000 });
    await page.getByRole('tab', { name: /^Skills/ }).click();
    const reqs = [];
    const onReq = (r) => { const p = new URL(r.url()).pathname; if (/\/workspace\/extensions(\/summary|\/[^/]+\/details|$)/.test(p) || /activation|refresh/.test(p)) reqs.push({ wall: Date.now(), m: r.method(), p }); };
    page.on('request', onReq);
    await page.evaluate(() => {
      window.__f = []; window.__stop = false;
      const loop = () => { const ch = new MessageChannel(); ch.port1.onmessage = () => {
        const sel = [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((e) => e.textContent.trim()).filter((s) => !/^(Tasks|Channels)$/.test(s)).join('|');
        const loading = [...document.querySelectorAll('[role=status]')].some((e) => /Loading/.test(e.textContent));
        window.__f.push({ wall: Date.now(), k: loading ? 'LOADING' : (sel || '(none)') }); };
        ch.port2.postMessage(0); if (!window.__stop) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await page.getByRole('combobox').first().click();
    const t0 = Date.now();
    await page.getByRole('option', { name: target, exact: true }).click();
    await page.waitForTimeout(6000);
    const frames = await page.evaluate(() => { window.__stop = true; return window.__f; });
    page.off('request', onReq);
    const seq = []; for (const f of frames) { if (!seq.length || seq[seq.length - 1].k !== f.k) seq.push({ k: f.k, at: f.wall - t0 }); }
    const loadingMs = seq.reduce((acc, s, j) => s.k === 'LOADING' ? acc + ((seq[j + 1]?.at ?? 6000) - s.at) : acc, 0);
    reps.push({ toggledTo: target, painted: seq.map((s) => `${s.k}@${s.at}ms`), totalLoadingMs: loadingMs, requests: reqs.map((r) => `${r.m} ${r.p}@${r.wall - t0}ms`) });
  }
} finally { await browser.close(); await d.stop(); }
writeFileSync(join(outDir, `timeline-${label}.json`), JSON.stringify(reps, null, 2));
for (const r of reps) console.log(JSON.stringify(r));
