#!/bin/bash
# Trial merge #2 (head 02de4b1 + main 669b2f0): SLC before/after the candidate, then full H2, MySQL ITs, Hosted IT (macOS).
RIG=/Users/wenshao/pr13545-rig; W=$RIG/src-merge2; S=$W/packages/sdk-java/managed-agent-server
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
MVN="/Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-merge2"
(cd $W/packages/sdk-java/qwencode && $MVN -q -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install) > $RIG/out/m2-install.log 2>&1
(cd $W/packages/sdk-java/runtime-broker && $MVN -q -DskipTests -Dcheckstyle.skip=true -Dspotbugs.skip=true install) >> $RIG/out/m2-install.log 2>&1
(cd $S && $MVN clean test) > $RIG/out/unit-merge2-cand2.log 2>&1
echo "H2 merge2+cand: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/unit-merge2-cand2.log | tail -1)"
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Pmysql-integration -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/managed_agent_test_merge2b?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/it-merge2-mysql2.log 2>&1
echo "MySQL ITs merge2+cand: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/it-merge2-mysql2.log | tail -1)"
(cd $S && $MVN -Dcheckstyle.skip=true -Dspotbugs.skip=true -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dqwen.cli.entry=$RIG/src-merge/dist/cli.js -Dnode.executable=/Users/wenshao/.local/share/fnm/node-versions/v24.18.1/installation/bin/node \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/hosted_it_merge2b?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password= verify) > $RIG/out/hosted-it-merge2b.log 2>&1
echo "Hosted IT merge2+cand: $(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/out/hosted-it-merge2b.log | tail -1)"
echo MERGE2-DONE
