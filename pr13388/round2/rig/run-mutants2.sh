#!/bin/bash
# Usage: run-mutants.sh <mutant>...   (applies each in wt-mut, runs its module's witness)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/412871d7-f412-4b9c-905e-0d2a8afab8a8/scratchpad
export HEAD_SHA=ebcee311b4b065815c9004b412d2afca54e5fe5f BASE_SHA=5022712321f58ad5705e16c2f5a14126fbae094a
export JAVA_HOME=~/Install/jdk21 PATH=~/Install/jdk21/bin:$PATH TZ=UTC
for M in "$@"; do
  node $S/mutate.mjs $S/wt-mut2 $M > /dev/null || { echo "$M APPLY-FAIL"; continue; }
  if [ "$M" = M1 ]; then MOD=qwencode; T=HarnessEventStreamPinningTest; else MOD=runtime-broker; T=BrokerVirtualThreadPinningTest; fi
  LOG=$S/mutants2/$M.log
  git -C $S/wt-mut2 diff > $S/mutants2/$M.diff
  t0=$(date +%s)
  (cd $S/wt-mut2/packages/sdk-java && mvn -B -o -Dmaven.repo.local=$S/m2/mut2 -Dcheckstyle.skip -Dgpg.skip -Dtest=$T -f $MOD/pom.xml test > $LOG 2>&1)
  rc=$?; t1=$(date +%s)
  if grep -q "COMPILATION ERROR" $LOG; then V=COMPILE-ERROR; elif [ $rc -eq 0 ]; then V=SURVIVED; else V=KILLED; fi
  printf '%s\t%s\t%ss\t%s\n' "$M" "$V" "$((t1-t0))" "$(grep -a -o -E '(virtual threads starved|virtual-thread probe starved|callers never reached)[^]]{0,110}' $LOG | head -1)" | tee -a $S/mutants2/results.tsv
done
node $S/mutate.mjs $S/wt-mut2 NONE > /dev/null
