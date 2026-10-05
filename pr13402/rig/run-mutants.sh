#!/bin/bash
# Usage: run-mutants.sh <jdk: 21|25> <mutant>...  (applies each in wt-mut, runs the hub-related test classes)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad
JDK=$1; shift
export JAVA_HOME=~/Install/jdk$JDK PATH=~/Install/jdk$JDK/bin:$PATH TZ=UTC
TESTS=SessionEventHubTest,SessionEventHubPinningTest,ManagedEventStreamServiceTest,ManagedEventReplayTest,Issue13181QueryBudgetTest,ManagedAgentServerIntegrationTest
mkdir -p $S/mut
for M in "$@"; do
  node $S/mutate.mjs $S/wt-mut $M > /dev/null || { echo "$M APPLY-FAIL"; continue; }
  LOG=$S/mut/jdk$JDK-$M.log
  git -C $S/wt-mut diff > $S/mut/$M.diff
  t0=$(date +%s)
  (cd $S/wt-mut/packages/sdk-java && mvn -B -o -Dmaven.repo.local=$S/m2/mut -Dcheckstyle.skip -Dspotbugs.skip -Dgpg.skip -Dsurefire.timeout=420 -Dsurefire.failIfNoSpecifiedTests=false -Dtest=$TESTS -f managed-agent-server/pom.xml test > $LOG 2>&1)
  rc=$?; t1=$(date +%s)
  R=$S/wt-mut/packages/sdk-java/managed-agent-server/target/surefire-reports
  FAILED=$(/usr/bin/grep -l -E '<(failure|error)' $R/TEST-*.xml 2>/dev/null | while read f; do /usr/bin/python3 - "$f" <<'PY' 2>/dev/null
import sys, xml.etree.ElementTree as ET
t = ET.parse(sys.argv[1]).getroot()
for c in t.iter('testcase'):
    if c.find('failure') is not None or c.find('error') is not None:
        print(t.get('name').split('.')[-1] + '#' + c.get('name'))
PY
done | tr '\n' ' ')
  TOT=$(/usr/bin/grep -a -E '^\[(INFO|WARNING|ERROR)\] Tests run: [0-9]+, Failures' $LOG | tail -1 | sed 's/.*Tests run/Tests run/')
  if /usr/bin/grep -q "COMPILATION ERROR" $LOG; then V=COMPILE-ERROR; elif /usr/bin/grep -q "There was a timeout" $LOG; then V=KILLED-TIMEOUT; elif [ $rc -eq 0 ]; then V=SURVIVED; else V=KILLED; fi
  printf '%s\tjdk%s\t%s\t%ss\t%s\t%s\n' "$M" "$JDK" "$V" "$((t1-t0))" "$TOT" "$FAILED" | tee -a $S/mut/results.tsv
done
node $S/mutate.mjs $S/wt-mut NONE > /dev/null
