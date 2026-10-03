#!/bin/bash
# usage: jobMut.sh <mut-worktree-index> <mutant...>
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b5c403f1-14a1-452a-91d4-be31986042f6/scratchpad
IDX=$1; shift
W=~/git/qwen-code-pr13192-mut$IDX
U='ToolPublicationStoreTest,ManagedSessionStoreIntegrationTest,ManagedSessionLifecycleTest,ToolPublicationRetentionStoreTest,WorkspaceSessionCloseTest'
I='ManagedAgentMySqlIT,!ManagedAgentMySqlIT#admitsHookExecutionsWithoutReadingTheirHistoryOnMySql,ToolPublicationRecoveryMySqlIT'
for M in "$@"; do
  node $S/mutants.mjs $W restore >/dev/null
  [ "$M" = M0 ] || node $S/mutants.mjs $W $M > $S/results/mut/$M.apply.txt 2>&1 || { echo "$M APPLY_FAILED" >> $S/results/mut/summary.txt; continue; }
  for lane in ci:UTC:mariadb cst:Asia/Shanghai:mysql; do
    name=${lane%%:*}; rest=${lane#*:}; zone=${rest%%:*}; engine=${rest##*:}
    OUT=$S/results/mut/$M/$name
    $S/run-tests.sh $W $S/m2 $zone $engine "mut_${M}_${name}" "$U" "$I" $OUT
    rc=$(grep -o 'MVN_RC=[0-9]*' $OUT/meta.txt | cut -d= -f2)
    fails=$(grep -E "^\[ERROR\] com\..*(FAILURE|ERROR)!$" $OUT/mvn.log | sed -E 's/.*managedagent\.//; s/ -- Time.*//' | sort -u | tr '\n' ';')
    compile=$(grep -c "COMPILATION ERROR" $OUT/mvn.log)
    echo "$M $name rc=$rc compileErr=$compile fails=$fails" >> $S/results/mut/summary.txt
    if [ $engine = mysql ]; then C=pr13192-mysql; B=mysql; else C=pr13192-mariadb; B=mariadb; fi
    docker --context colima exec $C $B -uroot -ppr13192pw -e "DROP DATABASE IF EXISTS mut_${M}_${name}" 2>/dev/null
  done
  node $S/mutants.mjs $W restore >/dev/null
done
echo "JOB_MUT_$IDX DONE"
