#!/usr/bin/env bash
# The PR's own regression test, run against BASE source.
S=/root/git/h11483
B=$'\e[1m'; R=$'\e[0m'; CYA=$'\e[96m'; DIM=$'\e[2m'
echo "${B}${CYA}PR #11483 — R2: non-vacuity of the new regression test${R}"
echo "${DIM}the PR's test file, unchanged, applied on top of base 10895031e2${R}"
echo
cd /root/git/base11483
cp packages/core/src/core/coreToolScheduler.test.ts /tmp/base-sched-test.bak
cp /root/git/pr11483/packages/core/src/core/coreToolScheduler.test.ts packages/core/src/core/coreToolScheduler.test.ts
cd packages/core
npx vitest run src/core/coreToolScheduler.test.ts -t "rejects a pre-aborted queued request without waiting for the active batch" 2>&1 \
  | sed -n '/Failed Tests/,/Duration/p' | head -24
cd /root/git/base11483 && cp /tmp/base-sched-test.bak packages/core/src/core/coreToolScheduler.test.ts
