// Render PR #12998 verification evidence as terminal-style screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RIG = '/root/rig12998';
const SHOTS = path.join(RIG, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colorize = (line) => {
  let cls = '';
  if (/FAILURES PRESENT|MISSED|BASELINE FAIL|UPDATED FAIL/.test(line)) cls = 'fail';
  else if (line.startsWith('mutation CAUGHT')) cls = 'pass';
  else if (line.startsWith('TIGHTEN')) cls = 'tight';
  else if (line.startsWith('#')) cls = 'head';
  else if (line.startsWith('$')) cls = 'cmd';
  else if (/ALL PASS|BUILD SUCCESS|passed|CLEAN|SUCCESS|exit=0/.test(line)) cls = 'pass';
  else if (line.startsWith('RESULT') || line.startsWith('=>')) cls = 'pass bold';
  return `<div class="${cls}">${esc(line) || '&nbsp;'}</div>`;
};

function page(title, lines) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { background: #0d1117; color: #c9d1d9; font: 13px/1.45 "DejaVu Sans Mono", monospace; margin: 0; padding: 18px 22px; }
    .title { color: #8b949e; border-bottom: 1px solid #30363d; padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; }
    .pass { color: #3fb950; } .fail { color: #f85149; } .bold { font-weight: bold; }
    .tight { color: #d29922; } .head { color: #58a6ff; font-weight: bold; margin-top: 10px; }
    .cmd { color: #8b949e; margin-top: 8px; }
  </style></head><body><div class="title">${esc(title)}</div>${lines.map(colorize).join('')}</body></html>`;
}

function shot(name, title, lines) {
  const html = path.join(SHOTS, `${name}.html`);
  fs.writeFileSync(html, page(title, lines));
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 150)), 0);
  const height = Math.min(110 + rows * 21 + 40, 3200);
  execFileSync('/usr/bin/chromium', [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${path.join(SHOTS, `${name}.png`)}`,
    `--window-size=1500,${height}`, `file://${html}`,
  ], { stdio: 'pipe' });
  console.log(`shot ${name}.png ${lines.length} lines`);
}

const read = (f) => fs.readFileSync(path.join(RIG, 'out', f), 'utf8').trimEnd().split('\n');

shot('01-gates', 'PR #12998 verification (Linux, head b1754087cd) — build, Java contract suites, WebShell tests, static gates',
  read('gates.log'));

shot('02-before-after', 'PR #12998 — task_cancel schema: main (v1.22.0) vs PR (v1.23.0), Ajv draft 2020-12',
  read('before-after.log'));

shot('03-validation', 'PR #12998 — independent schema validation: 90 behavioral checks x 2 contracts + 10 schema mutations',
  read('validate.log'));

shot('04-parity', 'PR #12998 — published WebShell client: structural parity with main, planned surface excluded',
  read('parity.log'));
