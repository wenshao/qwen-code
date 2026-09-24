const pw = require(process.env.PW_PATH); const [ENGINE, ARM, BASE, RUN, OUT] = process.argv.slice(2);
const fs=require('fs'); fs.mkdirSync(OUT,{recursive:true});
(async () => {
  const b = await pw.chromium.launch({ args: ['--no-proxy-server'] }); const ctx = await b.newContext();
  const res = {};
  const pages = [];
  for (let n = 1; n <= 6; n++) {
    const p = await ctx.newPage(); await p.goto(`${BASE}/?token=tok-${ARM}`);
    await p.locator('[data-web-shell-composer-editor] .cm-content').waitFor({ timeout: 30000 }); pages.push(p);
    if (n === 1) { await p.locator('[data-web-shell-composer-editor] .cm-content').click(); await p.keyboard.type('hello'); await p.locator('[data-web-shell-composer-submit]').click(); await p.getByText('[done:plain]').first().waitFor({timeout:60000}); const u=new URL(p.url()); u.searchParams.set('token',`tok-${ARM}`); res.url=u.toString(); }
    else { await p.goto(res.url); }
    await new Promise(r => setTimeout(r, 2500));
    res['tabs' + n] = await pages[0].evaluate(async (tok) => { const t = Date.now(); const c = new AbortController(); setTimeout(() => c.abort(), 8000); try { const r = await fetch('/capabilities', { headers: { authorization: 'Bearer ' + tok }, signal: c.signal }); return r.status + ' in ' + (Date.now() - t) + 'ms'; } catch (e) { return 'stalled >8s (' + e.name + ')'; } }, `tok-${ARM}`);
    console.log('tabs', n, res['tabs' + n]);
  }
  fs.writeFileSync(OUT + '/result.json', JSON.stringify(res, null, 1)); await b.close();
})().catch(e => { console.log('FATAL', e); process.exit(1); });
