#!/bin/bash
# VERIFICATION ONLY (PR #13163 R9): replay the two CI database lanes still pending at 39267a90 on this host,
# with the same images and Maven invocations as .github/workflows/sdk-java.yml. Own containers only; removed at the end.
set -u
W=/root/verify/pr13163-r9/h9; O=/root/verify/pr13163-r9/out/lanes; mkdir -p $O
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:$PATH
R="-Dmaven.repo.local=/root/verify/pr13163-r9/m2 -Dmaven.repo.local.tail=/root/.m2/repository"
until [ -s /root/verify/pr13163-r9/out/tsmut/results.json ]; do sleep 15; done
echo "LANES-START $(date -u +%T)" > $O/lanes.log
# Lane 1: Runtime Broker and Managed Agent MariaDB / Java 21 (mariadb:10.11.18)
docker rm -f r9-13163-mariadb > /dev/null 2>&1
docker run -d --name r9-13163-mariadb -e MARIADB_DATABASE=runtime_broker_test -e MARIADB_ROOT_PASSWORD=runtime-broker -p 127.0.0.1:33961:3306 mariadb:10.11.18 > /dev/null
for i in $(seq 1 60); do docker exec r9-13163-mariadb healthcheck.sh --connect --innodb_initialized > /dev/null 2>&1 && break; sleep 2; done
S=$(date +%s)
(cd $W/packages/sdk-java/runtime-broker && mvn --batch-mode --no-transfer-progress $R -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33961/runtime_broker_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker clean verify > $O/mariadb-broker.log 2>&1); echo "mariadb broker exit=$? secs=$(( $(date +%s) - S ))" >> $O/lanes.log
(cd $W && mvn --batch-mode --no-transfer-progress $R -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $O/mariadb-deps.log 2>&1 && mvn --batch-mode --no-transfer-progress $R -f packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install >> $O/mariadb-deps.log 2>&1); echo "deps exit=$?" >> $O/lanes.log
S=$(date +%s)
(cd $W/packages/sdk-java/managed-agent-server && mvn --batch-mode --no-transfer-progress $R -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33961/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=runtime-broker clean verify checkstyle:check > $O/mariadb-managed.log 2>&1); echo "mariadb managed exit=$? secs=$(( $(date +%s) - S ))" >> $O/lanes.log
(cd $W && node scripts/check-failsafe-reports.js non-hosted packages/sdk-java/runtime-broker packages/sdk-java/managed-agent-server > $O/mariadb-failsafe-check.log 2>&1); echo "failsafe non-hosted check exit=$?" >> $O/lanes.log
docker rm -f r9-13163-mariadb > /dev/null 2>&1
# Lane 2: Hosted process fault gates / MySQL 8.4 / Java 21 (mysql:8.4.6) — the Verify step (HostedPublicWorkspaceIT et al.)
(cd $W && corepack pnpm run bundle > $O/bundle.log 2>&1); echo "bundle exit=$?" >> $O/lanes.log
docker rm -f r9-13163-mysql84 > /dev/null 2>&1
docker run -d --name r9-13163-mysql84 -e MYSQL_DATABASE=hosted_harness_test -e MYSQL_ROOT_PASSWORD=hosted-fixture -p 127.0.0.1:33962:3306 mysql:8.4.6 > /dev/null
for i in $(seq 1 90); do docker exec r9-13163-mysql84 mysqladmin ping -h 127.0.0.1 -phosted-fixture > /dev/null 2>&1 && break; sleep 2; done
sleep 5
S=$(date +%s)
(cd $W && timeout 2400 mvn --batch-mode --no-transfer-progress $R -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$W/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:33962/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check > $O/hosted-mysql84.log 2>&1); echo "hosted mysql84 exit=$? secs=$(( $(date +%s) - S ))" >> $O/lanes.log
(cd $W && node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/hosted-failsafe-check.log 2>&1); echo "failsafe hosted check exit=$?" >> $O/lanes.log
docker rm -f r9-13163-mysql84 > /dev/null 2>&1
echo "LANES-DONE $(date -u +%T)" >> $O/lanes.log
