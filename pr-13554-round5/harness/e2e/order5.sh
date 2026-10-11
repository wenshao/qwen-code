#!/bin/bash
# E2E-5 (round 5): broker boot on a database a previous broker already migrated.
#   U2: main (V64) then the same PR bytes numbered V58 (the pre-renumber name) -- the R12-1 shape.
#   U3: main + another open PR's V66 (synthetic) then that tree merged with this PR as-is (V65 below V66).
E=/Users/wenshao/pr13554-rig/e2e; H=${DBH:-mysql84}; OUT=$E/out-order5-$H; rm -rf $OUT; mkdir -p $OUT
for cell in "u2:main5:x5v58" "u3:main5v66:x5v66" "u1:main5:x5"; do
  IFS=: read name old new <<< "$cell"
  DB=pr13554_order_${name}_$H; mysql -h$H -uroot -pverify -e "drop database if exists $DB" 2>/dev/null
  GC=true $E/start.sh $old ord-$name-old 18661 $DB | grep -E "booted|BOOT FAILED"
  kill $(cat $E/run/ord-$name-old.pid); sleep 3
  before=$(mysql -h$H -uroot -pverify -N $DB -e "select max(cast(version as unsigned)) from flyway_schema_history where success=1" 2>/dev/null)
  GC=true $E/start.sh $new ord-$name-new 18662 $DB | grep -E "booted|BOOT FAILED"
  after=$(mysql -h$H -uroot -pverify -N $DB -e "select max(cast(version as unsigned)) from flyway_schema_history where success=1" 2>/dev/null)
  ledger=$(mysql -h$H -uroot -pverify -N $DB -e "select count(*) from information_schema.tables where table_schema='$DB' and table_name='qwen_managed_session_resource_collection'" 2>/dev/null)
  cause=$(grep -m1 -oE "Detected resolved migration not applied to database: [0-9]+" $E/run/ord-$name-new.log | tr ' ' '_')
  sleep 2; alive=$(kill -0 $(cat $E/run/ord-$name-new.pid) 2>/dev/null && echo yes || echo no)
  started=$(grep -c "Started E2EBroker" $E/run/ord-$name-new.log)
  echo "RESULT db=$H cell=$name old=$old new=$new schemaBefore=$before schemaAfter=$after ledgerTable=$ledger started=$started processAlive=$alive cause=${cause:-none}" | tee -a $OUT/result.txt
  kill $(cat $E/run/ord-$name-new.pid) 2>/dev/null; sleep 2
done
echo ORDER5-DONE
