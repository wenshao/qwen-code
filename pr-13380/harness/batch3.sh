#!/bin/bash
cd /root/verify/pr13380
until [ -f runs/BATCH2-DONE ] && grep -q EXIT= m-mvn.log 2>/dev/null; do sleep 5; done
grep -q 'EXIT=0' m-bundle.log && grep -q 'EXIT=0' m-mvn.log || { echo "merged build failed" > runs/BATCH3-DONE; exit 1; }
export WT=/root/verify/pr13380/merged M2=/root/verify/pr13380/m2-merged
./run-it.sh a2-pr.ts all - merged-full-1
for a in a1-main a2-pr; do ./run-it.sh $a.inst.ts worker-stop renew-after-expiry merged-s2-$a; done
echo done > runs/BATCH3-DONE
