#!/bin/bash
# macOS host: scenarios on PR head c21efbdfa1 (base arm = main 3a8fd11711, its merge base). Logs: out/r3/*.console, out/e2e-r3/*.log
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-r3"; C=$RIG/out/r3
HD="JAR=head-server.jar DIST=dist-head HARNESS=false PUB=0"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false PUB=0"
step() { echo "=== $(date +%T) $1"; }
for s in "$@"; do case $s in
S13) step S13; $V "bash s13-mounts.sh down; bash reset.sh w1r_s13 VERIFIED=true $HD DURABLE=true && bash s13-mounts.sh up && bash svc.sh start && $E /opt/qwen/node s13-birth.mjs; bash svc.sh stop; bash s13-mounts.sh down" > $C/s13.console 2>&1 ;;
S1)  step S1;  $V "bash reset.sh w1r_s1 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s1-rollout.mjs" > $C/s1.console 2>&1 ;;
S2)  step S2;  $V "bash reset.sh w1r_s2 VERIFIED=true $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s2-identity.mjs" > $C/s2-head-on.console 2>&1 ;;
S2d) step S2d; $V "bash reset.sh w1r_s2d VERIFIED=true $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s2d-restore-from-backup.mjs" > $C/s2d.console 2>&1 ;;
S3k) step S3k; $V "bash reset.sh w1r_s3 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E TWO_TITLES=1 ARM=head MODE=kinds /opt/qwen/node s3-coldload.mjs" > $C/s3-kinds-head.console 2>&1 ;;
S3s) step S3s; $V "bash reset.sh w1r_s3 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E TWO_TITLES=1 ARM=head MODE=sweep /opt/qwen/node s3-coldload.mjs" > $C/s3-sweep-head.console 2>&1 ;;
S3b) step "S3 kinds base"; $V "bash reset.sh w1r_s3b VERIFIED=absent $BS DURABLE=true && bash svc.sh start && $E TWO_TITLES=1 ARM=base MODE=kinds /opt/qwen/node s3-coldload.mjs" > $C/s3-kinds-base.console 2>&1 ;;
S6)  step S6;  $V "$E bash s6-run.sh w1r_s6 true" > $C/s6.console 2>&1 ;;
S9)  step S9;  $V "bash reset.sh w1r_s9 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s9-approvals.mjs && $E /opt/qwen/node s9b-approvals-followup.mjs" > $C/s9.console 2>&1 ;;
S12) step S12; $V "bash reset.sh w1r_s12 VERIFIED=true $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s12-enforcement-points.mjs" > $C/s12.console 2>&1 ;;
S5)  step S5;  $V "bash reset.sh w1r_s5 VERIFIED=true $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s5-marker-vs-agent.mjs" > $C/s5.console 2>&1 ;;
S5b) step S5b; $V "bash reset.sh w1r_s5b VERIFIED=true $HD DURABLE=true && bash svc.sh start && $E /opt/qwen/node s5b-layout.mjs" > $C/s5b.console 2>&1 ;;
S2c) for spec in "base:absent:$BS" "head-on:true:$HD"; do ARM=${spec%%:*}; rest=${spec#*:}; VER=${rest%%:*}; A=${rest#*:}
       step "S2c $ARM new-first"; $V "bash reset.sh w1r_s2c VERIFIED=$VER $A DURABLE=true && bash svc.sh start && $E ARM=$ARM ORDER=new-first /opt/qwen/node s2c-replacement-ab.mjs" > $C/s2c-$ARM-new-first.console 2>&1
     done ;;
S8)  step S8;  $V "bash reset.sh w1r_s8 VERIFIED=absent $BS DURABLE=true && bash svc.sh start && $E /opt/qwen/node s8-upgrade.mjs" > $C/s8.console 2>&1 ;;
S7)  step S7;  $V "bash reset.sh w1r_s7 VERIFIED=false $HD DURABLE=true && bash svc.sh start && $E S7_TURNS='1 10 50 150 400' S7_SHELL='1 9 40' /opt/qwen/node s7-loadcost.mjs" > $C/s7.console 2>&1 ;;
esac; done
step DONE
