#!/bin/bash
# Interleaves ManagedAgentMySqlIT on native MySQL 8.4.7 across new / merge / main.
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/61c44e46-1821-4cde-80cb-61ff1d2e90e3/scratchpad
for rep in 1 2; do
  for arm in new merge main; do
    case $arm in new) T=$S/wt-base; M=$S/mvn.sh;; merge) T=$S/wt-merge; M=$S/mvn-merge.sh;; main) T=$S/wt-main; M=$S/mvn-merge.sh;; esac
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    out=$($S/r2/it-one.sh $T $arm-r$rep 13346 it_${arm}_r${rep}_$$ $M)
    echo "IT $arm rep$rep load=$load $(echo "$out" | awk -F'\t' '/^RESULT/{print $6, $7}') $(echo "$out" | grep hookAdmissionCase)"
  done
done
