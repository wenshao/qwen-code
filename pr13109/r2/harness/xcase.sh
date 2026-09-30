#!/bin/bash
# xcase.sh <name> <case> <W> <servers> <armA> <armB> [restart]
# Cross-host recovery: phase A on .98 (Harness killed afterwards), optional Broker restart on .54,
# then phase B on .87 once the writer lease has expired.
set -uo pipefail
NAME=$1; CASE=$2; W=$3; SERVERS=$4; ARMA=$5; ARMB=$6; RESTART=${7:-}
S=$(cd "$(dirname "$0")/.." && pwd); OUT=$S/runs/xhost
HA=cici@192.168.0.98; NA='$HOME/.nvm/versions/node/v22.23.1/bin/node'
HB=wenshao@192.168.0.87; NB='$HOME/pr13109-rig/node/bin/node'
phase() { # host node arm phase name extra-env
  ssh -o BatchMode=yes $1 "cd ~/pr13109-rig/run-x && env NO_PROXY=192.168.0.54,localhost,127.0.0.1 no_proxy=192.168.0.54,localhost,127.0.0.1 RIG_RUN=\$HOME/pr13109-rig/run-x RIG_NAME=$5 RIG_HARNESS_CLI=\$HOME/pr13109-rig/$3/dist/cli.js ARM=$3 X_PHASE=$4 X_CASE=$CASE X_WS=$W X_SERVERS=$SERVERS $6 $2 ../drivers/x-phase.mjs > $5.log 2>&1; grep '^RESULT' $5.log | tail -1"
}
A=$(phase $HA "$NA" $ARMA A $NAME-A "")
echo "$A" > $OUT/$NAME-A.log
SID=$(echo "$A" | sed 's/^RESULT x //' | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.sessionId+" "+r.workspaceId)')
set -- $SID
[ ${#1} -ge 30 ] || { echo "NO_SESSION_FROM_PHASE_A"; exit 1; }
T0=$(date +%s)
if [ "$RESTART" = restart ]; then
  ssh -o BatchMode=yes root@192.168.0.54 'docker exec -e RIG_DBPORT=33109 -e RIG_BIND=0.0.0.0 -e RIG_PUBLIC=192.168.0.54 -e RIG_PORT=38109 -e RIG_BROKER_PORT=39109 -e RIG_ADMIN_PORT=37109 -e RIG_WS=12 pr13109-srv sh -c "W0=\$(ps -eo pid,args | grep -c [m]anaged-runtime-worker); kill -9 \$(cat /rig/run-x/spring.pid); sleep 1; bash /rig/spring-lx.sh head head x1 /rig/run-x true >/dev/null; echo broker_restarted workers_before=\$W0 workers_after=\$(ps -eo pid,args | grep -c [m]anaged-runtime-worker)"' > $OUT/$NAME-restart.log 2>&1
fi
while [ $(( $(date +%s) - T0 )) -lt 66 ]; do sleep 2; done
B=$(phase $HB "$NB" $ARMB B $NAME-B "X_SESSION=$1 X_WORKSPACE=$2 X_TRIES=${X_TRIES:-4} X_EVERY_S=${X_EVERY_S:-5}")
echo "$B" > $OUT/$NAME-B.log
echo "$NAME done"
