// Walk a real session backwards in the real Web Shell, one real mouse click per
// page, from a different reader position each time. Prints one JSON line per
// trial plus the wire log; writes panel screenshots to <outDir>.
// usage: node scenario-walk.cjs <browser> <sessionId> <outDir> <where1,where2,...> [base]
const fs = require('node:fs');
const L = require('./lib.cjs');

(async () => {
  const [browserName, sessionId, outDir, wheres, base = 'http://127.0.0.1:17434'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const { browser, page, wire } = await L.launch(browserName);
  await L.openTrajectory(page, base, sessionId);
  const served = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /index-/.test(s)));
  const initial = await L.gridState(page);
  const hasButton = (await page.getByTestId('trajectory-load-older').count()) > 0;
  console.log(JSON.stringify({ step: 'initial', browserName, served, hasButton, ...initial }));
  await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/step0-initial.png` });
  let step = 1;
  for (const raw of wheres.split(',')) {
    const where = /^[0-9.]+$/.test(raw) ? Number(raw) : raw;
    if ((await page.getByTestId('trajectory-load-older').count()) === 0) {
      console.log(JSON.stringify({ step, note: 'no load-older control left' }));
      break;
    }
    const r = await L.anchorTrial(page, where, `click ${step}`);
    console.log(JSON.stringify({ step, ...r }));
    await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/step${step}-${raw}.png` });
    step += 1;
  }
  const final = await L.gridState(page);
  console.log(JSON.stringify({ step: 'final', ...final }));
  console.log(JSON.stringify({ wire: wire.map((w) => ({ search: w.search.replace(/cursor=[^&]+/, 'cursor=<…>'), status: w.status, events: w.events, hasMore: w.hasMore })) }));
  fs.writeFileSync(`${outDir}/wire.json`, JSON.stringify(wire, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
