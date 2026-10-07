#!/bin/bash
# E2E-1: one production instance, grace 20s, real HTTP producer, production retirement transaction.
E=/root/verify/pr13554/e2e; DB=pr13554_e2e1; export DB; OUT=$E/out-e2e1; rm -rf $OUT; mkdir -p $OUT
sql() { docker exec pr13554-mysql84 mysql -uroot -pverify $DB "$@" 2>/dev/null; }
docker exec pr13554-mysql84 mysql -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
GRACE=PT20S $E/start.sh pr e2e1-A 18601 $DB; sleep 25
grep "E2E-RIG collector-owner" $E/run/e2e1-A.log
$E/tool.sh seed 18601 tenant-a ws-1 s1-bg-shell-40mib 40 30 1 11 | grep -v Commons
$E/tool.sh seed 18601 tenant-a ws-1 s2-many-small 0 250 1 12 | grep -v Commons
$E/tool.sh seed 18601 tenant-a ws-1 s3-empty 0 0 0 13 | grep -v Commons
$E/tool.sh seed 18601 tenant-a ws-1 s4-live-control 2 5 1 14 | grep -v Commons
$E/tool.sh seed 18601 tenant-a ws-1 s5-recovery-blocked 1 2 1 15 true | grep -v Commons
$E/tool.sh seed 18601 tenant-b ws-1 s6-other-tenant 2 3 1 16 | grep -v Commons
sql -e "select table_name, data_length, data_free from information_schema.tables where table_schema='$DB' and table_name='qwen_managed_session_resource'" > $OUT/space-before.txt
date +%s%3N > $OUT/t0
for s in s1-bg-shell-40mib s2-many-small s3-empty s5-recovery-blocked; do $E/tool.sh retire tenant-a $s delete-$s | grep -v Commons; done
$E/tool.sh retire tenant-b s6-other-tenant delete-s6 | grep -v Commons
R1=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s1-bg-shell-40mib' order by resource_id limit 1")
echo "read right after retirement: $($E/tool.sh read 18601 tenant-a ws-1 s1-bg-shell-40mib/$R1 | grep -v Commons)" | tee $OUT/read-after-retire.txt
# timeline every second until all non-protected ledgers complete (or 240 s)
echo "t_ms,session,blocker,next_in_s,cursor_set,collected_bytes,done,published,collected,inline_bytes" > $OUT/timeline.csv
for i in $(seq 1 240); do
  now=$(date +%s%3N)
  sql -N -e "select s.session_id, ifnull(c.gc_blocker,''), ifnull(round((c.gc_next_at - $now)/1000),''), ifnull(c.gc_cursor<>'',''), ifnull(c.collected_bytes,''), ifnull(c.collected_at is not null,''), sum(r.state='PUBLISHED'), sum(r.state='COLLECTED'), ifnull(sum(length(r.inline_bytes)),0) from (select distinct tenant_id, session_id from qwen_managed_session_journal_head) s left join qwen_managed_session_resource_collection c on c.tenant_id=s.tenant_id and c.session_id=s.session_id left join qwen_managed_session_resource r on r.tenant_id=s.tenant_id and r.session_id=s.session_id group by s.session_id, c.gc_blocker, c.gc_next_at, c.gc_cursor, c.collected_bytes, c.collected_at" | awk -v t=$now 'BEGIN{OFS=","} {$1=$1; print t,$0}' | tr '\t' ',' >> $OUT/timeline.csv
  pending=$(sql -N -e "select count(*) from qwen_output_session_retirement r left join qwen_managed_session_resource_collection c on c.tenant_key=r.tenant_key and c.session_key=r.session_key where r.recovery_protected=0 and (c.collected_at is null)")
  [ "$pending" = "0" ] && break
  sleep 1
done
date +%s%3N > $OUT/t1
echo "read after collection: $($E/tool.sh read 18601 tenant-a ws-1 s1-bg-shell-40mib/$R1 | grep -v Commons)" | tee $OUT/read-after-collect.txt
sql -e "select table_name, data_length, data_free from information_schema.tables where table_schema='$DB' and table_name='qwen_managed_session_resource'" > $OUT/space-after.txt
