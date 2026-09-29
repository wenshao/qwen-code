#!/bin/bash
# container: the 'hosted-harness-mysql' job of sdk-java.yml, run in place in a full tree (node_modules present).
# usage: ci-hosted.sh <tree> <label>
set -u
TREE=$1; L=$2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ci-$L; mkdir -p $O
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd /rig/$TREE; GITHUB_WORKSPACE=/rig/$TREE
S() { echo "[$L] $(date -u +%T) step '$1': exit=$2"; }
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/h0-install.log 2>&1; S "Hosted: Install Managed Agent dependencies" $?
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql "-Dnode.executable=$(command -v node)" "-Dqwen.cli.entry=${GITHUB_WORKSPACE}/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/hosted_harness_test_$L?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw clean verify checkstyle:check > $O/h1-hosted.log 2>&1; S "Hosted: Verify Hosted Java, Spring and MySQL processes" $?
grep -E "Tests run:.*-- in .*IT$" $O/h1-hosted.log | sed -E 's/^\[[A-Z]+\] //; s/, Time elapsed[^-]*-- in / -- /'; grep -E '<<< (FAILURE|ERROR)!' $O/h1-hosted.log | head -8
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/h2-guard.log 2>&1; S "Hosted: Check that every Hosted integration test class ran" $?; cat $O/h2-guard.log
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -Pfault-gates "-Dqwen.cli.entry=${GITHUB_WORKSPACE}/dist/cli.js" test > $O/h3-gates.log 2>&1; S "Hosted: Run Runtime Broker fault gates" $?
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $O/h3-gates.log | tail -1; grep -E '<<< (FAILURE|ERROR)!' $O/h3-gates.log | head -5
echo "[$L] CI-HOSTED-DONE"
