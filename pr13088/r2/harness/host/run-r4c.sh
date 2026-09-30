#!/bin/bash
# macOS host: second batch on PR head c21efbdfa1: O2 receipt recovery, MCP, O2 load cost, Flyway probe against current main, runtime image.
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-r4"; C=$RIG/out/r4
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
for s in "$@"; do case $s in
S16h) step "S16 head"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s16 VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s16-o2-recovery.mjs" > $C/s16-head.console 2>&1 ;;
S16b) step "S16 base"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s16b VERIFIED=absent $BS DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=base /opt/qwen/node s16-o2-recovery.mjs" > $C/s16-base.console 2>&1 ;;
S15)  step S15; $V "bash o2-ctl.sh down; bash reset.sh w1u_s15 VERIFIED=true $HD DURABLE=true PUB=0 MCP=1 > /dev/null && bash svc.sh start && $E /opt/qwen/node s15-mcp.mjs" > $C/s15.console 2>&1 ;;
S14b) step "S14b head"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s14c VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s14b-o2-loadcost.mjs" > $C/s14b-head.console 2>&1
      step "S14b base"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s14d VERIFIED=absent $BS DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=base /opt/qwen/node s14b-o2-loadcost.mjs; bash svc.sh stop; bash o2-ctl.sh down" > $C/s14b-base.console 2>&1 ;;
FW)   step "Flyway probe"; $V "bash flyway-probe-r3.sh" > $C/flyway-probe.console 2>&1 ;;
S10)  step "S10 image"; bash $RIG/s10-image-r3.sh > $C/s10-image.console 2>&1 ;;
esac; done
step DONE
