#!/bin/bash
# Package the managed-agent-server jar from wt-jar with an optional production mutant.
# usage: build-jar.sh <label> [mutant id]
set -u
. /Users/wenshao/pr13116-rig/scripts/env.sh
L=$1; MUT=${2:-}; W=$RIG/wt-jar
if [ -n "$MUT" ]; then node $RIG/scripts/mutate.mjs $W $MUT || exit 3; fi
mvn --batch-mode --no-transfer-progress -Dmaven.repo.local=$RIG/m2-main -f $W/$MA/pom.xml -DskipTests clean package > $RIG/logs/jar-$L.log 2>&1; RC=$?
DIFF=$(git -C $W diff -- $MA/src/main | shasum | cut -c1-12)
J=$W/$MA/target/qwen-managed-agent-server-0.1.0-alpha.jar
cp "$J" $RIG/jars/$L.jar
[ -n "$MUT" ] && node $RIG/scripts/mutate.mjs $W restore > /dev/null
echo "RESULT jar $L mutant=${MUT:-none} exit=$RC src-diff-sha=$DIFF jar=$(basename $J) size=$(stat -f %z $RIG/jars/$L.jar) md5=$(md5 -q $RIG/jars/$L.jar | cut -c1-12)"
