#!/bin/bash
cd /root/verify/pr13380
until [ -f runs/BATCH3-DONE ]; do sleep 5; done
for a in a1-main a2-pr; do ./run-it.sh $a.inst.ts worker-stop renew-before-expiry rbe2-$a; done
echo done > runs/BATCH4-DONE
