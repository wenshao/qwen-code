#!/bin/bash
# The PR's own Issue13181QueryBudgetTest, unchanged except its fixture runs on a real MySQL 8.4.7 schema.
RIG=/Users/wenshao/pr13217-rig
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
cd $RIG/src-my/packages/sdk-java/managed-agent-server
echo "=== $(date +%T) H2 (as shipped)"
/Users/wenshao/Install/maven/bin/mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-pr -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=Issue13181QueryBudgetTest -Dsurefire.failIfNoSpecifiedTests=false test > $RIG/out/mytest-h2.log 2>&1; echo "h2 exit=$?"
grep -E "Tests run:|FAIL" $RIG/out/mytest-h2.log | tail -3
echo "=== $(date +%T) MySQL 8.4.7"
/Users/wenshao/Install/maven/bin/mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2-pr -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dtest=Issue13181QueryBudgetTest -Dsurefire.failIfNoSpecifiedTests=false "-Drig.mysql.url=jdbc:mysql://127.0.0.1:13217/mysql?useSSL=false&allowPublicKeyRetrieval=true" test > $RIG/out/mytest-mysql.log 2>&1; echo "mysql exit=$?"
grep -E "Tests run:|FAIL|ERROR\]" $RIG/out/mytest-mysql.log | tail -20
grep -c RIG_MYSQL_SCHEMA $RIG/out/mytest-mysql.log $RIG/packages 2>/dev/null; grep -h -c RIG_MYSQL_SCHEMA target/surefire-reports/*Issue13181* 2>/dev/null
echo "=== $(date +%T) MYTEST-DONE"
