#!/bin/bash
# usage: run-probes-r3.sh <arm>   (arm = head|main|merge; repo = ~/git/qwen-code-pr13297-<arm>)
set -u
arm=$1; repo=/Users/wenshao/git/qwen-code-pr13297-$arm; R=$HOME/pr13297-rig; O=$R/runs/r3
export JAVA_HOME=$HOME/Install/jdk21; export PATH=$JAVA_HOME/bin:$PATH
mkdir -p $O
echo "### $arm $(git -C $repo rev-parse --short HEAD) $(date -u +%FT%TZ)"
# R2-2 close(): orchestrated so the orphan check runs after the caller exits
bash $R/activator/close-orchestrate.sh r3-$arm-a $repo > $O/act-$arm-close-1.txt 2>&1; cp $R/activator/runs/r3-$arm-a-close.log $O/act-$arm-close-1.log 2>/dev/null
bash $R/activator/close-orchestrate.sh r3-$arm-b $repo > $O/act-$arm-close-2.txt 2>&1; cp $R/activator/runs/r3-$arm-b-close.log $O/act-$arm-close-2.log 2>/dev/null
node $R/activator/probe.mjs $repo slot > $O/act-$arm-slot.log 2>&1
node $R/activator/probe.mjs $repo env > $O/act-$arm-env.log 2>&1
# R1-1 cold start
node $R/remote/probe.mjs $repo > $O/remote-$arm.log 2>&1
# R2-3 observe with a real worker killed -9
ws=$R/ws-obs-$arm; rm -rf $ws; mkdir -p $ws
java -cp "$(cat $R/java/cp-${arm}3.txt)" com.alibaba.qwen.code.runtimebroker.Pr13297Rig observe $repo/packages/cli/dist/index.js $ws > $O/observe-$arm.log 2>&1
# session-store guard parity
node $R/storeguard/diff.mjs $repo > $O/storeguard-$arm.log 2>&1
for f in $O/act-$arm-close-1.txt $O/act-$arm-close-2.txt $O/act-$arm-slot.log $O/act-$arm-env.log $O/remote-$arm.log $O/observe-$arm.log; do echo "--- $(basename $f)"; grep -h "RESULT\|^[a-z_0-9]* = " $f | head -40; done
echo "--- storeguard"; grep -c DIFFERS $O/storeguard-$arm.log; grep "disagreements" $O/storeguard-$arm.log
