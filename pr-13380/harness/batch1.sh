#!/bin/bash
cd /root/verify/pr13380
run() { ./run-it.sh "$@"; }
for a in a0-pre13385 a1-main a2-pr; do run $a.inst.ts worker-stop renew-after-expiry s2-$a; done
for a in a0-pre13385 a1-main a2-pr; do run $a.inst.ts worker-stop renew-after-acquire s1-$a; done
for a in a0-pre13385 a1-main a2-pr; do run $a.inst.ts harness-result commit-after-acquire s3-$a; done
for a in a1-main a2-pr a2-mut-noidentity; do run $a.inst.ts worker-stop current-renew-expired n1-$a; done
for a in a1-main a2-pr a2-mut-noidentity; do run $a.inst.ts worker-stop live-renew-expired n2-$a; done
echo BATCH1-DONE > runs/BATCH1-DONE
