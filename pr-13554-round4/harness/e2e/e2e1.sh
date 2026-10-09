#!/bin/bash
# E2E-1 (round 3): one production instance per arm, grace 20 s, real HTTP producer,
# production retirement transaction. Adds page-boundary sessions and a phantom-row session.
# usage: e2e1.sh <arm> <port>
ARM=$1; PORT=$2
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_e2e1_$ARM; export DB ARM; OUT=$E/out-e2e1-$ARM; rm -rf $OUT; mkdir -p $OUT
sql() { mysql -hmysql84 -uroot -pverify $DB "$@" 2>/dev/null; }
mysql -hmysql84 -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
GRACE=PT20S $E/start.sh $ARM e2e1-$ARM $PORT $DB
for i in $(seq 1 90); do grep -q "E2E-RIG collector-owner" $E/run/e2e1-$ARM.log && break; sleep 1; done
grep "E2E-RIG collector-owner" $E/run/e2e1-$ARM.log
seed() { $E/tool.sh seed $PORT "$@" | grep -v "^pre-seal"; }
seed tenant-a ws-1 s1-bg-shell-40mib 40 30 1 11
seed tenant-a ws-1 s2-many-small 0 250 1 12
seed tenant-a ws-1 s3-empty 0 0 0 13
seed tenant-a ws-1 s4-live-control 2 5 1 14
seed tenant-a ws-1 s5-recovery-blocked 1 2 1 15 true
seed tenant-b ws-1 s6-other-tenant 2 3 1 16
seed tenant-a ws-1 s7-exact-100-rows 0 99 1 17
seed tenant-a ws-1 s8-101-rows 0 100 1 18
seed tenant-a ws-1 s9-exact-32mib 32 0 0 19
seed tenant-a ws-1 s10-32mib-plus-one 32 1 0 20
seed tenant-a ws-1 s11-phantom 0 3 1 21
# Phantom: bytes of one PUBLISHED row freed out of band, state untouched (the shape the
# R1/R2 review measured as double counted). byte_length 2048 stays as metadata.
PH=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s11-phantom' and kind='managed-tool-result-page' order by resource_id limit 1")
sql -e "update qwen_managed_session_resource set inline_bytes = NULL where session_id='s11-phantom' and resource_id='$PH'"
echo "phantom row s11-phantom/${PH:0:12} inline_bytes nulled (byte_length kept)"
sql -e "truncate performance_schema.events_statements_summary_by_digest" 2>/dev/null
mysql -hmysql84 -uroot -pverify -e "truncate performance_schema.events_statements_summary_by_digest" 2>/dev/null
date +%s%3N > $OUT/t0
for s in s1-bg-shell-40mib s2-many-small s3-empty s5-recovery-blocked s7-exact-100-rows s8-101-rows s9-exact-32mib s10-32mib-plus-one s11-phantom; do
  $E/tool.sh retire tenant-a $s delete-$s; done
$E/tool.sh retire tenant-b s6-other-tenant delete-s6
R1=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s1-bg-shell-40mib' order by resource_id limit 1")
echo "read right after retirement: $($E/tool.sh read $PORT tenant-a ws-1 s1-bg-shell-40mib/$R1)" | tee $OUT/read-after-retire.txt
for i in $(seq 1 240); do
  pending=$(sql -N -e "select count(*) from qwen_output_session_retirement r left join qwen_managed_session_resource_collection c on c.tenant_key=r.tenant_key and c.session_key=r.session_key where r.recovery_protected=0 and (c.collected_at is null)")
  [ "$pending" = "0" ] && break
  sleep 1
done
date +%s%3N > $OUT/t1
echo "all non-protected ledgers complete after $(( ($(cat $OUT/t1) - $(cat $OUT/t0)) / 1000 )) s"
echo "read after collection: $($E/tool.sh read $PORT tenant-a ws-1 s1-bg-shell-40mib/$R1)" | tee $OUT/read-after-collect.txt
sql -e "select c.session_id, c.gc_generation pages, c.collected_bytes, c.collected_at is not null done, c.gc_blocker, (select count(*) from qwen_managed_session_resource r where r.session_scope_key=c.session_scope_key and r.state='COLLECTED') collected_rows, (select ifnull(sum(byte_length),0) from qwen_managed_session_resource r where r.session_scope_key=c.session_scope_key and r.state='COLLECTED') collected_rows_bytes, (select count(*) from qwen_managed_session_resource r where r.session_scope_key=c.session_scope_key and r.state='PUBLISHED') left_published, (select ifnull(sum(length(inline_bytes)),0) from qwen_managed_session_resource r where r.session_scope_key=c.session_scope_key) inline_left from qwen_managed_session_resource_collection c order by c.session_id" | tee $OUT/ledgers.txt
sql -e "select session_id, state, count(*) n, sum(byte_length) bytes, sum(inline_bytes is not null) inline_present, sum(sha256 is not null) digests from qwen_managed_session_resource where session_id in ('s4-live-control','s11-phantom','s5-recovery-blocked') group by session_id, state" | tee $OUT/controls.txt
mysql -hmysql84 -uroot -pverify -e "select count_star, round(sum_timer_wait/1e9,1) total_ms, sum_rows_examined, left(digest_text, 110) q from performance_schema.events_statements_summary_by_digest where schema_name='$DB' and digest_text like 'SELECT \`resource_id\` , \`byte_length\` FROM \`qwen_managed_session_resource\`%'" 2>/dev/null | tee $OUT/eligible-digest.txt
grep -E "Stream capture collection (completed|blocked)" $E/run/e2e1-$ARM.log | sed 's/^.*Stream capture/Stream capture/' > $OUT/collector-log.txt
grep -c "will retry" $E/run/e2e1-$ARM.log | sed 's/^/retry WARNs: /' | tee $OUT/log-counters.txt
grep -c "E2E-RIG object-store-call" $E/run/e2e1-$ARM.log | sed 's/^/object-store calls: /' | tee -a $OUT/log-counters.txt
C=$(sql -N -e "select resource_id from qwen_managed_session_resource where session_id='s1-bg-shell-40mib' and state='COLLECTED' order by resource_id limit 1")
echo "recovery reader on collected row ($ARM): $($E/tool.sh recovery tenant-a ws-1 s1-bg-shell-40mib $C)" | tee $OUT/recovery-reader.txt
echo "recovery reader on phantom row ($ARM): $($E/tool.sh recovery tenant-a ws-1 s11-phantom $PH)" | tee -a $OUT/recovery-reader.txt
kill $(cat $E/run/e2e1-$ARM.pid)
echo "E2E1-DONE $ARM"
