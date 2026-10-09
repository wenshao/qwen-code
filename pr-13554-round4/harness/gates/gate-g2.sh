#!/bin/bash
# G2: O4 MySQL gates; G3: PR suite on both real databases; P1: publication recovery probe (head).
R=/Users/wenshao/pr13554-rig; L=$R/logs/gates4; mkdir -p $L
REPO="-Dmaven.repo.local=$R/m2-m4 -Dmaven.repo.local.tail=/m2tail"
M=$R/g2/packages/sdk-java/managed-agent-server; cd $M
T=src/test/java/com/alibaba/qwen/code/managedagent
mysql -hmysql84 -uroot -pverify -e 'DROP DATABASE IF EXISTS qwen_o4_ci; CREATE DATABASE qwen_o4_ci' 2>/dev/null
s=$(date +%s); QWEN_O4_MYSQL_PASSWORD=verify mvn -B -o $REPO -Po4-mysql-gates -Dtest=NoSuchUnitTest -Dsurefire.failIfNoSpecifiedTests=false -Dqwen.o4.mysql.url='jdbc:mysql://mysql84:3306/qwen_o4_ci?allowPublicKeyRetrieval=true&useSSL=false' -Dqwen.o4.mysql.user=root clean verify checkstyle:check > $L/G2-o4-mysql.log 2>&1; echo "exit=$? secs=$(( $(date +%s) - s ))" >> $L/G2-o4-mysql.log
cp $R/probe/SessionResourceCollectionMySqlGate.java $T/store/
cp $R/probe/store/PublicationRecoveryProbeSupport.java $T/store/
cp $R/probe/PublicationRecoveryProbe.java $T/
for db in mysql84 mariadb; do
  mysql -h$db -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS qwen_o4_ci; CREATE DATABASE IF NOT EXISTS probe_root' 2>/dev/null
  s=$(date +%s); QWEN_O4_MYSQL_PASSWORD=verify mvn -B -o $REPO -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest=SessionResourceCollectionMySqlGate -Dsurefire.failIfNoSpecifiedTests=false -Dqwen.o4.required=true -Dqwen.o4.mysql.url="jdbc:mysql://$db:3306/qwen_o4_ci?allowPublicKeyRetrieval=true&useSSL=false" -Dqwen.o4.mysql.user=root test > $L/G3-gate-$db.log 2>&1; echo "exit=$? secs=$(( $(date +%s) - s ))" >> $L/G3-gate-$db.log
  mvn -B -o $REPO -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest=PublicationRecoveryProbe -Dsurefire.failIfNoSpecifiedTests=false -Dmysql.url="jdbc:mysql://$db:3306/probe_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify test > $L/P1-probe-head-$db.log 2>&1; echo "exit=$?" >> $L/P1-probe-head-$db.log
done
rm -f $T/store/SessionResourceCollectionMySqlGate.java $T/store/PublicationRecoveryProbeSupport.java $T/PublicationRecoveryProbe.java
echo G2-DONE > $L/G2.done
