#!/bin/bash
# usage: run-mutant.sh <name>  (name=PRISTINE runs the unmodified PR head)
set -u
NAME=$1
BASE=/root/verify/pr13296
DIR=$BASE/mut/work/$NAME
rm -rf "$DIR"; mkdir -p "$DIR"
mkdir -p "$DIR/packages/sdk-java"; rsync -a --exclude target $BASE/wt-pr/packages/sdk-java/managed-agent-server/ "$DIR/packages/sdk-java/managed-agent-server/"
mkdir -p "$DIR/packages/core/src/managed-runtime/contracts" && cp $BASE/wt-pr/packages/core/src/managed-runtime/contracts/managed-tool-result-v1.schema.json "$DIR/packages/core/src/managed-runtime/contracts/"
F="$DIR/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/ToolPublicationCollector.java"
if [ "$NAME" != PRISTINE ]; then python3 $BASE/mut/mutants.py "$NAME" "$F" || { echo "$NAME APPLY_FAILED" >> $BASE/mut/results.txt; exit 1; }; fi
docker run --rm --network host -v /root/.m2:/root/.m2:ro -v $BASE/m2local:/m2local -v /root/Install/maven:/opt/maven:ro \
  -v /etc/machine-id:/etc/machine-id:ro -v "$DIR":"$DIR" -w "$DIR/packages/sdk-java/managed-agent-server" eclipse-temurin:21-jdk \
  /opt/maven/bin/mvn --batch-mode --no-transfer-progress -o -s /root/.m2/settings.xml -Dmaven.repo.local=/m2local \
  -Dmaven.repo.local.tail=/root/.m2/repository -Djacoco.skip=true -Dspotbugs.skip=true -Dcheckstyle.skip=true \
  -Dtest=ToolPublicationCollectorTest,ToolPublicationRetentionStoreTest -Dsurefire.failIfNoSpecifiedTests=false test > "$DIR/mvn.log" 2>&1
RC=$?
SUMMARY=$(grep -E "^\[(INFO|ERROR|WARNING)\] Tests run: [0-9]+, Failures" "$DIR/mvn.log" | tail -1 | sed 's/^\[[A-Z]*\] //')
FAILED=$(grep -E "^\[ERROR\]   (ToolPublication[A-Za-z]+\.[A-Za-z]+)" "$DIR/mvn.log" | sed -E 's/^\[ERROR\]   ([A-Za-z.]+:?[0-9]*)[ :].*/\1/' | sort -u | tr '\n' ' ')
COMPILE=$(grep -c "COMPILATION ERROR" "$DIR/mvn.log")
echo "$NAME rc=$RC compile_errors=$COMPILE | $SUMMARY | failed: $FAILED" >> $BASE/mut/results.txt
