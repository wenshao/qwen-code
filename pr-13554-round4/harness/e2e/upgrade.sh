#!/bin/bash
# E2E-4: V55 (main) -> V56 (PR) upgrade with pre-existing retired stream captures; then a pre-V56 broker on the V56 schema.
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_upgrade_${DBH:-mysql84}; export DB; OUT=$E/out-upgrade-${DBH:-mysql84}; rm -rf $OUT; mkdir -p $OUT
sql() { mysql -h${DBH:-mysql84} -uroot -pverify $DB "$@" 2>/dev/null; }
mysql -h${DBH:-mysql84} -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
echo "== 1. base (pre-V56) broker with gc-enabled=true produces and retires stream captures"
GC=true GRACE=PT5S $E/start.sh ${OLD:-main} up-base1 18651 $DB; sleep 22; grep -o "E2E-RIG no stream-capture collector[^ ]*" $E/run/up-base1.log
for s in old-1 old-2 old-3; do ARM=${OLD:-main} $E/tool.sh seed 18651 tenant-u ws-1 $s 3 20 1 7 | grep seeded; ARM=${OLD:-main} $E/tool.sh retire tenant-u $s delete-$s | grep retired; done
ARM=${OLD:-main} $E/tool.sh seed 18651 tenant-u ws-1 live-1 1 2 1 8 | grep seeded
sleep 70; echo "after 70 s on the base broker (gc on, grace 5 s):"; sql -e "select max(cast(version as unsigned)) schema_version from flyway_schema_history; select session_id, state, count(*) n, sum(inline_bytes is not null) inline_present from qwen_managed_session_resource group by session_id, state" | tee $OUT/base-before-upgrade.txt
kill $(cat $E/run/up-base1.pid); sleep 3
echo "== 2. PR broker starts on the same database (Flyway V56 on populated schema)"
GC=true GRACE=PT5S $E/start.sh ${NEW:-head} up-pr 18652 $DB; sleep 25; grep -E "Migrating schema|Successfully applied|collector-owner" $E/run/up-pr.log | sed 's/^.*\(INFO\|E2E\)/\1/' | cut -c1-160
for i in $(seq 1 90); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where collected_at is not null"); [ "$d" = 3 ] && break; sleep 1; done
echo "collected after ${i}s:"; sql -e "select session_id, collected_bytes, gc_generation from qwen_managed_session_resource_collection; select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present from qwen_managed_session_resource group by session_id, state" | tee $OUT/pr-after-upgrade.txt
echo "== 3. a pre-V56 broker restarts against the V56 schema (mixed fleet)"
GC=true GRACE=PT5S $E/start.sh ${OLD:-main} up-base2 18653 $DB; sleep 25
grep -E "Started E2EBroker|APPLICATION FAILED|Validate|not resolved|future|ERROR" $E/run/up-base2.log | sed 's/^.*\(INFO\|WARN\|ERROR\|E2E\)/\1/' | cut -c1-200 | head -5
R=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='old-1' order by resource_id limit 1")
echo "base broker HTTP read of collected Session: $(ARM=${OLD:-main} $E/tool.sh read 18653 tenant-u ws-1 old-1/$R)"
echo "PR broker   HTTP read of collected Session: $(ARM=${NEW:-head} $E/tool.sh read 18652 tenant-u ws-1 old-1/$R)"
ARM=${OLD:-main} $E/tool.sh seed 18653 tenant-u ws-1 live-2 1 2 1 9 | grep seeded
kill $(cat $E/run/up-pr.pid); sleep 2
echo "== 4. rollback then re-upgrade: the pre-V56 broker alone produces and retires old-4 on the V56 schema, then the PR broker returns"
ARM=${OLD:-main} $E/tool.sh seed 18653 tenant-u ws-1 old-4 2 10 1 10 | grep seeded; ARM=${OLD:-main} $E/tool.sh retire tenant-u old-4 delete-old-4 | grep retired
sleep 15; echo "old-4 on the pre-V56 broker after 15 s: $(sql -N -e "select concat(sum(state='PUBLISHED'),' published, ',sum(inline_bytes is not null),' with bytes') from qwen_managed_session_resource where session_id='old-4'")"
kill $(cat $E/run/up-base2.pid); sleep 2
GC=true GRACE=PT5S $E/start.sh ${NEW:-head} up-pr2 18654 $DB | grep booted
for i in $(seq 1 150); do d=$(sql -N -e "select count(*) from qwen_managed_session_resource_collection where session_id='old-4' and collected_at is not null"); [ "$d" = 1 ] && break; sleep 1; done
echo "re-upgraded PR broker collected old-4 after ${i}s:"; sql -e "select session_id, collected_bytes, gc_generation from qwen_managed_session_resource_collection where session_id='old-4'; select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present from qwen_managed_session_resource where session_id in ('old-4','live-1','live-2') group by session_id, state" | tee $OUT/reupgrade.txt
sql -e "select max(cast(version as unsigned)) schema_version, count(*) applied from flyway_schema_history where success = 1" | tee -a $OUT/reupgrade.txt
kill $(cat $E/run/up-pr2.pid)
echo UPGRADE-DONE
