#!/bin/bash
# usage: build-java.sh <worktree> <logfile>
set -u
WT=$1; LOG=$2; SP=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/fa427b97-be17-4fef-8cd0-0e8d0787846e/scratchpad
export JAVA_HOME=/Users/wenshao/Install/jdk21
export PATH=$JAVA_HOME/bin:/Users/wenshao/Install/maven/bin:$PATH
M="mvn -o -B --no-transfer-progress -s /Users/wenshao/git/pr13263-rig/empty-settings.xml -Dmaven.repo.local=$SP/m2"
{
java -version 2>&1 | head -1
$M -f $WT/packages/sdk-java/qwencode/pom.xml -DskipTests -Dgpg.skip=true -Dmaven.javadoc.skip=true install && \
$M -f $WT/packages/sdk-java/runtime-broker/pom.xml -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip install && \
$M -f $WT/packages/sdk-java/managed-agent-server/pom.xml -DskipTests -Dspotbugs.skip=true -Dcheckstyle.skip clean package
echo "EXIT=$?"
} > $LOG 2>&1
