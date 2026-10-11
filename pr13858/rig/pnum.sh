#!/bin/bash
DB=${1:-f1}; ARMTAG=${2:-q}
cd /Users/wenshao/git/pr13858-rig
for batch in "n01 n02 n03 n04" "n05 n06 n07 n08" "n09 n10 n11 n12" "n13 n14 n15 n16" "str"; do
  for n in $batch; do (bash run1.sh $DB wffg $ARMTAG$n $n 45 > runs/num/$DB-$n.out 2>&1) & done; wait
done
for n in n01 n02 n03 n04 n05 n06 n07 n08 n09 n10 n11 n12 n13 n14 n15 n16 str; do
  f=runs/num/$DB-$n.out; P=$(sed -n 's/.*parent \([0-9a-f-]*\)$/\1/p' $f | head -1)
  st=$(grep 'final:' $f | sed 's/.*final: //'); ct=$(grep 'turn    child' $f | awk '{print $3, $4}' | head -1)
  res=$(python3 toolres.py $DB $P | head -1 | cut -c1-170)
  echo "$n | parent=$st | child=$ct | $res"
done
