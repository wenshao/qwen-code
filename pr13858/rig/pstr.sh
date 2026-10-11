#!/bin/bash
DB=${1:-f1}; T=${2:-z}; shift 2; LIST="$@"
cd /Users/wenshao/git/pr13858-rig; mkdir -p runs/str
i=0; for n in $LIST; do (bash run1.sh $DB wffg $T$i$n $n 30 > runs/str/$DB-$n.out 2>&1) & i=$((i+1)); if (( i % 4 == 0 )); then wait; fi; done; wait
for n in $LIST; do f=runs/str/$DB-$n.out; P=$(sed -n 's/.*parent \([0-9a-f-]*\)$/\1/p' $f | head -1)
  st=$(grep 'final:' $f | sed 's/.*final: //'); ct=$(grep 'turn    child' $f | awk '{print $3, $4}' | head -1)
  echo "$n | parent=$st | child=$ct | $(python3 toolres.py $DB $P | head -1 | cut -c1-150)"; done
