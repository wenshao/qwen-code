#!/bin/bash
# usage: matrix.sh <N> <scenario...>
N=$1; shift
cd /root/verify/pr13291
for sc in "$@"; do
 for i in $(seq 1 $N); do
  for cfg in "head:dist-m6sim:0" "old:dist-m6sim:0" "head:dist-mut:1"; do
   IFS=: read arm entry mut <<< "$cfg"
   label=$arm; [ "$mut" = 1 ] && label=head-mut
   out=out/matrix/$sc/$label-$i
   rm -rf $out; mkdir -p $out
   R3_SECOND_OPEN=1 R3_RECLAIM=1 R3_ENTRY_DIR=$entry R3_MUT=$mut timeout 300 node harness/run.mjs $arm $sc $out > $out/driver.log 2>&1
   echo "$sc $label $i exit=$?"
  done
 done
done
echo MATRIX_DONE
