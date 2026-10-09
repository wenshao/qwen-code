#!/bin/bash
# P1 on a comparison arm: usage probe-arm.sh <arm> <worktree>
ARM=$1; WT=$2; R=/Users/wenshao/pr13554-rig; L=$R/logs/gates
REPO="-Dmaven.repo.local=$R/m2-$ARM -Dmaven.repo.local.tail=/m2tail"
M=$WT/packages/sdk-java/managed-agent-server; cd $M; T=src/test/java/com/alibaba/qwen/code/managedagent
cp $R/probe/store/PublicationRecoveryProbeSupport.java $T/store/; cp $R/probe/PublicationRecoveryProbe.java $T/
for db in ${DBS:-mysql84 mariadb}; do
  mysql -h$db -uroot -pverify -e 'CREATE DATABASE IF NOT EXISTS probe_root' 2>/dev/null
  mvn -B -o $REPO -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest=PublicationRecoveryProbe -Dsurefire.failIfNoSpecifiedTests=false -Dmysql.url="jdbc:mysql://$db:3306/probe_root?allowPublicKeyRetrieval=true&useSSL=false" -Dmysql.user=root -Dmysql.password=verify test > $L/P1-probe-$ARM-$db.log 2>&1; echo "exit=$?" >> $L/P1-probe-$ARM-$db.log
done
rm -f $T/store/PublicationRecoveryProbeSupport.java $T/PublicationRecoveryProbe.java
echo "P1-DONE $ARM"
