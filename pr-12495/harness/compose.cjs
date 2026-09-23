const { chromium } = require('playwright-core');
const fs = require('fs');
const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const img = (f) => 'data:image/png;base64,' + fs.readFileSync('shots/' + f).toString('base64');
const OUT = { A:'runs, no prompt', B:'', C:'', D:'', E:'', F:'' };
const R = JSON.parse(fs.readFileSync('e2e-results.json','utf8'));
const verdict = (arm,id) => { const r = R.find(x=>x.arm===arm&&x.id===id); return r.outcome==='PROMPTED' ? 'confirmation prompt' : (r.toolResult.startsWith('Plan mode blocked') ? 'blocked by plan mode' : 'ran without prompt → ' + (r.toolResult.match(/Output: (.*)/)||[])[1]); };
function page(title, rows) {
  return `<html><head><style>
  body{margin:0;background:#0d1117;color:#e6edf3;font:14px -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
  .wrap{padding:18px;display:inline-block}
  h1{font-size:17px;margin:0 0 12px}
  .row{margin-bottom:16px}
  .cap{font:13px ui-monospace,Menlo,monospace;color:#9da7b3;margin:4px 0 6px}
  .cap b{color:#e6edf3}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
  .pane{border:1px solid #30363d;border-radius:6px;overflow:hidden;background:#0d1117}
  .lbl{padding:4px 8px;font-weight:600;font-size:13px;border-bottom:1px solid #30363d}
  .base .lbl{background:#3d1d1d;color:#ffb3ad}.head .lbl{background:#12301c;color:#9be9a8}
  .crop{height:${'H'}px;overflow:hidden}.crop img{display:block;margin-top:-218px;width:940px}
  </style></head><body><div class="wrap"><h1>${esc(title)}</h1>
  ${rows.map(r=>`<div class="row"><div class="cap">case ${r.id} · --approval-mode <b>${r.mode}</b> · <b>${esc(r.cmd)}</b></div><div class="grid">
    <div class="pane base"><div class="lbl">base 99bf4ce — ${esc(verdict('base',r.id))}</div><div class="crop" style="height:${r.h}px"><img src="${img('base-'+r.id+'.png')}"></div></div>
    <div class="pane head"><div class="lbl">PR head 113636f — ${esc(verdict('head',r.id))}</div><div class="crop" style="height:${r.h}px"><img src="${img('head-'+r.id+'.png')}"></div></div>
  </div></div>`).join('')}</div></body></html>`;
}
(async () => {
  const b = await chromium.launch({executablePath: require('fs').readdirSync(process.env.HOME+'/.cache/ms-playwright/chromium-1228').includes('chrome-linux64') ? process.env.HOME+'/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' : process.env.HOME+'/.cache/ms-playwright/chromium-1228/chrome-linux/chrome'});
  const figs = [
    ['fig1-default-mode.png','Default approval mode: the long quiet spellings now run like -n (real bundle, scripted model)', ['A','B','C'], 290],
    ['fig2-plan-mode.png','Plan mode: read-only --quiet preview is allowed; a --quiet write script is now blocked outright', ['E','F'], 320],
    ['fig3-write-still-prompts.png','Default mode: a --quiet write script still requires confirmation on the PR head', ['D'], 290],
  ];
  for (const [out,title,ids,h] of figs) {
    const p = await b.newPage({ viewport:{width:2000,height:3000}, deviceScaleFactor:2 });
    const rows = ids.map(id => ({...R.find(x=>x.id===id), h}));
    await p.setContent(page(title, rows));
    const el = await p.$('.wrap'); const box = await el.boundingBox();
    await p.setViewportSize({width:Math.ceil(box.width)+20,height:Math.ceil(box.height)+20});
    await el.screenshot({ path: 'img/' + out });
    await p.close(); console.log('wrote', out, box.width, box.height);
  }
  await b.close();
})();
