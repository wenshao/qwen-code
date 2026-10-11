#!/bin/bash
# Corrupt historical rows on a real jar. usage: probe6c.sh <mysql|maria> <dbname> <tag> <jar> [zerodate]
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/b667d628-1f29-4ba9-bd59-411f3bce81ac/scratchpad
DB=$1; DBN=$2; T=$3; JAR=$4; ZD=${5:-}; P=QWEN_MANAGED_AGENT_RUNTIME
export SERVER_PORT=18652 BROKER_PORT=18653
L=$S/rig/logs/$T-on.log
stop() { local pid; pid=$(cat $S/rig/logs/$1.log.pid); kill $pid; while kill -0 $pid 2>/dev/null; do sleep 0.5; done; }
counts() { $S/rig/seed.sh $DB $DBN snapshot 2>/dev/null | grep -E "^count" | head -3 | awk '{printf "%s=%s ", $2, $3} END {print ""}' | sed 's/qwen_//g'; }
ticks() { grep -c -E "runtime_retention bindings_scanned|Runtime retention failed" $L; }
waitticks() { local want=$1 i; for i in $(seq 1 ${2:-90}); do [ "$(ticks)" -ge "$want" ] && return 0; sleep 2; done; echo "(timed out waiting for $want ticks; have $(ticks))"; }
show() { grep -E "runtime_retention bindings_scanned|Runtime retention failed" $L | sed -n "$1" | sed -E 's/^[0-9-]+T([0-9:.]{12}).*(runtime_retention |Runtime retention failed)/\1 \2/'; }
echo "## [$T] jar=$(basename $JAR) sha=$(shasum -a 256 $JAR | cut -c1-12)"
echo "## [$T] 1. jar migrates an empty database (retention off)"
$S/rig/boot.sh $JAR $DB $DBN $T-migrate ${P}_BROKER_ENABLED=true > /dev/null
grep -o 'Successfully applied [0-9]* migrations.*now at version v[0-9]*' $S/rig/logs/$T-migrate.log; stop $T-migrate
echo "## [$T] 2. seed the usual families, then two corrupt historical bindings sorted first in the keyset"
$S/rig/seed.sh $DB $DBN seed 2>/dev/null > /dev/null
$S/rig/seed.sh $DB $DBN corrupt 2>/dev/null
echo "before: $(counts)"
echo "## [$T] 3. retention on (30d / 100 / 2s)"
$S/rig/boot.sh $JAR $DB $DBN $T-on ${P}_BROKER_ENABLED=true ${P}_RETENTION_ENABLED=true ${P}_RETENTION_MAX_AGE=30d ${P}_RETENTION_BATCH_SIZE=100 ${P}_RETENTION_SCAN_DELAY=2s > /dev/null
waitticks 8
echo "first 8 ticks:"; show 1,8p
echo "failure causes (distinct): $(grep -o -E 'Caused by: [^ ]+: [^\r]{0,90}|^[a-zA-Z.]+Exception: [^\r]{0,90}' $L | sort | uniq -c | sort -rn | head -3 | tr '\n' ';')"
echo "after 8 ticks: $(counts)"
$S/rig/seed.sh $DB $DBN rows k- 2>/dev/null
$S/rig/seed.sh $DB $DBN rows e- 2>/dev/null | tail -1
if [ "$ZD" = zerodate ]; then
  echo "## [$T] 4. wait for convergence, then add a zero-DATETIME binding and an ordinary eligible one behind it"
  for i in $(seq 1 60); do grep "runtime_retention bindings_scanned" $L | tail -1 | grep -q "executions_deleted=0 sessions_deleted=0 bindings_deleted=0" && break; sleep 2; done
  echo "converged: $(counts) last tick: $(show '$p')"
  $S/rig/seed.sh $DB $DBN zerodate 2>/dev/null
  N=$(ticks); waitticks $((N+6))
  echo "6 ticks after the zero DATETIME appeared:"; show "$((N+1)),$((N+6))p"
  echo "cause of the newest failure: $(grep -A40 'Runtime retention failed' $L | grep -o -E '(Caused by: )?[a-zA-Z.]+(Exception|Error): [^\r]{0,110}' | grep -v 'Runtime Broker database operation failed' | tail -1)"
  $S/rig/seed.sh $DB $DBN rows k-after-zero 2>/dev/null
  echo "## [$T] 5. repair the zero DATETIME; the sweep resumes"
  if [ "$DB" = mysql ]; then /Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql -uroot -ppr13642 -h127.0.0.1 -P33642 $DBN -e "UPDATE qwen_runtime_binding SET last_active_at = UTC_TIMESTAMP(6) - INTERVAL 50 DAY WHERE binding_id = 'k-zero'" 2>/dev/null; else docker --context colima-pr13642 exec pr13642-mariadb mariadb -uroot -ppr13642 $DBN -e "UPDATE qwen_runtime_binding SET last_active_at = UTC_TIMESTAMP(6) - INTERVAL 50 DAY WHERE binding_id = 'k-zero'"; fi
  N=$(ticks); waitticks $((N+3))
  show "$((N+1)),$((N+3))p"
  $S/rig/seed.sh $DB $DBN rows k- 2>/dev/null
fi
echo "ERROR lines: $(grep -c ' ERROR ' $L)  WARN 'Runtime retention failed' lines: $(grep -c 'Runtime retention failed' $L)"
stop $T-on
echo "## [$T] done"
