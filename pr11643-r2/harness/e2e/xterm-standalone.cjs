// Ground truth: which queries does the real @xterm/xterm answer in real Chromium?
const { chromium } = require('/root/verify/pr11643-head/node_modules/playwright-core');
const fs = require('node:fs');
const dir = process.argv[2];
const js = fs.readFileSync(require.resolve(`${dir}/lib/xterm.js`), 'utf8');
const css = fs.readFileSync(`${dir}/css/xterm.css`, 'utf8');
const version = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8')).version;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent(`<style>${css}</style><div id=t style="width:800px;height:400px"></div><script>${js}</script>`);
  const res = await p.evaluate(async () => {
    const Q = { DA1: '\x1b[c', DA2: '\x1b[>c', CPR: '\x1b[6n', DECRQM: '\x1b[?2026$p', OSC11: '\x1b]11;?\x07', OSC12: '\x1b]12;?\x07', OSC4: '\x1b]4;1;?\x07', XTVERSION: '\x1b[>0q' };
    const run = async (opts, panelLike) => {
      const T = window.Terminal.Terminal ?? window.Terminal;
      const term = new T(opts); const host = document.createElement('div'); host.style.height = '300px'; document.getElementById('t').replaceChildren(host);
      if (panelLike) term.parser.registerCsiHandler({ final: 'c' }, () => false);
      term.open(host);
      const out = {};
      for (const [k, q] of Object.entries(Q)) {
        const got = []; const d = term.onData((x) => got.push(x));
        await new Promise((r) => term.write(q, r)); await new Promise((r) => setTimeout(r, 150));
        d.dispose(); out[k] = got.map((g) => JSON.stringify(g)).join(' ') || null;
      }
      term.dispose(); return out;
    };
    return { defaults: await run({}), terminalPanelOptions: await run({ allowProposedApi: true, cursorBlink: true, theme: { background: '#0a0a0a', foreground: '#e0e6f0', cursor: '#e0e6f0' } }, true) };
  });
  console.log(JSON.stringify({ version, ...res }, null, 1));
  await b.close();
})();
