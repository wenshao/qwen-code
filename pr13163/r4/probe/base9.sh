#!/bin/bash
R=/Users/wenshao/pr13163-rig; DB=b9; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
L=$R/out/b9/base9.log; mkdir -p $R/out/b9; : > $L
bash $R/batch-n4.sh b9 b9 quick
cd $R/probe
echo "### f4b" >> $L; DB=b9 $N f4b-sql-state.mjs ws-f4b e >> $L 2>&1
echo "### c16 regen (base has no page-twin binding guard either?)" >> $L; DB=b9 $N c16-page-caps.mjs ws-p1 a ws-p0 b regen >> $L 2>&1
echo "### c14 revoke" >> $L
DB=b9 $N c14-cold-cache.mjs start ws-krevoke a revoke >> $L 2>&1
bash $R/stop.sh b9 spring >> $L 2>&1; SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false" DIST=b9 bash $R/spring.sh b9 b9 absent absent | tail -1 >> $L
DB=b9 $N c14-cold-cache.mjs cancel ws-krevoke a revoke >> $L 2>&1
echo "### w1 long revoke-drain" >> $L; OBSERVE_MS=80000 bash $R/w1.sh b9 b9 b9 ws-wl1 d revoke-drain restart >> $L 2>&1
echo "### w1 none restart" >> $L; bash $R/w1.sh b9 b9 b9 ws-wnone b none restart >> $L 2>&1
echo "BASE9-DONE $(date -u +%T)" >> $L
