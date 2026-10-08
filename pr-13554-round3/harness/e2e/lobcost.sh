#!/bin/bash
# LOB: cost of the page query with (head) and without (r2) `inline_bytes IS NOT NULL`.
# usage: lobcost.sh <dbhost>   (mysql84 | mariadb)
H=$1; DB=pr13554_lob; OUT=/Users/wenshao/pr13554-rig/e2e/out-lob-$H; rm -rf $OUT; mkdir -p $OUT
m() { mysql -h$H -uroot -pverify "$@" 2>/dev/null; }
m -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
m $DB -e "CREATE TABLE r LIKE pr13554_e2e1_head.qwen_managed_session_resource; CREATE TABLE ref LIKE pr13554_e2e1_head.qwen_managed_session_resource_ref" 2>/dev/null \
 || m $DB < <(mysql -hmysql84 -uroot -pverify pr13554_e2e1_head -N -e "show create table qwen_managed_session_resource; show create table qwen_managed_session_resource_ref" 2>/dev/null | cut -f2 | sed 's/qwen_managed_session_resource_ref/ref/; s/qwen_managed_session_resource`/r`/; s/$/;/')
m $DB -e "show tables" | tr '\n' ' '; echo
seed() { # scope rows size
  for i in $(seq 1 $2); do echo "INSERT INTO r VALUES ('$1','t','w','s',LPAD($i,8,'0'),'managed-tool-result-content',1,$3,REPEAT('0',64),'MYSQL_INLINE',REPEAT(CHAR(65+($i%26)),$3),NULL,NULL,NULL,'cmd','PUBLISHED',NOW(6),NULL,NULL);"; done | m $DB
}
seed S1M 150 1048576
seed S16M 40 16777215
m $DB -e "select session_scope_key, count(*) n, round(sum(byte_length)/1048576) mib from r group by session_scope_key" | tee $OUT/seeded.txt
WHERE="session_scope_key = '%s' AND state = 'PUBLISHED' AND storage_kind = 'MYSQL_INLINE' AND schema_version = 1 AND ((kind = 'managed-tool-result-content' AND byte_length BETWEEN 1 AND 16777216)) AND object_key IS NULL AND object_version_id IS NULL AND encryption_key_id IS NULL"
NE="AND resource_id > '' AND NOT EXISTS (SELECT 1 FROM ref x WHERE x.session_scope_key = r.session_scope_key AND x.resource_id = r.resource_id) ORDER BY resource_id"
stat() { m -N -e "show global status where Variable_name in ('Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads')" | awk '{print $2}' | tr '\n' ' '; }
echo "variant,scope,run,ms,bp_read_requests,bp_reads_disk,rows" > $OUT/lobcost.csv
for scope in S1M S16M; do
  for v in r2 head cand; do
    if [ $v = head ]; then q="SELECT resource_id, byte_length FROM r WHERE $(printf "$WHERE" $scope) AND inline_bytes IS NOT NULL $NE LIMIT 101";
    elif [ $v = cand ]; then q="SELECT resource_id, byte_length FROM r WHERE $(printf "$WHERE" $scope) $NE LIMIT 101";
    else q="SELECT resource_id, byte_length FROM r WHERE $(printf "$WHERE" $scope) $NE LIMIT 100"; fi
    for run in 1 2 3; do
      read a1 b1 <<< "$(stat)"; t0=$(date +%s%N)
      rows=$(m $DB -N -e "$q" | wc -l)
      t1=$(date +%s%N); read a2 b2 <<< "$(stat)"
      echo "$v,$scope,$run,$(( (t1-t0)/1000000 )),$((a2-a1)),$((b2-b1)),$rows" | tee -a $OUT/lobcost.csv
    done
  done
done
# Page UPDATE cost (rolled back): head/r2 form vs candidate form with the phantom guard in the UPDATE.
echo "update_variant,scope,run,ms,bp_read_requests,bp_reads_disk" > $OUT/updatecost.csv
for scope in S1M S16M; do
  if [ $scope = S1M ]; then ids="'00000001','00000002','00000003','00000004','00000005','00000006','00000007','00000008','00000009','00000010','00000011','00000012','00000013','00000014','00000015','00000016','00000017','00000018','00000019','00000020','00000021','00000022','00000023','00000024','00000025','00000026','00000027','00000028','00000029','00000030','00000031','00000032'"; else ids="'00000001','00000002'"; fi
  for v in head cand; do
    if [ $v = cand ]; then g="AND inline_bytes IS NOT NULL"; else g=""; fi
    for run in 1 2 3; do
      read a1 b1 <<< "$(stat)"; t0=$(date +%s%N)
      m $DB -e "BEGIN; UPDATE r SET state = 'COLLECTED', inline_bytes = NULL WHERE session_scope_key = '$scope' $g AND resource_id IN ($ids); ROLLBACK;"
      t1=$(date +%s%N); read a2 b2 <<< "$(stat)"
      echo "$v,$scope,$run,$(( (t1-t0)/1000000 )),$((a2-a1)),$((b2-b1))" | tee -a $OUT/updatecost.csv
    done
  done
done
if [ $H = mysql84 ]; then
  for scope in S1M S16M; do
    m $DB -e "EXPLAIN ANALYZE SELECT resource_id, byte_length FROM r WHERE $(printf "$WHERE" $scope) AND inline_bytes IS NOT NULL $NE LIMIT 101" > $OUT/explain-head-$scope.txt
    m $DB -e "EXPLAIN ANALYZE SELECT resource_id, byte_length FROM r WHERE $(printf "$WHERE" $scope) $NE LIMIT 100" > $OUT/explain-r2-$scope.txt
  done
fi
m -e "DROP DATABASE $DB"
echo LOB-DONE $H
