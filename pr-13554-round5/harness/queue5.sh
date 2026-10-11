#!/bin/bash
# Round-5 container queue: strictly sequential (one DB-heavy job at a time); RC phase last, then restore RR.
R=/Users/wenshao/pr13554-rig; E=$R/e2e; Q=$R/r5/results; mkdir -p $Q/e2e
until [ -f $Q/it/aa5.done ]; do sleep 10; done
cd $E
for h in mysql84 mariadb; do DBH=$h DBHOST=$h:3306 ./order5.sh > $Q/e2e/ORDER5-$h.log 2>&1; done
for h in mysql84 mariadb; do OLD=main5 NEW=x5 DBH=$h DBHOST=$h:3306 ./upgrade5.sh > $Q/e2e/UP5-$h.log 2>&1; done
./e2e1.sh x5 18601 > $Q/e2e/E2E1-x5.log 2>&1; kill $(cat $E/run/e2e1-x5.pid) 2>/dev/null
ARM=x5 ./e2e2.sh > $Q/e2e/E2E2-x5.log 2>&1
mysql -hmysql84 -uroot -pverify pr13554_e2e2 -e "select ERROR_NAME, SUM_ERROR_RAISED from performance_schema.events_errors_summary_global_by_error where ERROR_NAME in ('ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'); select count(*) ledgers, sum(c.collected_bytes = (select ifnull(sum(byte_length),0) from qwen_managed_session_resource r where r.session_scope_key=c.session_scope_key and r.state='COLLECTED')) byte_exact, sum(c.collected_bytes) collected, (select sum(byte_length) from qwen_managed_session_resource r join qwen_output_session_retirement t on t.tenant_id=r.tenant_id and t.session_id=r.session_id) retired_bytes, (select count(*) from qwen_managed_session_resource where state='COLLECTED' and inline_bytes is not null) collected_with_bytes, (select count(*) from qwen_managed_session_resource where session_id like 'live-%' and state='PUBLISHED' and inline_bytes is not null) live_rows_intact from qwen_managed_session_resource_collection c" 2>/dev/null > $E/out-e2e2/audit-r5.txt
for n in A B C; do echo "$n completed=$(grep -c 'Stream capture collection completed' $E/run/e2e2-$n.log) retry=$(grep -c 'will retry' $E/run/e2e2-$n.log)" >> $E/out-e2e2/audit-r5.txt; done
for n in A B C; do kill $(cat $E/run/e2e2-$n.pid) 2>/dev/null; done
rm -rf $E/out-e2e2-x5; mv $E/out-e2e2 $E/out-e2e2-x5
$R/probe5/it-lifecycle.sh
for id in R02 R03 R04 R06 P03 P04; do for h in mariadb mysql84; do $R/probe5/run-it.sh imut-$id m2-x5 SessionResourceCollectionMySqlIT $h imut-$id > /dev/null; done; done
for h in mysql84 mariadb; do $R/probe5/run-race5.sh $h inflight,gap,collectorFirst,stress 30 > /dev/null; done
mysql -hmysql84 -uroot -pverify -e "SET GLOBAL transaction_isolation = 'READ-COMMITTED'" 2>/dev/null
mysql -hmariadb -uroot -pverify -e "SET GLOBAL tx_isolation = 'READ-COMMITTED'" 2>/dev/null
for h in mysql84 mariadb; do TAG=-rc $R/probe5/run-race5.sh $h inflight,gap,collectorFirst,stress 30 > /dev/null; done
mysql -hmysql84 -uroot -pverify -e "SET GLOBAL transaction_isolation = 'REPEATABLE-READ'" 2>/dev/null
mysql -hmariadb -uroot -pverify -e "SET GLOBAL tx_isolation = 'REPEATABLE-READ'" 2>/dev/null
echo "restored: $(mysql -hmysql84 -uroot -pverify -N -e 'select @@global.transaction_isolation' 2>/dev/null) $(mysql -hmariadb -uroot -pverify -N -e 'select @@global.tx_isolation' 2>/dev/null)" > $Q/queue5.done
