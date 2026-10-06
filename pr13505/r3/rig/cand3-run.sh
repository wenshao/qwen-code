#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 3): verify the R1-1/R1-2/R1-4 candidate on top of 3261e4d4.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
R=/Users/wenshao/git/pr13505-rig; W=/Users/wenshao/git/pr13505-cand3
$R/jtest.sh cand3-contracts $W 'ManagedChildRunRecordContractTest,ManagedChildAcceptanceRecordContractTest,ManagedExtensionProjectionContractTest,ManagedExtensionRecordStoreTest'
$R/build-java.sh cand3 $W $R/m2 2>&1 | tail -1
cd $W && node scripts/setup-worktree.js > $R/logs/setup-cand3.log 2>&1 && npm run build > $R/logs/build-cand3.log 2>&1; echo "cand3 ts build=$?"
cd $W/packages/core
npx vitest run src/managed-runtime/managed-child-run-record.test.ts src/managed-runtime/managed-child-acceptance-record.test.ts src/managed-runtime/managed-extension-projection.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts src/managed-runtime/managed-session-authority.child-run.test.ts src/managed-runtime/local-shell-stream-result-session.test.ts > $R/logs/ts-focused-cand3.log 2>&1
printf 'TS\tfocused-6files\tcand3\texit=%s\t-\t%s\n' $? "$(grep -E '^ +Tests ' $R/logs/ts-focused-cand3.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
cd $W/packages/cli
npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-child-run-session.test.ts src/serve/hosted-shell-publisher.background.test.ts > $R/logs/ts-cli-cand3.log 2>&1
printf 'TS\tcli-3files\tcand3\texit=%s\t-\t%s\n' $? "$(grep -E '^ +Tests ' $R/logs/ts-cli-cand3.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
cd $W && npx tsc --noEmit -p packages/core > $R/logs/tsc-core-cand3.log 2>&1; echo "tsc core exit=$?"; npx tsc --noEmit -p packages/cli > $R/logs/tsc-cli-cand3.log 2>&1; echo "tsc cli exit=$?"
echo CAND3-DONE
