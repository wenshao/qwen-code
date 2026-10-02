#!/bin/bash
# S4: does a shortened deletion grace take effect for a publication already evaluated as grace-held?
# usage: s4.sh <db> <jarArm>   grace 600 s -> retire E -> first evaluation -> restart with grace 30 s -> watch 150 s
R=$(cd $(dirname $0); pwd); cd $R; DB=$1; ARM=$2; export DB
N=/Users/wenshao/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
E=78607f13-b370-4874-a7ae-4ef3c5497576; EP=4589d1b7-0712-4874-9cce-28c51bfe8ccb
LOG=$R/out/s4-$DB.log; : > $LOG; say() { echo "$*" | tee -a $LOG; }
nowms() { $N -e 'console.log(Date.now())'; }
./stop-spring.sh 38094; ./arm-restore.sh $DB | tee -a $LOG
DB=$DB GC=true GRACE=600s DBPORT=33094 ./up.sh $ARM 38094 39094 | tee -a $LOG
T=$(nowms); ms() { echo $(( $(nowms) - T )); }
./retire.sh $E > /dev/null; RA=$(./sql.sh -N -e "SELECT retired_at FROM qwen_output_session_retirement WHERE session_id='$E'")
for i in $(seq 1 40); do b=$(./sql.sh -N -e "SELECT IFNULL(gc_blocker,'') FROM qwen_tool_publication WHERE publication_id='$EP'"); [ -n "$b" ] && break; sleep 0.5; done
say "+$(ms)ms grace 600 s: E evaluated: blocker=$b gc_next_at=retired_at+$(( $(./sql.sh -N -e "SELECT gc_next_at FROM qwen_tool_publication WHERE publication_id='$EP'") - RA ))ms"
./stop-spring.sh 38094
DB=$DB GC=true GRACE=30s DBPORT=33094 ./up.sh $ARM 38094 39094 | tee -a $LOG
say "+$(ms)ms restarted with grace 30 s (E has been retired for $(( ($(nowms) - RA)/1000 )) s, so it is past the new grace)"
for i in $(seq 1 300); do st=$(./sql.sh -N -e "SELECT retention_state FROM qwen_tool_publication WHERE publication_id='$EP'"); [ "$st" = "COLLECTED" ] && break; sleep 0.5; done
row=$(./sql.sh -N -e "SELECT CONCAT(retention_state,' blocker=',IFNULL(gc_blocker,'-'),' next_in_s=',ROUND((gc_next_at-UNIX_TIMESTAMP(NOW(3))*1000)/1000)) FROM qwen_tool_publication WHERE publication_id='$EP'")
CA=$(./sql.sh -N -e "SELECT IFNULL(collected_at,0) FROM qwen_tool_publication WHERE publication_id='$EP'")
if [ "$CA" -gt 0 ]; then say "+$(ms)ms E COLLECTED $(( (CA - RA)/1000 )) s after retirement"; else say "+$(ms)ms E still $row (not collected within 150 s of the restart)"; fi
./stop-spring.sh 38094
