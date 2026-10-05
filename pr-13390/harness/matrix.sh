#!/bin/bash
# arm x scenario matrix; each run is one real CLI process + real MCP server.
cd /root/verify/pr13390
for arm in base head; do
  for spec in "4 40000 codemode-alwaysload" "4 12000 codemode-alwaysload" "4 5000 codemode-alwaysload" "1 40000 codemode-alwaysload" "4 40000 codemode-deferred" "4 40000 direct-alwaysload"; do
    set -- $spec
    name="$arm-k$1-$2-$3"
    MCP_SCALE=$1 timeout 170 node harness/sj-drive.mjs $arm runs/$name $2 $3 > runs/$name.out 2>&1
    echo "$name EXIT=$?"
  done
done
echo MATRIX_DONE
