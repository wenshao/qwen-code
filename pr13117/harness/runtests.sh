#!/bin/bash
# VERIFICATION RIG ONLY (PR #13117): run named test classes in a worktree and summarize surefire.
# usage: runtests.sh <worktree> <m2-label> <run-label> <comma-separated test classes>
RIG=/Users/wenshao/pr13117-rig; WT=$RIG/$1; M2=$RIG/m2-$2; L=$3; T=$4
export JAVA_HOME=/Users/wenshao/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH TZ=UTC
MOD=$WT/packages/sdk-java/managed-agent-server; O=$RIG/out/tests/$L; rm -rf $O; mkdir -p $O
S=$(date +%s)
(cd $MOD && rm -rf target/surefire-reports && mvn -B -ntp -o -Dmaven.repo.local=$M2 -Dcheckstyle.skip=true -Dtest="$T" -Dsurefire.failIfNoSpecifiedTests=false test > $O/mvn.log 2>&1); RC=$?
cp -R $MOD/target/surefire-reports $O/ 2>/dev/null
SUM=$(grep -h "^Tests run:" $O/surefire-reports/*.txt 2>/dev/null | awk -F'[:,]' '{r+=$2;f+=$4;e+=$6;s+=$8} END{printf "run=%d fail=%d err=%d skip=%d",r,f,e,s}')
[ -z "$SUM" ] && SUM="NO-SUREFIRE-REPORTS"
FIRST=$(grep -h -A2 "<<< FAIL\|<<< ERROR" $O/surefire-reports/*.txt 2>/dev/null | grep -v "^--$" | head -6 | cut -c1-260 | tr '\n' ' ')
echo "RESULT $L rc=$RC $SUM secs=$(( $(date +%s)-S )) :: $FIRST" | tee $O/RESULT
