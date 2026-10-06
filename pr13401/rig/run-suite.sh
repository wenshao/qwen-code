#!/bin/bash
# Usage: run-suite.sh <worktree> <m2-name> <log-tag> [extra mvn args...]
S=$SCRATCH
WT=$1; M2N=$2; TAG=$3; shift 3
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH
M2=$S/m2/$M2N; [ -d $M2 ] || cp -Rc $S/m2/seed $M2
for m in qwencode runtime-broker; do
  LOG=$S/logs/$TAG-$m.log
  t0=$(date +%s)
  (cd $WT/packages/sdk-java/$m && mvn -B -o -Dmaven.repo.local=$M2 -Dgpg.skip "$@" clean test > $LOG 2>&1)
  rc=$?; t1=$(date +%s)
  echo "$TAG $m rc=$rc wall=$((t1-t0))s $(grep -a -E '^\[(INFO|ERROR|WARNING)\] Tests run:' $LOG | grep -v ' in ' | tail -2 | tr '\n' ' ')" | tee -a $S/logs/summary.txt
done
