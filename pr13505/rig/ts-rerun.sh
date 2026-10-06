#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505): isolated reruns of the suite failures, per arm.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig
for a in base head merge; do
  W=/Users/wenshao/git/pr13505-$a
  cd $W/packages/core
  npx vitest run src/managed-runtime/managed-session-authority.hook-scale.test.ts src/managed-runtime/managed-session-record-sink.test.ts src/managed-runtime/managed-child-run-supervisor.test.ts > $R/logs/ts-rerun-core-$a.log 2>&1; c=$?
  printf 'RERUN\tcore-3files\t%s\texit=%s\t%s\n' $a $c "$(grep -E '^ +Tests ' $R/logs/ts-rerun-core-$a.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts-rerun.tsv
  cd $W/packages/cli
  npx vitest run src/serve/hosted-harness-session.test.ts > $R/logs/ts-rerun-cli-$a.log 2>&1; c=$?
  printf 'RERUN\thosted-harness-session\t%s\texit=%s\t%s\n' $a $c "$(grep -E '^ +Tests ' $R/logs/ts-rerun-cli-$a.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts-rerun.tsv
done
