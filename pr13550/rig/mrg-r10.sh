#!/bin/bash
# Local merge of 0bf20143 + main fbde5cf0 (one-line test conflict taken from the PR side): build the Java server, run the migration ITs on real MySQL 8.4.
set -u
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:/Users/wenshao/Install/maven/bin:$PATH
RIG=/Users/wenshao/git/pr13550-rig; WT=/Users/wenshao/git/pr13550-base; M2=$RIG/m2-ab
cd $WT && echo "base at $(git log -1 --format='%h parents=%p')"
for m in qwencode runtime-broker; do (cd packages/sdk-java/$m && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip -Dmaven.javadoc.skip=true -Dmaven.source.skip=true install) || { echo "INSTALL FAIL $m"; exit 2; }; done
(cd packages/sdk-java/managed-agent-server && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip clean package) || { echo "PACKAGE FAIL"; exit 3; }
unzip -l packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar | grep -o "V5[0-9]__[a-z_]*" | sort -u | tr '\n' ' '; echo
for t in WorkspaceMigrationMySqlIT ManagedWorkspaceRolesMySqlIT ManagedExtensionRecordVerdictReconcileMySqlIT; do
  db=rmrg_$(echo $t | tr 'A-Z' 'a-z' | cut -c1-20)
  "$RIG/mysql.sh" sql -e "DROP DATABASE IF EXISTS $db; CREATE DATABASE $db" || exit 9
  (cd packages/sdk-java/managed-agent-server && mvn -B -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip -Dspotless.check.skip=true -Pmysql-integration verify \
     -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dit.test=$t -Dfailsafe.failIfNoSpecifiedTests=false \
     "-Dmysql.url=jdbc:mysql://127.0.0.1:33550/$db?useSSL=false&allowPublicKeyRetrieval=true" -Dmysql.user=root) > $RIG/it-mrg-$t.log 2>&1
  echo "$t: $(grep -E 'Tests run:.*Fail' $RIG/it-mrg-$t.log | grep -v ' in ' | tail -1) $(grep -E 'BUILD (SUCCESS|FAILURE)' $RIG/it-mrg-$t.log)"
done
cp packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar $RIG/merged-server.jar
echo "mrg-r10 DONE"
