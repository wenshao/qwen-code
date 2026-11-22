#!/usr/bin/env node
// Scripted checks for the PR's own claims. Each check prints PASS/FAIL and
// exits nonzero if any failed. Counts here feed assertions.json alongside the
// matrix cells.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ARM = '/root/git/qwen-code-verify/tmp/pr18056-head';
const BASE = '7e37771164a1c2ab78b92ffea7678ae0a2e72aaf';
const HEAD = '01a9bff9e1e0baa3d92c0a36ef3f4da3813c1aa8';
const FILE = 'packages/cli/src/serve/hosted-harness-session.test.ts';
const git = (...args) =>
  execFileSync('git', ['-C', ARM, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

let pass = 0;
let fail = 0;
const check = (id, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` :: ${detail}` : ''}`);
  ok ? (pass += 1) : (fail += 1);
};

// 1. The diff touches one file and only the test's own numbers/comment.
const files = git('diff', '--name-only', BASE, HEAD).trim().split('\n');
check('one-file-changed', files.length === 1 && files[0] === FILE, files.join(','));

const changed = git('diff', '-U0', BASE, HEAD, '--', FILE)
  .split('\n')
  .filter((line) => /^[+-][^+-]/.test(line));
const expectedChanged = [
  '-    const server = await app(false, undefined, true, { idleSuspendMs: 1000 });',
  '+    const server = await app(false, undefined, true, { idleSuspendMs: 4000 });',
  '-    await sleep(600);',
  '+    await sleep(2400);',
  '-    // Past the original deadline (1000ms + ≤10% jitter), before the one',
  '-    // the title re-armed (≥1600ms from the create). The wide ratio keeps',
  '-    // the assertion meaningful on a loaded shard without racing it.',
  '-    await sleep(600);',
  '+    // Past the original deadline (4000ms + ≤10% jitter = ≤4400ms) and before',
  '+    // the one the title re-armed (≥6400ms from the create). Each sleep(2400)',
  '+    // has 1600ms of overrun tolerance before its own bound, but the residency',
  '+    // check itself clears the worst-case original fire by only ~400ms, so the',
  '+    // two sleeps must total more than idleMs * 1.1 (#18053).',
  '+    await sleep(2400);',
];
check(
  'diff-is-literals-and-comment-only',
  changed.length === expectedChanged.length &&
    changed.every((line, i) => line === expectedChanged[i]),
  `${changed.length} changed lines`,
);

// 2. No assertion, route, payload or expectation changed.
const removedAssertions = changed.filter(
  (line) => line.startsWith('-') && /expect\(|supertest|\.send\(/.test(line),
);
check('no-assertion-or-payload-removed', removedAssertions.length === 0);

// 3. The base variant is byte-identical to the base commit's file.
const baseVariant = readFileSync(
  `${ARM}/packages/cli/src/serve/hosted-harness-session.basevariant.test.ts`,
  'utf8',
);
check(
  'base-variant-is-base-commit',
  baseVariant === git('show', `${BASE}:${FILE}`),
);

// 4. Head tree is unmodified apart from the untracked probe files.
const tracked = git('status', '--porcelain', '--untracked-files=no').trim();
check('head-tree-clean', tracked === '', tracked.slice(0, 120));

// 5. Margin arithmetic, derived from the source constants.
const suspension = readFileSync(
  `${ARM}/packages/cli/src/serve/hosted-session-suspension.ts`,
  'utf8',
);
const jitter = Number(/const JITTER_FRACTION = ([\d.]+);/.exec(suspension)[1]);
check('jitter-is-10-percent', jitter === 0.1, String(jitter));
const margins = (idle, s1, s2) => {
  const worstOriginal = idle * (1 + jitter);
  const rearmedMin = s1 + idle;
  return {
    lowerMs: s1 + s2 - worstOriginal,
    upperMs: rearmedMin - (s1 + s2),
    ratio: (rearmedMin - (s1 + s2)) / (s1 + s2 - idle * (1 + jitter)),
  };
};
const baseM = margins(1000, 600, 600);
const headM = margins(4000, 2400, 2400);
check('base-lower-margin-100ms', baseM.lowerMs === 100, JSON.stringify(baseM));
check('head-lower-margin-400ms', headM.lowerMs === 400, JSON.stringify(headM));
check('base-upper-margin-400ms', baseM.upperMs === 400, JSON.stringify(baseM));
check('head-upper-margin-1600ms', headM.upperMs === 1600, JSON.stringify(headM));

// 6. The measurement environment must not override the test's idle window.
check(
  'no-idle-env-override',
  !process.env.QWEN_E2E_IDLE_SUSPEND_MS,
  process.env.QWEN_E2E_IDLE_SUSPEND_MS ?? 'unset',
);

// 7. Vitest's per-test ceiling on this host (RUNNER_NAME/RUNNER_OS absent).
const config = readFileSync(`${ARM}/packages/cli/vitest.config.ts`, 'utf8');
check(
  'ceiling-is-15s-here',
  !process.env.RUNNER_NAME && !process.env.RUNNER_OS && /15_000/.test(config),
);

console.log(`\nchecks: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
