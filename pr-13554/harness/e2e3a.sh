#!/bin/bash
# E2E-3a: kill -9 an instance while its page UPDATE has modified 19 rows and waits on a row lock.
E=/root/verify/pr13554/e2e; DB=pr13554_e2e3a; export DB; OUT=$E/out-e2e3a; rm -rf $OUT; mkdir -p $OUT
sql() { docker exec pr13554-mysql84 mysql -uroot -pverify $DB "$@" 2>/dev/null; }
state() { sql -e "select session_id, gc_generation gen, left(ifnull(gc_owner,'-'),8) owner, left(gc_cursor,12) cur, collected_bytes, collected_at is not null done, gc_blocker from qwen_managed_session_resource_collection order by session_id; select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present, sum(inline_bytes is not null and sha2(inline_bytes,256)=sha256) digest_ok from qwen_managed_session_resource group by session_id, state order by session_id, state"; }
docker exec pr13554-mysql84 mysql -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
GRACE=PT10S $E/start.sh pr e2e3a-B 18631 $DB; sleep 22
echo "B owner=$(grep -o 'collector-owner=[^ ]*' $E/run/e2e3a-B.log | cut -d= -f2)"
$E/tool.sh seed 18631 tenant-x ws-1 L1-midpage 40 0 1 31 | grep seeded
read SCOPE LOCKED <<< $(sql -N -e "select session_scope_key, resource_id from qwen_managed_session_resource where session_id='L1-midpage' order by resource_id limit 19,1")
docker exec -d pr13554-mysql84 mysql -uroot -pverify $DB -e "BEGIN; SELECT resource_id FROM qwen_managed_session_resource WHERE session_scope_key='$SCOPE' AND resource_id='$LOCKED' FOR UPDATE; SELECT SLEEP(300) AS lock_holder;"
sleep 1; echo "lock holder: row #20 of L1 (resource_id order) $(echo $LOCKED | cut -c1-12)"
$E/tool.sh retire tenant-x L1-midpage delete-L1 | grep retired
$E/tool.sh killer e2e3a-B $(cat $E/run/e2e3a-B.pid) 10 150 | grep -v Commons | tee $OUT/kill.txt
sleep 1; echo "-- state right after kill -9 of B (lock still held):"; state | tee $OUT/state-after-kill.txt
HOLDER=$(sql -N -e "select id from information_schema.processlist where info like 'SELECT SLEEP(300)%'"); sql -e "KILL $HOLDER"; echo "released lock holder"
GRACE=PT10S $E/start.sh pr e2e3a-A 18632 $DB; T=$(date +%s)
for i in $(seq 1 180); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where collected_at is not null"); [ "$d" = 1 ] && break; sleep 1; done
echo "-- after takeover by A ($(( $(date +%s) - T ))s after A started):"; state | tee $OUT/state-final.txt
