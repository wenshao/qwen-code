#!/bin/bash
# Usage: run-flake.sh <arm> <iterations>  — repeats HarnessCoordinatorTest#runningOwnerObservesCancellationAfterStreamingStarts
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
ARM=$1; N=$2
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
cd $S/wt-$ARM/packages/sdk-java || exit 2
fail=0
for i in $(seq 1 $N); do
  LOG=$S/flake/$ARM-$i.log
  mvn -B -o -q -Dmaven.repo.local=$S/m2/$ARM -Dcheckstyle.skip -Dgpg.skip -Dspotbugs.skip -Djacoco.skip=true \
    "-Dtest=HarnessCoordinatorTest#runningOwnerObservesCancellationAfterStreamingStarts" -Dsurefire.failIfNoSpecifiedTests=false \
    -f managed-agent-server/pom.xml test > $LOG 2>&1 || { fail=$((fail+1)); echo "$ARM iter $i FAIL: $(/usr/bin/grep -a -m1 -E 'TooManyActualInvocations|Wanted|AssertionFailed|expected' $LOG | cut -c1-120)"; }
done
echo "$ARM: $fail/$N iterations failed ($(cat $S/flake/$ARM-*.log | /usr/bin/grep -a -c 'Tests run: 4, Failures: 0') clean method runs of 4 params)"
