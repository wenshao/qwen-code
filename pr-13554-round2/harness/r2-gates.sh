#!/bin/bash
. /root/verify/pr13554/env.sh
export MVN_REPO="-Dmaven.repo.local=/root/verify/pr13554/m2-r2 -Dmaven.repo.local.tail=/root/.m2/repository"
L=/root/verify/pr13554/logs/r2; mkdir -p $L
S=/root/verify/pr13554/wt-r2/packages/sdk-java
cd $S && mvn -B -q -o $MVN_REPO -f qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install > $L/deps.log 2>&1 && mvn -B -q -o $MVN_REPO -f runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true install >> $L/deps.log 2>&1; echo "deps exit=$?" >> $L/deps.log
cd $S/managed-agent-server
mvn -B -o $MVN_REPO -Pmysql-integration -Dmysql.url='jdbc:mysql://127.0.0.1:33555/managed_agent_test?createDatabaseIfNotExist=true&allowPublicKeyRetrieval=true&useSSL=false' -Dmysql.user=root -Dmysql.password=verify clean verify checkstyle:check > $L/G1-mariadb-verify.log 2>&1; echo "exit=$?" >> $L/G1-mariadb-verify.log
QWEN_O4_MYSQL_PASSWORD=verify mvn -B -o $MVN_REPO -Po4-mysql-gates -Dqwen.o4.mysql.url='jdbc:mysql://127.0.0.1:33554/qwen_o4_ci?allowPublicKeyRetrieval=true&useSSL=false' -Dqwen.o4.mysql.user=root clean verify checkstyle:check > $L/G2-o4-mysql.log 2>&1; echo "exit=$?" >> $L/G2-o4-mysql.log
G=src/test/java/com/alibaba/qwen/code/managedagent/store/SessionResourceCollectionMySqlGate.java
cp /root/verify/pr13554/publish/pr-13554/harness/SessionResourceCollectionMySqlGate.java $G
for db in 33554:mysql84 33555:mariadb1011; do port=${db%%:*}; name=${db##*:}
  QWEN_O4_MYSQL_PASSWORD=verify mvn -B -o $MVN_REPO -Djacoco.skip=true -Dspotbugs.skip=true -Dtest=SessionResourceCollectionMySqlGate -Dsurefire.failIfNoSpecifiedTests=false -Dqwen.o4.required=true -Dqwen.o4.mysql.url="jdbc:mysql://127.0.0.1:$port/qwen_o4_ci?allowPublicKeyRetrieval=true&useSSL=false" test > $L/G3-gate-$name.log 2>&1; echo "exit=$?" >> $L/G3-gate-$name.log
done
rm -f $G
mvn -B -q -o $MVN_REPO -DskipTests -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true clean compile > $L/compile.log 2>&1
mvn -B -q -o $MVN_REPO dependency:build-classpath -Dmdep.outputFile=/root/verify/pr13554/e2e/cp-wt-r2.txt -Dmdep.includeScope=runtime >> $L/compile.log 2>&1
rm -rf /root/verify/pr13554/e2e/app-r2 && mkdir -p /root/verify/pr13554/e2e/app-r2 && cp -r target/classes /root/verify/pr13554/e2e/app-r2/classes
echo R2-GATES-DONE > $L/DONE
