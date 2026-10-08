#!/bin/bash
R=/Users/wenshao/pr13554-rig; L=$R/logs/gates
$R/e2e/e2e1.sh cand 18801 > $R/logs/e2e/E2E1-cand.log 2>&1
REPO="-Dmaven.repo.local=$R/m2-cand -Dmaven.repo.local.tail=/m2tail"
M=$R/wt-cand/packages/sdk-java/managed-agent-server; cd $M; T=src/test/java/com/alibaba/qwen/code/managedagent
cp $R/probe/SessionResourceCollectionMySqlGate.java $T/store/
for db in mysql84 mariadb; do
  QWEN_O4_MYSQL_PASSWORD=verify mvn -B -o $REPO -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest=SessionResourceCollectionMySqlGate -Dsurefire.failIfNoSpecifiedTests=false -Dqwen.o4.required=true -Dqwen.o4.mysql.url="jdbc:mysql://$db:3306/qwen_o4_ci?allowPublicKeyRetrieval=true&useSSL=false" -Dqwen.o4.mysql.user=root test > $L/G3-cand-$db.log 2>&1; echo "exit=$?" >> $L/G3-cand-$db.log
done
rm -f $T/store/SessionResourceCollectionMySqlGate.java
mvn -B -o $REPO -q checkstyle:check > $L/cand-checkstyle.log 2>&1; echo "exit=$?" >> $L/cand-checkstyle.log
echo CAND-DONE > $L/cand.done
