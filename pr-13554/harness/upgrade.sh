#!/bin/bash
# E2E-4: V47 (base) -> V48 (PR) upgrade with pre-existing retired stream captures; then a pre-V48 broker on the V48 schema.
E=/root/verify/pr13554/e2e; DB=pr13554_upgrade; export DB; OUT=$E/out-upgrade; rm -rf $OUT; mkdir -p $OUT
sql() { docker exec pr13554-mysql84 mysql -uroot -pverify $DB "$@" 2>/dev/null; }
docker exec pr13554-mysql84 mysql -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
echo "== 1. base (pre-V48) broker with gc-enabled=true produces and retires stream captures"
GC=true GRACE=PT5S $E/start.sh base up-base1 18651 $DB; sleep 22; grep -o "E2E-RIG no stream-capture collector[^ ]*" $E/run/up-base1.log
for s in old-1 old-2 old-3; do ARM=base $E/tool.sh seed 18651 tenant-u ws-1 $s 3 20 1 7 | grep seeded; ARM=base $E/tool.sh retire tenant-u $s delete-$s | grep retired; done
ARM=base $E/tool.sh seed 18651 tenant-u ws-1 live-1 1 2 1 8 | grep seeded
sleep 70; echo "after 70 s on the base broker (gc on, grace 5 s):"; sql -e "select max(cast(version as unsigned)) schema_version from flyway_schema_history; select session_id, state, count(*) n, sum(inline_bytes is not null) inline_present from qwen_managed_session_resource group by session_id, state" | tee $OUT/base-before-upgrade.txt
kill $(cat $E/run/up-base1.pid); sleep 3
echo "== 2. PR broker starts on the same database (Flyway V48 on populated schema)"
GC=true GRACE=PT5S $E/start.sh pr up-pr 18652 $DB; sleep 25; grep -E "Migrating schema|Successfully applied|collector-owner" $E/run/up-pr.log | sed 's/^.*\(INFO\|E2E\)/\1/' | cut -c1-160
for i in $(seq 1 90); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where collected_at is not null"); [ "$d" = 3 ] && break; sleep 1; done
echo "collected after ${i}s:"; sql -e "select session_id, collected_bytes, gc_generation from qwen_managed_session_resource_collection; select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present from qwen_managed_session_resource group by session_id, state" | tee $OUT/pr-after-upgrade.txt
echo "== 3. a pre-V48 broker restarts against the V48 schema (mixed fleet)"
GC=true GRACE=PT5S $E/start.sh base up-base2 18653 $DB; sleep 25
grep -E "Started E2EBroker|APPLICATION FAILED|Validate|not resolved|future|ERROR" $E/run/up-base2.log | sed 's/^.*\(INFO\|WARN\|ERROR\|E2E\)/\1/' | cut -c1-200 | head -5
R=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='old-1' order by resource_id limit 1")
echo "base broker HTTP read of collected Session: $(ARM=base $E/tool.sh read 18653 tenant-u ws-1 old-1/$R)"
echo "PR broker   HTTP read of collected Session: $(ARM=pr $E/tool.sh read 18652 tenant-u ws-1 old-1/$R)"
ARM=base $E/tool.sh seed 18653 tenant-u ws-1 live-2 1 2 1 9 | grep seeded
kill $(cat $E/run/up-pr.pid) $(cat $E/run/up-base2.pid)
