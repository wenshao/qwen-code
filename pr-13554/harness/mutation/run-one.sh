#!/bin/bash
# usage: run-one.sh <ID|CONTROL> [offline]
ID=$1; R=/root/pr13554-mut; D=$R/work/$ID; rm -rf $D; mkdir -p $R/work $R/logs; cp -r $R/tree $D
MOD=$D/packages/sdk-java/managed-agent-server
if [ "$ID" != CONTROL ]; then for f in $R/mutants/$ID/*.java; do b=$(basename $f); t=$MOD/src/main/java/com/alibaba/qwen/code/managedagent/store/$b; rm -f $t; cp $f $t; done; fi
OFF=""; [ "$2" = offline ] && OFF="-o"
docker run --rm --name pr13554-mut-$ID --cpus=3 --memory=3g -v $D:/w -v $R:/rig -v /root/.m2/repository:/m2home:ro -v /etc/machine-id:/etc/machine-id:ro -w /w/packages/sdk-java/managed-agent-server maven:3.9.11-eclipse-temurin-21 \
  mvn -B $OFF -s /rig/settings.xml -Dmaven.repo.local=/rig/m2dl -Dmaven.repo.local.tail=/rig/m2local,/m2home -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=SessionResourceCollectionCollectorTest -Dsurefire.failIfNoSpecifiedTests=false test > $R/logs/$ID.log 2>&1
echo "$ID exit=$?" >> $R/logs/$ID.log
rm -rf $D
