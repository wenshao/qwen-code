#!/bin/bash
# runs INSIDE pr14120-mx: trial merge (PR head into main 91385884eb), Java-only — the FG8 IT fails before any Node process if its JDBC seed cannot run
set -u
exec > /rig/results/merge-check.log 2>&1
mkdir -p /root/.m2 && cp /rig/scripts/settings.xml /root/.m2/settings.xml
[ -d /work/merge ] || { mkdir -p /work && tar xf /rig/merge.tar -C /work; }
cd /work/merge && mkdir -p dist && [ -f dist/cli.js ] || echo '// placeholder: the JDBC seed fails before the CLI is spawned' > dist/cli.js
mvn -B -ntp -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install | tail -3
mvn -B -ntp -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install | tail -3
mysql_db=hosted_harness_merge
URL="jdbc:mysql://pr14120-db:3306/${mysql_db}?allowPublicKeyRetrieval=true&useSSL=false&createDatabaseIfNotExist=true"
START=$(date +%s)
QWEN_MANAGED_HOOK_CGROUP_ROOT=/sys/fs/cgroup/fg8 mvn -B -ntp -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-monitor-run-gates \
  -Dnode.executable=/usr/bin/true -Dqwen.cli.entry=/work/merge/dist/cli.js -Dmysql.url="$URL" -Dmysql.user=root -Dmysql.password=hosted-fixture \
  -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false clean verify > /rig/results/merge-mvn.log 2>&1
echo "MERGE_RESULT rc=$? secs=$(( $(date +%s) - START ))"
grep -E "Tests run:.*Fail|doesn't exist|BadSqlGrammar|Table '" /rig/results/merge-mvn.log | sort | uniq -c | head -12
