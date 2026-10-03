// Paint-level probe: after viewing extension A, return to the list and open B; did any painted frame show A's tabs under B's header?
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDaemon } from './daemon.mjs';
import { chromium, EXE, openShell, openExtensions, card, backToList } from './browser-common.mjs';
const [label, armDir, home, ws, port, outDir, repsArg] = process.argv.slice(2);
const d = await startDaemon({ arm: armDir, home, workspace: ws, port: Number(port), log: join(outDir, `frame-${label}.daemon.log`) });
await new Promise((r) => setTimeout(r, 15_000));
const browser = await chromium.launch({ executablePath: EXE });
const reps = Number(repsArg ?? 5); const runs = [];
try {
  const { page } = await openShell(browser, d, { scale: 1, width: 1280, height: 860 });
  await openExtensions(page);
  for (let i = 0; i < reps; i++) {
    await card(page, 'Rich Qwen Extension').click();
    await page.getByRole('tab', { name: 'Commands 3' }).waitFor();
    await backToList(page);
    await page.evaluate(() => {
      window.__f = [];
      const read = (phase) => {
        const h1 = document.querySelector('h1')?.textContent?.trim() ?? '';
        const tabs = [...document.querySelectorAll('[role=tab]')].map((e) => e.textContent.trim()).filter((s) => /^(Commands|Skills)/.test(s)).join(',');
        const loading = [...document.querySelectorAll('[role=status]')].some((e) => /Loading/.test(e.textContent));
        window.__f.push({ phase, h1, tabs, loading });
      };
      const loop = () => { read('raf'); const ch = new MessageChannel(); ch.port1.onmessage = () => read('post'); ch.port2.postMessage(0); if (window.__f.length < 600) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await card(page, 'Bulk 0').click();
    await page.getByRole('tab', { name: 'Commands 10' }).waitFor();
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => window.__f);
    const seq = []; for (const f of frames.filter((x) => x.phase === 'post')) { const k = f.h1.startsWith('Bulk 0') ? (f.loading ? 'B:Loading' : `B:${f.tabs}`) : 'list'; if (seq[seq.length - 1] !== k) seq.push(k); }
    const wrong = frames.filter((f) => f.phase === 'post' && f.h1.startsWith('Bulk 0') && f.tabs.includes('Commands 3')).length;
    runs.push({ seq, wrongPaintedFrames: wrong });
    await backToList(page);
  }
} finally { await browser.close(); await d.stop(); }
writeFileSync(join(outDir, `frame-${label}.json`), JSON.stringify(runs, null, 2));
console.log(label, JSON.stringify(runs));
