#!/bin/bash
# macOS host: re-run the head-only scenarios on the rebased PR head (7c54aa78). Logs: out/new/*.console, out/e2e-new/*.log
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-new"
H="JAR=head-server.jar DIST=dist-head DURABLE=true HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
step S1;  $V "bash reset.sh w1n_s1 VERIFIED=false $H && bash svc.sh start && $E /opt/qwen/node s1-rollout.mjs" > $RIG/out/new/s1.console 2>&1
step S2;  $V "bash reset.sh w1n_s2 VERIFIED=true $H && bash svc.sh start && $E /opt/qwen/node s2-identity.mjs" > $RIG/out/new/s2-head-on.console 2>&1
step S2d; $V "bash reset.sh w1n_s2d VERIFIED=true $H && bash svc.sh start && $E /opt/qwen/node s2d-restore-from-backup.mjs" > $RIG/out/new/s2d.console 2>&1
step S3k; $V "bash reset.sh w1n_s3 VERIFIED=false $H && bash svc.sh start && $E TWO_TITLES=1 ARM=head MODE=kinds /opt/qwen/node s3-coldload.mjs" > $RIG/out/new/s3-kinds-head.console 2>&1
step S3s; $V "bash reset.sh w1n_s3 VERIFIED=false $H && bash svc.sh start && $E TWO_TITLES=1 ARM=head MODE=sweep /opt/qwen/node s3-coldload.mjs" > $RIG/out/new/s3-sweep-head.console 2>&1
step S5;  $V "bash reset.sh w1n_s5 VERIFIED=true $H && bash svc.sh start && $E /opt/qwen/node s5-marker-vs-agent.mjs" > $RIG/out/new/s5.console 2>&1
step S6;  $V "$E bash s6-run.sh w1n_s6 true" > $RIG/out/new/s6.console 2>&1
step S9;  $V "bash reset.sh w1n_s9 VERIFIED=false $H && bash svc.sh start && $E /opt/qwen/node s9-approvals.mjs && $E /opt/qwen/node s9b-approvals-followup.mjs" > $RIG/out/new/s9.console 2>&1
step DONE
