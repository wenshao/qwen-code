#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505). usage: ts-suite.sh <label>  (worktree pr13505-<label>)
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig; L=$1; W=/Users/wenshao/git/pr13505-$L
cd $W/packages/core; s=$(date +%s)
npx vitest run src/managed-runtime > $R/logs/ts-mr-$L.log 2>&1; c=$?
printf 'TS\tmanaged-runtime\t%s\texit=%s\t%ss\t%s\n' $L $c $(( $(date +%s)-s )) "$(grep -E '^ +Tests ' $R/logs/ts-mr-$L.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
cd $W/packages/cli; s=$(date +%s)
npx vitest run src/serve/hosted-child-run-session.test.ts src/serve/hosted-shell-publisher.background.test.ts src/serve/hosted-harness-session > $R/logs/ts-cli-$L.log 2>&1; c=$?
printf 'TS\tcli-serve\t%s\texit=%s\t%ss\t%s\n' $L $c $(( $(date +%s)-s )) "$(grep -E '^ +Tests ' $R/logs/ts-cli-$L.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
