#!/bin/bash
# usage: run-mutant.sh <arm: base|pr> <mutantId|M00-baseline> [lanes override, comma-separated]
# Applies the mutant to wt-mut-<arm>, runs its lanes, restores the tree and
# appends RESULT lines to results/mutants.tsv. Fails closed on a dirty tree.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
ARM=$1; ID=$2; OVERRIDE=$3
[ "$ARM" = base ] || [ "$ARM" = pr ] || { echo "bad arm"; exit 2; }
[ -n "$ID" ] || { echo "no id"; exit 2; }
T=$S/wt-mut-$ARM
OUT=$S/results/mut/$ARM/$ID
rm -rf "$OUT"; mkdir -p "$OUT"
dirty=$(git -C $T status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then echo "DIRTY before $ID: $dirty"; exit 4; fi

if [ "$ID" = M00-baseline ]; then
  LANES=${OVERRIDE:-ts,java,broker}; FILES=""
else
  FILES=$(node $S/mut/apply.mjs $T $ID) || { echo "APPLY FAILED $ID"; git -C $T checkout -- . ; exit 3; }
  LANES=${OVERRIDE:-$(node -e 'import(process.argv[1]).then(m=>console.log(m.MUTANTS.find(x=>x.id===process.argv[2]).lanes.join(",")))' $S/mut/mutants.mjs $ID)}
  git -C $T diff > $OUT/mutant.diff
fi

for LANE in ${LANES//,/ }; do
  case $LANE in
    ts)
      (cd $T/packages/core && npx vitest run src/managed-runtime \
        --exclude '**/managed-session-authority.hook-scale.test.ts' \
        --reporter=json --outputFile=$OUT/ts.json --coverage.enabled=false > $OUT/ts.log 2>&1)
      node $S/mut/summarize-ts.mjs $OUT/ts.json $ARM $ID >> $S/results/mutants.tsv
      ;;
    java)
      D=$T/packages/sdk-java/managed-agent-server
      rm -rf $D/target/surefire-reports
      (cd $D && $S/mvn.sh -o test -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip -Duser.timezone=UTC > $OUT/java.log 2>&1)
      node $S/mut/summarize-java.mjs $D/target/surefire-reports $OUT/java.log $ARM $ID java >> $S/results/mutants.tsv
      cp -R $D/target/surefire-reports $OUT/java-reports 2>/dev/null
      ;;
    broker)
      D=$T/packages/sdk-java/runtime-broker
      rm -rf $D/target/surefire-reports
      (cd $D && $S/mvn.sh -o test -Dtest=ManagedExtensionExecutionContractTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip > $OUT/broker.log 2>&1)
      node $S/mut/summarize-java.mjs $D/target/surefire-reports $OUT/broker.log $ARM $ID broker >> $S/results/mutants.tsv
      ;;
  esac
done

if [ -n "$FILES" ]; then
  (cd $T && git checkout -- $FILES)
fi
dirty=$(git -C $T status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then echo "DIRTY after $ID: $dirty"; exit 5; fi
echo "DONE $ARM $ID"
