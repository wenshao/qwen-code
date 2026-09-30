#!/bin/bash
# macOS host: everything re-run on PR head 2cbf89313a (base arm = main 78143fe335).
RIG=/rig; V="$RIG/vmrun.sh"; E="OUT=$RIG/out/e2e-r4"; C=$RIG/out/r4
HD="JAR=head-server.jar DIST=dist-head HARNESS=false"; BS="JAR=base-server.jar DIST=dist-base HARNESS=false"
step() { echo "=== $(date +%T) $1"; }
$RIG/run-r4a.sh S13 S2d S1 S2 S8 S6 S9 S12 S5b S5 S2c
step "S14 head"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s14 VERIFIED=false $HD DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=head /opt/qwen/node s14-o2.mjs" > $C/s14-head.console 2>&1
step "S14 base"; $V "bash o2-ctl.sh down; bash o2-ctl.sh up > /dev/null; bash reset.sh w1u_s14b VERIFIED=absent $BS DURABLE=true PUB=1 MCP=0 > /dev/null && bash svc.sh start && $E ARM=base /opt/qwen/node s14-o2.mjs" > $C/s14-base.console 2>&1
$RIG/run-r4c.sh S16h S16b S15
step "S2 + S2d on MariaDB 10.11"; $V "bash o2-ctl.sh down; docker start w0e3-mariadb > /dev/null; for i in \$(seq 1 40); do docker exec w0e3-mariadb mariadb-admin -uroot -pruntime-broker ping 2>/dev/null | grep -q alive && break; sleep 1; done; bash svc.sh DBCONT=w0e3-mariadb DBPORT=3307 DBPASS=runtime-broker > /dev/null; bash reset.sh w1u_s2m VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 && bash svc.sh start && docker exec w0e3-mariadb mariadb -uroot -pruntime-broker -N -B -e 'SELECT VERSION()' && OUT=$RIG/out/e2e-r4-mariadb /opt/qwen/node s2-identity.mjs; bash reset.sh w1u_s2dm VERIFIED=true $HD DURABLE=true PUB=0 MCP=0 > /dev/null && bash svc.sh start && OUT=$RIG/out/e2e-r4-mariadb /opt/qwen/node s2d-restore-from-backup.mjs; bash svc.sh stop; bash svc.sh DBCONT=w0e3-db DBPORT=3306 DBPASS=rootpw > /dev/null; docker stop w0e3-mariadb > /dev/null" > $C/s2-mariadb.console 2>&1
$RIG/run-r4a.sh S3k S3b
step "S4 reboot and power cut"; $RIG/run-s4-r4.sh > $C/runner-s4.console 2>&1
step ALL-DONE
