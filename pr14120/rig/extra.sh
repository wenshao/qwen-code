#!/bin/bash
# queued after pipeline.sh finishes; INSIDE pr14120-lx
set -u
until grep -q "PIPE.*DONE" /rig/results/PIPELINE.txt; do sleep 30; done
R=/rig/scripts/run-gate.sh
log(){ echo "PIPE $(date -u +%FT%TZ) $*" | tee -a /rig/results/PIPELINE.txt; }
E='-Dit.test=HostedMonitorRunFaultGatesIT#fg8e*'
G='-Dit.test=HostedWorkspaceToolTurnIT#disconnectedObservers*'
jm(){ L=$1; M=$2; A=$3; cd /work/mut && node /rig/scripts/mutate2.mjs /work/mut $M >> /rig/results/PIPELINE.txt || return; bash $R $L /work/mut root no "$A"; cd /work/mut && git checkout -- packages && test -z "$(git status --short packages)" || log "RESTORE_FAIL $M"; }
log "extra start"
jm MUT-M3c M3c "$E"
bash $R FG6E-control /work/mut root no "$G"
jm MUT-X1b-FG6E X1b "$G"
jm MUT-X1b-FG8E X1b "$E"
log "EXTRA DONE"
