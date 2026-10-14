#!/bin/bash
S=$SCRATCH
ARM=$1; TAG=$2; shift 2; M2=$S/m2-${M2ARM:-$ARM}
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
cd $S/wt-$ARM/packages/sdk-java/managed-agent-server
mvn -o -B -ntp -Dmaven.repo.local=$M2 -Dspotbugs.skip=true -Dcheckstyle.skip=true -Dtest=Pr14178GitRaceProbeTest -Dsurefire.failIfNoSpecifiedTests=false "$@" test > $S/logs/git-$TAG-$ARM.log 2>&1
echo "EXIT=$? $TAG $ARM"; grep -E "PROBE|Tests run:|BUILD" $S/logs/git-$TAG-$ARM.log | tail -8
