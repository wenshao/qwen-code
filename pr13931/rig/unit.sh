#!/bin/bash
# usage: unit.sh <arm>  -- the PR's own Java unit/MySQL tests and touched vitest suites, inside u24
A=$1; R=/root/pr13931-rig; W=$R/src-$A; DB=unit_$A
docker exec pr13931-db mysql -uroot -phosted-fixture -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB" 2>&1 | grep -v Warning
docker run --rm --init --name pr13931-unit-$A --network pr13931net -v $R:$R -v /etc/machine-id:/etc/machine-id:ro qwen-managed-e2e:u24 bash -c "
  MV='mvn -B -ntp -s $R/settings.xml -Dmaven.repo.local=$R/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true'
  cd $W/packages/sdk-java/qwencode && \$MV -Dtest=HostedHarnessClientTest -Dsurefire.failIfNoSpecifiedTests=false test > $R/out/unit-$A-qwencode.log 2>&1; echo \"[$A] qwencode HostedHarnessClientTest exit=\$?\"
  cd $W/packages/sdk-java/runtime-broker && \$MV test > $R/out/unit-$A-broker.log 2>&1; echo \"[$A] runtime-broker full suite exit=\$?\"
  cd $W/packages/sdk-java/managed-agent-server && \$MV -Dtest='WorkspaceProfileLifecycleTest,WorkspaceLifecycleStoreTest,SessionLifecycleProtocolChoiceTest,WorkspaceSessionRetentionTest,SessionLifecycle*Test,WorkspaceLifecycle*Test' -Dsurefire.failIfNoSpecifiedTests=false \
     -Dit.test=WorkspaceProfileLifecycleMySqlIT -Dmysql.url='jdbc:mysql://pr13931-db:3306/$DB?allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=hosted-fixture verify > $R/out/unit-$A-server.log 2>&1; echo \"[$A] server lifecycle unit + MySQL IT exit=\$?\"
  cd $W/packages/cli && CI=true npx vitest run src/serve/hosted-harness-contract.test.ts src/serve/hosted-mcp-session.test.ts src/serve/hosted-monitor-loop.test.ts src/serve/hosted-shell-publisher.background.test.ts src/serve/process-env-guard.test.ts src/serve/hosted-never-started-reconcile.test.ts > $R/out/unit-$A-vitest.log 2>&1; echo \"[$A] vitest touched suites exit=\$?\"
  cd $W/packages/cli && CI=true npx vitest run src/serve/hosted-harness-session.test.ts > $R/out/unit-$A-hhs.log 2>&1; echo \"[$A] vitest hosted-harness-session exit=\$?\"
"
for f in qwencode broker server; do grep -E "Tests run:.*(Fail|Err)" $R/out/unit-$A-$f.log | tail -2; done
for f in vitest hhs; do sed 's/\x1b\[[0-9;]*m//g' $R/out/unit-$A-$f.log | grep -a -E "Test Files|Tests  |FAIL " | head -8; done
echo "[$A] UNIT-DONE"
