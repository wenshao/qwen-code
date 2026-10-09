#!/bin/bash
# head ffd7b22: H2 clean test, -Pmysql-integration on MySQL 8.4, then (after its dist exists) the Hosted IT on macOS.
RIG=/Users/wenshao/pr13545-rig; S=$RIG/src-h4/packages/sdk-java/managed-agent-server
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-h4"
(cd $S && $MVN clean test) > $RIG/out/unit-h4.log 2>&1
echo "H2 h4: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/unit-h4.log | tail -1) | $(grep -E '<<< (FAIL|ERR)' $RIG/out/unit-h4.log | sed 's/.*managedagent\.//' | cut -c1-110 | tr '\n' ';')"
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Pmysql-integration -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/managed_agent_test_h4?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/it-h4-mysql.log 2>&1
echo "MySQL ITs h4: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/it-h4-mysql.log | tail -1) | $(grep -E '<<< (FAIL|ERR)' $RIG/out/it-h4-mysql.log | sed 's/.*managedagent\.//' | cut -c1-110 | tr '\n' ';')"
until [ -f $RIG/src-h4/dist/cli.js ] && grep -q BUILD-TS-DONE $RIG/out/build-ts-h4.out 2>/dev/null; do sleep 10; done
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dqwen.cli.entry=$RIG/src-h4/dist/cli.js -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/hosted_it_h4?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/hosted-it-h4.log 2>&1
echo "Hosted IT h4 macOS: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/hosted-it-h4.log | tail -1) | $(grep -E '<<< (FAIL|ERR)|Expected size' $RIG/out/hosted-it-h4.log | cut -c1-140 | tr '\n' ';')"
echo H4-DONE
