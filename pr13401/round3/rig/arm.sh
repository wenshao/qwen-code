#!/bin/bash
# Usage: arm.sh <tag> <worktree>  -> qwencode verify + broker test + checkstyle, then managed-agent-server verify+checkstyle (no MySQL profile)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ce3ef24d-3ca1-4a59-829e-edeff297be66/scratchpad
TAG=$1; WT=$2; export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
M2=$S/m2/r3-$TAG; [ -d $M2 ] || cp -Rc $S/m2/seed $M2
O=(-B -o -Dmaven.repo.local=$M2 -Dgpg.skip=true)
run() { # name dir args...
  local name=$1 dir=$2; shift 2; local LOG=$S/r3/$TAG-$name.log t0=$(date +%s)
  (cd $WT/packages/sdk-java/$dir && mvn "${O[@]}" "$@" > $LOG 2>&1); local rc=$?
  echo "$TAG $name rc=$rc wall=$(( $(date +%s)-t0 ))s $(grep -a -E '^\[(INFO|ERROR|WARNING)\] Tests run:' $LOG | grep -v ' in ' | tail -1) $(grep -a -o -E 'You have [0-9]+ Checkstyle violations?|BUILD (SUCCESS|FAILURE)' $LOG | sort -u | tr '\n' ' ')" | tee -a $S/r3/summary.txt
}
run qwencode qwencode clean verify checkstyle:check
run broker runtime-broker clean test checkstyle:check
run install-q qwencode -DskipTests -Dmaven.javadoc.skip=true install
run install-b runtime-broker -DskipTests -Dspotbugs.skip=true install
run managed managed-agent-server clean verify checkstyle:check
echo "$TAG ARM-DONE" >> $S/r3/summary.txt
