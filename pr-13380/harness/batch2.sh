#!/bin/bash
cd /root/verify/pr13380
until [ -f runs/BATCH1-DONE ]; do sleep 5; done
for a in a1-main a2-pr; do ./run-it.sh $a.inst.ts worker-stop renew-before-expiry rbe-$a; done
for i in 1 2; do ./run-it.sh a2-pr.ts all - full-pr-$i; done
echo done > runs/BATCH2-DONE
