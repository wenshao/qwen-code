#!/bin/bash
# S3: a collection claim that expires mid-page on the real stack.
# usage: s3.sh <db> <jarArm> <freeze|hold55>
#  freeze: hold E's first DELETE at the fake OSS, SIGSTOP the Spring JVM for 65 s (> 60 s claim), release, SIGCONT
#  hold55: hold E's first DELETE for 55 s with the JVM running (SDK socket timeout fires first)
R=$(cd $(dirname $0); pwd); cd $R; DB=$1; ARM=$2; MODE=$3; export DB
E=78607f13-b370-4874-a7ae-4ef3c5497576; EP=4589d1b7-0712-4874-9cce-28c51bfe8ccb; B1=91a1cbfb-4fa0-466f-b8ca-484b2456d277
LOG=$R/out/s3-$DB.log; : > $LOG; say() { echo "$*" | tee -a $LOG; }
nowms() { /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node -e 'console.log(Date.now())'; }
./stop-spring.sh 38094; ./arm-restore.sh $DB | tee -a $LOG
DB=$DB GC=true GRACE=0s DBPORT=33094 ./up.sh $ARM 38094 39094 | tee -a $LOG
SP=$(lsof -nP -iTCP:38094 -sTCP:LISTEN -t)
curl -s -X POST http://127.0.0.1:38994/clear-faults >/dev/null
curl -s -X POST http://127.0.0.1:38994/fault -H 'content-type: application/json' -d "{\"op\":\"delete\",\"mode\":\"hold\",\"count\":1,\"match\":\"$EP\"}" >/dev/null
T=$(nowms); ms() { echo $(( $(nowms) - T )); }
./retire.sh $E > /dev/null; say "+$(ms)ms retired E (1 publication, 7 OSS + 5 inline objects, one page)"
for i in $(seq 1 120); do [ "$(curl -s http://127.0.0.1:38994/held)" != "[]" ] && break; sleep 0.25; done
say "+$(ms)ms E's first DELETE is held at the fake OSS: $(./snap.sh $E | cut -c1-120)"
./retire.sh $B1 > /dev/null; say "+$(ms)ms retired B1 (50 healthy publications) while the collector thread is blocked"
if [ "$MODE" = freeze ]; then
  kill -STOP $SP; say "+$(ms)ms SIGSTOP Spring pid=$SP for 65 s"; sleep 65
  curl -s -X POST http://127.0.0.1:38994/release -H 'content-type: application/json' -d '{}' >/dev/null
  kill -CONT $SP; say "+$(ms)ms released held DELETE and SIGCONT"
else
  sleep 55; curl -s -X POST http://127.0.0.1:38994/release -H 'content-type: application/json' -d '{}' >/dev/null; say "+$(ms)ms released held DELETE after 55 s (JVM running)"
fi
LAST=""; FIRSTB=""; ECOL=""
for i in $(seq 1 400); do
  row=$(./sql.sh -N -e "SELECT CONCAT(retention_state,' gen=',gc_generation,' blocker=',IFNULL(gc_blocker,'-'),' owner=',IF(gc_owner IS NULL,'-','set'),' cursor=',IF(gc_cursor='','-',gc_cursor),' held=',capture_held_bytes+producer_held_bytes+admission_held_bytes,' next_in_ms=',gc_next_at-(UNIX_TIMESTAMP(NOW(3))*1000)) FROM qwen_tool_publication WHERE publication_id='$EP'")
  nb=$(./sql.sh -N -e "SELECT COUNT(*) FROM qwen_tool_publication WHERE session_id='$B1' AND retention_state='COLLECTED'")
  key=$(echo "$row" | sed -E 's/ next_in_ms=.*//')
  [ "$key" != "$LAST" ] && say "+$(ms)ms E: $row | B1 collected=$nb" && LAST=$key
  [ -z "$FIRSTB" ] && [ "$nb" -gt 0 ] && FIRSTB=$(ms) && say "+${FIRSTB}ms first B1 publication collected"
  [ -z "$ECOL" ] && echo "$row" | grep -q '^COLLECTED' && ECOL=$(ms)
  [ -n "$ECOL" ] && [ "$nb" -ge 50 ] && break
  sleep 0.5
done
say "summary: E collected at +${ECOL:-never}ms, first B1 at +${FIRSTB:-never}ms, B1 collected $nb/50 by +$(ms)ms"
curl -s "http://127.0.0.1:38994/ledger?since=$T" | /Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);const ep=process.argv[1];
const d=l.filter(e=>e.method==="DELETE"&&e.key.includes(ep));const byKey={};for(const e of d){(byKey[e.key.split("/").pop()]??=[]).push(e.status)}
console.log("E DELETE requests:",d.length,"distinct keys:",Object.keys(byKey).length);for(const[k,v]of Object.entries(byKey))console.log("  ",k.slice(0,24),v.join(","));});' $EP | tee -a $LOG
say "final E: $(./snap.sh $E | cut -c1-160)"
