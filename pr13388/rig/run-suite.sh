#!/bin/bash
# Usage: run-suite.sh <arm> <qwencode|runtime-broker>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
ARM=$1; MOD=$2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $S/wt-$ARM/packages/sdk-java || exit 2
LOG=$S/suites/$ARM-$MOD.log
echo "arm=$ARM mod=$MOD dirty=$(git status --porcelain | tr '\n' ' ')" > $LOG
t0=$(date +%s)
mvn -B -o -Dmaven.repo.local=$S/m2/$ARM -Dgpg.skip -f $MOD/pom.xml test checkstyle:check >> $LOG 2>&1
rc=$?; t1=$(date +%s)
echo "exit=$rc wall=$((t1-t0))s" >> $LOG
echo "$ARM $MOD exit=$rc wall=$((t1-t0))s | $(grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $LOG | tail -1) | $(grep -a -o 'You have [0-9]* Checkstyle violations' $LOG | tail -1)"
