#!/bin/bash
# usage: recheck.sh <id|head> <TestClass>
id=$1; t=$2; R=/root/pr13330-r3; D=$R/mut/rc-$id; L=$R/logs/recheck-$id-$t.log
rm -rf $D; mkdir -p $D $R/m2/rc-$id; cp -a $R/trees/head/packages $D/; find $D -name target -type d -prune -exec rm -rf {} +
[ $id != head ] && python3 $R/probe/mutants_r3.py $D $id > $L 2>&1
docker run --rm --init --network host --cpus=2 --memory=6g -v /root/.m2/repository:/m2home:ro -v /root/.m2/settings.xml:/settings.xml:ro \
  -v $R:$R -v /etc/machine-id:/etc/machine-id:ro -w $D/packages/sdk-java/managed-agent-server maven:3.9.11-eclipse-temurin-21 \
  mvn --batch-mode --no-transfer-progress -s /settings.xml -Dmaven.repo.local=$R/m2/rc-$id -Dmaven.repo.local.tail=$R/m2/head,/m2home \
  -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -DargLine=-Xmx3g -Dtest=$t test >> $L 2>&1
echo EXIT=$? >> $L; rm -rf $D $R/m2/rc-$id
