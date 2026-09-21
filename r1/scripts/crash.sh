#!/bin/bash
. /root/verify/pr12390-harness/env.sh
P=com.alibaba.qwen.code.runtimebroker.RaceWorker; RUN="k$(date +%s)"
c() { printf '\033[1;36m%s\033[0m\n' "$*"; }
c "### broker A enters findOrCreate, takes the slot row lock, then stalls for 60 s inside the transaction"
java -cp $CP $P hold "$MY" $RUN 60000 2>&1 | grep -v Picked & 
sleep 2
c "\$ broker B: findOrCreate on the same scope (blocks behind A's row lock)"
( java -cp $CP $P once "$MY" $RUN 2>&1 | grep -v Picked ) &
BPID=$!
sleep 3
APID=$(pgrep -f "RaceWorker hold .* $RUN " | head -1)
c "\$ kill -9 $APID   # broker A dies mid-transaction, 3 s after B started waiting"
kill -9 $APID
wait $BPID
c "\$ DB state for the scope"
docker exec pr12390-mysql84 mysql -uroot -t runtime_broker_test -e "select s.last_generation, s.active_binding_id, (select count(*) from qwen_runtime_binding b where b.request_key=s.request_key) as binding_rows from qwen_runtime_binding_slot s where tenant_id='$RUN-tenant-hold'"
