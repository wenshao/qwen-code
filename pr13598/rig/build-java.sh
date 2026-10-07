#!/bin/bash
# usage: build-java.sh <arm> <worktree>  — Java-only build (TS dist reused from head)
set -uo pipefail
ARM=$1; WT=$2; RIG=/Users/wenshao/git/pr13598-rig
LOG=$RIG/build-$ARM.log
exec > "$LOG" 2>&1
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:/Users/wenshao/Install/maven/bin:$PATH
M2=$RIG/m2-head
cd "$WT" || exit 9
(cd packages/sdk-java/qwencode && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip -Dspotless.check.skip=true -Dgpg.skip -Dmaven.javadoc.skip=true -Dmaven.source.skip=true install) || { echo "JAVAFAIL qwencode"; exit 2; }
(cd packages/sdk-java/managed-agent-server && mvn -B -q -o -Dmaven.repo.local=$M2 -DskipTests -Dcheckstyle.skip clean package) || { echo JAVAFAIL server; exit 3; }
ls -la packages/sdk-java/managed-agent-server/target/*.jar
echo "BUILD-DONE $(date +%T)"
