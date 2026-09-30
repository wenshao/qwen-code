#!/bin/bash
# macOS host: scenarios that compare the rebased PR head (7c54aa78) with its base (main e263741eb), plus the candidate.
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-new"
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
step install; $V "bash svc.sh stop; bash install-new.sh; sudo cp $RIG/server/cand-server.jar /opt/w1a/cand-server.jar; sudo chmod a+r /opt/w1a/cand-server.jar" > $RIG/out/new/install.console 2>&1
for spec in "base:absent:$BS" "head-off:false:$HD" "head-on:true:$HD"; do ARM=${spec%%:*}; rest=${spec#*:}; VER=${rest%%:*}; A=${rest#*:}
  step "S2c $ARM"; $V "bash reset.sh w1n_s2c VERIFIED=$VER $A DURABLE=true && bash svc.sh start && $E ARM=$ARM /opt/qwen/node s2c-replacement-ab.mjs" > $RIG/out/new/s2c-$ARM.console 2>&1
done
for spec in "base:absent:$BS" "head-on:true:$HD"; do ARM=${spec%%:*}; rest=${spec#*:}; VER=${rest%%:*}; A=${rest#*:}
  step "S2c $ARM new-first"; $V "bash reset.sh w1n_s2c VERIFIED=$VER $A DURABLE=true && bash svc.sh start && $E ARM=$ARM ORDER=new-first /opt/qwen/node s2c-replacement-ab.mjs" > $RIG/out/new/s2c-$ARM-new-first.console 2>&1
done
step "S2b head-on"; $V "bash reset.sh w1n_s2b VERIFIED=true $HD DURABLE=false && bash svc.sh start && $E TAG=head-on MAXWAIT=100000 /opt/qwen/node s2b-ephemeral.mjs" > $RIG/out/new/s2b-head-on.console 2>&1
step "S2b base";    $V "bash reset.sh w1n_s2b VERIFIED=absent $BS DURABLE=false && bash svc.sh start && $E TAG=base MAXWAIT=100000 /opt/qwen/node s2b-ephemeral.mjs" > $RIG/out/new/s2b-base.console 2>&1
step "S3 kinds base"; $V "bash reset.sh w1n_s3b VERIFIED=absent $BS DURABLE=true && bash svc.sh start && $E TWO_TITLES=1 ARM=base MODE=kinds /opt/qwen/node s3-coldload.mjs" > $RIG/out/new/s3-kinds-base.console 2>&1
step "S8"; $V "bash reset.sh w1n_s8 VERIFIED=absent $BS DURABLE=true && bash svc.sh start && $E /opt/qwen/node s8-upgrade.mjs" > $RIG/out/new/s8.console 2>&1
step "S2d candidate"; $V "bash reset.sh w1n_s2dc VERIFIED=true JAR=cand-server.jar DIST=dist-head HARNESS=false DURABLE=true && bash svc.sh start && $E MAINT_JAR=/opt/w1a/cand-server.jar /opt/qwen/node s2d-restore-from-backup.mjs" > $RIG/out/new/s2d-cand.console 2>&1
step "S7"; $V "bash reset.sh w1n_s7 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E S7_TURNS='1 10 50 150' S7_SHELL='1 9 40 100' /opt/qwen/node s7-loadcost.mjs" > $RIG/out/new/s7.console 2>&1
step DONE
