#!/bin/bash
# VERIFICATION RIG ONLY (PR #13194): head managed-agent-server unit suite + real-MySQL ITs.
R=/Users/wenshao/pr13135-rig; W=${W:-/Users/wenshao/git/qwen-code-pr13194}/packages/sdk-java; L=${L:-head}
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
M="-B -ntp -o -Dmaven.repo.local=$R/m2"
DBU="-Dmysql.user=root -Dmysql.password=<local-rig-db-password>"
(cd $W/managed-agent-server && mvn $M -Pmysql-integration "-Dmysql.url=jdbc:mysql://127.0.0.1:33135/p94_it?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false" $DBU \
  -Dit.test='WorkspaceSessionRetentionMySqlIT,WorkspaceSessionCloseMySqlIT,ToolPublicationRecoveryMySqlIT,ManagedAgentMySqlIT,WorkspaceRecoveryMySqlIT' -Dfailsafe.failIfNoSpecifiedTests=false \
  clean verify > $R/out/p94-unit-$L.log 2>&1; echo "managed exit=$?")
grep -E "Tests run:|FAIL|ERROR\]" $R/out/p94-unit-$L.log | grep -E "Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$|FAIL|ERROR\]" | tail -15
echo UNIT-DONE $(date -u +%T)
