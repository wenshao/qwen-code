#!/bin/bash
# VERIFICATION RIG ONLY: round-3 real-stack suite on head⊕main+V40 (jar r3m40, dist m40).  usage: run-suite.sh <jar> <db> <dist>
set -u
RIG=/Users/wenshao/pr13247-rig; . $RIG/rig.env
JAR=$1; DB=$2; export DIST=$3
export SPRING_EXTRA="--qwen.managed-agent.runtime-broker.durable-local-process=false --qwen.managed-agent.runtime-broker.trusted-local-reboot-recovery=false"
killw() { for p in $(pgrep -f "$RIG/dist/$DIST/cli.js managed-runtime-worker"); do kill $p; done; }
cd $RIG
bash aux.sh $DB >/dev/null; bash spring.sh $JAR $DB absent absent | tail -1; bash harness.sh $DB $DIST | tail -1
$MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS $DB < probe/traps.sql 2>&1 | grep -v "Using a password"
run() { echo "### $*"; env DB=$DB "$@" 2>&1 | grep -E "^(PASS|FAIL|NOTE|==)" | cut -c1-300; }
run $NODE probe/s1-basic.mjs
run $NODE probe/s2-admission.mjs
run $NODE probe/s2b-states.mjs
run $NODE probe/s3-settlement.mjs
run $NODE probe/s4-races.mjs
run env SKIP_LOCKED=1 NAME=s9-later-turns-nolock $NODE probe/s9-later-turns.mjs
run env NAME=s11-unreadable $NODE probe/s11-unreadable.mjs
run env ST=f NAME=s10-g0-locked $NODE probe/s10-g0-locked.mjs
run $NODE probe/s13-reverse-race.mjs
run $NODE probe/s16-destroyed-current.mjs
run $NODE probe/s17-interplay.mjs
run $NODE probe/s18-deleted-reader.mjs
run $NODE probe/s19-barrier-population.mjs
run $NODE probe/s20-tenant-burst.mjs
run env ST=g $NODE probe/s15b-mount-root.mjs
run $NODE probe/s21-retry-budget.mjs
run env ST=f $NODE probe/s22-acquire-legacy.mjs
$RIG/q.sh $DB "UPDATE rig_trap SET secs=4 WHERE name='claim'; UPDATE rig_trap SET secs=15 WHERE name='commit'"
run env JAR=$JAR $NODE probe/s5-durability.mjs
S=$(node -e "console.log(require('$RIG/out/$DB/s2b-states.json').session)")
./stop.sh $DB spring >/dev/null; WSFILES=false bash spring.sh $JAR $DB absent absent | tail -1
run env SESSION=$S $NODE probe/s8-optin-off.mjs
./stop.sh $DB spring >/dev/null; bash spring.sh $JAR $DB default absent | tail -1; ./stop.sh $DB harness >/dev/null; bash harness.sh $DB $DIST | tail -1
run $NODE probe/s14-actions.mjs
./stop.sh $DB all >/dev/null 2>&1; killw
echo "SUITE-DONE $(date -u +%T)"
