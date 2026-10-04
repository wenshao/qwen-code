#!/bin/bash
cd /root/verify/pr13380
PAT='loses the race to the expiry'
for Q in 5 3 2 1; do for rep in 1 2 3 4; do
  for ARM in armsettle armbase armpr; do
    L=unit/logs2/q$Q-$ARM-$rep.log
    SETTLE_OUT=$PWD/unit/logs2/settle-q$Q.txt ./unit-run.sh $Q $ARM $L "$PAT" 0
    RC=$?
    MSG=$(sed 's/\x1b\[[0-9;]*m//g' $L | grep -m1 -E 'AssertionError|Error:' | sed 's/^ *//')
    DUR=$(sed 's/\x1b\[[0-9;]*m//g' $L | grep -m1 -oE 'loses the race to the expiry as expired [0-9]+ms' | grep -oE '[0-9]+ms')
    echo -e "q=$Q\tarm=$ARM\trep=$rep\trc=$RC\tdur=$DUR\t$MSG" | tee -a unit/ladder2.tsv
  done
done; done
echo LADDER-DONE >> unit/ladder2.tsv
