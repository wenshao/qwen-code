// Mechanism check on the real @xterm/xterm 6.0.0 (ESM, real Chromium): if one CSI
// handler throws — as the built Web Shell's DECRQM handler does — what happens to
// the write callback of that chunk and to every later write?
const { chromium } = require('/root/verify/pr11643-head/node_modules/playwright-core');
const http = require('node:http'); const fs = require('node:fs');
const dir = '/root/verify/pr11643-head/node_modules/@xterm/xterm';
const srv = http.createServer((req, res) => {
  if (req.url === '/xterm.mjs') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(`${dir}/lib/xterm.mjs`)); }
  res.setHeader('content-type', 'text/html'); res.end('<div id=t style="width:800px;height:300px"></div>');
}).listen(0, async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`);
  const res = await p.evaluate(async () => {
    const { Terminal } = await import('/xterm.mjs');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const run = async (throwing) => {
      const term = new Terminal({ allowProposedApi: true }); const host = document.createElement('div'); document.getElementById('t').replaceChildren(host); term.open(host);
      if (throwing) term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, () => { throw new ReferenceError('n is not defined (simulated)'); });
      const replies = []; term.onData((x) => replies.push(x));
      const cbs = {};
      term.write('line1-before\r\n\x1b[c', () => (cbs.a = true));
      term.write('\x1b[?2026$p', () => (cbs.b_decrqm = true));
      await sleep(300);
      term.write('line2-after\r\n\x1b[c', () => (cbs.c_later = true));
      await sleep(300);
      term.write('line3-much-later\r\n', () => (cbs.d_later = true));
      await sleep(500);
      const lines = []; for (let i = 0; i < 4; i++) lines.push(term.buffer.active.getLine(i)?.translateToString(true));
      term.dispose();
      return { throwing, callbacks: cbs, replies: replies.map((r) => JSON.stringify(r)), lines };
    };
    return [await run(false), await run(true)];
  });
  console.log(JSON.stringify({ res, errors }, null, 1)); await b.close(); srv.close();
});
