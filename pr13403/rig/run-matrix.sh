#!/bin/bash
# Usage: run-matrix.sh <config-name>...  (sequential, one fresh Spring JVM + Harness per config)
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/594cd89e-25a1-4d3d-a569-2769a54ddb61/scratchpad
cd $S/rig
for c in "$@"; do
  echo "START $c $(date -u +%H:%M:%S) load=$(sysctl -n vm.loadavg)" >> $S/matrix.txt
  node burst.mjs configs/$c.json > $S/runs-$c.out 2>&1
  grep -h '^RESULT\|ROUND' $S/runs-$c.out | sed "s/^/[$c] /" | cut -c1-3000 >> $S/matrix.txt
  echo "END $c $(date -u +%H:%M:%S)" >> $S/matrix.txt
done
echo "MATRIX-DONE $*" >> $S/matrix.txt
