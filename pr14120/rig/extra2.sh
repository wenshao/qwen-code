#!/bin/bash
set -u
until grep -q "EXTRA DONE" /rig/results/PIPELINE.txt; do sleep 30; done
R=/rig/scripts/run-gate.sh
log(){ echo "PIPE $(date -u +%FT%TZ) $*" | tee -a /rig/results/PIPELINE.txt; }
F='-Dit.test=HostedMonitorRunFaultGatesIT#fg8f*'
node /rig/scripts/patch-ifc.mjs /work/probe >> /rig/results/PIPELINE.txt
log "extra2 start"
for i in 1 2 3 4 5 6 7 8; do GOALS=verify bash $R IFCP-$i /work/probe root no "$F" -Dqwen.fg8f.case=in-flight-cap; done
for i in 1 2 3; do GOALS=verify bash $R IFCF-$i /work/probe root no "$F"; done
log "EXTRA2 DONE"
