#!/bin/bash
# usage: run-hosted-it.sh <arm> [tag]   HostedPublicWorkspaceIT via -Phosted-harness-mysql on MySQL 8.4.7
A=$1; RIG=/Users/wenshao/pr13545-rig; W=$RIG/src-$A/packages/sdk-java/managed-agent-server; L=$RIG/out/hosted-it-$A${2:-}.log
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
echo "=== $(date +%T) $A HostedPublicWorkspaceIT ($(git -C $RIG/src-$A rev-parse --short HEAD))" > $L
(cd $W && /Users/wenshao/Install/maven/bin/mvn -B -ntp -Dmaven.repo.local=$RIG/m2-$A -Dcheckstyle.skip=true -Dspotbugs.skip=true -Phosted-harness-mysql -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=HostedPublicWorkspaceIT \
  -Dqwen.cli.entry=$RIG/src-base/dist/cli.js -Dnode.executable=/Users/wenshao/.local/state/fnm_multishells/99322_1791431467758/bin/node \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:23545/hosted_it_$A${2:-}?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root "-Dmysql.password=" verify) >> $L 2>&1
echo "[$A] exit=$?" >> $L
grep -E "Tests run:|<<< (FAIL|ERR)|Expected size|\[ERROR\]   " $L | head -12
