// Render rig logs as terminal-style screenshots via headless chromium.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RIG = '/root/rig13071';
const SHOTS = path.join(RIG, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colorize = (line) => {
  let cls = '';
  if (line.startsWith('[PASS]')) cls = 'pass';
  else if (line.startsWith('[FAIL]')) cls = 'fail';
  else if (line.startsWith('[summary]')) cls = line.includes('ALL PASS') ? 'pass bold' : 'fail bold';
  else if (line.startsWith('[action]') || line.startsWith('[fault]') || line.startsWith('[harness]')) cls = 'meta';
  else if (line.startsWith('#')) cls = 'head';
  return `<div class="${cls}">${esc(line)}</div>`;
};

function page(title, lines) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { background: #0d1117; color: #c9d1d9; font: 13px/1.45 "DejaVu Sans Mono", monospace; margin: 0; padding: 18px 22px; }
    .title { color: #8b949e; border-bottom: 1px solid #30363d; padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; }
    .pass { color: #3fb950; } .fail { color: #f85149; } .bold { font-weight: bold; }
    .meta { color: #d29922; } .head { color: #58a6ff; font-weight: bold; margin-top: 10px; }
  </style></head><body><div class="title">${esc(title)}</div>${lines.map(colorize).join('')}</body></html>`;
}

function shot(name, title, lines) {
  const html = path.join(SHOTS, `${name}.html`);
  fs.writeFileSync(html, page(title, lines));
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 160)), 0);
  const height = Math.min(60 + rows * 19 + 40, 3000);
  execFileSync('/usr/bin/chromium', [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${path.join(SHOTS, `${name}.png`)}`,
    `--window-size=1500,${height}`, `file://${html}`,
  ], { stdio: 'pipe' });
  console.log(`shot ${name}.png ${lines.length} lines`);
}

const read = (f) => fs.readFileSync(path.join(RIG, 'out', f), 'utf8').trimEnd().split('\n');
const trimJson = (l, n = 150) => l.length > n ? `${l.slice(0, n)}…` : l;

// 02: allow/deny flow (phase B), long JSON trimmed.
shot('02-allow-deny', 'PR #13071 real-stack — Phase B: allow / deny / replay (MySQL + Spring Store + Broker + Harness)',
  read('b-allow.log').map((l) => trimJson(l, 170)));

// 03: expiry + cancel.
shot('03-expiry-cancel', 'PR #13071 real-stack — Phase C: expiry, Phase D: cancel while waiting', [
  '# Phase C: approvalTimeoutMs=5000, nobody answers',
  ...read('c-expiry.log').map((l) => trimJson(l, 170)),
  '',
  '# Phase D: cancel while the approval waits',
  ...read('d-cancel.log').map((l) => trimJson(l, 170)),
]);

// 04: restart + journal fault.
shot('04-restart-fault', 'PR #13071 real-stack — Phase F: Harness restart strands a waiting approval, Phase G: journal failure blocks the Session', [
  '# Phase F: SIGKILL the Harness while an approval waits',
  ...read('f-restart.log').map((l) => trimJson(l, 170)),
  '',
  '# Phase G: journal appends fail (503) while an approval waits',
  ...read('g-journal-fail.log').map((l) => trimJson(l, 170)),
]);

// 01: validation + pre-approved.
shot('01-validate', 'PR #13071 real-stack — Phase A: mode pinning & validation, Phase E: pre-approved tools never ask', [
  '# Phase A: approvalMode pinned at creation; plan/auto/bad timeouts refused',
  ...read('a-validate.log').map((l) => trimJson(l, 170)),
  '',
  '# Phase E: read_file (default) / write_file+edit (auto-edit) / everything (yolo) run without asking',
  ...read('e-preapproved.log').map((l) => trimJson(l, 170)),
]);

// 06: review-fix races.
shot('06-review-races', 'PR #13071 real-stack — Phase H: concurrent answers race on one Action (head 706d402aeb review fixes)',
  read('h-race.log').map((l) => trimJson(l, 170)));
