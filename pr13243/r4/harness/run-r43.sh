#!/bin/bash
# PR #13243 real-stack A/B. usage: run-r43.sh <arm-dist-label> <db> [ONLY]
# Fresh DB per arm; Spring workers use the same dist as the Harness.
set -u
ARM=$1; DB=$2; ONLY=${3:-}
RIG=/Users/wenshao/pr13243-rig
export PATH=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
. $RIG/rig.env
[ -f $RIG/dist/$ARM/cli.js ] || { echo "NO DIST $ARM"; exit 2; }
J=${JAR:-j43}; [ -f $RIG/server/$J-server.jar ] || { echo "NO JAR $J"; exit 2; }
$MYSQL -h127.0.0.1 -P$DBPORT -uroot -p$DBPASS -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null
rm -rf $RIG/run/$DB $RIG/out/$DB
cd $RIG/probe && DB=$DB node manifest43.mjs || exit 3
echo "=== spring $(date -u +%T)"
WORKER_DIST=$ARM $RIG/spring.sh $J $DB ${SPRING_EXTRA:-} || exit 4
echo "=== probe arm=$ARM db=$DB only=${ONLY:-all} $(date -u +%T)"
cd $RIG/probe && env DB=$DB ARM=$ARM ${ONLY:+ONLY=$ONLY} ${PROXY:+PROXY=$PROXY} node s43-module-eval.mjs 2>&1 | grep -E "PASS|FAIL|NOTE|RESULT|Error" | cut -c1-420
echo "=== workers before spring stop: $(ps -axo pid=,command= | awk -v r="$RIG/dist/$ARM/" 'index($0, r) && $0 !~ / serve / {n++} END {print n+0}')"
T0=$(date +%s)
$RIG/stop.sh $DB
echo "=== spring stop took $(( $(date +%s) - T0 )) s; workers after: $(ps -axo pid=,command= | awk -v r="$RIG/dist/$ARM/" 'index($0, r) && $0 !~ / serve / {n++} END {print n+0}')"
echo "=== DONE $(date -u +%T)"
