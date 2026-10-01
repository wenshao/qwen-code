#!/bin/bash
# Blocked-candidate saturation: E retired at t0, 150 publications of B retired at t0+60 s; grace 120 s.
# usage: sat.sh <db> <jarArm> <E session> <B1,B2,B3> [observeSec]
R=$(cd $(dirname $0); pwd); cd $R
DB=$1; ARM=$2; E=$3; BS=$4; OBS=${5:-330}; export DB
N=~/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
LOG=$R/out/sat-$DB.log; : > $LOG
say() { echo "$*" | tee -a $LOG; }
./stop-spring.sh 28894
DB=$DB GC=true GRACE=120s DBPORT=23894 ./up.sh $ARM 28894 29894 | tee -a $LOG
T=$(node -e 'console.log(Date.now())'); echo $T > run/sat-$DB-t0
ms() { echo $(( $(node -e 'console.log(Date.now())') - T )); }
($N watch.mjs sat-$DB-E $OBS $E > out/watch-sat-$DB-E.txt 2>&1 &)
./retire.sh $E > /dev/null; say "+$(ms)ms retired E (1 publication); eligible at retired_at + 120 s"
sleep 60
for b in ${BS//,/ }; do ./retire.sh $b > /dev/null; done; say "+$(ms)ms retired B (150 publications, in grace for 120 s)"
EA=$(./sql.sh -N -e "SELECT r.retired_at + 120000 FROM qwen_output_session_retirement r WHERE r.session_id='$E'")
for i in $(seq 1 $OBS); do st=$(./sql.sh -N -e "SELECT retention_state FROM qwen_tool_publication WHERE session_id='$E'"); [ "$st" = "COLLECTED" ] && break; sleep 1; done
CA=$(./sql.sh -N -e "SELECT collected_at FROM qwen_tool_publication WHERE session_id='$E'")
say "E: $(./snap.sh $E | cut -c1-140)"
say "E collected $(( (CA - EA) )) ms after it became eligible (eligible +$(( EA - T ))ms, collected +$(( CA - T ))ms)"
REST=$(( OBS - $(ms)/1000 )); [ $REST -gt 0 ] && sleep $REST
say "B rows: $(./sql.sh -N -e "SELECT CONCAT(retention_state,' blocker=',IFNULL(gc_blocker,'-'),' n=',COUNT(*)) FROM qwen_tool_publication WHERE session_id IN ('${BS//,/','}') GROUP BY retention_state, gc_blocker")"
$N - <<NODE | tee -a $LOG
const fs=require('fs');const t0=$T;const l=fs.readFileSync('run/sqltap-A3.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(e=>e.t>=t0);
const blocked=l.filter(e=>/UPDATE qwen_tool_publication SET gc_blocker = /.test(e.sql));
const claims=l.filter(e=>/SET retention_state = 'DELETING'/.test(e.sql));
const tenantLocks=l.filter(e=>/SELECT tenant_id FROM qwen_tool_publication_tenant WHERE tenant_key = .* FOR UPDATE/.test(e.sql));
const per={};for(const e of blocked){const m=Math.floor((e.t-t0)/60000);per[m]=(per[m]||0)+1;}
console.log('blocked re-evaluations (gc_blocker UPDATEs) per minute since t0:',JSON.stringify(per));
console.log('total blocked re-evaluations',blocked.length,'| claims (DELETING)',claims.length,'| tenant row FOR UPDATE',tenantLocks.length);
NODE
