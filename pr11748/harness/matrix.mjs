import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const H = '/root/git/pr11748-harness/head';
const S = process.env.S;
const reqWS = createRequire(H + '/packages/web-shell/package.json');
const reqRoot = createRequire(H + '/scripts/tests/x.js');
const { JSDOM } = reqRoot('jsdom');
const xtermSources = {
  'web-shell @xterm/xterm': dirname(reqWS.resolve('@xterm/xterm')),
  'root @xterm/xterm (test)': dirname(reqRoot.resolve('@xterm/xterm')),
};
const compilers = {
  '0.21.5 (web-shell vite, lockfile)': S + '/tc/e0215/node_modules/esbuild',
  '0.25.6 (root, lockfile/CI)': S + '/tc/e0256/node_modules/esbuild',
  '0.25.12 (root, this box drift)': H + '/node_modules/esbuild',
  '0.28.2': S + '/tc/e0282/node_modules/esbuild',
};
const targets = {
  es2020: 'es2020',
  'vite5 default modules': ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
  es2021: 'es2021',
  'vite7 default baseline': ['chrome107', 'edge107', 'firefox104', 'safari16'],
};
function probe(code) {
  const module = { exports: {} };
  const { window } = new JSDOM();
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', { value: () => null });
  runInNewContext(code, { window, document: window.document, navigator: window.navigator, module, exports: module.exports, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, console, performance });
  const t = new module.exports.Terminal({ allowProposedApi: true });
  const replies = [];
  t.onData((d) => replies.push(d));
  let err = null;
  try { t._core._inputHandler.parse('\x1b[?2004$pafter-query'); } catch (e) { err = String(e); }
  const out = t.buffer.active.getLine(0).translateToString().trimEnd();
  t.dispose();
  return { replies: JSON.stringify(replies), out, err };
}
const rows = [];
for (const [xname, xdir] of Object.entries(xtermSources)) {
  const pkg = JSON.parse(await readFile(resolve(xdir, '../package.json'), 'utf8'));
  const source = await readFile(resolve(xdir, 'xterm.mjs'), 'utf8');
  for (const [cname, cdir] of Object.entries(compilers)) {
    const esb = createRequire(cdir + '/package.json')(cdir);
    for (const [tname, target] of Object.entries(targets)) {
      let code;
      try { ({ code } = await esb.transform(source, { target, minify: true, format: 'cjs' })); }
      catch (e) { rows.push({ xterm: `${xname}@${pkg.version}`, esbuild: `${cname} [${esb.version}]`, target: tname, voidSites: '-', ok: 'n/a', replies: '', out: '', err: 'transform rejected: ' + String(e.message).split('\n')[1] }); continue; }
      const sites = (code.match(/\(void 0\|\|\(/g) || []).length;
      const r = probe(code);
      rows.push({ xterm: `${xname}@${pkg.version}`, esbuild: `${cname} [${esb.version}]`, target: tname, voidSites: sites, ok: r.replies === '["\\u001b[?2004;2$y"]' && r.out === 'after-query', ...r });
    }
  }
}
for (const r of rows) console.log(JSON.stringify(r));
