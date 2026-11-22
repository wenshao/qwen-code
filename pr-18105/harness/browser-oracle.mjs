// Real-browser computed-style oracle: does the stylesheet actually paint the
// running/active-work dot green, and what do the escaping mutants paint?
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mutations } from './mutations.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const orig = readFileSync(path.join(dir, 'pkg', 'css.orig'), 'utf8');
const matrix = JSON.parse(readFileSync(path.join(dir, 'matrix.json'), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

// Token values verbatim from packages/web-shell/client/App.module.css (light).
const TOKENS = `:root { --agent-blue-500: #6785ff; --success-color: #48bb78; }`;
const BLUE = 'rgb(103, 133, 255)';
const GREEN = 'rgb(72, 187, 120)';

const cells = [
  ['C0-unmutated', 'running', GREEN],
  ['C0-unmutated', 'completed-unread', BLUE],
  ['M1-running-token-to-blue', 'running', BLUE],
  ['M3-running-rule-moved-before-base', 'running', BLUE],
  ['M7-higher-specificity-blue-override', 'running', BLUE],
  ['M8-media-blue-override', 'running', BLUE],
];

const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const [mutation, kind, expected] of cells) {
  const css = mutations[mutation](orig);
  if (matrix.find((r) => r.mutation === mutation).cssSha !== sha(css)) {
    throw new Error(`mutation moved since matrix run: ${mutation}`);
  }
  const classAttr = kind === 'running' ? 'sessionStatusDot sessionStatusDotRunning' : 'sessionStatusDot';
  await page.setContent(`<!doctype html><style>${TOKENS}\n${css}</style>
    <span id="dot" class="${classAttr}"></span>`);
  const actual = await page.$eval('#dot', (el) => getComputedStyle(el).color);
  rows.push({ mutation, kind, expected, actual, ok: actual === expected });
  console.log(`${mutation.padEnd(38)} ${kind.padEnd(17)} expected ${expected.padEnd(18)} actual ${actual.padEnd(18)} ${actual === expected ? 'OK' : 'MISMATCH'}`);
}
await browser.close();
writeFileSync(path.join(dir, 'browser-oracle.json'), JSON.stringify(rows, null, 2));
if (rows.some((r) => !r.ok)) process.exit(1);
