#!/bin/bash
# VERIFICATION ONLY (PR #13163 R9): second full replay of the Hosted MySQL 8.4 lane.
# with the same images and Maven invocations as .github/workflows/sdk-java.yml. Own containers only; removed at the end.
set -u
W=/root/verify/pr13163-r9/h9; O=/root/verify/pr13163-r9/out/lanes; mkdir -p $O
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/apache-maven-3.9.9/bin:$PATH
R="-Dmaven.repo.local=/root/verify/pr13163-r9/m2 -Dmaven.repo.local.tail=/root/.m2/repository"
# Lane 2: Hosted process fault gates / MySQL 8.4 / Java 21 (mysql:8.4.6) — the Verify step (HostedPublicWorkspaceIT et al.)
docker rm -f r9-13163-mysql84 > /dev/null 2>&1
docker run -d --name r9-13163-mysql84 -e MYSQL_DATABASE=hosted_harness_test -e MYSQL_ROOT_PASSWORD=hosted-fixture -p 127.0.0.1:33962:3306 mysql:8.4.6 > /dev/null
for i in $(seq 1 90); do docker exec r9-13163-mysql84 mysqladmin ping -h 127.0.0.1 -phosted-fixture > /dev/null 2>&1 && break; sleep 2; done
sleep 5
S=$(date +%s)
(cd $W && timeout 2400 mvn --batch-mode --no-transfer-progress $R -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql -Dnode.executable="$(command -v node)" -Dqwen.cli.entry="$W/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:33962/hosted_harness_test?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=hosted-fixture clean verify checkstyle:check > $O/hosted-mysql84-run2.log 2>&1); echo "hosted mysql84 exit=$? secs=$(( $(date +%s) - S ))" >> $O/lanes.log
(cd $W && node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/hosted-failsafe-check-run2.log 2>&1); echo "failsafe hosted check exit=$?" >> $O/lanes.log
docker rm -f r9-13163-mysql84 > /dev/null 2>&1
echo "LANES2-DONE $(date -u +%T)" >> $O/lanes.log
