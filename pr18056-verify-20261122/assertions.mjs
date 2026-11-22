#!/usr/bin/env node
// Recompute every assertion that appears in assertions.json from raw logs.
// Each entry names the scripted comparison and the evidence file it reads.
import { readFileSync, existsSync } from 'node:fs';

const D = '/root/git/qwen-code-verify/tmp/pr18056-verify-20261122-1225';
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const read = (p) => stripAnsi(readFileSync(`${D}/${p}`, 'utf8'));
const rows = JSON.parse(read('results-all.json'));
const row = (id) => rows.find((r) => r.id === id);
const extra = JSON.parse(read('results-24-base-stall700both.json'))[0];

const results = [];
const add = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${detail}`);
};

// 12 claim checks from checks.mjs.
const checksLog = read('logs/checks.log');
for (const line of checksLog.split('\n')) {
  const m = /^(PASS|FAIL) (\S+)/.exec(line);
  if (m) add(`check-${m[2]}`, m[1] === 'PASS', line.slice(0, 120));
}
const checksCount = (checksLog.match(/^(PASS|FAIL) /gm) ?? []).length;
add('checks-complete', checksCount === 12, `${checksCount}/12 checks executed`);

// A/B and discrimination cells.
const cell = (id, want) => {
  const r = id === '24-base-stall700both' ? extra : row(id);
  add(`cell-${id}`, r && r.status === want, `${r?.status} (wanted ${want})`);
};
cell('01-clean-base', 'pass');
cell('02-clean-head', 'pass');
cell('03-base-stall-pre', 'fail');
cell('04-base-stall-post', 'fail');
cell('24-base-stall700both', 'fail');
cell('05-head-stall700', 'pass');
cell('06-head-stall1200', 'pass');
cell('07-m1-base', 'fail');
cell('08-m1-head', 'fail');
cell('23-sibling-stall700', 'fail');

// No mutant regressed from killed (fail) to survived (pass).
const mutants = ['M1_admitted_reset', 'M2_no_rearm', 'M3_no_activity_stamp', 'M4_jitter_zero', 'M5_no_disarm_on_arm', 'M6_no_freshness_guard', 'M7_reads_reset_too', 'M8_no_timer'];
const killed = (arm) =>
  new Set(rows.filter((r) => r.mutant && r.id.endsWith(`-${arm}`) && r.status === 'fail').map((r) => r.mutant));
const baseKilled = killed('base');
const headKilled = killed('head');
const regressions = [...baseKilled].filter((m) => !headKilled.has(m));
add(
  'no-mutant-regression',
  regressions.length === 0 && baseKilled.size === 5 && headKilled.size === 5,
  `base kills ${baseKilled.size}/8, head kills ${headKilled.size}/8, regressions=[${regressions}]`,
);
const parsed = rows.filter((r) => r.mutant && r.status !== 'unknown').length;
add('mutant-cells-parsed', parsed === 16, `${parsed}/16 parsed`);

// Gates.
const block = read('logs/block-gate.log');
add('idle-block-17', /Tests {2}17 passed/.test(block), (block.match(/Tests {2}[^\n]+/) ?? [''])[0]);
const full = existsSync(`${D}/logs/full-file-head.log`) ? read('logs/full-file-head.log') : '';
const fullMatch = /Tests {2}(\d+) passed/.exec(full);
add(
  'full-file-872',
  /FULLFILE_EXIT=0/.test(full) && fullMatch?.[1] === '872' && !/failed/.test(full.match(/Tests {2}[^\n]+/)?.[0] ?? ''),
  (full.match(/Tests {2}[^\n]+/) ?? ['missing'])[0],
);
const prettier = read('logs/prettier.log');
add('prettier', /All matched files use Prettier code style/.test(prettier), 'format check');

// Flake premise: same commit failed attempt 1 and passed attempt 2.
const a1 = JSON.parse(read('logs/flake-attempt1.json'));
const a2 = JSON.parse(read('logs/flake-attempt2.json'));
add(
  'flake-is-nondeterministic',
  a1.conclusion === 'failure' && a2.conclusion === 'success' && a1.head_sha === a2.head_sha,
  `${a1.head_sha.slice(0, 12)}: ${a1.conclusion} then ${a2.conclusion}`,
);

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`\n${pass}/${results.length} assertions passed, ${fail} failed`);
console.log(JSON.stringify({ pass, fail, total: results.length }));
