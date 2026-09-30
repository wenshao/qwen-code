// Render rig13098 logs as terminal-style screenshots via headless chromium.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RIG = '/root/rig13098';
const SHOTS = path.join(RIG, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const colorize = (line) => {
  const l = strip(line);
  let cls = '';
  if (l.includes('[PASS]') || l.trimStart().startsWith('✓')) cls = 'pass';
  else if (l.includes('[FAIL]') || l.trimStart().startsWith('×') || l.includes('AssertionError')) cls = 'fail';
  else if (l.includes('ALL PASS')) cls = 'pass bold';
  else if (l.includes('FAILURE')) cls = 'fail bold';
  else if (/^\s*(Tests|Test Files)\s/.test(l) || l.includes('[summary]')) cls = 'sum';
  else if (l.startsWith('#')) cls = 'head';
  else if (/Expected|Received|hosted_turn_recovery_required|action_expired/.test(l) && (l.includes('-') || l.includes('+'))) cls = l.trimStart().startsWith('-') ? 'pass' : 'fail';
  return `<div class="${cls}">${esc(l)}</div>`;
};

function page(title, lines) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { background: #0d1117; color: #c9d1d9; font: 13px/1.45 "DejaVu Sans Mono", monospace; margin: 0; padding: 18px 22px; }
    .title { color: #8b949e; border-bottom: 1px solid #30363d; padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; }
    .pass { color: #3fb950; } .fail { color: #f85149; } .bold { font-weight: bold; }
    .sum { color: #58a6ff; font-weight: bold; } .head { color: #58a6ff; font-weight: bold; margin-top: 10px; }
  </style></head><body><div class="title">${esc(title)}</div>${lines.map(colorize).join('')}</body></html>`;
}

function shot(name, title, lines) {
  const html = path.join(SHOTS, `${name}.html`);
  fs.writeFileSync(html, page(title, lines));
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(strip(l).length / 155)), 0);
  const height = Math.min(140 + rows * 21, 3200);
  execFileSync('/usr/bin/chromium', [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${path.join(SHOTS, `${name}.png`)}`,
    `--window-size=1500,${height}`, `file://${html}`,
  ], { stdio: 'pipe' });
  console.log(`shot ${name}.png ${lines.length} lines`);
}

const read = (f) => fs.readFileSync(path.join(RIG, 'out', f), 'utf8').trimEnd().split('\n');
const trim = (l, n = 150) => strip(l).length > n ? `${strip(l).slice(0, n)}…` : strip(l);

// 01: independent probe at PR head.
shot('01-probe-p1-p2', 'PR #13098 — independent queue-race probe (real Session authority + JSONL journal on disk), PR head 52e02b300a', [
  '# Real authority/resource store/JSONL journal; one real append delayed once (slow flush); blocked predicate = the production route\'s () => session.blocked',
  ...read('probe-p1-p2.log').filter((l) => /✓|Tests |Test Files/.test(strip(l))),
  '# P1 also asserts on the journal bytes: only [requested] on disk while blocked, exactly one expiry after unblock, replay adds no record',
  '# P2 verifies the durable decision bytes equal {"v":1,"optionId":"allow","inputRevision":1,"policyRevision":"hosted-tool-approval/1"} and digest = lowercase hex SHA-256',
]);

// 02: mutation — guard removed (before/after contrast).
const mut = read('mutation-guard-removed.log').map((l) => strip(l));
const pick = (re, from = 0) => mut.filter((l, i) => i >= from && re.test(l));
shot('02-mutation-guard-removed', 'PR #13098 — mutation: admission guard reverted (pre-fix behavior); both probes fail on the response code', [
  '# git mutation: endHostedAction(session, requestId, \'expired\', writable) -> endHostedAction(session, requestId, \'expired\')',
  '# independent probe (pre-fix behavior returns action_expired and would append the expiry):',
  ...pick(/P1: a queued|→ expected \{ status: 409, code: 'action_expired' \}|P2: a queued/),
  ...pick(/- Expected|\+ Received|-   "code"|\+   "code"/).slice(0, 4),
  ...pick(/Tests  1 failed \| 1 passed \(2\)/),
  '# PR\'s own queued-race regression test, same mutation:',
  ...pick(/✓ writes nothing when the Session blocks while the decision/),
  ...pick(/× writes nothing when the Session blocks while the expiry/),
  ...pick(/-   "code": "hosted_turn_recovery_required"|\+   "code": "action_expired"/).slice(1, 3),
  ...pick(/Tests  1 failed \| 1 passed \| 67 skipped/),
]);

// 03: real-stack E2E.
const e2e = read('e2e.log').filter((l) => /^\[(PASS|FAIL|summary)\]/.test(strip(l))).map((l) => trim(l, 165));
shot('03-real-stack-e2e', 'PR #13098 — real stack on Linux: packaged Harness + Spring Session Store (MySQL) + Runtime Broker; 34/34 checks', [
  '# MySQL 8.4 + pr-server.jar (18898/19898, db d6a98) + dist/cli.js serve (bundled at PR head) + fake OpenAI model',
  ...e2e,
]);

// 04: M2/M3 regression-guard mutations.
const grab = (f, re) => read(f).filter((l) => re.test(strip(l))).slice(0, 6);
shot('04-regression-guard-mutations', 'PR #13098 — the updated regression checks reject injected regressions the old assertions accepted', [
  '# M2: inject stopped journal writes into an otherwise successful denied-call test',
  '#   new afterEach (expectWritesStopped=false) -> suite notices:',
  ...grab('mutation-m2-new-aftereach.log', /×|→|Tests /),
  '#   old afterEach (writesStopped branch) -> same injection silently passes:',
  ...grab('mutation-m2-old-aftereach.log', /✓|Tests /),
  '# M3: add tool arguments to the published approval metadata',
  '#   new toEqual -> extra public field rejected:',
  ...grab('mutation-m3-toequal.log', /×|AssertionError|arguments|Tests /),
  '#   old toMatchObject -> same extra field silently passes:',
  ...grab('mutation-m3-tomatchobject.log', /✓|Tests /),
]);
