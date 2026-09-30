#!/bin/bash
# macOS host: scenarios on PR head f5ede8cea8 (server classes byte-identical to 2cbf89313a; base arm = main 78143fe335,
# whose non-test sources equal current main 51b80dadbc). Logs: out/r5/*.console, out/e2e-r5/*.log
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-r5"; C=$RIG/out/r5
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
step install; $V "bash install-r5.sh" > $C/install.console 2>&1
step S13; $V "bash s13-mounts.sh down; bash reset.sh w1v_s13 VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 EXTRA= && bash s13-mounts.sh up && bash svc.sh start && $E /opt/qwen/node s13-birth.mjs; bash svc.sh stop; bash s13-mounts.sh down" > $C/s13.console 2>&1
step S2d; $V "bash reset.sh w1v_s2d VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s2d-restore-from-backup.mjs" > $C/s2d.console 2>&1
step S1;  $V "bash reset.sh w1v_s1 VERIFIED=false $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s1-rollout.mjs" > $C/s1.console 2>&1
step S2;  $V "bash reset.sh w1v_s2 VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && $E /opt/qwen/node s2-identity.mjs" > $C/s2-head-on.console 2>&1
step S14; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1v_s14 VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s14-o2.mjs" > $C/s14-head.console 2>&1
step S16; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1v_s16 VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s16-o2-recovery.mjs; bash svc.sh stop; bash o2-ctl.sh down" > $C/s16-head.console 2>&1
step S15; $V "bash reset.sh w1v_s15 VERIFIED=true $HD DURABLE=true PUB=0 MCP=1 > /dev/null && bash svc.sh start && $E /opt/qwen/node s15-mcp.mjs" > $C/s15.console 2>&1
step S17; $V "bash svc.sh MCP=0 > /dev/null; $E bash s17-run.sh w1v_s17" > $C/s17.console 2>&1
step DONE
