// Fault and edge scenarios against the real daemon.
// usage: node scenario-faults.cjs <browser> <case> <sessionId> <outDir>
//   retry500   – first cursor read answered 500 (page.route), retry goes to the real daemon
//   refresh    – page back twice from mid-table, then press the header refresh
//   keyboard   – Tab to the control and press Enter twice; where is focus?
//   live       – page back once, append turns to the session, page again, refresh
//   conflict   – page back once, rotate the JSONL (new inode), page again, retry, refresh
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const L = require('./lib.cjs');

const JSONL_DIR = '/root/verify/pr12434-harness/run-a/home/projects/-root-verify-pr12434-harness-run-a-ws/chats';

(async () => {
  const [browserName, which, sessionId, outDir, base = 'http://127.0.0.1:17434'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const { browser, page, wire } = await L.launch(browserName);
  const log = (o) => console.log(JSON.stringify(o));
  const clean = (w) => w.map((x) => ({ search: x.search.replace(/cursor=[^&]+/, 'cursor=<' + x.search.slice(x.search.indexOf('cursor=') + 7, x.search.indexOf('cursor=') + 15) + '…>'), status: x.status, events: x.events, hasMore: x.hasMore, code: x.code }));

  if (which === 'retry500') {
    let failed = 0;
    await page.route('**/transcript?*', async (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('cursor') && failed === 0) {
        failed += 1;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'injected failure' }) });
        return;
      }
      await route.continue();
    });
    await L.openTrajectory(page, base, sessionId);
    await L.scrollGridTo(page, 0.5);
    const s0 = await L.gridState(page);
    const anchor = await L.pickAnchor(page);
    await page.getByTestId('trajectory-load-older').click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const s1 = await L.gridState(page);
    const y1 = (await L.visibleRows(page)).find((r) => r.text === anchor.text)?.y ?? null;
    await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/retry-1-failed.png` });
    log({ phase: 'after failed read', rowsBefore: s0.rowcount, rows: s1.rowcount, scrollBefore: s0.scrollTop, scroll: s1.scrollTop, alert: s1.alert, bar: s1.barText, anchorMovedOnScreen: y1 === null ? null : y1 - anchor.y, gridTopShift: s1.gridTop - s0.gridTop });
    // press the retry inside the alert, not the bar
    await page.getByRole('alert').getByRole('button').click();
    await L.waitPageLanded(page, s1.rowcount);
    await page.waitForTimeout(300);
    const s2 = await L.gridState(page);
    const y2 = (await L.visibleRows(page)).find((r) => r.text === anchor.text)?.y ?? null;
    await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/retry-2-recovered.png` });
    log({ phase: 'after retry', rows: s2.rowcount, scroll: s2.scrollTop, alert: s2.alert, bar: s2.barText, anchorMovedVsBeforeClick: y2 === null ? null : y2 - anchor.y, gridTopShiftVsBeforeClick: s2.gridTop - s0.gridTop });
    const cursors = wire.filter((w) => w.search.includes('cursor=')).map((w) => w.search);
    log({ wire: clean(wire), sameCursorRetried: cursors.length === 2 && cursors[0] === cursors[1], newestReads: wire.filter((w) => !w.search.includes('cursor=')).length });
  }

  if (which === 'refresh') {
    await L.openTrajectory(page, base, sessionId);
    await L.anchorTrial(page, 'top', 'p2');
    await L.anchorTrial(page, 'top', 'p3');
    const pos = process.env.POS ? (Number.isNaN(Number(process.env.POS)) ? process.env.POS : Number(process.env.POS)) : 0.3;
    await L.scrollGridTo(page, pos);
    const s0 = await L.gridState(page);
    const vis0 = (await L.visibleRows(page)).slice(0, 2).map((r) => r.text.slice(0, 40));
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid="trajectory-rows"]')?.getAttribute('aria-rowcount')) < n, s0.rowcount, { timeout: 20000 });
    await page.waitForTimeout(500);
    const s1 = await L.gridState(page);
    const rows = await L.visibleRows(page);
    await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/refresh-after-walk.png` });
    log({ before: { rows: s0.rowcount, scrollTop: s0.scrollTop, firstVisible: vis0, bar: s0.barText }, after: { rows: s1.rowcount, scrollTop: s1.scrollTop, maxScroll: s1.scrollHeight - s1.clientHeight, atTail: Math.abs(s1.scrollTop - (s1.scrollHeight - s1.clientHeight)) < 2, firstVisible: rows.slice(0, 2).map((r) => r.text.slice(0, 40)), lastVisible: rows.at(-1)?.text.slice(0, 40), bar: s1.barText } });
    log({ wire: clean(wire) });
  }

  if (which === 'keyboard') {
    await L.openTrajectory(page, base, sessionId);
    await page.getByTestId('trajectory-load-older').focus();
    const focus = () => page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'body' : `${a.tagName.toLowerCase()}${a.dataset.testid ? '[' + a.dataset.testid + ']' : ''}:${(a.textContent || '').slice(0, 30)}`; });
    const f0 = await focus();
    const r0 = (await L.gridState(page)).rowcount;
    await page.keyboard.press('Enter');
    await L.waitPageLanded(page, r0);
    const f1 = await focus();
    const r1 = (await L.gridState(page)).rowcount;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    const r2 = (await L.gridState(page)).rowcount;
    const f2 = await focus();
    log({ focusBefore: f0, focusAfterFirstPage: f1, rows: [r0, r1, r2], secondEnterLoadedAnotherPage: r2 > r1, focusAfterSecondEnter: f2 });
  }

  if (which === 'live') {
    await L.openTrajectory(page, base, sessionId);
    const t1 = await L.anchorTrial(page, 'top', 'before append');
    log({ phase: 'paged once', moved: t1.moved, rows: t1.rowsAfter });
    const out = execSync(`START=1001 node /root/verify/pr12434-harness/seed.mjs ${base} ${L.TOKEN} /root/verify/pr12434-harness/run-a/ws 6 ${sessionId}`, { encoding: 'utf8' });
    log({ appended: out.trim().split('\n').at(-1) });
    const t2 = await L.anchorTrial(page, 'top', 'after append');
    log({ phase: 'paged after append', moved: t2.moved, rowsAdded: t2.rowsAdded, alert: t2.alert, bar: t2.barAfter });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForTimeout(2500);
    const s = await L.gridState(page);
    const hasNew = await page.evaluate(() => document.querySelector('[data-testid="trajectory-panel"]').textContent.includes('Prompt #1006'));
    log({ phase: 'after refresh', rows: s.rowcount, totals: s.totals, sawAppendedTurnInDom: hasNew });
    log({ wire: clean(wire) });
  }

  if (which === 'conflict') {
    await L.openTrajectory(page, base, sessionId);
    const t1 = await L.anchorTrial(page, 'top', 'before rotate');
    log({ phase: 'paged once', moved: t1.moved, rows: t1.rowsAfter });
    const f = `${JSONL_DIR}/${sessionId}.jsonl`;
    execSync(`cp -p ${f} ${f}.rot && mv ${f}.rot ${f}`); // same bytes, new inode
    const s0 = await L.gridState(page);
    await page.getByTestId('trajectory-load-older').click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
    const a1 = await L.gridState(page);
    await page.getByTestId('trajectory-panel').screenshot({ path: `${outDir}/conflict-1.png` });
    await page.getByRole('alert').getByRole('button').click();
    await page.waitForTimeout(2000);
    const a2 = await L.gridState(page);
    log({ phase: 'after rotate', firstAlert: a1.alert, rowsKept: a1.rowcount === s0.rowcount, retryAlert: a2.alert, rowsAfterRetry: a2.rowcount });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForTimeout(2500);
    const a3 = await L.gridState(page);
    log({ phase: 'after header refresh', alert: a3.alert, rows: a3.rowcount, bar: a3.barText });
    const t3 = await L.anchorTrial(page, 'top', 'after refresh');
    log({ phase: 'paging again after refresh', moved: t3.moved, rowsAdded: t3.rowsAdded, alert: t3.alert });
    log({ wire: clean(wire) });
  }

  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
