#!/bin/bash
set -u
R=/rig/scripts/run-gate2.sh
log(){ echo "PIPE $(date -u +%FT%TZ) $*" | tee -a /rig/results/PIPELINE.txt; }
F='-Dit.test=HostedMonitorRunFaultGatesIT#fg8f*'
log "extra3 start (fresh database per run)"
for i in 1 2 3 4; do DBNAME=fresh_p$i GOALS=verify bash $R FRESH-IFCP-$i /work/probe root no "$F" -Dqwen.fg8f.case=in-flight-cap; done
for i in 1 2 3; do DBNAME=fresh_f$i GOALS=verify bash $R FRESH-IFCF-$i /work/probe root no "$F"; done
log "EXTRA3 DONE"
