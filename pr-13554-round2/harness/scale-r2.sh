#!/bin/bash
# History-walk cost of the 60 s ledger scan and the per-second claim scan on MySQL 8.4.6, at growing retired-history sizes.
DB=pr13554_scale_r2; OUT=/root/verify/pr13554/scale/out-r2; mkdir -p $OUT
sql() { docker exec -i pr13554-mysql84 mysql -uroot -pverify $DB "$@" 2>/dev/null; }
NOW=$(date +%s%3N)
sql <<SQL
create table if not exists digits (d int primary key); insert ignore into digits values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9);
create table if not exists seq (n int primary key);
insert ignore into seq select a.d + b.d*10 + c.d*100 + e.d*1000 + f.d*10000 + g.d*100000 from digits a, digits b, digits c, digits e, digits f, digits g;
SQL
echo "seq rows: $(sql -N -e 'select count(*) from seq')"
DUE=$((NOW - 86400000))
Q1="SELECT r.tenant_key, r.session_key, r.tenant_id, r.session_id FROM qwen_output_session_retirement r LEFT JOIN qwen_managed_session_resource_collection c ON c.tenant_key = r.tenant_key AND c.session_key = r.session_key WHERE c.tenant_key IS NULL AND r.retired_at <= $DUE ORDER BY r.retired_at LIMIT 32"
Q2="SELECT session_scope_key, tenant_id, session_id FROM qwen_managed_session_resource_collection WHERE collected_at IS NULL AND gc_next_at >= 0 AND gc_next_at <= $NOW AND (gc_owner = 'x' OR gc_claim_until <= $NOW) ORDER BY gc_next_at, session_scope_key LIMIT 32"
Q2M="SELECT session_scope_key, tenant_id, session_id FROM qwen_managed_session_resource_collection WHERE collected_at IS NULL AND gc_next_at <= $NOW AND (gc_owner = 'x' OR gc_claim_until <= $NOW) ORDER BY gc_next_at, session_scope_key LIMIT 32"
prev=0
echo "history,query,actual_ms_runs(3),rows_examined,plan" > $OUT/scale.csv
for N in 10000 100000 1000000; do
  sql -e "insert into qwen_output_session_retirement select sha2(concat('t',n % 97),256), sha2(concat('s',n),256), concat('t',n % 97), concat('s',n), concat('op',n), 1, $NOW - 172800000 - (1000000 - n) * 100, 0 from seq where n >= $prev and n < $N;
          insert into qwen_managed_session_resource_collection (session_scope_key, tenant_key, session_key, tenant_id, session_id, gc_generation, gc_next_at, gc_cursor, collected_at, collected_bytes, created_at) select sha2(concat('scope',n),256), sha2(concat('t',n % 97),256), sha2(concat('s',n),256), concat('t',n % 97), concat('s',n), 1, -1, '', $NOW, 4096, now(6) from seq where n >= $prev and n < $N;
          analyze table qwen_output_session_retirement, qwen_managed_session_resource_collection;" > /dev/null
  prev=$N
  for q in Q1 Q2 Q2M; do
    eval "QQ=\$$q"
    times=""; for r in 1 2 3; do s=$(date +%s%N); sql -N -e "$QQ" > /dev/null; e=$(date +%s%N); times="$times $(( (e - s) / 1000000 ))"; done
    sql -e "TRUNCATE performance_schema.events_statements_summary_by_digest" ; sql -N -e "$QQ" > /dev/null
    ex=$(sql -N -e "select SUM_ROWS_EXAMINED from performance_schema.events_statements_summary_by_digest where SCHEMA_NAME='$DB' and DIGEST_TEXT like 'SELECT%' order by LAST_SEEN desc limit 1")
    plan=$(sql -N -e "EXPLAIN FORMAT=TREE $QQ" | head -c 400 | tr '\n' ' ' | tr ',' ';')
    echo "$N,$q,$times,$ex,$plan" | tee -a $OUT/scale.csv
    sql -e "EXPLAIN ANALYZE $QQ" > $OUT/explain-$q-$N.txt
  done
done
