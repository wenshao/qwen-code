#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673): host-side helpers.  source rig.sh; then: clean; up <db> <jar-arm> <dist-arm>; probe <db> <arm> <dist> <env...>; down <db>
R=/Users/wenshao/pr13673-rig
X() { docker --context colima-pr13673 exec pr13673-lx bash -c "$*"; }
N=$R/lx/node/bin/node
nprocs() { X "ps -eo pid=,args= | grep -v grep | grep -cE 'node|java'"; }
clean() { local n; n=$(nprocs); [ "$n" = "0" ] || { echo "ABORT: $n node/java processes left in the container"; X "ps -eo pid,ppid,args | grep -E 'node|java' | grep -v grep | cut -c1-200"; return 3; }; }
up() { local D=$1 A=$2 DI=$3; mkdir -p $R/results/$D $R/run/$D
  X "mkdir -p /var/rig/dist && [ -f /var/rig/dist/$DI/cli.js ] && cmp -s /var/rig/dist/$DI/cli.js $R/dist/$DI/cli.js || { rm -rf /var/rig/dist/$DI && cp -a $R/dist/$DI /var/rig/dist/$DI; }"
  X "cd $R/probe && DB=$D WSS=ws-a $N manifest.mjs > /dev/null && $R/lx/aux.sh $D > /dev/null"
  X "$R/lx/harness.sh $D $DI" | tail -1
  X "HOOKS=$R/run/$D/hooks.json DIST=$DI $R/lx/spring.sh $A $D" | tail -1; }
probe() { local D=$1 A=$2 DI=$3; shift 3; X "cd $R/probe && DB=$D ARM=$A DIST=$DI $* $N p-recover.mjs" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==|fault|restart|prep)|Error|error" | cut -c1-600; }
down() { local D=$1; X "$R/lx/stop.sh $D all" | grep -v worker-left | tr '\n' ' '
  X "for p in \$(ps -eo pid=,args= | awk -v d=/var/rig/dist/ 'index(\$0, d) && \$0 !~ /awk/ {print \$1}'); do kill -9 \$p; done 2>/dev/null; sleep 1; for u in /sys/fs/cgroup/rig-hooks/*/; do [ -d \$u ] && { echo 1 > \$u/cgroup.kill; sleep 0.2; rmdir \$u; }; done 2>/dev/null; true"; echo " left=$(nprocs)"; }
