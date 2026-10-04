#!/bin/bash
# Usage: run-witness.sh <arm> <stream|broker> [tag] [extra mvn args...]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
ARM=$1; W=$2; TAG=${3:-r1}; shift 3 2>/dev/null
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $S/wt-$ARM/packages/sdk-java || exit 2
if [ "$W" = stream ]; then MOD=qwencode; T=HarnessEventStreamPinningTest; else MOD=runtime-broker; T=BrokerVirtualThreadPinningTest; fi
LOG=$S/witness/$ARM-$W-$TAG.log
echo "arm=$ARM witness=$W tag=$TAG dirty=$(git status --porcelain | tr '\n' ' ') extra=$*" > $LOG
t0=$(date +%s)
mvn -B -o -Dmaven.repo.local=$S/m2/$ARM -Dcheckstyle.skip -Dgpg.skip -Dsurefire.failIfNoSpecifiedTests=false -Dtest=$T "$@" -f $MOD/pom.xml test >> $LOG 2>&1
rc=$?; t1=$(date +%s)
echo "exit=$rc wall=$((t1-t0))s" >> $LOG
echo "$ARM $W $TAG exit=$rc wall=$((t1-t0))s | $(grep -a -E 'Tests run:.*in com' $LOG | sed 's/.*Tests run/Tests run/' | head -1) | $(grep -a -o -E '(virtual threads starved|virtual-thread probe starved|callers never reached)[^]]{0,160}' $LOG | head -1)"
