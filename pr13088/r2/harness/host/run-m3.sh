#!/bin/bash
# macOS host: W1a scenarios on the local trial merge (PR c21efbdfa1 + main 78143fe335; W1 migration renumbered to V25;
# connector conflict resolved keeping both sides; main's resolveAction given the PR's three-argument attachment, new work).
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-m3"; C=$RIG/out/m3r; mkdir -p $C $RIG/out/e2e-m3
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
step "install m3"; $V "bash install-m3.sh m3" > $C/install.console 2>&1
for s in "$@"; do case $s in
S1)  step S1;  $V "bash o2-ctl.sh down; bash reset.sh w1t_s1 VERIFIED=false $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s1-rollout.mjs" > $C/s1.console 2>&1 ;;
S2)  step S2;  $V "bash reset.sh w1t_s2 VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s2-identity.mjs" > $C/s2-head-on.console 2>&1 ;;
S2d) step S2d; $V "bash reset.sh w1t_s2d VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s2d-restore-from-backup.mjs" > $C/s2d.console 2>&1 ;;
S6)  step S6;  $V "bash svc.sh PUB=0 MCP=0 > /dev/null; $E bash s6-run.sh w1t_s6 true" > $C/s6.console 2>&1 ;;
S8)  step S8;  $V "bash reset.sh w1t_s8 VERIFIED=absent $BS DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s8-upgrade.mjs" > $C/s8.console 2>&1 ;;
S9)  step S9;  $V "bash reset.sh w1t_s9 VERIFIED=false $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s9-approvals.mjs" > $C/s9.console 2>&1 ;;
S14) step S14; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1t_s14 VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s14-o2.mjs; bash svc.sh stop; bash o2-ctl.sh down" > $C/s14-head.console 2>&1 ;;
S15) step S15; $V "bash reset.sh w1t_s15 VERIFIED=true $HD DURABLE=true PUB=0 MCP=1 > /dev/null && bash svc.sh start && $E /opt/qwen/node s15-mcp.mjs" > $C/s15.console 2>&1 ;;
S3k) step S3k; $V "bash reset.sh w1t_s3 VERIFIED=false $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E TWO_TITLES=1 ARM=head MODE=kinds /opt/qwen/node s3-coldload.mjs" > $C/s3-kinds-head.console 2>&1 ;;
esac; done
step "back to r3"; $V "bash svc.sh stop; bash install-m3.sh r3; bash svc.sh PUB=0 MCP=0" > $C/uninstall.console 2>&1
step DONE
