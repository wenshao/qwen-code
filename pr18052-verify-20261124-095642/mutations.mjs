// Mutation matrix for the load-admission thresholds (S1's class) and the
// rebuild-path monitor dispose (S2).
//
// Each row applies one exact source replacement, runs the suite that owns the
// mutated file, records vitest's own JSON counts, restores the file, and
// requires a clean `git status --porcelain`.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ARM = process.env.ARM_DIR;
const OUT = process.env.OUT_JSON || path.resolve('mutations.json');
const CLI_PKG = path.join(ARM, 'packages', 'cli');
const LOGDIR = path.join(path.dirname(OUT), 'mutation-logs');
fs.mkdirSync(LOGDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LADM = 'packages/cli/src/serve/load-admission.ts';
const SERVE = 'packages/cli/src/serve/run-qwen-serve.ts';
const LADM_SUITE = ['src/serve/load-admission.test.ts', 'src/serve/load-admission-signals.test.ts'];
const SERVE_SUITE = ['src/serve/run-qwen-serve-load-admission.test.ts'];

const rows = [
  {
    id: 'M1-lag-enter-1000-to-10000',
    note: "S1's own subject: the documented 1000 ms lag enter threshold",
    file: LADM,
    from: 'export const EVENT_LOOP_LAG_ENTER_MS = 1_000;',
    to: 'export const EVENT_LOOP_LAG_ENTER_MS = 10_000;',
    suite: LADM_SUITE,
    expect: 'killed',
  },
  {
    id: 'M2-cpu-enter-2.0-to-20.0',
    note: 'sibling: documented load-ratio enter threshold',
    file: LADM,
    from: 'export const LOAD_RATIO_ENTER = 2.0;',
    to: 'export const LOAD_RATIO_ENTER = 20.0;',
    suite: LADM_SUITE,
    expect: 'killed',
  },
  {
    id: 'M3-cpu-exit-1.0-to-0.5',
    note: 'sibling: documented load-ratio exit threshold',
    file: LADM,
    from: 'export const LOAD_RATIO_EXIT = 1.0;',
    to: 'export const LOAD_RATIO_EXIT = 0.5;',
    suite: LADM_SUITE,
    expect: 'killed',
  },
  {
    id: 'M4-lag-exit-250-to-5',
    note: 'sibling: documented lag exit threshold',
    file: LADM,
    from: 'export const EVENT_LOOP_LAG_EXIT_MS = 250;',
    to: 'export const EVENT_LOOP_LAG_EXIT_MS = 5;',
    suite: LADM_SUITE,
    expect: 'killed',
  },
  {
    id: 'M5-sample-2000-to-5000',
    note: 'sibling: the documented two-second sample interval',
    file: LADM,
    from: 'export const LOAD_ADMISSION_SAMPLE_MS = 2_000;',
    to: 'export const LOAD_ADMISSION_SAMPLE_MS = 5_000;',
    suite: LADM_SUITE,
    expect: 'killed',
  },
  {
    id: 'M6-sustain-3-to-1',
    note: 'same-file positive control (prior round measured this one killed)',
    file: LADM,
    from: 'export const LOAD_ADMISSION_SUSTAIN_SAMPLES = 3;',
    to: 'export const LOAD_ADMISSION_SUSTAIN_SAMPLES = 1;',
    suite: LADM_SUITE,
    expect: 'control-killed',
  },
  {
    id: 'M7-rebuild-dispose-removed',
    note: "S2's subject: monitor dispose before a buildRuntime re-entry",
    file: SERVE,
    from: '    // rebuild (buildRuntime re-entry) can\'t leak the old interval +\n    // histogram — symmetric with the metrics sampler below.\n    loadAdmissionMonitor?.dispose();',
    to: "    // rebuild (buildRuntime re-entry) can't leak the old interval +\n    // histogram — symmetric with the metrics sampler below.",
    suite: SERVE_SUITE,
    expect: 'survived-or-killed',
  },
  {
    id: 'M8-optout-condition-to-true',
    note: 'same-file positive control for the dispose suite',
    file: SERVE,
    from: 'opts.loadAdmission !== false && deps.bridge === undefined',
    to: 'true && deps.bridge === undefined',
    suite: SERVE_SUITE,
    expect: 'control-killed',
  },
];

function git(args) {
  return execFileSync('git', args, { cwd: ARM, encoding: 'utf8' });
}

const out = [];
for (const row of rows) {
  const abs = path.join(ARM, row.file);
  const original = fs.readFileSync(abs, 'utf8');
  const occurrences = original.split(row.from).length - 1;
  const rec = { id: row.id, note: row.note, file: row.file, expect: row.expect, occurrences };
  if (occurrences !== 1) {
    rec.status = 'skipped';
    rec.reason = `anchor matched ${occurrences} times (must be exactly 1)`;
    console.log(`SKIP ${row.id}: ${rec.reason}`);
    out.push(rec);
    continue;
  }
  fs.writeFileSync(abs, original.replace(row.from, row.to));
  try {
    // Guard against vitest reusing a transform cached for the pre-edit mtime.
    await sleep(1200);
    const report = path.join(LOGDIR, `${row.id}.json`);
    const logFile = path.join(LOGDIR, `${row.id}.log`);
    let exitCode = 0;
    try {
      execFileSync(
        'npx',
        ['vitest', 'run', '--reporter=json', `--outputFile=${report}`, ...row.suite],
        { cwd: CLI_PKG, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 },
      );
    } catch (e) {
      exitCode = e.status ?? 1;
      fs.writeFileSync(logFile, `${e.stdout || ''}\n${e.stderr || ''}`);
    }
    const j = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
    rec.exitCode = exitCode;
    rec.passed = j?.numPassedTests ?? null;
    rec.failed = j?.numFailedTests ?? null;
    rec.total = j?.numTotalTests ?? null;
    rec.failedNames = j
      ? (j.testResults || [])
          .flatMap((t) => t.assertionResults || [])
          .filter((a) => a.status === 'failed')
          .map((a) => a.fullName || a.title)
          .slice(0, 4)
      : [];
    rec.status = rec.report_ok === false ? 'no-report' : rec.failed > 0 ? 'killed' : 'survived';
    if (!j) rec.status = 'no-report';
    console.log(
      `${rec.status.toUpperCase()} ${row.id}: passed=${rec.passed} failed=${rec.failed} total=${rec.total}` +
        (rec.failedNames?.length ? `  red: ${rec.failedNames.join(' | ')}` : ''),
    );
  } finally {
    fs.writeFileSync(abs, original);
    await sleep(1200);
  }
  const dirty = git(['status', '--porcelain', '--', row.file]).trim();
  rec.restoredClean = dirty === '';
  if (!rec.restoredClean) console.log(`WARN ${row.id}: tree not clean after restore: ${dirty}`);
  out.push(rec);
}

fs.writeFileSync(OUT, JSON.stringify({ arm: ARM, rows: out }, null, 2));
const rowsEval = out.filter((r) => r.status === 'killed' || r.status === 'survived');
console.log(`\nSUMMARY: ${rowsEval.length} evaluated, ${out.filter((r) => r.status === 'killed').length} killed, ${out.filter((r) => r.status === 'survived').length} survived`);
process.exit(0);