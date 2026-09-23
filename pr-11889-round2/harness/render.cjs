const { chromium } = require('/root/verify/pr11889-r2/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const X = '/root/verify/pr11889-r2/node_modules/@xterm/xterm';
const [,, src, out, title, cols] = process.argv;
(async () => {
  const text = fs.readFileSync(src, 'utf8').replace(/\n/g, '\r\n');
  const rows = text.split('\r\n').length + 1;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await p.setContent(`<html><head><style>${fs.readFileSync(X + '/css/xterm.css', 'utf8')}
  body{margin:0;background:#0d1117;font-family:sans-serif}#w{display:inline-block;margin:16px;border-radius:8px;overflow:hidden;box-shadow:0 4px 18px #0008;border:1px solid #30363d}
  #t{background:#161b22;color:#c9d1d9;padding:7px 12px;font-size:13px}#t b{color:#58a6ff}#term{padding:8px;background:#0d1117}</style></head>
  <body><div id="w"><div id="t"><b>●</b> ${title}</div><div id="term"></div></div></body></html>`);
  await p.addScriptTag({ path: X + '/lib/xterm.js' });
  await p.evaluate(({ text, rows, cols }) => new Promise((r) => {
    const t = new Terminal({ cols, rows, fontSize: 13, fontFamily: 'DejaVu Sans Mono, monospace', theme: { background: '#0d1117', foreground: '#c9d1d9' }, convertEol: false, scrollback: 0 });
    t.open(document.getElementById('term')); t.write(text, r);
  }), { text, rows, cols: Number(cols) });
  await p.waitForTimeout(300);
  await (await p.$('#w')).screenshot({ path: out });
  await b.close();
})();
