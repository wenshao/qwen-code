#!/bin/bash
# V12 -> V13 upgrade, revision change across restart, and rollback, on one
# MySQL schema. Spring processes are stopped by PID only.
SP=$SCRATCH
R=$SP/rig; J=$SP/jars; DB=p822_up; PORT=33837; U=http://127.0.0.1:$PORT
T=rig-up-$(date +%s); LOG=$SP/logs/upgrade; mkdir -p $LOG
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

echo "== 1. main jar (V1..V12) creates Sessions"
start base-server.jar base1 || exit 1
OLD=$(create k-old '{"agent_id":"rig-agent","input":[{"type":"text","text":"created by main"}]}' | tee /dev/stderr | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8").replace(/ \[replay=.*$/s,"")).id')
sleep 3
$MYSQL $DB -e "select version, description from flyway_schema_history order by installed_rank desc limit 1" 2>/dev/null
stop

echo "== 2. PR jar, default revision: V13 applies to the populated schema"
start pr-server.jar pr-rev1 || exit 1
grep -h "Migrating schema\|Successfully applied" $LOG/pr-rev1.log | sed 's/.*: //'
echo "old session: $(pub $U/v1/agents/sessions/$OLD | field agent_revision status last_event_id)"
create k-r1 '{"agent_id":"rig-agent","agent_revision":"1","input":[]}' | field id agent_revision
R1=$(pub "$U/v1/agents/sessions?limit=10" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.find(s=>s.id!=="'$OLD'").id')
stop

echo "== 3. PR jar restarted with QWEN_MANAGED_AGENT_REVISION=2"
start pr-server.jar pr-rev2 QWEN_MANAGED_AGENT_REVISION=2 || exit 1
echo "old session:   $(pub $U/v1/agents/sessions/$OLD | field agent_revision)"
echo "rev-1 session: $(pub $U/v1/agents/sessions/$R1 | field agent_revision)"
echo -n "new session, no revision:      "; create k-r2 '{"agent_id":"rig-agent","input":[]}' | field agent_revision
echo -n "new session, revision 2:       "; create k-r2b '{"agent_id":"rig-agent","agent_revision":"2","input":[]}' | field agent_revision
echo -n "retry of k-r1 naming rev 1:    "; create k-r1 '{"agent_id":"rig-agent","agent_revision":"1","input":[]}' | field error.code id agent_revision
echo -n "retry of k-r1 without revision:"; create k-r1 '{"agent_id":"rig-agent","input":[]}' | field id agent_revision
echo -n "retry of k-r1 naming rev 2:    "; create k-r1 '{"agent_id":"rig-agent","agent_revision":"2","input":[]}' | field error.code id agent_revision
$MYSQL $DB -e "select agent_revision, count(*) from managed_agent_session where tenant_id='$T' group by agent_revision" 2>/dev/null
stop

echo "== 4. rollback: main jar on the V13 schema"
start base-server.jar base2 && {
  grep -h -i "future\|Schema .* is up to date\|validated" $LOG/base2.log | sed 's/.*: //' | head -3
  echo -n "main creates: "; create k-rollback '{"agent_id":"rig-agent","input":[]}' | field id status
  echo "list on main: $(pub "$U/v1/agents/sessions?limit=20" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.length') sessions"
  stop
}
$MYSQL $DB -e "select session_id, agent_revision, created_at from managed_agent_session where tenant_id='$T' order by created_at" 2>/dev/null

echo "== 5. invalid revision settings"
start pr-server.jar pr-empty QWEN_MANAGED_AGENT_REVISION= && stop
start pr-server.jar pr-long QWEN_MANAGED_AGENT_REVISION=$(printf 'r%.0s' $(seq 1 129)) && stop
start pr-server.jar pr-space "QWEN_MANAGED_AGENT_REVISION=two words" && {
  echo "(started with a revision containing a space)"; stop; }
echo DONE
