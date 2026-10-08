#!/bin/bash
# BIN: binlog bytes written by collection on a MySQL 8.4.6 server with its default binary log
# (log_bin=ON, binlog_format=ROW). Collection runs under binlog_row_image=FULL (default), then NOBLOB.
E=/Users/wenshao/pr13554-rig/e2e; DB=pr13554_bin; export DB DBHOST=mysqlbin:3306 ARM=head; OUT=$E/out-bin; rm -rf $OUT; mkdir -p $OUT
m() { mysql -hmysqlbin -uroot -pverify "$@" 2>/dev/null; }
binbytes() { m -N -e "SHOW BINARY LOGS" | awk '{s+=$2} END {print s}'; }
m -e "select @@log_bin, @@binlog_format, @@binlog_row_image, @@version" | tee $OUT/server.txt
for img in FULL NOBLOB MINIMAL; do
  m -e "SET GLOBAL binlog_row_image = '$img'"
  # binlog_row_image is per session: restart the app so its pool opens new sessions.
  GRACE=PT5S $E/start.sh head bin-$img 18661 $DB | grep booted
  s=bin-$img
  $E/tool.sh seed 18661 tenant-b ws-1 $s 40 30 1 41 | grep seeded
  $E/tool.sh retire tenant-b $s delete-$s
  m -e "FLUSH BINARY LOGS"; before=$(binbytes)
  for i in $(seq 1 150); do d=$(m -N $DB -e "select count(*) from qwen_managed_session_resource_collection where session_id='$s' and collected_at is not null"); [ "$d" = 1 ] && break; sleep 1; done
  sleep 2; after=$(binbytes); kill $(cat $E/run/bin-$img.pid); sleep 2
  collected=$(m -N $DB -e "select collected_bytes from qwen_managed_session_resource_collection where session_id='$s'")
  echo "binlog_row_image=$img collected_bytes=$collected binlog_delta=$((after-before)) ratio=$(awk -v a=$((after-before)) -v c=$collected 'BEGIN{printf "%.2f", a/c}')" | tee -a $OUT/binlog.txt
done
echo BIN-DONE
