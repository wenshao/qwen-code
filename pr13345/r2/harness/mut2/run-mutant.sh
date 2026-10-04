#!/bin/bash
# usage: run-mutant.sh <arm: old|new> <mutantId|M00-full|M00-witness>
# Round 2 runner. Part A ("A-*") mutants run the TS lane over the witness
# files only; everything else over all of src/managed-runtime. Applies the
# mutant to the arm's tree, runs its lanes, restores, and appends RESULT
# lines to r2/results/mutants.tsv. Fails closed on a dirty tree.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
source $S/env22.sh
export MUTANTS_FILE=$S/mut2/mutants.mjs
ARM=$1; ID=$2
case $ARM in old) T=$S/wt-mut-pr;; new) T=$S/wt-mut-base;; *) echo "bad arm"; exit 2;; esac
[ -n "$ID" ] || { echo "no id"; exit 2; }
WITNESS="src/managed-runtime/managed-extension-record.test.ts src/managed-runtime/managed-session-authority.extension.test.ts src/managed-runtime/managed-extension-projection.test.ts src/managed-runtime/managed-session-store-contract.test.ts src/managed-runtime/http-managed-session-store.test.ts src/managed-runtime/managed-operation-grant-gate.test.ts src/managed-runtime/managed-session-storage.test.ts"
OUT=$S/r2/mut/$ARM/$ID
rm -rf "$OUT"; mkdir -p "$OUT"
dirty=$(git -C $T status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then echo "DIRTY before $ID: $dirty"; exit 4; fi

FILES=""
case $ID in
  M00-full) LANES=ts,java,broker; SCOPE=full;;
  M00-witness) LANES=ts; SCOPE=witness;;
  *)
    FILES=$(node $S/mut2/apply.mjs $T $ID $ARM) || { echo "APPLY FAILED $ID"; (cd $T && git checkout -- .); exit 3; }
    LANES=$(node -e 'import(process.env.MUTANTS_FILE).then(m=>console.log(m.MUTANTS.find(x=>x.id===process.argv[1]).lanes.join(",")))' $ID)
    case $ID in A-*) SCOPE=witness;; *) SCOPE=full;; esac
    git -C $T diff > $OUT/mutant.diff
    ;;
esac

for LANE in ${LANES//,/ }; do
  case $LANE in
    ts)
      if [ $SCOPE = witness ]; then TS_ARGS="$WITNESS"; else TS_ARGS="src/managed-runtime --exclude **/managed-session-authority.hook-scale.test.ts"; fi
      set -f
      (cd $T/packages/core && npx vitest run $TS_ARGS \
        --reporter=json --outputFile=$OUT/ts.json --coverage.enabled=false > $OUT/ts.log 2>&1)
      set +f
      node $S/mut2/summarize-ts.mjs $OUT/ts.json $ARM $ID | sed "s/\tts\t/\tts-$SCOPE\t/" >> $S/r2/results/mutants.tsv
      ;;
    java)
      D=$T/packages/sdk-java/managed-agent-server
      rm -rf $D/target/surefire-reports
      (cd $D && $S/mvn.sh -o test -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip -Duser.timezone=UTC > $OUT/java.log 2>&1)
      node $S/mut2/summarize-java.mjs $D/target/surefire-reports $OUT/java.log $ARM $ID java >> $S/r2/results/mutants.tsv
      ;;
    broker)
      D=$T/packages/sdk-java/runtime-broker
      rm -rf $D/target/surefire-reports
      (cd $D && $S/mvn.sh -o test -Dtest=ManagedExtensionExecutionContractTest -Dsurefire.failIfNoSpecifiedTests=false -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip > $OUT/broker.log 2>&1)
      node $S/mut2/summarize-java.mjs $D/target/surefire-reports $OUT/broker.log $ARM $ID broker >> $S/r2/results/mutants.tsv
      ;;
  esac
done

if [ -n "$FILES" ]; then
  (cd $T && git checkout -- $FILES)
fi
dirty=$(git -C $T status --porcelain --untracked-files=no)
if [ -n "$dirty" ]; then echo "DIRTY after $ID: $dirty"; exit 5; fi
echo "DONE $ARM $ID"
