#!/bin/bash
# S5: permanently blocked (legacy, write_evidence = FALSE) RETIRING backlog vs one eligible publication.
# The 150 real B publications are marked legacy exactly as V27's column default marks pre-upgrade rows, then
# cloned K times in SQL (synthetic legacy rows; same scope/session, new ids). Grace 120 s.
# usage: s5.sh <db> <jarArm> <K clones per real row> [eRetireAtSec=200] [obsSec=420]
R=$(cd $(dirname $0); pwd); cd $R; DB=$1; ARM=$2; K=$3; ERET=${4:-200}; OBS=${5:-420}; export DB
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
E=78607f13-b370-4874-a7ae-4ef3c5497576; EP=4589d1b7-0712-4874-9cce-28c51bfe8ccb
BS="'91a1cbfb-4fa0-466f-b8ca-484b2456d277','e4145dd8-f5ca-4cd9-8021-5c796b3a86fa','aa1a8a19-d2b7-42e7-a1ff-17a33380f2bc'"
LOG=$R/out/s5-$DB.log; : > $LOG; say() { echo "$*" | tee -a $LOG; }
nowms() { $N -e 'console.log(Date.now())'; }
./stop-spring.sh 38094; ./arm-restore.sh $DB | tee -a $LOG
COLS=$(./sql.sh -N -e "SELECT GROUP_CONCAT(column_name ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='qwen_tool_publication'")
SEL=$(echo "$COLS" | tr ',' '\n' | sed -e "s/^publication_id$/CONCAT(p.publication_id,'-legacy-',n.k)/" -e "s/^capture_id$/CONCAT(p.capture_id,'-legacy-',n.k)/" -e "s/^execution_key$/SHA2(CONCAT(p.execution_key,'-',n.k),256)/" -e "s/^write_evidence$/FALSE/" | sed -E -e '/^(CONCAT|SHA2|FALSE)/!s/^/p./' | paste -sd, -)
NUMS=$(seq 1 $K | sed 's/^/SELECT /' | paste -sd'|' - | sed 's/|/ UNION ALL /g')
./sql.sh -e "UPDATE qwen_tool_publication SET write_evidence = FALSE WHERE session_id IN ($BS); INSERT INTO qwen_tool_publication ($COLS) SELECT $SEL FROM qwen_tool_publication p JOIN (SELECT 1 AS k FROM DUAL WHERE FALSE UNION ALL $NUMS) n WHERE p.session_id IN ($BS);" || { say "clone failed"; exit 1; }
say "legacy rows: $(./sql.sh -N -e "SELECT COUNT(*) FROM qwen_tool_publication WHERE session_id IN ($BS) AND write_evidence = FALSE") (150 real + $((150*K)) synthetic clones)"
DB=$DB GC=true GRACE=120s DBPORT=33094 ./up.sh $ARM 38094 39094 | tee -a $LOG
T=$(nowms); echo $T > run/s5-$DB-t0; ms() { echo $(( $(nowms) - T )); }
for b in 91a1cbfb-4fa0-466f-b8ca-484b2456d277 e4145dd8-f5ca-4cd9-8021-5c796b3a86fa aa1a8a19-d2b7-42e7-a1ff-17a33380f2bc; do ./retire.sh $b > /dev/null; done
say "+$(ms)ms retired the 3 legacy sessions: $(./sql.sh -N -e "SELECT COUNT(*) FROM qwen_tool_publication WHERE retention_state='RETIRING'") RETIRING rows (grace 120 s, then permanently legacy_write_evidence_missing)"
while [ $(ms) -lt $((ERET*1000)) ]; do sleep 1; done
./retire.sh $E > /dev/null; say "+$(ms)ms retired E (eligible at retired_at + 120 s)"
EA=$(./sql.sh -N -e "SELECT retired_at + 120000 FROM qwen_output_session_retirement WHERE session_id='$E'")
for i in $(seq 1 $((OBS*2))); do st=$(./sql.sh -N -e "SELECT retention_state FROM qwen_tool_publication WHERE publication_id='$EP'"); [ "$st" = "COLLECTED" ] && break; sleep 0.5; done
CA=$(./sql.sh -N -e "SELECT IFNULL(collected_at, 0) FROM qwen_tool_publication WHERE publication_id='$EP'")
if [ "$CA" -gt 0 ]; then say "E collected $((CA - EA)) ms after it became eligible (eligible +$((EA - T))ms, collected +$((CA - T))ms)"; else say "E NOT collected within window (eligible +$((EA - T))ms, now +$(ms)ms)"; fi
say "blockers now: $(./sql.sh -N -e "SELECT CONCAT(IFNULL(gc_blocker,'-'),'=',COUNT(*)) FROM qwen_tool_publication WHERE retention_state='RETIRING' GROUP BY gc_blocker" | paste -sd' ' -)"
$N - <<NODE | tee -a $LOG
const fs=require('fs');const t0=$T;const l=fs.readFileSync('run/sqltap-A3.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(e=>e.t>=t0);
const ev=l.filter(e=>/UPDATE qwen_tool_publication SET gc_blocker = /.test(e.sql));
const per={};for(const e of ev){const m=Math.floor((e.t-t0)/60000);per[m]=(per[m]||0)+1;}
const all={};for(const e of l){const m=Math.floor((e.t-t0)/60000);all[m]=(all[m]||0)+1;}
console.log('blocked re-evaluations per minute since t0:',JSON.stringify(per));
console.log('tapped collector/retention statements per minute since t0:',JSON.stringify(all));
NODE
./stop-spring.sh 38094
