#!/bin/bash
# E2E-3: deterministic crash points. (a) kill -9 inside an uncommitted page; (b) kill -9 between two pages.
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_e2e3; export DB; OUT=$E/out-e2e3; rm -rf $OUT; mkdir -p $OUT
sql() { mysql -hmysql84 -uroot -pverify $DB "$@" 2>/dev/null; }
state() { sql -e "select session_id, gc_generation gen, left(ifnull(gc_owner,'-'),8) owner, left(gc_cursor,12) cur, collected_bytes, collected_at is not null done, gc_blocker from qwen_managed_session_resource_collection order by session_id; select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present, sum(inline_bytes is not null and sha2(inline_bytes,256)=sha256) digest_ok from qwen_managed_session_resource group by session_id, state order by session_id, state"; }
mysql -hmysql84 -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
GRACE=PT10S $E/start.sh head e2e3-B 18621 $DB; sleep 22
OWNER_B=$(grep -o 'collector-owner=[^ ]*' $E/run/e2e3-B.log | cut -d= -f2); echo "B owner=$OWNER_B"
ARM=${ARM:-head} $E/tool.sh seed 18621 tenant-x ws-1 L1-midpage 40 0 1 31 | grep seeded
ARM=${ARM:-head} $E/tool.sh seed 18621 tenant-x ws-1 L2-between 40 0 1 32 | grep seeded
# (a) hold a row lock on the 20th row (resource_id order) of L1 so B's page UPDATE stalls after modifying 19 rows
read SCOPE LOCKED <<< $(sql -N -e "select session_scope_key, resource_id from qwen_managed_session_resource where session_id='L1-midpage' order by resource_id limit 19,1")
(nohup mysql -hmysql84 -uroot -pverify $DB -e "BEGIN; SELECT resource_id FROM qwen_managed_session_resource WHERE session_scope_key='$SCOPE' AND resource_id='$LOCKED' FOR UPDATE; SELECT SLEEP(300) AS lock_holder;" >/dev/null 2>&1 &)
sleep 1; sql -e "select trx_id, trx_rows_locked from information_schema.innodb_trx" | tee $OUT/lock-holder.txt
sleep 1
echo "== (a) retire L1 only; B will block inside its first page"
$E/tool.sh retire tenant-x L1-midpage delete-L1 | grep retired
$E/tool.sh killer e2e3-B $(cat $E/run/e2e3-B.pid) 10 120 | grep -v Commons | tee $OUT/kill-a.txt
sleep 2; echo "-- state right after kill -9 of B (lock still held):"; state | tee $OUT/state-a-after-kill.txt
HOLDER=$(sql -N -e "select id from information_schema.processlist where info like 'SELECT SLEEP(300)%'"); sql -e "KILL $HOLDER"; echo "released lock holder $HOLDER"
GRACE=PT10S $E/start.sh head e2e3-A 18622 $DB; sleep 22
OWNER_A=$(grep -o 'collector-owner=[^ ]*' $E/run/e2e3-A.log | cut -d= -f2); echo "A owner=$OWNER_A"
for i in $(seq 1 120); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where session_id='L1-midpage' and collected_at is not null"); [ "$d" = 1 ] && break; sleep 1; done
echo "-- L1 after takeover by A (waited ${i}s after A started):"; state | tee $OUT/state-a-final.txt
echo "== (b) retire L2; kill -9 A right after its first page commits"
$E/tool.sh retire tenant-x L2-between delete-L2 | grep retired
$E/tool.sh killer-between $(cat $E/run/e2e3-A.pid) $OWNER_A 180 | grep -v Commons | tee $OUT/kill-b.txt
sleep 1; echo "-- state right after kill -9 of A:"; state | tee $OUT/state-b-after-kill.txt
GRACE=PT10S $E/start.sh head e2e3-C 18623 $DB; T=$(date +%s)
for i in $(seq 1 180); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where session_id='L2-between' and collected_at is not null"); [ "$d" = 1 ] && break; sleep 1; done
echo "-- L2 after takeover by C ($(( $(date +%s) - T ))s after C started):"; state | tee $OUT/state-b-final.txt
grep -h "Stream capture collection\|WARN.*SessionResource" $E/run/e2e3-*.log | sed 's/^.*\(INFO\|WARN\)/\1/' | cut -c1-220 > $OUT/collector-log.txt
