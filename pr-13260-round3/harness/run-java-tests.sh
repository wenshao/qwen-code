#!/bin/bash
# Full Runtime Broker + Managed Agent server unit suites (H2) and the PR's MySQL ITs against MySQL 8.4 (x86_64, JDK 21).
set -u
export JAVA_HOME=/root/Install/jdk21 PATH=/root/Install/jdk21/bin:/root/Install/maven/bin:$PATH
SJ=/root/verify/pr13260/head/packages/sdk-java; O=/root/verify/pr13260/logs; R="-Dmaven.repo.local=/root/verify/pr13260/m2/repository"
(cd $SJ/runtime-broker && mvn -B -ntp $R -Dcheckstyle.skip=true install > $O/java-test-broker.log 2>&1); echo "broker full suite + install exit=$?"
cd $SJ/managed-agent-server
mvn -B -ntp $R -Pmysql-integration -Dit.test='WorkspaceMigrationMySqlIT,WorkspaceSessionRetentionMySqlIT,WorkspaceSessionCloseMySqlIT' -Dfailsafe.failIfNoSpecifiedTests=false \
  "-Dmysql.url=jdbc:mysql://127.0.0.1:33260/mysql?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=rootpw verify > $O/java-test-server.log 2>&1
echo "server full suite + MySQL ITs exit=$?"
echo JAVA-TESTS-DONE
