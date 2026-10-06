#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505 round 3): verify the extended candidate (R1-1 + runtime-at-dispatch + path safety).
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
R=/Users/wenshao/git/pr13505-rig; W=/Users/wenshao/git/pr13505-cand3
$R/jtest.sh cand3b-contracts $W 'ManagedChildRunRecordContractTest,ManagedChildAcceptanceRecordContractTest,ManagedExtensionProjectionContractTest,ManagedExtensionRecordStoreTest'
(cd $W/packages/sdk-java/managed-agent-server && mvn -B -ntp -o -q -Dmaven.repo.local=$R/m2 checkstyle:check > $R/logs/checkstyle-cand3b.log 2>&1; echo "checkstyle exit=$?")
$R/build-java.sh cand3b $W $R/m2 2>&1 | tail -1
cd $W && npm run build --workspace=packages/core > $R/logs/build-core-cand3b.log 2>&1; echo "core build=$?"
cd $W/packages/core
npx vitest run src/managed-runtime/managed-child-run-record.test.ts src/managed-runtime/managed-child-acceptance-record.test.ts src/managed-runtime/managed-extension-projection.test.ts src/managed-runtime/managed-session-authority.child-agent.test.ts src/managed-runtime/managed-session-authority.child-run.test.ts src/managed-runtime/local-shell-stream-result-session.test.ts > $R/logs/ts-focused-cand3b.log 2>&1
printf 'TS\tfocused-6files\tcand3b\texit=%s\t-\t%s\n' $? "$(grep -E '^ +Tests ' $R/logs/ts-focused-cand3b.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
npx vitest run src/managed-runtime > $R/logs/ts-mr-cand3b.log 2>&1
printf 'TS\tmanaged-runtime\tcand3b\texit=%s\t-\t%s\n' $? "$(grep -E '^ +Tests ' $R/logs/ts-mr-cand3b.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
cd $W/packages/cli
npx vitest run src/serve/hosted-harness-session.test.ts src/serve/hosted-child-run-session.test.ts src/serve/hosted-shell-publisher.background.test.ts > $R/logs/ts-cli-cand3b.log 2>&1
printf 'TS\tcli-3files\tcand3b\texit=%s\t-\t%s\n' $? "$(grep -E '^ +Tests ' $R/logs/ts-cli-cand3b.log | tail -1 | tr -s ' ')" | tee -a $R/results/ts.tsv
cd $W && npx tsc --noEmit -p packages/core > $R/logs/tsc-core-cand3b.log 2>&1; echo "tsc core exit=$?"; npx tsc --noEmit -p packages/cli > $R/logs/tsc-cli-cand3b.log 2>&1; echo "tsc cli exit=$?"
npx eslint packages/core/src/managed-runtime/managed-child-run-record.ts packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-harness-session.test.ts > $R/logs/eslint-cand3b.log 2>&1; echo "eslint exit=$?"
npx prettier --check packages/core/src/managed-runtime/managed-child-run-record.ts packages/core/src/managed-runtime/contracts/managed-child-run-record-v1.fixtures.json packages/cli/src/serve/hosted-harness-session.ts packages/cli/src/serve/hosted-harness-session.test.ts > $R/logs/prettier-cand3b.log 2>&1; echo "prettier exit=$?"
echo CAND3B-DONE
