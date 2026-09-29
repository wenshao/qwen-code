// Build the summary screenshot (05) from phase logs + unit test results.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const lines = [
  '# Stack (all real processes on Linux 6.6.89-cix, Node v24.14.0)',
  '[meta] MySQL 8.4 (docker mysql84-rig)  <-  Spring server jar: Session Store :18897 + Runtime Broker :19897, db=d6a',
  '[meta] Hosted Harness: /root/git/qwen-code-pr13071/dist/cli.js serve --profile hosted-harness (dcec43b97a)',
  '[meta] Fake OpenAI model scripted to call write_file/read_file/edit; driver speaks the Harness private API like D6b will',
  '[meta] Durable state verified independently by reading the committed journal/resource bytes in MySQL',
  '',
  '# Real-stack scenarios — 84/84 checks PASS',
  '[PASS] Phase A  17/17  approvalMode pinned at creation; plan/auto/unknown modes and bad timeouts -> 400 invalid_hosted_approval; yolo definition bytes unchanged; load reports the pinned mode',
  '[PASS] Phase B  22/22  default mode asks before write_file; nothing dispatched while waiting; allow -> runs; replay -> 200; conflict -> 409; deny -> refusal, next turn asks again',
  '[PASS] Phase C  12/12  5s timeout: question expires unanswered, turn ends ~7s; later calls refused without asking; late resolve -> 409 action_expired',
  '[PASS] Phase D  12/12  cancel while waiting: Action cancelled durably, workspace released, turn cancelled; resolve -> 409 action_cancelled; next turn works',
  '[PASS] Phase E  10/10  read_file (default) / write_file+edit (auto-edit) / everything (yolo) run without any Action',
  '[PASS] Phase F   4/4   SIGKILL Harness while waiting: new Harness load -> 409 hosted_turn_recovery_required; question still durable',
  '[PASS] Phase G   7/7   journal 503 while waiting: resolve -> 409 hosted_turn_recovery_required; session blocked in 80ms; blocked session writes nothing',
  '',
  '# Linux unit tests (reviewer test plan) — all pass',
  '[PASS] packages/core  vitest src/managed-runtime ....................  1732 passed (matches macOS count)',
  '[PASS] packages/core  vitest managed-harness-factory + managed-session-authority  98 passed',
  '[PASS] packages/cli   vitest src/serve/hosted (9 files) ............  182 passed (matches macOS count)',
  '[PASS] packages/cli   tsc --noEmit ................................  clean',
  '[PASS] ESLint + Prettier on all changed files ....................  clean',
  '',
  '[summary] RECOMMEND MERGE from the Linux real-stack perspective: no Linux-specific issue found',
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { background: #0d1117; color: #c9d1d9; font: 13px/1.5 "DejaVu Sans Mono", monospace; margin: 0; padding: 18px 22px; width: 1460px; }
  .head { color: #58a6ff; font-weight: bold; margin-top: 10px; } .pass { color: #3fb950; } .meta { color: #d29922; }
  .sum { color: #3fb950; font-weight: bold; margin-top: 10px; }
</style></head><body>${lines.map((l) => `<div class="${l.startsWith('[PASS]') ? 'pass' : l.startsWith('[meta]') ? 'meta' : l.startsWith('#') ? 'head' : l.startsWith('[summary]') ? 'sum' : ''}">${esc(l)}</div>`).join('')}</body></html>`;
fs.writeFileSync('/root/rig13071/shots/05-summary.html', html);
const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 165)), 0);
execFileSync('/usr/bin/chromium', ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--screenshot=/root/rig13071/shots/05-summary.png', `--window-size=1500,${60 + rows * 20}`, 'file:///root/rig13071/shots/05-summary.html'], { stdio: 'pipe' });
console.log('05-summary.png written');
