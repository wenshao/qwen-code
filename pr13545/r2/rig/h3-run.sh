#!/bin/bash
RIG=/Users/wenshao/pr13545-rig; S=$RIG/src-h3/packages/sdk-java/managed-agent-server
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-h3"
(cd $S && $MVN clean test) > $RIG/out/unit-h3.log 2>&1
echo "H2 h3: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/unit-h3.log | tail -1) SLC: $(grep -E 'Tests run:.*SessionLifecycleCoordinatorTest' $RIG/out/unit-h3.log | tail -1 | sed 's/.*Tests run/Tests run/')"
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Pmysql-integration -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/managed_agent_test_h3?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/it-h3-mysql.log 2>&1
echo "MySQL ITs h3: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/it-h3-mysql.log | tail -1) $(grep -E '<<< (FAIL|ERR)' $RIG/out/it-h3-mysql.log | sed 's/.*managedagent\.//' | cut -c1-120 | tr '\n' ';')"
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dqwen.cli.entry=$RIG/src-merge/dist/cli.js -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/hosted_it_h3?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/hosted-it-h3.log 2>&1
echo "Hosted IT h3 macOS: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/hosted-it-h3.log | tail -1)"
echo H3-DONE
