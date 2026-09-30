#!/bin/bash
# macOS host: third batch. MCP rerun and the identity matrix on MariaDB at PR head c21efbdfa1, then the trial-merge scenarios.
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-r3"; C=$RIG/out/r3
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
until grep -q DONE $C/runner-c2.console; do sleep 5; done
step S15; $V "bash o2-ctl.sh down; bash reset.sh w1r_s15 VERIFIED=true $HD DURABLE=true PUB=0 MCP=1 > /dev/null && bash svc.sh start && $E /opt/qwen/node s15-mcp.mjs" > $C/s15.console 2>&1
step "S2 on MariaDB 10.11"; $V "docker start w0e3-mariadb > /dev/null; for i in \$(seq 1 40); do docker exec w0e3-mariadb mariadb-admin -uroot -pruntime-broker ping 2>/dev/null | grep -q alive && break; sleep 1; done; bash svc.sh DBCONT=w0e3-mariadb DBPORT=3307 DBPASS=runtime-broker > /dev/null; bash reset.sh w1r_s2m VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && docker exec w0e3-mariadb mariadb -uroot -pruntime-broker -N -B -e 'SELECT VERSION()' && OUT=$RIG/out/e2e-r3-mariadb /opt/qwen/node s2-identity.mjs; bash reset.sh w1r_s2dm VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 > /dev/null && bash svc.sh start && OUT=$RIG/out/e2e-r3-mariadb /opt/qwen/node s2d-restore-from-backup.mjs; bash svc.sh stop; bash svc.sh DBCONT=w0e3-db DBPORT=3306 DBPASS=rootpw > /dev/null; docker stop w0e3-mariadb > /dev/null" > $C/s2-mariadb.console 2>&1
step "trial merge batch"; $RIG/run-m3.sh S1 S2d S8 S6 S9 S14 S15 S2 > $RIG/out/r3/runner-m3.console 2>&1
step DONE
