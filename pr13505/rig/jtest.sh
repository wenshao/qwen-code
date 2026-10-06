#!/bin/bash
# VERIFICATION RIG ONLY (PR #13505). usage: jtest.sh <label> <worktree> <tests>
set -u
RIG=/Users/wenshao/git/pr13505-rig; L=$1; W=$2; T=$3
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
cd $W/packages/sdk-java/managed-agent-server
TZ=UTC mvn -B -ntp -o -Dmaven.repo.local=$RIG/m2 -Dcheckstyle.skip -Dspotbugs.skip "-Dtest=$T" -Dsurefire.failIfNoSpecifiedTests=false test > $RIG/logs/jtest-$L.log 2>&1
code=$?
printf 'JTEST\t%s\texit=%s\t%s\n' "$L" "$code" "$(grep -E 'Tests run: [0-9]+, Failures: [0-9]+, Errors: [0-9]+, Skipped: [0-9]+$' $RIG/logs/jtest-$L.log | tail -1)" | tee -a $RIG/results/jtest.tsv
grep -E "FAIL|expected|Expecting|but was" $RIG/logs/jtest-$L.log | head -6
