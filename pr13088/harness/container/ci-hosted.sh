#!/bin/bash
# container (VM, --network host): the 'hosted-harness-mysql' job of sdk-java.yml, run in place in a full tree
# (node_modules with the linux esbuild binary, dist present). usage: ci-hosted.sh <tree> <label> [extra mvn args for the verify step]
set -u
TREE=$1; L=$2; shift 2
printf '%s\n' "$(cat /rig/machine-id.txt)" > /etc/machine-id
O=/rig/out/ci-$L; mkdir -p $O
cp -a /root/.m2/repository /m2; export MAVEN_ARGS="-Dmaven.repo.local=/m2"
cd /rig/$TREE; GITHUB_WORKSPACE=/rig/$TREE
DBN=hosted_harness_test_$(echo $L | tr -c 'a-zA-Z0-9\n' '_')_$(date +%s)
S() { echo "[$L] $(date -u +%T) step '$1': exit=$2"; }
echo "[$L] env: machine-id=[$(cat /etc/machine-id)] kernel=$(uname -r) $(java -version 2>&1 | head -1) node=$(node -v) db=$DBN"
(mvn --batch-mode --no-transfer-progress -f packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && mvn --batch-mode --no-transfer-progress -f packages/sdk-java/runtime-broker/pom.xml -DskipTests install) > $O/h0-install.log 2>&1; S "Install Managed Agent dependencies" $?
mvn --batch-mode --no-transfer-progress -f packages/sdk-java/managed-agent-server/pom.xml -Phosted-harness-mysql "-Dnode.executable=$(command -v node)" "-Dqwen.cli.entry=${GITHUB_WORKSPACE}/dist/cli.js" "-Dmysql.url=jdbc:mysql://127.0.0.1:3306/$DBN?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw "$@" clean verify checkstyle:check > $O/h1-hosted.log 2>&1; S "Verify Hosted Java, Spring and MySQL processes" $?
grep -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $O/h1-hosted.log | sed -E 's/^\[[A-Z]+\] /   totals: /'
grep -E "Tests run:.*-- in .*IT$" $O/h1-hosted.log | sed -E 's/^\[[A-Z]+\] /   /; s/, Time elapsed[^-]*-- in / -- /'; grep -E '<<< (FAILURE|ERROR)!' $O/h1-hosted.log | head -8
grep -a -E "^W1_|^HOSTED_[A-Z_]+_OK|HOSTED_SHELL_PRODUCERS|HOSTED_MYSQL_DATABASE" $O/h1-hosted.log | cut -c1-160 | sed 's/^/   /'
grep -E "violations|You have [0-9]+ Checkstyle" $O/h1-hosted.log | tail -2 | sed 's/^/   /'
node scripts/check-failsafe-reports.js hosted packages/sdk-java/managed-agent-server > $O/h2-guard.log 2>&1; S "Check that every Hosted integration test class ran" $?; sed 's/^/   /' $O/h2-guard.log | tail -12
echo "[$L] CI-HOSTED-DONE"
