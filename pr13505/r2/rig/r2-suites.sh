#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 2): focused TS on h2/m2, then m2 Java full + MySQL ITs, then m2 TS full.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig
for a in h2 m2; do
  cd /Users/wenshao/git/pr13505-$a/packages/core; s=$(date +%s)
  npx vitest run src/managed-runtime/managed-child-run-record.test.ts src/managed-runtime/managed-child-acceptance-record.test.ts src/managed-runtime/managed-extension-projection.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts src/managed-runtime/managed-session-authority.child-run.test.ts src/managed-runtime/local-shell-stream-result-session.test.ts > $R/logs/ts-focused-$a.log 2>&1; c=$?
  printf 'TS\tfocused-6files\t%s\texit=%s\t%ss\t%s\n' $a $c $(( $(date +%s)-s )) "$(grep -E '^ +Tests ' $R/logs/ts-focused-$a.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
done
$R/suite.sh m2 /Users/wenshao/git/pr13505-m2 $R/m2 p13505_suite_m2
grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$" $R/logs/suite-m2.log | tail -1
$R/it-all.sh m2 /Users/wenshao/git/pr13505-m2 p13505_it_m2
$R/ts-suite.sh m2
