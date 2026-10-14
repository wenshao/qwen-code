#!/bin/bash
# runs INSIDE pr14120-lx on .75; strictly sequential, nothing else runs alongside
set -u
R=/rig/scripts/run-gate.sh
log(){ echo "PIPE $(date -u +%FT%TZ) $*" | tee -a /rig/results/PIPELINE.txt; }
E='-Dit.test=HostedMonitorRunFaultGatesIT#fg8e*'
F='-Dit.test=HostedMonitorRunFaultGatesIT#fg8f*'
ts_build(){ # $1=core|cli
  cd /work/mut
  if [ "$1" = core ]; then (cd packages/core && npm run build) > /rig/results/mut-build-$M.log 2>&1 || { log "BUILD_FAIL core $M"; return 1; }; fi
  npm run bundle >> /rig/results/mut-build-$M.log 2>&1 || { log "BUILD_FAIL bundle $M"; return 1; }
}
ts_restore(){ cd /work/mut && git checkout -- packages && rm -rf dist packages/core/dist && cp -a /work/mut-dist.orig dist && cp -a /work/mut-core-dist.orig packages/core/dist && test -z "$(git status --short packages)"; }
java_mut(){ M=$1; cd /work/mut && node /rig/scripts/mutate.mjs /work/mut $M >> /rig/results/PIPELINE.txt || return; bash $R MUT-$M /work/mut root no "$E"; cd /work/mut && git checkout -- packages && test -z "$(git status --short packages)" || log "RESTORE_FAIL $M"; }
ts_mut(){ M=$1; KIND=$2; node /rig/scripts/mutate.mjs /work/mut $M >> /rig/results/PIPELINE.txt || return; ts_build $KIND && bash $R MUT-$M /work/mut root no "$F"; ts_restore || log "RESTORE_FAIL $M"; }

log "phase1 essentials"
bash $R A1-root-1 /work/head root no
bash $R A2-ci-shape /work/ci ci no
bash $R A3-ci-fix-1 /work/ci cifix no
bash $R P-probe-1 /work/probe root no
log "phase2 mutants"
for M in M1 M3a M3b X1; do java_mut $M; done
ts_mut M4 cli; ts_mut X2 cli; ts_mut M5 core; ts_mut X8 core; ts_mut M6 core
log "phase3 control after mutants (restored mut tree must be green)"
bash $R MUT-restored /work/mut root no
log "phase4 repeats"
bash $R A1-root-2 /work/head root no
bash $R A3-ci-fix-2 /work/ci cifix no
bash $R P-probe-2 /work/probe root no
for i in 1 2 3 4 5; do GOALS=verify bash $R IFC-$i /work/head root no "$F" -Dqwen.fg8f.case=in-flight-cap; done
bash $R A1-root-3 /work/head root no
log "DONE"
