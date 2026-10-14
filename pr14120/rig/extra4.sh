#!/bin/bash
set -u
R=/rig/scripts/run-gate2.sh
log(){ echo "PIPE $(date -u +%FT%TZ) $*" | tee -a /rig/results/PIPELINE.txt; }
F='-Dit.test=HostedMonitorRunFaultGatesIT#fg8f*'
log "extra4 start: M4 on fresh databases"
cd /work/mut && node /rig/scripts/mutate.mjs /work/mut M4 >> /rig/results/PIPELINE.txt && npm run bundle > /rig/results/mut-build-M4-fresh.log 2>&1 || { log "BUILD_FAIL M4-fresh"; exit 1; }
grep -c "MANAGED_BACKGROUND_OUTPUT_RESUME_BYTES=0" $(grep -rl applyPause /work/mut/dist/chunks | head -1) >> /rig/results/PIPELINE.txt
for i in 1 2; do DBNAME=fresh_m4_$i GOALS=verify bash $R FRESH-M4-$i /work/mut root no "$F" -Dqwen.fg8f.case=in-flight-cap; done
cd /work/mut && git checkout -- packages && rm -rf dist && cp -a /work/mut-dist.orig dist && test -z "$(git status --short packages)" && log "restored" || log "RESTORE_FAIL M4-fresh"
log "EXTRA4 DONE"
