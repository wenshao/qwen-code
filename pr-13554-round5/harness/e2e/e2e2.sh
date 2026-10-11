#!/bin/bash
# E2E-2: three production instances on one MySQL; 51 retired Sessions; kill -9 inside an uncommitted page.
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_e2e2; export DB; OUT=$E/out-e2e2; rm -rf $OUT; mkdir -p $OUT
sql() { mysql -hmysql84 -uroot -pverify $DB "$@" 2>/dev/null; }
mysql -hmysql84 -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
GRACE=PT20S $E/start.sh ${ARM:-head} e2e2-A 18611 $DB; sleep 20
GRACE=PT20S $E/start.sh ${ARM:-head} e2e2-B 18612 $DB; sleep 7
GRACE=PT20S $E/start.sh ${ARM:-head} e2e2-C 18613 $DB; sleep 20
for n in A B C; do echo "$n $(grep -o 'collector-owner=[^ ]*' $E/run/e2e2-$n.log)"; done | tee $OUT/owners.txt
ports=(18611 18612 18613); jobs=0; RETIRE=""
for i in $(seq -w 1 45); do t=tenant-$((10#$i % 3)); s=m$i; RETIRE="$RETIRE $t $s"
  ARM=${ARM:-head} $E/tool.sh seed ${ports[$((10#$i % 3))]} $t ws-1 $s 3 150 1 $i > $OUT/seed-$s.log & jobs=$((jobs+1)); [ $((jobs % 6)) = 0 ] && wait; done
for i in 1 2 3 4 5 6; do t=tenant-$((i % 3)); s=L$i; RETIRE="$RETIRE $t $s"
  ARM=${ARM:-head} $E/tool.sh seed ${ports[$((i % 3))]} $t ws-1 $s 40 0 1 $((100+i)) > $OUT/seed-$s.log & done; wait
grep -h "^seeded" $OUT/seed-*.log | awk '{split($3,a,"="); split($4,b,"="); r+=a[2]; by+=b[2]} END {print "seeded sessions=" NR " rows=" r " bytes=" by}' | tee $OUT/seeded.txt
sql -e "select ERROR_NAME, SUM_ERROR_RAISED from performance_schema.events_errors_summary_global_by_error where ERROR_NAME in ('ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ER_DUP_ENTRY')" > $OUT/errors-before.txt
sql -e "set session information_schema_stats_expiry=0; analyze table qwen_managed_session_resource; select data_length, data_free from information_schema.tables where table_schema='$DB' and table_name='qwen_managed_session_resource'" > $OUT/space-before.txt
echo ibd-size-not-available >> $OUT/space-before.txt
$E/tool.sh retire-many $RETIRE | grep -v Commons | tee $OUT/t0.txt
T0=$(date +%s)
$E/tool.sh killer e2e2-B $(cat $E/run/e2e2-B.pid) 20 300 > $OUT/killer.txt 2>&1 &
( sleep 25; for k in 1 2 3; do ARM=${ARM:-head} $E/tool.sh seed ${ports[$((k-1))]} tenant-$k ws-1 live-$k 30 0 1 $((200+k)) & done; wait ) > $OUT/live-during.txt 2>&1 &
echo "t_s,ledgers,completed,claimed,collected_bytes,collected_rows,published_rows_retired" > $OUT/timeline.csv
for i in $(seq 1 900); do
  row=$(sql -N -e "select (select count(*) from qwen_managed_session_resource_collection), (select count(*) from qwen_managed_session_resource_collection where collected_at is not null), (select count(*) from qwen_managed_session_resource_collection where gc_owner is not null), (select ifnull(sum(collected_bytes),0) from qwen_managed_session_resource_collection), (select count(*) from qwen_managed_session_resource where state='COLLECTED'), (select count(*) from qwen_managed_session_resource r join qwen_output_session_retirement t on t.tenant_id=r.tenant_id and t.session_id=r.session_id where r.state='PUBLISHED')" | tr '\t' ',')
  echo "$(( $(date +%s) - T0 )),$row" >> $OUT/timeline.csv
  sql -N -e "select concat(session_id,' gen=',gc_generation,' owner=',left(ifnull(gc_owner,'-'),8),' cursor=',left(gc_cursor,8),' bytes=',collected_bytes,' done=',collected_at is not null) from qwen_managed_session_resource_collection where session_id like 'L%' order by session_id" | tr '\n' '|' | sed "s/^/$(( $(date +%s) - T0 ))s /" >> $OUT/large-ledgers.txt; echo >> $OUT/large-ledgers.txt
  done_n=$(echo $row | cut -d, -f2); [ "$done_n" = "51" ] && break
  sleep 1
done
echo "all 51 completed at t=$(( $(date +%s) - T0 ))s" | tee $OUT/done.txt
wait
