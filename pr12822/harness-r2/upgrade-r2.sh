#!/bin/bash
# V12 -> V13 upgrade, revision change across restart, and rollback, on one
# MySQL schema. Spring processes are stopped by PID only.
SP=$SCRATCH
R=$SP/rig; J=$SP/jars; DB=p822_up2; PORT=33845; U=http://127.0.0.1:$PORT
T=rig-up-$(date +%s); LOG=$SP/r2/logs/upgrade; mkdir -p $LOG
MYSQL="$HOME/Install/mysql-8.4.7-macos15-arm64/bin/mysql --no-defaults -uroot -prig12822 -h127.0.0.1 -P33822"
$MYSQL -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null

start() { # jar name [env...]
  local jar=$1 name=$2; shift 2
  env "$@" $R/spring.sh $J/$jar $PORT 33830 $DB > $LOG/$name.log 2>&1 &
  PID=$!
  for i in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' $U/actuator/health)" = 200 ] && { echo "[$name] up (pid $PID)"; return 0; }
    kill -0 $PID 2>/dev/null || { echo "[$name] EXITED"; grep -m3 -E "IllegalArgument|APPLICATION FAILED|Caused by" $LOG/$name.log | cut -c1-300; return 1; }
    sleep 1
  done
  echo "[$name] timeout"; return 1
}
stop() { kill $PID 2>/dev/null; for i in $(seq 1 30); do kill -0 $PID 2>/dev/null || return 0; sleep 1; done; kill -9 $PID; }
pub() { curl -s -H "X-Qwen-Tenant-Id: $T" -H 'accept: application/json' "$@"; }
create() { # key body
  curl -s -D $LOG/h.txt -X POST -H "X-Qwen-Tenant-Id: $T" -H 'content-type: application/json' -H "Idempotency-Key: $1" $U/v1/agents/sessions -d "$2"
  echo " [replay=$(grep -i 'idempotent-replay' $LOG/h.txt | tr -d '\r' | awk '{print $2}')]"
}
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.replace(/ \[replay=.*$/s,""));console.log(process.argv.slice(1).map(k=>k+"="+JSON.stringify(k.split(".").reduce((o,p)=>o?.[p],j))).join(" "))}catch(e){console.log("RAW "+s.slice(0,300))}})' "$@"; }

try() { # label key body
  printf '%-48s' "$1"; create "$2" "$3" | field error.code id agent_revision
}
echo "== 1. main jar (V12)"
start base-server.jar base1 || exit 1
try "main: create K_main (no revision)" k-main '{"agent_id":"rig-agent","input":[{"type":"text","text":"from main"}]}'
stop
echo "== 2. r1 jar (81c22146)"
start pr-server.jar r1 || exit 1
try "r1: create K_r1_omit" k-r1-omit '{"agent_id":"rig-agent","input":[]}'
try "r1: create K_r1_named (\"1\")" k-r1-named '{"agent_id":"rig-agent","agent_revision":"1","input":[]}'
stop
echo "== 3. r2 jar (a52ec991), revision 1"
start r2-server.jar r2-rev1 || exit 1
try "retry K_main, omitted" k-main '{"agent_id":"rig-agent","input":[{"type":"text","text":"from main"}]}'
try "retry K_r1_omit, omitted" k-r1-omit '{"agent_id":"rig-agent","input":[]}'
try "retry K_r1_named, naming \"1\"" k-r1-named '{"agent_id":"rig-agent","agent_revision":"1","input":[]}'
try "create K1 naming \"1\"" k1 '{"agent_id":"rig-agent","agent_revision":"1","input":[]}'
try "create K0 omitted" k0 '{"agent_id":"rig-agent","input":[]}'
stop
echo "== 4. r2 jar, QWEN_MANAGED_AGENT_REVISION=2"
start r2-server.jar r2-rev2 QWEN_MANAGED_AGENT_REVISION=2 || exit 1
try "retry K1 naming \"1\"" k1 '{"agent_id":"rig-agent","agent_revision":"1","input":[]}'
try "retry K1 naming \"2\"" k1 '{"agent_id":"rig-agent","agent_revision":"2","input":[]}'
try "retry K1 omitted" k1 '{"agent_id":"rig-agent","input":[]}'
try "retry K0 omitted" k0 '{"agent_id":"rig-agent","input":[]}'
try "retry K0 naming \"2\"" k0 '{"agent_id":"rig-agent","agent_revision":"2","input":[]}'
try "retry K_main, omitted" k-main '{"agent_id":"rig-agent","input":[{"type":"text","text":"from main"}]}'
try "new create naming \"1\"" k-new1 '{"agent_id":"rig-agent","agent_revision":"1","input":[]}'
try "new create naming \"2\"" k-new2 '{"agent_id":"rig-agent","agent_revision":"2","input":[]}'
try "new create omitted" k-new0 '{"agent_id":"rig-agent","input":[]}'
stop
echo "== 5. rollback: main jar on the V13 schema"
start base-server.jar base2 && { try "main: retry K_main" k-main '{"agent_id":"rig-agent","input":[{"type":"text","text":"from main"}]}'; stop; }
$MYSQL $DB -e "select agent_revision, count(*) from managed_agent_session where tenant_id='$T' group by agent_revision" 2>/dev/null
echo DONE
