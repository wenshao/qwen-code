const pw = require('playwright'); const fs = require('fs');
const [BROWSER, DP, SID, OUT] = process.argv.slice(2);
(async () => {
  const b = await pw[BROWSER].launch(); const page = await (await b.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  await page.goto(`http://127.0.0.1:${DP}/session/${SID}?token=tok-head`);
  const cards = page.locator('[data-testid="mcp-app"]'); await cards.first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(8000);
  const n = await cards.count(); const out = [];
  for (let i = 0; i < n; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
    const f = await (await cards.nth(i).locator('iframe').elementHandle()).contentFrame(); const inner = f?.childFrames()[0];
    if (!inner) { out.push({ i, inner: false }); continue; }
    await inner.waitForFunction(() => !!window.__probes, null, { timeout: 20000 }).catch(() => {});
    // active cross-App probe from this App, after all siblings exist
    const active = await inner.evaluate(() => { const r = []; let dd; try { document.domain = 'localhost'; dd = 'set:' + document.domain; } catch (e) { dd = e.name; }
      for (let k = 0; k < top.frames.length; k++) { const fr = top.frames[k]; if (fr === parent) continue; try { r.push(k + ':' + fr.document.title); } catch (e) { r.push(k + ':' + e.name); } try { r.push(k + '.inner:' + fr.frames[0].document.title); } catch (e) { r.push(k + '.inner:' + e.name); } }
      return { origin: self.origin, documentDomain: dd, siblings: r.join(' ') }; }).catch(e => ({ error: String(e) }));
    out.push({ i, ...active });
  }
  const res = { browser: BROWSER, version: b.version(), cards: n, out };
  console.log(JSON.stringify(res, null, 1)); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); await b.close();
})().catch(e => { console.log('FATAL', String(e).slice(0, 800)); process.exit(1); });
