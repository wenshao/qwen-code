#!/bin/bash
# usage: run-arm.sh <arm> [out-suffix]
set -u
ARM=$1; SUF=${2:-}
ln -sfn /root/verify/pr12134/arms/$ARM /root/verify/pr12134/head/dist/web-shell
served=$(curl -s --noproxy '*' http://127.0.0.1:4234/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
echo "arm=$ARM served=$served"
cd /root/verify/pr12134/harness
ARM=$ARM OUT=/root/verify/pr12134/results/$ARM$SUF NODE_PATH=/root/verify/pr12134/head/node_modules timeout 900 node drive.cjs parked follow collapse
