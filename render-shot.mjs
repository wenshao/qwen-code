/**
 * Replay a captured raw ANSI stream into xterm.js inside headless Chromium and
 * screenshot the terminal, so the evidence images are the real rendered TUI.
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const WT = process.env.WT;
const require_ = createRequire(join(WT, 'package.json'));
const { chromium } = require_('playwright');

const THEME = {
  background: '#1b1d24',
  foreground: '#d5d8e2',
  cursor: '#d5d8e2',
  black: '#3b3f51',
  red: '#ff6b81',
  green: '#4fd18b',
  yellow: '#e8c35a',
  blue: '#6aa9ff',
  magenta: '#c58aff',
  cyan: '#4fd1c5',
  white: '#d5d8e2',
  brightBlack: '#6b7186',
  brightRed: '#ff8a9b',
  brightGreen: '#6ee7a8',
  brightYellow: '#f2d476',
  brightBlue: '#8fbfff',
  brightMagenta: '#d6a8ff',
  brightCyan: '#6fe3d8',
  brightWhite: '#ffffff',
};

function resolveXtermDir() {
  const p = require_.resolve('@xterm/xterm/package.json');
  return dirname(p);
}

export async function renderAnsi({ ansiPath, outPath, title, cols = 120, rows = 40, trimTo }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1700, height: 1100 },
    deviceScaleFactor: 2,
  });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#12141a;">
    <div id="frame" style="padding:18px;display:inline-block;background:#12141a;">
      <div style="background:#262933;border-radius:9px 9px 0 0;padding:8px 12px;display:flex;align-items:center;gap:7px;">
        <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57;display:inline-block"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#febc2e;display:inline-block"></span>
        <span style="width:11px;height:11px;border-radius:50%;background:#28c840;display:inline-block"></span>
        <span style="flex:1;text-align:center;color:#b6bac6;font:12px -apple-system,system-ui,sans-serif;">${title}</span>
      </div>
      <div id="xterm-container" style="background:${THEME.background};border-radius:0 0 9px 9px;padding:10px;"></div>
    </div>
  </body></html>`);

  const xtermDir = resolveXtermDir();
  await page.addStyleTag({ path: join(xtermDir, 'css', 'xterm.css') });
  await page.addScriptTag({ path: join(xtermDir, 'lib', 'xterm.js') });

  await page.evaluate(
    ({ cols, rows, theme }) => {
      const W = window;
      const term = new W.Terminal({
        cols,
        rows,
        theme,
        fontFamily: "'Menlo','Monaco','Consolas',monospace",
        fontSize: 13,
        lineHeight: 1.25,
        cursorBlink: false,
        allowProposedApi: true,
        scrollback: 4000,
      });
      term.open(document.getElementById('xterm-container'));
      W.term = term;
    },
    { cols, rows, theme: THEME },
  );

  let data = readFileSync(ansiPath, 'utf8');
  if (trimTo) {
    const i = data.lastIndexOf(trimTo);
    if (i > 0) data = data.slice(0, i + trimTo.length + 200000);
  }
  // feed in chunks so xterm keeps up
  const CH = 60000;
  for (let i = 0; i < data.length; i += CH) {
    const chunk = data.slice(i, i + CH);
    await page.evaluate(
      (c) => new Promise((r) => window.term.write(c, r)),
      chunk,
    );
  }
  await page.waitForTimeout(800);
  mkdirSync(dirname(outPath), { recursive: true });
  const el = await page.$('#frame');
  await el.screenshot({ path: outPath });
  await browser.close();
  return outPath;
}

if (process.env.ANSI && process.env.OUTPNG) {
  await renderAnsi({
    ansiPath: process.env.ANSI,
    outPath: process.env.OUTPNG,
    title: process.env.TITLE ?? 'qwen-code',
    cols: Number(process.env.COLS ?? 120),
    rows: Number(process.env.ROWS ?? 40),
  });
  console.log('wrote', process.env.OUTPNG);
}
