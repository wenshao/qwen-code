#!/bin/bash
# VERIFICATION RIG ONLY: round-7 WebShell + real-model runs on the head arm (clean DB, one storage per scenario).
R=/Users/wenshao/pr13163-rig; N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
DB=h11u; mkdir -p $R/out/$DB; L=$R/out/$DB/ui-n11.log; : > $L
bash $R/stop.sh $DB all >> $L 2>&1; sleep 1
bash $R/start9.sh $DB n11 n11 2>&1 | tail -1 >> $L
echo "### c17 head en" >> $L; bash $R/ui9.sh $DB n11 n11 head ws-u11 d en >> $L 2>&1
bash $R/stop.sh $DB all >> $L 2>&1; sleep 1
bash $R/aux.sh $DB >/dev/null 2>&1; bash $R/real-harness.sh $DB n11 2>&1 | tail -1 | sed 's/sk-[A-Za-z0-9]*/<redacted>/g' >> $L
DIST=n11 bash $R/spring.sh n11 $DB absent absent 2>&1 | tail -1 >> $L
cd $R/probe
for i in 11:b 12:c 13:e; do echo "### c15 real ${i%%:*}" >> $L; DB=$DB $N c15-real-ui-cancel.mjs ws-r${i%%:*} ${i#*:} en >> $L 2>&1; done
bash $R/stop.sh $DB all >> $L 2>&1
echo "UI11-DONE $(date -u +%T)" >> $L
