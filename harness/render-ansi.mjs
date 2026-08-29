/** Render a raw ANSI capture to PNG via xterm.js in Playwright. */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , input, output, colsArg] = process.argv;
const data = readFileSync(input, 'utf8').replace(/\n$/, '');
const cols = Number(colsArg ?? 120);
const rows = data.split('\n').length;

const xtermJs = readFileSync('node_modules/@xterm/xterm/lib/xterm.js', 'utf8');
const xtermCss = readFileSync('node_modules/@xterm/xterm/css/xterm.css', 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(`<!doctype html><html><head><style>${xtermCss}
  body{margin:0;background:#0d1117}
  #wrap{display:inline-block;padding:14px;background:#0d1117}
</style></head><body><div id="wrap"><div id="term"></div></div>
<script>${xtermJs}</script></body></html>`);

await page.evaluate(
  ({ data, cols, rows }) =>
    new Promise((resolve) => {
      const term = new window.Terminal({
        cols,
        rows,
        fontSize: 13,
        fontFamily: 'Menlo, monospace',
        theme: { background: '#0d1117', foreground: '#c9d1d9' },
        allowProposedApi: true,
      });
      term.open(document.getElementById('term'));
      term.write(data.replace(/\n/g, '\r\n'), () => setTimeout(resolve, 300));
    }),
  { data, cols, rows },
);

await page.locator('#wrap').screenshot({ path: output });
await browser.close();
console.log(`${output} (${cols}x${rows})`);
