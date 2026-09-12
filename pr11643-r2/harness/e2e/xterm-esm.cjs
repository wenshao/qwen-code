// Does the ESM build (what Web Shell bundles) answer DECRQM, and does write()'s
// callback still fire when a chunk contains it? Served over http so the module loads.
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
    const one = async (label, data) => {
      const term = new Terminal({ allowProposedApi: true }); const host = document.createElement('div'); document.getElementById('t').replaceChildren(host); term.open(host);
      const got = []; term.onData((x) => got.push(x));
      let cb = false; term.write(data, () => { cb = true; });
      await new Promise((r) => setTimeout(r, 600));
      const after = []; const d2 = term.onData((x) => after.push(x));
      let cb2 = false; term.write('\x1b[c', () => { cb2 = true; }); await new Promise((r) => setTimeout(r, 400));
      const line0 = term.buffer.active.getLine(0)?.translateToString(true);
      term.dispose();
      return { label, replies: got.map((g) => JSON.stringify(g)), writeCallbackFired: cb, laterWriteCallbackFired: cb2, laterDA1Replies: after.length, line0 };
    };
    return [
      await one('DA1+OSC11 only', 'A\x1b[c\x1b]11;?\x07B'),
      await one('DECRQM alone', 'A\x1b[?2026$pB'),
      await one('recorder batch (DA1,DA2,CPR,DECRQM,OSC11,OSC12,OSC4,XTVERSION)', 'A\x1b[c\x1b[>c\x1b[6n\x1b[?2026$p\x1b]11;?\x07\x1b]12;?\x07\x1b]4;1;?\x07\x1b[>0qB'),
    ];
  });
  console.log(JSON.stringify({ res, errors }, null, 1));
  await b.close(); srv.close();
});
